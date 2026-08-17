import { describe, expect, it } from "vitest";
import { allDemoTeams } from "../src/lib/data/demo";
import { migrateKickoffSchedule, inspectKickoffScheduleMigration } from "../src/lib/schedule-migration";
import { createFullSchedule } from "../src/lib/schedule";

function legacyKickoffPayload() {
  const teams = allDemoTeams();
  const schedule = createFullSchedule(teams);
  const currentKickoff = schedule.matches.filter((match) => match.eventId === "kickoff" && match.region === "amer");
  const opening = currentKickoff.filter((match) => match.bracketRound === "Upper Bracket Round 1").map((match, index) => ({
    ...match,
    id: `amer-kickoff-r1-${index + 1}`,
    bracketRound: "Opening Round",
    roundLabel: "淘汰赛首轮",
  }));
  const later = [
    { ...currentKickoff[4], id: "amer-kickoff-r2-1", bracketRound: "Semifinal", teamA: "amer-team-5", teamB: "amer-team-7" },
    { ...currentKickoff[5], id: "amer-kickoff-r2-2", bracketRound: "Semifinal", teamA: "amer-team-9", teamB: "amer-team-11" },
    { ...currentKickoff[6], id: "amer-kickoff-final", bracketRound: "Final", teamA: "amer-team-5", teamB: "amer-team-9" },
  ];
  return {
    teams,
    matches: [...schedule.matches.filter((match) => !(match.eventId === "kickoff" && match.region === "amer")), ...opening, ...later],
    tournaments: schedule.tournaments,
  };
}

describe("Kickoff schedule migration", () => {
  it("preserves old opening-round configuration and results", () => {
    const payload = legacyKickoffPayload();
    const first = payload.matches.find((match) => match.id === "amer-kickoff-r1-1");
    if (!first) throw new Error("test fixture missing opening match");
    first.teamA = "amer-team-12";
    first.teamB = "amer-team-5";
    first.status = "completed";
    first.winner = "amer-team-12";
    first.maps = [{ map: "Abyss", teamARounds: 13, teamBRounds: 9 }];

    const preview = inspectKickoffScheduleMigration(payload.matches);
    expect(preview.legacyRegions).toContain("amer");
    expect(preview.blockedRegions).toEqual([]);
    expect(preview.canMigrate).toBe(true);

    const migrated = migrateKickoffSchedule(payload);
    const kickoffMatches = migrated.matches.filter((match) => match.eventId === "kickoff" && match.region === "amer");
    const migratedOpening = kickoffMatches.find((match) => match.id === "amer-kickoff-ub-r1-1");
    expect(kickoffMatches).toHaveLength(30);
    expect(migratedOpening).toMatchObject({ teamA: "amer-team-12", teamB: "amer-team-5", status: "completed", winner: "amer-team-12" });
    expect(migratedOpening?.maps).toEqual([{ map: "Abyss", teamARounds: 13, teamBRounds: 9 }]);
    expect(kickoffMatches.some((match) => match.id === "amer-kickoff-final")).toBe(false);
    expect(migrated.tournaments.find((tournament) => tournament.id === "kickoff-amer")?.bracket?.teamRefs).toHaveLength(12);
  });

  it("blocks migration when an old later-round result exists", () => {
    const payload = legacyKickoffPayload();
    const oldSemifinal = payload.matches.find((match) => match.id === "amer-kickoff-r2-1");
    if (!oldSemifinal) throw new Error("test fixture missing later match");
    oldSemifinal.status = "completed";
    oldSemifinal.winner = oldSemifinal.teamA;

    const preview = inspectKickoffScheduleMigration(payload.matches);
    expect(preview.blockedRegions).toEqual(["amer"]);
    expect(() => migrateKickoffSchedule(payload)).toThrow("KICKOFF_MIGRATION_HAS_RESULTS:amer");
  });
});
