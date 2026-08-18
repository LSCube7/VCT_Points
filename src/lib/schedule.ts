import type {
  BracketConfig,
  DraftPayload,
  GroupConfig,
  MatchPhase,
  MatchRegion,
  MatchResult,
  RegionId,
  Team,
  GroupTeamRecord,
  TournamentConfig,
  TournamentFormat,
  TournamentScope,
  Stage2PlayInGroupOrder,
} from "./types";
import { REGION_IDS } from "./types";
import {
  calculateMastersAllocations,
  mastersDirectParticipantRefs,
  mastersQualificationRef,
  mastersSwissParticipantRefs,
  type MastersEventId,
} from "./masters";

export const MAP_POOL = [
  "Abyss",
  "Bind",
  "Breeze",
  "Corrode",
  "Haven",
  "Pearl",
  "Split",
] as const;

export interface EventTemplate {
  id: string;
  label: string;
  stage: MatchResult["stage"];
  scope: TournamentScope;
  format: TournamentFormat;
  defaultPhase: MatchPhase;
  defaultBestOf: 3 | 5;
}

export const EVENT_TEMPLATES: readonly EventTemplate[] = [
  { id: "kickoff", label: "Kickoff", stage: "kickoff", scope: "regional", format: "triple-elimination", defaultPhase: "playoffs", defaultBestOf: 3 },
  { id: "masters-1", label: "Masters Santiago", stage: "masters-1", scope: "international", format: "swiss-plus-playoffs", defaultPhase: "swiss", defaultBestOf: 3 },
  { id: "stage-1", label: "Stage 1", stage: "stage-1", scope: "regional", format: "group-plus-playoffs", defaultPhase: "group", defaultBestOf: 3 },
  { id: "masters-2", label: "Masters London", stage: "masters-2", scope: "international", format: "swiss-plus-playoffs", defaultPhase: "swiss", defaultBestOf: 3 },
  { id: "stage-2", label: "Stage 2", stage: "stage-2", scope: "regional", format: "group-plus-playoffs", defaultPhase: "group", defaultBestOf: 3 },
];

export const eventTemplate = (eventId: string) => EVENT_TEMPLATES.find((event) => event.id === eventId) ?? EVENT_TEMPLATES[0];

function groupConfigs(teamIds: string[]): GroupConfig[] {
  const split = Math.ceil(teamIds.length / 2);
  return [
    { id: "alpha", name: "Alpha", teamIds: teamIds.slice(0, split) },
    { id: "omega", name: "Omega", teamIds: teamIds.slice(split) },
  ].filter((group) => group.teamIds.length > 0);
}

function bracketConfig(type: BracketConfig["type"], teamRefs: string[]): BracketConfig {
  return { type, startRound: "quarterfinals", teamRefs };
}

function tripleSeedSlots(teamRefs: string[] = []): string[] {
  return Array.from({ length: 12 }, (_, index) => teamRefs[index] || `seed:${index + 1}`);
}

function isMastersPlayoffMatch(match: Pick<MatchResult, "eventId" | "region" | "id">): boolean {
  return (match.eventId === "masters-1" || match.eventId === "masters-2")
    && match.region === "global"
    && match.id.includes("-playoffs-");
}

function inferMatchPhase(match: MatchResult): MatchPhase {
  if (isMastersPlayoffMatch(match)) return "playoffs";
  if (match.phase) return match.phase;
  if (match.bracketRound || match.roundLabel?.includes("淘汰赛") || /-r1-\d+$/.test(match.id)) return "playoffs";
  if (match.groupId || match.isRegularSeason) return "group";
  return match.region === "global" ? "swiss" : "group";
}

function normalizeDraftMatch(match: MatchResult): MatchResult {
  const phase = inferMatchPhase(match);
  return match.phase === phase ? match : { ...match, phase };
}

function isLegacyMastersSwissMatch(match: MatchResult): boolean {
  return (match.eventId === "masters-1" || match.eventId === "masters-2")
    && match.region === "global"
    && !isMastersPlayoffMatch(match)
    && (match.phase === "swiss" || match.id.includes("-swiss-"));
}

function isRegionalStagePlayoffMatch(match: MatchResult): boolean {
  return (match.eventId === "stage-1" || match.eventId === "stage-2")
    && match.phase === "playoffs"
    && match.region !== "global";
}

function hasRecordedMatchResult(match: MatchResult): boolean {
  return match.status !== "scheduled"
    || Boolean(match.winner)
    || match.maps.length > 0
    || Boolean(match.playedAt)
    || Boolean(match.notes);
}

function regionalStageMatchOrder(match: MatchResult): number {
  const result = match.id.match(/-r1-(\d+)$/);
  return result ? Number(result[1]) : Number.MAX_SAFE_INTEGER;
}

function isCurrentRegionalStagePlayoffSchedule(existing: MatchResult[], generated: MatchResult[]): boolean {
  if (existing.length !== generated.length) return false;
  const existingIds = new Set(existing.map((match) => match.id));
  return generated.every((match) => existingIds.has(match.id));
}

function regionalStageEntrySlots(generated: MatchResult[], region: RegionId): Array<{ id: string; side: "teamA" | "teamB" }> {
  if (region === "china") {
    return generated
      .filter((match) => match.bracketRound === "Upper Bracket Quarterfinal")
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
      .flatMap((match) => [{ id: match.id, side: "teamA" as const }, { id: match.id, side: "teamB" as const }]);
  }
  const mainMatches = generated.filter((match) => !match.id.includes("-play-in-"));
  return [
    ["ub-r1-1", "teamA"], ["ub-r1-1", "teamB"],
    ["ub-r1-2", "teamA"], ["ub-r1-2", "teamB"],
    ["ub-sf-1", "teamA"], ["ub-sf-2", "teamA"],
    ["lb-r1-1", "teamB"], ["lb-r1-2", "teamB"],
  ].map(([suffix, side]) => ({ id: mainMatches.find((match) => match.id.endsWith(`-${suffix}`))?.id ?? suffix, side: side as "teamA" | "teamB" }));
}

function migrateLegacyRegionalStagePlayoffs(matches: MatchResult[], generatedMatches: MatchResult[], teams?: Team[]): MatchResult[] {
  let next = [...matches];
  const knownTeamIds = teams ? new Set(teams.map((team) => team.id)) : undefined;
  const isConcreteTeamId = (value: string) => knownTeamIds
    ? knownTeamIds.has(value)
    : !/^(winner|loser|seed|qualified|swiss|pending):/.test(value);

  for (const eventId of ["stage-1", "stage-2"] as const) {
    for (const region of REGION_IDS) {
      const existing = next.filter((match) => isRegionalStagePlayoffMatch(match) && match.eventId === eventId && match.region === region);
      const generated = generatedMatches.filter((match) => isRegionalStagePlayoffMatch(match) && match.eventId === eventId && match.region === region);
      if (existing.length === 0 || generated.length === 0 || isCurrentRegionalStagePlayoffSchedule(existing, generated)) continue;

      // A legacy draft may contain four generic R1 matches. Regenerate the
      // graph only while those matches are still empty; completed results must
      // not be silently reassigned to a different bracket structure.
      if (existing.some(hasRecordedMatchResult)) continue;
      const legacyTeamIds = existing
        .sort((left, right) => regionalStageMatchOrder(left) - regionalStageMatchOrder(right))
        .flatMap((match) => [match.teamA, match.teamB])
        .filter(isConcreteTeamId);
      const migratedById = new Map(generated.map((match) => [match.id, match]));
      regionalStageEntrySlots(generated, region).forEach(({ id, side }, index) => {
        const teamId = legacyTeamIds[index];
        const match = migratedById.get(id);
        if (!teamId || !match) return;
        migratedById.set(id, { ...match, [side]: teamId });
      });
      const legacyIds = new Set(existing.map((match) => match.id));
      next = [...next.filter((match) => !legacyIds.has(match.id)), ...generated.map((match) => migratedById.get(match.id) ?? match)];
    }
  }
  return next;
}

function migrateRegionalStageLowerQuarterfinals(matches: MatchResult[], generatedMatches: MatchResult[]): MatchResult[] {
  let next = [...matches];
  for (const eventId of ["stage-1", "stage-2"] as const) {
    for (const region of ["amer", "emea", "pacific"] as RegionId[]) {
      const generated = generatedMatches.filter((match) => isRegionalStagePlayoffMatch(match) && match.eventId === eventId && match.region === region);
      const expectedById = new Map(generated.filter((match) => match.bracketRound === "Lower Bracket Quarterfinal").map((match) => [match.id, match]));
      const currentById = new Map(next.filter((match) => isRegionalStagePlayoffMatch(match) && match.eventId === eventId && match.region === region).map((match) => [match.id, match]));
      const updates = [...expectedById.entries()].filter(([id, expected]) => {
        const current = currentById.get(id);
        return current
          && (current.teamA !== expected.teamA || current.teamB !== expected.teamB)
          && !hasRecordedMatchResult(current);
      });
      if (updates.length === 0) continue;
      const updateById = new Map(updates);
      next = next.map((match) => {
        const expected = updateById.get(match.id);
        return expected ? { ...match, teamA: expected.teamA, teamB: expected.teamB } : match;
      });
    }
  }
  return next;
}

