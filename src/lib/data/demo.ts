import { enumerateRegion } from "../engine/exact";
import type { RegionAnalysis, RegionId, RegionSimulationInput, Team } from "../types";

const regionNames: Record<RegionId, string> = {
  amer: "AMER",
  emea: "EMEA",
  pacific: "PACIFIC",
  china: "CN",
};

export const regions: Array<{ id: RegionId; name: string; color: string }> = [
  { id: "amer", name: "AMER", color: "#ef5350" },
  { id: "emea", name: "EMEA", color: "#64b5f6" },
  { id: "pacific", name: "PACIFIC", color: "#81c784" },
  { id: "china", name: "CN", color: "#ffb74d" },
];

export function allDemoTeams(): Team[] {
  return regions.flatMap(({ id }) => demoTeams(id));
}

export function demoTeams(region: RegionId): Team[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `${region}-team-${index + 1}`,
    region,
    name: `${regionNames[region]} 待录入队伍 ${String(index + 1).padStart(2, "0")}`,
    shortName: `${regionNames[region]}-${index + 1}`,
    color: regions.find((item) => item.id === region)?.color ?? "#90a4ae",
    active: true,
    country: "",
  }));
}

/** Placeholder roster for the external Stage 2 Play-in entries. */
export function demoChallengerTeams(region: RegionId): Team[] {
  const isChina = region === "china";
  const label = isChina ? "国家杯" : "Challengers";
  const shortLabel = isChina ? "NC" : "CH";
  return Array.from({ length: isChina ? 2 : 4 }, (_, index) => ({
    id: `${region}-${isChina ? "national-cup" : "challenger"}-${index + 1}`,
    region,
    name: `${regionNames[region]} ${label} 待录入队伍 ${String(index + 1).padStart(2, "0")}`,
    shortName: `${regionNames[region]}-${shortLabel}-${index + 1}`,
    color: regions.find((item) => item.id === region)?.color ?? "#90a4ae",
    active: true,
    country: "",
  }));
}

export function allDemoChallengerTeams(): Team[] {
  return regions.flatMap(({ id }) => demoChallengerTeams(id));
}

export function demoSimulation(region: RegionId): RegionSimulationInput {
  const teams = demoTeams(region).slice(0, 8).map((team, index) => ({
    id: team.id,
    name: team.name,
    basePoints: 30 - index * 2,
    metrics: {
      stage2Finish: index + 1,
      masters2Finish: index + 1,
      stage1Finish: index + 1,
      masters1Finish: index + 1,
      kickoffFinish: index + 1,
      regularSeasonWins: 8 - index,
      mapDiff: 4 - index,
      roundDiff: 20 - index * 5,
      headToHeadWins: 0,
      headToHeadMapDiff: 0,
      headToHeadRoundDiff: 0,
    },
  }));
  return {
    region,
    teams,
    directQualifiers: [teams[0].id, teams[1].id],
    matches: [
      { id: `${region}-play-in-1`, teamA: teams[2].id, teamB: teams[3].id, winnerPoints: 2 },
      { id: `${region}-play-in-2`, teamA: teams[4].id, teamB: teams[5].id, winnerPoints: 2 },
      { id: `${region}-play-in-3`, teamA: teams[6].id, teamB: teams[7].id, winnerPoints: 2 },
    ],
  };
}

export function demoAnalyses(): RegionAnalysis[] {
  return regions.map(({ id }) => enumerateRegion(demoSimulation(id)));
}
