import { describe, expect, it } from "vitest";
import { compareRankingMetrics, placementPoints, regularSeasonMatchPoints } from "../src/lib/rules";

const metrics = (overrides: Partial<Parameters<typeof compareRankingMetrics>[0]> = {}) => ({
  stage2Finish: 2,
  masters2Finish: 2,
  stage1Finish: 2,
  masters1Finish: 2,
  kickoffFinish: 2,
  regularSeasonWins: 5,
  mapDiff: 0,
  roundDiff: 0,
  headToHeadWins: 0,
  headToHeadMapDiff: 0,
  headToHeadRoundDiff: 0,
  ...overrides,
});

describe("VCT championship rules", () => {
  it("uses the official placement points", () => {
    expect(placementPoints("kickoff", 1)).toBe(4);
    expect(placementPoints("masters-1", 6)).toBe(1);
    expect(placementPoints("masters-2", 2)).toBe(6);
    expect(placementPoints("stage-2", 4)).toBe(4);
  });

  it("ranks an earlier Stage 2 finish before later tie breakers", () => {
    expect(compareRankingMetrics(metrics({ stage2Finish: 1 }), metrics({ stage2Finish: 2 }))).toBeLessThan(0);
  });

  it("stops after the Kickoff finish", () => {
    expect(compareRankingMetrics(metrics({ regularSeasonWins: 7 }), metrics({ regularSeasonWins: 4 }))).toBe(0);
    expect(compareRankingMetrics(metrics({ mapDiff: 10 }), metrics({ mapDiff: -10 }))).toBe(0);
    expect(compareRankingMetrics(metrics({ roundDiff: 20 }), metrics({ roundDiff: -20 }))).toBe(0);
  });

  it("does not use head-to-head fields after the fifth criterion", () => {
    expect(compareRankingMetrics(metrics({ headToHeadWins: 1 }), metrics({ headToHeadWins: 0 }), false)).toBe(0);
    expect(compareRankingMetrics(metrics({ headToHeadWins: 1 }), metrics({ headToHeadWins: 0 }), true)).toBe(0);
  });

  it("uses team-level group records instead of group match details", () => {
    expect(regularSeasonMatchPoints([], "team-a", [{ groupId: "alpha", teamId: "team-a", wins: 5, losses: 0 }])).toBe(5);
  });
});