function isStage2ScheduleReference(ref: string): boolean {
  return ref.startsWith("stage2-group:")
    || ref.startsWith("stage2-challenger:")
    || ref.startsWith("stage2-national-cup:")
    || ref.startsWith("winner:")
    || ref.startsWith("loser:");
}

function migrateStage2InternationalPlayInBracket(matches: MatchResult[], generatedMatches: MatchResult[]): MatchResult[] {
  let next = [...matches];
  for (const region of ["amer", "emea", "pacific"] as RegionId[]) {
    const generatedStage2 = generatedMatches.filter((match) => match.eventId === "stage-2" && match.region === region && match.phase === "playoffs");
    const currentById = new Map(next.filter((match) => match.eventId === "stage-2" && match.region === region && match.phase === "playoffs").map((match) => [match.id, match]));
    const mismatched = generatedStage2
      .map((expected) => ({ expected, current: currentById.get(expected.id) }))
      .filter(({ expected, current }) => current && (
        (isStage2ScheduleReference(current.teamA) && current.teamA !== expected.teamA)
        || (isStage2ScheduleReference(current.teamB) && current.teamB !== expected.teamB)
      ));
    if (mismatched.length === 0) continue;
    const expectedById = new Map(mismatched.map(({ expected }) => [expected.id, expected]));
    next = next.map((match) => {
      const expected = expectedById.get(match.id);
      if (!expected) return match;
      const nextTeamA = isStage2ScheduleReference(match.teamA) ? expected.teamA : match.teamA;
      const nextTeamB = isStage2ScheduleReference(match.teamB) ? expected.teamB : match.teamB;
      const participantsChanged = match.teamA !== nextTeamA || match.teamB !== nextTeamB;
      const resetResult = hasRecordedMatchResult(match);
      return {
        ...match,
        teamA: nextTeamA,
        teamB: nextTeamB,
        phase: expected.phase,
        bracketRound: expected.bracketRound,
        roundLabel: expected.roundLabel,
        bestOf: expected.bestOf,
        ...(participantsChanged && resetResult ? {
          status: "scheduled" as const,
          winner: undefined,
          maps: [],
          playedAt: undefined,
          notes: undefined,
        } : {}),
      };
    });
  }
  return next;
}

function isChinaStage2PlayInPlacementRef(ref: string): boolean {
  return /^(?:winner|loser):china-stage-2-play-in-(?:ub-r3-[12]|lb-r3-[12]|ub-r4-1|lb-r4-1)$/.test(ref);
}

function migrateStage2ChinaPlayInBracket(matches: MatchResult[], generatedMatches: MatchResult[]): MatchResult[] {
  const obsoleteIds = new Set([
    "china-stage-2-play-in-ub-r4-1",
    "china-stage-2-play-in-lb-r4-1",
  ]);
  let next = matches.filter((match) => !obsoleteIds.has(match.id));
  const expectedById = new Map(
    generatedMatches
      .filter((match) => /^china-stage-2-play-in-lb-r[23]-\d+$/.test(match.id) || /^china-stage-2-ub-qf-\d+$/.test(match.id))
      .map((match) => [match.id, match]),
  );
  if (expectedById.size === 0) return next;

  return next.map((match) => {
    const expected = expectedById.get(match.id);
    if (!expected) return match;
    const isMainQuarterfinal = /^china-stage-2-ub-qf-\d+$/.test(match.id);
    const nextTeamA = isMainQuarterfinal ? match.teamA : expected.teamA;
    const nextTeamB = isMainQuarterfinal && !isChinaStage2PlayInPlacementRef(match.teamB) ? match.teamB : expected.teamB;
    const participantsChanged = match.teamA !== nextTeamA || match.teamB !== nextTeamB;
    const metadataChanged = match.bracketRound !== expected.bracketRound
      || match.roundLabel !== expected.roundLabel
      || match.bestOf !== expected.bestOf;
    if (!participantsChanged && !metadataChanged) return match;
    const resetResult = participantsChanged && hasRecordedMatchResult(match);
    return {
      ...match,
      teamA: nextTeamA,
      teamB: nextTeamB,
      phase: expected.phase,
      bracketRound: expected.bracketRound,
      roundLabel: expected.roundLabel,
      bestOf: expected.bestOf,
      ...(resetResult ? {
        status: "scheduled" as const,
        winner: undefined,
        maps: [],
        playedAt: undefined,
        notes: undefined,
      } : {}),
    };
  });
}

function restoreMissingMastersMatches(matches: MatchResult[], generatedMatches: MatchResult[]): MatchResult[] {
  const generatedMasters = generatedMatches.filter((match) => isMastersPlayoffMatch(match));
  if (generatedMasters.length === 0) return matches;
  const generatedIds = new Set(generatedMasters.map((match) => match.id));
  const existingById = new Map(matches.filter((match) => generatedIds.has(match.id)).map((match) => [match.id, match]));
  const restoredMasters = generatedMasters.map((match) => existingById.get(match.id) ?? match);
  const firstMastersIndex = matches.findIndex((match) => generatedIds.has(match.id));
  if (firstMastersIndex < 0) return [...matches, ...restoredMasters];
  return [
    ...matches.slice(0, firstMastersIndex),
    ...restoredMasters,
    ...matches.slice(firstMastersIndex).filter((match) => !generatedIds.has(match.id)),
  ];
}

function restoreMissingRegionalStageMatches(matches: MatchResult[], generatedMatches: MatchResult[]): MatchResult[] {
  const generatedRegional = generatedMatches.filter((match) => isRegionalStagePlayoffMatch(match));
  if (generatedRegional.length === 0) return matches;
  const generatedIds = new Set(generatedRegional.map((match) => match.id));
  const existingById = new Map(matches.filter((match) => generatedIds.has(match.id)).map((match) => [match.id, match]));
  const restoredRegional = generatedRegional.map((match) => existingById.get(match.id) ?? match);
  const firstRegionalIndex = matches.findIndex((match) => generatedIds.has(match.id));
  if (firstRegionalIndex < 0) return [...matches, ...restoredRegional];
  return [
    ...matches.slice(0, firstRegionalIndex),
    ...restoredRegional,
    ...matches.slice(firstRegionalIndex).filter((match) => !generatedIds.has(match.id)),
  ];
}

/**
 * Keep older drafts usable after schedule metadata was added. Missing phase
 * metadata is inferred, and partial drafts receive missing generated Kickoff
 * and Masters playoff records/configuration without replacing saved results.
 */
export function hydrateDraftSchedule(
  generated: Pick<DraftPayload, "matches" | "tournaments">,
  draft?: Pick<DraftPayload, "matches" | "tournaments">,
  teams?: Team[],
): Pick<DraftPayload, "matches" | "tournaments"> {
  const draftMatches = draft?.matches?.length
    ? draft.matches.map(normalizeDraftMatch).filter((match) => !isLegacyMastersSwissMatch(match))
    : generated.matches;
  const migratedRegionalStageMatches = migrateLegacyRegionalStagePlayoffs(draftMatches, generated.matches, teams);
  const matchesWithRegionalStageMigration = migrateRegionalStageLowerQuarterfinals(migratedRegionalStageMatches, generated.matches);
  const matchesWithStage2PlayInMigration = migrateStage2InternationalPlayInBracket(matchesWithRegionalStageMigration, generated.matches);
  const matchesWithChinaPlayInMigration = migrateStage2ChinaPlayInBracket(matchesWithStage2PlayInMigration, generated.matches);
  const matchesWithRegionalStageMatches = restoreMissingRegionalStageMatches(matchesWithChinaPlayInMigration, generated.matches);
  const matchesWithMasters = restoreMissingMastersMatches(matchesWithRegionalStageMatches, generated.matches);
  const matches = matchesWithMasters.some((match) => match.eventId === "kickoff")
    ? matchesWithMasters
    : [...matchesWithMasters, ...generated.matches.filter((match) => match.eventId === "kickoff")];

  const draftById = new Map((draft?.tournaments ?? []).map((tournament) => [tournament.id, tournament]));
  const generatedIds = new Set(generated.tournaments.map((tournament) => tournament.id));
  const rawTournaments = [
    ...generated.tournaments.map((tournament) => {
      const draftTournament = draftById.get(tournament.id);
      if (!draftTournament) return tournament;
      return {
        ...tournament,
        ...draftTournament,
        stage2ChallengerTeamIds: draftTournament.stage2ChallengerTeamIds ?? tournament.stage2ChallengerTeamIds,
        stage2NationalCupTeamIds: draftTournament.stage2NationalCupTeamIds ?? tournament.stage2NationalCupTeamIds,
        stage2DirectPlayoffTeamIds: draftTournament.stage2DirectPlayoffTeamIds ?? tournament.stage2DirectPlayoffTeamIds,
        stage2PlayInUpperGroupOrder: draftTournament.stage2PlayInUpperGroupOrder ?? tournament.stage2PlayInUpperGroupOrder,
        stage2PlayInLowerGroupOrder: draftTournament.stage2PlayInLowerGroupOrder ?? tournament.stage2PlayInLowerGroupOrder,
      };
    }),
    ...(draft?.tournaments ?? []).filter((tournament) => !generatedIds.has(tournament.id)),
  ];
  let configuredMatches = matches;
  for (const tournament of rawTournaments) {
    const synced = syncStage2InternationalPlayoffConfiguration(configuredMatches, tournament);
    configuredMatches = synced.matches;
  }
  const tournaments = rawTournaments.map((tournament) => syncGroupRecordsWithGroups(tournament, configuredMatches));
  if (!teams) return { matches: configuredMatches, tournaments };
  const syncedTournaments = syncMastersQualificationTournaments(tournaments, configuredMatches, teams);
  return { matches: configuredMatches, tournaments: syncedTournaments };
}

