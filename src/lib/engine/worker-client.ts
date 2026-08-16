import type { BracketRegionSimulationInput, RegionAnalysis, RegionSimulationInput } from "../types";

export function runRegionWorker(input: RegionSimulationInput): { promise: Promise<RegionAnalysis>; cancel: () => void } {
  const worker = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url));
  const promise = new Promise<RegionAnalysis>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ type: "complete" | "error"; result?: RegionAnalysis; message?: string }>) => {
      if (event.data.type === "complete" && event.data.result) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.message ?? "ANALYSIS_FAILED"));
      }
      worker.terminate();
    };
    worker.onerror = () => {
      reject(new Error("ANALYSIS_WORKER_CRASHED"));
      worker.terminate();
    };
    worker.postMessage({ type: "calculate", input });
  });
  return { promise, cancel: () => { worker.postMessage({ type: "cancel" }); worker.terminate(); } };
}

export function runBracketWorker(input: BracketRegionSimulationInput): { promise: Promise<RegionAnalysis>; cancel: () => void } {
  const worker = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url));
  const promise = new Promise<RegionAnalysis>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ type: "complete" | "error"; result?: RegionAnalysis; message?: string }>) => {
      if (event.data.type === "complete" && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.message ?? "ANALYSIS_FAILED"));
      worker.terminate();
    };
    worker.onerror = () => { reject(new Error("ANALYSIS_WORKER_CRASHED")); worker.terminate(); };
    worker.postMessage({ type: "calculate-bracket", input });
  });
  return { promise, cancel: () => { worker.postMessage({ type: "cancel" }); worker.terminate(); } };
}
