import { describe, expect, it } from "vitest";
import { allDemoTeams } from "../src/lib/data/demo";
import { createFullSchedule } from "../src/lib/schedule";
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
