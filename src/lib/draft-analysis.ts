import { mapAndRoundDiff, placementPoints, regularSeasonMatchPoints } from "./rules";
import type {
  MatchResult,
  BracketParticipant,
  BracketRegionSimulationInput,
  RegionId,
  SimulationTeam,
  Team,
  TeamRankingMetrics,
  TournamentConfig,
} from "./types";

// 2^22 is already over four million equiprobable branches. Keep a browser
// safety guard, but do not reject the 22-match end-of-Stage-2 drafts that are
// expected during normal operation.
const MAX_PENDING_MATCHES = 24;

export interface DraftRegionSimulation {
  input: BracketRegionSimulationInput;
  championshipPointEligibleTeamIds: string[];
  includedMatchCount: number;
  pendingMatchCount: number;
  directQualifierIds: [string, string] | null;
  directQualifierSource: "stage2-final" | "stage2-pending";
  warnings: string[];
}

interface DraftRegionSimulationSource {
  region: RegionId;
  teams: Team[];
  challengerTeams: Team[];
  matches: MatchResult[];
  tournaments: TournamentConfig[];
}

interface DraftReferenceResolver {
  resolve(reference: string, visited?: Set<string>): string | undefined;
  resolveLoser(match: MatchResult, visited?: Set<string>): string | undefined;
}

function isConcreteReference(reference: string, teamIds: Set<string>): boolean {
  return teamIds.has(reference.trim());
}

function findStage2Tournament(source: DraftRegionSimulationSource): TournamentConfig | undefined {
  return source.tournaments.find((config) => config.eventId === "stage-2"
    && config.scope === "regional"
    && (config.id.endsWith(`-${source.region}`)
      || source.matches.some((match) => match.eventId === "stage-2" && match.region === source.region)));
}

function groupPlacementTeam(
  reference: string,
  config: TournamentConfig | undefined,
  region: RegionId,
): string | undefined {
  const match = reference.match(/^stage2-group:stage-2:([^:]+):([^:]+):(\d+)$/);
  if (!match || match[1] !== region) return undefined;
  const groupId = match[2];
  const placement = Number(match[3]);
  if (!Number.isInteger(placement) || placement < 1) return undefined;
  const group = config?.groupStage?.groups.find((candidate) => candidate.id === groupId);
  if (!group || placement > group.teamIds.length) return undefined;
  const records = config?.groupRecords?.filter((record) => record.groupId === groupId);
  if (!records || records.length !== group.teamIds.length) return undefined;
  const recordByTeam = new Map(records.map((record) => [record.teamId, record]));
  if (group.teamIds.some((teamId) => !recordByTeam.has(teamId))) return undefined;
  const ranked = group.teamIds.slice().sort((left, right) => {
    const leftRecord = recordByTeam.get(left);
    const rightRecord = recordByTeam.get(right);
    return (rightRecord?.wins ?? 0) - (leftRecord?.wins ?? 0)
      || (leftRecord?.losses ?? 0) - (rightRecord?.losses ?? 0)
      || left.localeCompare(right);
  });
  return ranked[placement - 1];
}

