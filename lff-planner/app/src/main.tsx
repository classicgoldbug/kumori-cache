import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { filmsFile, loadData, loadError } from "./state/films.ts";
import { initSelections, selections } from "./state/selections.ts";
import { lastSyncedAt, startSync, syncNow, syncStatus } from "./state/sync.ts";
import { downloadForOffline, offlineProgress } from "./state/offline.ts";
import { route } from "./router.ts";
import { Browse } from "./views/Browse.tsx";
import { Detail } from "./views/Detail.tsx";
import { Schedule } from "./views/Schedule.tsx";

const SYNC_LABEL: Record<string, string> = {
  idle: "local only",
  syncing: "syncing…",
  synced: "synced",
  offline: "offline",
  error: "sync error",
};

function SyncBadge() {
  const status = syncStatus.value;
  const progress = offlineProgress.value;
  const [open, setOpen] = useState(false);
  return (
    <span class="sync-area">
      <button class={`sync-badge ${status}`} title={lastSyncedAt.value ? `last synced ${lastSyncedAt.value}` : ""} onClick={() => setOpen(!open)}>
        {progress ? `⤓ ${progress.done}/${progress.total}` : `● ${SYNC_LABEL[status] ?? status}`}
      </button>
      {open && (
        <span class="sync-menu">
          <button onClick={() => { syncNow(); setOpen(false); }}>Sync now</button>
          <button onClick={() => { void downloadForOffline(); setOpen(false); }}>Download for offline</button>
        </span>
      )}
    </span>
  );
}

function App() {
  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const year = filmsFile.value?.festival.year;
    if (year && !selections.value) {
      initSelections(year);
      startSync();
    }
  }, [filmsFile.value]);

  if (loadError.value) {
    return (
      <main class="shell">
        <p class="error">Failed to load programme data: {loadError.value}</p>
      </main>
    );
  }
  if (!filmsFile.value || !selections.value) {
    return (
      <main class="shell">
        <p class="muted">Loading programme…</p>
      </main>
    );
  }

  const current = route.value;
  return (
    <main class="shell">
      <nav class="topnav">
        <span class="brand">LFF Planner</span>
        <a href="#/browse" class={current.view === "browse" || current.view === "film" ? "active" : ""}>
          Browse
        </a>
        <a href="#/schedule" class={current.view === "schedule" ? "active" : ""}>
          Schedule
        </a>
        <SyncBadge />
      </nav>
      {current.view === "browse" && <Browse />}
      {current.view === "film" && <Detail id={current.id} />}
      {current.view === "schedule" && <Schedule />}
    </main>
  );
}

render(<App />, document.getElementById("app")!);

if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
