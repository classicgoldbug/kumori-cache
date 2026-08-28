/**
 * Fuzz oracle: the branch-and-bound must match a brute-force enumeration on
 * hundreds of random small instances, and every solution must satisfy the
 * hard invariants. This is the correctness gate for the solver.
 */
import { describe, expect, it } from "vitest";
import { buildModel, evaluate, solve } from "../index.ts";
import type { SchedulerModel } from "../index.ts";
import { buildFixture, testConstraints, testVenues, type SpecFilm } from "./helpers.ts";

/** Deterministic PRNG (mulberry32) so failures are reproducible by seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VENUE_IDS = ["bfi-southbank", "royal-festival-hall", "curzon-soho", "vue-west-end", "prince-charles", "curzon-mayfair", "ica"];
const DATES = ["2025-10-09", "2025-10-10", "2025-10-11", "2025-10-12"];

function randomInstance(random: () => number): SpecFilm[] {
  const filmCount = 1 + Math.floor(random() * 6);
  const specs: SpecFilm[] = [];
  for (let f = 0; f < filmCount; f++) {
    const screeningCount = 1 + Math.floor(random() * 3);
    const screenings = [];
    for (let s = 0; s < screeningCount; s++) {
      const hour = 10 + Math.floor(random() * 13);
      const minute = [0, 15, 30, 45][Math.floor(random() * 4)]!;
      screenings.push({
        date: DATES[Math.floor(random() * DATES.length)]!,
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        venue: VENUE_IDS[Math.floor(random() * VENUE_IDS.length)]!,
      });
    }
    const flags = {
      tristan: random() < 0.6,
      amy: random() < 0.4,
      priority: random() < 0.2,
      maybe: random() < 0.3,
    };
    if (!flags.tristan && !flags.amy && !flags.priority && !flags.maybe) flags.tristan = true;
    const spec: SpecFilm = { id: `f${f}`, runtime: 60 + Math.floor(random() * 120), flags, screenings };
    if (random() < 0.15 && screeningCount > 1) spec.exclude = [Math.floor(random() * screeningCount)];
    specs.push(spec);
  }
  return specs;
}

/** Exhaustive maximum over all conflict-free assignments. */
function bruteForce(model: SchedulerModel): number {
  const items = model.items.filter((i) => i.screenings.length > 0);
  let best = -Infinity;
  const chosen: number[] = [];
  const recurse = (level: number) => {
    if (level === items.length) {
      best = Math.max(best, evaluate(model, chosen));
      return;
    }
    for (const s of items[level]!.screenings) {
      if (chosen.some((c) => model.conflicts[c]!.includes(s.index))) continue;
      chosen.push(s.index);
      recurse(level + 1);
      chosen.pop();
    }
    recurse(level + 1); // skip
  };
  recurse(0);
  return best;
}

describe("fuzz against brute force", () => {
  it("matches the exhaustive optimum on 500 random instances", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const random = rng(seed);
      const withAmyRules = random() < 0.5;
      const constraints = testConstraints(
        withAmyRules
          ? {
              amyAbsences: [{ from: "2025-10-10", to: "2025-10-10" }],
              amyDayTargets: {
                sat: { min: 1, max: 2 },
                thu: { min: 0, max: 1, preferredStart: { from: "16:30", to: "20:15" } },
              },
            }
          : {},
      );
      const { films, selections } = buildFixture(randomInstance(random), {
        start: "2025-10-09",
        end: "2025-10-12",
      });
      const model = buildModel({ films, selections, venues: testVenues, constraints });
      const result = solve(model);
      const expected = bruteForce(model);

      // Objective must equal the exhaustive optimum.
      expect(result.optimal, `seed ${seed} hit the time budget`).toBe(true);
      expect(result.objective, `seed ${seed}: solver ${result.objective} vs brute force ${expected}`).toBe(expected);

      // Invariants on the returned assignment.
      expect(evaluate(model, result.chosen), `seed ${seed}: reported objective mismatch`).toBe(result.objective);
      const seenItems = new Set<number>();
      for (const index of result.chosen) {
        const s = model.screenings[index]!;
        expect(seenItems.has(s.itemIndex), `seed ${seed}: two screenings of one film`).toBe(false);
        seenItems.add(s.itemIndex);
        if (s.amyAttends) {
          expect(model.amyAbsenceDates.has(s.date), `seed ${seed}: Amy scheduled while away`).toBe(false);
        }
        for (const other of result.chosen) {
          if (other === index) continue;
          expect(model.conflicts[index]!.includes(other), `seed ${seed}: conflicting pair chosen`).toBe(false);
        }
      }
    }
  }, 60_000);
});
