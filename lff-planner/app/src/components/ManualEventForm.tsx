import { useState } from "preact/hooks";
import type { Flags } from "@shared/schemas.ts";
import { venuesFile, filmsFile } from "../state/films.ts";
import { addManualEvent } from "../state/selections.ts";

/** Form for events outside the scraped programme (e.g. the Surprise Film). */
export function ManualEventForm({ onClose }: { onClose: () => void }) {
  const venues = venuesFile.value;
  const festival = filmsFile.value?.festival;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(festival?.startDate ?? "");
  const [time, setTime] = useState("20:00");
  const [runtime, setRuntime] = useState("120");
  const [venue, setVenue] = useState(venues?.venues[0]?.id ?? "");
  const [flags, setFlags] = useState<Flags>({ tristan: true, amy: false, priority: false, maybe: false });
  const [error, setError] = useState("");

  const submit = (e: Event) => {
    e.preventDefault();
    if (!title.trim()) return setError("A title is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Date must be YYYY-MM-DD");
    if (!/^\d{2}:\d{2}$/.test(time)) return setError("Time must be HH:MM");
    const runtimeMinutes = Number(runtime) || null;
    addManualEvent({
      title: title.trim(),
      runtimeMinutes,
      flags,
      screenings: [
        {
          id: `manual-${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}#${date}T${time}`,
          start: `${date}T${time}:00+01:00`,
          venue,
          screen: null,
        },
      ],
      notes: null,
    });
    onClose();
  };

  return (
    <form class="manual-event-form" onSubmit={submit}>
      <h3>Add manual event</h3>
      <label>
        Title
        <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Surprise Film" />
      </label>
      <div class="row">
        <label>
          Date
          <input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Start
          <input type="time" value={time} onInput={(e) => setTime((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Runtime (min)
          <input type="number" value={runtime} onInput={(e) => setRuntime((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <label>
        Venue
        <select value={venue} onChange={(e) => setVenue((e.target as HTMLSelectElement).value)}>
          {venues?.venues.map((v) => (
            <option value={v.id}>{v.name}</option>
          ))}
        </select>
      </label>
      <div class="row flags-row">
        {(["tristan", "amy", "priority", "maybe"] as const).map((key) => (
          <label class="checkbox">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(e) => setFlags({ ...flags, [key]: (e.target as HTMLInputElement).checked })}
            />
            {key[0]!.toUpperCase() + key.slice(1)}
          </label>
        ))}
      </div>
      {error && <p class="error">{error}</p>}
      <div class="row">
        <button type="submit" class="primary">Add event</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
