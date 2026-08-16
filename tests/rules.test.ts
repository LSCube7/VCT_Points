import { describe, expect, it } from "vitest";
import { compareRankingMetrics, placementPoints } from "../src/lib/rules";

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

  it("falls through to regular-season wins after event placements", () => {
    expect(compareRankingMetrics(metrics({ regularSeasonWins: 7 }), metrics({ regularSeasonWins: 4 }))).toBeLessThan(0);
  });

  it("keeps head-to-head comparison opt-in for a two-team tie", () => {
    expect(compareRankingMetrics(metrics({ headToHeadWins: 1 }), metrics({ headToHeadWins: 0 }), false)).toBe(0);
    expect(compareRankingMetrics(metrics({ headToHeadWins: 1 }), metrics({ headToHeadWins: 0 }), true)).toBeLessThan(0);
  });
});