function createReferenceResolver(
  source: DraftRegionSimulationSource,
  knownTeamIds: Set<string>,
  stage2Config: TournamentConfig | undefined,
  allMatches: MatchResult[],
): DraftReferenceResolver {
  const matchesById = new Map(allMatches.map((match) => [match.id.trim(), match]));
  const challengerIds = stage2Config?.stage2ChallengerTeamIds ?? [];
  const nationalCupIds = stage2Config?.stage2NationalCupTeamIds ?? [];

  function findMatch(reference: string): MatchResult | undefined {
    const normalizedId = reference.trim();
    return matchesById.get(normalizedId)
      ?? [...matchesById.values()].find((match) => match.id.trim() === normalizedId);
  }

  function resolve(reference: string, visited = new Set<string>()): string | undefined {
    const normalizedReference = reference.trim();
    if (isConcreteReference(normalizedReference, knownTeamIds)) return normalizedReference;

    const groupTeam = groupPlacementTeam(normalizedReference, stage2Config, source.region);
    if (groupTeam && knownTeamIds.has(groupTeam)) return groupTeam;

    const challengerMatch = normalizedReference.match(/^stage2-challenger:[^:]+:(\d+)$/);
    if (challengerMatch) {
      const teamId = challengerIds[Number(challengerMatch[1]) - 1];
      return teamId && knownTeamIds.has(teamId) ? teamId : undefined;
    }

    const nationalCupMatch = normalizedReference.match(/^stage2-national-cup:china:(\d+)$/);
    if (nationalCupMatch) {
      const teamId = nationalCupIds[Number(nationalCupMatch[1]) - 1];
      return teamId && knownTeamIds.has(teamId) ? teamId : undefined;
    }

    const seedMatch = normalizedReference.match(/^seed:(.+)$/);
    if (seedMatch) {
      const teamId = seedMatch[1].trim();
      return knownTeamIds.has(teamId) ? teamId : undefined;
    }

    const isWinnerReference = normalizedReference.startsWith("winner:");
    const isLoserReference = normalizedReference.startsWith("loser:");
    if (!isWinnerReference && !isLoserReference) return undefined;
    const matchId = normalizedReference.slice(normalizedReference.indexOf(":") + 1).trim();
    if (!matchId || visited.has(matchId)) return undefined;
    const match = findMatch(matchId);
    if (!match?.winner) return undefined;
    const nextVisited = new Set(visited);
    nextVisited.add(matchId);
    const winner = resolve(match.winner, nextVisited);
    if (!winner) return undefined;
    if (isWinnerReference) return winner;
    return resolveLoser(match, nextVisited);
  }

  function resolveLoser(match: MatchResult, visited = new Set<string>()): string | undefined {
    const winner = resolve(match.winner ?? "", visited);
    const teamA = resolve(match.teamA, visited);
    const teamB = resolve(match.teamB, visited);
    if (!winner || !teamA || !teamB || teamA === teamB) return undefined;
    if (winner === teamA) return teamB;
    if (winner === teamB) return teamA;
    return undefined;
  }

  return { resolve, resolveLoser };
}

function eventRegionMatches(source: DraftRegionSimulationSource, eventId: string): MatchResult[] {
  return source.matches.filter((match) => match.eventId === eventId
    && (match.region === source.region || match.region === "global")
    && match.status !== "cancelled");
}

function finalMatchForEvent(source: DraftRegionSimulationSource, eventId: string): MatchResult | undefined {
  const matches = eventRegionMatches(source, eventId);
  return matches.find((match) => match.bracketRound?.toLocaleLowerCase().includes("grand final"))
    ?? matches.find((match) => match.roundLabel?.toLocaleLowerCase().includes("grand final"));
}

interface HistoricalPlacementReference {
  reference: string;
  placement: number;
}

function eventMatchWithSuffix(matches: MatchResult[], suffix: string): MatchResult | undefined {
  return matches.find((match) => match.id.endsWith(suffix));
}

function historicalPlacementReferences(
  source: DraftRegionSimulationSource,
  eventId: string,
): HistoricalPlacementReference[] {
  const matches = eventRegionMatches(source, eventId);
  const references: HistoricalPlacementReference[] = [];
  const add = (suffix: string, side: "winner" | "loser", placement: number) => {
    const match = eventMatchWithSuffix(matches, suffix);
    if (match) references.push({ reference: `${side}:${match.id}`, placement });
  };

  if (eventId === "kickoff") {
    // Kickoff has three independent bracket finals. Their winners are the
    // three Masters slots in order; the Lower Final loser is fourth.
    add("-ub-final", "winner", 1);
    add("-mb-final", "winner", 2);
    add("-lb-final", "winner", 3);
    add("-lb-final", "loser", 4);
    return references;
  }

  if (eventId === "masters-1" || eventId === "masters-2") {
    add("-grand-final", "winner", 1);
    add("-grand-final", "loser", 2);
    add("-lbf", "loser", 3);
    add("-lower-semifinal", "loser", 4);
    matches
      .filter((match) => /-lbr2-\d+$/.test(match.id))
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
      .forEach((match, index) => references.push({ reference: `loser:${match.id}`, placement: 5 + index }));
    return references;
  }

  // Stage 1 and Stage 2 regional playoffs use the same top-four placement
  // structure, including the CN standard double-elimination bracket.
  add("-grand-final", "winner", 1);
  add("-grand-final", "loser", 2);
  add("-lb-final", "loser", 3);
  add("-lb-sf", "loser", 4);
  return references;
}

