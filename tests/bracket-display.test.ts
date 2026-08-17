import { describe, expect, it } from "vitest";
import { resolveBracketParticipant } from "../src/lib/bracket-display";
import type { MatchResult } from "../src/lib/types";

function match(id: string, teamA: string, teamB: string, winner?: string): MatchResult {
  return {
    id,
    eventId: "amer-kickoff",
    region: "amer",
    stage: "kickoff",
    teamA,
    teamB,
    status: winner ? "completed" : "scheduled",
    winner,
    maps: [],
    isRegularSeason: false,
    isTiebreaker: false,
  };
}

describe("resolveBracketParticipant", () => {
  it("resolves winner and loser references to the completed match teams", () => {
    const matches = new Map([
      ["r1", match("r1", "LOUD", "C9", "C9")],
    ]);

    expect(resolveBracketParticipant("winner:r1", matches)).toBe("C9");
    expect(resolveBracketParticipant("loser:r1", matches)).toBe("LOUD");
  });

  it("resolves references recursively through later completed rounds", () => {
    const matches = new Map([
      ["r1", match("r1", "LOUD", "C9", "C9")],
      ["r2", match("r2", "winner:r1", "NRG", "winner:r1")],
    ]);

    expect(resolveBracketParticipant("winner:r2", matches)).toBe("C9");
    expect(resolveBracketParticipant("loser:r2", matches)).toBe("NRG");
  });

  it("leaves unresolved references unresolved so the editor can show their source", () => {
    const matches = new Map([
      ["r1", match("r1", "LOUD", "C9")],
    ]);

    expect(resolveBracketParticipant("winner:r1", matches)).toBeUndefined();
    expect(resolveBracketParticipant("seed:1", matches)).toBeUndefined();
  });
});
