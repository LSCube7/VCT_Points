import { demoAnalyses, demoTeams, regions } from "./demo";
import type { PublishedSnapshot, RegionId } from "../types";
import { cacheLife, cacheTag } from "next/cache";
import { desc } from "drizzle-orm";
import { publishedVersions } from "../../../db/schema";
import { getDb } from "../db";
import { sortByDescending } from "../sorting";

/**
 * The repository starts without a database connection. This clearly labelled
 * preview snapshot keeps the UI useful until the Neon environment is linked;
 * production data access will replace this function without changing pages.
 */
export async function getPublishedSnapshot(): Promise<PublishedSnapshot> {
  "use cache";
  cacheTag("season-2026-published");
  cacheLife("days");
  if (process.env.DATABASE_URL) {
    const db = getDb();
    const rows = await db.select({ snapshot: publishedVersions.snapshot }).from(publishedVersions).orderBy(desc(publishedVersions.publishedAt)).limit(1);
    if (rows[0]?.snapshot) return rows[0].snapshot as PublishedSnapshot;
    return { version: "unpublished", publishedAt: "", dataCutoff: "", regions: [] };
  }
  return {
    version: "preview-seed",
    publishedAt: new Date(0).toISOString(),
    dataCutoff: new Date(0).toISOString(),
    regions: demoAnalyses(),
  };
}

export async function getRegion(region: RegionId) {
  const snapshot = await getPublishedSnapshot();
  const publishedRoster = [...(snapshot.teams ?? []), ...(snapshot.challengerTeams ?? [])]
    .filter((team) => team.region === region);
  const teams = publishedRoster.length > 0 ? publishedRoster : demoTeams(region);
  const teamIds = new Set(teams.map((team) => team.id));
  const challengerIds = new Set((snapshot.challengerTeams ?? []).map((team) => team.id));
  const analysis = snapshot.regions.find((item) => item.region === region) ?? {
    region,
    totalOutcomes: "0",
    scenarioGroups: [],
    teamProbabilities: [],
    engineVersion: "pending",
  };
  const clusters = snapshot.clusters?.[region];
  return {
    isPublished: snapshot.version !== "unpublished" && snapshot.version !== "preview-seed",
    version: snapshot.version,
    metadata: regions.find((item) => item.id === region),
    teams,
    teamPoints: sortByDescending((snapshot.teamPoints ?? [])
      .filter((item) => teamIds.has(item.teamId))
      .map((item) => challengerIds.has(item.teamId) ? {
        ...item,
        total: 0,
        breakdown: { kickoff: 0, masters1: 0, stage1: 0, masters2: 0, regularSeason: 0 },
      } : item), (item) => item.total, (item) => item.teamId),
    matches: (snapshot.matches ?? []).filter((match) => match.region === region),
    clusters: clusters ? {
      ...clusters,
      clusters: sortByDescending(clusters.clusters, (cluster) => cluster.totalProbability, (cluster) => cluster.id),
    } : undefined,
    analysis: {
      ...analysis,
      scenarioGroups: sortByDescending(analysis.scenarioGroups, (scenario) => scenario.probability.percentage, (scenario) => scenario.id),
      teamProbabilities: sortByDescending(analysis.teamProbabilities, (item) => item.probability.percentage, (item) => item.teamId),
    },
  };
}
