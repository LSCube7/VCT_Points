import { describe, expect, it } from "vitest";
import { allDemoTeams } from "../src/lib/data/demo";
import { calculateMastersAllocations, mastersDirectParticipantIds, mastersParticipantIds, mastersSwissParticipantIds } from "../src/lib/masters";
import { createFullSchedule } from "../src/lib/schedule";

describe("international Masters allocation", () => {
  it("allocates three active teams to each region and keeps the pool at twelve", () => {
    const teams = allDemoTeams();
    const allocations = calculateMastersAllocations(teams);

    expect(allocations.map((allocation) => allocation.slotCount)).toEqual([3, 3, 3, 3]);
    expect(allocations.every((allocation) => allocation.teamIds.length === allocation.slotCount)).toBe(true);
    expect(mastersParticipantIds(teams)).toHaveLength(12);
    expect(new Set(mastersParticipantIds(teams)).size).toBe(12);
    expect(mastersDirectParticipantIds(teams)).toHaveLength(4);
    expect(mastersSwissParticipantIds(teams)).toHaveLength(8);
  });

  it("generates Masters matches as one global event using the calculated pool", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const masters = schedule.matches.filter((match) => match.eventId === "masters-1");
    const config = schedule.tournaments.find((tournament) => tournament.id === "masters-1-global");

    expect(config?.scope).toBe("international");
    expect(masters).not.toHaveLength(0);
    expect(new Set(masters.map((match) => match.region))).toEqual(new Set(["global"]));
    expect(masters.filter((match) => match.id.includes("-swiss-r1-")).map((match) => [match.teamA, match.teamB])).toEqual([
      ["amer-team-2", "emea-team-3"],
      ["emea-team-2", "pacific-team-3"],
      ["pacific-team-2", "china-team-3"],
      ["china-team-2", "amer-team-3"],
    ]);
  });
});
