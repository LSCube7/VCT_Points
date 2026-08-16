import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { enumerateRegion } from "../src/lib/engine/exact";
import type { RegionSimulationInput } from "../src/lib/types";

function input(): RegionSimulationInput {
  const metrics = (finish: number) => ({
    stage2Finish: finish,
    masters2Finish: finish,
    stage1Finish: finish,
    masters1Finish: finish,
    kickoffFinish: finish,
    regularSeasonWins: 5,
    mapDiff: 0,
    roundDiff: 0,
    headToHeadWins: 0,
    headToHeadMapDiff: 0,
    headToHeadRoundDiff: 0,
  });
  return {
    region: "amer",
    directQualifiers: ["a", "b"],
    teams: ["a", "b", "c", "d", "e", "f"].map((id, index) => ({ id, name: id, basePoints: 10 - index, metrics: metrics(index + 1) })),
    matches: [
      { id: "m1", teamA: "c", teamB: "d", winnerPoints: 2 },
      { id: "m2", teamA: "e", teamB: "f", winnerPoints: 2 },
    ],
  };
}

describe("exact scenario engine", () => {
  it("aggregates all equiprobable branches without losing the denominator", () => {
    const result = enumerateRegion(input());
    expect(result.totalOutcomes).toBe("4");
    expect(result.scenarioGroups.reduce((total, group) => total + BigInt(group.outcomeCount), 0n)).toBe(4n);
    expect(result.scenarioGroups.every((group) => group.qualifiers.length === 4)).toBe(true);
  });

  it("is deterministic for the same input", () => {
    expect(enumerateRegion(input())).toEqual(enumerateRegion(input()));
  });

  it("keeps exact probability values within the unit interval", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 4 }), (extraPoints) => {
      const modified = input();
      modified.matches[0].winnerPoints = extraPoints;
      const result = enumerateRegion(modified);
      return result.scenarioGroups.every((group) => group.probability.percentage >= 0 && group.probability.percentage <= 100);
    }));
  });
});
