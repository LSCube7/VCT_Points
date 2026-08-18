export const REGION_IDS = ["amer", "emea", "pacific", "china"] as const;
export type RegionId = (typeof REGION_IDS)[number];
export type MatchRegion = RegionId | "global";

export type Locale = "zh-CN" | "en";
export type MatchStatus = "scheduled" | "completed" | "forfeit" | "cancelled";
export const SWISS_SERIES_SCORES = ["2-0", "2-1", "1-2", "0-2"] as const;
export type SwissSeriesScore = (typeof SWISS_SERIES_SCORES)[number];
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
  /** Swiss 赛只记录系列赛比分，不记录逐地图回合比分。 */
  seriesScore?: SwissSeriesScore;
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

export interface BracketConfig {
  type: "single-elimination" | "double-elimination" | "triple-elimination";
  startRound: BracketStartRound;
  teamRefs: string[];
}

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
  bracket?: BracketConfig;
}

export interface DraftPayload {
  seasonId: string;
  revision: number;
  matches: MatchResult[];
  teams: Team[];
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
}

export interface BracketRegionSimulationInput {
  region: RegionId;
  teams: SimulationTeam[];
  directQualifiers: [string, string];
  matches: BracketSimulationMatch[];
}

export interface RegionSimulationInput {
  region: RegionId;
  teams: SimulationTeam[];
  directQualifiers: [string, string];
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
}
