/**
 * Public scheduler API — pure function from the four data contracts to a
 * schedule + diagnostics. Used identically by the CLI and the app's worker.
 */
import type { ConstraintsFile, FilmsFile, ScheduleFile, SelectionsFile, VenuesFile } from "../shared/schemas.ts";
import { buildModel } from "./model.ts";
import { buildSchedule } from "./diagnose.ts";
import { solve, ConflictingPinsError } from "./solve.ts";

export { buildModel, solve, buildSchedule, ConflictingPinsError };
export { evaluate, amyPenalty } from "./model.ts";
export type { SchedulerModel, ModelItem, ModelScreening } from "./model.ts";
export type { SolveResult } from "./solve.ts";

export interface ScheduleInput {
  films: FilmsFile;
  selections: SelectionsFile;
  venues: VenuesFile;
  constraints: ConstraintsFile;
  timeBudgetMs?: number;
}

export function schedule(input: ScheduleInput): { schedule: ScheduleFile; notes: string[] } {
  const model = buildModel(input);
  const result = solve(model, input.timeBudgetMs ? { timeBudgetMs: input.timeBudgetMs } : {});
  return { schedule: buildSchedule(model, result), notes: model.notes };
}
