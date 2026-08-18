import { describe, expect, it } from "vitest";
import { allDemoTeams } from "../src/lib/data/demo";
import {
  calculateMastersAllocations,
  mastersDirectParticipantIds,
  mastersParticipantIds,
  mastersQualificationRef,
  mastersSwissParticipantIds,
} from "../src/lib/masters";
import {
  createFullSchedule,
  hydrateDraftSchedule,
  syncMastersQualificationTournaments,
} from "../src/lib/schedule";
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
      sourceMatch(`${region}-stage-1-lb-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
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

  it("preserves all manually configured Masters opening slots after sources resolve", () => {
    const teams = allDemoTeams();
    const schedule = createFullSchedule(teams);
    const regionalResults = ["amer", "emea", "pacific", "china"].flatMap((region) => [
      sourceMatch(`${region}-kickoff-ub-final`, `${region}-team-1`, `${region}-team-2`, `${region}-team-1`),
      sourceMatch(`${region}-kickoff-mb-final`, `${region}-team-3`, `${region}-team-4`, `${region}-team-3`),
      sourceMatch(`${region}-kickoff-lb-final`, `${region}-team-5`, `${region}-team-6`, `${region}-team-5`),
    ]);
    const manualOpenings = [
      ["emea-team-3", "pacific-team-5"],
      ["china-team-3", "amer-team-5"],
      ["pacific-team-3", "china-team-5"],
      ["amer-team-3", "emea-team-5"],
    ] as const;
    const sourceById = new Map(regionalResults.map((match) => [match.id, match]));
    const manualById = new Map(manualOpenings.map(([teamA, teamB], index) => [
      `masters-1-playoffs-ubqf-${index + 1}`,
      { teamA, teamB, status: "completed" as const, winner: teamA },
    ]));
    const draftMatches = schedule.matches.map((match) => {
      const source = sourceById.get(match.id);
      const manual = manualById.get(match.id);
      return source ? source : manual ? { ...match, ...manual } : match;
    });
    const resolvedTournaments = syncMastersQualificationTournaments(schedule.tournaments, draftMatches, teams);
    const config = resolvedTournaments.find((tournament) => tournament.id === "masters-1-global");
    if (!config) throw new Error("missing Masters config");
    const participants = config.groupStage?.groups[0]?.teamIds ?? [];
    const tournamentsWithRecords = resolvedTournaments.map((tournament) => tournament.id === config.id
      ? { ...tournament, swissRecords: participants.map((teamId, index) => ({ teamId, record: index < 4 ? "2-1" as const : "1-2" as const })) }
      : tournament);
    const hydrated = hydrateDraftSchedule(schedule, { matches: draftMatches, tournaments: tournamentsWithRecords }, teams);
    const openings = hydrated.matches
      .filter((match) => match.id.match(/masters-1-playoffs-ubqf-\d+$/))
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));

    expect(openings.map((match) => [match.teamA, match.teamB])).toEqual(manualOpenings);
    expect(openings.every((match) => match.status === "completed" && match.winner === match.teamA)).toBe(true);
  });

  it("preserves manually entered Masters playoff results while sources are pending", () => {
    const teams = allDemoTeams();
    const schedule = createFullSchedule(teams);
    const playoffId = "masters-2-playoffs-ubqf-1";
    const draftMatches = schedule.matches.map((match) => match.id === playoffId
      ? {
        ...match,
        teamA: "amer-team-1",
        teamB: "emea-team-1",
        status: "completed" as const,
        winner: "amer-team-1",
        maps: [{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }],
      }
      : match);

    const hydrated = hydrateDraftSchedule(schedule, { matches: draftMatches, tournaments: schedule.tournaments }, teams);
    const restored = hydrated.matches.find((match) => match.id === playoffId);

    expect(restored).toMatchObject({
      teamA: "amer-team-1",
      teamB: "emea-team-1",
      status: "completed",
      winner: "amer-team-1",
      maps: [{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }],
    });
  });
});
