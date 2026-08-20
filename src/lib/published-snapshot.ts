import { z } from "zod";
import type { PublishedSnapshot, RegionAnalysis, RegionId } from "./types";

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

const snapshotFieldsSchema = z.object({
  version: z.string(),
  publishedAt: z.string(),
  dataCutoff: z.string(),
  teams: z.array(publishedTeamSchema).optional(),
  challengerTeams: z.array(publishedTeamSchema).optional(),
  teamPoints: z.array(publishedTeamPointsSchema).optional(),
  matches: z.array(publishedMatchSchema).optional(),
  clusters: z.record(z.enum(["amer", "emea", "pacific", "china"]), publishedClusterAnalysisSchema).optional(),
});

export const publishedSnapshotSchema = snapshotFieldsSchema.extend({
  regions: z.array(regionAnalysisSchema).length(4),
});

const partialPublishedSnapshotSchema = snapshotFieldsSchema.extend({
  regions: z.array(regionAnalysisSchema).min(1).max(4),
});

export function validatePublishedProbabilityMass(snapshot: PublishedSnapshot): string | null {
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

export type SnapshotMergeResult =
  | { ok: true; snapshot: PublishedSnapshot }
  | { ok: false; code: "VALIDATION_ERROR" | "PUBLISH_BASE_SNAPSHOT_INVALID"; message: string };

/**
 * Merges a partial regional publication into the last complete public snapshot.
 * The returned value always keeps all four regions for public-page consumers.
 */
export function mergePublishedSnapshot(baseInput: unknown, partialInput: unknown): SnapshotMergeResult {
  const baseParsed = publishedSnapshotSchema.safeParse(baseInput);
  if (!baseParsed.success) return { ok: false, code: "PUBLISH_BASE_SNAPSHOT_INVALID", message: "当前已发布快照格式无效，无法合并赛区结果" };
  const baseSnapshot = baseParsed.data as unknown as PublishedSnapshot;
  const baseMassError = validatePublishedProbabilityMass(baseSnapshot);
  if (baseMassError) return { ok: false, code: "PUBLISH_BASE_SNAPSHOT_INVALID", message: `当前已发布快照校验失败：${baseMassError}` };

  const partialParsed = partialPublishedSnapshotSchema.safeParse(partialInput);
  if (!partialParsed.success) return { ok: false, code: "VALIDATION_ERROR", message: partialParsed.error.issues[0]?.message ?? "发布数据格式错误" };
  const partialSnapshot = partialParsed.data as unknown as PublishedSnapshot;

  const selectedRegions = new Set(partialSnapshot.regions.map((item) => item.region));
  if (selectedRegions.size !== partialSnapshot.regions.length) {
    return { ok: false, code: "VALIDATION_ERROR", message: "发布数据包含重复赛区" };
  }

  const replacementByRegion = new Map<RegionId, RegionAnalysis>(partialSnapshot.regions.map((item) => [item.region, item]));
  const regions = baseSnapshot.regions.map((item) => replacementByRegion.get(item.region) ?? item);
  const teamRoster = [
    ...(baseSnapshot.teams ?? []),
    ...(partialSnapshot.teams ?? []),
    ...(baseSnapshot.challengerTeams ?? []),
    ...(partialSnapshot.challengerTeams ?? []),
  ];
  const selectedTeamIds = new Set(teamRoster.filter((team) => selectedRegions.has(team.region)).map((team) => team.id));
  for (const point of partialSnapshot.teamPoints ?? []) selectedTeamIds.add(point.teamId);

  const teamPoints = partialSnapshot.teamPoints === undefined
    ? baseSnapshot.teamPoints
    : [
      ...(baseSnapshot.teamPoints ?? []).filter((item) => !selectedTeamIds.has(item.teamId)),
      ...partialSnapshot.teamPoints.filter((item) => selectedTeamIds.has(item.teamId)),
    ];

  const isSelectedRegionalStage2Match = (match: NonNullable<PublishedSnapshot["matches"]>[number]) => (
    match.eventId === "stage-2"
      && match.region !== "global"
      && selectedRegions.has(match.region as RegionId)
  );
  const matches = partialSnapshot.matches === undefined
    ? baseSnapshot.matches
    : [
      ...(baseSnapshot.matches ?? []).filter((match) => !isSelectedRegionalStage2Match(match)),
      ...partialSnapshot.matches.filter((match) => isSelectedRegionalStage2Match(match)),
    ];

  const partialClusters = partialSnapshot.clusters
    ? Object.fromEntries(Object.entries(partialSnapshot.clusters).filter(([region]) => selectedRegions.has(region as RegionId)))
    : undefined;
  const clusters = partialSnapshot.clusters === undefined
    ? baseSnapshot.clusters
    : { ...(baseSnapshot.clusters ?? {}), ...partialClusters };

  return {
    ok: true,
    snapshot: {
      version: partialSnapshot.version,
      publishedAt: partialSnapshot.publishedAt,
      dataCutoff: partialSnapshot.dataCutoff,
      regions,
      teams: partialSnapshot.teams ?? baseSnapshot.teams,
      challengerTeams: partialSnapshot.challengerTeams ?? baseSnapshot.challengerTeams,
      teamPoints,
      matches,
      clusters,
    },
  };
}
