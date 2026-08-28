/**
 * Turns a solve result into the schedule.json contract, including the parts
 * the user actually reasons with: why each unscheduled film missed out, what
 * forcing it in would displace, per-day Amy counts vs her targets, and
 * tight-transfer warnings.
 */
import type { ScheduleFile } from "../shared/schemas.ts";
import { addDays, minutesToHm, weekdayOf } from "../shared/time.ts";
import { travelMinutes } from "../shared/venues.ts";
import { amyPenalty, type ModelItem, type SchedulerModel } from "./model.ts";
import { solve, type SolveResult } from "./solve.ts";

/** Time budget for each forced-inclusion re-solve. */
const ALTERNATIVE_BUDGET_MS = 500;
/** Warn when a transfer has less than this many minutes in hand beyond travel+buffer. */
const TIGHT_SLACK_MINUTES = 10;

function isoFromModel(model: SchedulerModel, minutes: number): string {
  const date = addDays(model.startDate, Math.floor(minutes / 1440));
  return `${date}T${minutesToHm(minutes)}:00+01:00`;
}

export function buildSchedule(model: SchedulerModel, result: SolveResult): ScheduleFile {
  const chosenSet = new Set(result.chosen);
  const chosenItems = new Set(result.chosen.map((i) => model.screenings[i]!.itemIndex));

  const chosen: ScheduleFile["chosen"] = result.chosen.map((index) => {
    const s = model.screenings[index]!;
    const item = model.items[s.itemIndex]!;
    const attendees: ("tristan" | "amy")[] = [];
    if (s.tristanAttends) attendees.push("tristan");
    if (s.amyAttends) attendees.push("amy");
    return {
      filmId: s.filmId,
      screeningId: s.id,
      start: isoFromModel(model, s.startMin),
      end: isoFromModel(model, s.endMin),
      venue: s.venue,
      attendees,
      value: s.value,
      pinned: item.pinnedScreeningId === s.id,
    };
  });

  // --- Unscheduled films, with forced-inclusion alternatives -------------
  const unscheduled: ScheduleFile["unscheduled"] = [];
  for (const item of model.items) {
    if (chosenItems.has(item.index)) continue;
    unscheduled.push(diagnoseUnscheduled(model, result, item));
  }

  // --- Per-day summary ---------------------------------------------------
  const days: ScheduleFile["days"] = model.festivalDates.map((date) => {
    let tristanCount = 0;
    let amyCount = 0;
    for (const index of result.chosen) {
      const s = model.screenings[index]!;
      if (s.date !== date) continue;
      if (s.tristanAttends) tristanCount += 1;
      if (s.amyAttends) amyCount += 1;
    }
    const target = model.amyAbsenceDates.has(date) ? null : (model.constraints.amyDayTargets[weekdayOf(date)] ?? null);
    let penalty = 0;
    if (target) {
      const w = model.constraints.weights;
      if (amyCount < target.min) penalty = (target.min - amyCount) * w.amyBelowTargetPenalty;
      else if (amyCount > target.max) penalty = (amyCount - target.max) * w.amyAboveTargetPenalty;
    }
    return { date, tristanCount, amyCount, amyTarget: target, penalty };
  });

  // --- Transfer warnings --------------------------------------------------
  const warnings: ScheduleFile["warnings"] = [];
  const ordered = [...result.chosen].sort((a, b) => model.screenings[a]!.startMin - model.screenings[b]!.startMin);
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = model.screenings[ordered[i]!]!;
    const b = model.screenings[ordered[i + 1]!]!;
    if (a.date !== b.date) continue;
    const travel = travelMinutes(model.venues, a.venue, b.venue);
    const slack = b.startMin - a.endMin - travel.minutes - model.venues.bufferMinutes;
    if (!travel.known) {
      warnings.push({
        type: "unknown-venue-pair",
        from: a.id,
        to: b.id,
        slackMinutes: slack,
        message: `No travel time configured for ${a.venue} → ${b.venue}; assumed ${travel.minutes} min`,
      });
    }
    if (slack < TIGHT_SLACK_MINUTES) {
      warnings.push({
        type: "tight-transfer",
        from: a.id,
        to: b.id,
        slackMinutes: slack,
        message: `${slack} min slack after ${travel.minutes} min travel + ${model.venues.bufferMinutes} min buffer (${a.venue} → ${b.venue})`,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    objective: result.objective,
    optimal: result.optimal,
    nodesExplored: result.nodesExplored,
    solveMs: result.solveMs,
    chosen,
    unscheduled,
    days,
    warnings,
  };
}

function diagnoseUnscheduled(
  model: SchedulerModel,
  mainResult: SolveResult,
  item: ModelItem,
): ScheduleFile["unscheduled"][number] {
  if (item.emptyReason) {
    return {
      filmId: item.filmId,
      reason: item.emptyReason,
      detail:
        item.emptyReason === "amy-absent-all-screenings"
          ? "Amy is away for every screening of this Amy-only film."
          : "Every screening of this film has been excluded.",
      alternatives: [],
    };
  }

  // Force the film in at each eligible screening and measure the damage.
  const alternatives: ScheduleFile["unscheduled"][number]["alternatives"] = [];
  const mainItems = new Set(mainResult.chosen.map((i) => model.screenings[i]!.itemIndex));
  for (const screening of item.screenings) {
    const forcedModel: SchedulerModel = {
      ...model,
      items: model.items.map((it) =>
        it.index === item.index ? { ...it, pinnedScreeningId: screening.id, screenings: [screening] } : it,
      ),
    };
    try {
      const forced = solve(forcedModel, { timeBudgetMs: ALTERNATIVE_BUDGET_MS });
      const forcedItems = new Set(forced.chosen.map((i) => model.screenings[i]!.itemIndex));
      const displaced = [...mainItems]
        .filter((i) => !forcedItems.has(i))
        .map((i) => model.items[i]!.filmId);
      alternatives.push({
        screeningId: screening.id,
        objectiveDelta: forced.objective - mainResult.objective,
        displaced,
      });
    } catch {
      // Conflicting pins — this screening cannot be forced at all.
      alternatives.push({ screeningId: screening.id, objectiveDelta: -Infinity, displaced: [] });
    }
  }
  alternatives.sort((a, b) => b.objectiveDelta - a.objectiveDelta);

  const maxValue = Math.max(...item.screenings.map((s) => s.value));
  const best = alternatives[0];
  if (maxValue <= 0) {
    return {
      filmId: item.filmId,
      reason: "not-worth-it",
      detail: "No screening of this film carries any scheduling value with the current weights.",
      alternatives,
    };
  }
  return {
    filmId: item.filmId,
    reason: "conflict",
    detail: best
      ? `Best forced-in option costs ${Math.abs(best.objectiveDelta).toFixed(0)} objective points` +
        (best.displaced.length > 0 ? `, displacing: ${best.displaced.join(", ")}` : "") +
        "."
      : "Conflicts with higher-value selections at every screening.",
    alternatives,
  };
}
