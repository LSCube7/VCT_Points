"use server";

import { createHash } from "node:crypto";
import { getSql } from "./db";
import { requireAdmin } from "./auth";
import { invalidatePublishedCache } from "./publish-cache";
import { z } from "zod";
import type { PublishedSnapshot } from "./types";

const probabilitySchema = z.object({
  numerator: z.string().regex(/^\d+$/),
  denominator: z.string().regex(/^\d+$/),
  percentage: z.number().min(0).max(100),
});

const regionAnalysisSchema = z.object({
  region: z.enum(["amer", "emea", "pacific", "china"]),
  totalOutcomes: z.string().regex(/^\d+$/),
  scenarioGroups: z.array(z.object({
    id: z.string(),
    region: z.enum(["amer", "emea", "pacific", "china"]),
    qualifiers: z.array(z.string()).length(4),
    stage2Placements: z.record(z.string(), z.number().int().min(1).max(4)).optional(),
    methods: z.record(z.string()),
    probability: probabilitySchema,
    outcomeCount: z.string().regex(/^\d+$/),
    representativeResults: z.record(z.string()),
  })),
  teamProbabilities: z.array(z.object({
    teamId: z.string(),
    probability: probabilitySchema,
    methods: z.record(probabilitySchema),
  })),
  engineVersion: z.string(),
});

const publishedTeamSchema = z.object({
  id: z.string(),
  region: z.enum(["amer", "emea", "pacific", "china"]),
  name: z.string(),
  shortName: z.string(),
  color: z.string(),
  active: z.boolean(),
  country: z.string().optional(),
  logoUrl: z.string().optional(),
});

const publishedTeamPointsSchema = z.object({
  teamId: z.string(),
  total: z.number(),
  breakdown: z.object({
    kickoff: z.number(),
    masters1: z.number(),
    stage1: z.number(),
    masters2: z.number(),
    regularSeason: z.number(),
  }),
});

const publishedMatchSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  region: z.enum(["amer", "emea", "pacific", "china", "global"]),
  stage: z.enum(["kickoff", "masters-1", "stage-1", "masters-2", "stage-2", "champions"]),
  teamA: z.string(),
  teamB: z.string(),
  status: z.enum(["scheduled", "completed", "forfeit", "cancelled"]),
  winner: z.string().optional(),
  maps: z.array(z.object({ map: z.string(), teamARounds: z.number(), teamBRounds: z.number() })),
  isRegularSeason: z.boolean(),
  isTiebreaker: z.boolean(),
  playedAt: z.string().optional(),
  notes: z.string().optional(),
  phase: z.enum(["group", "swiss", "playoffs"]).optional(),
  groupId: z.string().optional(),
  roundLabel: z.string().optional(),
  bracketRound: z.string().optional(),
  bestOf: z.union([z.literal(3), z.literal(5)]).optional(),
});

const publishedClusterSchema = z.object({
  id: z.string(),
  scenarioIds: z.array(z.string()),
  totalProbability: z.number().min(0).max(1),
  medoidScenarioId: z.string(),
});

const publishedClusterAnalysisSchema = z.object({
  recommendedK: z.number().int().nonnegative(),
  clusters: z.array(publishedClusterSchema),
  scores: z.record(z.string(), z.number()),
});

const snapshotSchema = z.object({
  version: z.string(),
  publishedAt: z.string(),
  dataCutoff: z.string(),
  regions: z.array(regionAnalysisSchema).length(4),
  teams: z.array(publishedTeamSchema).optional(),
  challengerTeams: z.array(publishedTeamSchema).optional(),
  teamPoints: z.array(publishedTeamPointsSchema).optional(),
  matches: z.array(publishedMatchSchema).optional(),
  clusters: z.record(z.enum(["amer", "emea", "pacific", "china"]), publishedClusterAnalysisSchema).optional(),
});

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

function validateProbabilityMass(snapshot: PublishedSnapshot): string | null {
  const seen = new Set<string>();
  for (const region of snapshot.regions) {
    if (seen.has(region.region)) return `重复赛区：${region.region}`;
    seen.add(region.region);
    const denominator = BigInt(region.totalOutcomes);
    const groupMass = region.scenarioGroups.reduce((total, group) => total + BigInt(group.outcomeCount), 0n);
    if (groupMass !== denominator) return `${region.region} 情景概率总和不等于总事件数`;
    if (region.scenarioGroups.some((group) => new Set(group.qualifiers).size !== 4)) return `${region.region} 存在重复晋级队伍`;
  }
  return seen.size === 4 ? null : "必须包含四个赛区";
}

function parseSnapshot(snapshotInput: unknown): { ok: true; snapshot: PublishedSnapshot } | { ok: false; result: PublishResult } {
  const parsed = snapshotSchema.safeParse(snapshotInput);
  if (!parsed.success) return { ok: false, result: { ok: false, code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "发布数据格式错误" } };
  const snapshot = parsed.data as PublishedSnapshot;
  const massError = validateProbabilityMass(snapshot);
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
