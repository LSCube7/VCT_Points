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

  it("matches winner and loser slots by a supplied team identity", () => {
    const matches = new Map([
      ["r1", match("r1", "G2", "XLG", "xlg-team-id")],
    ]);
    const identity = (reference: string) => ({ G2: "g2-team-id", XLG: "xlg-team-id", "xlg-team-id": "xlg-team-id" }[reference] ?? reference);

    expect(resolveBracketParticipant("loser:r1", matches, new Set<string>(), identity)).toBe("G2");
  });

  it("resolves completed downstream slots when the source match key uses a different reference spelling", () => {
    const matches = new Map([
      ["legacy-r1", match(" r1 ", "PRX", "LEV", "PRX")],
      ["sf", match("sf", "winner:r1", "VIT", "winner:r1")],
    ]);

    expect(resolveBracketParticipant("winner:r1", matches)).toBe("PRX");
    expect(resolveBracketParticipant("loser:r1", matches)).toBe("LEV");
    expect(resolveBracketParticipant("winner:sf", matches)).toBe("PRX");
  });

  it("resolves concrete team seed references but keeps pending seed placeholders unresolved", () => {
    const matches = new Map([
      ["r1", match("r1", "seed:pacific-team-6", "LEV", "seed:pacific-team-6")],
    ]);

    expect(resolveBracketParticipant("winner:r1", matches)).toBe("seed:pacific-team-6");
    expect(resolveBracketParticipant("loser:r1", matches)).toBe("LEV");
    expect(resolveBracketParticipant("seed:1", matches)).toBeUndefined();
    expect(resolveBracketParticipant("seed:qualified:masters-2:pacific:1", matches)).toBeUndefined();
  });

  it("leaves unresolved references unresolved so the editor can show their source", () => {
    const matches = new Map([
      ["r1", match("r1", "LOUD", "C9")],
    ]);

    expect(resolveBracketParticipant("winner:r1", matches)).toBeUndefined();
    expect(resolveBracketParticipant("seed:1", matches)).toBeUndefined();
  });
});
