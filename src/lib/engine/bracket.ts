import { buildRegionAnalysis, championshipPointEligibleTeams, rankTeams, type CountedScenario } from "./exact";
import { placementPoints } from "../rules";
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

function scenarioKey(
  qualifiers: string[],
  methods: Record<string, "stage2-winner" | "stage2-runner-up" | "championship-points">,
  stage2Placements: Record<string, number>,
): string {
  return qualifiers.slice().sort().map((teamId) => `${teamId}:${methods[teamId]}:${stage2Placements[teamId] ?? ""}`).join("|");
}

function pointsForBracket(input: BracketRegionSimulationInput, outcomes: Map<string, Outcome>): Map<string, number> {
  const points = new Map(input.teams.map((team) => [team.id, team.basePoints]));
  for (const match of input.matches) {
    const outcome = outcomes.get(match.id);
    if (!outcome) continue;
    points.set(outcome.winner, (points.get(outcome.winner) ?? 0) + match.winnerPoints);
    if (match.loserPoints) points.set(outcome.loser, (points.get(outcome.loser) ?? 0) + match.loserPoints);
  }
  return points;
}

function directQualifiersForOutcome(input: BracketRegionSimulationInput, outcomes: Map<string, Outcome>): [string, string] {
  if (!input.directQualifierMatchId) return input.directQualifiers;
  const finalOutcome = outcomes.get(input.directQualifierMatchId);
  if (!finalOutcome) throw new Error(`BRACKET_FINAL_OUTCOME_MISSING:${input.directQualifierMatchId}`);
  return [finalOutcome.winner, finalOutcome.loser];
}

function stage2PlacementPoints(input: BracketRegionSimulationInput, outcomes: Map<string, Outcome>): Map<string, number> {
  const mainMatchIds = new Set(input.stage2MainMatchIds ?? []);
  if (mainMatchIds.size === 0) return new Map();
  const mainMatches = input.matches.filter((match) => mainMatchIds.has(match.id));
  const byRound = (round: string, idSuffix: string) => mainMatches.find((match) => match.bracketRound?.toLocaleLowerCase() === round.toLocaleLowerCase())
    // Older saved drafts may not contain bracketRound. Generated regional
    // Stage 2 IDs are stable, so use them as a compatibility fallback.
    ?? mainMatches.find((match) => match.id.toLocaleLowerCase().endsWith(idSuffix));
  const points = new Map<string, number>();
  const awardLoser = (round: string, placement: number) => {
    const suffix = round === "Lower Bracket Final" ? "-lb-final" : "-lb-sf";
    const match = byRound(round, suffix);
    const outcome = match ? outcomes.get(match.id) : undefined;
    if (outcome) points.set(outcome.loser, placementPoints("stage-2", placement));
  };
  const final = byRound("Grand Final", "-grand-final");
  const finalOutcome = final ? outcomes.get(final.id) : undefined;
  if (finalOutcome) {
    points.set(finalOutcome.winner, placementPoints("stage-2", 1));
    points.set(finalOutcome.loser, placementPoints("stage-2", 2));
  }
  awardLoser("Lower Bracket Final", 3);
  awardLoser("Lower Bracket Semifinal", 4);
  return points;
}

function stage2FinishForOutcome(input: BracketRegionSimulationInput, outcomes: Map<string, Outcome>): Map<string, number> {
  const mainMatchIds = new Set(input.stage2MainMatchIds ?? []);
  if (mainMatchIds.size === 0) return new Map();
  const mainMatches = input.matches.filter((match) => mainMatchIds.has(match.id));
  const matchesForRound = (round: string, idPart: string) => {
    const normalizedRound = round.toLocaleLowerCase();
    const byRound = mainMatches.filter((match) => match.bracketRound?.toLocaleLowerCase() === normalizedRound);
    return byRound.length > 0 ? byRound : mainMatches.filter((match) => match.id.toLocaleLowerCase().includes(idPart));
  };
  const finishes = new Map<string, number>();
  const assignFinal = (round: string, idPart: string, winnerPlacement: number, loserPlacement: number) => {
    const match = matchesForRound(round, idPart)[0];
    const outcome = match ? outcomes.get(match.id) : undefined;
    if (!outcome) return;
    finishes.set(outcome.winner, winnerPlacement);
    finishes.set(outcome.loser, loserPlacement);
  };
  const assignLosers = (round: string, idPart: string, placement: number) => {
    for (const match of matchesForRound(round, idPart)) {
      const outcome = outcomes.get(match.id);
      if (outcome) finishes.set(outcome.loser, placement);
    }
  };

  assignFinal("Grand Final", "-grand-final", 1, 2);
  assignLosers("Lower Bracket Final", "-lb-final", 3);
  assignLosers("Lower Bracket Semifinal", "-lb-sf", 4);
  assignLosers("Lower Bracket Quarterfinal", "-lb-qf-", 5);
  assignLosers("Lower Bracket Round 1", "-lb-r1-", 7);
  return finishes;
}

