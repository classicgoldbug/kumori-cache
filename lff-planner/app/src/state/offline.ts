/**
 * "Download for offline": warms the service-worker image cache with every
 * film image (write-ups and metadata are already in films.json, which the
 * SW keeps under network-first-with-fallback).
 */
import { signal } from "@preact/signals";
import { filmsFile } from "./films.ts";

export const offlineProgress = signal<{ done: number; total: number } | null>(null);

export async function downloadForOffline(): Promise<void> {
  const films = filmsFile.value;
  if (!films || offlineProgress.value) return;
  const urls: string[] = ["data/films.json", "data/venues.json", "data/constraints.json", "data/meta.json"];
  for (const film of films.films) {
    if (film.image) urls.push(`data/${film.image.thumb}`, `data/${film.image.detail}`);
  }
  offlineProgress.value = { done: 0, total: urls.length };
  const queue = [...urls];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length > 0) {
      const url = queue.shift()!;
      try {
        await fetch(url); // SW's cache-first handler stores it
      } catch {
        // Offline mid-download: stop quietly, rerun later.
        queue.length = 0;
      }
      const current = offlineProgress.value;
      if (current) offlineProgress.value = { ...current, done: current.done + 1 };
    }
  });
  await Promise.all(workers);
  setTimeout(() => (offlineProgress.value = null), 3000);
}