/**
 * Resolve the regional scope of a tournament configuration.
 *
 * Current configs use `event-region` IDs, but drafts created by an older
 * version may use the reverse order or a generic regional ID. In the latter
 * case the existing match records are the source of truth.
 */
export function tournamentRegion(config: Pick<TournamentConfig, "id" | "eventId" | "scope">, matches: MatchResult[] = []): RegionId | undefined {
  if (config.scope !== "regional") return undefined;
  const fromId = REGION_IDS.find((region) => config.id === `${config.eventId}-${region}`
    || config.id === `${region}-${config.eventId}`
    || config.id.endsWith(`-${region}`));
  if (fromId) return fromId;
  return REGION_IDS.find((region) => matches.some((match) => match.eventId === config.eventId && match.region === region && match.phase === "playoffs"));
}

function deriveCompletedGroupRecords(config: TournamentConfig, matches: MatchResult[]): GroupTeamRecord[] {
  if (config.scope !== "regional" || config.format !== "group-plus-playoffs") return [];
  const region = tournamentRegion(config, matches);
  if (!region) return [];
  const groupMatches = matches.filter((match) => match.eventId === config.eventId
    && match.region === region
    && match.phase === "group"
    && match.isRegularSeason
    && match.groupId);
  const records: GroupTeamRecord[] = [];
  for (const group of config.groupStage?.groups ?? []) {
    const expectedMatches = (group.teamIds.length * Math.max(group.teamIds.length - 1, 0)) / 2;
    const matchesInGroup = groupMatches.filter((match) => match.groupId === group.id);
    const pairKeys = new Set(matchesInGroup.map((match) => JSON.stringify([match.teamA, match.teamB].sort())));
    if (expectedMatches === 0 || matchesInGroup.length !== expectedMatches || pairKeys.size !== expectedMatches) continue;
    if (matchesInGroup.some((match) => (match.status !== "completed" && match.status !== "forfeit") || !match.winner)) continue;
    const winsByTeam = new Map(group.teamIds.map((teamId) => [teamId, 0]));
    for (const match of matchesInGroup) {
      if (winsByTeam.has(match.winner as string)) winsByTeam.set(match.winner as string, (winsByTeam.get(match.winner as string) ?? 0) + 1);
    }
    for (const teamId of group.teamIds) {
      const wins = winsByTeam.get(teamId) ?? 0;
      records.push({ groupId: group.id, teamId, wins, losses: group.teamIds.length - 1 - wins });
    }
  }
  return records;
}

/** Keep group-stage records aligned with the current visual group configuration. */
export function syncGroupRecordsWithGroups(config: TournamentConfig, matches: MatchResult[] = []): TournamentConfig {
  if (config.format !== "group-plus-playoffs") return config;
  const groups = config.groupStage?.groups ?? [];
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const migratedRecords = config.groupRecords === undefined ? deriveCompletedGroupRecords(config, matches) : config.groupRecords;
  const seen = new Set<string>();
  const groupRecords = (migratedRecords ?? []).filter((record) => {
    const group = groupById.get(record.groupId);
    const key = `${record.groupId}:${record.teamId}`;
    if (!group || !group.teamIds.includes(record.teamId) || seen.has(key)) return false;
    const expectedMatches = Math.max(group.teamIds.length - 1, 0);
    if (record.wins < 0 || record.losses < 0 || record.wins + record.losses !== expectedMatches) return false;
    seen.add(key);
    return true;
  });
  return { ...config, groupRecords };
}

export function createTournamentConfig(template: EventTemplate, teams: Team[], region?: RegionId, challengerTeams: Team[] = []): TournamentConfig {
  const scope = template.scope;
  const mastersEventId = template.format === "swiss-plus-playoffs" ? template.id as MastersEventId : undefined;
  const mastersDirectSeeds = mastersEventId ? mastersDirectParticipantRefs(mastersEventId) : [];
  const mastersSwissParticipants = mastersEventId ? mastersSwissParticipantRefs(mastersEventId) : [];
  const teamIds = scope === "international"
    ? teams.filter((team) => team.id.endsWith("-team-1") || team.id.endsWith("-team-2") || team.id.endsWith("-team-3")).map((team) => team.id)
    : teams.filter((team) => team.region === region).map((team) => team.id);
  const groups = template.format === "swiss-plus-playoffs"
    ? [{ id: "swiss", name: "Swiss Stage", teamIds: mastersSwissParticipants }]
    : groupConfigs(teamIds);
  const stage2ExternalTeamIds = template.id === "stage-2" && region
    ? challengerTeams.filter((team) => team.region === region).slice(0, region === "china" ? 2 : 4).map((team) => team.id)
    : undefined;
  const stage2ChallengerTeamIds = template.id === "stage-2" && region && region !== "china"
    ? stage2ExternalTeamIds
    : undefined;
  const stage2NationalCupTeamIds = template.id === "stage-2" && region === "china"
    ? stage2ExternalTeamIds
    : undefined;
  return {
    id: `${template.id}-${scope === "international" ? "global" : region ?? "regional"}`,
    eventId: template.id,
    name: template.label,
    scope,
    format: template.format,
    groupStage: { groups, bestOf: template.defaultBestOf },
    bracket: {
      ...bracketConfig(template.format === "triple-elimination" ? "triple-elimination" : "double-elimination", template.format === "swiss-plus-playoffs" ? [
        ...mastersDirectSeeds.map((teamId) => `seed:${teamId}`),
        ...Array.from({ length: 4 }, (_, index) => `swiss-pending:${template.id}:${index + 1}`),
      ] : template.format === "triple-elimination" ? tripleSeedSlots() : teamIds.slice(0, 8)),
    },
    stage2ChallengerTeamIds,
    stage2NationalCupTeamIds,
    groupRecords: template.format === "group-plus-playoffs" ? [] : undefined,
    swissRecords: template.format === "swiss-plus-playoffs" ? [] : undefined,
  };
}

function emptyMatch({
  id,
  event,
  region,
  stage,
  phase,
  teamA,
  teamB,
  roundLabel,
  bracketRound,
  groupId,
  bestOf,
}: {
  id: string;
  event: EventTemplate;
  region: MatchRegion;
  stage: MatchResult["stage"];
  phase: MatchPhase;
  teamA: string;
  teamB: string;
  roundLabel?: string;
  bracketRound?: string;
  groupId?: string;
  bestOf: 3 | 5;
}): MatchResult {
  return {
    id,
    eventId: event.id,
    region,
    stage,
    teamA,
    teamB,
    status: "scheduled",
    maps: [],
    isRegularSeason: phase === "group",
    isTiebreaker: false,
    phase,
    groupId,
    roundLabel,
    bracketRound,
    bestOf,
  };
}

function roundRobinMatches(event: EventTemplate, region: RegionId, teamIds: string[], groupId: string, groupName: string): MatchResult[] {
  const matches: MatchResult[] = [];
  for (let left = 0; left < teamIds.length; left += 1) {
    for (let right = left + 1; right < teamIds.length; right += 1) {
      matches.push(emptyMatch({
        id: `${region}-${event.id}-${groupId}-${left + 1}-${right + 1}`,
        event,
        region,
        stage: event.stage,
        phase: "group",
        teamA: teamIds[left],
        teamB: teamIds[right],
        groupId,
        roundLabel: `${groupName} · 常规赛`,
        bestOf: 3,
      }));
    }
  }
  return matches;
}

