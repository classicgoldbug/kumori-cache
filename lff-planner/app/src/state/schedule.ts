import { signal } from "@preact/signals";
import { ConstraintsFileSchema, type ConstraintsFile, type ScheduleFile } from "@shared/schemas.ts";
import type { ScreeningExplanation } from "@scheduler/explain.ts";
import type { WorkerRequest, WorkerResponse } from "../worker/scheduler.worker.ts";
import { filmsFile, venuesFile } from "./films.ts";
import { selections } from "./selections.ts";

export interface ScheduleState {
  schedule: ScheduleFile;
  notes: string[];
  explain: Record<string, ScreeningExplanation[]>;
  /** Snapshot of when this result was computed, for staleness hints. */
  computedAt: string;
}

export const scheduleState = signal<ScheduleState | null>(null);
export const scheduleRunning = signal(false);
export const scheduleError = signal<string | null>(null);

let constraints: ConstraintsFile | null = null;
let worker: Worker | null = null;

export async function runScheduler(): Promise<void> {
  const films = filmsFile.value;
  const venues = venuesFile.value;
  const sels = selections.value;
  if (!films || !venues || !sels || scheduleRunning.value) return;

  scheduleRunning.value = true;
  scheduleError.value = null;
  try {
    if (!constraints) {
      const res = await fetch("data/constraints.json");
      if (!res.ok) throw new Error(`constraints.json: HTTP ${res.status}`);
      constraints = ConstraintsFileSchema.parse(await res.json());
    }
    if (!worker) {
      worker = new Worker(new URL("../worker/scheduler.worker.ts", import.meta.url), { type: "module" });
    }
    const request: WorkerRequest = { films, selections: sels, venues, constraints };
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      worker!.onmessage = (e: MessageEvent<WorkerResponse>) => resolve(e.data);
      worker!.onerror = (e) => reject(new Error(e.message || "scheduler worker failed"));
      worker!.postMessage(request);
    });
    if (!response.ok) {
      scheduleError.value = response.error;
      return;
    }
    scheduleState.value = {
      schedule: response.schedule,
      notes: response.notes,
      explain: response.explain,
      computedAt: new Date().toISOString(),
    };
  } catch (err) {
    scheduleError.value = err instanceof Error ? err.message : String(err);
  } finally {
    scheduleRunning.value = false;
  }
}
