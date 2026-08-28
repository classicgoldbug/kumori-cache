/**
 * Schedule from the command line, no app required:
 *
 *   npm run schedule -- --year 2025 --selections exports/lff-selections-2025.json [--out schedule.json]
 *
 * Loads data/<year>/films.json, pipeline/venues.json, data/constraints.json
 * and the given selections export; writes the schedule JSON and prints a
 * day-by-day plan with diagnostics.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstraintsFileSchema,
  FilmsFileSchema,
  SelectionsFileSchema,
  VenuesFileSchema,
} from "../shared/schemas.ts";
import { formatDate } from "../shared/time.ts";
import { venueName } from "../shared/venues.ts";
import { ConflictingPinsError, schedule } from "./index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i]!.startsWith("--") || argv[i + 1] == null) {
    console.error("usage: npm run schedule -- --year <year> --selections <file> [--out <file>]");
    process.exit(1);
  }
  args.set(argv[i]!.slice(2), argv[i + 1]!);
}
const year = args.get("year");
const selectionsPath = args.get("selections");
if (!year || !selectionsPath) {
  console.error("usage: npm run schedule -- --year <year> --selections <file> [--out <file>]");
  process.exit(1);
}

const load = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
const films = FilmsFileSchema.parse(load(join(root, "data", year, "films.json")));
const venues = VenuesFileSchema.parse(load(join(root, "pipeline", "venues.json")));
const constraints = ConstraintsFileSchema.parse(load(join(root, "data", "constraints.json")));
const selections = SelectionsFileSchema.parse(load(selectionsPath));

const titles = new Map<string, string>(films.films.map((f) => [f.id, f.title]));
for (const event of selections.manualEvents) titles.set(event.id, event.title);

try {
  const { schedule: result, notes } = schedule({ films, selections, venues, constraints });

  const outPath = args.get("out") ?? join(root, `schedule-${year}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`\nObjective ${result.objective}${result.optimal ? " (proven optimal)" : " (time-limited — best found)"}`);
  console.log(`${result.chosen.length} screenings chosen, ${result.unscheduled.length} selected films unscheduled`);
  console.log(`${result.nodesExplored} nodes in ${result.solveMs} ms → ${outPath}\n`);

  for (const day of result.days) {
    const rows = result.chosen.filter((c) => c.start.startsWith(day.date));
    if (rows.length === 0 && !day.amyTarget) continue;
    const amyBit = day.amyTarget ? `  [Amy ${day.amyCount}/${day.amyTarget.min}–${day.amyTarget.max}${day.penalty ? ` penalty ${day.penalty}` : ""}]` : "";
    console.log(`${formatDate(day.date)}${amyBit}`);
    for (const row of rows) {
      const who = row.attendees.join("+") || "—";
      console.log(
        `  ${row.start.slice(11, 16)}–${row.end.slice(11, 16)}  ${titles.get(row.filmId) ?? row.filmId}` +
          `  @ ${venueName(venues, row.venue)}  (${who}${row.pinned ? ", pinned" : ""})`,
      );
    }
  }

  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of result.warnings) console.log(`  ${w.type}: ${w.message}`);
  }
  if (result.unscheduled.length > 0) {
    console.log("\nUnscheduled:");
    for (const u of result.unscheduled) {
      console.log(`  ${titles.get(u.filmId) ?? u.filmId} — ${u.reason}: ${u.detail}`);
      for (const alt of u.alternatives.slice(0, 2)) {
        console.log(
          `      force ${alt.screeningId}: objective ${alt.objectiveDelta >= 0 ? "+" : ""}${alt.objectiveDelta}` +
            (alt.displaced.length > 0 ? `, displaces ${alt.displaced.map((d) => titles.get(d) ?? d).join(", ")}` : ""),
        );
      }
    }
  }
  if (notes.length > 0) {
    console.log("\nNotes:");
    for (const note of notes) console.log(`  ${note}`);
  }
} catch (err) {
  if (err instanceof ConflictingPinsError) {
    console.error(`\n${err.message}\nUnpin one of them and re-run.`);
    process.exit(2);
  }
  throw err;
}