function groupMatchKey(groupId: string | undefined, teamA: string, teamB: string): string {
  return JSON.stringify([groupId ?? "", ...[teamA, teamB].sort()]);
}

function isGeneratedGroupMatch(match: MatchResult, eventId: string, region: RegionId): boolean {
  return match.eventId === eventId
    && match.region === region
    && match.isRegularSeason
    && !match.isTiebreaker
    && (match.phase === undefined || match.phase === "group");
}

export interface GroupScheduleRebuildResult {
  matches: MatchResult[];
  removedResults: MatchResult[];
}

/**
 * Rebuild regional round-robin matches after an administrator changes group
 * membership. Results are matched by group and unordered team pair instead of
 * by the positional match id, so changing the order inside a group does not
 * silently discard an entered result.
 */
export function rebuildRegionalGroupMatches(matches: MatchResult[], config: TournamentConfig): GroupScheduleRebuildResult {
  if (config.scope !== "regional" || config.format !== "group-plus-playoffs") return { matches, removedResults: [] };
  const region = tournamentRegion(config, matches);
  if (!region) return { matches, removedResults: [] };

  const event = eventTemplate(config.eventId);
  const previousGroupMatches = matches.filter((match) => isGeneratedGroupMatch(match, config.eventId, region));
  const previousByKey = new Map(previousGroupMatches.map((match) => [groupMatchKey(match.groupId, match.teamA, match.teamB), match]));
  const generated = (config.groupStage?.groups ?? []).flatMap((group) => roundRobinMatches(event, region, group.teamIds, group.id, group.name));
  const generatedKeys = new Set(generated.map((match) => groupMatchKey(match.groupId, match.teamA, match.teamB)));
  const removedResults = previousGroupMatches.filter((match) => !generatedKeys.has(groupMatchKey(match.groupId, match.teamA, match.teamB)) && match.status !== "scheduled" && match.status !== "cancelled");
  const rebuilt = generated.map((match) => {
    const previous = previousByKey.get(groupMatchKey(match.groupId, match.teamA, match.teamB));
    if (!previous) return match;
    return {
      ...match,
      status: previous.status,
      winner: previous.winner,
      maps: previous.maps.map((map) => ({ ...map })),
      playedAt: previous.playedAt,
      notes: previous.notes,
    };
  });
  const preservedNonGenerated = matches.filter((match) => !isGeneratedGroupMatch(match, config.eventId, region));
  return { matches: [...preservedNonGenerated, ...rebuilt], removedResults };
}

