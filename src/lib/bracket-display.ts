import type { MatchResult } from "./types";

export type ParticipantIdentity = (reference: string) => string;

function normalizeReference(reference: string): string {
  return reference.trim();
}

function findMatchById(matchId: string, matchesById: Map<string, MatchResult>): MatchResult | undefined {
  const normalizedId = normalizeReference(matchId);
  return matchesById.get(normalizedId)
    ?? [...matchesById.values()].find((match) => normalizeReference(match.id) === normalizedId);
}

function isPendingSeedReference(reference: string): boolean {
  const seedValue = reference.slice("seed:".length);
  return !seedValue
    || /^\d+$/.test(seedValue)
    || seedValue.startsWith("qualified:")
    || seedValue.startsWith("pending:");
}

/**
 * Resolves a bracket reference to the concrete team which currently occupies
 * that slot. The stored value remains the reference (for example
 * `winner:amer-kickoff-ub-r1-1`); this helper is only for labels and controls
 * in the editor.
 */
export function resolveBracketParticipant(
  reference: string,
  matchesById: Map<string, MatchResult>,
  visited = new Set<string>(),
  identity: ParticipantIdentity = (value) => value,
): string | undefined {
  const normalizedReference = normalizeReference(reference);
  const isWinnerReference = normalizedReference.startsWith("winner:");
  const isLoserReference = normalizedReference.startsWith("loser:");
  if (!isWinnerReference && !isLoserReference) {
    if (normalizedReference.startsWith("seed:") && isPendingSeedReference(normalizedReference)) return undefined;
    return normalizedReference;
  }

  const sourceMatchId = normalizedReference.slice(normalizedReference.indexOf(":") + 1).trim();
  if (!sourceMatchId || visited.has(sourceMatchId)) return undefined;
  const sourceMatch = findMatchById(sourceMatchId, matchesById);
  if (!sourceMatch?.winner) return undefined;

  const nextVisited = new Set(visited);
  nextVisited.add(sourceMatchId);
  const resolvedWinner = resolveBracketParticipant(sourceMatch.winner, matchesById, nextVisited, identity);
  if (!resolvedWinner) return undefined;
  if (isWinnerReference) return resolvedWinner;

  const resolvedTeamA = resolveBracketParticipant(sourceMatch.teamA, matchesById, nextVisited, identity);
  const resolvedTeamB = resolveBracketParticipant(sourceMatch.teamB, matchesById, nextVisited, identity);
  if (!resolvedTeamA || !resolvedTeamB) return undefined;
  if (identity(resolvedWinner) === identity(resolvedTeamA)) return resolvedTeamB;
  if (identity(resolvedWinner) === identity(resolvedTeamB)) return resolvedTeamA;
  return undefined;
}
