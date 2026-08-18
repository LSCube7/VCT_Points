import type { GroupTeamRecord, MatchResult, TeamRankingMetrics } from "./types";

export const ENGINE_VERSION = "2026.1.0";

export const CHAMPIONSHIP_POINTS = {
  kickoff: [4, 3, 2, 1],
  "masters-1": [6, 4, 3, 2, 1, 1],
  "stage-1": [6, 4, 3, 2],
  "masters-2": [8, 6, 5, 4, 3, 3],
  "stage-2": [8, 6, 5, 4],
} as const;

export const RULE_SOURCES = [
  {
    label: "Riot Games VCT 2026 Handbook",
    url: "https://valorantesports.com/en-US/season/115571062868511862/handbook",
  },
  {
    label: "Liquipedia VCT 2026 Championship Points",
    url: "https://liquipedia.net/valorant/VCT/2026/Championship_Points",
  },
] as const;

export function placementPoints(
  event: keyof typeof CHAMPIONSHIP_POINTS,
  placement: number,
): number {
  return CHAMPIONSHIP_POINTS[event][placement - 1] ?? 0;
}

export function regularSeasonMatchPoints(matches: MatchResult[], teamId: string, groupRecords: GroupTeamRecord[] = []): number {
  const groupWins = groupRecords.reduce((total, record) => total + (record.teamId === teamId ? record.wins : 0), 0);
  const matchWins = matches.reduce((total, match) => {
    if (!match.isRegularSeason || match.phase === "group" || match.isTiebreaker || match.status === "cancelled") return total;
    return total + (match.status !== "scheduled" && match.winner === teamId ? 1 : 0);
  }, 0);
  return groupWins + matchWins;
}

export function mapAndRoundDiff(matches: MatchResult[], teamId: string): Pick<TeamRankingMetrics, "mapDiff" | "roundDiff"> {
  return matches.reduce(
    (totals, match) => {
      if (match.status === "scheduled" || match.status === "cancelled") return totals;
      const teamIsA = match.teamA === teamId;
      const teamIsB = match.teamB === teamId;
      if (!teamIsA && !teamIsB) return totals;
      for (const map of match.maps) {
        const own = teamIsA ? map.teamARounds : map.teamBRounds;
        const opponent = teamIsA ? map.teamBRounds : map.teamARounds;
        totals.roundDiff += own - opponent;
        totals.mapDiff += own === opponent ? 0 : own > opponent ? 1 : -1;
      }
      return totals;
    },
    { mapDiff: 0, roundDiff: 0 },
  );
}

export function compareRankingMetrics(
  left: TeamRankingMetrics,
  right: TeamRankingMetrics,
  includeHeadToHead = true,
): number {
  const descending = (a: number, b: number) => b - a;
  const ascending = (a: number, b: number) => a - b;
  const comparisons: Array<[number, number, (a: number, b: number) => number]> = [
    [left.stage2Finish, right.stage2Finish, ascending],
    [left.masters2Finish, right.masters2Finish, ascending],
    [left.stage1Finish, right.stage1Finish, ascending],
    [left.masters1Finish, right.masters1Finish, ascending],
    [left.kickoffFinish, right.kickoffFinish, ascending],
    [left.regularSeasonWins, right.regularSeasonWins, descending],
    [left.mapDiff, right.mapDiff, descending],
    [left.roundDiff, right.roundDiff, descending],
  ];
  for (const [a, b, compare] of comparisons) {
    const result = compare(a, b);
    if (result !== 0) return result;
  }
  if (includeHeadToHead) {
    const headToHeadComparisons: Array<[number, number, (a: number, b: number) => number]> = [
      [left.headToHeadWins, right.headToHeadWins, descending],
      [left.headToHeadMapDiff, right.headToHeadMapDiff, descending],
      [left.headToHeadRoundDiff, right.headToHeadRoundDiff, descending],
    ];
    for (const [a, b, compare] of headToHeadComparisons) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
  }
  return 0;
}
