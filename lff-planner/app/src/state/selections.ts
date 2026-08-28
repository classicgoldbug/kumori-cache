import { computed, signal } from "@preact/signals";
import {
  SelectionsFileSchema,
  type FilmSelection,
  type Flags,
  type ManualEvent,
  type SelectionsFile,
} from "@shared/schemas.ts";
import {
  EMPTY_FLAGS,
  emptySelections,
  findOrphans,
  isVacuous,
  mergeSelections,
  storageKey,
} from "@shared/selections.ts";
import { filmsFile } from "./films.ts";

export const selections = signal<SelectionsFile | null>(null);
/** Ids in the store that no longer exist in the programme. */
export const orphanIds = computed<string[]>(() => {
  const sels = selections.value;
  const films = filmsFile.value;
  if (!sels || !films) return [];
  return findOrphans(sels, films);
});

let persistTimer: ReturnType<typeof setTimeout> | undefined;

function persist(): void {
  const sels = selections.value;
  if (!sels) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(storageKey(sels.festivalYear), JSON.stringify(sels));
    } catch (err) {
      console.error("failed to persist selections", err);
    }
  }, 250);
}

export function initSelections(festivalYear: number): void {
  let loaded: SelectionsFile | null = null;
  try {
    const raw = localStorage.getItem(storageKey(festivalYear));
    if (raw) {
      const parsed = SelectionsFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) loaded = parsed.data;
      else console.error("stored selections failed validation; starting fresh", parsed.error);
    }
  } catch (err) {
    console.error("failed to read stored selections", err);
  }
  selections.value = loaded ?? emptySelections(festivalYear);
  // Ask the browser not to evict this origin's storage (best-effort).
  navigator.storage?.persist?.().catch(() => {});
  // Keep a second tab consistent.
  window.addEventListener("storage", (e) => {
    if (e.key !== storageKey(festivalYear) || !e.newValue) return;
    const parsed = SelectionsFileSchema.safeParse(JSON.parse(e.newValue));
    if (parsed.success) selections.value = parsed.data;
  });
}

export function getSelection(filmId: string): FilmSelection | undefined {
  return selections.value?.films[filmId];
}

function updateFilm(filmId: string, patch: Partial<FilmSelection>): void {
  const sels = selections.value;
  if (!sels) return;
  const current: FilmSelection = sels.films[filmId] ?? { ...EMPTY_FLAGS, updatedAt: "" };
  const next: FilmSelection = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const films = { ...sels.films };
  if (isVacuous(next)) delete films[filmId];
  else films[filmId] = next;
  selections.value = { ...sels, films };
  persist();
}

export function toggleFlag(filmId: string, flag: keyof Flags): void {
  const current = getSelection(filmId) ?? { ...EMPTY_FLAGS, updatedAt: "" };
  updateFilm(filmId, { [flag]: !current[flag] });
}

export function setNotes(filmId: string, notes: string): void {
  updateFilm(filmId, { notes: notes || undefined });
}

export function setPinned(filmId: string, screeningId: string | null): void {
  updateFilm(filmId, { pinnedScreeningId: screeningId });
}

export function toggleExcluded(filmId: string, screeningId: string): void {
  const current = getSelection(filmId) ?? { ...EMPTY_FLAGS, updatedAt: "" };
  const excluded = new Set(current.excludedScreeningIds ?? []);
  if (excluded.has(screeningId)) excluded.delete(screeningId);
  else excluded.add(screeningId);
  updateFilm(filmId, { excludedScreeningIds: [...excluded] });
}

export function removeSelection(filmId: string): void {
  const sels = selections.value;
  if (!sels || !sels.films[filmId]) return;
  const films = { ...sels.films };
  delete films[filmId];
  selections.value = { ...sels, films };
  persist();
}

// ---------------------------------------------------------------------------
// Manual events
// ---------------------------------------------------------------------------

export function addManualEvent(event: Omit<ManualEvent, "id" | "updatedAt"> & { id?: string }): void {
  const sels = selections.value;
  if (!sels) return;
  const id = event.id ?? `manual-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  const manualEvent: ManualEvent = { ...event, id, updatedAt: new Date().toISOString() };
  selections.value = {
    ...sels,
    manualEvents: [...sels.manualEvents.filter((e) => e.id !== id), manualEvent],
  };
  persist();
}

export function removeManualEvent(id: string): void {
  const sels = selections.value;
  if (!sels) return;
  selections.value = { ...sels, manualEvents: sels.manualEvents.filter((e) => e.id !== id) };
  persist();
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export function exportSelections(): void {
  const sels = selections.value;
  if (!sels) return;
  const payload: SelectionsFile = { ...sels, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lff-selections-${sels.festivalYear}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importSelections(json: string, mode: "merge" | "replace"): { ok: boolean; message: string } {
  const sels = selections.value;
  if (!sels) return { ok: false, message: "Selections not initialised yet" };
  let parsed;
  try {
    parsed = SelectionsFileSchema.safeParse(JSON.parse(json));
  } catch {
    return { ok: false, message: "Not valid JSON" };
  }
  if (!parsed.success) return { ok: false, message: "File does not match the selections format" };
  if (parsed.data.festivalYear !== sels.festivalYear) {
    return {
      ok: false,
      message: `File is for festival year ${parsed.data.festivalYear}, app is on ${sels.festivalYear}`,
    };
  }
  selections.value = mode === "replace" ? parsed.data : mergeSelections(sels, parsed.data);
  persist();
  const count = Object.keys(parsed.data.films).length;
  return { ok: true, message: `${mode === "replace" ? "Replaced with" : "Merged"} ${count} film selections` };
}
