import { describe, expect, it } from "vitest";
import { validateMatchResult } from "../src/lib/validation";

const base = {
  id: "m1",
  eventId: "e1",
  region: "amer" as const,
  stage: "stage-1" as const,
  teamA: "a",
  teamB: "b",
  status: "completed" as const,
  winner: "a",
  maps: [{ map: "Haven", teamARounds: 13, teamBRounds: 8 }],
  isRegularSeason: true,
  isTiebreaker: false,
};

describe("match validation", () => {
  it("accepts a completed match with map rounds", () => {
    expect(validateMatchResult(base).success).toBe(true);
  });

  it("rejects a completed match without a winner", () => {
    expect(validateMatchResult({ ...base, winner: undefined }).success).toBe(false);
  });

  it("allows scheduled matches without map data", () => {
    expect(validateMatchResult({ ...base, status: "scheduled", winner: undefined, maps: [] }).success).toBe(true);
  });
});
