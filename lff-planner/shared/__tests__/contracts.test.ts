import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConstraintsFileSchema, FilmsFileSchema, VenuesFileSchema } from "../schemas.ts";
import { resolveVenue, travelMinutes } from "../venues.ts";
import { dateRange, daysBetween, festivalMinutes, formatDate, hmToMinutes, weekdayOf } from "../time.ts";
import { emptySelections, findOrphans, isVacuous, mergeSelections } from "../selections.ts";
import type { FilmSelection, VenuesFile } from "../schemas.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (rel: string) => JSON.parse(readFileSync(join(root, rel), "utf-8"));

const venuesFile: VenuesFile = VenuesFileSchema.parse(load("pipeline/venues.json"));

describe("data contracts", () => {
  it("sample films.json validates", () => {
    const parsed = FilmsFileSchema.safeParse(load("data/sample/films.json"));
    expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues, null, 2)).toBe(true);
    if (parsed.success) expect(parsed.data.films.length).toBe(10);
  });

  it("rejects duplicate film ids", () => {
    const data = load("data/sample/films.json");
    data.films.push(structuredClone(data.films[0]));
    expect(FilmsFileSchema.safeParse(data).success).toBe(false);
  });

  it("constraints.json validates and covers Amy's 2026 absence", () => {
    const constraints = ConstraintsFileSchema.parse(load("data/constraints.json"));
    expect(constraints.amyAbsences).toContainEqual({ from: "2026-10-13", to: "2026-10-15" });
  });
});

describe("venue resolution", () => {
  it("maps Southbank Centre to Royal Festival Hall", () => {
    expect(resolveVenue(venuesFile, "Southbank Centre")).toEqual({
      venue: "royal-festival-hall",
      screen: null,
      known: true,
    });
  });

  it("captures the screen from an alias prefix", () => {
    expect(resolveVenue(venuesFile, "BFI Southbank NFT1")).toEqual({
      venue: "bfi-southbank",
      screen: "NFT1",
      known: true,
    });
    expect(resolveVenue(venuesFile, "Curzon Soho Screen 2")).toEqual({
      venue: "curzon-soho",
      screen: "Screen 2",
      known: true,
    });
  });

  it("passes unknown venues through as slugs, flagged unknown", () => {
    expect(resolveVenue(venuesFile, "Rich Mix Shoreditch")).toEqual({
      venue: "rich-mix-shoreditch",
      screen: null,
      known: false,
    });
  });
});

describe("travel matrix", () => {
  const t = (a: string, b: string) => travelMinutes(venuesFile, a, b);
  it("intra-West-End cluster is 7 minutes", () => {
    expect(t("curzon-soho", "vue-west-end")).toEqual({ minutes: 7, known: true });
    expect(t("prince-charles", "curzon-soho")).toEqual({ minutes: 7, known: true });
  });
  it("user-specified pairs", () => {
    expect(t("vue-west-end", "curzon-mayfair").minutes).toBe(30);
    expect(t("curzon-soho", "bfi-southbank").minutes).toBe(30);
    expect(t("bfi-southbank", "curzon-mayfair").minutes).toBe(45);
    expect(t("royal-festival-hall", "curzon-mayfair").minutes).toBe(40); // pair override beats zone (45)
    expect(t("royal-festival-hall", "bfi-southbank").minutes).toBe(5);
  });
  it("same venue is zero; unknown venue falls back to default, flagged", () => {
    expect(t("ica", "ica")).toEqual({ minutes: 0, known: true });
    expect(t("rich-mix-shoreditch", "bfi-southbank")).toEqual({ minutes: 30, known: false });
  });
  it("is symmetric", () => {
    for (const a of venuesFile.venues) {
      for (const b of venuesFile.venues) {
        expect(t(a.id, b.id).minutes).toBe(t(b.id, a.id).minutes);
      }
    }
  });
});

describe("festival time", () => {
  it("computes festival minutes from wall clock, ignoring offsets", () => {
    expect(festivalMinutes("2025-10-08", "2025-10-08T00:00:00+01:00")).toBe(0);
    expect(festivalMinutes("2025-10-08", "2025-10-09T20:45:00+01:00")).toBe(1440 + 20 * 60 + 45);
  });
  it("date helpers", () => {
    expect(daysBetween("2025-10-08", "2025-10-19")).toBe(11);
    expect(weekdayOf("2026-10-13")).toBe("tue");
    expect(weekdayOf("2026-10-17")).toBe("sat");
    expect(dateRange("2026-10-13", "2026-10-15")).toEqual(["2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(hmToMinutes("16:30")).toBe(990);
    expect(formatDate("2025-10-09")).toBe("Thu 9 Oct");
  });
});

describe("selections", () => {
  const sel = (updatedAt: string, extra: Partial<FilmSelection> = {}): FilmSelection => ({
    tristan: true,
    amy: false,
    priority: false,
    maybe: false,
    updatedAt,
    ...extra,
  });

  it("merges per film, newest updatedAt wins", () => {
    const a = emptySelections(2025);
    a.films["film-1"] = sel("2025-09-01T10:00:00Z", { notes: "older" });
    a.films["film-2"] = sel("2025-09-05T10:00:00Z");
    const b = emptySelections(2025);
    b.films["film-1"] = sel("2025-09-02T10:00:00Z", { notes: "newer" });
    b.films["film-3"] = sel("2025-09-01T09:00:00Z");
    const merged = mergeSelections(a, b);
    expect(merged.films["film-1"]?.notes).toBe("newer");
    expect(Object.keys(merged.films).sort()).toEqual(["film-1", "film-2", "film-3"]);
    // Symmetric outcome regardless of argument order.
    expect(mergeSelections(b, a).films["film-1"]?.notes).toBe("newer");
  });

  it("detects orphans but ignores vacuous entries", () => {
    const films = FilmsFileSchema.parse(load("data/sample/films.json"));
    const s = emptySelections(2025);
    s.films["the-glass-harbour"] = sel("2025-09-01T10:00:00Z");
    s.films["removed-film"] = sel("2025-09-01T10:00:00Z");
    s.films["vacuous-removed"] = {
      tristan: false, amy: false, priority: false, maybe: false,
      updatedAt: "2025-09-01T10:00:00Z",
    };
    expect(findOrphans(s, films)).toEqual(["removed-film"]);
    expect(isVacuous(s.films["vacuous-removed"]!)).toBe(true);
  });
});
