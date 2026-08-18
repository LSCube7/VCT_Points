import { describe, expect, it } from "vitest";
import { buildDraftRegionSimulation } from "../src/lib/draft-analysis";
import type { MatchResult, Team, TournamentConfig } from "../src/lib/types";

function team(id: string): Team {
  return { id, region: "amer", name: `Team ${id}`, shortName: id.toUpperCase(), color: "#000000", active: true };
}

function match(overrides: Partial<MatchResult> & Pick<MatchResult, "id" | "teamA" | "teamB">): MatchResult {
  return {
    eventId: "stage-2",
    region: "amer",
    stage: "stage-2",
    status: "scheduled",
    maps: [],
    isRegularSeason: false,
    isTiebreaker: false,
    phase: "playoffs",
    ...overrides,
  };
}

function stage2Config(): TournamentConfig {
  return {
    id: "stage-2-amer",
    eventId: "stage-2",
    name: "Stage 2",
    scope: "regional",
    format: "group-plus-playoffs",
    groupStage: {
      bestOf: 3,
      groups: [
        { id: "alpha", name: "Alpha", teamIds: ["a", "b"] },
        { id: "omega", name: "Omega", teamIds: ["c", "d"] },
      ],
    },
    groupRecords: [
      { groupId: "alpha", teamId: "a", wins: 1, losses: 0 },
      { groupId: "alpha", teamId: "b", wins: 0, losses: 1 },
      { groupId: "omega", teamId: "c", wins: 1, losses: 0 },
      { groupId: "omega", teamId: "d", wins: 0, losses: 1 },
    ],
  };
}

