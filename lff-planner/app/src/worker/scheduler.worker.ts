/** Runs the exact solver off the main thread. Same code as the CLI. */
import type { ConstraintsFile, FilmsFile, ScheduleFile, SelectionsFile, VenuesFile } from "@shared/schemas.ts";
import { buildModel, buildSchedule, solve, ConflictingPinsError } from "@scheduler/index.ts";
import { explainAgainstChosen, type ScreeningExplanation } from "@scheduler/explain.ts";

export interface WorkerRequest {
  films: FilmsFile;
  selections: SelectionsFile;
  venues: VenuesFile;
  constraints: ConstraintsFile;
}

export type WorkerResponse =
  | {
      ok: true;
      schedule: ScheduleFile;
      notes: string[];
      explain: Record<string, ScreeningExplanation[]>;
    }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const model = buildModel(event.data);
    const result = solve(model);
    const schedule = buildSchedule(model, result);
    const explain = explainAgainstChosen(model, result.chosen);
    const response: WorkerResponse = { ok: true, schedule, notes: model.notes, explain };
    self.postMessage(response);
  } catch (err) {
    const error =
      err instanceof ConflictingPinsError
        ? `${err.message} — unpin one of them and recompute.`
        : err instanceof Error
          ? err.message
          : String(err);
    self.postMessage({ ok: false, error } satisfies WorkerResponse);
  }
};
