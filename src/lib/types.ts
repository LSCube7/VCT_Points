export const REGION_IDS = ["amer", "emea", "pacific", "china"] as const;
export type RegionId = (typeof REGION_IDS)[number];

export type Locale = "zh-CN" | "en";
export type MatchStatus = "scheduled" | "completed" | "forfeit" | "cancelled";
export type QualificationMethod = "stage2-winner" | "stage2-runner-up" | "championship-points";

export interface Team {
  id: string;
  region: RegionId;
  name: string;
  shortName: string;
  color: string;
  active: boolean;
}

export interface MapScore {
  map: string;
  teamARounds: number;
  teamBRounds: number;
}

export interface MatchResult {
  id: string;
  eventId: string;
  region: RegionId;
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
