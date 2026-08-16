import { z } from "zod";

export const mapScoreSchema = z.object({
  map: z.string().min(1).max(32),
  teamARounds: z.number().int().min(0).max(99),
  teamBRounds: z.number().int().min(0).max(99),
});

export const matchResultSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  region: z.enum(["amer", "emea", "pacific", "china"]),
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
});

export const draftPayloadSchema = z.object({
  seasonId: z.string().min(1),
  revision: z.number().int().positive(),
  matches: z.array(matchResultSchema),
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
  return result;
}

