export const REGION_IDS = ["amer", "emea", "pacific", "china"] as const;
export type RegionId = (typeof REGION_IDS)[number];
export type MatchRegion = RegionId | "global";

export type Locale = "zh-CN" | "en";
export type MatchStatus = "scheduled" | "completed" | "forfeit" | "cancelled";
export const SWISS_RECORDS = ["2-0", "2-1", "1-2", "0-2"] as const;
export type SwissRecord = (typeof SWISS_RECORDS)[number];
export type QualificationMethod = "stage2-winner" | "stage2-runner-up" | "championship-points";
export type MatchPhase = "group" | "swiss" | "playoffs";
export type TournamentScope = "regional" | "international";
export type TournamentFormat = "triple-elimination" | "group-plus-playoffs" | "swiss-plus-playoffs";
export type BracketStartRound = "quarterfinals" | "semifinals";

export interface Team {
  id: string;
  region: RegionId;
  name: string;
  shortName: string;
  color: string;
  active: boolean;
  country?: string;
  logoUrl?: string;
}

export interface MapScore {
  map: string;
  teamARounds: number;
  teamBRounds: number;
}

export interface MatchResult {
  id: string;
  eventId: string;
  region: MatchRegion;
  stage: "kickoff" | "masters-1" | "stage-1" | "masters-2" | "stage-2" | "champions";
  teamA: string;
  teamB: string;
  status: MatchStatus;
  winner?: string;
  maps: MapScore[];
  isRegularSeason: boolean;
  isTiebreaker: boolean;
  playedAt?: string;
  notes?: string;
  phase?: MatchPhase;
  groupId?: string;
  roundLabel?: string;
  bracketRound?: string;
  bestOf?: 3 | 5;
}

export interface GroupConfig {
  id: string;
  name: string;
  teamIds: string[];
}

/** 常规赛小组阶段只记录每支队伍的最终胜负战绩。 */
export interface GroupTeamRecord {
  groupId: string;
  teamId: string;
  wins: number;
  losses: number;
}

export interface BracketConfig {
  type: "single-elimination" | "double-elimination" | "triple-elimination";
  startRound: BracketStartRound;
  teamRefs: string[];
}

/** Play-in pair order when the two qualifiers are assigned to Alpha/Omega. */
export type Stage2PlayInGroupOrder = "alpha-first" | "omega-first";

export interface TournamentConfig {
  id: string;
  eventId: string;
  name: string;
  scope: TournamentScope;
  format: TournamentFormat;
  groupStage?: {
    groups: GroupConfig[];
    bestOf: 3 | 5;
  };
  /** 小组赛不展开单场对局，只保存每支队伍的最终战绩。 */
  groupRecords?: GroupTeamRecord[];
  bracket?: BracketConfig;
  /** Stage 2 international Play-in Challengers entries, kept separate from VCT group teams. */
  stage2ChallengerTeamIds?: string[];
  /** CN Stage 2 National Cup entries, kept separate from VCT group teams. */
  stage2NationalCupTeamIds?: string[];
  /** Non-CN Stage 2 main-playoff direct slots: Omega #2, Alpha #2, Alpha #1, Omega #1. */
  stage2DirectPlayoffTeamIds?: Array<string | null>;
  /** Non-CN Stage 2 Play-in qualifiers 1-2: first qualifier's Alpha/Omega destination. */
  stage2PlayInUpperGroupOrder?: Stage2PlayInGroupOrder;
  /** Non-CN Stage 2 Play-in qualifiers 3-4: first qualifier's Alpha/Omega destination. */
  stage2PlayInLowerGroupOrder?: Stage2PlayInGroupOrder;
  /** Swiss 阶段只保存每支队伍的最终胜负记录，不展开单场赛果。 */
  swissRecords?: SwissTeamRecord[];
}

export interface SwissTeamRecord {
  teamId: string;
  record: SwissRecord;
}

export interface DraftPayload {
  seasonId: string;
  revision: number;
  matches: MatchResult[];
  teams: Team[];
  /** Challengers teams are configured separately from the VCT team roster. */
  challengerTeams: Team[];
  tournaments: TournamentConfig[];
}

