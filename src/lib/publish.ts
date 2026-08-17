"use server";

import { createHash } from "node:crypto";
import { updateTag } from "next/cache";
import { getSql } from "./db";
import { requireAdmin } from "./auth";
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

const snapshotSchema = z.object({
  version: z.string(),
  publishedAt: z.string(),
  dataCutoff: z.string(),
  regions: z.array(regionAnalysisSchema).length(4),
});

export interface PublishResult {
  ok: boolean;
  code?: "UNAUTHORIZED" | "DATABASE_NOT_CONFIGURED" | "VALIDATION_ERROR" | "PUBLISH_FAILED";
  message?: string;
  version?: string;
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

export async function publishSnapshot(snapshotInput: unknown, inputHash: string): Promise<PublishResult> {
  const parsed = snapshotSchema.safeParse(snapshotInput);
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "发布数据格式错误" };
  const snapshot = parsed.data as PublishedSnapshot;
  const massError = validateProbabilityMass(snapshot);
  if (massError) return { ok: false, code: "VALIDATION_ERROR", message: massError };
  try {
    const session = await requireAdmin();
    const version = `vct-2026-${Date.now()}`;
    const engineVersion = snapshot.regions[0]?.engineVersion ?? "unknown";
    const sql = getSql();
    const publishedInputHash = createHash("sha256").update(inputHash).digest("hex");
    await sql.transaction((tx) => [
      tx`insert into "published_versions" ("season_id", "version", "snapshot", "input_hash", "engine_version", "published_by", "data_cutoff") values (${"vct-2026"}, ${version}, ${JSON.stringify(snapshot)}::jsonb, ${publishedInputHash}, ${engineVersion}, ${session.email}, ${new Date(snapshot.dataCutoff)})`,
    ]);
    updateTag("season-2026-published");
    for (const region of snapshot.regions) updateTag(`season-2026-${region.region}`);
    return { ok: true, version };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PUBLISH_FAILED";
    if (message === "DATABASE_NOT_CONFIGURED") return { ok: false, code: "DATABASE_NOT_CONFIGURED", message: "尚未连接 Neon 数据库" };
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, code: "UNAUTHORIZED", message: "请先使用有权限的 LSCube 账号登录" };
    return { ok: false, code: "PUBLISH_FAILED", message: "发布失败，上一完整版本保持不变" };
  }
}
