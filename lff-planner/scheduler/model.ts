/**
 * Builds the solver's working model from the four data contracts.
 * Pure: no I/O, no globals. Everything downstream (solve, diagnose, UI)
 * consumes this model rather than the raw files.
 */
import type { ConstraintsFile, Film, FilmsFile, SelectionsFile, VenuesFile } from "../shared/schemas.ts";
import { isSelected } from "../shared/selections.ts";
import { dateRange, festivalMinutes, hmToMinutes, parseIso, weekdayOf, type Weekday } from "../shared/time.ts";
import { travelMinutes } from "../shared/venues.ts";

/** Runtime assumed for manual events that don't state one. */
export const DEFAULT_MANUAL_RUNTIME = 120;

export interface ModelScreening {
  /** Global index across the whole model. */
  index: number;
  itemIndex: number;
  id: string;
  filmId: string;
  date: string;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  venue: string;
  tristanAttends: boolean;
  amyAttends: boolean;
  /** Objective contribution when this screening is chosen (≥ 0). */
  value: number;
}

export interface ModelItem {
  index: number;
  filmId: string;
  title: string;
  isManual: boolean;
  flags: { tristan: boolean; amy: boolean; priority: boolean; maybe: boolean };
  pinnedScreeningId: string | null;
  /** Eligible screenings (exclusions and pins already applied). */
  screenings: ModelScreening[];
  /** Why an item ended up with zero eligible screenings. */
  emptyReason: "excluded-all-screenings" | "amy-absent-all-screenings" | null;
  runtimeAssumed: boolean;
}

export interface SchedulerModel {
  items: ModelItem[];
  screenings: ModelScreening[];
  /** conflicts[i] = sorted array of global screening indices conflicting with i. */
  conflicts: number[][];
  /** conflictReason keyed by "a:b" with a < b. */
  conflictReasons: Map<string, string>;
  festivalDates: string[];
  startDate: string;
  amyAbsenceDates: Set<string>;
  constraints: ConstraintsFile;
  venues: VenuesFile;
  /** Non-fatal notes surfaced to diagnostics (unknown venues, assumed runtimes…). */
  notes: string[];
}

export interface BuildInput {
  films: FilmsFile;
  selections: SelectionsFile;
  venues: VenuesFile;
  constraints: ConstraintsFile;
}

function amyAbsent(dates: Set<string>, date: string): boolean {
  return dates.has(date);
}

function screeningValue(
  flags: ModelItem["flags"],
  amyAttends: boolean,
  weekday: Weekday,
  startMinuteOfDay: number,
  constraints: ConstraintsFile,
): number {
  const w = constraints.weights;
  let value = (flags.priority ? w.priority : 0) + (flags.tristan ? w.tristan : 0) + (amyAttends ? w.amy : 0);
  if (flags.maybe && !flags.priority) value *= w.maybeMultiplier;
  if (flags.maybe && !flags.tristan && !flags.amy && !flags.priority) value = w.onlyMaybe;
  if (amyAttends) {
    const target = constraints.amyDayTargets[weekday];
    if (target?.preferredStart) {
      const from = hmToMinutes(target.preferredStart.from);
      const to = hmToMinutes(target.preferredStart.to);
      if (startMinuteOfDay < from || startMinuteOfDay > to) value -= w.amyWindowPenalty;
    }
  }
  return Math.max(0, value);
}

