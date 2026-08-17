import { describe, expect, it } from "vitest";
import { allDemoTeams } from "../src/lib/data/demo";
import { applyTripleEliminationSeedOrder, createFullSchedule } from "../src/lib/schedule";
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
