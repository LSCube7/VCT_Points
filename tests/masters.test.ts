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
    expect(masters.some((match) => match.phase === "swiss")).toBe(false);
    expect(config?.groupStage?.groups[0]?.teamIds).toEqual([
      mastersQualificationRef("masters-1", "amer", 2),
      mastersQualificationRef("masters-1", "amer", 3),
      mastersQualificationRef("masters-1", "emea", 2),
      mastersQualificationRef("masters-1", "emea", 3),
      mastersQualificationRef("masters-1", "pacific", 2),
      mastersQualificationRef("masters-1", "pacific", 3),
      mastersQualificationRef("masters-1", "china", 2),
      mastersQualificationRef("masters-1", "china", 3),
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
    const playoff = synced.find((match) => match.id === "masters-1-playoffs-ubqf-1");

    expect(synced.some((match) => match.id.includes("-swiss-"))).toBe(false);
    expect(playoff?.teamA).toBe("seed:amer-team-1");
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
    const participants = config.groupStage?.groups[0]?.teamIds ?? [];
    const withRecords = syncMastersSwissRecordMatches(matches, [{
      ...config,
      swissRecords: participants.map((teamId, index) => ({ teamId, record: index < 4 ? "2-1" as const : "1-2" as const })),
    }]);
    expect(withRecords.filter((match) => match.id.match(/masters-1-playoffs-ubqf-\d+$/)).map((match) => match.teamB)).toEqual(participants.slice(0, 4));
  });
});
