import { render } from "preact";
import { useEffect } from "preact/hooks";
import { filmsFile, loadData, loadError } from "./state/films.ts";
import { initSelections, selections } from "./state/selections.ts";
import { route } from "./router.ts";
import { Browse } from "./views/Browse.tsx";
import { Detail } from "./views/Detail.tsx";
import { Schedule } from "./views/Schedule.tsx";

function App() {
  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const year = filmsFile.value?.festival.year;
    if (year && !selections.value) initSelections(year);
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
      </nav>
      {current.view === "browse" && <Browse />}
      {current.view === "film" && <Detail id={current.id} />}
      {current.view === "schedule" && <Schedule />}
    </main>
  );
}

render(<App />, document.getElementById("app")!);
