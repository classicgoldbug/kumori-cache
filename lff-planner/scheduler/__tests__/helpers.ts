/** Test fixtures: compact builders for films/selections/venues/constraints. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConstraintsFile, FilmsFile, Flags, SelectionsFile, VenuesFile } from "../../shared/schemas.ts";
import { VenuesFileSchema } from "../../shared/schemas.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const testVenues: VenuesFile = VenuesFileSchema.parse(
  JSON.parse(readFileSync(join(root, "pipeline", "venues.json"), "utf-8")),
);

/** Real weights, but no Amy targets/absences unless a test opts in. */
export function testConstraints(overrides: Partial<ConstraintsFile> = {}): ConstraintsFile {
  return {
    schemaVersion: 1,
    amyAbsences: [],
    amyDayTargets: {},
    weights: {
      priority: 100,
      tristan: 30,
      amy: 30,
      onlyMaybe: 10,
      maybeMultiplier: 0.35,
      amyBelowTargetPenalty: 25,
      amyAboveTargetPenalty: 15,
      amyWindowPenalty: 10,
    },
    paddingMinutes: 0,
    solver: { timeBudgetMs: 5000 },
    ...overrides,
  };
}

export interface SpecScreening {
  date: string;
  time: string;
  venue: string;
}

export interface SpecFilm {
  id: string;
  runtime: number;
  flags: Partial<Flags>;
  screenings: SpecScreening[];
  pin?: number;
  exclude?: number[];
}

export function buildFixture(specs: SpecFilm[], festivalDates = { start: "2025-10-08", end: "2025-10-19" }) {
  const films: FilmsFile = {
    schemaVersion: 1,
    festival: { name: "Test Festival", year: 2025, startDate: festivalDates.start, endDate: festivalDates.end },
    generatedAt: "2025-01-01T00:00:00Z",
    films: specs.map((spec) => ({
      id: spec.id,
      title: spec.id,
      directors: [],
      writers: [],
      cast: [],
      countries: [],
      year: 2025,
      runtimeMinutes: spec.runtime,
      languages: [],
      strand: null,
      synopsis: "",
      writeupHtml: "",
      image: null,
      sourceUrl: "https://example.org",
      scrapedAt: "2025-01-01T00:00:00Z",
      screenings: spec.screenings.map((s, i) => ({
        id: `${spec.id}#${i}`,
        start: `${s.date}T${s.time}:00+01:00`,
        end: `${s.date}T${s.time}:00+01:00`,
        venueRaw: s.venue,
        venue: s.venue,
        screen: null,
        bookingUrl: null,
        noteRaw: null,
      })),
    })),
  };
  const selections: SelectionsFile = {
    schemaVersion: 1,
    festivalYear: 2025,
    films: Object.fromEntries(
      specs.map((spec) => [
        spec.id,
        {
          tristan: spec.flags.tristan ?? false,
          amy: spec.flags.amy ?? false,
          priority: spec.flags.priority ?? false,
          maybe: spec.flags.maybe ?? false,
          pinnedScreeningId: spec.pin != null ? `${spec.id}#${spec.pin}` : null,
          excludedScreeningIds: (spec.exclude ?? []).map((i) => `${spec.id}#${i}`),
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ]),
    ),
    manualEvents: [],
  };
  return { films, selections };
}
