import { demoAnalyses, demoTeams, regions } from "./demo";
import type { PublishedSnapshot, RegionId } from "../types";
import { cacheLife, cacheTag } from "next/cache";
import { desc } from "drizzle-orm";
import { publishedVersions } from "../../../db/schema";
import { getDb } from "../db";

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
  return {
    metadata: regions.find((item) => item.id === region),
    teams: demoTeams(region),
    analysis: snapshot.regions.find((item) => item.region === region) ?? {
      region,
      totalOutcomes: "0",
      scenarioGroups: [],
      teamProbabilities: [],
      engineVersion: "pending",
    },
  };
}
