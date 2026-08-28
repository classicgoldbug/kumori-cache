/**
 * Zod schemas — the single source of truth for every data contract in the
 * project. Pipeline output, the app's stores, sync payloads, and scheduler
 * input/output all validate against these. JSON Schemas for documentation are
 * emitted from here by scripts/emit-schemas.ts.
 */
import { z } from "zod";

/** ISO-8601 local date-time with explicit offset, e.g. "2026-10-09T20:45:00+01:00". */
export const IsoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/, "expected ISO date-time with offset");

/** Plain date, e.g. "2026-10-13". */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const ScreeningSchema = z.object({
  id: z.string().min(1),
  start: IsoDateTime,
  /** Derived from start + runtime at parse time; consumers recompute rather than trust it. */
  end: IsoDateTime,
  /** Venue string exactly as the source gave it. */
  venueRaw: z.string(),
  /** Canonical venue id from venues.json (or slug pass-through for unknowns). */
  venue: z.string().min(1),
  /** e.g. "NFT1", "Screen 3" — null when the source doesn't say. */
  screen: z.string().nullable(),
  bookingUrl: z.string().nullable(),
  /** Verbatim screening note, e.g. "+ intro and Q&A". */
  noteRaw: z.string().nullable(),
});
export type Screening = z.infer<typeof ScreeningSchema>;

export const FilmImageSchema = z.object({
  thumb: z.string(),
  detail: z.string(),
  /** Provenance: URL on the film's own page, or "manual-override". */
  sourceUrl: z.string(),
});

export const FilmSchema = z.object({
  /** Site permalink slug — stable across re-scrapes; selections key on this. */
  id: z.string().min(1),
  title: z.string().min(1),
  directors: z.array(z.string()),
  writers: z.array(z.string()),
  cast: z.array(z.string()),
  countries: z.array(z.string()),
  /** Production year; null when unparseable. */
  year: z.number().int().nullable(),
  runtimeMinutes: z.number().int().positive().nullable(),
  languages: z.array(z.string()),
  strand: z.string().nullable(),
  synopsis: z.string(),
  /** Full programmer write-up, sanitised to a small tag whitelist. */
  writeupHtml: z.string(),
  image: FilmImageSchema.nullable(),
  sourceUrl: z.string(),
  scrapedAt: z.string(),
  screenings: z.array(ScreeningSchema).min(1),
});
export type Film = z.infer<typeof FilmSchema>;

export const FilmsFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    festival: z.object({
      name: z.string(),
      year: z.number().int(),
      startDate: IsoDate,
      endDate: IsoDate,
    }),
    /** Doubles as the service worker's data-cache version. */
    generatedAt: z.string(),
    films: z.array(FilmSchema),
  })
  .check((ctx) => {
    const seen = new Set<string>();
    for (const film of ctx.value.films) {
      if (seen.has(film.id)) {
        ctx.issues.push({ code: "custom", message: `duplicate film id: ${film.id}`, input: ctx.value });
      }
      seen.add(film.id);
    }
  });
export type FilmsFile = z.infer<typeof FilmsFileSchema>;

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

export const FlagsSchema = z.object({
  tristan: z.boolean(),
  amy: z.boolean(),
  priority: z.boolean(),
  maybe: z.boolean(),
});
export type Flags = z.infer<typeof FlagsSchema>;

export const FilmSelectionSchema = FlagsSchema.extend({
  notes: z.string().optional(),
  /** Hard-lock the film to one screening. */
  pinnedScreeningId: z.string().nullable().optional(),
  /** Screenings the scheduler must never consider. */
  excludedScreeningIds: z.array(z.string()).optional(),
  updatedAt: z.string(),
});
export type FilmSelection = z.infer<typeof FilmSelectionSchema>;

/** Manual events (e.g. the Surprise Film) are film-shaped and schedule identically. */
export const ManualEventSchema = z.object({
  id: z.string().regex(/^manual-/, "manual event ids must start with 'manual-'"),
  title: z.string().min(1),
  runtimeMinutes: z.number().int().positive().nullable(),
  flags: FlagsSchema,
  screenings: z
    .array(
      z.object({
        id: z.string().min(1),
        start: IsoDateTime,
        venue: z.string().min(1),
        screen: z.string().nullable(),
      }),
    )
    .min(1),
  notes: z.string().nullable(),
  updatedAt: z.string(),
});
export type ManualEvent = z.infer<typeof ManualEventSchema>;

