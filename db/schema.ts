import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const seasons = pgTable("seasons", {
  id: text("id").primaryKey(),
  year: integer("year").notNull(),
  ruleVersion: text("rule_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const regionsTable = pgTable("regions", {
  id: text("id").primaryKey(),
  seasonId: text("season_id").notNull().references(() => seasons.id),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  regionId: text("region_id").notNull().references(() => regionsTable.id),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  color: text("color").notNull(),
  active: integer("active").notNull().default(1),
});

export const tournaments = pgTable("tournaments", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: text("season_id").notNull().references(() => seasons.id),
  regionId: text("region_id").references(() => regionsTable.id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
});

export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  regionId: text("region_id").notNull().references(() => regionsTable.id),
  stage: text("stage").notNull(),
  teamAId: text("team_a_id").notNull().references(() => teams.id),
  teamBId: text("team_b_id").notNull().references(() => teams.id),
  status: text("status").notNull().default("scheduled"),
  winnerId: text("winner_id").references(() => teams.id),
  isRegularSeason: integer("is_regular_season").notNull().default(0),
  isTiebreaker: integer("is_tiebreaker").notNull().default(0),
  playedAt: timestamp("played_at", { withTimezone: true }),
  notes: text("notes"),
});

export const mapScores = pgTable("map_scores", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: text("match_id").notNull().references(() => matches.id),
  mapName: text("map_name").notNull(),
  teamARounds: integer("team_a_rounds").notNull(),
  teamBRounds: integer("team_b_rounds").notNull(),
});

export const bracketNodes = pgTable("bracket_nodes", {
  id: text("id").primaryKey(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  teamARef: jsonb("team_a_ref"),
  teamBRef: jsonb("team_b_ref"),
  winnerTo: text("winner_to"),
  loserTo: text("loser_to"),
});

export const placements = pgTable("placements", {
  id: uuid("id").defaultRandom().primaryKey(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  teamId: text("team_id").notNull().references(() => teams.id),
  placement: integer("placement").notNull(),
  points: integer("points").notNull(),
});

export const tieBreakOverrides = pgTable("tie_break_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: text("season_id").notNull().references(() => seasons.id),
  teamAId: text("team_a_id").notNull().references(() => teams.id),
  teamBId: text("team_b_id").notNull().references(() => teams.id),
  reason: text("reason").notNull(),
  decision: text("decision").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const draftVersions = pgTable(
  "draft_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seasonId: text("season_id").notNull(),
    revision: integer("revision").notNull().default(1),
    status: text("status").notNull().default("draft"),
    payload: jsonb("payload").notNull(),
    inputHash: text("input_hash"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    seasonRevision: uniqueIndex("draft_versions_season_revision").on(table.seasonId, table.revision),
  }),
);

export const publishedVersions = pgTable("published_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: text("season_id").notNull(),
  version: text("version").notNull().unique(),
  snapshot: jsonb("snapshot").notNull(),
  inputHash: text("input_hash").notNull(),
  engineVersion: text("engine_version").notNull(),
  publishedBy: text("published_by").notNull(),
  dataCutoff: timestamp("data_cutoff", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
});

export const analysisJobs = pgTable("analysis_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: text("season_id").notNull(),
  draftRevision: integer("draft_revision").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull().default("created"),
  expectedChunks: integer("expected_chunks").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const analysisChunks = pgTable(
  "analysis_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    jobChunk: uniqueIndex("analysis_chunks_job_index").on(table.jobId, table.chunkIndex),
  }),
);

export const adminSessions = pgTable("admin_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  subject: text("subject").notNull(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const schema = {
  seasons,
  regionsTable,
  teams,
  tournaments,
  matches,
  mapScores,
  bracketNodes,
  placements,
  tieBreakOverrides,
  draftVersions,
  publishedVersions,
  analysisJobs,
  analysisChunks,
  adminSessions,
  auditLogs,
};
