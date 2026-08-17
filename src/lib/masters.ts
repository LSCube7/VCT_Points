import { REGION_IDS } from "./types";
import type { RegionId, Team } from "./types";

/** VCT 2026 Masters sends three teams from each of the four regions. */
export const MASTERS_REGIONAL_SLOT_COUNT = 3;

export interface MastersRegionAllocation {
  region: RegionId;
  slotCount: number;
  teamIds: string[];
}

/**
 * Computes the international event's regional quota and current team pool.
 *
 * The quota is a rule-level value (three per region). Team IDs are limited to
 * the first three active teams available for each region until the preceding
 * regional event results are recorded and a later qualification resolver can
 * replace them.
 */
export function calculateMastersAllocations(teams: Team[]): MastersRegionAllocation[] {
  return REGION_IDS.map((region) => ({
    region,
    slotCount: MASTERS_REGIONAL_SLOT_COUNT,
    teamIds: teams
      .filter((team) => team.active && team.region === region)
      .map((team) => team.id)
      .slice(0, MASTERS_REGIONAL_SLOT_COUNT),
  }));
}

export function mastersParticipantIds(teams: Team[]): string[] {
  return calculateMastersAllocations(teams).flatMap((allocation) => allocation.teamIds);
}

export function mastersDirectParticipantIds(teams: Team[]): string[] {
  return calculateMastersAllocations(teams)
    .map((allocation) => allocation.teamIds[0])
    .filter((teamId): teamId is string => Boolean(teamId));
}

export function mastersSwissParticipantIds(teams: Team[]): string[] {
  return calculateMastersAllocations(teams).flatMap((allocation) => allocation.teamIds.slice(1));
}
