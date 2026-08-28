import { computed, signal } from "@preact/signals";
import type { Flags } from "@shared/schemas.ts";
import { filmsFile, searchStrings, normaliseForSearch } from "./films.ts";
import { selections } from "./selections.ts";
import { isSelected } from "@shared/selections.ts";

export type TriState = "any" | "on" | "off";
export type FlagName = keyof Flags;

export const searchQuery = signal("");
export const flagFilters = signal<Record<FlagName, TriState>>({
  tristan: "any",
  amy: "any",
  priority: "any",
  maybe: "any",
});
export const unreviewedOnly = signal(false);
export const strandFilter = signal<string>("");
export const sortBy = signal<"title" | "strand" | "firstScreening">("title");
/** Keyboard focus index into filteredFilmIds. */
export const focusIndex = signal(-1);

export function cycleFlagFilter(flag: FlagName): void {
  const order: TriState[] = ["any", "on", "off"];
  const current = flagFilters.value[flag];
  const next = order[(order.indexOf(current) + 1) % order.length] as TriState;
  flagFilters.value = { ...flagFilters.value, [flag]: next };
}

export const filteredFilmIds = computed<string[]>(() => {
  const files = filmsFile.value;
  if (!files) return [];
  const sels = selections.value;
  const query = normaliseForSearch(searchQuery.value.trim());
  const filters = flagFilters.value;
  const strand = strandFilter.value;
  const haystacks = searchStrings.value;

  const ids = files.films
    .filter((film) => {
      if (query && !haystacks.get(film.id)?.includes(query)) return false;
      if (strand && film.strand !== strand) return false;
      const sel = sels?.films[film.id];
      if (unreviewedOnly.value && isSelected(sel)) return false;
      for (const flag of ["tristan", "amy", "priority", "maybe"] as const) {
        const want = filters[flag];
        const has = sel?.[flag] ?? false;
        if (want === "on" && !has) return false;
        if (want === "off" && has) return false;
      }
      return true;
    })
    .map((f) => f.id);

  if (sortBy.value === "title") {
    const byId = new Map(files.films.map((f) => [f.id, f]));
    ids.sort((a, b) => byId.get(a)!.title.localeCompare(byId.get(b)!.title));
  } else if (sortBy.value === "strand") {
    const byId = new Map(files.films.map((f) => [f.id, f]));
    ids.sort(
      (a, b) =>
        (byId.get(a)!.strand ?? "~").localeCompare(byId.get(b)!.strand ?? "~") ||
        byId.get(a)!.title.localeCompare(byId.get(b)!.title),
    );
  } else {
    const firstStart = new Map(files.films.map((f) => [f.id, f.screenings.map((s) => s.start).sort()[0] ?? ""]));
    ids.sort((a, b) => firstStart.get(a)!.localeCompare(firstStart.get(b)!));
  }
  return ids;
});

export const triageProgress = computed<{ reviewed: number; total: number }>(() => {
  const files = filmsFile.value;
  const sels = selections.value;
  if (!files) return { reviewed: 0, total: 0 };
  let reviewed = 0;
  for (const film of files.films) if (isSelected(sels?.films[film.id])) reviewed += 1;
  return { reviewed, total: files.films.length };
});
