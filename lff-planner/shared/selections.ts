/**
 * Selection-store logic: creation, flag updates, merging (sync + import),
 * and orphan detection. Pure and dependency-free so the app, the sync
 * function, and the scheduler CLI all share exactly the same behaviour.
 */
import type { FilmsFile, FilmSelection, Flags, SelectionsFile } from "./schemas.ts";

export const EMPTY_FLAGS: Flags = { tristan: false, amy: false, priority: false, maybe: false };

export function emptySelections(festivalYear: number): SelectionsFile {
  return { schemaVersion: 1, festivalYear, films: {}, manualEvents: [] };
}

export function storageKey(festivalYear: number): string {
  return `lff-selections-${festivalYear}`;
}

/** True when a selection carries no information and can be dropped from the store. */
export function isVacuous(sel: FilmSelection): boolean {
  return (
    !sel.tristan &&
    !sel.amy &&
    !sel.priority &&
    !sel.maybe &&
    !sel.notes &&
    !sel.pinnedScreeningId &&
    (sel.excludedScreeningIds ?? []).length === 0
  );
}

/** Any flag set at all — the film has been positively selected. */
export function isSelected(sel: FilmSelection | undefined): boolean {
  return !!sel && (sel.tristan || sel.amy || sel.priority || sel.maybe);
}

/**
 * Merge two selection stores per film id, newest `updatedAt` wins
 * (string compare is safe: ISO-8601 UTC timestamps). Used by cross-device
 * sync and by import-with-merge. Manual events merge by id the same way.
 */
export function mergeSelections(a: SelectionsFile, b: SelectionsFile): SelectionsFile {
  const films: Record<string, FilmSelection> = { ...a.films };
  for (const [id, sel] of Object.entries(b.films)) {
    const existing = films[id];
    if (!existing || sel.updatedAt >= existing.updatedAt) films[id] = sel;
  }
  const events = new Map(a.manualEvents.map((e) => [e.id, e]));
  for (const e of b.manualEvents) {
    const existing = events.get(e.id);
    if (!existing || e.updatedAt >= existing.updatedAt) events.set(e.id, e);
  }
  return {
    schemaVersion: 1,
    festivalYear: a.festivalYear,
    films,
    manualEvents: [...events.values()],
  };
}

/**
 * Selections whose film id no longer exists in the programme (film removed
 * or renamed after a refresh). Surfaced in the UI — never silently dropped.
 */
export function findOrphans(selections: SelectionsFile, films: FilmsFile): string[] {
  const known = new Set(films.films.map((f) => f.id));
  return Object.entries(selections.films)
    .filter(([id, sel]) => !known.has(id) && !isVacuous(sel))
    .map(([id]) => id);
}
