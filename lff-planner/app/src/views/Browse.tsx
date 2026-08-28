import { useEffect, useRef, useState } from "preact/hooks";
import { filmsById, filmsFile } from "../state/films.ts";
import { exportSelections, importSelections, orphanIds, removeSelection, removeManualEvent, selections } from "../state/selections.ts";
import {
  cycleFlagFilter,
  filteredFilmIds,
  flagFilters,
  focusIndex,
  searchQuery,
  sortBy,
  strandFilter,
  triageProgress,
  unreviewedOnly,
  type FlagName,
} from "../state/ui.ts";
import { strands } from "../state/films.ts";
import { navigate } from "../router.ts";
import { FlagButtons } from "../components/FlagButtons.tsx";
import { ManualEventForm } from "../components/ManualEventForm.tsx";
import { toggleFlag } from "../state/selections.ts";
import { formatDate, parseIso } from "@shared/time.ts";

function FilmRow({ id, focused }: { id: string; focused: boolean }) {
  const film = filmsById.value.get(id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  if (!film) return null;
  return (
    <div
      ref={ref}
      class={`film-row ${focused ? "focused" : ""}`}
      onClick={() => navigate({ view: "film", id })}
    >
      {film.image ? (
        <img class="thumb" src={`data/${film.image.thumb}`} alt="" loading="lazy" />
      ) : (
        <div class="thumb placeholder" aria-hidden="true">
          {film.title.slice(0, 1)}
        </div>
      )}
      <div class="film-row-main">
        <div class="film-row-title">
          {film.title}
          {film.year && film.year < 2020 ? <span class="muted"> ({film.year})</span> : null}
        </div>
        <div class="film-row-sub muted">
          {[film.directors.join(", "), film.strand, film.runtimeMinutes ? `${film.runtimeMinutes} min` : null, `${film.screenings.length} screening${film.screenings.length === 1 ? "" : "s"}`]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <FlagButtons filmId={id} />
    </div>
  );
}

function ManualEventRow({ id }: { id: string }) {
  const event = selections.value?.manualEvents.find((e) => e.id === id);
  if (!event) return null;
  const first = event.screenings[0]!;
  const { date, minuteOfDay } = parseIso(first.start);
  const hm = `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
  return (
    <div class="film-row manual">
      <div class="thumb placeholder" aria-hidden="true">★</div>
      <div class="film-row-main">
        <div class="film-row-title">
          {event.title} <span class="badge">MANUAL</span>
        </div>
        <div class="film-row-sub muted">
          {formatDate(date)} · {hm} · {event.runtimeMinutes ? `${event.runtimeMinutes} min` : "runtime unknown"}
        </div>
      </div>
      <div class="flag-buttons normal">
        {(["tristan", "amy", "priority", "maybe"] as const).map((key) =>
          event.flags[key] ? <span class={`flag flag-${key} on static`}>{key[0]!.toUpperCase()}</span> : null,
        )}
        <button class="flag off remove" title="Remove event" onClick={() => removeManualEvent(id)}>✕</button>
      </div>
    </div>
  );
}

function OrphanBanner() {
  const ids = orphanIds.value;
  if (ids.length === 0) return null;
  return (
    <div class="orphan-banner">
      <strong>{ids.length} selection{ids.length === 1 ? "" : "s"} refer to films no longer in the programme:</strong>{" "}
      {ids.join(", ")} — <button onClick={() => exportSelections()}>Export backup</button>{" "}
      {ids.map((id) => (
        <button onClick={() => removeSelection(id)}>Remove “{id}”</button>
      ))}
    </div>
  );
}

export function Browse() {
  const [showForm, setShowForm] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const ids = filteredFilmIds.value;
  const progress = triageProgress.value;
  const festival = filmsFile.value?.festival;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (typing) {
        if (e.key === "Escape") (target as HTMLInputElement).blur();
        if (e.key === "Enter" && target === searchInput.current) {
          (target as HTMLInputElement).blur();
          focusIndex.value = ids.length > 0 ? 0 : -1;
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusIndex.value = Math.min(focusIndex.value + 1, ids.length - 1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusIndex.value = Math.max(focusIndex.value - 1, 0);
      } else if (e.key === "Enter" && focusIndex.value >= 0 && ids[focusIndex.value]) {
        navigate({ view: "film", id: ids[focusIndex.value]! });
      } else if (["t", "a", "p", "m"].includes(e.key) && focusIndex.value >= 0 && ids[focusIndex.value]) {
        const flag = ({ t: "tristan", a: "amy", p: "priority", m: "maybe" } as const)[e.key as "t" | "a" | "p" | "m"];
        toggleFlag(ids[focusIndex.value]!, flag);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids]);

  const onImportFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const mode = confirm("OK = merge with existing selections, Cancel = replace everything") ? "merge" : "replace";
    const result = importSelections(await file.text(), mode);
    setImportMessage(result.message);
    input.value = "";
    setTimeout(() => setImportMessage(""), 5000);
  };

  return (
    <div class="browse">
      <div class="toolbar">
        <input
          ref={searchInput}
          class="search"
          type="search"
          placeholder="Search title or director…  ( / )"
          value={searchQuery.value}
          onInput={(e) => {
            searchQuery.value = (e.target as HTMLInputElement).value;
            focusIndex.value = -1;
          }}
        />
        <div class="chips">
          {(["tristan", "amy", "priority", "maybe"] as FlagName[]).map((flag) => {
            const state = flagFilters.value[flag];
            return (
              <button
                class={`chip chip-${flag} ${state}`}
                title={`Filter by ${flag}: ${state}`}
                onClick={() => cycleFlagFilter(flag)}
              >
                {flag[0]!.toUpperCase() + flag.slice(1)}
                {state === "on" ? " ✓" : state === "off" ? " ✕" : ""}
              </button>
            );
          })}
          <button
            class={`chip ${unreviewedOnly.value ? "on" : "any"}`}
            onClick={() => (unreviewedOnly.value = !unreviewedOnly.value)}
          >
            Unreviewed{unreviewedOnly.value ? " ✓" : ""}
          </button>
          <select class="chip" value={strandFilter.value} onChange={(e) => (strandFilter.value = (e.target as HTMLSelectElement).value)}>
            <option value="">All strands</option>
            {strands.value.map((s) => (
              <option value={s}>{s}</option>
            ))}
          </select>
          <select class="chip" value={sortBy.value} onChange={(e) => (sortBy.value = (e.target as HTMLSelectElement).value as never)}>
            <option value="title">Sort: title</option>
            <option value="strand">Sort: strand</option>
            <option value="firstScreening">Sort: first screening</option>
          </select>
        </div>
        <div class="toolbar-right">
          <span class="muted progress">
            {progress.reviewed}/{progress.total} triaged
          </span>
          <button onClick={() => setShowForm(true)}>+ Event</button>
          <button onClick={() => exportSelections()}>Export</button>
          <button onClick={() => fileInput.current?.click()}>Import</button>
          <input ref={fileInput} type="file" accept="application/json" hidden onChange={onImportFile} />
        </div>
      </div>
      {importMessage && <div class="import-message">{importMessage}</div>}
      <OrphanBanner />
      {showForm && <ManualEventForm onClose={() => setShowForm(false)} />}
      {festival && (
        <p class="muted festival-line">
          {festival.name} {festival.year} · {formatDate(festival.startDate)} – {formatDate(festival.endDate)} ·{" "}
          {ids.length} film{ids.length === 1 ? "" : "s"} shown
        </p>
      )}
      <div class="film-list">
        {selections.value?.manualEvents.map((e) => <ManualEventRow id={e.id} />)}
        {ids.map((id, i) => (
          <FilmRow key={id} id={id} focused={i === focusIndex.value} />
        ))}
        {ids.length === 0 && <p class="muted empty">No films match the current filters.</p>}
      </div>
    </div>
  );
}