function finalScenario(input: BracketRegionSimulationInput, outcomes: Map<string, Outcome>): {
  key: string;
  methods: Record<string, "stage2-winner" | "stage2-runner-up" | "championship-points">;
  stage2Placements: Record<string, number>;
} {
  const points = pointsForBracket(input, outcomes);
  for (const [teamId, bonus] of stage2PlacementPoints(input, outcomes)) points.set(teamId, (points.get(teamId) ?? 0) + bonus);
  const directQualifiers = directQualifiersForOutcome(input, outcomes);
  const direct = new Set(directQualifiers);
  const stage2Finishes = stage2FinishForOutcome(input, outcomes);
  const rankingTeams = input.teams.map((team) => {
    const stage2Finish = stage2Finishes.get(team.id);
    return stage2Finish === undefined ? team : { ...team, metrics: { ...team.metrics, stage2Finish } };
  });
  const pointsQualifiers = rankTeams(
    championshipPointEligibleTeams(rankingTeams, input.championshipPointEligibleTeamIds)
      .filter((team) => !direct.has(team.id)),
    points,
  ).slice(0, 2);
  const qualifiers = [...directQualifiers, ...pointsQualifiers.map((team) => team.id)];
  const stage2Placements = Object.fromEntries([
    ...directQualifiers.map((teamId, index) => [teamId, index + 1] as const),
    ...pointsQualifiers.map((team, index) => [team.id, index + 3] as const),
  ]);
  const methods: Record<string, "stage2-winner" | "stage2-runner-up" | "championship-points"> = {
    [directQualifiers[0]]: "stage2-winner",
    [directQualifiers[1]]: "stage2-runner-up",
  };
  for (const team of pointsQualifiers) methods[team.id] = "championship-points";
  return { key: scenarioKey(qualifiers, methods, stage2Placements), methods, stage2Placements };
}

/**
 * Resolves a winner/loser bracket graph. A match only branches once both
 * participants are known, so downstream Play-In/Playoff matches naturally
 * depend on upstream results while remaining exactly enumerable. The search
 * keeps only the final scenario aggregate instead of caching every partial
 * state; this is important for large Stage 2 drafts with 20+ pending matches.
 */
export function enumerateBracketRegion(input: BracketRegionSimulationInput): RegionAnalysis {
  const pendingCount = input.matches.filter((match) => !match.winner).length;
  const totalOutcomes = 1n << BigInt(pendingCount);
  const scenarios = new Map<string, CountedScenario>();

  function visit(outcomes: Map<string, Outcome>): void {
    const unresolved = input.matches.find((match) => {
      if (outcomes.has(match.id)) return false;
      return Boolean(resolveParticipant(match.teamA, outcomes) && resolveParticipant(match.teamB, outcomes));
    });
    if (!unresolved) {
      const final = finalScenario(input, outcomes);
      const existing = scenarios.get(final.key);
      if (existing) {
        existing.count += 1n;
      } else {
        scenarios.set(final.key, {
          count: 1n,
          methods: final.methods,
          stage2Placements: final.stage2Placements,
          representativeResults: Object.fromEntries([...outcomes.entries()].map(([id, outcome]) => [id, outcome.winner])),
        });
      }
      return;
    }
    const teamA = resolveParticipant(unresolved.teamA, outcomes);
    const teamB = resolveParticipant(unresolved.teamB, outcomes);
    if (!teamA || !teamB || teamA === teamB) {
      throw new Error(`BRACKET_GRAPH_UNRESOLVABLE:${unresolved.id}`);
    }
    const winners = unresolved.winner ? [unresolved.winner] : [teamA, teamB];
    for (const winner of winners) {
      if (winner !== teamA && winner !== teamB) throw new Error(`BRACKET_WINNER_INVALID:${unresolved.id}`);
      outcomes.set(unresolved.id, { winner, loser: winner === teamA ? teamB : teamA });
      visit(outcomes);
      outcomes.delete(unresolved.id);
    }
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

  visit(initialOutcomes);
  return buildRegionAnalysis({
    region: input.region,
    teams: input.teams,
    directQualifiers: input.directQualifiers,
    matches: [],
  }, scenarios, totalOutcomes);
}
