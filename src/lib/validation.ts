import { z } from "zod";

export const mapScoreSchema = z.object({
  map: z.string().min(1).max(32),
  teamARounds: z.number().int().min(0).max(99),
  teamBRounds: z.number().int().min(0).max(99),
});

const teamSchema = z.object({
  id: z.string().min(1),
  region: z.enum(["amer", "emea", "pacific", "china"]),
  name: z.string().min(1).max(120),
  shortName: z.string().min(1).max(32),
  color: z.string().min(1).max(32),
  active: z.boolean(),
  country: z.string().max(64).optional(),
  logoUrl: z.string().max(1_500_000).optional(),
});

const groupConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  teamIds: z.array(z.string().min(1)).max(24),
});

const tournamentConfigSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string().min(1).max(120),
  scope: z.enum(["regional", "international"]),
  format: z.enum(["triple-elimination", "group-plus-playoffs", "swiss-plus-playoffs"]),
  groupStage: z.object({
    groups: z.array(groupConfigSchema).max(8),
    bestOf: z.union([z.literal(3), z.literal(5)]),
  }).optional(),
  bracket: z.object({
    type: z.enum(["single-elimination", "double-elimination", "triple-elimination"]),
    startRound: z.enum(["quarterfinals", "semifinals"]),
    teamRefs: z.array(z.string().min(1)).max(32),
  }).optional(),
});

export const matchResultSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  region: z.enum(["amer", "emea", "pacific", "china", "global"]),
  stage: z.enum(["kickoff", "masters-1", "stage-1", "masters-2", "stage-2", "champions"]),
  teamA: z.string().min(1),
  teamB: z.string().min(1),
  status: z.enum(["scheduled", "completed", "forfeit", "cancelled"]),
  winner: z.string().optional(),
  maps: z.array(mapScoreSchema),
  isRegularSeason: z.boolean(),
  isTiebreaker: z.boolean(),
  playedAt: z.string().optional(),
  notes: z.string().max(1000).optional(),
  phase: z.enum(["group", "swiss", "playoffs"]).optional(),
  groupId: z.string().min(1).optional(),
  roundLabel: z.string().max(64).optional(),
  bracketRound: z.string().max(64).optional(),
  bestOf: z.union([z.literal(3), z.literal(5)]).optional(),
});

export const draftPayloadSchema = z.object({
  seasonId: z.string().min(1),
  revision: z.number().int().positive(),
  matches: z.array(matchResultSchema),
  teams: z.array(teamSchema).default([]),
  tournaments: z.array(tournamentConfigSchema).default([]),
});

export function validateMatchResult(value: unknown) {
  const result = matchResultSchema.safeParse(value);
  if (!result.success) return result;
  const match = result.data;
  if (match.teamA === match.teamB) {
    return { success: false as const, error: new Error("比赛双方必须不同") };
  }
  if (["completed", "forfeit"].includes(match.status) && match.winner && ![match.teamA, match.teamB].includes(match.winner)) {
    return { success: false as const, error: new Error("比赛胜者必须是参赛队伍") };
  }
  if (match.status === "completed" && !match.winner) {
    return { success: false as const, error: new Error("已完成比赛必须填写胜者") };
  }
  if (match.status === "completed" && match.maps.length === 0) {
    return { success: false as const, error: new Error("正常完赛必须填写逐地图比分") };
  }
  if (match.status === "forfeit" && match.maps.length > 0) {
    return { success: false as const, error: new Error("弃权比赛不应填写地图比分") };
  }
  if (match.status === "forfeit" && !match.winner) {
    return { success: false as const, error: new Error("弃权比赛必须填写判定胜者") };
  }
  if (match.status === "forfeit" && !match.notes?.trim()) {
    return { success: false as const, error: new Error("弃权比赛必须填写原因") };
  }
  if (match.status === "completed") {
    const teamAMapWins = match.maps.filter((map) => map.teamARounds > map.teamBRounds).length;
    const teamBMapWins = match.maps.filter((map) => map.teamBRounds > map.teamARounds).length;
    if (match.maps.some((map) => map.teamARounds === map.teamBRounds)) {
      return { success: false as const, error: new Error("每张地图必须有明确胜者") };
    }
    const winnerMapWins = match.winner === match.teamA ? teamAMapWins : teamBMapWins;
    const requiredMapWins = match.bestOf === 5 ? 3 : 2;
    const shouldCheckSeriesResult = match.maps.length > 1 || match.bestOf !== undefined;
    if (shouldCheckSeriesResult && (winnerMapWins < requiredMapWins || winnerMapWins <= (match.winner === match.teamA ? teamBMapWins : teamAMapWins))) {
      return { success: false as const, error: new Error("地图比分与系列赛胜者不一致") };
    }
  }
  return result;
}