function regionalChinaBracketMatches(event: EventTemplate, region: RegionId, teamIds: string[]): MatchResult[] {
  // CN Stage 1 uses the standard eight-team double-elimination bracket:
  // every team starts in the upper quarterfinals, unlike the other regions'
  // bracket variant where two teams start in the lower bracket and two teams
  // receive upper-semifinal byes.
  const slots = teamIds.slice(0, 8);
  const matches: MatchResult[] = [];
  const prefix = `${region}-${event.id}`;
  const winnerRef = (suffix: string) => `winner:${prefix}-${suffix}`;
  const loserRef = (suffix: string) => `loser:${prefix}-${suffix}`;
  const seedRef = (index: number) => slots[index] ?? `seed:${index + 1}`;
  const add = (suffix: string, teamA: string, teamB: string, bracketRound: string, roundLabel: string, bestOf: 3 | 5 = 3) => {
    matches.push(emptyMatch({ id: `${prefix}-${suffix}`, event, region, stage: event.stage, phase: "playoffs", teamA, teamB, bracketRound, roundLabel, bestOf }));
  };

  for (let index = 0; index < 4; index += 1) {
    add(`ub-qf-${index + 1}`, seedRef(index * 2), seedRef(index * 2 + 1), "Upper Bracket Quarterfinal", "淘汰赛 · 胜者组四分之一决赛");
  }
  for (let index = 0; index < 2; index += 1) {
    add(`ub-sf-${index + 1}`, winnerRef(`ub-qf-${index * 2 + 1}`), winnerRef(`ub-qf-${index * 2 + 2}`), "Upper Bracket Semifinal", "淘汰赛 · 胜者组半决赛");
  }
  add("ub-final", winnerRef("ub-sf-1"), winnerRef("ub-sf-2"), "Upper Bracket Final", "淘汰赛 · 胜者组决赛");

  for (let index = 0; index < 2; index += 1) {
    add(`lb-r1-${index + 1}`, loserRef(`ub-qf-${index * 2 + 1}`), loserRef(`ub-qf-${index * 2 + 2}`), "Lower Bracket Round 1", "淘汰赛 · 败者组第 1 轮");
  }
  add("lb-qf-1", winnerRef("lb-r1-1"), loserRef("ub-sf-2"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add("lb-qf-2", winnerRef("lb-r1-2"), loserRef("ub-sf-1"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add("lb-sf", winnerRef("lb-qf-1"), winnerRef("lb-qf-2"), "Lower Bracket Semifinal", "淘汰赛 · 败者组半决赛");
  add("lb-final", loserRef("ub-final"), winnerRef("lb-sf"), "Lower Bracket Final", "淘汰赛 · 败者组决赛", 5);
  add("grand-final", winnerRef("ub-final"), winnerRef("lb-final"), "Grand Final", "总决赛", 5);
  return matches;
}

function stage2GroupRef(event: EventTemplate, region: RegionId, groupId: string, placement: number): string {
  return `stage2-group:${event.id}:${region}:${groupId}:${placement}`;
}

function stage2ChallengerRef(region: RegionId, index: number): string {
  return `stage2-challenger:${region}:${index}`;
}

function stage2NationalCupRef(index: number): string {
  return `stage2-national-cup:china:${index}`;
}

function stage2InternationalPlayInMatches(event: EventTemplate, region: RegionId, challengerTeamIds: string[] = []): MatchResult[] {
  const prefix = `${region}-${event.id}-play-in`;
  const winnerRef = (suffix: string) => `winner:${prefix}-${suffix}`;
  const loserRef = (suffix: string) => `loser:${prefix}-${suffix}`;
  const groupRef = (groupId: string, placement: number) => stage2GroupRef(event, region, groupId, placement);
  const challengerRef = (index: number) => challengerTeamIds[index - 1] ?? stage2ChallengerRef(region, index);
  const matches: MatchResult[] = [];
  const add = (suffix: string, teamA: string, teamB: string, bracketRound: string, bestOf: 3 | 5 = 3) => {
    matches.push(emptyMatch({
      id: `${prefix}-${suffix}`,
      event,
      region,
      stage: event.stage,
      phase: "playoffs",
      teamA,
      teamB,
      bracketRound,
      roundLabel: `Stage 2 · Play-In · ${bracketRound}`,
      bestOf,
    }));
  };

  // The four Challengers teams and the VCT teams placed fifth and sixth in
  // each group start in Upper Round 1. Group third/fourth place teams enter
  // Upper Round 2 with a bye.
  add("ub-r1-1", groupRef("omega", 6), challengerRef(1), "Play-In Upper Bracket Round 1");
  add("ub-r1-2", groupRef("alpha", 5), challengerRef(2), "Play-In Upper Bracket Round 1");
  add("ub-r1-3", groupRef("alpha", 6), challengerRef(3), "Play-In Upper Bracket Round 1");
  add("ub-r1-4", groupRef("omega", 5), challengerRef(4), "Play-In Upper Bracket Round 1");
  add("ub-r2-1", groupRef("alpha", 3), winnerRef("ub-r1-1"), "Play-In Upper Bracket Round 2");
  add("ub-r2-2", groupRef("omega", 4), winnerRef("ub-r1-2"), "Play-In Upper Bracket Round 2");
  add("ub-r2-3", groupRef("omega", 3), winnerRef("ub-r1-3"), "Play-In Upper Bracket Round 2");
  add("ub-r2-4", groupRef("alpha", 4), winnerRef("ub-r1-4"), "Play-In Upper Bracket Round 2");
  add("ub-r3-1", winnerRef("ub-r2-1"), winnerRef("ub-r2-2"), "Play-In Upper Bracket Round 3");
  add("ub-r3-2", winnerRef("ub-r2-3"), winnerRef("ub-r2-4"), "Play-In Upper Bracket Round 3");

  // Lower Round 1 pairs each first-round loser with the loser from the
  // opposite-side upper quarterfinal. The next two lower rounds keep those
  // four branches in adjacent half-brackets; both Lower Round 3 winners
  // qualify for the main Playoffs as Play-In placements three and four.
  add("lb-r1-1", loserRef("ub-r2-4"), loserRef("ub-r1-1"), "Play-In Lower Bracket Round 1");
  add("lb-r1-2", loserRef("ub-r2-3"), loserRef("ub-r1-2"), "Play-In Lower Bracket Round 1");
  add("lb-r1-3", loserRef("ub-r2-2"), loserRef("ub-r1-3"), "Play-In Lower Bracket Round 1");
  add("lb-r1-4", loserRef("ub-r2-1"), loserRef("ub-r1-4"), "Play-In Lower Bracket Round 1");
  add("lb-r2-1", winnerRef("lb-r1-1"), winnerRef("lb-r1-2"), "Play-In Lower Bracket Round 2");
  add("lb-r2-2", winnerRef("lb-r1-3"), winnerRef("lb-r1-4"), "Play-In Lower Bracket Round 2");
  add("lb-r3-1", loserRef("ub-r3-1"), winnerRef("lb-r2-1"), "Play-In Lower Bracket Round 3");
  add("lb-r3-2", loserRef("ub-r3-2"), winnerRef("lb-r2-2"), "Play-In Lower Bracket Round 3");

  return matches;
}

function regionalChinaStage2Matches(event: EventTemplate, region: RegionId, nationalCupTeamIds: string[] = []): MatchResult[] {
  const prefix = `${region}-${event.id}`;
  const playInPrefix = `${prefix}-play-in`;
  const winnerRef = (matchPrefix: string, suffix: string) => `winner:${matchPrefix}-${suffix}`;
  const loserRef = (matchPrefix: string, suffix: string) => `loser:${matchPrefix}-${suffix}`;
  const playInWinner = (suffix: string) => winnerRef(playInPrefix, suffix);
  const playInLoser = (suffix: string) => loserRef(playInPrefix, suffix);
  const playInSeed = (index: number) => stage2GroupRef(event, region, "play-in", index);
  const nationalCupRef = (index: number) => nationalCupTeamIds[index - 1] ?? stage2NationalCupRef(index);
  const directPlayoffSeed = (index: number) => stage2GroupRef(event, region, "playoff", index);
  const matches: MatchResult[] = [];
  const add = (id: string, teamA: string, teamB: string, bracketRound: string, roundLabel: string, bestOf: 3 | 5 = 3) => {
    matches.push(emptyMatch({ id, event, region, stage: event.stage, phase: "playoffs", teamA, teamB, bracketRound, roundLabel, bestOf }));
  };

  // The ten-team CN Play-In has two Upper Round 1 matches, four Upper
  // Quarterfinals and two Upper Semifinals. The two Upper Semifinal winners
  // become Playoffs seeds 5 and 6. The lower bracket has three rounds, whose
  // two winners become Playoffs seeds 7 and 8. CN does not use same-rank
  // decider matches or an additional upper/lower final.
  add(`${playInPrefix}-ub-r1-1`, playInSeed(1), nationalCupRef(1), "Play-In Upper Bracket Round 1", "Stage 2 · Play-In · 胜者组第 1 轮");
  add(`${playInPrefix}-ub-r1-2`, playInSeed(2), nationalCupRef(2), "Play-In Upper Bracket Round 1", "Stage 2 · Play-In · 胜者组第 1 轮");
  add(`${playInPrefix}-ub-r2-1`, playInWinner("ub-r1-1"), playInSeed(3), "Play-In Upper Bracket Round 2", "Stage 2 · Play-In · 胜者组第 2 轮");
  add(`${playInPrefix}-ub-r2-2`, playInSeed(4), playInSeed(5), "Play-In Upper Bracket Round 2", "Stage 2 · Play-In · 胜者组第 2 轮");
  add(`${playInPrefix}-ub-r2-3`, playInWinner("ub-r1-2"), playInSeed(6), "Play-In Upper Bracket Round 2", "Stage 2 · Play-In · 胜者组第 2 轮");
  add(`${playInPrefix}-ub-r2-4`, playInSeed(7), playInSeed(8), "Play-In Upper Bracket Round 2", "Stage 2 · Play-In · 胜者组第 2 轮");
  add(`${playInPrefix}-ub-r3-1`, playInWinner("ub-r2-1"), playInWinner("ub-r2-2"), "Play-In Upper Bracket Round 3", "Stage 2 · Play-In · 胜者组第 3 轮");
  add(`${playInPrefix}-ub-r3-2`, playInWinner("ub-r2-3"), playInWinner("ub-r2-4"), "Play-In Upper Bracket Round 3", "Stage 2 · Play-In · 胜者组第 3 轮");
  add(`${playInPrefix}-lb-r1-1`, playInLoser("ub-r1-1"), playInLoser("ub-r2-4"), "Play-In Lower Bracket Round 1", "Stage 2 · Play-In · 败者组第 1 轮");
  add(`${playInPrefix}-lb-r1-2`, playInLoser("ub-r1-2"), playInLoser("ub-r2-2"), "Play-In Lower Bracket Round 1", "Stage 2 · Play-In · 败者组第 1 轮");
  add(`${playInPrefix}-lb-r2-1`, playInLoser("ub-r2-3"), playInWinner("lb-r1-1"), "Play-In Lower Bracket Round 2", "Stage 2 · Play-In · 败者组第 2 轮");
  add(`${playInPrefix}-lb-r2-2`, playInLoser("ub-r2-1"), playInWinner("lb-r1-2"), "Play-In Lower Bracket Round 2", "Stage 2 · Play-In · 败者组第 2 轮");
  add(`${playInPrefix}-lb-r3-1`, playInLoser("ub-r3-1"), playInWinner("lb-r2-1"), "Play-In Lower Bracket Round 3", "Stage 2 · Play-In · 败者组第 3 轮");
  add(`${playInPrefix}-lb-r3-2`, playInLoser("ub-r3-2"), playInWinner("lb-r2-2"), "Play-In Lower Bracket Round 3", "Stage 2 · Play-In · 败者组第 3 轮");
  const playInPlacement = [
    playInWinner("ub-r3-1"),
    playInWinner("ub-r3-2"),
    playInWinner("lb-r3-1"),
    playInWinner("lb-r3-2"),
  ];
  for (let index = 0; index < 4; index += 1) {
    add(`${prefix}-ub-qf-${index + 1}`, directPlayoffSeed(index + 1), playInPlacement[index] ?? `seed:${index + 1}`, "Upper Bracket Quarterfinal", "淘汰赛 · 胜者组四分之一决赛");
  }
  add(`${prefix}-ub-sf-1`, winnerRef(prefix, "ub-qf-1"), winnerRef(prefix, "ub-qf-2"), "Upper Bracket Semifinal", "淘汰赛 · 胜者组半决赛");
  add(`${prefix}-ub-sf-2`, winnerRef(prefix, "ub-qf-3"), winnerRef(prefix, "ub-qf-4"), "Upper Bracket Semifinal", "淘汰赛 · 胜者组半决赛");
  add(`${prefix}-ub-final`, winnerRef(prefix, "ub-sf-1"), winnerRef(prefix, "ub-sf-2"), "Upper Bracket Final", "淘汰赛 · 胜者组决赛");
  add(`${prefix}-lb-r1-1`, loserRef(prefix, "ub-qf-1"), loserRef(prefix, "ub-qf-2"), "Lower Bracket Round 1", "淘汰赛 · 败者组第 1 轮");
  add(`${prefix}-lb-r1-2`, loserRef(prefix, "ub-qf-3"), loserRef(prefix, "ub-qf-4"), "Lower Bracket Round 1", "淘汰赛 · 败者组第 1 轮");
  add(`${prefix}-lb-qf-1`, winnerRef(prefix, "lb-r1-1"), loserRef(prefix, "ub-sf-2"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add(`${prefix}-lb-qf-2`, winnerRef(prefix, "lb-r1-2"), loserRef(prefix, "ub-sf-1"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add(`${prefix}-lb-sf`, winnerRef(prefix, "lb-qf-1"), winnerRef(prefix, "lb-qf-2"), "Lower Bracket Semifinal", "淘汰赛 · 败者组半决赛");
  add(`${prefix}-lb-final`, loserRef(prefix, "ub-final"), winnerRef(prefix, "lb-sf"), "Lower Bracket Final", "淘汰赛 · 败者组决赛", 5);
  add(`${prefix}-grand-final`, winnerRef(prefix, "ub-final"), winnerRef(prefix, "lb-final"), "Grand Final", "总决赛", 5);
  return matches;
}

function stage2PairByGroupOrder(
  first: string,
  second: string,
  order?: Stage2PlayInGroupOrder,
): [string, string] {
  return order === "alpha-first" ? [second, first] : [first, second];
}

/** Return the draw weights used by downstream Stage 2 probability consumers. */
export function stage2PlayInGroupOrderProbabilities(order?: Stage2PlayInGroupOrder): Record<Stage2PlayInGroupOrder, number> {
  if (!order) return { "alpha-first": 0.5, "omega-first": 0.5 };
  return {
    "alpha-first": order === "alpha-first" ? 1 : 0,
    "omega-first": order === "omega-first" ? 1 : 0,
  };
}

function regionalStage2Matches(
  event: EventTemplate,
  region: RegionId,
  challengerTeamIds: string[] = [],
  nationalCupTeamIds: string[] = [],
  directPlayoffTeamIds: Array<string | null> = [],
  upperGroupOrder?: Stage2PlayInGroupOrder,
  lowerGroupOrder?: Stage2PlayInGroupOrder,
): MatchResult[] {
  if (region === "china") return regionalChinaStage2Matches(event, region, nationalCupTeamIds);
  const playInMatches = stage2InternationalPlayInMatches(event, region, challengerTeamIds);
  const prefix = `${region}-${event.id}`;
  const playInPrefix = `${prefix}-play-in`;
  const winnerRef = (suffix: string) => `winner:${prefix}-${suffix}`;
  const loserRef = (suffix: string) => `loser:${prefix}-${suffix}`;
  const playInWinner = (suffix: string) => `winner:${playInPrefix}-${suffix}`;
  const groupRef = (groupId: string, placement: number) => stage2GroupRef(event, region, groupId, placement);
  const matches: MatchResult[] = [...playInMatches];
  const directRef = (index: number, groupId: string, placement: number) => directPlayoffTeamIds[index] || groupRef(groupId, placement);
  const upperPlayInRefs = stage2PairByGroupOrder(playInWinner("ub-r3-1"), playInWinner("ub-r3-2"), upperGroupOrder);
  const lowerPlayInRefs = stage2PairByGroupOrder(playInWinner("lb-r3-1"), playInWinner("lb-r3-2"), lowerGroupOrder);
  const add = (suffix: string, teamA: string, teamB: string, bracketRound: string, roundLabel: string, bestOf: 3 | 5 = 3) => {
    matches.push(emptyMatch({ id: `${prefix}-${suffix}`, event, region, stage: event.stage, phase: "playoffs", teamA, teamB, bracketRound, roundLabel, bestOf }));
  };

  add("ub-r1-1", directRef(0, "omega", 2), upperPlayInRefs[0], "Upper Bracket Round 1", "淘汰赛 · 胜者组第 1 轮");
  add("ub-r1-2", directRef(1, "alpha", 2), upperPlayInRefs[1], "Upper Bracket Round 1", "淘汰赛 · 胜者组第 1 轮");
  add("ub-sf-1", directRef(2, "alpha", 1), winnerRef("ub-r1-1"), "Upper Bracket Semifinal", "淘汰赛 · 胜者组半决赛");
  add("ub-sf-2", directRef(3, "omega", 1), winnerRef("ub-r1-2"), "Upper Bracket Semifinal", "淘汰赛 · 胜者组半决赛");
  add("lb-r1-1", loserRef("ub-r1-1"), lowerPlayInRefs[0], "Lower Bracket Round 1", "淘汰赛 · 败者组第 1 轮");
  add("lb-r1-2", loserRef("ub-r1-2"), lowerPlayInRefs[1], "Lower Bracket Round 1", "淘汰赛 · 败者组第 1 轮");
  add("lb-qf-1", loserRef("ub-sf-2"), winnerRef("lb-r1-1"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add("lb-qf-2", loserRef("ub-sf-1"), winnerRef("lb-r1-2"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add("ub-final", winnerRef("ub-sf-1"), winnerRef("ub-sf-2"), "Upper Bracket Final", "淘汰赛 · 胜者组决赛");
  add("lb-sf", winnerRef("lb-qf-1"), winnerRef("lb-qf-2"), "Lower Bracket Semifinal", "淘汰赛 · 败者组半决赛");
  add("lb-final", loserRef("ub-final"), winnerRef("lb-sf"), "Lower Bracket Final", "淘汰赛 · 败者组决赛", 5);
  add("grand-final", winnerRef("ub-final"), winnerRef("lb-final"), "Grand Final", "总决赛", 5);
  return matches;
}

/**
 * Apply persisted non-CN Stage 2 direct slots and Play-in pair order to an
 * existing draft without regenerating the whole regional schedule.
 *
 * An omitted pair order intentionally leaves the generated default in the
 * visible bracket. The configuration remains undefined so consumers that
 * calculate probabilities can treat the two Alpha/Omega assignments as a
 * 50/50 draw instead of mistaking the display order for a confirmed draw.
 */
export function syncStage2InternationalPlayoffConfiguration(
  matches: MatchResult[],
  config: TournamentConfig,
): { matches: MatchResult[]; changed: boolean } {
  if (config.eventId !== "stage-2" || config.scope !== "regional") return { matches, changed: false };
  const region = tournamentRegion(config, matches);
  if (!region || region === "china") return { matches, changed: false };

  const prefix = `${region}-stage-2`;
  const playInPrefix = `${prefix}-play-in`;
  const groupRef = (groupId: string, placement: number) => stage2GroupRef(eventTemplate("stage-2"), region, groupId, placement);
  const winnerRef = (suffix: string) => `winner:${prefix}-${suffix}`;
  const playInWinner = (suffix: string) => `winner:${playInPrefix}-${suffix}`;
  const updates = new Map<string, Partial<Pick<MatchResult, "teamA" | "teamB">>>();
  const addUpdate = (matchId: string, update: Partial<Pick<MatchResult, "teamA" | "teamB">>) => {
    updates.set(matchId, { ...updates.get(matchId), ...update });
  };

  if (config.stage2DirectPlayoffTeamIds !== undefined) {
    const directSlots = [
      { suffix: "ub-r1-1", groupId: "omega", placement: 2, index: 0 },
      { suffix: "ub-r1-2", groupId: "alpha", placement: 2, index: 1 },
      { suffix: "ub-sf-1", groupId: "alpha", placement: 1, index: 2 },
      { suffix: "ub-sf-2", groupId: "omega", placement: 1, index: 3 },
    ];
    for (const slot of directSlots) {
      addUpdate(`${prefix}-${slot.suffix}`, {
        teamA: config.stage2DirectPlayoffTeamIds[slot.index] || groupRef(slot.groupId, slot.placement),
      });
    }
  }

  // These four slots always come from Play-in. When the administrator has
  // not fixed the Alpha/Omega order yet, use the generated default ordering;
  // the probability layer will still treat that unset order as a 50/50 draw.
  // Reapplying the references also repairs legacy drafts that still contain
  // concrete VCT team IDs in these slots, which can put one team on both
  // sides of the main bracket.
  const [upperOmegaSlot, upperAlphaSlot] = stage2PairByGroupOrder(
    playInWinner("ub-r3-1"),
    playInWinner("ub-r3-2"),
    config.stage2PlayInUpperGroupOrder,
  );
  addUpdate(`${prefix}-ub-r1-1`, { teamB: upperOmegaSlot });
  addUpdate(`${prefix}-ub-r1-2`, { teamB: upperAlphaSlot });

  const [lowerOmegaSlot, lowerAlphaSlot] = stage2PairByGroupOrder(
    playInWinner("lb-r3-1"),
    playInWinner("lb-r3-2"),
    config.stage2PlayInLowerGroupOrder,
  );
  addUpdate(`${prefix}-lb-r1-1`, { teamB: lowerOmegaSlot });
  addUpdate(`${prefix}-lb-r1-2`, { teamB: lowerAlphaSlot });

  let changed = false;
  const nextMatches = matches.map((match) => {
    const update = updates.get(match.id);
    if (!update || (update.teamA === undefined && update.teamB === undefined)) return match;
    const teamA = update.teamA ?? match.teamA;
    const teamB = update.teamB ?? match.teamB;
    if (teamA === match.teamA && teamB === match.teamB) return match;
    changed = true;
    return { ...match, teamA, teamB };
  });
  return changed ? { matches: nextMatches, changed: true } : { matches, changed: false };
}

function regionalBracketMatches(event: EventTemplate, region: RegionId, teamIds: string[]): MatchResult[] {
  if (region === "china") return regionalChinaBracketMatches(event, region, teamIds);

  // AMER/EMEA/PACIFIC Stage 1 uses the modified eight-team
  // double-elimination bracket: two teams start in the lower bracket and two
  // teams receive upper-semifinal byes. The first-round participants remain
  // editable in the result-entry view so an administrator can enter the
  // official draw/seeding without relying on the roster order.
  const slots = teamIds.slice(0, 8);
  const matches: MatchResult[] = [];
  const prefix = `${region}-${event.id}`;
  const winnerRef = (suffix: string) => `winner:${prefix}-${suffix}`;
  const loserRef = (suffix: string) => `loser:${prefix}-${suffix}`;
  const seedRef = (index: number) => slots[index] ?? `seed:${index + 1}`;
  const add = (suffix: string, teamA: string, teamB: string, bracketRound: string, roundLabel: string, bestOf: 3 | 5 = 3) => {
    matches.push(emptyMatch({ id: `${prefix}-${suffix}`, event, region, stage: event.stage, phase: "playoffs", teamA, teamB, bracketRound, roundLabel, bestOf }));
  };

  add("ub-r1-1", seedRef(1), seedRef(2), "Upper Bracket Round 1", "淘汰赛 · 胜者组第 1 轮");
  add("ub-r1-2", seedRef(3), seedRef(4), "Upper Bracket Round 1", "淘汰赛 · 胜者组第 1 轮");
  add("ub-sf-1", seedRef(0), winnerRef("ub-r1-1"), "Upper Bracket Semifinal", "淘汰赛 · 胜者组半决赛");
  add("ub-sf-2", seedRef(5), winnerRef("ub-r1-2"), "Upper Bracket Semifinal", "淘汰赛 · 胜者组半决赛");
  add("lb-r1-1", loserRef("ub-r1-1"), seedRef(6), "Lower Bracket Round 1", "淘汰赛 · 败者组第 1 轮");
  add("lb-r1-2", loserRef("ub-r1-2"), seedRef(7), "Lower Bracket Round 1", "淘汰赛 · 败者组第 1 轮");
  add("lb-qf-1", loserRef("ub-sf-2"), winnerRef("lb-r1-1"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add("lb-qf-2", loserRef("ub-sf-1"), winnerRef("lb-r1-2"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add("ub-final", winnerRef("ub-sf-1"), winnerRef("ub-sf-2"), "Upper Bracket Final", "淘汰赛 · 胜者组决赛");
  add("lb-sf", winnerRef("lb-qf-1"), winnerRef("lb-qf-2"), "Lower Bracket Semifinal", "淘汰赛 · 败者组半决赛");
  add("lb-final", loserRef("ub-final"), winnerRef("lb-sf"), "Lower Bracket Final", "淘汰赛 · 败者组决赛", 5);
  add("grand-final", winnerRef("ub-final"), winnerRef("lb-final"), "Grand Final", "总决赛", 5);
  return matches;
}

function regionalTripleEliminationMatches(event: EventTemplate, region: RegionId, teamRefs: string[]): MatchResult[] {
  const prefix = `${region}-${event.id}`;
  const matches: MatchResult[] = [];
  const matchId = (suffix: string) => `${prefix}-${suffix}`;
  const winnerRef = (suffix: string) => `winner:${matchId(suffix)}`;
  const loserRef = (suffix: string) => `loser:${matchId(suffix)}`;
  const seedSlots = tripleSeedSlots(teamRefs);
  const seedRef = (index: number) => seedSlots[index];
  const addMatch = ({
    suffix,
    teamA,
    teamB,
    bracketRound,
    roundLabel,
    bestOf = 3,
  }: {
    suffix: string;
    teamA: string;
    teamB: string;
    bracketRound: string;
    roundLabel: string;
    bestOf?: 3 | 5;
  }) => {
    matches.push(emptyMatch({
      id: matchId(suffix),
      event,
      region,
      stage: event.stage,
      phase: "playoffs",
      teamA,
      teamB,
      bracketRound,
      roundLabel,
      bestOf,
    }));
  };

  // The top four seeds enter in Upper Round 2. The other eight teams start here.
  for (let index = 0; index < 4; index += 1) {
    addMatch({
      suffix: `ub-r1-${index + 1}`,
      teamA: seedSlots[4 + index * 2],
      teamB: seedSlots[5 + index * 2],
      bracketRound: "Upper Bracket Round 1",
      roundLabel: "淘汰赛 · 胜者组第 1 轮",
    });
  }
  for (let index = 0; index < 4; index += 1) {
    addMatch({
      suffix: `ub-r2-${index + 1}`,
      teamA: seedRef(index),
      teamB: winnerRef(`ub-r1-${index + 1}`),
      bracketRound: "Upper Bracket Round 2",
      roundLabel: "淘汰赛 · 胜者组第 2 轮",
    });
  }
  for (let index = 0; index < 2; index += 1) {
    addMatch({
      suffix: `ub-r3-${index + 1}`,
      teamA: winnerRef(`ub-r2-${index * 2 + 1}`),
      teamB: winnerRef(`ub-r2-${index * 2 + 2}`),
      bracketRound: "Upper Bracket Round 3",
      roundLabel: "淘汰赛 · 胜者组第 3 轮",
    });
  }
  addMatch({
    suffix: "ub-final",
    teamA: winnerRef("ub-r3-1"),
    teamB: winnerRef("ub-r3-2"),
    bracketRound: "Upper Bracket Final",
    roundLabel: "淘汰赛 · 胜者组决赛",
    bestOf: 5,
  });

  // A team with one loss moves through the middle bracket before entering Lower Round 1.
  // The UB R2 losers are crossed into the opposite MB R1 slot, matching the
  // fixed bracket lines (R1-1 vs R2-4, R1-2 vs R2-3, ...).
  for (let index = 0; index < 4; index += 1) {
    addMatch({
      suffix: `mb-r1-${index + 1}`,
      teamA: loserRef(`ub-r1-${index + 1}`),
      teamB: loserRef(`ub-r2-${4 - index}`),
      bracketRound: "Middle Bracket Round 1",
      roundLabel: "淘汰赛 · 中间败者组第 1 轮",
    });
  }
  for (let index = 0; index < 2; index += 1) {
    addMatch({
      suffix: `mb-r2-${index + 1}`,
      teamA: winnerRef(`mb-r1-${index * 2 + 1}`),
      teamB: winnerRef(`mb-r1-${index * 2 + 2}`),
      bracketRound: "Middle Bracket Round 2",
      roundLabel: "淘汰赛 · 中间败者组第 2 轮",
    });
  }
  for (let index = 0; index < 2; index += 1) {
    addMatch({
      suffix: `mb-r3-${index + 1}`,
      teamA: loserRef(`ub-r3-${index + 1}`),
      teamB: winnerRef(`mb-r2-${index + 1}`),
      bracketRound: "Middle Bracket Round 3",
      roundLabel: "淘汰赛 · 中间败者组第 3 轮",
    });
  }
  addMatch({
    suffix: "mb-r4-1",
    teamA: winnerRef("mb-r3-1"),
    teamB: winnerRef("mb-r3-2"),
    bracketRound: "Middle Bracket Round 4",
    roundLabel: "淘汰赛 · 中间败者组第 4 轮",
  });
  addMatch({
    suffix: "mb-final",
    teamA: loserRef("ub-final"),
    teamB: winnerRef("mb-r4-1"),
    bracketRound: "Middle Bracket Final",
    roundLabel: "淘汰赛 · 中间败者组决赛",
    bestOf: 5,
  });

  // The second loss sends a team to Lower Round 1; a third loss eliminates it.
  for (let index = 0; index < 2; index += 1) {
    addMatch({
      suffix: `lb-r1-${index + 1}`,
      teamA: loserRef(`mb-r1-${index * 2 + 1}`),
      teamB: loserRef(`mb-r1-${index * 2 + 2}`),
      bracketRound: "Lower Bracket Round 1",
      roundLabel: "淘汰赛 · 败者组第 1 轮",
    });
  }
  for (let index = 0; index < 2; index += 1) {
    addMatch({
      suffix: `lb-r2-${index + 1}`,
      teamA: loserRef(`mb-r2-${2 - index}`),
      teamB: winnerRef(`lb-r1-${index + 1}`),
      bracketRound: "Lower Bracket Round 2",
      roundLabel: "淘汰赛 · 败者组第 2 轮",
    });
  }
  for (let index = 0; index < 2; index += 1) {
    addMatch({
      suffix: `lb-r3-${index + 1}`,
      teamA: loserRef(`mb-r3-${index + 1}`),
      teamB: winnerRef(`lb-r2-${index + 1}`),
      bracketRound: "Lower Bracket Round 3",
      roundLabel: "淘汰赛 · 败者组第 3 轮",
    });
  }
  addMatch({
    suffix: "lb-r4-1",
    teamA: winnerRef("lb-r3-1"),
    teamB: winnerRef("lb-r3-2"),
    bracketRound: "Lower Bracket Round 4",
    roundLabel: "淘汰赛 · 败者组第 4 轮",
  });
  addMatch({
    suffix: "lb-r5-1",
    teamA: loserRef("mb-r4-1"),
    teamB: winnerRef("lb-r4-1"),
    bracketRound: "Lower Bracket Round 5",
    roundLabel: "淘汰赛 · 败者组第 5 轮",
  });
  addMatch({
    suffix: "lb-final",
    teamA: loserRef("mb-final"),
    teamB: winnerRef("lb-r5-1"),
    bracketRound: "Lower Bracket Final",
    roundLabel: "淘汰赛 · 败者组决赛",
    bestOf: 5,
  });

  return matches;
}

export function applyTripleEliminationSeedOrder(matches: MatchResult[], config: TournamentConfig): MatchResult[] {
  if (config.format !== "triple-elimination" || !config.bracket) return matches;
  const region = tournamentRegion(config, matches);
  if (!region) return matches;
  const prefix = `${region}-${config.eventId}`;
  const seedSlots = tripleSeedSlots(config.bracket.teamRefs);
  const slotUpdates = new Map<string, Pick<MatchResult, "teamA" | "teamB">>();
  for (let index = 0; index < 4; index += 1) {
    slotUpdates.set(`${prefix}-ub-r1-${index + 1}`, { teamA: seedSlots[4 + index * 2], teamB: seedSlots[5 + index * 2] });
    slotUpdates.set(`${prefix}-ub-r2-${index + 1}`, { teamA: seedSlots[index], teamB: `winner:${prefix}-ub-r1-${index + 1}` });
  }
  return matches.map((match) => {
    const update = slotUpdates.get(match.id);
    return update ? { ...match, ...update } : match;
  });
}

/** Keep the read-only global tournament metadata aligned with resolved slots. */
export function syncMastersQualificationTournaments(
  tournaments: TournamentConfig[],
  matches: MatchResult[],
  teams: Team[],
): TournamentConfig[] {
  return tournaments.map((tournament) => {
    if (tournament.scope !== "international" || (tournament.eventId !== "masters-1" && tournament.eventId !== "masters-2")) return tournament;
    const eventId = tournament.eventId as MastersEventId;
    const allocations = calculateMastersAllocations(teams, matches, eventId);
    const placementTeamIds = new Map<string, string>();
    for (const allocation of allocations) {
      allocation.teamIdsByPlacement.forEach((teamId, index) => {
        if (teamId) placementTeamIds.set(mastersQualificationRef(eventId, allocation.region, index + 1), teamId);
      });
    }
    const hydrate = (reference: string) => placementTeamIds.get(reference) ?? reference;
    const swissTeamIds = mastersSwissParticipantRefs(eventId).map(hydrate);
    const directSeedRefs = mastersDirectParticipantRefs(eventId).map((reference) => `seed:${hydrate(reference)}`);
    const swissRecords = tournament.swissRecords
      ?.map((entry) => ({ ...entry, teamId: hydrate(entry.teamId) }))
      .filter((entry) => swissTeamIds.includes(entry.teamId));
    return {
      ...tournament,
      groupStage: tournament.groupStage ? {
        ...tournament.groupStage,
        groups: tournament.groupStage.groups.map((group, index) => index === 0 ? { ...group, teamIds: swissTeamIds } : group),
      } : tournament.groupStage,
      bracket: tournament.bracket ? {
        ...tournament.bracket,
        teamRefs: [...directSeedRefs, ...tournament.bracket.teamRefs.slice(directSeedRefs.length)],
      } : tournament.bracket,
      swissRecords,
    };
  });
}

function internationalPlayoffMatches(event: EventTemplate): MatchResult[] {
  const eventId = event.id as MastersEventId;
  const directSeeds = mastersDirectParticipantRefs(eventId).map((teamId) => `seed:${teamId}`);
  const swissSeeds = Array.from({ length: 4 }, (_, index) => `swiss-pending:${event.id}:${index + 1}`);
  const bracketSlots = [...directSeeds, ...swissSeeds];
  const matches: MatchResult[] = [];
  for (let index = 0; index < 4; index += 1) {
    matches.push(emptyMatch({ id: `${event.id}-playoffs-ubqf-${index + 1}`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: bracketSlots[index] ?? `seed:${index + 1}`, teamB: bracketSlots[index + 4] ?? `swiss:${index + 1}`, bracketRound: "Upper Bracket Quarterfinal", roundLabel: "Playoffs · Upper Quarterfinal", bestOf: 3 }));
  }
  matches.push(
    emptyMatch({ id: `${event.id}-playoffs-ubsf-1`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-ubqf-1`, teamB: `winner:${event.id}-playoffs-ubqf-2`, bracketRound: "Upper Bracket Semifinal", roundLabel: "Playoffs · Upper Semifinal", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-ubsf-2`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-ubqf-3`, teamB: `winner:${event.id}-playoffs-ubqf-4`, bracketRound: "Upper Bracket Semifinal", roundLabel: "Playoffs · Upper Semifinal", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-lbr1-1`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `loser:${event.id}-playoffs-ubqf-1`, teamB: `loser:${event.id}-playoffs-ubqf-2`, bracketRound: "Lower Bracket Round 1", roundLabel: "Playoffs · Lower Round 1", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-lbr1-2`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `loser:${event.id}-playoffs-ubqf-3`, teamB: `loser:${event.id}-playoffs-ubqf-4`, bracketRound: "Lower Bracket Round 1", roundLabel: "Playoffs · Lower Round 1", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-lbr2-1`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-lbr1-1`, teamB: `loser:${event.id}-playoffs-ubsf-2`, bracketRound: "Lower Bracket Round 2", roundLabel: "Playoffs · Lower Round 2", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-lbr2-2`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-lbr1-2`, teamB: `loser:${event.id}-playoffs-ubsf-1`, bracketRound: "Lower Bracket Round 2", roundLabel: "Playoffs · Lower Round 2", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-ub-final`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-ubsf-1`, teamB: `winner:${event.id}-playoffs-ubsf-2`, bracketRound: "Upper Bracket Final", roundLabel: "Playoffs · Upper Final", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-lower-semifinal`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-lbr2-1`, teamB: `winner:${event.id}-playoffs-lbr2-2`, bracketRound: "Lower Bracket Semifinal", roundLabel: "Playoffs · Lower Semifinal", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-playoffs-lbf`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-lower-semifinal`, teamB: `loser:${event.id}-playoffs-ub-final`, bracketRound: "Lower Bracket Final", roundLabel: "Playoffs · Lower Final", bestOf: 5 }),
    emptyMatch({ id: `${event.id}-playoffs-grand-final`, event, region: "global", stage: event.stage, phase: "playoffs", teamA: `winner:${event.id}-playoffs-ub-final`, teamB: `winner:${event.id}-playoffs-lbf`, bracketRound: "Grand Final", roundLabel: "Playoffs · Grand Final", bestOf: 5 }),
  );
  return matches;
}

export function createSchedule(region: RegionId, teams: Team[], challengerTeams: Team[] = []): { matches: MatchResult[]; tournaments: TournamentConfig[] } {
  const regionalTeams = teams.filter((team) => team.region === region);
  const matches: MatchResult[] = [];
  const tournaments: TournamentConfig[] = [];
  for (const event of EVENT_TEMPLATES) {
    const config = createTournamentConfig(event, teams, region, challengerTeams);
    tournaments.push(config);
    if (event.scope === "international") {
      matches.push(...internationalPlayoffMatches(event));
      continue;
    }
    if (event.format === "group-plus-playoffs") {
      for (const group of config.groupStage?.groups ?? []) matches.push(...roundRobinMatches(event, region, group.teamIds, group.id, group.name));
    }
    const regionalTeamIds = regionalTeams.map((team) => team.id);
    matches.push(...(event.format === "triple-elimination"
      ? regionalTripleEliminationMatches(event, region, config.bracket?.teamRefs ?? [])
      : event.id === "stage-2"
        ? regionalStage2Matches(
          event,
          region,
          config.stage2ChallengerTeamIds,
          config.stage2NationalCupTeamIds,
          config.stage2DirectPlayoffTeamIds,
          config.stage2PlayInUpperGroupOrder,
          config.stage2PlayInLowerGroupOrder,
        )
        : regionalBracketMatches(event, region, regionalTeamIds)));
  }
  return { matches, tournaments };
}

export function createFullSchedule(teams: Team[], challengerTeams: Team[] = []): { matches: MatchResult[]; tournaments: TournamentConfig[] } {
  const regionalMatches: MatchResult[] = [];
  const regionalTournaments: TournamentConfig[] = [];
  for (const region of ["amer", "emea", "pacific", "china"] as RegionId[]) {
    const schedule = createSchedule(region, teams, challengerTeams);
    regionalMatches.push(...schedule.matches.filter((match) => match.region !== "global"));
    regionalTournaments.push(...schedule.tournaments.filter((tournament) => tournament.scope === "regional"));
  }
  const international = createSchedule("amer", teams, challengerTeams);
  return {
    matches: [...regionalMatches, ...international.matches.filter((match) => match.region === "global")],
    tournaments: [...regionalTournaments, ...international.tournaments.filter((tournament) => tournament.scope === "international")],
  };
}
