import { createHash } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { analysisChunks, analysisJobs, draftVersions, publishedVersions } from "../../../../../db/schema";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { publishChunkedSnapshot } from "@/lib/publish";
import { mergePublishedSnapshot } from "@/lib/published-snapshot";
import { draftPayloadSchema } from "@/lib/validation";

const createSchema = z.object({
  type: z.literal("create"),
  seasonId: z.literal("vct-2026"),
  draftRevision: z.number().int().positive(),
  expectedChunks: z.number().int().positive().max(10_000),
});

const chunkSchema = z.object({
  type: z.literal("chunk"),
  jobId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1).max(200_000),
});

const finalizeSchema = z.object({
  type: z.literal("finalize"),
  jobId: z.string().uuid(),
  expectedChunks: z.number().int().positive().max(10_000),
});

const requestSchema = z.discriminatedUnion("type", [createSchema, chunkSchema, finalizeSchema]);
const publishChunkSize = 96_000;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

function getStatusForPublishResult(code?: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "DATABASE_NOT_CONFIGURED") return 503;
  if (code === "VALIDATION_ERROR") return 422;
  return 500;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "发布请求格式无效", 400);

  try {
    const session = await requireAdmin();
    const db = getDb();

    if (parsed.data.type === "create") {
      const latest = await db
        .select({ revision: draftVersions.revision, payload: draftVersions.payload, inputHash: draftVersions.inputHash })
        .from(draftVersions)
        .where(eq(draftVersions.seasonId, parsed.data.seasonId))
        .orderBy(desc(draftVersions.revision))
        .limit(1);
      const latestDraft = latest[0];
      if (!latestDraft || latestDraft.revision !== parsed.data.draftRevision) {
        return errorResponse("DRAFT_REVISION_CONFLICT", "草稿版本已变化，请刷新后台后重新计算并发布", 409);
      }
      const draft = draftPayloadSchema.safeParse({
        ...(latestDraft.payload as Record<string, unknown>),
        revision: latestDraft.revision,
      });
      if (!draft.success) return errorResponse("VALIDATION_ERROR", "当前草稿格式无效，请先重新保存草稿", 422);
      const inputHash = latestDraft.inputHash ?? createHash("sha256").update(stableJson(draft.data)).digest("hex");
      const rows = await db.insert(analysisJobs).values({
        seasonId: parsed.data.seasonId,
        draftRevision: parsed.data.draftRevision,
        inputHash,
        expectedChunks: parsed.data.expectedChunks,
        status: "publishing",
        createdBy: session.email,
      }).returning({ id: analysisJobs.id });
      return NextResponse.json({ ok: true, jobId: rows[0]?.id, expectedChunks: parsed.data.expectedChunks });
    }

    const jobs = await db
      .select({ id: analysisJobs.id, expectedChunks: analysisJobs.expectedChunks, inputHash: analysisJobs.inputHash, status: analysisJobs.status, createdBy: analysisJobs.createdBy })
      .from(analysisJobs)
      .where(eq(analysisJobs.id, parsed.data.jobId))
      .limit(1);
    const job = jobs[0];
    if (!job || job.createdBy.toLowerCase() !== session.email.toLowerCase()) return errorResponse("PUBLISH_JOB_NOT_FOUND", "发布任务不存在或无权访问", 404);
    if (job.status !== "publishing") return errorResponse("PUBLISH_JOB_CLOSED", "发布任务已结束，请重新开始发布", 409);

    if (parsed.data.type === "chunk") {
      if (parsed.data.chunkIndex >= job.expectedChunks) return errorResponse("PUBLISH_CHUNK_INDEX_INVALID", "发布分块编号无效", 400);
      await db.insert(analysisChunks).values({
        jobId: parsed.data.jobId,
        chunkIndex: parsed.data.chunkIndex,
        payload: { text: parsed.data.text },
      }).onConflictDoUpdate({
        target: [analysisChunks.jobId, analysisChunks.chunkIndex],
        set: { payload: { text: parsed.data.text } },
      });
      return NextResponse.json({ ok: true, chunkIndex: parsed.data.chunkIndex });
    }

    if (parsed.data.expectedChunks !== job.expectedChunks) return errorResponse("PUBLISH_CHUNK_COUNT_MISMATCH", "发布分块数量与任务不一致", 409);
    const chunks = await db
      .select({ chunkIndex: analysisChunks.chunkIndex, payload: analysisChunks.payload })
      .from(analysisChunks)
      .where(eq(analysisChunks.jobId, parsed.data.jobId))
      .orderBy(asc(analysisChunks.chunkIndex));
    if (chunks.length !== job.expectedChunks || chunks.some((chunk, index) => chunk.chunkIndex !== index)) {
      return errorResponse("PUBLISH_CHUNKS_INCOMPLETE", "精确结果尚未完整上传，请重试发布", 409);
    }

    const serializedSnapshot = chunks.map((chunk) => {
      const payload = chunk.payload as { text?: unknown };
      return typeof payload.text === "string" ? payload.text : "";
    }).join("");
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(serializedSnapshot);
    } catch {
      await db.update(analysisJobs).set({ status: "failed" }).where(eq(analysisJobs.id, parsed.data.jobId));
      return errorResponse("VALIDATION_ERROR", "精确结果数据不完整，请重试发布", 422);
    }

    const partialRegionCount = snapshot && typeof snapshot === "object" && Array.isArray((snapshot as { regions?: unknown }).regions)
      ? (snapshot as { regions: unknown[] }).regions.length
      : 0;
    if (partialRegionCount > 0 && partialRegionCount < 4) {
      const latestPublished = await db
        .select({ snapshot: publishedVersions.snapshot })
        .from(publishedVersions)
        .where(eq(publishedVersions.seasonId, "vct-2026"))
        .orderBy(desc(publishedVersions.publishedAt))
        .limit(1);
      if (!latestPublished[0]?.snapshot) {
        await db.update(analysisJobs).set({ status: "failed" }).where(eq(analysisJobs.id, parsed.data.jobId));
        return errorResponse("PUBLISH_BASE_SNAPSHOT_MISSING", "当前还没有完整的已发布快照，首次发布请选择全部四个赛区", 409);
      }
      const merged = mergePublishedSnapshot(latestPublished[0].snapshot, snapshot);
      if (!merged.ok) {
        await db.update(analysisJobs).set({ status: "failed" }).where(eq(analysisJobs.id, parsed.data.jobId));
        return errorResponse(merged.code, merged.message, 422);
      }
      snapshot = merged.snapshot;
      const mergedSerializedSnapshot = JSON.stringify(merged.snapshot);
      const mergedChunks = Array.from(
        { length: Math.ceil(mergedSerializedSnapshot.length / publishChunkSize) },
        (_, index) => mergedSerializedSnapshot.slice(index * publishChunkSize, (index + 1) * publishChunkSize),
      );
      await db.delete(analysisChunks).where(eq(analysisChunks.jobId, parsed.data.jobId));
      await db.insert(analysisChunks).values(mergedChunks.map((text, chunkIndex) => ({
        jobId: job.id,
        chunkIndex,
        payload: { text },
      })));
    }

    const result = await publishChunkedSnapshot(snapshot, job.inputHash, parsed.data.jobId);
    await db.update(analysisJobs).set({ status: result.ok ? "completed" : "failed" }).where(eq(analysisJobs.id, parsed.data.jobId));
    if (!result.ok) return NextResponse.json(result, { status: getStatusForPublishResult(result.code) });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PUBLISH_UPLOAD_FAILED";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return errorResponse("UNAUTHORIZED", "请先使用有权限的 LSCube 账号登录", 401);
    if (message === "DATABASE_NOT_CONFIGURED") return errorResponse("DATABASE_NOT_CONFIGURED", "尚未连接 Neon 数据库", 503);
    console.error("[admin.publish] " + JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: message.slice(0, 240),
    }));
    return errorResponse("PUBLISH_UPLOAD_FAILED", "发布请求处理失败，请稍后重试", 500);
  }
}
