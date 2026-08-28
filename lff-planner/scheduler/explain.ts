/**
 * Per-screening conflict explanations against a chosen schedule — powers the
 * app's screening map ("why can't I have this one?").
 */
import type { SchedulerModel } from "./model.ts";

export interface ScreeningExplanation {
  otherFilmId: string;
  otherScreeningId: string;
  reason: string;
}

/** Map of screeningId → conflicts with the chosen screenings of OTHER films. */
export function explainAgainstChosen(
  model: SchedulerModel,
  chosen: number[],
): Record<string, ScreeningExplanation[]> {
  const result: Record<string, ScreeningExplanation[]> = {};
  const chosenSet = new Set(chosen);
  for (const item of model.items) {
    for (const s of item.screenings) {
      const explanations: ScreeningExplanation[] = [];
      for (const other of model.conflicts[s.index]!) {
        if (!chosenSet.has(other)) continue;
        const o = model.screenings[other]!;
        if (o.itemIndex === s.itemIndex) continue;
        const key = s.index < other ? `${s.index}:${other}` : `${other}:${s.index}`;
        explanations.push({
          otherFilmId: o.filmId,
          otherScreeningId: o.id,
          reason: model.conflictReasons.get(key) ?? "conflict",
        });
      }
      if (explanations.length > 0) result[s.id] = explanations;
    }
  }
  return result;
}
