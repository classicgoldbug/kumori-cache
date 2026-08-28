import { computed, signal } from "@preact/signals";
import { FilmsFileSchema, VenuesFileSchema, type Film, type FilmsFile, type VenuesFile } from "@shared/schemas.ts";

export const filmsFile = signal<FilmsFile | null>(null);
export const venuesFile = signal<VenuesFile | null>(null);
export const loadError = signal<string | null>(null);

export const filmsById = computed<Map<string, Film>>(() => {
  const map = new Map<string, Film>();
  for (const film of filmsFile.value?.films ?? []) map.set(film.id, film);
  return map;
});

/** Diacritic-stripped lowercase haystacks for instant search. */
export const searchStrings = computed<Map<string, string>>(() => {
  const map = new Map<string, string>();
  for (const film of filmsFile.value?.films ?? []) {
    map.set(film.id, normaliseForSearch(`${film.title} ${film.directors.join(" ")}`));
  }
  return map;
});

export const strands = computed<string[]>(() => {
  const set = new Set<string>();
  for (const film of filmsFile.value?.films ?? []) if (film.strand) set.add(film.strand);
  return [...set].sort();
});

export function normaliseForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export async function loadData(): Promise<void> {
  try {
    const [filmsRes, venuesRes] = await Promise.all([fetch("data/films.json"), fetch("data/venues.json")]);
    if (!filmsRes.ok) throw new Error(`films.json: HTTP ${filmsRes.status}`);
    if (!venuesRes.ok) throw new Error(`venues.json: HTTP ${venuesRes.status}`);
    filmsFile.value = FilmsFileSchema.parse(await filmsRes.json());
    venuesFile.value = VenuesFileSchema.parse(await venuesRes.json());
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  }
}
