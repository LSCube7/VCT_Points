import { describe, expect, it } from "vitest";
import { validateMatchResult, validateTournamentConfig } from "../src/lib/validation";

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

  it("accepts a completed Swiss match with only a series score", () => {
    expect(validateMatchResult({
      ...base,
      id: "swiss-1",
      eventId: "masters-1",
      region: "global",
      stage: "masters-1",
      phase: "swiss",
      isRegularSeason: false,
      winner: "a",
      seriesScore: "2-1",
      maps: [],
    }).success).toBe(true);
  });

  it("requires a valid Swiss series score and matching winner", () => {
    const swiss = {
      ...base,
      id: "swiss-2",
      eventId: "masters-1",
      region: "global" as const,
      stage: "masters-1" as const,
      phase: "swiss" as const,
      isRegularSeason: false,
      winner: "a",
      maps: [],
    };
    expect(validateMatchResult(swiss).success).toBe(false);
    expect(validateMatchResult({ ...swiss, seriesScore: "0-2", winner: "a" }).success).toBe(false);
    expect(validateMatchResult({ ...swiss, seriesScore: "3-0" }).success).toBe(false);
  });

  it("rejects map details on a completed Swiss match", () => {
    expect(validateMatchResult({
      ...base,
      id: "swiss-3",
      eventId: "masters-1",
      region: "global",
      stage: "masters-1",
      phase: "swiss",
      isRegularSeason: false,
      winner: "a",
      seriesScore: "2-0",
    }).success).toBe(false);
  });
});

describe("tournament configuration validation", () => {
  const baseConfig = {
    id: "kickoff-amer",
    eventId: "kickoff",
    name: "Kickoff",
    scope: "regional" as const,
    format: "triple-elimination" as const,
    bracket: { type: "triple-elimination" as const, startRound: "quarterfinals" as const, teamRefs: Array.from({ length: 12 }, (_, index) => `amer-team-${index + 1}`) },
  };

  it("requires every triple-elimination seed slot to be manually assigned", () => {
    expect(validateTournamentConfig({ ...baseConfig, bracket: { ...baseConfig.bracket, teamRefs: ["seed:1"] } }).success).toBe(false);
    expect(validateTournamentConfig({ ...baseConfig, bracket: { ...baseConfig.bracket, teamRefs: ["seed:1", ...baseConfig.bracket.teamRefs.slice(1)] } }).success).toBe(false);
  });

  it("rejects duplicate triple-elimination seed slots", () => {
    expect(validateTournamentConfig({ ...baseConfig, bracket: { ...baseConfig.bracket, teamRefs: ["amer-team-1", ...baseConfig.bracket.teamRefs.slice(1, 11), "amer-team-1"] } }).success).toBe(false);
  });
});
