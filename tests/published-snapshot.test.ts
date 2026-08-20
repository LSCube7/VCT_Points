import { describe, expect, it } from "vitest";
import { mergePublishedSnapshot } from "../src/lib/published-snapshot";
import type { MatchResult, PublishedSnapshot, PublishedTeamPoints, QualificationMethod, RegionAnalysis, RegionId, Team } from "../src/lib/types";

const regionIds: RegionId[] = ["amer", "emea", "pacific", "china"];
const probability = { numerator: "1", denominator: "1", percentage: 100 };

function analysis(region: RegionId, marker: string): RegionAnalysis {
  const qualifiers = Array.from({ length: 4 }, (_, index) => `${region}-${marker}-${index + 1}`);
  const methods = Object.fromEntries(qualifiers.map((teamId) => [teamId, "championship-points" as QualificationMethod]));
  return {
    region,
    totalOutcomes: "1",
    scenarioGroups: [{
      id: `${region}-${marker}`,
      region,
      qualifiers,
      methods,
      probability,
      outcomeCount: "1",
      representativeResults: {},
    }],
    teamProbabilities: qualifiers.map((teamId) => ({
      teamId,
      probability,
      methods: {
        "stage2-winner": probability,
        "stage2-runner-up": probability,
        "championship-points": probability,
      },
    })),
    engineVersion: marker,
  };
}

function team(region: RegionId): Team {
  return { id: `${region}-team`, region, name: `${region} Team`, shortName: region, color: "#000000", active: true };
}

function points(region: RegionId, total: number): PublishedTeamPoints {
  return { teamId: `${region}-team`, total, breakdown: { kickoff: total, masters1: 0, stage1: 0, masters2: 0, regularSeason: 0 } };
}

function match(id: string, region: RegionId): MatchResult {
  return {
    id,
    eventId: "stage-2",
    region,
    stage: "stage-2",
    teamA: `${region}-team-a`,
    teamB: `${region}-team-b`,
    status: "scheduled",
    maps: [],
    isRegularSeason: false,
    isTiebreaker: false,
    phase: "playoffs",
  };
}

function cluster(region: RegionId, marker: string) {
  return {
    recommendedK: 1,
    clusters: [{ id: `${region}-${marker}`, scenarioIds: [`${region}-${marker}`], totalProbability: 1, medoidScenarioId: `${region}-${marker}` }],
    scores: {},
  };
}

function baseSnapshot(): PublishedSnapshot {
  return {
    version: "base",
    publishedAt: "2026-08-20T00:00:00.000Z",
    dataCutoff: "2026-08-20T00:00:00.000Z",
    regions: regionIds.map((region) => analysis(region, "base")),
    teams: regionIds.map(team),
    teamPoints: regionIds.map((region) => points(region, 10)),
    matches: regionIds.map((region) => match(`${region}-old`, region)),
    clusters: Object.fromEntries(regionIds.map((region) => [region, cluster(region, "base")])),
  };
}

describe("published snapshot merge", () => {
  it("replaces selected regions while preserving the other published regions", () => {
    const result = mergePublishedSnapshot(baseSnapshot(), {
      version: "partial",
      publishedAt: "2026-08-20T01:00:00.000Z",
      dataCutoff: "2026-08-20T01:00:00.000Z",
      regions: [analysis("amer", "updated")],
      teams: regionIds.map(team),
      teamPoints: [points("amer", 99)],
      matches: [match("amer-new", "amer")],
      clusters: { amer: cluster("amer", "updated") },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.version).toBe("partial");
    expect(result.snapshot.regions.find((item) => item.region === "amer")?.engineVersion).toBe("updated");
    expect(result.snapshot.regions.find((item) => item.region === "emea")?.engineVersion).toBe("base");
    expect(result.snapshot.teamPoints).toEqual(expect.arrayContaining([points("amer", 99), points("emea", 10)]));
    expect(result.snapshot.teamPoints).not.toEqual(expect.arrayContaining([points("amer", 10)]));
    expect(result.snapshot.matches?.map((item) => item.id)).toEqual(expect.arrayContaining(["amer-new", "emea-old", "pacific-old", "china-old"]));
    expect(result.snapshot.matches?.map((item) => item.id)).not.toContain("amer-old");
    expect(result.snapshot.clusters?.amer?.clusters[0]?.id).toBe("amer-updated");
    expect(result.snapshot.clusters?.emea?.clusters[0]?.id).toBe("emea-base");
  });

  it("rejects duplicate regions in a partial publication", () => {
    const result = mergePublishedSnapshot(baseSnapshot(), {
      version: "partial",
      publishedAt: "2026-08-20T01:00:00.000Z",
      dataCutoff: "2026-08-20T01:00:00.000Z",
      regions: [analysis("amer", "one"), analysis("amer", "two")],
    });

    expect(result).toEqual({ ok: false, code: "VALIDATION_ERROR", message: "发布数据包含重复赛区" });
  });
});
