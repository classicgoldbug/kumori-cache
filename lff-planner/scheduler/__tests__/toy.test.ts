import { describe, expect, it } from "vitest";
import { buildModel, buildSchedule, schedule, solve, ConflictingPinsError } from "../index.ts";
import { buildFixture, testConstraints, testVenues } from "./helpers.ts";

const run = (specs: Parameters<typeof buildFixture>[0], constraints = testConstraints()) => {
  const { films, selections } = buildFixture(specs);
  return schedule({ films, selections, venues: testVenues, constraints });
};

describe("solver beats greedy", () => {
  it("sacrifices the first-ranked film when two others are jointly worth more", () => {
    // a (30) overlaps both b (30) and c (30); b and c are compatible.
    // Greedy-by-value (ties by index) takes a → 30. Optimum is b + c → 60.
    const { schedule: result } = run([
      { id: "a", runtime: 105, flags: { tristan: true }, screenings: [{ date: "2025-10-10", time: "19:00", venue: "curzon-soho" }] },
      { id: "b", runtime: 100, flags: { tristan: true }, screenings: [{ date: "2025-10-10", time: "18:00", venue: "curzon-soho" }] },
      { id: "c", runtime: 90, flags: { tristan: true }, screenings: [{ date: "2025-10-10", time: "20:30", venue: "vue-west-end" }] },
    ]);
    expect(result.objective).toBe(60);
    expect(result.optimal).toBe(true);
    expect(result.chosen.map((c) => c.filmId).sort()).toEqual(["b", "c"]);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0]!.filmId).toBe("a");
    expect(result.unscheduled[0]!.reason).toBe("conflict");
    // Forcing a in displaces both b and c: delta 30 − 60 = −30.
    const best = result.unscheduled[0]!.alternatives[0]!;
    expect(best.objectiveDelta).toBe(-30);
    expect(best.displaced.sort()).toEqual(["b", "c"]);
  });
});

describe("travel-time conflicts", () => {
  it("blocks BFI Southbank → Curzon Mayfair with a 40-minute gap (needs 45+10)", () => {
    const { schedule: result } = run([
      { id: "southbank", runtime: 120, flags: { priority: true, tristan: true }, screenings: [{ date: "2025-10-11", time: "16:00", venue: "bfi-southbank" }] },
      { id: "mayfair", runtime: 90, flags: { tristan: true }, screenings: [{ date: "2025-10-11", time: "18:40", venue: "curzon-mayfair" }] },
    ]);
    // 16:00+120 = 18:00; 18:40 < 18:00 + 45 + 10 = 18:55 → conflict; priority film wins.
    expect(result.chosen.map((c) => c.filmId)).toEqual(["southbank"]);
    expect(result.unscheduled[0]!.filmId).toBe("mayfair");
  });

  it("allows Soho → Vue West End with the same gap (needs 7+10)", () => {
    const { schedule: result } = run([
      { id: "soho", runtime: 120, flags: { priority: true, tristan: true }, screenings: [{ date: "2025-10-11", time: "16:00", venue: "curzon-soho" }] },
      { id: "vue", runtime: 90, flags: { tristan: true }, screenings: [{ date: "2025-10-11", time: "18:40", venue: "vue-west-end" }] },
    ]);
    expect(result.chosen.map((c) => c.filmId)).toEqual(["soho", "vue"]);
    // 18:40 − 18:00 − 7 − 10 = 23 min slack → no tight-transfer warning.
    expect(result.warnings.filter((w) => w.type === "tight-transfer")).toHaveLength(0);
  });

  it("warns on a tight (but feasible) transfer", () => {
    const { schedule: result } = run([
      { id: "soho", runtime: 120, flags: { tristan: true }, screenings: [{ date: "2025-10-11", time: "16:00", venue: "curzon-soho" }] },
      { id: "vue", runtime: 90, flags: { tristan: true }, screenings: [{ date: "2025-10-11", time: "18:20", venue: "vue-west-end" }] },
    ]);
    // slack = 18:20 − 18:00 − 7 − 10 = 3 min → chosen but warned.
    expect(result.chosen).toHaveLength(2);
    const warning = result.warnings.find((w) => w.type === "tight-transfer");
    expect(warning?.slackMinutes).toBe(3);
  });
});

