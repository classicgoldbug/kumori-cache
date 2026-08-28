import { useState } from "preact/hooks";
import { filmsFile, venuesFile } from "../state/films.ts";
import { selections } from "../state/selections.ts";
import { runScheduler, scheduleError, scheduleRunning, scheduleState } from "../state/schedule.ts";
import { isSelected } from "@shared/selections.ts";
import { venueName, travelMinutes } from "@shared/venues.ts";
import { formatDate, minutesToHm, parseIso } from "@shared/time.ts";
import { navigate } from "../router.ts";

function flagBadges(flags: { tristan: boolean; amy: boolean; priority: boolean; maybe: boolean }) {
  return (
    <span class="schedule-flags">
      {(["tristan", "amy", "priority", "maybe"] as const)
        .filter((f) => flags[f])
        .map((f) => (
          <span class={`flag flag-${f} on static`}>{f[0]!.toUpperCase()}</span>
        ))}
    </span>
  );
}

/** All screenings of all selected films — the solver's raw material. */
function ScreeningMap({ titles }: { titles: Map<string, { title: string; flags: { tristan: boolean; amy: boolean; priority: boolean; maybe: boolean }; manual: boolean }> }) {
  const films = filmsFile.value!;
  const venues = venuesFile.value!;
  const sels = selections.value!;
  const state = scheduleState.value;
  const [expanded, setExpanded] = useState<string | null>(null);

  const chosenIds = new Set(state?.schedule.chosen.map((c) => c.screeningId) ?? []);
  const rows: { filmId: string; screeningId: string; start: string; venue: string; screen: string | null }[] = [];
  for (const film of films.films) {
    if (!isSelected(sels.films[film.id])) continue;
    for (const s of film.screenings) {
      rows.push({ filmId: film.id, screeningId: s.id, start: s.start, venue: s.venue, screen: s.screen });
    }
  }
  for (const event of sels.manualEvents) {
    for (const s of event.screenings) {
      rows.push({ filmId: event.id, screeningId: s.id, start: s.start, venue: s.venue, screen: s.screen });
    }
  }

  const byFilm = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byFilm.has(row.filmId)) byFilm.set(row.filmId, []);
    byFilm.get(row.filmId)!.push(row);
  }

  return (
    <section class="screening-map">
      <h3>Screening map</h3>
      <p class="muted">
        Every screening of every selected film. <span class="map-chip chosen">chosen</span>{" "}
        <span class="map-chip blocked">conflicts with the schedule</span> <span class="map-chip">free</span>
      </p>
      {[...byFilm.entries()].map(([filmId, filmRows]) => (
        <div class="map-row">
          <span class="map-title" onClick={() => !titles.get(filmId)?.manual && navigate({ view: "film", id: filmId })}>
            {titles.get(filmId)?.title ?? filmId}
          </span>
          <div class="map-chips">
            {filmRows
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((row) => {
                const { date, minuteOfDay } = parseIso(row.start);
                const conflicts = state?.explain[row.screeningId];
                const cls = chosenIds.has(row.screeningId) ? "chosen" : conflicts ? "blocked" : "";
                return (
                  <button
                    class={`map-chip ${cls}`}
                    onClick={() => setExpanded(expanded === row.screeningId ? null : row.screeningId)}
                    title={venueName(venues, row.venue)}
                  >
                    {formatDate(date)} {minutesToHm(minuteOfDay)} · {venueName(venues, row.venue)}
                  </button>
                );
              })}
          </div>
          {filmRows.some((r) => r.screeningId === expanded) && state?.explain[expanded!] && (
            <div class="map-explain">
              {state.explain[expanded!]!.map((e) => (
                <div>
                  ✕ vs <strong>{titles.get(e.otherFilmId)?.title ?? e.otherFilmId}</strong>: {e.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {byFilm.size === 0 && <p class="muted empty">Nothing selected yet — flag some films in Browse first.</p>}
    </section>
  );
}

export function Schedule() {
  const films = filmsFile.value;
  const venues = venuesFile.value;
  const sels = selections.value;
  if (!films || !venues || !sels) return null;

  const titles = new Map<string, { title: string; flags: { tristan: boolean; amy: boolean; priority: boolean; maybe: boolean }; manual: boolean }>();
  for (const film of films.films) {
    const sel = sels.films[film.id];
    if (sel) titles.set(film.id, { title: film.title, flags: sel, manual: false });
  }
  for (const event of sels.manualEvents) titles.set(event.id, { title: event.title, flags: event.flags, manual: true });

  const state = scheduleState.value;
  const schedule = state?.schedule;

  return (
    <div class="schedule">
      <div class="schedule-header">
        <h2>Schedule</h2>
        <button class="primary" disabled={scheduleRunning.value} onClick={() => void runScheduler()}>
          {scheduleRunning.value ? "Computing…" : schedule ? "Recompute" : "Compute schedule"}
        </button>
        {schedule && (
          <span class="muted">
            objective {schedule.objective}
            {schedule.optimal ? " · proven optimal" : " · time-limited best"} · {schedule.solveMs} ms
          </span>
        )}
      </div>
      {scheduleError.value && <p class="error">{scheduleError.value}</p>}

      {schedule && (
        <>
          {schedule.warnings.length > 0 && (
            <div class="schedule-warnings">
              {schedule.warnings.map((w) => (
                <div>⚠ {w.message}</div>
              ))}
            </div>
          )}

          {schedule.days
            .filter((day) => schedule.chosen.some((c) => c.start.startsWith(day.date)) || (day.amyTarget && day.penalty > 0))
            .map((day) => {
              const rows = schedule.chosen.filter((c) => c.start.startsWith(day.date));
              return (
                <section class="schedule-day">
                  <h3>
                    {formatDate(day.date)}
                    {day.amyTarget && (
                      <span class={`amy-target ${day.penalty > 0 ? "missed" : ""}`}>
                        Amy {day.amyCount}/{day.amyTarget.min}–{day.amyTarget.max}
                        {day.penalty > 0 ? ` (−${day.penalty})` : ""}
                      </span>
                    )}
                  </h3>
                  {rows.map((row, i) => {
                    const meta = titles.get(row.filmId);
                    let gap = null;
                    if (i > 0) {
                      const prev = rows[i - 1]!;
                      const travel = travelMinutes(venues, prev.venue, row.venue);
                      const prevEnd = parseIso(prev.end).minuteOfDay;
                      const thisStart = parseIso(row.start).minuteOfDay;
                      const slack = thisStart - prevEnd - travel.minutes - venues.bufferMinutes;
                      gap = (
                        <div class={`travel-gap ${slack < 10 ? "tight" : ""}`}>
                          ↓ {travel.minutes} min travel + {venues.bufferMinutes} buffer, {slack} min slack
                        </div>
                      );
                    }
                    return (
                      <>
                        {gap}
                        <div class="schedule-row" onClick={() => !meta?.manual && navigate({ view: "film", id: row.filmId })}>
                          <span class="schedule-time">
                            {row.start.slice(11, 16)}–{row.end.slice(11, 16)}
                          </span>
                          <span class="schedule-title">
                            {meta?.title ?? row.filmId}
                            {row.pinned && " 📌"}
                            {meta?.manual && <span class="badge">MANUAL</span>}
                          </span>
                          <span class="schedule-venue muted">{venueName(venues, row.venue)}</span>
                          <span class="attendees">{row.attendees.map((a) => (
                            <span class={`flag flag-${a} on static`}>{a[0]!.toUpperCase()}</span>
                          ))}</span>
                        </div>
                      </>
                    );
                  })}
                </section>
              );
            })}

          {schedule.unscheduled.length > 0 && (
            <section class="unscheduled">
              <h3>Not scheduled</h3>
              {schedule.unscheduled.map((u) => (
                <div class="unscheduled-item">
                  <div>
                    <strong class="link" onClick={() => !titles.get(u.filmId)?.manual && navigate({ view: "film", id: u.filmId })}>
                      {titles.get(u.filmId)?.title ?? u.filmId}
                    </strong>{" "}
                    {titles.get(u.filmId) && flagBadges(titles.get(u.filmId)!.flags)}
                    <span class="muted"> — {u.detail}</span>
                  </div>
                  {u.alternatives.slice(0, 3).map((alt) => (
                    <div class="alt muted">
                      force {alt.screeningId.split("#").slice(1).join(" ")}: objective{" "}
                      {alt.objectiveDelta >= 0 ? "+" : ""}
                      {Number.isFinite(alt.objectiveDelta) ? alt.objectiveDelta : "impossible"}
                      {alt.displaced.length > 0 &&
                        `, displaces ${alt.displaced.map((d) => titles.get(d)?.title ?? d).join(", ")}`}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}

          {state.notes.length > 0 && (
            <details class="schedule-notes">
              <summary class="muted">{state.notes.length} note{state.notes.length === 1 ? "" : "s"}</summary>
              {state.notes.map((n) => (
                <div class="muted">{n}</div>
              ))}
            </details>
          )}
        </>
      )}

      <ScreeningMap titles={titles} />
    </div>
  );
}
