import { describe, expect, it } from "vitest";
import { clusterScenarios } from "../src/lib/engine/cluster";
import type { ScenarioGroup } from "../src/lib/types";

const scenario = (id: string, percentage: number): ScenarioGroup => ({
  id,
  region: "amer",
  qualifiers: [id, "direct-a", "direct-b", "points-x"],
  methods: { [id]: "championship-points", "direct-a": "stage2-winner", "direct-b": "stage2-runner-up", "points-x": "championship-points" },
  probability: { numerator: String(percentage), denominator: "100", percentage },
  outcomeCount: String(percentage),
  representativeResults: {},
});

describe("scenario clustering", () => {
  it("returns a deterministic recommended k and probability mass", () => {
    const scenarios = [scenario("s1", 25), scenario("s2", 25), scenario("s3", 25), scenario("s4", 25)];
    const features = scenarios.map((item, index) => ({ scenarioId: item.id, points: index < 2 ? 10 : 40, stage2Ranks: [index], methods: index < 2 ? "points" : "direct" }));
    const result = clusterScenarios(scenarios, features);
    expect(result.recommendedK).toBeGreaterThanOrEqual(1);
    expect(result.clusters.reduce((total, cluster) => total + cluster.totalProbability, 0)).toBeCloseTo(1);
    expect(result).toEqual(clusterScenarios(scenarios, features));
  });
});