export function buildModel(input: BuildInput): SchedulerModel {
  const { films, selections, venues, constraints } = input;
  const startDate = films.festival.startDate;
  const festivalDates = dateRange(films.festival.startDate, films.festival.endDate);
  const amyAbsenceDates = new Set<string>();
  for (const absence of constraints.amyAbsences) {
    for (const d of dateRange(absence.from, absence.to)) amyAbsenceDates.add(d);
  }

  const notes: string[] = [];
  const items: ModelItem[] = [];
  const screenings: ModelScreening[] = [];

  const addItem = (
    filmId: string,
    title: string,
    isManual: boolean,
    flags: ModelItem["flags"],
    rawScreenings: { id: string; start: string; venue: string }[],
    runtimeMinutes: number | null,
    pinnedScreeningId: string | null,
    excludedScreeningIds: string[],
  ) => {
    const itemIndex = items.length;
    const runtimeAssumed = runtimeMinutes == null;
    const runtime = runtimeMinutes ?? DEFAULT_MANUAL_RUNTIME;
    if (runtimeAssumed) notes.push(`"${title}": runtime unknown, assuming ${DEFAULT_MANUAL_RUNTIME} min`);

    const excluded = new Set(excludedScreeningIds);
    let anyAfterExclusion = false;
    const tristanAttends = flags.tristan || flags.priority || !flags.amy;
    const eligible: ModelScreening[] = [];
    for (const raw of rawScreenings) {
      if (excluded.has(raw.id)) continue;
      if (pinnedScreeningId && raw.id !== pinnedScreeningId) continue;
      anyAfterExclusion = true;
      const { date, minuteOfDay } = parseIso(raw.start);
      const weekday = weekdayOf(date);
      const amyAttends = flags.amy && !amyAbsent(amyAbsenceDates, date);
      const value = screeningValue(flags, amyAttends, weekday, minuteOfDay, constraints);
      // A screening nobody would attend contributes nothing and only creates
      // conflicts — leave it out (an Amy-only film during her absence).
      if (!tristanAttends && !amyAttends) continue;
      const startMin = festivalMinutes(startDate, raw.start);
      eligible.push({
        index: -1, // assigned below
        itemIndex,
        id: raw.id,
        filmId,
        date,
        weekday,
        startMin,
        endMin: startMin + runtime,
        venue: raw.venue,
        tristanAttends,
        amyAttends,
        value,
      });
    }

    let emptyReason: ModelItem["emptyReason"] = null;
    if (eligible.length === 0) {
      emptyReason = anyAfterExclusion ? "amy-absent-all-screenings" : "excluded-all-screenings";
    }
    items.push({
      index: itemIndex,
      filmId,
      title,
      isManual,
      flags,
      pinnedScreeningId: pinnedScreeningId ?? null,
      screenings: eligible,
      emptyReason,
      runtimeAssumed,
    });
  };

  const filmById = new Map<string, Film>(films.films.map((f) => [f.id, f]));
  for (const [filmId, sel] of Object.entries(selections.films)) {
    if (!isSelected(sel)) continue;
    const film = filmById.get(filmId);
    if (!film) continue; // orphan — surfaced by the app, not the scheduler
    addItem(
      filmId,
      film.title,
      false,
      { tristan: sel.tristan, amy: sel.amy, priority: sel.priority, maybe: sel.maybe },
      film.screenings.map((s) => ({ id: s.id, start: s.start, venue: s.venue })),
      film.runtimeMinutes,
      sel.pinnedScreeningId ?? null,
      sel.excludedScreeningIds ?? [],
    );
  }
  for (const event of selections.manualEvents) {
    if (!event.flags.tristan && !event.flags.amy && !event.flags.priority && !event.flags.maybe) continue;
    addItem(
      event.id,
      event.title,
      true,
      event.flags,
      event.screenings.map((s) => ({ id: s.id, start: s.start, venue: s.venue })),
      event.runtimeMinutes,
      null,
      [],
    );
  }

  for (const item of items) {
    for (const s of item.screenings) {
      s.index = screenings.length;
      screenings.push(s);
    }
  }

  // Pairwise conflicts across different items, with human-readable reasons.
  const buffer = venues.bufferMinutes;
  const conflicts: number[][] = screenings.map(() => []);
  const conflictReasons = new Map<string, string>();
  const unknownPairs = new Set<string>();
  for (let i = 0; i < screenings.length; i++) {
    for (let j = i + 1; j < screenings.length; j++) {
      const a = screenings[i]!;
      const b = screenings[j]!;
      if (a.itemIndex === b.itemIndex) continue;
      const [first, second] = a.startMin <= b.startMin ? [a, b] : [b, a];
      const travel = travelMinutes(venues, first.venue, second.venue);
      if (!travel.known) unknownPairs.add([first.venue, second.venue].sort().join(" ↔ "));
      let reason: string | null = null;
      if (second.startMin < first.endMin) {
        reason = "the screenings overlap";
      } else if (second.startMin < first.endMin + travel.minutes + buffer) {
        const available = second.startMin - first.endMin;
        reason = `infeasible transfer ${first.venue} → ${second.venue}: needs ${travel.minutes} min travel + ${buffer} buffer, only ${available} available`;
      }
      if (reason) {
        conflicts[i]!.push(j);
        conflicts[j]!.push(i);
        conflictReasons.set(`${i}:${j}`, reason);
      }
    }
  }
  for (const pair of unknownPairs) notes.push(`travel time unknown for ${pair}; using default ${venues.defaultTravelMinutes} min`);

  return {
    items,
    screenings,
    conflicts,
    conflictReasons,
    festivalDates,
    startDate,
    amyAbsenceDates,
    constraints,
    venues,
    notes,
  };
}

/** Amy's soft day-target penalty for a complete assignment (≥ 0). */
export function amyPenalty(model: SchedulerModel, amyCountByDate: Map<string, number>): number {
  const w = model.constraints.weights;
  let penalty = 0;
  for (const date of model.festivalDates) {
    if (model.amyAbsenceDates.has(date)) continue;
    const target = model.constraints.amyDayTargets[weekdayOf(date)];
    if (!target) continue;
    const count = amyCountByDate.get(date) ?? 0;
    if (count < target.min) penalty += (target.min - count) * w.amyBelowTargetPenalty;
    else if (count > target.max) penalty += (count - target.max) * w.amyAboveTargetPenalty;
  }
  return penalty;
}

/** Full objective for a set of chosen screenings (by global index). */
export function evaluate(model: SchedulerModel, chosen: number[]): number {
  let value = 0;
  const amyCount = new Map<string, number>();
  for (const index of chosen) {
    const s = model.screenings[index]!;
    value += s.value;
    if (s.amyAttends) amyCount.set(s.date, (amyCount.get(s.date) ?? 0) + 1);
  }
  return value - amyPenalty(model, amyCount);
}
