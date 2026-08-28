import { filmsFile, venuesFile } from "../state/films.ts";
import { selections } from "../state/selections.ts";
import { isSelected } from "@shared/selections.ts";
import { venueName } from "@shared/venues.ts";
import { formatDate, minutesToHm, parseIso } from "@shared/time.ts";
import { navigate } from "../router.ts";

interface Row {
  filmId: string;
  title: string;
  date: string;
  minuteOfDay: number;
  venue: string;
  screen: string | null;
  flags: string[];
  manual: boolean;
}

/**
 * Pre-scheduler view: every screening of every selected film (plus manual
 * events), grouped by day — the raw material the optimiser will work on.
 * The solver, timeline, and diagnostics arrive in a later phase.
 */
export function Schedule() {
  const films = filmsFile.value;
  const venues = venuesFile.value;
  const sels = selections.value;
  if (!films || !venues || !sels) return null;

  const rows: Row[] = [];
  for (const film of films.films) {
    const sel = sels.films[film.id];
    if (!isSelected(sel)) continue;
    const flags = (["tristan", "amy", "priority", "maybe"] as const).filter((f) => sel![f]);
    for (const screening of film.screenings) {
      const { date, minuteOfDay } = parseIso(screening.start);
      rows.push({
        filmId: film.id,
        title: film.title,
        date,
        minuteOfDay,
        venue: screening.venue,
        screen: screening.screen,
        flags: [...flags],
        manual: false,
      });
    }
  }
  for (const event of sels.manualEvents) {
    const flags = (["tristan", "amy", "priority", "maybe"] as const).filter((f) => event.flags[f]);
    for (const screening of event.screenings) {
      const { date, minuteOfDay } = parseIso(screening.start);
      rows.push({
        filmId: event.id,
        title: event.title,
        date,
        minuteOfDay,
        venue: screening.venue,
        screen: screening.screen,
        flags: [...flags],
        manual: true,
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.minuteOfDay - b.minuteOfDay);

  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    if (!byDay.has(row.date)) byDay.set(row.date, []);
    byDay.get(row.date)!.push(row);
  }

  return (
    <div class="schedule">
      <h2>Screening map</h2>
      <p class="muted">
        All screenings of your selected films ({rows.length} screenings). The optimiser that picks the best
        combination arrives in a later phase.
      </p>
      {byDay.size === 0 && <p class="muted empty">Nothing selected yet — flag some films in Browse first.</p>}
      {[...byDay.entries()].map(([date, dayRows]) => (
        <section class="schedule-day">
          <h3>{formatDate(date)}</h3>
          {dayRows.map((row) => (
            <div class={`schedule-row ${row.manual ? "manual" : ""}`}
                 onClick={() => !row.manual && navigate({ view: "film", id: row.filmId })}>
              <span class="schedule-time">{minutesToHm(row.minuteOfDay)}</span>
              <span class="schedule-title">
                {row.title}
                {row.manual && <span class="badge">MANUAL</span>}
              </span>
              <span class="schedule-venue muted">
                {venueName(venues, row.venue)}
                {row.screen ? `, ${row.screen}` : ""}
              </span>
              <span class="schedule-flags">
                {row.flags.map((f) => (
                  <span class={`flag flag-${f} on static`}>{f[0]!.toUpperCase()}</span>
                ))}
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
