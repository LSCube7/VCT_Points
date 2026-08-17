import { describe, expect, it } from "vitest";
import { allDemoTeams } from "../src/lib/data/demo";
import { applyTripleEliminationSeedOrder, createFullSchedule, hydrateDraftSchedule, rebuildRegionalGroupMatches } from "../src/lib/schedule";
import { validateMatchResult } from "../src/lib/validation";

describe("2026 schedule templates", () => {
  it("creates one global Masters schedule instead of one copy per region", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const masters = schedule.tournaments.filter((tournament) => tournament.scope === "international");
    expect(masters.map((tournament) => tournament.eventId)).toEqual(["masters-1", "masters-2"]);
    for (const eventId of ["masters-1", "masters-2"]) {
      const tournament = masters.find((item) => item.eventId === eventId);
      const matches = schedule.matches.filter((match) => match.eventId === eventId);
      expect(tournament?.groupStage?.groups[0]?.teamIds).toHaveLength(8);
      expect(tournament?.bracket?.type).toBe("double-elimination");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.every((match) => match.region === "global")).toBe(true);
      expect(matches.filter((match) => match.phase === "playoffs")).toHaveLength(14);
    }
  });

  it("keeps regional Stage 1 and Stage 2 groups separate", () => {
    const schedule = createFullSchedule(allDemoTeams());
    for (const eventId of ["stage-1", "stage-2"]) {
      const matches = schedule.matches.filter((match) => match.eventId === eventId && match.phase === "group");
      expect(new Set(matches.map((match) => match.region))).toEqual(new Set(["amer", "emea", "pacific", "china"]));
    }
  });

  it("creates a complete 12-team Kickoff triple-elimination graph", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const tournament = schedule.tournaments.find((item) => item.id === "kickoff-amer");
    const matches = schedule.matches.filter((match) => match.eventId === "kickoff" && match.region === "amer");
    const roundCounts = new Map<string, number>();
    for (const match of matches) roundCounts.set(match.bracketRound ?? "", (roundCounts.get(match.bracketRound ?? "") ?? 0) + 1);

    expect(tournament?.bracket?.type).toBe("triple-elimination");
    expect(tournament?.bracket?.teamRefs).toHaveLength(12);
    expect(matches).toHaveLength(30);
    expect(roundCounts).toEqual(new Map([
      ["Upper Bracket Round 1", 4],
      ["Upper Bracket Round 2", 4],
      ["Upper Bracket Round 3", 2],
      ["Upper Bracket Final", 1],
      ["Middle Bracket Round 1", 4],
      ["Middle Bracket Round 2", 2],
      ["Middle Bracket Round 3", 2],
      ["Middle Bracket Round 4", 1],
      ["Middle Bracket Final", 1],
      ["Lower Bracket Round 1", 2],
      ["Lower Bracket Round 2", 2],
      ["Lower Bracket Round 3", 2],
      ["Lower Bracket Round 4", 1],
      ["Lower Bracket Round 5", 1],
      ["Lower Bracket Final", 1],
    ]));

    const firstRoundTeams = matches
      .filter((match) => match.bracketRound === "Upper Bracket Round 1")
      .flatMap((match) => [match.teamA, match.teamB]);
    expect(firstRoundTeams.sort()).toEqual(Array.from({ length: 8 }, (_, index) => `seed:${index + 5}`).sort());
    expect(matches.filter((match) => match.bracketRound === "Upper Bracket Round 2").map((match) => match.teamA).sort()).toEqual(Array.from({ length: 4 }, (_, index) => `seed:${index + 1}`).sort());
    expect(matches.filter((match) => match.bracketRound?.endsWith("Final"))).toHaveLength(3);
    expect(matches.filter((match) => match.bracketRound?.endsWith("Final")).every((match) => match.bestOf === 5)).toBe(true);
    expect(matches.some((match) => match.bracketRound === "Grand Final")).toBe(false);

    const matchIds = new Set(matches.map((match) => match.id));
    for (const match of matches) {
      for (const participant of [match.teamA, match.teamB]) {
        if (participant.startsWith("winner:") || participant.startsWith("loser:")) {
          expect(matchIds.has(participant.slice(participant.indexOf(":") + 1))).toBe(true);
        }
      }
    }

    const participants = (id: string) => {
      const match = matches.find((candidate) => candidate.id === id);
      if (!match) throw new Error(`missing match ${id}`);
      return [match.teamA, match.teamB];
    };
    expect(participants("amer-kickoff-mb-r1-1")).toEqual([
      "loser:amer-kickoff-ub-r1-1",
      "loser:amer-kickoff-ub-r2-4",
    ]);
    expect(participants("amer-kickoff-mb-r1-4")).toEqual([
      "loser:amer-kickoff-ub-r1-4",
      "loser:amer-kickoff-ub-r2-1",
    ]);
    expect(participants("amer-kickoff-mb-r3-1")).toEqual([
      "loser:amer-kickoff-ub-r3-1",
      "winner:amer-kickoff-mb-r2-1",
    ]);
    expect(participants("amer-kickoff-mb-final")).toEqual([
      "loser:amer-kickoff-ub-final",
      "winner:amer-kickoff-mb-r4-1",
    ]);
    expect(participants("amer-kickoff-lb-r2-1")).toEqual([
      "loser:amer-kickoff-mb-r2-2",
      "winner:amer-kickoff-lb-r1-1",
    ]);
    expect(participants("amer-kickoff-lb-r3-2")).toEqual([
      "loser:amer-kickoff-mb-r3-2",
      "winner:amer-kickoff-lb-r2-2",
    ]);
    expect(participants("amer-kickoff-lb-r5-1")).toEqual([
      "loser:amer-kickoff-mb-r4-1",
      "winner:amer-kickoff-lb-r4-1",
    ]);
    expect(participants("amer-kickoff-lb-final")).toEqual([
      "loser:amer-kickoff-mb-final",
      "winner:amer-kickoff-lb-r5-1",
    ]);
  });

  it("applies manually configured seed slots without using team list order", () => {
    const teams = allDemoTeams();
    const schedule = createFullSchedule(teams);
    const tournament = schedule.tournaments.find((item) => item.id === "kickoff-amer");
    if (!tournament?.bracket) throw new Error("test fixture missing Kickoff bracket");
    const configured = {
      ...tournament,
      bracket: {
        ...tournament.bracket,
        teamRefs: ["amer-team-12", "amer-team-3", "amer-team-8", "amer-team-1", "amer-team-7", "amer-team-2", "amer-team-11", "amer-team-4", "amer-team-10", "amer-team-5", "amer-team-9", "amer-team-6"],
      },
    };
    const updated = applyTripleEliminationSeedOrder(schedule.matches, configured);
    const opening = updated.find((match) => match.id === "amer-kickoff-ub-r1-1");
    const thirdOpening = updated.find((match) => match.id === "amer-kickoff-ub-r1-3");
    const upperRoundTwo = updated.find((match) => match.id === "amer-kickoff-ub-r2-1");
    expect(opening?.teamA).toBe("amer-team-7");
    expect(opening?.teamB).toBe("amer-team-2");
    expect(thirdOpening?.teamA).toBe("amer-team-10");
    expect(thirdOpening?.teamB).toBe("amer-team-5");
    expect(upperRoundTwo?.teamA).toBe("amer-team-12");
    expect(upperRoundTwo?.teamB).toBe("winner:amer-kickoff-ub-r1-1");
  });

  it("resolves legacy regional config IDs from the existing bracket", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const tournament = schedule.tournaments.find((item) => item.id === "kickoff-amer");
    if (!tournament?.bracket) throw new Error("test fixture missing Kickoff bracket");
    const configured = {
      ...tournament,
      id: "amer-kickoff",
      bracket: { ...tournament.bracket, teamRefs: Array.from({ length: 12 }, (_, index) => `amer-team-${12 - index}`) },
    };
    const updated = applyTripleEliminationSeedOrder(schedule.matches, configured);
    expect(updated.find((match) => match.id === "amer-kickoff-ub-r1-3")?.teamA).toBe("amer-team-4");
    expect(updated.find((match) => match.id === "amer-kickoff-ub-r1-3")?.teamB).toBe("amer-team-3");
  });

  it("hydrates partial drafts so Kickoff remains visible", () => {
    const generated = createFullSchedule(allDemoTeams());
    const partialMatches = generated.matches
      .filter((match) => match.eventId !== "kickoff")
      .map(({ phase, ...match }) => match);
    const partialTournaments = generated.tournaments.filter((tournament) => tournament.eventId !== "kickoff");
    const hydrated = hydrateDraftSchedule(generated, { matches: partialMatches, tournaments: partialTournaments });
    expect(hydrated.matches.filter((match) => match.eventId === "kickoff")).toHaveLength(120);
    expect(hydrated.matches.find((match) => match.id === "amer-stage-1-alpha-1-2")?.phase).toBe("group");
    expect(hydrated.matches.find((match) => match.id === "amer-kickoff-ub-r1-3")?.phase).toBe("playoffs");
    expect(hydrated.tournaments.some((tournament) => tournament.id === "kickoff-amer")).toBe(true);
  });
});

