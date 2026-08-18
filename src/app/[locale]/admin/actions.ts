"use server";

import { createHash } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { draftVersions, publishedVersions } from "../../../../db/schema";
import { getDb, getSql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { invalidatePublishedCache } from "@/lib/publish-cache";
import { draftPayloadSchema, validateMatchResult, validateTournamentConfig } from "@/lib/validation";
import type { DraftPayload } from "@/lib/types";

export interface AdminActionResult {
  ok: boolean;
  code?: "DATABASE_NOT_CONFIGURED" | "VALIDATION_ERROR" | "REVISION_CONFLICT" | "SAVE_FAILED" | "UNAUTHORIZED" | "PUBLISH_CACHE_REFRESH_FAILED";
  message?: string;
  revision?: number;
  version?: string;
}

export interface DraftLoadResult {
  ok: boolean;
  code?: "DATABASE_NOT_CONFIGURED" | "UNAUTHORIZED" | "FORBIDDEN" | "LOAD_FAILED";
  message?: string;
  payload?: DraftPayload;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function getNestedErrorField(error: unknown, field: string): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const value = (current as Record<string, unknown>)[field];
      if (typeof value === "string" && value) return value;
      current = (current as { cause?: unknown }).cause;
    } else {
      return undefined;
    }
  }
  return undefined;
}

function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message
    .replace(/\bparams:\s*[\s\S]*$/i, "params: [redacted]")
    .replace(/\b(detail|context|hint):\s*[\s\S]*$/i, "$1: [redacted]")
    .slice(0, 240);
}

function isUniqueViolation(error: unknown): boolean {
  return getNestedErrorField(error, "code") === "23505";
}

export async function validateDraft(payload: unknown): Promise<AdminActionResult> {
  const parsed = draftPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "草稿数据格式错误" };
  }
  const invalidTournament = parsed.data.tournaments.map((tournament) => ({ tournament, result: validateTournamentConfig(tournament) })).find(({ result }) => !result.success);
  if (invalidTournament && !invalidTournament.result.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: `赛事 ${invalidTournament.tournament.name}：${invalidTournament.result.error.message}` };
  }
  const invalidMatch = parsed.data.matches.map((match) => ({ match, result: validateMatchResult(match) })).find(({ result }) => !result.success);
  if (!invalidMatch) return { ok: true, revision: parsed.data.revision };
  const validationError = invalidMatch.result.success ? new Error("比赛结果无效") : invalidMatch.result.error;
  return { ok: false, code: "VALIDATION_ERROR", message: `比赛 ${invalidMatch.match.id}：${validationError.message}` };
}

