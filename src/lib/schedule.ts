import type {
  BracketConfig,
  GroupConfig,
  MatchPhase,
  MatchRegion,
  MatchResult,
  RegionId,
  Team,
  TournamentConfig,
  TournamentFormat,
  TournamentScope,
} from "./types";
import { REGION_IDS } from "./types";

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

export function createTournamentConfig(template: EventTemplate, teams: Team[], region?: RegionId): TournamentConfig {
  const scope = template.scope;
  const teamIds = scope === "international"
    ? teams.filter((team) => team.id.endsWith("-team-1") || team.id.endsWith("-team-2") || team.id.endsWith("-team-3")).map((team) => team.id)
    : teams.filter((team) => team.region === region).map((team) => team.id);
  const groups = template.format === "swiss-plus-playoffs"
    ? [{ id: "swiss", name: "Swiss Stage", teamIds: teamIds.filter((teamId) => !teamId.endsWith("-team-1")) }]
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
        ...teams.filter((team) => team.id.endsWith("-team-1")).map((team) => `seed:${team.id}`),
        ...Array.from({ length: 4 }, (_, index) => `winner:${template.id}-swiss-${index + 1}`),
      ] : template.format === "triple-elimination" ? tripleSeedSlots() : teamIds.slice(0, 8)),
    },
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

