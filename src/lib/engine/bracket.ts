import { addScenarioMaps, buildRegionAnalysis, rankTeams, type CountedScenario } from "./exact";
import type { BracketParticipant, BracketRegionSimulationInput, RegionAnalysis } from "../types";

interface Outcome {
  winner: string;
  loser: string;
}

function resolveParticipant(participant: BracketParticipant, outcomes: Map<string, Outcome>): string | undefined {
  if (participant.type === "team") return participant.teamId;
  const outcome = outcomes.get(participant.matchId);
  if (!outcome) return undefined;
  return participant.type === "winner" ? outcome.winner : outcome.loser;
}

function scenarioKey(qualifiers: string[], methods: Record<string, "stage2-winner" | "stage2-runner-up" | "championship-points">): string {
  return qualifiers.slice().sort().map((teamId) => `${teamId}:${methods[teamId]}`).join("|");
}

function pointsForBracket(input: BracketRegionSimulationInput, outcomes: Map<string, Outcome>): Map<string, number> {
  const points = new Map(input.teams.map((team) => [team.id, team.basePoints]));
  for (const match of input.matches) {
    const outcome = outcomes.get(match.id);
    if (!outcome) continue;
    const source = input.matches.find((candidate) => candidate.id === match.id);
    if (source) {
      points.set(outcome.winner, (points.get(outcome.winner) ?? 0) + source.winnerPoints);
      if (source.loserPoints) points.set(outcome.loser, (points.get(outcome.loser) ?? 0) + source.loserPoints);
    }
  }
  return points;
}

function finalScenario(input: BracketRegionSimulationInput, outcomes: Map<string, Outcome>): Map<string, CountedScenario> {
  const ranked = rankTeams(input.teams, pointsForBracket(input, outcomes));
  const direct = new Set(input.directQualifiers);
  const pointsQualifiers = ranked.filter((team) => !direct.has(team.id)).slice(0, 2);
  const qualifiers = [...input.directQualifiers, ...pointsQualifiers.map((team) => team.id)];
  const methods: Record<string, "stage2-winner" | "stage2-runner-up" | "championship-points"> = {
    [input.directQualifiers[0]]: "stage2-winner",
    [input.directQualifiers[1]]: "stage2-runner-up",
  };
  for (const team of pointsQualifiers) methods[team.id] = "championship-points";
  const key = scenarioKey(qualifiers, methods);
  return new Map([[key, {
    count: 1n,
    methods,
    representativeResults: Object.fromEntries([...outcomes.entries()].map(([id, outcome]) => [id, outcome.winner])),
  }]]);
}

/**
 * Resolves a winner/loser bracket graph. A match only branches once both
 * participants are known, so downstream Play-In/Playoff matches naturally
 * depend on upstream results while remaining exactly enumerable.
 */
export function enumerateBracketRegion(input: BracketRegionSimulationInput): RegionAnalysis {
  const pendingCount = input.matches.filter((match) => !match.winner).length;
  const totalOutcomes = 1n << BigInt(pendingCount);
  const memo = new Map<string, Map<string, CountedScenario>>();

  function visit(outcomes: Map<string, Outcome>): Map<string, CountedScenario> {
    const stateKey = input.matches.map((match) => outcomes.get(match.id)?.winner ?? "-").join(",");
    const cached = memo.get(stateKey);
    if (cached) return cached;
    const unresolved = input.matches.find((match) => {
      if (outcomes.has(match.id)) return false;
      return Boolean(resolveParticipant(match.teamA, outcomes) && resolveParticipant(match.teamB, outcomes));
    });
    if (!unresolved) {
      const final = finalScenario(input, outcomes);
      memo.set(stateKey, final);
      return final;
    }
    const teamA = resolveParticipant(unresolved.teamA, outcomes);
    const teamB = resolveParticipant(unresolved.teamB, outcomes);
    if (!teamA || !teamB || teamA === teamB) {
      throw new Error(`BRACKET_GRAPH_UNRESOLVABLE:${unresolved.id}`);
    }
    const aggregate = new Map<string, CountedScenario>();
    const winners = unresolved.winner ? [unresolved.winner] : [teamA, teamB];
    for (const winner of winners) {
      if (winner !== teamA && winner !== teamB) throw new Error(`BRACKET_WINNER_INVALID:${unresolved.id}`);
      const branch = new Map(outcomes);
      branch.set(unresolved.id, { winner, loser: winner === teamA ? teamB : teamA });
      addScenarioMaps(aggregate, visit(branch));
    }
    memo.set(stateKey, aggregate);
    return aggregate;
  }

  const initialOutcomes = new Map<string, Outcome>();
  let seeded = true;
  while (seeded) {
    seeded = false;
    for (const match of input.matches) {
      if (!match.winner || initialOutcomes.has(match.id)) continue;
      const teamA = resolveParticipant(match.teamA, initialOutcomes);
      const teamB = resolveParticipant(match.teamB, initialOutcomes);
      if (!teamA || !teamB) continue;
      if (match.winner !== teamA && match.winner !== teamB) throw new Error(`BRACKET_WINNER_INVALID:${match.id}`);
      initialOutcomes.set(match.id, { winner: match.winner, loser: match.winner === teamA ? teamB : teamA });
      seeded = true;
    }
  }
  if (input.matches.some((match) => Boolean(match.winner) && !initialOutcomes.has(match.id))) {
    throw new Error("BRACKET_COMPLETED_MATCH_ORDER_INVALID");
  }

  return buildRegionAnalysis({
    region: input.region,
    teams: input.teams,
    directQualifiers: input.directQualifiers,
    matches: [],
  }, visit(initialOutcomes), totalOutcomes);
}
