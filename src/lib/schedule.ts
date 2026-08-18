import type {
  BracketConfig,
  DraftPayload,
  GroupConfig,
  MatchPhase,
  MatchRegion,
  MatchResult,
  RegionId,
  SwissRecord,
  Team,
  GroupTeamRecord,
  TournamentConfig,
  TournamentFormat,
  TournamentScope,
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

function inferMatchPhase(match: MatchResult): MatchPhase {
  if (match.phase) return match.phase;
  if (match.bracketRound) return "playoffs";
  if (match.groupId || match.isRegularSeason) return "group";
  return match.region === "global" ? "swiss" : "group";
}

function normalizeDraftMatch(match: MatchResult): MatchResult {
  const phase = match.phase ?? inferMatchPhase(match);
  return match.phase ? match : { ...match, phase };
}

function isLegacyMastersSwissMatch(match: MatchResult): boolean {
  return (match.eventId === "masters-1" || match.eventId === "masters-2")
    && match.region === "global"
    && (match.phase === "swiss" || match.id.includes("-swiss-"));
}

/**
 * Keep older drafts usable after schedule metadata was added. Missing phase
 * metadata is inferred, and a draft that predates Kickoff records receives
 * only the missing generated Kickoff records/configuration.
 */
export function hydrateDraftSchedule(
  generated: Pick<DraftPayload, "matches" | "tournaments">,
  draft?: Pick<DraftPayload, "matches" | "tournaments">,
  teams?: Team[],
): Pick<DraftPayload, "matches" | "tournaments"> {
  const draftMatches = draft?.matches?.length
    ? draft.matches.map(normalizeDraftMatch).filter((match) => !isLegacyMastersSwissMatch(match))
    : generated.matches;
  const matches = draftMatches.some((match) => match.eventId === "kickoff")
    ? draftMatches
    : [...draftMatches, ...generated.matches.filter((match) => match.eventId === "kickoff")];

  const draftById = new Map((draft?.tournaments ?? []).map((tournament) => [tournament.id, tournament]));
  const generatedIds = new Set(generated.tournaments.map((tournament) => tournament.id));
  const rawTournaments = [
    ...generated.tournaments.map((tournament) => draftById.get(tournament.id) ?? tournament),
    ...(draft?.tournaments ?? []).filter((tournament) => !generatedIds.has(tournament.id)),
  ];
  const tournaments = rawTournaments.map((tournament) => syncGroupRecordsWithGroups(tournament, matches));
  if (!teams) return { matches, tournaments };
  const syncedMatches = syncMastersQualificationMatches(matches, teams);
  const syncedTournaments = syncMastersQualificationTournaments(tournaments, syncedMatches, teams);
  return { matches: syncMastersSwissRecordMatches(syncedMatches, syncedTournaments), tournaments: syncedTournaments };
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

export function createTournamentConfig(template: EventTemplate, teams: Team[], region?: RegionId): TournamentConfig {
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

function regionalBracketMatches(event: EventTemplate, region: RegionId, teamIds: string[]): MatchResult[] {
  // Stage 1/2 use the modified eight-team double-elimination bracket from the
  // handbook: group winners receive an upper-semifinal bye, second/third
  // seeds start in upper round 1, and fourth seeds start in lower round 1.
  // The first-round participants remain editable in the result-entry view so
  // an administrator can enter the official draw/seeding without relying on
  // the roster order.
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
  add("lb-qf-1", loserRef("ub-sf-1"), winnerRef("lb-r1-1"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
  add("lb-qf-2", loserRef("ub-sf-2"), winnerRef("lb-r1-2"), "Lower Bracket Quarterfinal", "淘汰赛 · 败者组四分之一决赛");
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

function resetMatchParticipants(match: MatchResult, teamA: string, teamB: string): MatchResult {
  if (match.teamA === teamA && match.teamB === teamB) return match;
  return {
    ...match,
    teamA,
    teamB,
    status: "scheduled",
    winner: undefined,
    maps: [],
    playedAt: undefined,
    notes: undefined,
  };
}

/**
 * Rebind global Masters playoff slots after a regional result changes. Swiss
 * participants are stored on the tournament configuration, so no Swiss match
 * records are generated or rebound here.
 */
export function syncMastersQualificationMatches(matches: MatchResult[], teams: Team[]): MatchResult[] {
  let next = matches;
  for (const eventId of ["masters-1", "masters-2"] as const) {
    const allocations = calculateMastersAllocations(teams, next, eventId);
    const placementTeamIds = new Map<string, string>();
    for (const allocation of allocations) {
      allocation.teamIdsByPlacement.forEach((teamId, index) => {
        if (teamId) placementTeamIds.set(mastersQualificationRef(eventId, allocation.region, index + 1), teamId);
      });
    }
    const hydrate = (reference: string): string => placementTeamIds.get(reference) ?? reference;

    next = next.map((match) => {
      if (match.eventId !== eventId || match.region !== "global") return match;
      const playoffIndex = match.id.match(new RegExp(`^${eventId}-playoffs-ubqf-(\\d+)$`));
      if (playoffIndex) {
        const directPlacement = Number(playoffIndex[1]);
        const region = REGION_IDS[directPlacement - 1];
        if (!region) return match;
        const expected = `seed:${hydrate(mastersQualificationRef(eventId, region, 1))}`;
        return resetMatchParticipants(match, expected, match.teamB);
      }
      return match;
    });
  }
  return next;
}

const SWISS_QUALIFYING_RECORDS: readonly SwissRecord[] = ["2-0", "2-1"];

function swissParticipantIds(tournament: TournamentConfig): string[] {
  const configured = tournament.groupStage?.groups.find((group) => group.id === "swiss")?.teamIds ?? [];
  if (configured.length > 0) return [...new Set(configured)];
  if (tournament.eventId === "masters-1" || tournament.eventId === "masters-2") {
    return mastersSwissParticipantRefs(tournament.eventId);
  }
  return [];
}

/**
 * Replace the four Swiss qualification placeholders once every team has a
 * final 2-0/2-1/1-2/0-2 record. Partial records deliberately keep the
 * placeholders so an unfinished draft cannot be mistaken for a completed
 * qualification list.
 */
export function syncMastersSwissRecordMatches(matches: MatchResult[], tournaments: TournamentConfig[]): MatchResult[] {
  let next = matches;
  for (const tournament of tournaments) {
    if (tournament.scope !== "international" || tournament.format !== "swiss-plus-playoffs") continue;
    const participantIds = swissParticipantIds(tournament);
    const recordsByTeam = new Map((tournament.swissRecords ?? []).map((entry) => [entry.teamId, entry.record]));
    const complete = participantIds.length === 8 && participantIds.every((teamId) => recordsByTeam.has(teamId));
    const qualified = complete
      ? participantIds.filter((teamId) => SWISS_QUALIFYING_RECORDS.includes(recordsByTeam.get(teamId) as SwissRecord))
      : [];
    const playoffMatches = next
      .filter((match) => match.eventId === tournament.eventId && match.id.match(new RegExp(`^${tournament.eventId}-playoffs-ubqf-\\d+$`)))
      .sort((left, right) => Number(left.id.match(/(\d+)$/)?.[1] ?? 0) - Number(right.id.match(/(\d+)$/)?.[1] ?? 0));
    if (playoffMatches.length !== 4) continue;
    const participants = qualified.length === 4
      ? qualified
      : playoffMatches.map((_, index) => `swiss-pending:${tournament.eventId}:${index + 1}`);
    const participantByMatch = new Map(playoffMatches.map((match, index) => [match.id, participants[index]]));
    next = next.map((match) => {
      const teamB = participantByMatch.get(match.id);
      return teamB ? resetMatchParticipants(match, match.teamA, teamB) : match;
    });
  }
  return next;
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

export function createSchedule(region: RegionId, teams: Team[]): { matches: MatchResult[]; tournaments: TournamentConfig[] } {
  const regionalTeams = teams.filter((team) => team.region === region);
  const matches: MatchResult[] = [];
  const tournaments: TournamentConfig[] = [];
  for (const event of EVENT_TEMPLATES) {
    const config = createTournamentConfig(event, teams, region);
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
      : regionalBracketMatches(event, region, regionalTeamIds)));
  }
  return { matches, tournaments };
}

export function createFullSchedule(teams: Team[]): { matches: MatchResult[]; tournaments: TournamentConfig[] } {
  const regionalMatches: MatchResult[] = [];
  const regionalTournaments: TournamentConfig[] = [];
  for (const region of ["amer", "emea", "pacific", "china"] as RegionId[]) {
    const schedule = createSchedule(region, teams);
    regionalMatches.push(...schedule.matches.filter((match) => match.region !== "global"));
    regionalTournaments.push(...schedule.tournaments.filter((tournament) => tournament.scope === "regional"));
  }
  const international = createSchedule("amer", teams);
  return {
    matches: [...regionalMatches, ...international.matches.filter((match) => match.region === "global")],
    tournaments: [...regionalTournaments, ...international.tournaments.filter((tournament) => tournament.scope === "international")],
  };
}