describe("map score validation", () => {
  const base = {
    id: "m-best-of-three",
    eventId: "stage-2",
    region: "amer" as const,
    stage: "stage-2" as const,
    teamA: "a",
    teamB: "b",
    status: "completed" as const,
    winner: "a",
    maps: [
      { map: "Abyss", teamARounds: 13, teamBRounds: 8 },
      { map: "Bind", teamARounds: 13, teamBRounds: 10 },
    ],
    isRegularSeason: false,
    isTiebreaker: false,
    bestOf: 3 as const,
  };

  it("rejects a series winner that disagrees with map wins", () => {
    expect(validateMatchResult({ ...base, winner: "b" }).success).toBe(false);
  });

  it("requires a reason for forfeits and never accepts map scores", () => {
    expect(validateMatchResult({ ...base, status: "forfeit", winner: "a", maps: [], notes: "未能按时出场" }).success).toBe(true);
    expect(validateMatchResult({ ...base, status: "forfeit", winner: "a", maps: [] }).success).toBe(false);
  });
});

describe("regional group schedule synchronization", () => {
  it("rebuilds round-robin pairings from the updated groups", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const config = schedule.tournaments.find((tournament) => tournament.id === "stage-1-amer");
    if (!config?.groupStage) throw new Error("test fixture missing Stage 1 groups");
    const [alpha, omega] = config.groupStage.groups;
    if (!alpha || !omega) throw new Error("test fixture missing two groups");
    const movedTeam = omega.teamIds[0];
    const nextConfig = {
      ...config,
      groupStage: {
        ...config.groupStage,
        groups: [
          { ...alpha, name: "Alpha Updated", teamIds: [...alpha.teamIds, movedTeam] },
          { ...omega, teamIds: omega.teamIds.filter((teamId) => teamId !== movedTeam) },
        ],
      },
    };

    const rebuilt = rebuildRegionalGroupMatches(schedule.matches, nextConfig);
    const groupMatches = rebuilt.matches.filter((match) => match.eventId === "stage-1" && match.region === "amer" && match.phase === "group");
    expect(groupMatches).toHaveLength(31);
    expect(new Set(groupMatches.map((match) => match.groupId))).toEqual(new Set([alpha.id, omega.id]));
    expect(groupMatches.filter((match) => match.groupId === alpha.id)).toHaveLength(21);
    expect(groupMatches.filter((match) => match.groupId === omega.id)).toHaveLength(10);
    expect(groupMatches.some((match) => match.teamA === movedTeam || match.teamB === movedTeam)).toBe(true);
  });

  it("preserves results for pairs that stay in the same group and reports removed results", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const config = schedule.tournaments.find((tournament) => tournament.id === "stage-1-amer");
    if (!config?.groupStage) throw new Error("test fixture missing Stage 1 groups");
    const [alpha, omega] = config.groupStage.groups;
    if (!alpha || !omega) throw new Error("test fixture missing two groups");
    const existing = schedule.matches.find((match) => match.id === "amer-stage-1-alpha-1-2");
    if (!existing) throw new Error("test fixture missing group match");
    const completed = {
      ...existing,
      status: "completed" as const,
      winner: existing.teamA,
      maps: [{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }],
    };
    const matches = schedule.matches.map((match) => match.id === existing.id ? completed : match);
    const reorderedConfig = {
      ...config,
      groupStage: {
        ...config.groupStage,
        groups: [
          { ...alpha, name: "Alpha Updated", teamIds: [...alpha.teamIds].reverse() },
          omega,
        ],
      },
    };
    const reordered = rebuildRegionalGroupMatches(matches, reorderedConfig);
    const preserved = reordered.matches.find((match) => {
      const pair = new Set([match.teamA, match.teamB]);
      return match.eventId === "stage-1" && match.region === "amer" && match.groupId === alpha.id && pair.has(existing.teamA) && pair.has(existing.teamB) && pair.size === 2;
    });
    expect(preserved?.status).toBe("completed");
    expect(preserved?.winner).toBe(existing.teamA);
    expect(preserved?.maps).toEqual([{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }]);
    expect(preserved?.roundLabel).toBe("Alpha Updated · 常规赛");

    const movedTeam = alpha.teamIds[1];
    const movedConfig = {
      ...config,
      groupStage: {
        ...config.groupStage,
        groups: [
          { ...alpha, teamIds: alpha.teamIds.filter((teamId) => teamId !== movedTeam) },
          { ...omega, teamIds: [...omega.teamIds, movedTeam] },
        ],
      },
    };
    const moved = rebuildRegionalGroupMatches(matches, movedConfig);
    expect(moved.removedResults.map((match) => match.id)).toContain(existing.id);
    expect(moved.matches.some((match) => match.eventId === "stage-1" && match.region === "amer" && match.groupId === alpha.id && new Set([match.teamA, match.teamB]).has(existing.teamA) && new Set([match.teamA, match.teamB]).has(existing.teamB))).toBe(false);
  });
});