export async function refreshPublishedCache(): Promise<AdminActionResult> {
  try {
    await requireAdmin();
    const db = getDb();
    const latest = await db
      .select({ version: publishedVersions.version })
      .from(publishedVersions)
      .orderBy(desc(publishedVersions.publishedAt))
      .limit(1);
    if (!latest[0]) return { ok: false, code: "PUBLISH_CACHE_REFRESH_FAILED", message: "当前没有已发布的精确结果，请先完成发布" };
    invalidatePublishedCache();
    return { ok: true, version: latest[0].version, message: `公开页面缓存已刷新，当前发布版本：${latest[0].version}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PUBLISH_CACHE_REFRESH_FAILED";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, code: "UNAUTHORIZED", message: "请先使用有权限的 LSCube 账号登录" };
    if (message === "DATABASE_NOT_CONFIGURED") return { ok: false, code: "DATABASE_NOT_CONFIGURED", message: "尚未连接 Neon 数据库" };
    console.error("[admin.refreshPublishedCache] " + JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: redactErrorMessage(error),
    }));
    return { ok: false, code: "PUBLISH_CACHE_REFRESH_FAILED", message: "公开页面缓存刷新失败，请稍后重试" };
  }
}

export async function loadDraft(): Promise<DraftLoadResult> {
  try {
    await requireAdmin();
    const db = getDb();
    const current = await db
      .select({ revision: draftVersions.revision, payload: draftVersions.payload })
      .from(draftVersions)
      .where(eq(draftVersions.seasonId, "vct-2026"))
      .orderBy(desc(draftVersions.revision))
      .limit(1);
    const latest = current[0];
    if (!latest) return { ok: true };
    const parsed = draftPayloadSchema.safeParse({ ...(latest.payload as Record<string, unknown>), revision: latest.revision });
    if (!parsed.success) return { ok: false, code: "LOAD_FAILED", message: "已保存草稿格式无效，请检查服务端数据" };
    return { ok: true, payload: parsed.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "草稿读取失败";
    if (message === "UNAUTHORIZED") return { ok: false, code: "UNAUTHORIZED", message: "请先使用有权限的 LSCube 账号登录" };
    if (message === "FORBIDDEN") return { ok: false, code: "FORBIDDEN", message: "当前账号没有赛事管理权限" };
    if (message === "DATABASE_NOT_CONFIGURED") return { ok: false, code: "DATABASE_NOT_CONFIGURED", message: "尚未连接 Neon 数据库；当前页面仅展示本地预览" };
    console.error("[admin.loadDraft] " + JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: redactErrorMessage(error),
    }));
    return { ok: false, code: "LOAD_FAILED", message: "草稿读取失败，请稍后重试" };
  }
}

export async function saveDraft(payload: unknown): Promise<AdminActionResult> {
  const parsed = draftPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "草稿数据格式错误" };
  }
  let candidateRevision: number | undefined;
  let candidateInputHash: string | undefined;
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
    const isInitialSave = latestRevision === 0 && parsed.data.revision === 1;
    if (!isInitialSave && latestRevision !== parsed.data.revision) {
      return { ok: false, code: "REVISION_CONFLICT", message: "草稿已被其他管理员更新，请刷新后重试" };
    }
    const revision = isInitialSave ? 1 : parsed.data.revision + 1;
    const storedPayload = { ...parsed.data, revision };
    const serialized = stableJson(storedPayload);
    const inputHash = createHash("sha256").update(serialized).digest("hex");
    candidateRevision = revision;
    candidateInputHash = inputHash;
    const sql = getSql();
    await sql.transaction((tx) => [
      tx`insert into "draft_versions" ("season_id", "revision", "status", "payload", "input_hash", "updated_by") values (${parsed.data.seasonId}, ${revision}, ${"draft"}, ${JSON.stringify(storedPayload)}::jsonb, ${inputHash}, ${session.email})`,
      tx`insert into "audit_logs" ("actor", "action", "entity_type", "entity_id", "details") values (${session.email}, ${"draft.save"}, ${"draft"}, ${parsed.data.seasonId}, ${JSON.stringify({ revision, inputHash })}::jsonb)`,
    ]);
    return { ok: true, revision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "草稿保存失败";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, code: "UNAUTHORIZED", message: "请先使用有权限的 LSCube 账号登录" };
    }
    if (message === "DATABASE_NOT_CONFIGURED") {
      return { ok: false, code: "DATABASE_NOT_CONFIGURED", message: "尚未连接 Neon 数据库；当前页面仅展示本地预览" };
    }
    if (isUniqueViolation(error)) {
      if (candidateRevision !== undefined && candidateInputHash) {
        try {
          const existing = await getDb()
            .select({ revision: draftVersions.revision, inputHash: draftVersions.inputHash })
            .from(draftVersions)
            .where(and(eq(draftVersions.seasonId, parsed.data.seasonId), eq(draftVersions.revision, candidateRevision)))
            .limit(1);
          if (existing[0]?.inputHash === candidateInputHash) return { ok: true, revision: candidateRevision };
        } catch (lookupError) {
          console.error("[admin.saveDraft.lookup] " + JSON.stringify({
            code: getNestedErrorField(lookupError, "code"),
            errorName: lookupError instanceof Error ? lookupError.name : "UnknownError",
            errorMessage: redactErrorMessage(lookupError),
          }));
        }
      }
      return { ok: false, code: "REVISION_CONFLICT", message: "草稿已被其他管理员更新，请刷新后重试" };
    }
    console.error("[admin.saveDraft] " + JSON.stringify({
      code: getNestedErrorField(error, "code"),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: redactErrorMessage(error),
    }));
    return { ok: false, code: "SAVE_FAILED", message: "草稿保存失败，请查看服务端日志" };
  }
}