function knownEventPlacement(
  source: DraftRegionSimulationSource,
  teamId: string,
  eventId: string,
  resolver: DraftReferenceResolver,
): number {
  return historicalPlacementReferences(source, eventId).find((candidate) => resolver.resolve(candidate.reference) === teamId)?.placement ?? 99;
}

function basePointsForTeam(
  source: DraftRegionSimulationSource,
  teamId: string,
  resolver: DraftReferenceResolver,
): number {
  const previousPlacementPoints = (["kickoff", "masters-1", "stage-1", "masters-2"] as const).reduce((total, eventId) => {
    const placement = knownEventPlacement(source, teamId, eventId, resolver);
    return total + (placement < 99 ? placementPoints(eventId, placement) : 0);
  }, 0);
  const regularSeasonPoints = source.tournaments
    .filter((config) => config.eventId === "stage-1" || config.eventId === "stage-2")
    .filter((config) => config.scope === "regional")
    .reduce((total, config) => total + regularSeasonMatchPoints(
      source.matches.filter((match) => match.eventId === config.eventId && match.region === source.region),
      teamId,
      config.groupRecords ?? [],
    ), 0);
  return previousPlacementPoints + regularSeasonPoints;
}

function metricsForTeam(
  source: DraftRegionSimulationSource,
  teamId: string,
  resolver: DraftReferenceResolver,
): TeamRankingMetrics {
  const relevantMatches = source.matches.filter((match) => (match.region === source.region || match.region === "global") && match.status !== "scheduled");
  const mapDiff = mapAndRoundDiff(relevantMatches, teamId);
  const regularSeasonWins = source.tournaments
    .filter((config) => config.eventId === "stage-1" || config.eventId === "stage-2")
    .filter((config) => config.scope === "regional")
    .reduce((total, config) => total + regularSeasonMatchPoints(
      source.matches.filter((match) => match.eventId === config.eventId && match.region === source.region),
      teamId,
      config.groupRecords ?? [],
    ), 0);
  return {
    stage2Finish: knownEventPlacement(source, teamId, "stage-2", resolver),
    masters2Finish: knownEventPlacement(source, teamId, "masters-2", resolver),
    stage1Finish: knownEventPlacement(source, teamId, "stage-1", resolver),
    masters1Finish: knownEventPlacement(source, teamId, "masters-1", resolver),
    kickoffFinish: knownEventPlacement(source, teamId, "kickoff", resolver),
    regularSeasonWins,
    mapDiff: mapDiff.mapDiff,
    roundDiff: mapDiff.roundDiff,
    headToHeadWins: 0,
    headToHeadMapDiff: 0,
    headToHeadRoundDiff: 0,
  };
}

function bracketParticipantForReference(
  reference: string,
  resolver: DraftReferenceResolver,
  knownTeamIds: Set<string>,
  stage2MatchIds: Set<string>,
): BracketParticipant | undefined {
  const normalizedReference = reference.trim();
  if (knownTeamIds.has(normalizedReference)) return { type: "team", teamId: normalizedReference };
  const isWinnerReference = normalizedReference.startsWith("winner:");
  const isLoserReference = normalizedReference.startsWith("loser:");
  if (isWinnerReference || isLoserReference) {
    const matchId = normalizedReference.slice(normalizedReference.indexOf(":") + 1).trim();
    if (!matchId || !stage2MatchIds.has(matchId)) return undefined;
    return { type: isWinnerReference ? "winner" : "loser", matchId };
  }
  const resolved = resolver.resolve(normalizedReference);
  return resolved && knownTeamIds.has(resolved) ? { type: "team", teamId: resolved } : undefined;
}

function stage2BracketMatches(
  source: DraftRegionSimulationSource,
  resolver: DraftReferenceResolver,
  knownTeamIds: Set<string>,
): BracketRegionSimulationInput["matches"] {
  const stage2Matches = source.matches.filter((match) => match.eventId === "stage-2"
    && match.region === source.region
    && match.phase === "playoffs"
    && match.status !== "cancelled");
  const stage2MatchIds = new Set(stage2Matches.map((match) => match.id.trim()));
  return stage2Matches.map((match) => {
    const teamA = bracketParticipantForReference(match.teamA, resolver, knownTeamIds, stage2MatchIds);
    const teamB = bracketParticipantForReference(match.teamB, resolver, knownTeamIds, stage2MatchIds);
    if (!teamA || !teamB) throw new Error(`DRAFT_ANALYSIS_UNRESOLVED_ENTRY:${match.id}`);
    const winner = match.status === "scheduled" ? undefined : resolver.resolve(match.winner ?? "");
    if (match.status !== "scheduled" && !winner) throw new Error(`DRAFT_ANALYSIS_MATCH_WINNER_MISSING:${match.id}`);
    return {
      id: match.id,
      teamA,
      teamB,
      winner,
      winnerPoints: 0,
      ...(match.bracketRound ? { bracketRound: match.bracketRound } : {}),
    };
  });
}

