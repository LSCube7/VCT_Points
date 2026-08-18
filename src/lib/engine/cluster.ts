import type { ScenarioGroup } from "../types";
import { sortByDescending } from "../sorting";

export interface ScenarioFeature {
  scenarioId: string;
  points: number;
  stage2Ranks: number[];
  methods: string;
}

export interface ScenarioCluster {
  id: string;
  scenarioIds: string[];
  totalProbability: number;
  medoidScenarioId: string;
}

function distance(left: ScenarioFeature, right: ScenarioFeature): number {
  const pointDistance = Math.min(Math.abs(left.points - right.points) / 100, 1);
  const rankDistance = left.stage2Ranks.reduce(
    (total, rank, index) => total + Math.min(Math.abs(rank - (right.stage2Ranks[index] ?? rank)) / 8, 1),
    0,
  ) / Math.max(left.stage2Ranks.length, 1);
  const methodDistance = left.methods === right.methods ? 0 : 1;
  return (pointDistance + rankDistance + methodDistance) / 3;
}

function weightedSilhouette(features: ScenarioFeature[], assignments: number[], weights: number[]): number {
  if (features.length < 2) return 0;
  return features.reduce((total, feature, index) => {
    const same = features.filter((_, other) => assignments[other] === assignments[index] && other !== index);
    if (same.length === 0) return total;
    const a = same.reduce((sum, item) => sum + distance(feature, item), 0) / same.length;
    const otherClusters = [...new Set(assignments.filter((cluster) => cluster !== assignments[index]))];
    const b = Math.min(
      ...otherClusters.map((cluster) => {
        const members = features.filter((_, other) => assignments[other] === cluster);
        return members.reduce((sum, item) => sum + distance(feature, item), 0) / members.length;
      }),
    );
    return total + ((b - a) / Math.max(a, b, 0.000001)) * weights[index];
  }, 0) / weights.reduce((sum, weight) => sum + weight, 0);
}

function fitKMedoids(features: ScenarioFeature[], weights: number[], k: number): { assignments: number[]; medoids: number[] } {
  const medoids = Array.from({ length: k }, (_, index) => index);
  let assignments = features.map(() => 0);
  for (let iteration = 0; iteration < 20; iteration += 1) {
    assignments = features.map((feature) => medoids
      .map((medoid, cluster) => ({ cluster, distance: distance(feature, features[medoid]) }))
      .sort((left, right) => left.distance - right.distance || left.cluster - right.cluster)[0].cluster);
    let changed = false;
    for (let cluster = 0; cluster < k; cluster += 1) {
      const members = features.map((_, index) => index).filter((index) => assignments[index] === cluster);
      if (members.length === 0) continue;
      const occupied = new Set(medoids.filter((_, index) => index !== cluster));
      const candidates = members.filter((candidate) => !occupied.has(candidate));
      const best = (candidates.length > 0 ? candidates : members)
        .map((candidate) => ({
          candidate,
          cost: members.reduce((total, member) => total + distance(features[candidate], features[member]) * weights[member], 0),
        }))
        .sort((left, right) => left.cost - right.cost || features[left.candidate].scenarioId.localeCompare(features[right.candidate].scenarioId))[0].candidate;
      if (medoids[cluster] !== best) {
        medoids[cluster] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }
  assignments = features.map((feature) => medoids
    .map((medoid, cluster) => ({ cluster, distance: distance(feature, features[medoid]) }))
    .sort((left, right) => left.distance - right.distance || left.cluster - right.cluster)[0].cluster);
  return { assignments, medoids };
}

export function clusterScenarios(
  scenarios: ScenarioGroup[],
  features: ScenarioFeature[],
  requestedK?: number,
): { recommendedK: number; clusters: ScenarioCluster[]; scores: Record<number, number> } {
  if (scenarios.length === 0) return { recommendedK: 0, clusters: [], scores: {} };
  const weights = scenarios.map((scenario) => scenario.probability.percentage / 100);
  const maxK = Math.min(8, features.length);
  const scores: Record<number, number> = {};
  let recommendedK = 1;
  let bestScore = Number.NEGATIVE_INFINITY;
  const fits: Record<number, { assignments: number[]; medoids: number[] }> = {};
  for (let k = 2; k <= maxK; k += 1) {
    const fit = fitKMedoids(features, weights, k);
    fits[k] = fit;
    const score = weightedSilhouette(features, fit.assignments, weights);
    scores[k] = score;
    if (score > bestScore) {
      bestScore = score;
      recommendedK = k;
    }
  }
  const k = Math.max(1, Math.min(requestedK ?? recommendedK, maxK));
  const selected = k === 1 ? fitKMedoids(features, weights, 1) : (fits[k] ?? fitKMedoids(features, weights, k));
  const assignments = selected.assignments;
  const clusters: ScenarioCluster[] = sortByDescending(Array.from({ length: k }, (_, clusterIndex) => {
    const members = features
      .map((feature, index) => ({ feature, index }))
      .filter(({ index }) => assignments[index] === clusterIndex);
    return {
      id: `cluster-${clusterIndex + 1}`,
      scenarioIds: members.map(({ feature }) => feature.scenarioId),
      totalProbability: members.reduce((sum, { index }) => sum + weights[index], 0),
      medoidScenarioId: features[selected.medoids[clusterIndex]]?.scenarioId ?? "",
    };
  }), (cluster) => cluster.totalProbability, (cluster) => cluster.id);
  return { recommendedK, clusters, scores };
}