describe("Amy", () => {
  it("prefers the screening Amy can attend during her absence window", () => {
    const constraints = testConstraints({ amyAbsences: [{ from: "2025-10-13", to: "2025-10-15" }] });
    const { schedule: result } = run(
      [
        {
          id: "joint",
          runtime: 100,
          flags: { tristan: true, amy: true },
          screenings: [
            { date: "2025-10-14", time: "18:00", venue: "curzon-soho" }, // Amy away → value 30
            { date: "2025-10-16", time: "18:00", venue: "curzon-soho" }, // both → value 60
          ],
        },
      ],
      constraints,
    );
    expect(result.chosen[0]!.screeningId).toBe("joint#1");
    expect(result.chosen[0]!.attendees).toEqual(["tristan", "amy"]);
  });

  it("reports an Amy-only film with all screenings inside her absence", () => {
    const constraints = testConstraints({ amyAbsences: [{ from: "2025-10-13", to: "2025-10-15" }] });
    const { schedule: result } = run(
      [{ id: "amy-only", runtime: 100, flags: { amy: true }, screenings: [{ date: "2025-10-14", time: "18:00", venue: "ica" }] }],
      constraints,
    );
    expect(result.chosen).toHaveLength(0);
    expect(result.unscheduled[0]!.reason).toBe("amy-absent-all-screenings");
  });

  it("day-target relief steers the choice between equal-value screenings", () => {
    // Saturday 2025-10-11 has target min 1 (penalty 25 when unmet).
    // Same film value both days → picking Saturday avoids the penalty.
    const constraints = testConstraints({ amyDayTargets: { sat: { min: 1, max: 3 } } });
    const { schedule: result } = run(
      [
        {
          id: "flex",
          runtime: 100,
          flags: { tristan: true, amy: true },
          screenings: [
            { date: "2025-10-14", time: "18:00", venue: "curzon-soho" }, // Tuesday
            { date: "2025-10-11", time: "18:00", venue: "curzon-soho" }, // Saturday
          ],
        },
      ],
      constraints,
    );
    expect(result.chosen[0]!.screeningId).toBe("flex#1");
    // Objective: 60 − 25 (second Saturday... none missing) = 60; Saturdays 18 Oct unmet → −25.
    // Two Saturdays in the window (11th and 18th): one satisfied, one not.
    expect(result.objective).toBe(60 - 25);
    const sat18 = result.days.find((d) => d.date === "2025-10-18");
    expect(sat18?.penalty).toBe(25);
  });

  it("applies the early-evening preference window penalty", () => {
    const constraints = testConstraints({
      amyDayTargets: { thu: { min: 0, max: 3, preferredStart: { from: "16:30", to: "20:15" } } },
    });
    // Thursday 2025-10-09: 21:30 start is outside Amy's preferred window →
    // joint value 30+30−10 = 50; the 18:00 screening keeps the full 60.
    const { schedule: result } = run(
      [
        {
          id: "thu-film",
          runtime: 90,
          flags: { tristan: true, amy: true },
          screenings: [
            { date: "2025-10-09", time: "21:30", venue: "curzon-soho" },
            { date: "2025-10-09", time: "18:00", venue: "curzon-soho" },
          ],
        },
      ],
      constraints,
    );
    expect(result.chosen[0]!.screeningId).toBe("thu-film#1");
    expect(result.objective).toBe(60);
  });
});