export function buildDraftRegionSimulation(source: DraftRegionSimulationSource): DraftRegionSimulation {
  const stage2Config = findStage2Tournament(source);
  const stage2Matches = source.matches.filter((match) => match.eventId === "stage-2" && match.region === source.region && match.phase === "playoffs");
  const rawReferencedIds = new Set(stage2Matches.flatMap((match) => [match.teamA, match.teamB, match.winner ?? ""]));
  const configuredExternalIds = new Set([
    ...(stage2Config?.stage2ChallengerTeamIds ?? []),
    ...(stage2Config?.stage2NationalCupTeamIds ?? []),
  ]);
  const allTeams = [...source.teams, ...source.challengerTeams];
  const selectedTeams = allTeams.filter((team) => team.region === source.region
    && (team.active || rawReferencedIds.has(team.id) || configuredExternalIds.has(team.id)));
  if (selectedTeams.length < 2) throw new Error("DRAFT_ANALYSIS_NOT_ENOUGH_TEAMS");
  const knownTeamIds = new Set(selectedTeams.map((team) => team.id));
  // Historical Masters brackets are global: resolving a current-region
  // team's loser path may require identifying an opponent from another
  // region first. Keep the bracket input restricted to selectedTeams, but
  // let the reference resolver understand the complete draft roster.
  const resolverTeamIds = new Set(allTeams.map((team) => team.id));
  const resolver = createReferenceResolver(source, resolverTeamIds, stage2Config, source.matches);
  const vctTeamIds = new Set(source.teams.filter((team) => team.region === source.region).map((team) => team.id));
  const championshipPointEligibleTeamIds = selectedTeams.filter((team) => vctTeamIds.has(team.id)).map((team) => team.id);
  const simulationTeams = selectedTeams.map<SimulationTeam>((team) => ({
    id: team.id,
    name: team.name,
    basePoints: vctTeamIds.has(team.id) ? basePointsForTeam(source, team.id, resolver) : 0,
    metrics: metricsForTeam(source, team.id, resolver),
  }));
  const finalMatch = finalMatchForEvent(source, "stage-2");
  if (!finalMatch) throw new Error("DRAFT_ANALYSIS_STAGE2_FINAL_MISSING");
  const bracketMatches = stage2BracketMatches(source, resolver, knownTeamIds);
  const pendingMatchCount = bracketMatches.filter((match) => !match.winner).length;
  if (pendingMatchCount > MAX_PENDING_MATCHES) throw new Error(`DRAFT_ANALYSIS_TOO_MANY_PENDING_MATCHES:${pendingMatchCount}`);

  const warnings: string[] = [];
  const directQualifierIds = finalMatch.winner && resolver.resolve(finalMatch.winner) && resolver.resolveLoser(finalMatch)
    ? [resolver.resolve(finalMatch.winner) as string, resolver.resolveLoser(finalMatch) as string] as [string, string]
    : null;
  if (!directQualifierIds) warnings.push("Stage 2 总决赛尚未完成，直通位将根据总决赛胜者和败者动态计算。");
  if (pendingMatchCount === 0) warnings.push("当前草稿已确定 Stage 2 全部赛果，结果为最终确定值。");

  return {
    input: {
      region: source.region,
      teams: simulationTeams,
      directQualifiers: directQualifierIds ?? ["stage2-winner-pending", "stage2-runner-up-pending"],
      championshipPointEligibleTeamIds,
      directQualifierMatchId: finalMatch.id,
      stage2MainMatchIds: stage2Matches.filter((match) => !match.id.includes("-play-in-")).map((match) => match.id),
      matches: bracketMatches,
    },
    championshipPointEligibleTeamIds,
    includedMatchCount: bracketMatches.length,
    pendingMatchCount,
    directQualifierIds,
    directQualifierSource: directQualifierIds ? "stage2-final" : "stage2-pending",
    warnings,
  };
}

export type { DraftRegionSimulationSource };
