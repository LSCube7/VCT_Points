import { resolveBracketParticipant } from "./bracket-display";
import { REGION_IDS } from "./types";
import type { MatchResult, RegionId, Team } from "./types";

/** VCT 2026 Masters sends three teams from each of the four regions. */
export const MASTERS_REGIONAL_SLOT_COUNT = 3;

export type MastersEventId = "masters-1" | "masters-2";
export type MastersSourceEventId = "kickoff" | "stage-1";

export interface MastersRegionAllocation {
  region: RegionId;
  slotCount: number;
  /** Resolved team IDs, in qualification order, with unresolved slots omitted. */
  teamIds: string[];
  /** A fixed-length view that preserves the official #1/#2/#3 slot positions. */
  teamIdsByPlacement: Array<string | undefined>;
  sourceEvent: MastersSourceEventId;
  resolved: boolean;
}

const sourceEventByMastersEvent: Record<MastersEventId, MastersSourceEventId> = {
  "masters-1": "kickoff",
  "masters-2": "stage-1",
};

/**
 * Stable placeholders used before the source regional tournament is complete.
 * They are intentionally not team IDs, so a roster ordering can never be
 * mistaken for an official qualification result.
 */
export function mastersQualificationRef(eventId: MastersEventId, region: RegionId, placement: number): string {
  return `qualified:${eventId}:${region}:${placement}`;
}

export function parseMastersQualificationRef(reference: string): { eventId: MastersEventId; region: RegionId; placement: number } | undefined {
  const [prefix, eventId, region, placement] = reference.split(":");
  if (prefix !== "qualified" || (eventId !== "masters-1" && eventId !== "masters-2") || !REGION_IDS.includes(region as RegionId)) return undefined;
  const parsedPlacement = Number(placement);
  if (!Number.isInteger(parsedPlacement) || parsedPlacement < 1 || parsedPlacement > MASTERS_REGIONAL_SLOT_COUNT) return undefined;
  return { eventId, region: region as RegionId, placement: parsedPlacement };
}

/** Fixed placement references for a Masters event, independent of roster order. */
export function mastersQualificationRefs(eventId: MastersEventId): Array<{ region: RegionId; placement: number; reference: string }> {
  return REGION_IDS.flatMap((region) => Array.from({ length: MASTERS_REGIONAL_SLOT_COUNT }, (_, index) => ({
    region,
    placement: index + 1,
    reference: mastersQualificationRef(eventId, region, index + 1),
  })));
}

function sourceMatchIds(eventId: MastersEventId, region: RegionId): string[] {
  if (eventId === "masters-1") {
    return [
      `${region}-kickoff-ub-final`,
      `${region}-kickoff-mb-final`,
      `${region}-kickoff-lb-final`,
    ];
  }
  return [
    `${region}-stage-1-grand-final`,
    `${region}-stage-1-grand-final`,
    `${region}-stage-1-lb-final`,
  ];
}

function placementReferences(eventId: MastersEventId, region: RegionId): string[] {
  if (eventId === "masters-1") {
    return [
      `winner:${sourceMatchIds(eventId, region)[0]}`,
      `winner:${sourceMatchIds(eventId, region)[1]}`,
      `winner:${sourceMatchIds(eventId, region)[2]}`,
    ];
  }
  const [grandFinal, , lowerFinal] = sourceMatchIds(eventId, region);
  return [`winner:${grandFinal}`, `loser:${grandFinal}`, `loser:${lowerFinal}`];
}

function resolvedPlacements(
  eventId: MastersEventId,
  region: RegionId,
  matches: MatchResult[],
  activeTeamIds: Set<string>,
): Array<string | undefined> {
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  return placementReferences(eventId, region).map((reference) => {
    const teamId = resolveBracketParticipant(reference, matchesById);
    return teamId && activeTeamIds.has(teamId) ? teamId : undefined;
  });
}

/**
 * Resolve an international event's regional quota from the source tournament.
 *
 * Masters Santiago uses Kickoff UB/MB/LB final winners as regional seeds 1/2/3.
 * Masters London uses the Stage 1 playoff champion, grand-final loser and lower
 * final loser as regional places 1/2/3. No result means a pending slot; the
 * function never falls back to the order of the team configuration.
 */
export function calculateMastersAllocations(
  teams: Team[],
  matches: MatchResult[] = [],
  eventId: MastersEventId = "masters-1",
): MastersRegionAllocation[] {
  const sourceEvent = sourceEventByMastersEvent[eventId];
  const activeTeamIdsByRegion = new Map<RegionId, Set<string>>(
    REGION_IDS.map((region) => [region, new Set(teams.filter((team) => team.active && team.region === region).map((team) => team.id))]),
  );
  const sourceMatches = matches.filter((match) => match.eventId === sourceEvent);

  return REGION_IDS.map((region) => {
    const teamIdsByPlacement = resolvedPlacements(eventId, region, sourceMatches, activeTeamIdsByRegion.get(region) ?? new Set<string>());
    return {
      region,
      slotCount: MASTERS_REGIONAL_SLOT_COUNT,
      teamIds: teamIdsByPlacement.filter((teamId): teamId is string => Boolean(teamId)),
      teamIdsByPlacement,
      sourceEvent,
      resolved: teamIdsByPlacement.every((teamId): teamId is string => Boolean(teamId)),
    };
  });
}

export function mastersParticipantIds(teams: Team[], matches: MatchResult[] = [], eventId: MastersEventId = "masters-1"): string[] {
  return calculateMastersAllocations(teams, matches, eventId).flatMap((allocation) => allocation.teamIds);
}

export function mastersDirectParticipantIds(teams: Team[], matches: MatchResult[] = [], eventId: MastersEventId = "masters-1"): string[] {
  return calculateMastersAllocations(teams, matches, eventId)
    .map((allocation) => allocation.teamIdsByPlacement[0])
    .filter((teamId): teamId is string => Boolean(teamId));
}

export function mastersSwissParticipantIds(teams: Team[], matches: MatchResult[] = [], eventId: MastersEventId = "masters-1"): string[] {
  return calculateMastersAllocations(teams, matches, eventId).flatMap((allocation) => allocation.teamIdsByPlacement.slice(1).filter((teamId): teamId is string => Boolean(teamId)));
}

export function mastersDirectParticipantRefs(eventId: MastersEventId): string[] {
  return REGION_IDS.map((region) => mastersQualificationRef(eventId, region, 1));
}

export function mastersSwissParticipantRefs(eventId: MastersEventId): string[] {
  return REGION_IDS.flatMap((region) => [mastersQualificationRef(eventId, region, 2), mastersQualificationRef(eventId, region, 3)]);
}
