import { describe, expect, it } from "vitest";
import { allDemoTeams } from "../src/lib/data/demo";
import {
  calculateMastersAllocations,
  mastersDirectParticipantIds,
  mastersParticipantIds,
  mastersQualificationRef,
  mastersSwissParticipantIds,
} from "../src/lib/masters";
import { createFullSchedule, syncMastersQualificationMatches, syncMastersSwissRecordMatches } from "../src/lib/schedule";
import type { MatchResult } from "../src/lib/types";

function sourceMatch(id: string, teamA: string, teamB: string, winner: string): MatchResult {
  return {
    id,
    eventId: id.includes("stage-1") ? "stage-1" : "kickoff",
    region: id.split("-")[0] as MatchResult["region"],
    stage: id.includes("stage-1") ? "stage-1" : "kickoff",
    teamA,
    teamB,
    status: "completed",
    winner,
    maps: [],
    isRegularSeason: false,
    isTiebreaker: false,
    phase: "playoffs",
    bestOf: 3,
  };
}

describe("international Masters allocation", () => {
  it("keeps all slots pending until the source regional event has results", () => {
    const teams = allDemoTeams();
    const allocations = calculateMastersAllocations(teams);

    expect(allocations.map((allocation) => allocation.slotCount)).toEqual([3, 3, 3, 3]);
    expect(allocations.every((allocation) => allocation.teamIds.length === 0)).toBe(true);
    expect(allocations.every((allocation) => allocation.resolved === false)).toBe(true);
    expect(mastersParticipantIds(teams)).toHaveLength(0);
    expect(mastersDirectParticipantIds(teams)).toHaveLength(0);
    expect(mastersSwissParticipantIds(teams)).toHaveLength(0);
  });

  it("uses Kickoff bracket finals for Masters Santiago places", () => {
    const teams = allDemoTeams();
    const matches = ["amer", "emea", "pacific", "china"].flatMap((region) => [
      sourceMatch(`${region}-kickoff-ub-final`, `${region}-team-1`, `${region}-team-2`, `${region}-team-1`),
      sourceMatch(`${region}-kickoff-mb-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
      sourceMatch(`${region}-kickoff-lb-final`, `${region}-team-5`, `${region}-team-6`, `${region}-team-5`),
    ]);
    const allocations = calculateMastersAllocations(teams, matches, "masters-1");

    expect(allocations[0]?.teamIdsByPlacement).toEqual(["amer-team-1", "amer-team-3", "amer-team-5"]);
    expect(allocations.every((allocation) => allocation.resolved)).toBe(true);
    expect(mastersDirectParticipantIds(teams, matches, "masters-1")).toEqual([
      "amer-team-1", "emea-team-1", "pacific-team-1", "china-team-1",
    ]);
    expect(mastersSwissParticipantIds(teams, matches, "masters-1")).toHaveLength(8);
  });

  it("uses Stage 1 playoff placements for Masters London", () => {
    const teams = allDemoTeams();
    const matches = ["amer", "emea", "pacific", "china"].flatMap((region) => [
      sourceMatch(`${region}-stage-1-grand-final`, `${region}-team-1`, `${region}-team-2`, `${region}-team-1`),
      sourceMatch(`${region}-stage-1-lower-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
    ]);
    const allocations = calculateMastersAllocations(teams, matches, "masters-2");

    expect(allocations[0]?.teamIdsByPlacement).toEqual(["amer-team-1", "amer-team-2", "amer-team-4"]);
    expect(allocations.every((allocation) => allocation.resolved)).toBe(true);
  });

  it("generates global Masters slots from qualification references, never roster order", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const masters = schedule.matches.filter((match) => match.eventId === "masters-1");
    const config = schedule.tournaments.find((tournament) => tournament.id === "masters-1-global");

    expect(config?.scope).toBe("international");
    expect(masters).not.toHaveLength(0);
    expect(new Set(masters.map((match) => match.region))).toEqual(new Set(["global"]));
    expect(masters.filter((match) => match.id.includes("-swiss-r1-")).map((match) => [match.teamA, match.teamB])).toEqual([
      [mastersQualificationRef("masters-1", "amer", 2), mastersQualificationRef("masters-1", "emea", 3)],
      [mastersQualificationRef("masters-1", "emea", 2), mastersQualificationRef("masters-1", "pacific", 3)],
      [mastersQualificationRef("masters-1", "pacific", 2), mastersQualificationRef("masters-1", "china", 3)],
      [mastersQualificationRef("masters-1", "china", 2), mastersQualificationRef("masters-1", "amer", 3)],
    ]);
  });

  it("rebinds global slots when regional results are entered and preserves the global event", () => {
    const teams = allDemoTeams();
    const schedule = createFullSchedule(teams);
    const regionalResults = ["amer", "emea", "pacific", "china"].flatMap((region) => [
      sourceMatch(`${region}-kickoff-ub-final`, `${region}-team-1`, `${region}-team-2`, `${region}-team-1`),
      sourceMatch(`${region}-kickoff-mb-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
      sourceMatch(`${region}-kickoff-lb-final`, `${region}-team-5`, `${region}-team-6`, `${region}-team-5`),
    ]);
    const synced = syncMastersQualificationMatches([
      ...schedule.matches.filter((match) => match.region === "global"),
      ...regionalResults,
    ], teams);
    const swiss = synced.find((match) => match.id === "masters-1-swiss-r1-1");
    const playoff = synced.find((match) => match.id === "masters-1-playoffs-ubqf-1");

    expect([swiss?.teamA, swiss?.teamB]).toEqual(["amer-team-3", "emea-team-5"]);
    expect(playoff?.teamA).toBe("seed:amer-team-1");
  });

  it("preserves a valid manual Swiss draw change", () => {
    const teams = allDemoTeams();
    const schedule = createFullSchedule(teams);
    const regionalResults = ["amer", "emea", "pacific", "china"].flatMap((region) => [
      sourceMatch(`${region}-kickoff-ub-final`, `${region}-team-1`, `${region}-team-2`, `${region}-team-1`),
      sourceMatch(`${region}-kickoff-mb-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
      sourceMatch(`${region}-kickoff-lb-final`, `${region}-team-5`, `${region}-team-6`, `${region}-team-5`),
    ]);
    const initial = syncMastersQualificationMatches([
      ...schedule.matches.filter((match) => match.region === "global"),
      ...regionalResults,
    ], teams);
    const changed = syncMastersQualificationMatches(initial.map((match) => match.id === "masters-1-swiss-r1-2" ? { ...match, teamA: "emea-team-3" } : match), teams);

    expect(changed.find((match) => match.id === "masters-1-swiss-r1-2")?.teamA).toBe("emea-team-3");
  });

  it("keeps a two-match Swiss swap unique", () => {
    const teams = allDemoTeams();
    const schedule = createFullSchedule(teams);
    const regionalResults = ["amer", "emea", "pacific", "china"].flatMap((region) => [
      sourceMatch(`${region}-kickoff-ub-final`, `${region}-team-1`, `${region}-team-2`, `${region}-team-1`),
      sourceMatch(`${region}-kickoff-mb-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
      sourceMatch(`${region}-kickoff-lb-final`, `${region}-team-5`, `${region}-team-6`, `${region}-team-5`),
    ]);
    const initial = syncMastersQualificationMatches([
      ...schedule.matches.filter((match) => match.region === "global"),
      ...regionalResults,
    ], teams);
    const first = initial.find((match) => match.id === "masters-1-swiss-r1-2");
    const second = initial.find((match) => match.id === "masters-1-swiss-r1-3");
    if (!first || !second) throw new Error("missing Swiss matches");
    const changed = syncMastersQualificationMatches(initial.map((match) => {
      if (match.id === first.id) return { ...match, teamA: second.teamA };
      if (match.id === second.id) return { ...match, teamA: first.teamA };
      return match;
    }), teams);

    expect(changed.find((match) => match.id === first.id)?.teamA).toBe(second.teamA);
    expect(changed.find((match) => match.id === second.id)?.teamA).toBe(first.teamA);
  });

  it("places teams with 2-0 or 2-1 records into the Masters playoffs", () => {
    const teams = allDemoTeams();
    const schedule = createFullSchedule(teams);
    const regionalResults = ["amer", "emea", "pacific", "china"].flatMap((region) => [
      sourceMatch(`${region}-kickoff-ub-final`, `${region}-team-1`, `${region}-team-2`, `${region}-team-1`),
      sourceMatch(`${region}-kickoff-mb-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
      sourceMatch(`${region}-kickoff-lb-final`, `${region}-team-5`, `${region}-team-6`, `${region}-team-5`),
    ]);
    const matches = syncMastersQualificationMatches([
      ...schedule.matches.filter((match) => match.region === "global"),
      ...regionalResults,
    ], teams);
    const config = schedule.tournaments.find((tournament) => tournament.id === "masters-1-global");
    if (!config) throw new Error("missing Masters config");
    const participants = matches
      .filter((match) => match.eventId === "masters-1" && /-swiss-r1-\d+$/.test(match.id))
      .flatMap((match) => [match.teamA, match.teamB]);
    const withRecords = syncMastersSwissRecordMatches(matches, [{
      ...config,
      swissRecords: participants.map((teamId, index) => ({ teamId, record: index < 4 ? "2-1" as const : "1-2" as const })),
    }]);
    expect(withRecords.filter((match) => match.id.match(/masters-1-playoffs-ubqf-\d+$/)).map((match) => match.teamB)).toEqual(participants.slice(0, 4));
  });
});
