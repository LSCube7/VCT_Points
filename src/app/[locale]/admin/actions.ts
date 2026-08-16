"use server";

import { createHash } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { auditLogs, draftVersions } from "../../../../db/schema";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { draftPayloadSchema, validateMatchResult } from "@/lib/validation";

export interface AdminActionResult {
  ok: boolean;
  code?: "DATABASE_NOT_CONFIGURED" | "VALIDATION_ERROR" | "REVISION_CONFLICT" | "SAVE_FAILED" | "UNAUTHORIZED";
  message?: string;
  revision?: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

export async function validateDraft(payload: unknown): Promise<AdminActionResult> {
  const parsed = draftPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "草稿数据格式错误" };
  }
  const invalidMatch = parsed.data.matches.map((match) => ({ match, result: validateMatchResult(match) })).find(({ result }) => !result.success);
  if (!invalidMatch) return { ok: true, revision: parsed.data.revision };
  const validationError = invalidMatch.result.success ? new Error("比赛结果无效") : invalidMatch.result.error;
  return { ok: false, code: "VALIDATION_ERROR", message: `比赛 ${invalidMatch.match.id}：${validationError.message}` };
}

export async function saveDraft(payload: unknown): Promise<AdminActionResult> {
  const parsed = draftPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "草稿数据格式错误" };
  }
  try {
    const session = await requireAdmin();
    const db = getDb();
    const current = await db
      .select({ revision: draftVersions.revision })
      .from(draftVersions)
      .where(eq(draftVersions.seasonId, parsed.data.seasonId))
      .orderBy(desc(draftVersions.revision))
      .limit(1);
    const latestRevision = current[0]?.revision ?? 0;
    if (latestRevision !== parsed.data.revision - 1 && latestRevision !== parsed.data.revision) {
      return { ok: false, code: "REVISION_CONFLICT", message: "草稿已被其他管理员更新，请刷新后重试" };
    }
    const revision = latestRevision === parsed.data.revision ? parsed.data.revision + 1 : parsed.data.revision;
    const serialized = stableJson(parsed.data);
    const inputHash = createHash("sha256").update(serialized).digest("hex");
    await db.transaction(async (tx) => {
      await tx.insert(draftVersions).values({
        seasonId: parsed.data.seasonId,
        revision,
        status: "draft",
        payload: parsed.data,
        inputHash,
        updatedBy: session.email,
      });
      await tx.insert(auditLogs).values({
        actor: session.email,
        action: "draft.save",
        entityType: "draft",
        entityId: parsed.data.seasonId,
        details: { revision, inputHash },
      });
    });
    return { ok: true, revision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "草稿保存失败";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, code: "UNAUTHORIZED", message: "请先使用有权限的 LSCube 账号登录" };
    }
    if (message === "DATABASE_NOT_CONFIGURED") {
      return { ok: false, code: "DATABASE_NOT_CONFIGURED", message: "尚未连接 Neon 数据库；当前页面仅展示本地预览" };
    }
    return { ok: false, code: "SAVE_FAILED", message: "草稿保存失败，请查看服务端日志" };
  }
}
