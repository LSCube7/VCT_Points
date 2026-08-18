import { ENGINE_VERSION, compareRankingMetrics } from "../rules";
import { sortByDescending } from "../sorting";
import type {
  ExactProbability,
  QualificationMethod,
  RegionAnalysis,
  RegionSimulationInput,
  ScenarioGroup,
  SimulationMatch,
  SimulationTeam,
  TeamProbability,
} from "../types";

export interface CountedScenario {
  count: bigint;
  methods: Record<string, QualificationMethod>;
  stage2Placements: Record<string, number>;
  representativeResults: Record<string, string>;
}

function probability(numerator: bigint, denominator: bigint): ExactProbability {
  return {
    numerator: numerator.toString(),
    denominator: denominator.toString(),
    percentage: denominator === 0n ? 0 : Number((numerator * 1000000n) / denominator) / 10000,
  };
}

export function rankTeams(teams: SimulationTeam[], points: Map<string, number>): SimulationTeam[] {
  return teams.slice().sort((left, right) => {
    const pointsResult = (points.get(right.id) ?? 0) - (points.get(left.id) ?? 0);
    if (pointsResult !== 0) return pointsResult;
    return compareRankingMetrics(left.metrics, right.metrics, false) || left.id.localeCompare(right.id);
  });
}

function getPendingCount(matches: SimulationMatch[]): number {
  return matches.filter((match) => !match.winner).length;
}

function scenarioKey(qualifiers: string[], methods: Record<string, QualificationMethod>, stage2Placements: Record<string, number>): string {
  return qualifiers
    .slice()
    .sort()
    .map((teamId) => `${teamId}:${methods[teamId]}:${stage2Placements[teamId] ?? ""}`)
    .join("|");
}

export function championshipPointEligibleTeams(teams: SimulationTeam[], eligibleTeamIds?: string[]): SimulationTeam[] {
  if (!eligibleTeamIds) return teams;
  const eligible = new Set(eligibleTeamIds);
  return teams.filter((team) => eligible.has(team.id));
}

export function addScenarioMaps(
  target: Map<string, CountedScenario>,
  source: Map<string, CountedScenario>,
): void {
  for (const [key, value] of source) {
    const existing = target.get(key);
    if (existing) {
      existing.count += value.count;
    } else {
      target.set(key, {
        ...value,
        stage2Placements: { ...value.stage2Placements },
        representativeResults: { ...value.representativeResults },
      });
    }
  }
}

function calculateFinalScenario(
  input: RegionSimulationInput,
  points: Map<string, number>,
  representativeResults: Record<string, string>,
): Map<string, CountedScenario> {
  const direct = new Set(input.directQualifiers);
  const pointsQualifiers = rankTeams(
    championshipPointEligibleTeams(input.teams, input.championshipPointEligibleTeamIds)
      .filter((team) => !direct.has(team.id)),
    points,
  ).slice(0, 2);
  const qualifiers = [...input.directQualifiers, ...pointsQualifiers.map((team) => team.id)];
  const stage2Placements = Object.fromEntries([
    ...input.directQualifiers.map((teamId, index) => [teamId, index + 1] as const),
    ...pointsQualifiers.map((team, index) => [team.id, index + 3] as const),
  ]);
  const methods: Record<string, QualificationMethod> = {
    [input.directQualifiers[0]]: "stage2-winner",
    [input.directQualifiers[1]]: "stage2-runner-up",
  };
  for (const team of pointsQualifiers) methods[team.id] = "championship-points";
  const key = scenarioKey(qualifiers, methods, stage2Placements);
  return new Map([[key, { count: 1n, methods, stage2Placements, representativeResults }]]);
}

function pointsForMatches(input: RegionSimulationInput, matches: SimulationMatch[]): Map<string, number> {
  const points = new Map(input.teams.map((team) => [team.id, team.basePoints]));
  for (const match of matches) {
    if (!match.winner) continue;
    points.set(match.winner, (points.get(match.winner) ?? 0) + match.winnerPoints);
  }
  return points;
}

export function buildRegionAnalysis(
  input: RegionSimulationInput,
  scenarios: Map<string, CountedScenario>,
  totalOutcomes: bigint,
): RegionAnalysis {
  const scenarioGroups: ScenarioGroup[] = sortByDescending([...scenarios.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value], index) => {
      const qualifiers = key.split("|").filter(Boolean).map((part) => part.split(":")[0]);
      return {
        id: `${input.region}-scenario-${index + 1}`,
        region: input.region,
        qualifiers,
        stage2Placements: value.stage2Placements,
        methods: value.methods,
        probability: probability(value.count, totalOutcomes),
        outcomeCount: value.count.toString(),
        representativeResults: value.representativeResults,
      };
    }), (scenario) => scenario.probability.percentage, (scenario) => scenario.id);

  const teamProbabilities: TeamProbability[] = sortByDescending(input.teams.map((team) => {
    const groups = scenarioGroups.filter((scenario) => scenario.qualifiers.includes(team.id));
    const methods = Object.fromEntries(
      (["stage2-winner", "stage2-runner-up", "championship-points"] as QualificationMethod[]).map((method) => [
        method,
        probability(
          groups.reduce((total, group) => total + (group.methods[team.id] === method ? BigInt(group.outcomeCount) : 0n), 0n),
          totalOutcomes,
        ),
      ]),
    ) as Record<QualificationMethod, ExactProbability>;
    const count = groups.reduce((total, group) => total + BigInt(group.outcomeCount), 0n);
    return { teamId: team.id, probability: probability(count, totalOutcomes), methods };
  }), (item) => item.probability.percentage, (item) => item.teamId);

  return {
    region: input.region,
    totalOutcomes: totalOutcomes.toString(),
    scenarioGroups,
    teamProbabilities,
    engineVersion: ENGINE_VERSION,
  };
}

/**
 * Enumerates the unplayed match graph with memoized state aggregation. This
 * keeps exact counts without retaining every leaf outcome in memory.
 */
export function enumerateRegion(input: RegionSimulationInput): RegionAnalysis {
  const pendingCount = getPendingCount(input.matches);
  const totalOutcomes = 1n << BigInt(pendingCount);
  const memo = new Map<string, Map<string, CountedScenario>>();

  function visit(index: number, matches: SimulationMatch[]): Map<string, CountedScenario> {
    const points = pointsForMatches(input, matches);
    const stateKey = `${index}|${matches.map((match) => match.winner ?? "-").join(",")}|${[...points.entries()].join(",")}`;
    const cached = memo.get(stateKey);
    if (cached) return cached;
    const nextIndex = matches.findIndex((match, currentIndex) => currentIndex >= index && !match.winner);
    if (nextIndex === -1) {
      const final = calculateFinalScenario(
        input,
        points,
        Object.fromEntries(matches.filter((match) => match.winner).map((match) => [match.id, match.winner as string])),
      );
      memo.set(stateKey, final);
      return final;
    }

    const match = matches[nextIndex];
    const aggregate = new Map<string, CountedScenario>();
    for (const winner of [match.teamA, match.teamB]) {
      const branch = matches.map((candidate, candidateIndex) =>
        candidateIndex === nextIndex ? { ...candidate, winner } : candidate,
      );
      addScenarioMaps(aggregate, visit(nextIndex + 1, branch));
    }
    memo.set(stateKey, aggregate);
    return aggregate;
  }

  const scenarios = visit(0, input.matches.map((match) => ({ ...match })));
  return buildRegionAnalysis(input, scenarios, totalOutcomes);
}
