import { filmsById, venuesFile } from "../state/films.ts";
import { getSelection, setNotes, setPinned, toggleExcluded } from "../state/selections.ts";
import { FlagButtons } from "../components/FlagButtons.tsx";
import { navigate } from "../router.ts";
import { venueName } from "@shared/venues.ts";
import { formatDate, minutesToHm, parseIso } from "@shared/time.ts";

export function Detail({ id }: { id: string }) {
  const film = filmsById.value.get(id);
  const venues = venuesFile.value;
  if (!film || !venues) {
    return (
      <div class="detail">
        <p>Film “{id}” not found. <a href="#/browse">Back to browse</a></p>
      </div>
    );
  }
  const sel = getSelection(id);
  const meta: [string, string][] = [
    ["Directed by", film.directors.join(", ")],
    ["Written by", film.writers.join(", ")],
    ["Cast", film.cast.join(", ")],
    ["Country", film.countries.join(", ")],
    ["Year", film.year ? String(film.year) : ""],
    ["Language", film.languages.join(", ")],
    ["Runtime", film.runtimeMinutes ? `${film.runtimeMinutes} min` : ""],
    ["Strand", film.strand ?? ""],
  ];

  return (
    <div class="detail">
      <button class="back" onClick={() => navigate({ view: "browse" })}>← Back</button>
      <div class="detail-header">
        {film.image && <img class="detail-image" src={`data/${film.image.detail}`} alt={film.title} />}
        <div>
          <h2>{film.title}</h2>
          <FlagButtons filmId={id} size="large" />
          <dl class="meta">
            {meta
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </>
              ))}
          </dl>
        </div>
      </div>

      <h3>Screenings</h3>
      <div class="screenings">
        {film.screenings.map((screening) => {
          const { date, minuteOfDay } = parseIso(screening.start);
          const pinned = sel?.pinnedScreeningId === screening.id;
          const excluded = (sel?.excludedScreeningIds ?? []).includes(screening.id);
          return (
            <div class={`screening ${excluded ? "excluded" : ""} ${pinned ? "pinned" : ""}`}>
              <div class="screening-when">
                <strong>{formatDate(date)}</strong> {minutesToHm(minuteOfDay)}
              </div>
              <div class="screening-where">
                {venueName(venues, screening.venue)}
                {screening.screen ? `, ${screening.screen}` : ""}
                {screening.noteRaw ? <span class="muted"> · {screening.noteRaw}</span> : null}
              </div>
              <div class="screening-actions">
                <button
                  class={pinned ? "active" : ""}
                  title="Pin: the scheduler must use exactly this screening"
                  onClick={() => setPinned(id, pinned ? null : screening.id)}
                >
                  {pinned ? "📌 Pinned" : "Pin"}
                </button>
                <button
                  class={excluded ? "active" : ""}
                  title="Exclude: the scheduler must never use this screening"
                  onClick={() => toggleExcluded(id, screening.id)}
                >
                  {excluded ? "Excluded ✕" : "Exclude"}
                </button>
                {screening.bookingUrl && (
                  <a href={screening.bookingUrl} target="_blank" rel="noreferrer noopener">
                    Book ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {film.synopsis && <p class="synopsis">{film.synopsis}</p>}
      <div class="writeup" dangerouslySetInnerHTML={{ __html: film.writeupHtml }} />

      <h3>Notes</h3>
      <textarea
        class="notes"
        placeholder="Your notes on this film…"
        value={sel?.notes ?? ""}
        onChange={(e) => setNotes(id, (e.target as HTMLTextAreaElement).value)}
      />
      <p class="muted source">
        Source: <a href={film.sourceUrl} target="_blank" rel="noreferrer noopener">{film.sourceUrl}</a>
      </p>
    </div>
  );
}
