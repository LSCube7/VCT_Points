import { createFullSchedule } from "./schedule";
import type { DraftPayload, MatchResult, RegionId, TournamentConfig } from "./types";

export interface KickoffScheduleMigrationPreview {
  legacyRegions: RegionId[];
  blockedRegions: RegionId[];
  canMigrate: boolean;
}

const KICKOFF_REGIONS: RegionId[] = ["amer", "emea", "pacific", "china"];

function regionKickoffMatches(matches: MatchResult[], region: RegionId): MatchResult[] {
  return matches.filter((match) => match.eventId === "kickoff" && match.region === region && match.phase === "playoffs");
}

function isKickoffFirstRound(match: MatchResult): boolean {
  return match.bracketRound === "Opening Round" || match.bracketRound === "Upper Bracket Round 1";
}

function isCurrentTripleSchedule(matches: MatchResult[]): boolean {
  if (matches.length !== 30 || !matches.some((match) => match.bracketRound === "Middle Bracket Round 1")) return false;
  const firstUpperRoundMatch = matches.find((match) => match.id.endsWith("-ub-r1-1"));
  if (!firstUpperRoundMatch) return false;
  const prefix = firstUpperRoundMatch.id.slice(0, -"-ub-r1-1".length);
  const byId = new Map(matches.map((match) => [match.id, match]));
  const expectedParticipants: Record<string, [string, string]> = {
    "mb-r1-1": [`loser:${prefix}-ub-r1-1`, `loser:${prefix}-ub-r2-4`],
    "mb-r1-4": [`loser:${prefix}-ub-r1-4`, `loser:${prefix}-ub-r2-1`],
    "mb-r3-1": [`loser:${prefix}-ub-r3-1`, `winner:${prefix}-mb-r2-1`],
    "mb-final": [`loser:${prefix}-ub-final`, `winner:${prefix}-mb-r4-1`],
    "lb-r2-1": [`loser:${prefix}-mb-r2-2`, `winner:${prefix}-lb-r1-1`],
    "lb-r3-2": [`loser:${prefix}-mb-r3-2`, `winner:${prefix}-lb-r2-2`],
    "lb-r5-1": [`loser:${prefix}-mb-r4-1`, `winner:${prefix}-lb-r4-1`],
    "lb-final": [`loser:${prefix}-mb-final`, `winner:${prefix}-lb-r5-1`],
  };
  return Object.entries(expectedParticipants).every(([suffix, participants]) => {
    const match = byId.get(`${prefix}-${suffix}`);
    return match?.teamA === participants[0] && match.teamB === participants[1];
  });
}

function firstRoundNumber(match: MatchResult): number {
  const result = match.id.match(/-r1-(\d+)$/);
  return result ? Number(result[1]) : Number.MAX_SAFE_INTEGER;
}

export function inspectKickoffScheduleMigration(matches: MatchResult[]): KickoffScheduleMigrationPreview {
  const legacyRegions = KICKOFF_REGIONS.filter((region) => {
    const kickoffMatches = regionKickoffMatches(matches, region);
    return kickoffMatches.length > 0 && !isCurrentTripleSchedule(kickoffMatches);
  });
  const blockedRegions = legacyRegions.filter((region) => regionKickoffMatches(matches, region)
    .filter((match) => !isKickoffFirstRound(match))
    .some((match) => match.status !== "scheduled"));
  return { legacyRegions, blockedRegions, canMigrate: legacyRegions.length > 0 && blockedRegions.length === 0 };
}

function copyOpeningRoundResult(source: MatchResult, target: MatchResult): MatchResult {
  return {
    ...target,
    teamA: source.teamA,
    teamB: source.teamB,
    status: source.status,
    winner: source.winner,
    maps: source.maps.map((map) => ({ ...map })),
    playedAt: source.playedAt,
    notes: source.notes,
  };
}

function migrateRegionMatches(matches: MatchResult[], generatedMatches: MatchResult[], region: RegionId): MatchResult[] {
  const legacyMatches = regionKickoffMatches(matches, region);
  const legacyOpening = legacyMatches
    .filter(isKickoffFirstRound)
    .sort((left, right) => firstRoundNumber(left) - firstRoundNumber(right));
  const generatedOpening = generatedMatches
    .filter((match) => match.bracketRound === "Upper Bracket Round 1")
    .sort((left, right) => firstRoundNumber(left) - firstRoundNumber(right));
  if (legacyOpening.length !== generatedOpening.length || generatedOpening.length !== 4) {
    throw new Error(`KICKOFF_MIGRATION_OPENING_ROUND_INVALID:${region}`);
  }
  const openingResults = new Map(generatedOpening.map((match, index) => [match.id, copyOpeningRoundResult(legacyOpening[index], match)]));
  return generatedMatches.map((match) => openingResults.get(match.id) ?? match);
}

function mergeTournamentConfig(tournaments: TournamentConfig[], generated: TournamentConfig[], region: RegionId): TournamentConfig[] {
  const generatedConfig = generated.find((tournament) => tournament.id === `kickoff-${region}`);
  if (!generatedConfig) throw new Error(`KICKOFF_MIGRATION_CONFIG_MISSING:${region}`);
  let replaced = false;
  const next = tournaments.map((tournament) => {
    if (tournament.id !== generatedConfig.id) return tournament;
    replaced = true;
    return { ...tournament, format: generatedConfig.format, bracket: generatedConfig.bracket };
  });
  return replaced ? next : [...next, generatedConfig];
}

export function migrateKickoffSchedule(payload: Pick<DraftPayload, "matches" | "teams" | "tournaments">): {
  matches: MatchResult[];
  tournaments: TournamentConfig[];
  migratedRegions: RegionId[];
} {
  const preview = inspectKickoffScheduleMigration(payload.matches);
  if (!preview.canMigrate) {
    if (preview.blockedRegions.length > 0) throw new Error(`KICKOFF_MIGRATION_HAS_RESULTS:${preview.blockedRegions.join(",")}`);
    return { matches: payload.matches, tournaments: payload.tournaments, migratedRegions: [] };
  }

  const generated = createFullSchedule(payload.teams);
  const legacyRegionSet = new Set(preview.legacyRegions);
  const migratedMatches = payload.matches.filter((match) => !(match.eventId === "kickoff" && legacyRegionSet.has(match.region as RegionId)));
  for (const region of preview.legacyRegions) {
    const generatedRegionMatches = generated.matches.filter((match) => match.eventId === "kickoff" && match.region === region);
    migratedMatches.push(...migrateRegionMatches(payload.matches, generatedRegionMatches, region));
  }

  let migratedTournaments = payload.tournaments;
  for (const region of preview.legacyRegions) {
    migratedTournaments = mergeTournamentConfig(migratedTournaments, generated.tournaments, region);
  }
  return { matches: migratedMatches, tournaments: migratedTournaments, migratedRegions: preview.legacyRegions };
}
