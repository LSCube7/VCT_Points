import type { MatchResult } from "./types";

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
): string | undefined {
  const isWinnerReference = reference.startsWith("winner:");
  const isLoserReference = reference.startsWith("loser:");
  if (!isWinnerReference && !isLoserReference) {
    return reference.startsWith("seed:") ? undefined : reference;
  }

  const sourceMatchId = reference.slice(reference.indexOf(":") + 1);
  if (!sourceMatchId || visited.has(sourceMatchId)) return undefined;
  const sourceMatch = matchesById.get(sourceMatchId);
  if (!sourceMatch?.winner) return undefined;

  const nextVisited = new Set(visited);
  nextVisited.add(sourceMatchId);
  const resolvedWinner = resolveBracketParticipant(sourceMatch.winner, matchesById, nextVisited);
  if (!resolvedWinner) return undefined;
  if (isWinnerReference) return resolvedWinner;

  const resolvedTeamA = resolveBracketParticipant(sourceMatch.teamA, matchesById, nextVisited);
  const resolvedTeamB = resolveBracketParticipant(sourceMatch.teamB, matchesById, nextVisited);
  if (!resolvedTeamA || !resolvedTeamB) return undefined;
  if (resolvedWinner === resolvedTeamA) return resolvedTeamB;
  if (resolvedWinner === resolvedTeamB) return resolvedTeamA;
  return undefined;
}
