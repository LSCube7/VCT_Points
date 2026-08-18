import { describe, expect, it } from "vitest";
import { allDemoChallengerTeams, allDemoTeams } from "../src/lib/data/demo";
import { applyTripleEliminationSeedOrder, createFullSchedule, hydrateDraftSchedule, rebuildRegionalGroupMatches, stage2PlayInGroupOrderProbabilities, syncGroupRecordsWithGroups, syncStage2InternationalPlayoffConfiguration } from "../src/lib/schedule";
import { validateMatchResult } from "../src/lib/validation";
import type { MatchResult } from "../src/lib/types";

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

  it("stores group-stage records by team instead of requiring match results", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const config = schedule.tournaments.find((tournament) => tournament.id === "stage-1-amer");
    if (!config?.groupStage) throw new Error("test fixture missing Stage 1 groups");
    const [alpha] = config.groupStage.groups;
    if (!alpha) throw new Error("test fixture missing Alpha group");
    const updated = syncGroupRecordsWithGroups({ ...config, groupRecords: [{ groupId: alpha.id, teamId: alpha.teamIds[0] ?? "", wins: 5, losses: 0 }] });
    expect(updated.groupRecords).toEqual([{ groupId: alpha.id, teamId: alpha.teamIds[0], wins: 5, losses: 0 }]);
    expect(syncGroupRecordsWithGroups({ ...updated, groupStage: { ...config.groupStage, groups: [{ ...alpha, teamIds: alpha.teamIds.slice(1) }] } }).groupRecords).toEqual([]);
  });

  it("migrates a complete legacy round-robin draft into team records", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const config = schedule.tournaments.find((tournament) => tournament.id === "stage-1-amer");
    if (!config) throw new Error("test fixture missing Stage 1 config");
    const legacyMatches = schedule.matches.map((match) => match.eventId === "stage-1" && match.region === "amer" && match.phase === "group"
      ? { ...match, status: "completed" as const, winner: match.teamA }
      : match);
    const migrated = syncGroupRecordsWithGroups({ ...config, groupRecords: undefined }, legacyMatches);
    expect(migrated.groupRecords).toHaveLength(12);
    expect(migrated.groupRecords?.every((record) => record.wins + record.losses === 5)).toBe(true);
  });

  it("models the non-CN Stage 1 playoff path", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const playoffs = schedule.matches.filter((match) => match.eventId === "stage-1" && match.region === "amer" && match.phase === "playoffs");
    expect(playoffs).toHaveLength(12);
    expect(playoffs.filter((match) => match.bracketRound === "Upper Bracket Round 1")).toHaveLength(2);
    expect(playoffs.filter((match) => match.bracketRound === "Upper Bracket Semifinal")).toHaveLength(2);
    expect(playoffs.filter((match) => match.bracketRound === "Lower Bracket Round 1")).toHaveLength(2);
    expect(playoffs.filter((match) => match.bracketRound === "Upper Bracket Round 1").flatMap((match) => [match.teamA, match.teamB])).toHaveLength(4);
    expect(playoffs.filter((match) => match.bracketRound === "Upper Bracket Semifinal").map((match) => match.teamA)).toEqual(["amer-team-1", "amer-team-6"]);
    expect(playoffs.filter((match) => match.bracketRound === "Lower Bracket Round 1").map((match) => match.teamB)).toEqual(["amer-team-7", "amer-team-8"]);
    expect(playoffs.find((match) => match.id === "amer-stage-1-lb-qf-1")).toMatchObject({
      teamA: "loser:amer-stage-1-ub-sf-2",
      teamB: "winner:amer-stage-1-lb-r1-1",
    });
    expect(playoffs.find((match) => match.id === "amer-stage-1-lb-qf-2")).toMatchObject({
      teamA: "loser:amer-stage-1-ub-sf-1",
      teamB: "winner:amer-stage-1-lb-r1-2",
    });
    expect(playoffs.find((match) => match.bracketRound === "Grand Final")?.bestOf).toBe(5);
    expect(playoffs.find((match) => match.id === "amer-stage-1-lb-final")?.bestOf).toBe(5);
  });

  it("adds the 12-team international Stage 2 Play-in before the main bracket", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const playoffs = schedule.matches.filter((match) => match.eventId === "stage-2" && match.region === "amer" && match.phase === "playoffs");
    const playIn = playoffs.filter((match) => match.id.includes("-play-in-"));
    const main = playoffs.filter((match) => !match.id.includes("-play-in-"));
    const roundCounts = new Map<string, number>();
    for (const match of playIn) roundCounts.set(match.bracketRound ?? "", (roundCounts.get(match.bracketRound ?? "") ?? 0) + 1);

    expect(playIn).toHaveLength(18);
    expect(roundCounts).toEqual(new Map([
      ["Play-In Upper Bracket Round 1", 4],
      ["Play-In Upper Bracket Round 2", 4],
      ["Play-In Upper Bracket Round 3", 2],
      ["Play-In Lower Bracket Round 1", 4],
      ["Play-In Lower Bracket Round 2", 2],
      ["Play-In Lower Bracket Round 3", 2],
    ]));
    expect(main).toHaveLength(12);
    expect(main.find((match) => match.id === "amer-stage-2-ub-r1-1")).toMatchObject({
      teamA: "stage2-group:stage-2:amer:omega:2",
      teamB: "winner:amer-stage-2-play-in-ub-r3-1",
    });
    expect(main.find((match) => match.id === "amer-stage-2-ub-r1-2")).toMatchObject({
      teamA: "stage2-group:stage-2:amer:alpha:2",
      teamB: "winner:amer-stage-2-play-in-ub-r3-2",
    });
    expect(main.find((match) => match.id === "amer-stage-2-ub-sf-1")).toMatchObject({
      teamA: "stage2-group:stage-2:amer:alpha:1",
      teamB: "winner:amer-stage-2-ub-r1-1",
    });
    expect(main.find((match) => match.id === "amer-stage-2-ub-sf-2")?.teamA).toBe("stage2-group:stage-2:amer:omega:1");
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-ub-r1-1")?.teamA).toBe("stage2-group:stage-2:amer:omega:6");
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-ub-r1-2")?.teamA).toBe("stage2-group:stage-2:amer:alpha:5");
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-ub-r2-2")?.teamA).toBe("stage2-group:stage-2:amer:omega:4");
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-ub-r2-4")?.teamA).toBe("stage2-group:stage-2:amer:alpha:4");
    expect(main.find((match) => match.id === "amer-stage-2-lb-r1-1")?.teamB).toBe("winner:amer-stage-2-play-in-lb-r3-1");
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-lb-r1-1")).toMatchObject({
      teamA: "loser:amer-stage-2-play-in-ub-r2-4",
      teamB: "loser:amer-stage-2-play-in-ub-r1-1",
    });
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-lb-r1-2")).toMatchObject({
      teamA: "loser:amer-stage-2-play-in-ub-r2-3",
      teamB: "loser:amer-stage-2-play-in-ub-r1-2",
    });
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-lb-r2-1")).toMatchObject({
      teamA: "winner:amer-stage-2-play-in-lb-r1-1",
      teamB: "winner:amer-stage-2-play-in-lb-r1-2",
    });
    expect(playIn.find((match) => match.id === "amer-stage-2-play-in-lb-r3-1")).toMatchObject({
      teamA: "loser:amer-stage-2-play-in-ub-r3-1",
      teamB: "winner:amer-stage-2-play-in-lb-r2-1",
    });
  });

  it("keeps Stage 2 Challengers and CN National Cup entries separate from VCT teams", () => {
    const schedule = createFullSchedule(allDemoTeams(), allDemoChallengerTeams());
    const amerConfig = schedule.tournaments.find((tournament) => tournament.id === "stage-2-amer");
    const chinaConfig = schedule.tournaments.find((tournament) => tournament.id === "stage-2-china");
    expect(amerConfig?.stage2ChallengerTeamIds).toEqual([
      "amer-challenger-1",
      "amer-challenger-2",
      "amer-challenger-3",
      "amer-challenger-4",
    ]);
    expect(chinaConfig?.stage2NationalCupTeamIds).toEqual(["china-national-cup-1", "china-national-cup-2"]);
    expect(amerConfig?.groupStage?.groups.flatMap((group) => group.teamIds).some((teamId) => teamId.includes("challenger"))).toBe(false);
    expect(schedule.matches.find((match) => match.id === "amer-stage-2-play-in-ub-r1-1")?.teamB).toBe("amer-challenger-1");
    expect(schedule.matches.find((match) => match.id === "china-stage-2-play-in-ub-r1-1")?.teamB).toBe("china-national-cup-1");
  });

  it("applies non-CN Stage 2 direct slots and Play-in half assignments", () => {
    const generated = createFullSchedule(allDemoTeams());
    const config = generated.tournaments.find((tournament) => tournament.id === "stage-2-amer");
    if (!config) throw new Error("test fixture missing AMER Stage 2 config");
    const configured = {
      ...config,
      stage2DirectPlayoffTeamIds: ["amer-team-12", "amer-team-11", "amer-team-10", "amer-team-9"],
      stage2PlayInUpperGroupOrder: "alpha-first" as const,
      stage2PlayInLowerGroupOrder: "alpha-first" as const,
    };
    const synced = syncStage2InternationalPlayoffConfiguration(generated.matches, configured);
    expect(synced.changed).toBe(true);
    expect(synced.matches.find((match) => match.id === "amer-stage-2-ub-r1-1")).toMatchObject({
      teamA: "amer-team-12",
      teamB: "winner:amer-stage-2-play-in-ub-r3-2",
    });
    expect(synced.matches.find((match) => match.id === "amer-stage-2-ub-r1-2")).toMatchObject({
      teamA: "amer-team-11",
      teamB: "winner:amer-stage-2-play-in-ub-r3-1",
    });
    expect(synced.matches.find((match) => match.id === "amer-stage-2-ub-sf-1")?.teamA).toBe("amer-team-10");
    expect(synced.matches.find((match) => match.id === "amer-stage-2-ub-sf-2")?.teamA).toBe("amer-team-9");
    expect(synced.matches.find((match) => match.id === "amer-stage-2-lb-r1-1")?.teamB).toBe("winner:amer-stage-2-play-in-lb-r3-2");
    expect(synced.matches.find((match) => match.id === "amer-stage-2-lb-r1-2")?.teamB).toBe("winner:amer-stage-2-play-in-lb-r3-1");
  });

  it("keeps an unconfigured Play-in destination as a 50/50 draw", () => {
    expect(stage2PlayInGroupOrderProbabilities()).toEqual({ "alpha-first": 0.5, "omega-first": 0.5 });
    expect(stage2PlayInGroupOrderProbabilities("alpha-first")).toEqual({ "alpha-first": 1, "omega-first": 0 });
    expect(stage2PlayInGroupOrderProbabilities("omega-first")).toEqual({ "alpha-first": 0, "omega-first": 1 });
  });

  it("hydrates non-CN Stage 2 playoff configuration without changing CN rules", () => {
    const generated = createFullSchedule(allDemoTeams());
    const amerConfig = generated.tournaments.find((tournament) => tournament.id === "stage-2-amer");
    const chinaConfig = generated.tournaments.find((tournament) => tournament.id === "stage-2-china");
    if (!amerConfig || !chinaConfig) throw new Error("test fixture missing Stage 2 config");
    const hydrated = hydrateDraftSchedule(generated, {
      matches: generated.matches,
      tournaments: [
        {
          ...amerConfig,
          stage2DirectPlayoffTeamIds: ["amer-team-12", null, "amer-team-10", "amer-team-9"],
          stage2PlayInUpperGroupOrder: "omega-first",
          stage2PlayInLowerGroupOrder: "alpha-first",
        },
        chinaConfig,
      ],
    }, allDemoTeams());
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-ub-r1-1")?.teamA).toBe("amer-team-12");
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-ub-r1-2")?.teamA).toBe("stage2-group:stage-2:amer:alpha:2");
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-ub-r1-1")?.teamB).toBe("winner:amer-stage-2-play-in-ub-r3-1");
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-lb-r1-1")?.teamB).toBe("winner:amer-stage-2-play-in-lb-r3-2");
    expect(hydrated.matches.find((match) => match.id === "china-stage-2-ub-qf-1")?.teamB).toBe("winner:china-stage-2-play-in-ub-r3-1");
    expect(hydrated.tournaments.find((tournament) => tournament.id === "stage-2-amer")?.stage2PlayInUpperGroupOrder).toBe("omega-first");
  });

  it("repairs an empty legacy Stage 2 Play-in loser bracket", () => {
    const generated = createFullSchedule(allDemoTeams());
    const legacyParticipants: Record<string, [string, string]> = {
      "amer-stage-2-play-in-lb-r1-1": ["loser:amer-stage-2-play-in-ub-r1-1", "loser:amer-stage-2-play-in-ub-r1-3"],
      "amer-stage-2-play-in-lb-r1-2": ["loser:amer-stage-2-play-in-ub-r1-2", "loser:amer-stage-2-play-in-ub-r1-4"],
      "amer-stage-2-play-in-lb-r1-3": ["loser:amer-stage-2-play-in-ub-r2-2", "loser:amer-stage-2-play-in-ub-r2-3"],
      "amer-stage-2-play-in-lb-r1-4": ["loser:amer-stage-2-play-in-ub-r2-1", "loser:amer-stage-2-play-in-ub-r2-4"],
      "amer-stage-2-play-in-lb-r2-1": ["winner:amer-stage-2-play-in-lb-r1-1", "winner:amer-stage-2-play-in-lb-r1-3"],
      "amer-stage-2-play-in-lb-r2-2": ["winner:amer-stage-2-play-in-lb-r1-2", "winner:amer-stage-2-play-in-lb-r1-4"],
      "amer-stage-2-play-in-lb-r3-1": ["loser:amer-stage-2-play-in-ub-r3-1", "winner:amer-stage-2-play-in-lb-r2-2"],
      "amer-stage-2-play-in-lb-r3-2": ["loser:amer-stage-2-play-in-ub-r3-2", "winner:amer-stage-2-play-in-lb-r2-1"],
    };
    const legacyMatches = generated.matches.map((match) => {
      const participants = legacyParticipants[match.id];
      if (participants) return { ...match, teamA: participants[0], teamB: participants[1] };
      if (match.id === "amer-stage-2-play-in-ub-r1-1") {
        return { ...match, teamA: "stage2-group:stage-2:amer:alpha:5" };
      }
      if (match.id === "amer-stage-2-play-in-ub-r2-2") {
        return { ...match, teamA: "stage2-group:stage-2:amer:alpha:4" };
      }
      if (match.id === "amer-stage-2-ub-r1-1") {
        return { ...match, teamA: "stage2-group:stage-2:amer:alpha:2" };
      }
      if (match.id === "amer-stage-2-ub-r1-2") {
        return { ...match, teamA: "stage2-group:stage-2:amer:omega:2" };
      }
      return match;
    });
    const hydrated = hydrateDraftSchedule(generated, { matches: legacyMatches, tournaments: generated.tournaments }, allDemoTeams());
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-play-in-lb-r1-1")).toMatchObject({
      teamA: "loser:amer-stage-2-play-in-ub-r2-4",
      teamB: "loser:amer-stage-2-play-in-ub-r1-1",
    });
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-play-in-lb-r2-1")).toMatchObject({
      teamA: "winner:amer-stage-2-play-in-lb-r1-1",
      teamB: "winner:amer-stage-2-play-in-lb-r1-2",
    });
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-play-in-lb-r3-2")).toMatchObject({
      teamA: "loser:amer-stage-2-play-in-ub-r3-2",
      teamB: "winner:amer-stage-2-play-in-lb-r2-2",
    });
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-play-in-ub-r1-1")?.teamA).toBe("stage2-group:stage-2:amer:omega:6");
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-play-in-ub-r2-2")?.teamA).toBe("stage2-group:stage-2:amer:omega:4");
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-ub-r1-1")?.teamA).toBe("stage2-group:stage-2:amer:omega:2");
    expect(hydrated.matches.find((match) => match.id === "amer-stage-2-ub-r1-2")?.teamA).toBe("stage2-group:stage-2:amer:alpha:2");

    const recordedLegacyMatches = legacyMatches.map((match) => match.id === "amer-stage-2-play-in-lb-r1-1"
      ? {
        ...match,
        status: "completed" as const,
        winner: match.teamA,
        maps: [{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }],
      }
      : match);
    const repairedRecorded = hydrateDraftSchedule(generated, { matches: recordedLegacyMatches, tournaments: generated.tournaments }, allDemoTeams());
    expect(repairedRecorded.matches.find((match) => match.id === "amer-stage-2-play-in-lb-r1-1")).toMatchObject({
      teamA: "loser:amer-stage-2-play-in-ub-r2-4",
      teamB: "loser:amer-stage-2-play-in-ub-r1-1",
      status: "scheduled",
      maps: [],
    });
  });

  it("hydrates legacy regional stage playoff entries into the current bracket", () => {
    const generated = createFullSchedule(allDemoTeams());
    const baseMatch = generated.matches.find((match) => match.id === "amer-stage-1-ub-r1-1");
    if (!baseMatch) throw new Error("test fixture missing regional playoff match");
    const legacyPlayoffs: MatchResult[] = Array.from({ length: 4 }, (_, index) => ({
      ...baseMatch,
      id: `amer-stage-1-r1-${index + 1}`,
      teamA: `amer-team-${index * 2 + 1}`,
      teamB: `amer-team-${index * 2 + 2}`,
      phase: undefined,
      bracketRound: undefined,
      roundLabel: "淘汰赛 · 首轮",
    }));
    const draftMatches = generated.matches
      .filter((match) => !(match.eventId === "stage-1" && match.region === "amer" && match.phase === "playoffs"))
      .concat(legacyPlayoffs);
    const hydrated = hydrateDraftSchedule(generated, { matches: draftMatches, tournaments: generated.tournaments }, allDemoTeams());
    const playoffs = hydrated.matches.filter((match) => match.eventId === "stage-1" && match.region === "amer" && match.phase === "playoffs");

    expect(playoffs).toHaveLength(12);
    expect(playoffs.some((match) => match.id === "amer-stage-1-r1-1")).toBe(false);
    expect(playoffs.find((match) => match.id === "amer-stage-1-ub-r1-1")?.teamA).toBe("amer-team-1");
    expect(playoffs.find((match) => match.id === "amer-stage-1-ub-r1-2")?.teamB).toBe("amer-team-4");
    expect(playoffs.find((match) => match.id === "amer-stage-1-ub-sf-1")?.teamA).toBe("amer-team-5");
    expect(playoffs.find((match) => match.id === "amer-stage-1-ub-sf-2")?.teamA).toBe("amer-team-6");
    expect(playoffs.find((match) => match.id === "amer-stage-1-lb-r1-1")?.teamB).toBe("amer-team-7");
    expect(playoffs.find((match) => match.id === "amer-stage-1-lb-r1-2")?.teamB).toBe("amer-team-8");
  });

  it("uses the standard eight-team bracket for CN Stage 1", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const playoffs = schedule.matches.filter((match) => match.eventId === "stage-1" && match.region === "china" && match.phase === "playoffs");
    expect(playoffs).toHaveLength(14);
    expect(playoffs.filter((match) => match.bracketRound === "Upper Bracket Quarterfinal")).toHaveLength(4);
    expect(playoffs.filter((match) => match.bracketRound === "Upper Bracket Round 1")).toHaveLength(0);
    expect(playoffs.filter((match) => match.bracketRound === "Upper Bracket Semifinal")).toHaveLength(2);
    expect(playoffs.filter((match) => match.bracketRound === "Lower Bracket Round 1")).toHaveLength(2);
    expect(playoffs.filter((match) => match.bracketRound === "Lower Bracket Quarterfinal")).toHaveLength(2);
    expect(playoffs.find((match) => match.id === "china-stage-1-lb-final")?.bestOf).toBe(5);
    expect(playoffs.find((match) => match.bracketRound === "Grand Final")?.bestOf).toBe(5);
  });

  it("uses the CN-specific ten-team Stage 2 Play-in seed bracket without decider matches", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const playoffs = schedule.matches.filter((match) => match.eventId === "stage-2" && match.region === "china" && match.phase === "playoffs");
    const playIn = playoffs.filter((match) => match.id.includes("-play-in-"));
    const main = playoffs.filter((match) => !match.id.includes("-play-in-"));
    const roundCounts = new Map<string, number>();
    for (const match of playIn) roundCounts.set(match.bracketRound ?? "", (roundCounts.get(match.bracketRound ?? "") ?? 0) + 1);

    expect(playoffs.some((match) => match.id.includes("-decider-"))).toBe(false);
    expect(playIn).toHaveLength(14);
    expect(roundCounts).toEqual(new Map([
      ["Play-In Upper Bracket Round 1", 2],
      ["Play-In Upper Bracket Round 2", 4],
      ["Play-In Upper Bracket Round 3", 2],
      ["Play-In Lower Bracket Round 1", 2],
      ["Play-In Lower Bracket Round 2", 2],
      ["Play-In Lower Bracket Round 3", 2],
    ]));
    expect(main).toHaveLength(14);
    expect(main.filter((match) => match.bracketRound === "Upper Bracket Quarterfinal").map((match) => match.teamA)).toEqual([
      "stage2-group:stage-2:china:playoff:1",
      "stage2-group:stage-2:china:playoff:2",
      "stage2-group:stage-2:china:playoff:3",
      "stage2-group:stage-2:china:playoff:4",
    ]);
    expect(main.find((match) => match.id === "china-stage-2-ub-qf-1")?.teamB).toBe("winner:china-stage-2-play-in-ub-r3-1");
    expect(main.find((match) => match.id === "china-stage-2-ub-qf-2")?.teamB).toBe("winner:china-stage-2-play-in-ub-r3-2");
    expect(main.find((match) => match.id === "china-stage-2-ub-qf-3")?.teamB).toBe("winner:china-stage-2-play-in-lb-r3-1");
    expect(main.find((match) => match.id === "china-stage-2-ub-qf-4")?.teamB).toBe("winner:china-stage-2-play-in-lb-r3-2");
    expect(playIn.find((match) => match.id === "china-stage-2-play-in-lb-r1-1")).toMatchObject({
      teamA: "loser:china-stage-2-play-in-ub-r1-1",
      teamB: "loser:china-stage-2-play-in-ub-r2-4",
    });
    expect(playIn.find((match) => match.id === "china-stage-2-play-in-lb-r1-2")).toMatchObject({
      teamA: "loser:china-stage-2-play-in-ub-r1-2",
      teamB: "loser:china-stage-2-play-in-ub-r2-2",
    });
    expect(playIn.find((match) => match.id === "china-stage-2-play-in-lb-r2-1")).toMatchObject({
      teamA: "loser:china-stage-2-play-in-ub-r2-3",
      teamB: "winner:china-stage-2-play-in-lb-r1-1",
    });
    expect(playIn.find((match) => match.id === "china-stage-2-play-in-lb-r2-2")).toMatchObject({
      teamA: "loser:china-stage-2-play-in-ub-r2-1",
      teamB: "winner:china-stage-2-play-in-lb-r1-2",
    });
    expect(playIn.find((match) => match.id === "china-stage-2-play-in-lb-r3-1")).toMatchObject({
      teamA: "loser:china-stage-2-play-in-ub-r3-1",
      teamB: "winner:china-stage-2-play-in-lb-r2-1",
    });
    expect(playIn.find((match) => match.id === "china-stage-2-play-in-lb-r3-2")).toMatchObject({
      teamA: "loser:china-stage-2-play-in-ub-r3-2",
      teamB: "winner:china-stage-2-play-in-lb-r2-2",
    });
  });

  it("removes obsolete CN Play-in placement matches and repairs Playoffs seed refs", () => {
    const generated = createFullSchedule(allDemoTeams());
    const legacyBase = generated.matches.find((match) => match.id === "china-stage-2-play-in-ub-r3-1");
    if (!legacyBase) throw new Error("test fixture missing CN Play-in semifinal");
    const legacyPlacementMatches: MatchResult[] = [
      {
        ...legacyBase,
        id: "china-stage-2-play-in-ub-r4-1",
        teamA: "winner:china-stage-2-play-in-ub-r3-1",
        teamB: "winner:china-stage-2-play-in-ub-r3-2",
        bracketRound: "Play-In Upper Bracket Final",
        roundLabel: "Stage 2 · Play-In · 胜者组决赛",
      },
      {
        ...legacyBase,
        id: "china-stage-2-play-in-lb-r4-1",
        teamA: "loser:china-stage-2-play-in-ub-r4-1",
        teamB: "winner:china-stage-2-play-in-lb-r3-2",
        bracketRound: "Play-In Lower Bracket Round 4",
        roundLabel: "Stage 2 · Play-In · 败者组第 4 轮",
        status: "completed",
        winner: "loser:china-stage-2-play-in-ub-r4-1",
        maps: [{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }],
      },
    ];
    const legacyMatches = generated.matches
      .map((match) => {
        const oldSeedRef: Record<string, string> = {
          "china-stage-2-ub-qf-1": "winner:china-stage-2-play-in-ub-r4-1",
          "china-stage-2-ub-qf-2": "loser:china-stage-2-play-in-ub-r4-1",
          "china-stage-2-ub-qf-3": "winner:china-stage-2-play-in-lb-r4-1",
          "china-stage-2-ub-qf-4": "loser:china-stage-2-play-in-lb-r4-1",
        };
        if (oldSeedRef[match.id]) return { ...match, teamB: oldSeedRef[match.id] };
        if (match.id === "china-stage-2-play-in-lb-r2-1") {
          return { ...match, teamA: "loser:china-stage-2-play-in-ub-r2-1" };
        }
        if (match.id === "china-stage-2-play-in-lb-r2-2") {
          return { ...match, teamA: "loser:china-stage-2-play-in-ub-r2-3" };
        }
        return match;
      })
      .concat(legacyPlacementMatches);
    const hydrated = hydrateDraftSchedule(generated, { matches: legacyMatches, tournaments: generated.tournaments }, allDemoTeams());
    expect(hydrated.matches.some((match) => match.id === "china-stage-2-play-in-ub-r4-1")).toBe(false);
    expect(hydrated.matches.some((match) => match.id === "china-stage-2-play-in-lb-r4-1")).toBe(false);
    expect(hydrated.matches.find((match) => match.id === "china-stage-2-ub-qf-1")?.teamB).toBe("winner:china-stage-2-play-in-ub-r3-1");
    expect(hydrated.matches.find((match) => match.id === "china-stage-2-ub-qf-4")?.teamB).toBe("winner:china-stage-2-play-in-lb-r3-2");
    expect(hydrated.matches.find((match) => match.id === "china-stage-2-play-in-lb-r2-1")?.teamA).toBe("loser:china-stage-2-play-in-ub-r2-3");
    expect(hydrated.matches.find((match) => match.id === "china-stage-2-play-in-lb-r2-2")?.teamA).toBe("loser:china-stage-2-play-in-ub-r2-1");
  });

  it("preserves manually configured CN Play-in entrants in the main Playoffs", () => {
    const generated = createFullSchedule(allDemoTeams());
    const draftMatches = generated.matches.map((match) => match.id === "china-stage-2-ub-qf-1"
      ? { ...match, teamA: "china-team-1", teamB: "china-team-9" }
      : match);
    const hydrated = hydrateDraftSchedule(generated, { matches: draftMatches, tournaments: generated.tournaments }, allDemoTeams());

    expect(hydrated.matches.find((match) => match.id === "china-stage-2-ub-qf-1")).toMatchObject({
      teamA: "china-team-1",
      teamB: "china-team-9",
    });
  });

  it("restores missing Stage 2 Play-in matches without clearing main-playoff results", () => {
    const generated = createFullSchedule(allDemoTeams());
    const draftMatches = generated.matches
      .filter((match) => !(match.eventId === "stage-2" && match.region === "amer" && match.phase === "playoffs" && match.id.includes("-play-in-")))
      .map((match) => match.id === "amer-stage-2-ub-r1-1"
        ? { ...match, status: "completed" as const, winner: match.teamA }
        : match);
    const hydrated = hydrateDraftSchedule(generated, { matches: draftMatches, tournaments: generated.tournaments }, allDemoTeams());
    const playoffs = hydrated.matches.filter((match) => match.eventId === "stage-2" && match.region === "amer" && match.phase === "playoffs");

    expect(playoffs).toHaveLength(30);
    expect(playoffs.filter((match) => match.id.includes("-play-in-"))).toHaveLength(18);
    expect(playoffs.find((match) => match.id === "amer-stage-2-ub-r1-1")).toMatchObject({
      status: "completed",
      winner: "stage2-group:stage-2:amer:omega:2",
    });
  });

  it("crosses non-CN lower quarterfinal references in an existing empty draft", () => {
    const generated = createFullSchedule(allDemoTeams());
    const draftMatches = generated.matches.map((match) => {
      if (match.id === "amer-stage-1-lb-qf-1") {
        return { ...match, teamA: "loser:amer-stage-1-ub-sf-1", teamB: "winner:amer-stage-1-lb-r1-1" };
      }
      if (match.id === "amer-stage-1-lb-qf-2") {
        return { ...match, teamA: "loser:amer-stage-1-ub-sf-2", teamB: "winner:amer-stage-1-lb-r1-2" };
      }
      return match;
    });
    const hydrated = hydrateDraftSchedule(generated, { matches: draftMatches, tournaments: generated.tournaments }, allDemoTeams());
    const lowerQuarterfinals = hydrated.matches.filter((match) => match.eventId === "stage-1" && match.region === "amer" && match.bracketRound === "Lower Bracket Quarterfinal");

    expect(lowerQuarterfinals.find((match) => match.id === "amer-stage-1-lb-qf-1")).toMatchObject({
      teamA: "loser:amer-stage-1-ub-sf-2",
      teamB: "winner:amer-stage-1-lb-r1-1",
    });
    expect(lowerQuarterfinals.find((match) => match.id === "amer-stage-1-lb-qf-2")).toMatchObject({
      teamA: "loser:amer-stage-1-ub-sf-1",
      teamB: "winner:amer-stage-1-lb-r1-2",
    });
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

    const participants = (id: string) => {
      const match = matches.find((candidate) => candidate.id === id);
      if (!match) throw new Error(`missing match ${id}`);
      return [match.teamA, match.teamB];
    };
    expect(participants("amer-kickoff-mb-r1-1")).toEqual([
      "loser:amer-kickoff-ub-r1-1",
      "loser:amer-kickoff-ub-r2-4",
    ]);
    expect(participants("amer-kickoff-mb-r1-4")).toEqual([
      "loser:amer-kickoff-ub-r1-4",
      "loser:amer-kickoff-ub-r2-1",
    ]);
    expect(participants("amer-kickoff-mb-r3-1")).toEqual([
      "loser:amer-kickoff-ub-r3-1",
      "winner:amer-kickoff-mb-r2-1",
    ]);
    expect(participants("amer-kickoff-mb-final")).toEqual([
      "loser:amer-kickoff-ub-final",
      "winner:amer-kickoff-mb-r4-1",
    ]);
    expect(participants("amer-kickoff-lb-r2-1")).toEqual([
      "loser:amer-kickoff-mb-r2-2",
      "winner:amer-kickoff-lb-r1-1",
    ]);
    expect(participants("amer-kickoff-lb-r3-2")).toEqual([
      "loser:amer-kickoff-mb-r3-2",
      "winner:amer-kickoff-lb-r2-2",
    ]);
    expect(participants("amer-kickoff-lb-r5-1")).toEqual([
      "loser:amer-kickoff-mb-r4-1",
      "winner:amer-kickoff-lb-r4-1",
    ]);
    expect(participants("amer-kickoff-lb-final")).toEqual([
      "loser:amer-kickoff-mb-final",
      "winner:amer-kickoff-lb-r5-1",
    ]);
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

  it("hydrates partial drafts so Kickoff remains visible", () => {
    const generated = createFullSchedule(allDemoTeams());
    const partialMatches = generated.matches
      .filter((match) => match.eventId !== "kickoff")
      .map(({ phase, ...match }) => match);
    const partialTournaments = generated.tournaments.filter((tournament) => tournament.eventId !== "kickoff");
    const hydrated = hydrateDraftSchedule(generated, { matches: partialMatches, tournaments: partialTournaments });
    expect(hydrated.matches.filter((match) => match.eventId === "kickoff")).toHaveLength(120);
    expect(hydrated.matches.find((match) => match.id === "amer-stage-1-alpha-1-2")?.phase).toBe("group");
    expect(hydrated.matches.find((match) => match.id === "amer-kickoff-ub-r1-3")?.phase).toBe("playoffs");
    expect(hydrated.tournaments.some((tournament) => tournament.id === "kickoff-amer")).toBe(true);
  });

  it("restores missing Masters playoff entries and normalizes their phase", () => {
    const generated = createFullSchedule(allDemoTeams());
    const missingId = "masters-2-playoffs-ubqf-3";
    const missing = generated.matches.find((match) => match.id === missingId);
    if (!missing) throw new Error("test fixture missing Masters opening match");
    const draftMatches = generated.matches
      .filter((match) => match.id !== missingId)
      .map((match) => match.id === "masters-2-playoffs-ubqf-2"
        ? { ...match, phase: undefined, bracketRound: undefined, roundLabel: undefined }
        : match);

    const hydrated = hydrateDraftSchedule(generated, { matches: draftMatches, tournaments: generated.tournaments }, allDemoTeams());
    const mastersPlayoffs = hydrated.matches.filter((match) => match.eventId === "masters-2" && match.phase === "playoffs");

    expect(mastersPlayoffs).toHaveLength(14);
    expect(hydrated.matches.find((match) => match.id === missingId)).toMatchObject({
      phase: "playoffs",
      teamA: missing.teamA,
      teamB: missing.teamB,
    });
    expect(hydrated.matches.find((match) => match.id === "masters-2-playoffs-ubqf-2")?.phase).toBe("playoffs");
  });

  it("removes legacy Swiss draw matches during draft hydration", () => {
    const generated = createFullSchedule(allDemoTeams());
    expect(generated.matches.some((match) => match.phase === "swiss")).toBe(false);
    const legacy: MatchResult = {
      id: "masters-1-swiss-r1-1",
      eventId: "masters-1",
      region: "global",
      stage: "masters-1",
      teamA: "qualified:masters-1:amer:2",
      teamB: "qualified:masters-1:emea:3",
      status: "completed",
      winner: "qualified:masters-1:amer:2",
      maps: [{ map: "Haven", teamARounds: 13, teamBRounds: 8 }],
      isRegularSeason: false,
      isTiebreaker: false,
      phase: "swiss",
      bestOf: 3,
    };
    const hydrated = hydrateDraftSchedule(generated, {
      matches: [...generated.matches, legacy],
      tournaments: generated.tournaments,
    }, allDemoTeams());
    expect(hydrated.matches.some((match) => match.id === legacy.id)).toBe(false);
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

describe("regional group schedule synchronization", () => {
  it("rebuilds round-robin pairings from the updated groups", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const config = schedule.tournaments.find((tournament) => tournament.id === "stage-1-amer");
    if (!config?.groupStage) throw new Error("test fixture missing Stage 1 groups");
    const [alpha, omega] = config.groupStage.groups;
    if (!alpha || !omega) throw new Error("test fixture missing two groups");
    const movedTeam = omega.teamIds[0];
    const nextConfig = {
      ...config,
      groupStage: {
        ...config.groupStage,
        groups: [
          { ...alpha, name: "Alpha Updated", teamIds: [...alpha.teamIds, movedTeam] },
          { ...omega, teamIds: omega.teamIds.filter((teamId) => teamId !== movedTeam) },
        ],
      },
    };

    const rebuilt = rebuildRegionalGroupMatches(schedule.matches, nextConfig);
    const groupMatches = rebuilt.matches.filter((match) => match.eventId === "stage-1" && match.region === "amer" && match.phase === "group");
    expect(groupMatches).toHaveLength(31);
    expect(new Set(groupMatches.map((match) => match.groupId))).toEqual(new Set([alpha.id, omega.id]));
    expect(groupMatches.filter((match) => match.groupId === alpha.id)).toHaveLength(21);
    expect(groupMatches.filter((match) => match.groupId === omega.id)).toHaveLength(10);
    expect(groupMatches.some((match) => match.teamA === movedTeam || match.teamB === movedTeam)).toBe(true);
  });

  it("preserves results for pairs that stay in the same group and reports removed results", () => {
    const schedule = createFullSchedule(allDemoTeams());
    const config = schedule.tournaments.find((tournament) => tournament.id === "stage-1-amer");
    if (!config?.groupStage) throw new Error("test fixture missing Stage 1 groups");
    const [alpha, omega] = config.groupStage.groups;
    if (!alpha || !omega) throw new Error("test fixture missing two groups");
    const existing = schedule.matches.find((match) => match.id === "amer-stage-1-alpha-1-2");
    if (!existing) throw new Error("test fixture missing group match");
    const completed = {
      ...existing,
      status: "completed" as const,
      winner: existing.teamA,
      maps: [{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }],
    };
    const matches = schedule.matches.map((match) => match.id === existing.id ? completed : match);
    const reorderedConfig = {
      ...config,
      groupStage: {
        ...config.groupStage,
        groups: [
          { ...alpha, name: "Alpha Updated", teamIds: [...alpha.teamIds].reverse() },
          omega,
        ],
      },
    };
    const reordered = rebuildRegionalGroupMatches(matches, reorderedConfig);
    const preserved = reordered.matches.find((match) => {
      const pair = new Set([match.teamA, match.teamB]);
      return match.eventId === "stage-1" && match.region === "amer" && match.groupId === alpha.id && pair.has(existing.teamA) && pair.has(existing.teamB) && pair.size === 2;
    });
    expect(preserved?.status).toBe("completed");
    expect(preserved?.winner).toBe(existing.teamA);
    expect(preserved?.maps).toEqual([{ map: "Abyss", teamARounds: 13, teamBRounds: 8 }]);
    expect(preserved?.roundLabel).toBe("Alpha Updated · 常规赛");

    const movedTeam = alpha.teamIds[1];
    const movedConfig = {
      ...config,
      groupStage: {
        ...config.groupStage,
        groups: [
          { ...alpha, teamIds: alpha.teamIds.filter((teamId) => teamId !== movedTeam) },
          { ...omega, teamIds: [...omega.teamIds, movedTeam] },
        ],
      },
    };
    const moved = rebuildRegionalGroupMatches(matches, movedConfig);
    expect(moved.removedResults.map((match) => match.id)).toContain(existing.id);
    expect(moved.matches.some((match) => match.eventId === "stage-1" && match.region === "amer" && match.groupId === alpha.id && new Set([match.teamA, match.teamB]).has(existing.teamA) && new Set([match.teamA, match.teamB]).has(existing.teamB))).toBe(false);
  });
});