describe("pins and exclusions", () => {
  it("honours a pin even when another screening scores higher", () => {
    const constraints = testConstraints({ amyDayTargets: { sat: { min: 1, max: 3 } } });
    const { schedule: result } = run(
      [
        {
          id: "pinned-film",
          runtime: 100,
          flags: { tristan: true, amy: true },
          pin: 0,
          screenings: [
            { date: "2025-10-14", time: "18:00", venue: "curzon-soho" }, // pinned (Tuesday)
            { date: "2025-10-11", time: "18:00", venue: "curzon-soho" }, // Saturday would relieve penalty
          ],
        },
      ],
      constraints,
    );
    expect(result.chosen[0]!.screeningId).toBe("pinned-film#0");
    expect(result.chosen[0]!.pinned).toBe(true);
  });

  it("aborts with a named pair when two pins conflict", () => {
    const { films, selections } = buildFixture([
      { id: "x", runtime: 120, flags: { tristan: true }, pin: 0, screenings: [{ date: "2025-10-10", time: "18:00", venue: "curzon-soho" }] },
      { id: "y", runtime: 120, flags: { tristan: true }, pin: 0, screenings: [{ date: "2025-10-10", time: "18:30", venue: "curzon-soho" }] },
    ]);
    const model = buildModel({ films, selections, venues: testVenues, constraints: testConstraints() });
    expect(() => solve(model)).toThrowError(ConflictingPinsError);
  });

  it("treats a fully-excluded film as unschedulable, not an error", () => {
    const { schedule: result } = run([
      { id: "gone", runtime: 100, flags: { tristan: true }, exclude: [0], screenings: [{ date: "2025-10-10", time: "18:00", venue: "ica" }] },
    ]);
    expect(result.chosen).toHaveLength(0);
    expect(result.unscheduled[0]!.reason).toBe("excluded-all-screenings");
  });
});

describe("manual events", () => {
  it("schedules a Surprise Film exactly like a programme film", () => {
    const { films, selections } = buildFixture([
      { id: "regular", runtime: 100, flags: { tristan: true }, screenings: [{ date: "2025-10-09", time: "20:30", venue: "prince-charles" }] },
    ]);
    selections.manualEvents.push({
      id: "manual-surprise-film",
      title: "Surprise Film",
      runtimeMinutes: 120,
      flags: { tristan: true, amy: false, priority: true, maybe: false },
      screenings: [
        { id: "manual-surprise-film#0", start: "2025-10-09T20:45:00+01:00", venue: "royal-festival-hall", screen: null },
      ],
      notes: null,
      updatedAt: "2025-01-01T00:00:00Z",
    });
    const { schedule: result } = schedule({ films, selections, venues: testVenues, constraints: testConstraints() });
    // Surprise Film (130) overlaps the 20:30 PCC screening (30) → Surprise wins.
    expect(result.chosen.map((c) => c.filmId)).toEqual(["manual-surprise-film"]);
    expect(result.unscheduled[0]!.filmId).toBe("regular");
  });
});

describe("schedule structure", () => {
  it("never violates conflicts or one-screening-per-film (spot invariant)", () => {
    const { films, selections } = buildFixture([
      { id: "p", runtime: 90, flags: { priority: true, tristan: true }, screenings: [
        { date: "2025-10-10", time: "12:00", venue: "bfi-southbank" },
        { date: "2025-10-10", time: "18:00", venue: "curzon-soho" },
      ] },
      { id: "q", runtime: 90, flags: { tristan: true }, screenings: [
        { date: "2025-10-10", time: "13:00", venue: "bfi-southbank" },
        { date: "2025-10-10", time: "19:45", venue: "vue-west-end" },
      ] },
      { id: "r", runtime: 200, flags: { amy: true, tristan: true }, screenings: [
        { date: "2025-10-10", time: "14:00", venue: "royal-festival-hall" },
      ] },
    ]);
    const model = buildModel({ films, selections, venues: testVenues, constraints: testConstraints() });
    const result = solve(model);
    const byItem = new Set<number>();
    for (const index of result.chosen) {
      const s = model.screenings[index]!;
      expect(byItem.has(s.itemIndex)).toBe(false);
      byItem.add(s.itemIndex);
      for (const other of result.chosen) {
        if (other !== index) expect(model.conflicts[index]!.includes(other)).toBe(false);
      }
    }
    const file = buildSchedule(model, result);
    expect(file.chosen.length + file.unscheduled.length).toBe(3);
  });
});
