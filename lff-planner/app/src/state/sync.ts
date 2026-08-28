/**
 * Local-first sync: selections live in localStorage; whenever they change
 * (and on load/focus) the full document is POSTed to /api/sync, which merges
 * per film by updatedAt and returns the merged doc. Offline is fine — the
 * next successful sync reconciles.
 */
import { effect, signal } from "@preact/signals";
import type { SelectionsFile } from "@shared/schemas.ts";
import { SelectionsFileSchema } from "@shared/schemas.ts";
import { selections } from "./selections.ts";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";
export const syncStatus = signal<SyncStatus>("idle");
export const lastSyncedAt = signal<string | null>(null);

let lastSyncedDoc = "";
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

async function push(): Promise<void> {
  const doc = selections.value;
  if (!doc) return;
  const serialized = JSON.stringify(doc);
  if (serialized === lastSyncedDoc) return;
  syncStatus.value = "syncing";
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: serialized,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { doc: merged } = (await res.json()) as { doc: unknown };
    const parsed = SelectionsFileSchema.safeParse(merged);
    if (!parsed.success) throw new Error("server returned an invalid document");
    lastSyncedDoc = JSON.stringify(parsed.data);
    // Adopt the merged view (brings in edits from other devices). Guarded by
    // lastSyncedDoc so this assignment doesn't immediately re-push.
    if (JSON.stringify(selections.value) !== lastSyncedDoc) selections.value = parsed.data;
    syncStatus.value = "synced";
    lastSyncedAt.value = new Date().toISOString();
  } catch (err) {
    syncStatus.value = navigator.onLine === false ? "offline" : "error";
    console.warn("sync failed", err);
  }
}

export function syncNow(): void {
  clearTimeout(debounceTimer);
  void push();
}

/** Wire up sync triggers once selections are initialised. */
export function startSync(): void {
  if (started) return;
  started = true;
  // Local-only mode (vite dev / preview without functions): probe once and
  // go quiet if the endpoint isn't there.
  void fetch("/api/sync?year=1900", { method: "GET" }).then(
    (res) => {
      if (res.status === 404) {
        syncStatus.value = "idle";
        return;
      }
      effect(() => {
        void selections.value; // subscribe
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void push(), 3000);
      });
      window.addEventListener("focus", () => void push());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void push();
      });
      void push();
    },
    () => {
      syncStatus.value = "offline";
    },
  );
}
