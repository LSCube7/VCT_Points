import { enumerateRegion } from "@/lib/engine/exact";
import { enumerateBracketRegion } from "@/lib/engine/bracket";
import type { BracketRegionSimulationInput, RegionSimulationInput } from "@/lib/types";

type WorkerRequest = { type: "calculate"; input: RegionSimulationInput } | { type: "calculate-bracket"; input: BracketRegionSimulationInput } | { type: "cancel" };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "cancel") return;
  try {
    const result = event.data.type === "calculate-bracket" ? enumerateBracketRegion(event.data.input) : enumerateRegion(event.data.input);
    self.postMessage({ type: "complete", result });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "ANALYSIS_FAILED" });
  }
};
