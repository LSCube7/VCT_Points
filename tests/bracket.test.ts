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

  it("derives the direct qualifiers from the Stage 2 final in every scenario", () => {
    const base = bracketInput();
    base.matches = [
      { id: "stage2-r1", teamA: { type: "team", teamId: "c" }, teamB: { type: "team", teamId: "d" }, winnerPoints: 0 },
      { id: "stage2-final", teamA: { type: "winner", matchId: "stage2-r1" }, teamB: { type: "team", teamId: "e" }, winnerPoints: 0, bracketRound: "Grand Final" },
    ];
    base.directQualifiers = ["pending-winner", "pending-runner-up"];
    base.directQualifierMatchId = "stage2-final";
    base.stage2MainMatchIds = ["stage2-r1", "stage2-final"];

    const result = enumerateBracketRegion(base);
    expect(result.totalOutcomes).toBe("4");
    expect(result.scenarioGroups.every((group) => Object.values(group.methods).filter((method) => method === "stage2-winner" || method === "stage2-runner-up").length === 2)).toBe(true);

    const finalWinnerScenario = result.scenarioGroups.find((group) => group.methods.e === "stage2-winner");
    expect(finalWinnerScenario?.methods.c).toBe("stage2-runner-up");
    expect(finalWinnerScenario?.stage2Placements).toMatchObject({ e: 1, c: 2 });
    expect(Object.values(finalWinnerScenario?.stage2Placements ?? {}).sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
  });

  it("does not use non-VCT teams for championship-point qualifiers", () => {
    const input = bracketInput();
    input.matches = [];
    input.championshipPointEligibleTeamIds = ["a", "b", "c", "d"];
    input.teams.find((team) => team.id === "e")!.basePoints = 1000;

    const result = enumerateBracketRegion(input);
    const scenario = result.scenarioGroups[0];

    expect(scenario.qualifiers).toEqual(["a", "b", "c", "d"]);
    expect(scenario.methods.e).toBeUndefined();
    expect(scenario.stage2Placements?.e).toBeUndefined();
  });

  it("uses the configured Tierbreak order after removing the champion and runner-up", () => {
    const input = bracketInput();
    input.matches = [];
    input.teams.find((team) => team.id === "a")!.basePoints = 100;
    input.teams.find((team) => team.id === "c")!.basePoints = 100;
    input.teams.find((team) => team.id === "d")!.basePoints = 100;
    input.teams.find((team) => team.id === "e")!.basePoints = 0;
    input.teams.find((team) => team.id === "b")!.basePoints = 0;
    input.teams.find((team) => team.id === "c")!.metrics = {
      ...input.teams.find((team) => team.id === "c")!.metrics,
      stage2Finish: 1,
      masters2Finish: 1,
      stage1Finish: 1,
      masters1Finish: 1,
      kickoffFinish: 1,
      regularSeasonWins: 5,
      headToHeadWins: 0,
    };
    input.teams.find((team) => team.id === "d")!.metrics = {
      ...input.teams.find((team) => team.id === "d")!.metrics,
      stage2Finish: 1,
      masters2Finish: 1,
      stage1Finish: 1,
      masters1Finish: 1,
      kickoffFinish: 1,
      regularSeasonWins: 5,
      headToHeadWins: 1,
    };

    const scenario = enumerateBracketRegion(input).scenarioGroups[0];
    expect(scenario.methods.d).toBe("championship-points");
    expect(scenario.methods.c).toBe("championship-points");
    expect(scenario.stage2Placements).toMatchObject({ a: 1, b: 2, c: 3, d: 4 });
  });

  it("uses stable Stage 2 match IDs when old drafts lack round metadata", () => {
    const metrics = (finish: number) => ({
      stage2Finish: finish,
      masters2Finish: finish,
      stage1Finish: finish,
      masters1Finish: finish,
      kickoffFinish: finish,
      regularSeasonWins: 0,
      mapDiff: 0,
      roundDiff: 0,
      headToHeadWins: 0,
      headToHeadMapDiff: 0,
      headToHeadRoundDiff: 0,
    });
    const teams = [
      ["a", 0], ["b", 0], ["c", 10], ["d", 10], ["e", 12], ["f", 11],
    ].map(([id, basePoints], index) => ({ id: id as string, name: id as string, basePoints: basePoints as number, metrics: metrics(index + 1) }));
    const team = (teamId: string) => ({ type: "team" as const, teamId });
    const winner = (matchId: string) => ({ type: "winner" as const, matchId });
    const matches = [
      { id: "stage-2-ub-final", teamA: team("a"), teamB: team("b"), winnerPoints: 0 },
      { id: "stage-2-lb-final", teamA: team("c"), teamB: team("d"), winnerPoints: 0 },
      { id: "stage-2-grand-final", teamA: winner("stage-2-ub-final"), teamB: winner("stage-2-lb-final"), winnerPoints: 0 },
    ];
    const result = enumerateBracketRegion({
      region: "china",
      teams,
      directQualifiers: ["pending-winner", "pending-runner-up"],
      championshipPointEligibleTeamIds: teams.map((item) => item.id),
      directQualifierMatchId: "stage-2-grand-final",
      stage2MainMatchIds: matches.map((match) => match.id),
      matches,
    });

    expect(result.teamProbabilities.find((item) => item.teamId === "d")?.probability.percentage).toBeGreaterThan(0);
    expect(result.scenarioGroups.some((group) => group.methods.d === "championship-points")).toBe(true);
  });

  it("matches the CN Stage 2 248-of-256 qualification result", () => {
    const metrics = (finish: number) => ({
      stage2Finish: finish,
      masters2Finish: finish,
      stage1Finish: finish,
      masters1Finish: finish,
      kickoffFinish: finish,
      regularSeasonWins: 0,
      mapDiff: 0,
      roundDiff: 0,
      headToHeadWins: 0,
      headToHeadMapDiff: 0,
      headToHeadRoundDiff: 0,
    });
    const basePoints: Record<string, number> = {
      NOVA: 12,
      TEC: 11,
      TE: 14,
      AG: 13,
      JDG: 17,
      TYL: 16,
      BLG: 15,
      XLG: 18,
    };
    const teams = Object.entries(basePoints).map(([id, points], index) => ({
      id,
      name: id,
      basePoints: points,
      metrics: metrics(index + 1),
    }));
    const team = (teamId: string) => ({ type: "team" as const, teamId });
    const loser = (matchId: string) => ({ type: "loser" as const, matchId });
    const winner = (matchId: string) => ({ type: "winner" as const, matchId });
    const match = (id: string, teamA: ReturnType<typeof team> | ReturnType<typeof loser> | ReturnType<typeof winner>, teamB: ReturnType<typeof team> | ReturnType<typeof loser> | ReturnType<typeof winner>, matchWinner?: string) => ({
      id,
      teamA,
      teamB,
      ...(matchWinner ? { winner: matchWinner } : {}),
      winnerPoints: 0,
    });
    const matches = [
      match("china-stage-2-ub-qf-1", team("NOVA"), team("JDG"), "JDG"),
      match("china-stage-2-ub-qf-2", team("TYL"), team("TEC"), "TYL"),
      match("china-stage-2-ub-qf-3", team("BLG"), team("TE"), "BLG"),
      match("china-stage-2-ub-qf-4", team("XLG"), team("AG"), "XLG"),
      match("china-stage-2-ub-sf-1", winner("china-stage-2-ub-qf-1"), winner("china-stage-2-ub-qf-2")),
      match("china-stage-2-ub-sf-2", winner("china-stage-2-ub-qf-3"), winner("china-stage-2-ub-qf-4")),
      match("china-stage-2-ub-final", winner("china-stage-2-ub-sf-1"), winner("china-stage-2-ub-sf-2")),
      match("china-stage-2-lb-r1-1", team("NOVA"), team("TEC"), "NOVA"),
      match("china-stage-2-lb-r1-2", team("TE"), team("AG"), "AG"),
      match("china-stage-2-lb-qf-1", winner("china-stage-2-lb-r1-1"), loser("china-stage-2-ub-sf-2")),
      match("china-stage-2-lb-qf-2", winner("china-stage-2-lb-r1-2"), loser("china-stage-2-ub-sf-1")),
      match("china-stage-2-lb-sf", winner("china-stage-2-lb-qf-1"), winner("china-stage-2-lb-qf-2")),
      match("china-stage-2-lb-final", loser("china-stage-2-ub-final"), winner("china-stage-2-lb-sf")),
      match("china-stage-2-grand-final", winner("china-stage-2-ub-final"), winner("china-stage-2-lb-final")),
    ];
    const result = enumerateBracketRegion({
      region: "china",
      teams,
      directQualifiers: ["stage2-winner-pending", "stage2-runner-up-pending"],
      championshipPointEligibleTeamIds: Object.keys(basePoints),
      directQualifierMatchId: "china-stage-2-grand-final",
      stage2MainMatchIds: matches.map((item) => item.id),
      matches,
    });
    const xlg = result.teamProbabilities.find((item) => item.teamId === "XLG");

    expect(result.totalOutcomes).toBe("256");
    expect(xlg?.probability).toMatchObject({ numerator: "248", denominator: "256", percentage: 96.875 });
  });
});