export interface TeamRankingMetrics {
  stage2Finish: number;
  masters2Finish: number;
  stage1Finish: number;
  masters1Finish: number;
  kickoffFinish: number;
  regularSeasonWins: number;
  mapDiff: number;
  roundDiff: number;
  headToHeadWins: number;
  headToHeadMapDiff: number;
  headToHeadRoundDiff: number;
}

export interface SimulationTeam {
  id: string;
  name: string;
  basePoints: number;
  metrics: TeamRankingMetrics;
}

export interface SimulationMatch {
  id: string;
  teamA: string;
  teamB: string;
  /** undefined means the series is unplayed and branches 50/50. */
  winner?: string;
  /** Points added to the winner for this simulated series. */
  winnerPoints: number;
}

export type BracketParticipant =
  | { type: "team"; teamId: string }
  | { type: "winner"; matchId: string }
  | { type: "loser"; matchId: string };

export interface BracketSimulationMatch {
  id: string;
  teamA: BracketParticipant;
  teamB: BracketParticipant;
  /** Set for an already completed series; absent means 50/50. */
  winner?: string;
  winnerPoints: number;
  loserPoints?: number;
  bracketRound?: string;
}

export interface BracketRegionSimulationInput {
  region: RegionId;
  teams: SimulationTeam[];
  directQualifiers: [string, string];
  /** VCT teams eligible for championship-point qualification; external Play-in teams are excluded. */
  championshipPointEligibleTeamIds?: string[];
  matches: BracketSimulationMatch[];
  /** Resolve Stage 2 direct slots from the final match instead of fixed IDs. */
  directQualifierMatchId?: string;
  /** Main-playoff matches used to award Stage 2 placement points. */
  stage2MainMatchIds?: string[];
}

export interface RegionSimulationInput {
  region: RegionId;
  teams: SimulationTeam[];
  directQualifiers: [string, string];
  /** VCT teams eligible for championship-point qualification; external teams are excluded. */
  championshipPointEligibleTeamIds?: string[];
  matches: SimulationMatch[];
}

export interface ExactProbability {
  numerator: string;
  denominator: string;
  percentage: number;
}

export interface ScenarioGroup {
  id: string;
  region: RegionId;
  qualifiers: string[];
  /** Actual Stage 2 placement for each qualified team; qualifiers itself is not a placement order. */
  stage2Placements?: Record<string, number>;
  methods: Record<string, QualificationMethod>;
  probability: ExactProbability;
  outcomeCount: string;
  representativeResults: Record<string, string>;
}

export interface TeamProbability {
  teamId: string;
  probability: ExactProbability;
  methods: Record<QualificationMethod, ExactProbability>;
}

export interface RegionAnalysis {
  region: RegionId;
  totalOutcomes: string;
  scenarioGroups: ScenarioGroup[];
  teamProbabilities: TeamProbability[];
  engineVersion: string;
}

export interface PublishedTeamPoints {
  teamId: string;
  total: number;
  breakdown: {
    kickoff: number;
    masters1: number;
    stage1: number;
    masters2: number;
    regularSeason: number;
  };
}

export interface PublishedScenarioCluster {
  id: string;
  scenarioIds: string[];
  totalProbability: number;
  medoidScenarioId: string;
}

export interface PublishedClusterAnalysis {
  recommendedK: number;
  clusters: PublishedScenarioCluster[];
  scores: Record<string, number>;
}

export interface DraftRevision {
  id: string;
  revision: number;
  updatedAt: string;
  status: "draft" | "calculating" | "validated" | "published";
}

export interface PublishedSnapshot {
  version: string;
  publishedAt: string;
  dataCutoff: string;
  regions: RegionAnalysis[];
  /** Published roster metadata; optional for compatibility with older snapshots. */
  teams?: Team[];
  challengerTeams?: Team[];
  /** Confirmed points before unresolved Stage 2 outcomes are added. */
  teamPoints?: PublishedTeamPoints[];
  /** Public Stage 2 bracket results and unresolved references. */
  matches?: MatchResult[];
  clusters?: Partial<Record<RegionId, PublishedClusterAnalysis>>;
}