describe("draft analysis adapter", () => {
  it("keeps the complete Stage 2 graph and calculates direct slots dynamically", () => {
    const result = buildDraftRegionSimulation({
      region: "amer",
      teams: ["a", "b", "c", "d"].map(team),
      challengerTeams: [],
      tournaments: [stage2Config()],
      matches: [
        match({ id: "stage-2-ub-r1-1", teamA: "a", teamB: "b" }),
        match({
          id: "stage-2-grand-final",
          teamA: "winner:stage-2-ub-r1-1",
          teamB: "c",
          bracketRound: "Grand Final",
        }),
      ],
    });

    expect(result.directQualifierSource).toBe("stage2-pending");
    expect(result.directQualifierIds).toBeNull();
    expect(result.input.matches).toEqual([
      { id: "stage-2-ub-r1-1", teamA: { type: "team", teamId: "a" }, teamB: { type: "team", teamId: "b" }, winnerPoints: 0 },
      { id: "stage-2-grand-final", teamA: { type: "winner", matchId: "stage-2-ub-r1-1" }, teamB: { type: "team", teamId: "c" }, winnerPoints: 0, bracketRound: "Grand Final" },
    ]);
    expect(result.pendingMatchCount).toBe(2);
    expect(result.input.teams.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("resolves completed Stage 2 final participants from the current draft", () => {
    const result = buildDraftRegionSimulation({
      region: "amer",
      teams: ["a", "b", "c", "d"].map(team),
      challengerTeams: [],
      tournaments: [stage2Config()],
      matches: [
        match({ id: "stage-2-ub-r1-1", teamA: "a", teamB: "b", status: "completed", winner: "a" }),
        match({
          id: "stage-2-grand-final",
          teamA: "winner:stage-2-ub-r1-1",
          teamB: "c",
          status: "completed",
          winner: "c",
          bracketRound: "Grand Final",
        }),
      ],
    });

    expect(result.directQualifierSource).toBe("stage2-final");
    expect(result.directQualifierIds).toEqual(["c", "a"]);
    expect(result.includedMatchCount).toBe(2);
    expect(result.pendingMatchCount).toBe(0);
    expect(result.warnings.some((warning) => warning.includes("最终确定值"))).toBe(true);
  });

  it("keeps external Stage 2 teams out of championship-point totals while allowing direct qualification", () => {
    const result = buildDraftRegionSimulation({
      region: "amer",
      teams: ["a", "b", "c", "d"].map(team),
      challengerTeams: [team("challenger")],
      tournaments: [stage2Config()],
      matches: [match({
        id: "stage-2-grand-final",
        teamA: "a",
        teamB: "challenger",
        status: "completed",
        winner: "challenger",
        bracketRound: "Grand Final",
      })],
    });

    expect(result.directQualifierIds).toEqual(["challenger", "a"]);
    expect(result.championshipPointEligibleTeamIds).toEqual(["a", "b", "c", "d"]);
    expect(result.input.teams.find((item) => item.id === "challenger")?.basePoints).toBe(0);
  });

  it("rejects an unresolved Stage 2 entry instead of skipping it", () => {
    expect(() => buildDraftRegionSimulation({
      region: "amer",
      teams: ["a", "b", "c", "d"].map(team),
      challengerTeams: [],
      tournaments: [stage2Config()],
      matches: [match({ id: "stage-2-grand-final", teamA: "winner:missing", teamB: "a", bracketRound: "Grand Final" })],
    })).toThrow("DRAFT_ANALYSIS_UNRESOLVED_ENTRY");
  });

  it("accepts the 22 pending matches used by a normal end-of-Stage-2 draft", () => {
    const teams = Array.from({ length: 23 }, (_, index) => team(`t-${index + 1}`));
    const matches = Array.from({ length: 22 }, (_, index) => match({
      id: `stage-2-match-${index + 1}`,
      teamA: index === 0 ? "t-1" : `winner:stage-2-match-${index}`,
      teamB: `t-${index + 2}`,
      ...(index === 21 ? { bracketRound: "Grand Final" } : {}),
    }));

    const result = buildDraftRegionSimulation({
      region: "amer",
      teams,
      challengerTeams: [],
      tournaments: [stage2Config()],
      matches,
    });

    expect(result.pendingMatchCount).toBe(22);
    expect(result.includedMatchCount).toBe(22);
  });

  it("includes the complete Masters placement points in historical totals", () => {
    const teams = Array.from({ length: 10 }, (_, index) => team(String.fromCharCode(97 + index)));
    const mastersMatch = (id: string, teamA: string, teamB: string, winner: string) => match({
      id,
      eventId: "masters-2",
      region: "global",
      stage: "masters-2",
      status: "completed",
      teamA,
      teamB,
      winner,
    });
    const result = buildDraftRegionSimulation({
      region: "amer",
      teams,
      challengerTeams: [],
      tournaments: [{ ...stage2Config(), groupRecords: [] }],
      matches: [
        mastersMatch("masters-2-playoffs-grand-final", "a", "b", "a"),
        mastersMatch("masters-2-playoffs-lbf", "c", "d", "c"),
        mastersMatch("masters-2-playoffs-lower-semifinal", "e", "f", "e"),
        mastersMatch("masters-2-playoffs-lbr2-1", "g", "h", "g"),
        mastersMatch("masters-2-playoffs-lbr2-2", "i", "j", "i"),
        match({ id: "stage-2-grand-final", teamA: "a", teamB: "b", bracketRound: "Grand Final" }),
      ],
    });

    const points = new Map(result.input.teams.map((item) => [item.id, item.basePoints]));
    expect(points.get("a")).toBe(8);
    expect(points.get("b")).toBe(6);
    expect(points.get("d")).toBe(5);
    expect(points.get("f")).toBe(4);
    expect(points.get("h")).toBe(3);
    expect(points.get("j")).toBe(3);
  });

  it("resolves seed references in a completed Masters bracket", () => {
    const teams = ["a", "b", "c", "d", "e", "f", "g", "h"].map(team);
    const mastersMatch = (id: string, teamA: string, teamB: string, winner: string) => match({
      id,
      eventId: "masters-2",
      region: "global",
      stage: "masters-2",
      status: "completed",
      teamA,
      teamB,
      winner,
    });
    const result = buildDraftRegionSimulation({
      region: "amer",
      teams,
      challengerTeams: [],
      tournaments: [{ ...stage2Config(), groupRecords: [] }],
      matches: [
        mastersMatch("masters-2-playoffs-ubqf-1", "seed:a", "b", "seed:a"),
        mastersMatch("masters-2-playoffs-ubqf-2", "c", "d", "c"),
        mastersMatch("masters-2-playoffs-ubqf-3", "e", "f", "e"),
        mastersMatch("masters-2-playoffs-ubqf-4", "g", "h", "g"),
        mastersMatch("masters-2-playoffs-ubsf-1", "winner:masters-2-playoffs-ubqf-1", "winner:masters-2-playoffs-ubqf-2", "winner:masters-2-playoffs-ubqf-1"),
        mastersMatch("masters-2-playoffs-ubsf-2", "winner:masters-2-playoffs-ubqf-3", "winner:masters-2-playoffs-ubqf-4", "winner:masters-2-playoffs-ubqf-3"),
        mastersMatch("masters-2-playoffs-ub-final", "winner:masters-2-playoffs-ubsf-1", "winner:masters-2-playoffs-ubsf-2", "winner:masters-2-playoffs-ubsf-1"),
        mastersMatch("masters-2-playoffs-grand-final", "winner:masters-2-playoffs-ub-final", "c", "winner:masters-2-playoffs-ub-final"),
        match({ id: "stage-2-grand-final", teamA: "a", teamB: "b", bracketRound: "Grand Final" }),
      ],
    });

    expect(result.input.teams.find((item) => item.id === "a")?.basePoints).toBe(8);
  });

  it("assigns Kickoff points to all four historical placements", () => {
    const teams = ["a", "b", "c", "d", "e", "f"].map(team);
    const kickoffMatch = (id: string, teamA: string, teamB: string, winner: string) => match({
      id,
      eventId: "kickoff",
      region: "amer",
      stage: "kickoff",
      status: "completed",
      teamA,
      teamB,
      winner,
    });
    const result = buildDraftRegionSimulation({
      region: "amer",
      teams,
      challengerTeams: [],
      tournaments: [{ ...stage2Config(), groupRecords: [] }],
      matches: [
        kickoffMatch("amer-kickoff-ub-final", "a", "b", "a"),
        kickoffMatch("amer-kickoff-mb-final", "c", "d", "c"),
        kickoffMatch("amer-kickoff-lb-final", "e", "f", "e"),
        match({ id: "stage-2-grand-final", teamA: "a", teamB: "b", bracketRound: "Grand Final" }),
      ],
    });

    const points = new Map(result.input.teams.map((item) => [item.id, item.basePoints]));
    expect(points.get("a")).toBe(4);
    expect(points.get("c")).toBe(3);
    expect(points.get("e")).toBe(2);
    expect(points.get("f")).toBe(1);
  });

  it("assigns regional playoff points to the lower-bracket historical placements", () => {
    const teams = ["a", "b", "c", "d", "e", "f"].map(team);
    const stage1Match = (id: string, teamA: string, teamB: string, winner: string) => match({
      id,
      eventId: "stage-1",
      region: "amer",
      stage: "stage-1",
      status: "completed",
      teamA,
      teamB,
      winner,
    });
    const result = buildDraftRegionSimulation({
      region: "amer",
      teams,
      challengerTeams: [],
      tournaments: [{ ...stage2Config(), groupRecords: [] }],
      matches: [
        stage1Match("amer-stage-1-grand-final", "a", "b", "a"),
        stage1Match("amer-stage-1-lb-final", "c", "d", "c"),
        stage1Match("amer-stage-1-lb-sf", "e", "f", "e"),
        match({ id: "stage-2-grand-final", teamA: "a", teamB: "b", bracketRound: "Grand Final" }),
      ],
    });

    const points = new Map(result.input.teams.map((item) => [item.id, item.basePoints]));
    expect(points.get("a")).toBe(6);
    expect(points.get("b")).toBe(4);
    expect(points.get("d")).toBe(3);
    expect(points.get("f")).toBe(2);
  });
});
