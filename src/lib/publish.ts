"use server";

import { createHash } from "node:crypto";
import { getSql } from "./db";
import { requireAdmin } from "./auth";
import { invalidatePublishedCache } from "./publish-cache";
import { publishedSnapshotSchema, validatePublishedProbabilityMass } from "./published-snapshot";
import type { PublishedSnapshot } from "./types";

export interface PublishResult {
  ok: boolean;
  code?: "UNAUTHORIZED" | "DATABASE_NOT_CONFIGURED" | "VALIDATION_ERROR" | "PUBLISH_FAILED" | "PUBLISH_DB_WRITE_FAILED";
  message?: string;
  version?: string;
}

function databaseErrorField(error: unknown, field: string): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === "string" && value) return value;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function parseSnapshot(snapshotInput: unknown): { ok: true; snapshot: PublishedSnapshot } | { ok: false; result: PublishResult } {
  const parsed = publishedSnapshotSchema.safeParse(snapshotInput);
  if (!parsed.success) return { ok: false, result: { ok: false, code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "发布数据格式错误" } };
  const snapshot = parsed.data as PublishedSnapshot;
  const massError = validatePublishedProbabilityMass(snapshot);
  if (massError) return { ok: false, result: { ok: false, code: "VALIDATION_ERROR", message: massError } };
  return { ok: true, snapshot };
}

function invalidatePublishedSnapshot(_snapshot: PublishedSnapshot): void {
  invalidatePublishedCache();
}

function publishFailure(error: unknown): PublishResult {
  const message = error instanceof Error ? error.message : "PUBLISH_FAILED";
  if (message === "DATABASE_NOT_CONFIGURED") return { ok: false, code: "DATABASE_NOT_CONFIGURED", message: "尚未连接 Neon 数据库" };
  if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, code: "UNAUTHORIZED", message: "请先使用有权限的 LSCube 账号登录" };
  const databaseCode = databaseErrorField(error, "code");
  const constraint = databaseErrorField(error, "constraint");
  console.error("[publish.snapshot] " + JSON.stringify({
    errorName: error instanceof Error ? error.name : "UnknownError",
    databaseCode,
    constraint,
    errorMessage: message.slice(0, 240),
  }));
  const diagnostic = databaseCode ?? (/too large|payload|body size|request entity/i.test(message)
    ? "PAYLOAD_TOO_LARGE"
    : /fetch failed|network|timeout/i.test(message)
      ? "DATABASE_NETWORK_ERROR"
      : /relation .*does not exist|undefined table/i.test(message)
        ? "PUBLISH_SCHEMA_MISSING"
        : "DB_WRITE_UNKNOWN");
  return { ok: false, code: "PUBLISH_DB_WRITE_FAILED", message: `数据库未接受发布快照，请检查发布表迁移状态后重试（调试信息：PUBLISH_DB_WRITE_FAILED:${diagnostic}）` };
}

export async function publishSnapshot(snapshotInput: unknown, inputHash: string): Promise<PublishResult> {
  const parsed = parseSnapshot(snapshotInput);
  if (!parsed.ok) return parsed.result;
  const { snapshot } = parsed;
  try {
    const session = await requireAdmin();
    const version = `vct-2026-${Date.now()}`;
    const engineVersion = snapshot.regions[0]?.engineVersion ?? "unknown";
    const sql = getSql();
    const publishedInputHash = createHash("sha256").update(inputHash).digest("hex");
    await sql.transaction((tx) => [
      tx`insert into "published_versions" ("season_id", "version", "snapshot", "input_hash", "engine_version", "published_by", "data_cutoff") values (${"vct-2026"}, ${version}, ${JSON.stringify(snapshot)}::jsonb, ${publishedInputHash}, ${engineVersion}, ${session.email}, ${new Date(snapshot.dataCutoff)})`,
    ]);
    invalidatePublishedSnapshot(snapshot);
    return { ok: true, version };
  } catch (error) {
    return publishFailure(error);
  }
}

/**
 * Validates a fully reassembled snapshot, then lets Postgres concatenate the
 * already-uploaded chunks inside the INSERT. This avoids sending a large JSON
 * parameter through the Neon HTTP request a second time.
 */
export async function publishChunkedSnapshot(snapshotInput: unknown, inputHash: string, chunkJobId: string): Promise<PublishResult> {
  const parsed = parseSnapshot(snapshotInput);
  if (!parsed.ok) return parsed.result;
  const { snapshot } = parsed;
  try {
    const session = await requireAdmin();
    const version = `vct-2026-${Date.now()}`;
    const engineVersion = snapshot.regions[0]?.engineVersion ?? "unknown";
    const sql = getSql();
    const publishedInputHash = createHash("sha256").update(inputHash).digest("hex");
    await sql.transaction((tx) => [
      tx`insert into "published_versions" ("season_id", "version", "snapshot", "input_hash", "engine_version", "published_by", "data_cutoff") values (${"vct-2026"}, ${version}, (select string_agg("payload"->>'text', '' order by "chunk_index")::jsonb from "analysis_chunks" where "job_id" = ${chunkJobId}::uuid), ${publishedInputHash}, ${engineVersion}, ${session.email}, ${new Date(snapshot.dataCutoff)})`,
    ]);
    invalidatePublishedSnapshot(snapshot);
    return { ok: true, version };
  } catch (error) {
    return publishFailure(error);
  }
}
