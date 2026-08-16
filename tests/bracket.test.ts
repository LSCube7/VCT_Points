import { describe, expect, it } from "vitest";
import { enumerateBracketRegion } from "../src/lib/engine/bracket";
import type { BracketRegionSimulationInput } from "../src/lib/types";

function bracketInput(): BracketRegionSimulationInput {
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
    region: "emea",
    directQualifiers: ["a", "b"],
    teams: ["a", "b", "c", "d", "e"].map((id, index) => ({ id, name: id, basePoints: 10 - index, metrics: metrics(index + 1) })),
    matches: [
      { id: "play-in-1", teamA: { type: "team", teamId: "c" }, teamB: { type: "team", teamId: "d" }, winnerPoints: 2 },
      { id: "play-in-2", teamA: { type: "winner", matchId: "play-in-1" }, teamB: { type: "team", teamId: "e" }, winnerPoints: 2 },
    ],
  };
}

describe("dynamic winner/loser bracket engine", () => {
  it("waits for upstream participants before branching downstream matches", () => {
    const result = enumerateBracketRegion(bracketInput());
    expect(result.totalOutcomes).toBe("4");
    expect(result.scenarioGroups.reduce((total, group) => total + BigInt(group.outcomeCount), 0n)).toBe(4n);
    expect(result.scenarioGroups.every((group) => group.qualifiers.length === 4)).toBe(true);
  });
});