export const SelectionsFileSchema = z.object({
  schemaVersion: z.literal(1),
  festivalYear: z.number().int(),
  exportedAt: z.string().optional(),
  films: z.record(z.string(), FilmSelectionSchema),
  manualEvents: z.array(ManualEventSchema),
});
export type SelectionsFile = z.infer<typeof SelectionsFileSchema>;

// ---------------------------------------------------------------------------
// Venues & travel
// ---------------------------------------------------------------------------

export const VenuesFileSchema = z.object({
  schemaVersion: z.literal(1),
  /** Minutes in hand on top of estimated travel. */
  bufferMinutes: z.number().int().min(0),
  /** Travel minutes for any venue pair not resolvable via overrides/zones. */
  defaultTravelMinutes: z.number().int().min(0),
  zones: z.record(z.string(), z.object({ intraMinutes: z.number().int().min(0) })),
  zoneTravel: z.array(z.object({ a: z.string(), b: z.string(), minutes: z.number().int().min(0) })),
  pairOverrides: z.array(z.object({ a: z.string(), b: z.string(), minutes: z.number().int().min(0) })),
  venues: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      zone: z.string().min(1),
      aliases: z.array(z.string()),
    }),
  ),
});
export type VenuesFile = z.infer<typeof VenuesFileSchema>;

// ---------------------------------------------------------------------------
// Constraints & scheduling
// ---------------------------------------------------------------------------

export const DayTargetSchema = z.object({
  min: z.number().int().min(0),
  max: z.number().int().min(0),
  preferredStart: z.object({ from: z.string(), to: z.string() }).optional(),
});

export const ConstraintsFileSchema = z.object({
  schemaVersion: z.literal(1),
  /** Inclusive date ranges when Amy cannot attend anything. HARD. */
  amyAbsences: z.array(z.object({ from: IsoDate, to: IsoDate })),
  /** Soft per-weekday targets for Amy's screening count (mon..sun keys). */
  amyDayTargets: z.record(z.string(), DayTargetSchema),
  weights: z.object({
    priority: z.number(),
    tristan: z.number(),
    amy: z.number(),
    onlyMaybe: z.number(),
    maybeMultiplier: z.number(),
    amyBelowTargetPenalty: z.number(),
    amyAboveTargetPenalty: z.number(),
    amyWindowPenalty: z.number(),
  }),
  /** Extra per-screening padding (ads/intros) if wanted later. */
  paddingMinutes: z.number().int().min(0),
  solver: z.object({ timeBudgetMs: z.number().int().positive() }),
});
export type ConstraintsFile = z.infer<typeof ConstraintsFileSchema>;

export const ScheduleFileSchema = z.object({
  generatedAt: z.string(),
  objective: z.number(),
  optimal: z.boolean(),
  nodesExplored: z.number().int(),
  solveMs: z.number(),
  chosen: z.array(
    z.object({
      filmId: z.string(),
      screeningId: z.string(),
      start: IsoDateTime,
      end: IsoDateTime,
      venue: z.string(),
      attendees: z.array(z.enum(["tristan", "amy"])),
      value: z.number(),
      pinned: z.boolean(),
    }),
  ),
  unscheduled: z.array(
    z.object({
      filmId: z.string(),
      reason: z.enum(["conflict", "amy-absent-all-screenings", "excluded-all-screenings", "not-worth-it"]),
      detail: z.string(),
      alternatives: z.array(
        z.object({
          screeningId: z.string(),
          objectiveDelta: z.number(),
          displaced: z.array(z.string()),
        }),
      ),
    }),
  ),
  days: z.array(
    z.object({
      date: IsoDate,
      tristanCount: z.number().int(),
      amyCount: z.number().int(),
      amyTarget: DayTargetSchema.nullable(),
      penalty: z.number(),
    }),
  ),
  warnings: z.array(
    z.object({
      type: z.enum(["tight-transfer", "unknown-venue-pair"]),
      from: z.string(),
      to: z.string(),
      slackMinutes: z.number(),
      message: z.string(),
    }),
  ),
});
export type ScheduleFile = z.infer<typeof ScheduleFileSchema>;