function regionalBracketMatches(event: EventTemplate, region: RegionId, teamIds: string[]): MatchResult[] {
  const slots = teamIds.slice(0, 8);
  const matches: MatchResult[] = [];
  for (let index = 0; index < 4; index += 1) {
    matches.push(emptyMatch({ id: `${region}-${event.id}-r1-${index + 1}`, event, region, stage: event.stage, phase: "playoffs", teamA: slots[index * 2] ?? `seed:${index * 2 + 1}`, teamB: slots[index * 2 + 1] ?? `seed:${index * 2 + 2}`, bracketRound: "Opening Round", roundLabel: "淘汰赛首轮", bestOf: 3 }));
  }
  for (let index = 0; index < 2; index += 1) {
    matches.push(emptyMatch({ id: `${region}-${event.id}-r2-${index + 1}`, event, region, stage: event.stage, phase: "playoffs", teamA: `winner:${region}-${event.id}-r1-${index * 2 + 1}`, teamB: `winner:${region}-${event.id}-r1-${index * 2 + 2}`, bracketRound: "Semifinal", roundLabel: "淘汰赛半决赛", bestOf: 3 }));
  }
  matches.push(emptyMatch({ id: `${region}-${event.id}-final`, event, region, stage: event.stage, phase: "playoffs", teamA: `winner:${region}-${event.id}-r2-1`, teamB: `winner:${region}-${event.id}-r2-2`, bracketRound: "Final", roundLabel: "决赛", bestOf: 5 }));
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
  for (let index = 0; index < 4; index += 1) {
    addMatch({
      suffix: `mb-r1-${index + 1}`,
      teamA: loserRef(`ub-r1-${index + 1}`),
      teamB: loserRef(`ub-r2-${index + 1}`),
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
      teamA: winnerRef(`mb-r2-${index + 1}`),
      teamB: loserRef(`ub-r3-${index + 1}`),
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
    teamA: winnerRef("mb-r4-1"),
    teamB: loserRef("ub-final"),
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
      teamA: winnerRef(`lb-r1-${index + 1}`),
      teamB: loserRef(`mb-r2-${index + 1}`),
      bracketRound: "Lower Bracket Round 2",
      roundLabel: "淘汰赛 · 败者组第 2 轮",
    });
  }
  for (let index = 0; index < 2; index += 1) {
    addMatch({
      suffix: `lb-r3-${index + 1}`,
      teamA: winnerRef(`lb-r2-${index + 1}`),
      teamB: loserRef(`mb-r3-${index + 1}`),
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
    teamA: winnerRef("lb-r4-1"),
    teamB: loserRef("mb-r4-1"),
    bracketRound: "Lower Bracket Round 5",
    roundLabel: "淘汰赛 · 败者组第 5 轮",
  });
  addMatch({
    suffix: "lb-final",
    teamA: winnerRef("lb-r5-1"),
    teamB: loserRef("mb-final"),
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

function internationalSwissMatches(event: EventTemplate, teams: Team[]): MatchResult[] {
  const byRegion = new Map<RegionId, string[]>((["amer", "emea", "pacific", "china"] as RegionId[]).map((region) => [region, teams.filter((team) => team.region === region).slice(0, 3).map((team) => team.id)]));
  const seeds = [
    [byRegion.get("amer")?.[1], byRegion.get("emea")?.[2]],
    [byRegion.get("emea")?.[1], byRegion.get("pacific")?.[2]],
    [byRegion.get("pacific")?.[1], byRegion.get("china")?.[2]],
    [byRegion.get("china")?.[1], byRegion.get("amer")?.[2]],
  ];
  const matches: MatchResult[] = seeds.map(([teamA, teamB], index) => emptyMatch({ id: `${event.id}-swiss-r1-${index + 1}`, event, region: "global", stage: event.stage, phase: "swiss", teamA: teamA ?? `seed:${index + 1}-a`, teamB: teamB ?? `seed:${index + 1}-b`, roundLabel: "Swiss Round 1", bestOf: 3 }));
  matches.push(
    emptyMatch({ id: `${event.id}-swiss-r2-high-1`, event, region: "global", stage: event.stage, phase: "swiss", teamA: `winner:${event.id}-swiss-r1-1`, teamB: `winner:${event.id}-swiss-r1-2`, roundLabel: "Swiss Round 2 · 1-0", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-swiss-r2-high-2`, event, region: "global", stage: event.stage, phase: "swiss", teamA: `winner:${event.id}-swiss-r1-3`, teamB: `winner:${event.id}-swiss-r1-4`, roundLabel: "Swiss Round 2 · 1-0", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-swiss-r2-low-1`, event, region: "global", stage: event.stage, phase: "swiss", teamA: `loser:${event.id}-swiss-r1-1`, teamB: `loser:${event.id}-swiss-r1-2`, roundLabel: "Swiss Round 2 · 0-1", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-swiss-r2-low-2`, event, region: "global", stage: event.stage, phase: "swiss", teamA: `loser:${event.id}-swiss-r1-3`, teamB: `loser:${event.id}-swiss-r1-4`, roundLabel: "Swiss Round 2 · 0-1", bestOf: 3 }),
  );
  matches.push(
    emptyMatch({ id: `${event.id}-swiss-r3-qualifier-1`, event, region: "global", stage: event.stage, phase: "swiss", teamA: `winner:${event.id}-swiss-r2-high-1`, teamB: `winner:${event.id}-swiss-r2-high-2`, roundLabel: "Swiss Round 3 · 2-0", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-swiss-r3-qualifier-2`, event, region: "global", stage: event.stage, phase: "swiss", teamA: `loser:${event.id}-swiss-r2-low-1`, teamB: `loser:${event.id}-swiss-r2-low-2`, roundLabel: "Swiss Round 3 · 0-2", bestOf: 3 }),
    emptyMatch({ id: `${event.id}-swiss-r3-mid-1`, event, region: "global", stage: event.stage, phase: "swiss", teamA: `winner:${event.id}-swiss-r2-high-1`, teamB: `winner:${event.id}-swiss-r2-low-1`, roundLabel: "Swiss Round 3 · 1-1", bestOf: 3 }),
  );
  return matches;
}

function internationalPlayoffMatches(event: EventTemplate, teams: Team[]): MatchResult[] {
  const directSeeds = teams.filter((team) => team.id.endsWith("-team-1")).map((team) => `seed:${team.id}`);
  const swissSeeds = Array.from({ length: 4 }, (_, index) => `winner:${event.id}-swiss-r3-qualifier-${index + 1}`);
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
      matches.push(...internationalSwissMatches(event, teams), ...internationalPlayoffMatches(event, teams));
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
