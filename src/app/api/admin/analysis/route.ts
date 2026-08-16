import { NextResponse } from "next/server";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { analysisChunks, analysisJobs } from "../../../../../db/schema";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const createSchema = z.object({ type: z.literal("create"), seasonId: z.string().min(1), draftRevision: z.number().int().positive(), inputHash: z.string().min(1), expectedChunks: z.number().int().positive() });
const chunkSchema = z.object({ type: z.literal("chunk"), jobId: z.string().uuid(), chunkIndex: z.number().int().nonnegative(), payload: z.record(z.unknown()) });
const finalizeSchema = z.object({ type: z.literal("finalize"), jobId: z.string().uuid(), expectedChunks: z.number().int().positive() });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z.discriminatedUnion("type", [createSchema, chunkSchema, finalizeSchema]).safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "VALIDATION_ERROR" }, { status: 400 });
  try {
    const session = await requireAdmin();
    const db = getDb();
    if (parsed.data.type === "create") {
      const rows = await db.insert(analysisJobs).values({ ...parsed.data, createdBy: session.email, status: "created" }).returning({ id: analysisJobs.id });
      return NextResponse.json({ ok: true, jobId: rows[0]?.id });
    }
    if (parsed.data.type === "chunk") {
      await db.insert(analysisChunks).values({ jobId: parsed.data.jobId, chunkIndex: parsed.data.chunkIndex, payload: parsed.data.payload });
      return NextResponse.json({ ok: true, chunkIndex: parsed.data.chunkIndex });
    }
    const rows = await db.select({ count: count() }).from(analysisChunks).where(eq(analysisChunks.jobId, parsed.data.jobId));
    if (Number(rows[0]?.count ?? 0) !== parsed.data.expectedChunks) return NextResponse.json({ ok: false, code: "CHUNKS_INCOMPLETE" }, { status: 409 });
    await db.update(analysisJobs).set({ status: "completed" }).where(eq(analysisJobs.id, parsed.data.jobId));
    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ANALYSIS_UPLOAD_FAILED";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }
    if (message === "DATABASE_NOT_CONFIGURED") {
      return NextResponse.json({ ok: false, code: "DATABASE_NOT_CONFIGURED" }, { status: 503 });
    }
    return NextResponse.json({ ok: false, code: "ANALYSIS_UPLOAD_FAILED" }, { status: 500 });
  }
}
