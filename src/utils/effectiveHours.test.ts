import { describe, it, expect } from "vitest";
import {
  applyTolerance,
  parseHHMM,
  formatHHMM,
  computeEffectiveShift,
  pairShiftsToSchedule,
  computeEffectiveDay,
  aggregateEffectiveHours,
  getContractHours,
  resolveToleranceMinutes,
  DEFAULT_TOLERANCE_MINUTES,
} from "./effectiveHours";
import { HourEntry, ScheduledShift, StaffMember } from "../types";

// Unit tests for the tolerance-aware hours calculation (Phase A).
//   npm test              — run once
//   npm run test:watch    — re-run on change
//
// Runs on vitest, which reuses the project's existing vite.config.ts, so
// there is no separate build/transform config to keep in sync. These
// tests are pure-Node (no DOM): effectiveHours.ts is deliberately a
// framework-free module so it can be exercised without rendering
// anything.

const HHMM = (m: number) => formatHHMM(m);
const SCHED_9_17 = { startTime: "09:00", endTime: "17:00" };
const TOL = 10;

describe("the six worked examples from the spec (scheduled 09:00–17:00, tolerance 10)", () => {
  it("in 08:55 (early, within tolerance) → 08:55, the earlier of the two", () => {
    expect(HHMM(applyTolerance(parseHHMM("08:55")!, parseHHMM("09:00")!, TOL, "start"))).toBe("08:55");
  });

  it("in 09:04 (late, within tolerance) → 09:00, the earlier of the two", () => {
    expect(HHMM(applyTolerance(parseHHMM("09:04")!, parseHHMM("09:00")!, TOL, "start"))).toBe("09:00");
  });

  it("in 09:15 (late, OUTSIDE tolerance) → 09:15 raw, no adjustment", () => {
    expect(HHMM(applyTolerance(parseHHMM("09:15")!, parseHHMM("09:00")!, TOL, "start"))).toBe("09:15");
  });

  it("out 17:04 (late, within tolerance) → 17:04, the later of the two", () => {
    expect(HHMM(applyTolerance(parseHHMM("17:04")!, parseHHMM("17:00")!, TOL, "end"))).toBe("17:04");
  });

  it("out 16:56 (early, within tolerance) → 17:00, the later of the two", () => {
    expect(HHMM(applyTolerance(parseHHMM("16:56")!, parseHHMM("17:00")!, TOL, "end"))).toBe("17:00");
  });

  it("out 16:40 (early, OUTSIDE tolerance) → 16:40 raw, no adjustment", () => {
    expect(HHMM(applyTolerance(parseHHMM("16:40")!, parseHHMM("17:00")!, TOL, "end"))).toBe("16:40");
  });
});

describe("boundary: exactly ON the tolerance edge counts as WITHIN (<=)", () => {
  it("in 09:10 (exactly +10) → 09:00", () => {
    expect(HHMM(applyTolerance(550, 540, 10, "start"))).toBe("09:00");
  });
  it("in 08:50 (exactly −10) → 08:50", () => {
    expect(HHMM(applyTolerance(530, 540, 10, "start"))).toBe("08:50");
  });
  it("in 09:11 (+11, one minute outside) → 09:11 raw", () => {
    expect(HHMM(applyTolerance(551, 540, 10, "start"))).toBe("09:11");
  });
  it("out 17:10 (exactly +10) → 17:10", () => {
    expect(HHMM(applyTolerance(1030, 1020, 10, "end"))).toBe("17:10");
  });
  it("out 16:50 (exactly −10) → 17:00", () => {
    expect(HHMM(applyTolerance(1010, 1020, 10, "end"))).toBe("17:00");
  });
  it("out 16:49 (−11, one minute outside) → 16:49 raw", () => {
    expect(HHMM(applyTolerance(1009, 1020, 10, "end"))).toBe("16:49");
  });
});

describe("tolerance of 0 disables adjustment entirely", () => {
  it("in 09:04 → 09:04 raw", () => {
    expect(HHMM(applyTolerance(544, 540, 0, "start"))).toBe("09:04");
  });
  it("in 09:00 exact still aligns", () => {
    expect(HHMM(applyTolerance(540, 540, 0, "start"))).toBe("09:00");
  });
  it("out 16:56 → 16:56 raw", () => {
    expect(HHMM(applyTolerance(1016, 1020, 0, "end"))).toBe("16:56");
  });
});

describe("full shift: both edges together", () => {
  it("both within tolerance → 09:00–17:00, a full 8h despite clocking 7h52m", () => {
    const r = computeEffectiveShift({ startTime: "09:04", endTime: "16:56", hours: 7.87 }, SCHED_9_17, TOL);
    expect([r.effectiveStart, r.effectiveEnd]).toEqual(["09:00", "17:00"]);
    expect(r.effectiveHours).toBe(8);
  });

  it("carries the raw actual values through untouched", () => {
    const r = computeEffectiveShift({ startTime: "09:04", endTime: "16:56", hours: 7.87 }, SCHED_9_17, TOL);
    expect([r.actualStart, r.actualEnd]).toEqual(["09:04", "16:56"]);
    expect(r.actualHours).toBe(7.87);
  });

  it("both outside tolerance → raw window, no adjustment either end", () => {
    const r = computeEffectiveShift({ startTime: "09:15", endTime: "16:40", hours: 7.42 }, SCHED_9_17, TOL);
    expect([r.effectiveStart, r.effectiveEnd]).toEqual(["09:15", "16:40"]);
    expect(r.effectiveHours).toBeCloseTo(7.42, 2);
  });

  it("mixed: late-but-within start, early-and-outside end", () => {
    const r = computeEffectiveShift({ startTime: "09:04", endTime: "16:40", hours: 7.6 }, SCHED_9_17, TOL);
    expect([r.effectiveStart, r.effectiveEnd]).toEqual(["09:00", "16:40"]);
    expect(r.effectiveHours).toBeCloseTo(7.67, 2);
  });
});

describe("overnight shifts (cross-midnight)", () => {
  it("22:00–06:00 scheduled, clocked 21:58–06:03, both within tolerance", () => {
    const r = computeEffectiveShift(
      { startTime: "21:58", endTime: "06:03", hours: 8.08 },
      { startTime: "22:00", endTime: "06:00" },
      TOL,
    );
    expect([r.effectiveStart, r.effectiveEnd]).toEqual(["21:58", "06:03"]);
    expect(r.effectiveHours).toBeCloseTo(8.08, 2);
  });

  it("clocked out 05:52 (8 min early, within) → pushed to the scheduled 06:00", () => {
    const r = computeEffectiveShift(
      { startTime: "22:00", endTime: "05:52", hours: 7.87 },
      { startTime: "22:00", endTime: "06:00" },
      TOL,
    );
    expect(r.effectiveEnd).toBe("06:00");
    expect(r.effectiveHours).toBe(8);
  });
});

describe("unscheduled shifts use raw actual times", () => {
  it("no schedule → effective equals actual, and the flag is set", () => {
    const r = computeEffectiveShift({ startTime: "12:00", endTime: "15:30", hours: 3.5 }, null, TOL);
    expect([r.effectiveStart, r.effectiveEnd]).toEqual(["12:00", "15:30"]);
    expect(r.effectiveHours).toBe(3.5);
    expect(r.unscheduled).toBe(true);
  });
});

describe("shift ↔ schedule pairing (no stored link exists; matched by nearest start)", () => {
  it("split shift clocked out of order still pairs to the right halves", () => {
    const pairs = pairShiftsToSchedule(
      [
        { startTime: "17:58", endTime: "23:05", hours: 5.12 },
        { startTime: "09:02", endTime: "14:03", hours: 5.02 },
      ],
      [
        { startTime: "09:00", endTime: "14:00" },
        { startTime: "18:00", endTime: "23:00" },
      ],
    );
    expect(pairs[0].scheduled?.startTime).toBe("18:00");
    expect(pairs[1].scheduled?.startTime).toBe("09:00");
  });

  it("3 clock records vs 2 scheduled shifts → exactly 1 unscheduled, no schedule reused", () => {
    const pairs = pairShiftsToSchedule(
      [
        { startTime: "09:00", endTime: "12:00", hours: 3 },
        { startTime: "13:00", endTime: "17:00", hours: 4 },
        { startTime: "18:00", endTime: "20:00", hours: 2 },
      ],
      [
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "13:00", endTime: "17:00" },
      ],
    );
    expect(pairs.filter(p => p.scheduled === null)).toHaveLength(1);
    expect(new Set(pairs.map(p => p.scheduled?.startTime).filter(Boolean)).size).toBe(2);
  });
});

describe("RAW CLOCK RECORD IS NEVER MUTATED (the hard requirement)", () => {
  const rawSched: ScheduledShift = {
    id: "s1", name: "Marie", date: "2026-08-10",
    startTime: "09:00", endTime: "17:00", hours: 8, role: "server",
  };

  it("computeEffectiveShift leaves both arguments byte-identical", () => {
    const rawShift = { startTime: "09:04", endTime: "16:56", hours: 7.87 };
    const sched = { ...rawSched };
    const shiftBefore = structuredClone(rawShift);
    const schedBefore = structuredClone(sched);

    computeEffectiveShift(rawShift, sched, TOL);

    expect(rawShift).toEqual(shiftBefore);
    expect(sched).toEqual(schedBefore);
  });

  it("is pure — calling twice returns identical results", () => {
    const rawShift = { startTime: "09:04", endTime: "16:56", hours: 7.87 };
    const first = computeEffectiveShift(rawShift, rawSched, TOL);
    const second = computeEffectiveShift(rawShift, rawSched, TOL);
    expect(first).toEqual(second);
  });

  it("accepts deep-frozen inputs without throwing (proves it cannot write)", () => {
    // ES modules are always strict mode, so any assignment to a frozen
    // object would throw rather than fail silently.
    const frozenShift = Object.freeze({ startTime: "09:04", endTime: "16:56", hours: 7.87 });
    const frozenSched = Object.freeze({ startTime: "09:00", endTime: "17:00" });
    expect(() => computeEffectiveShift(frozenShift, frozenSched, TOL)).not.toThrow();
  });

  it("computeEffectiveDay leaves the entry and schedule untouched, incl. entry.hours", () => {
    const entry: HourEntry = {
      id: 1, name: "Marie", date: "2026-08-10", type: "worked", hours: 7.87,
      shifts: [{ startTime: "09:04", endTime: "16:56", hours: 7.87, overnight: false }],
      startTime: "09:04", endTime: "16:56", note: "", submittedAt: "2026-08-10T17:00:00.000Z",
      status: "approved",
    };
    const sched: ScheduledShift[] = [{ ...rawSched }];
    const entryBefore = structuredClone(entry);
    const schedBefore = structuredClone(sched);

    const day = computeEffectiveDay(entry, sched, TOL);

    expect(entry).toEqual(entryBefore);
    expect(sched).toEqual(schedBefore);
    // The stored payroll number specifically — this is the one the live
    // export reads, and Phase A must not move it.
    expect(entry.hours).toBe(7.87);
    expect([day.effectiveHours, day.actualHours]).toEqual([8, 7.87]);
  });
});

describe("non-worked entries (absence/sick/holiday) are never tolerance-adjusted", () => {
  it("a sick day yields 0 effective and 0 actual hours", () => {
    const sick: HourEntry = {
      id: 2, name: "Marie", date: "2026-08-11", type: "sick", hours: 8,
      shifts: [], startTime: null, endTime: null, note: "", submittedAt: "", status: "approved",
    };
    const day = computeEffectiveDay(sick, [], TOL);
    expect([day.effectiveHours, day.actualHours]).toEqual([0, 0]);
  });
});

describe("contract threshold reuses the existing source of truth", () => {
  const staff: StaffMember[] = [
    { name: "Marie", role: "server", rate: 12, contract: 35, pin: "1111" },
    { name: "Thomas", role: "kitchen", rate: 14, contract: 20, pin: "2222" },
    { name: "Zero", role: "bar", rate: 11, contract: 0, pin: "3333" },
  ];

  it("a part-time per-employee contract wins over the config value", () => {
    expect(getContractHours("Thomas", staff, { overtime_limit: 35 })).toBe(20);
  });

  it("a full-time contract is used as-is", () => {
    expect(getContractHours("Marie", staff, { overtime_limit: 35 })).toBe(35);
  });

  it("a contract of 0 falls through to config — mirrors ManagerDashboard's || semantics", () => {
    // Deliberately replicating current live behaviour, not "fixing" it to
    // ??; changing this would silently alter existing overtime numbers.
    expect(getContractHours("Zero", staff, { overtime_limit: 39 })).toBe(39);
  });

  it("unknown staff falls back to the config value", () => {
    expect(getContractHours("Ghost", staff, { overtime_limit: 39 })).toBe(39);
  });

  it("no config at all falls back to 35", () => {
    expect(getContractHours("Ghost", staff, null)).toBe(35);
  });
});

describe("resolveToleranceMinutes defaults and guards", () => {
  it("unset → the 10-minute default", () => {
    expect(resolveToleranceMinutes({})).toBe(DEFAULT_TOLERANCE_MINUTES);
  });
  it("null config → 10", () => {
    expect(resolveToleranceMinutes(null)).toBe(10);
  });
  it("an explicit 0 is preserved, not treated as unset", () => {
    expect(resolveToleranceMinutes({ tolerance_minutes: 0 })).toBe(0);
  });
  it("an explicit 15 is preserved", () => {
    expect(resolveToleranceMinutes({ tolerance_minutes: 15 })).toBe(15);
  });
  it("negative → default", () => {
    expect(resolveToleranceMinutes({ tolerance_minutes: -5 })).toBe(10);
  });
  it("NaN → default", () => {
    expect(resolveToleranceMinutes({ tolerance_minutes: NaN })).toBe(10);
  });
});

describe("weekly aggregation + overtime from effective hours", () => {
  const staff: StaffMember[] = [
    { name: "Marie", role: "server", rate: 12, contract: 35, pin: "1111" },
  ];
  const mkEntry = (date: string, start: string, end: string, hours: number): HourEntry => ({
    id: Math.random(), name: "Marie", date, type: "worked", hours,
    shifts: [{ startTime: start, endTime: end, hours, overnight: false }],
    startTime: start, endTime: end, note: "", submittedAt: "", status: "approved",
  });
  const mkSched = (date: string): ScheduledShift => ({
    id: "s" + date, name: "Marie", date,
    startTime: "09:00", endTime: "17:00", hours: 8, role: "server",
  });
  const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"];

  it("5 days clocked 09:04–16:56 → 40h effective vs 39.35h actual, +0.65 variance", () => {
    const entries = dates.map(d => mkEntry(d, "09:04", "16:56", 7.87));
    const scheds = dates.map(mkSched);
    const [agg] = aggregateEffectiveHours(entries, scheds, staff, { overtime_limit: 35 });

    expect(agg.effectiveHours).toBe(40);
    expect(agg.actualHours).toBeCloseTo(39.35, 2);
    expect(agg.varianceHours).toBeCloseTo(0.65, 2);
    expect(agg.contractHours).toBe(35);
    // Overtime is computed from EFFECTIVE hours against the same
    // threshold the live export uses.
    expect(agg.overtimeHours).toBe(5);
  });

  it("excludes pending entries by default, matching the live CSV export's approved-only filter", () => {
    const pending: HourEntry = {
      id: 9, name: "Marie", date: "2026-08-10", type: "worked", hours: 8,
      shifts: [{ startTime: "09:00", endTime: "17:00", hours: 8, overnight: false }],
      startTime: "09:00", endTime: "17:00", note: "", submittedAt: "", status: "pending",
    };
    expect(aggregateEffectiveHours([pending], [], staff, {})).toHaveLength(0);
    expect(
      aggregateEffectiveHours([pending], [], staff, {}, { includeStatuses: ["pending", "approved"] })[0].effectiveHours,
    ).toBe(8);
  });
});

describe("malformed data degrades safely rather than producing NaN", () => {
  it("parseHHMM rejects garbage, out-of-range and null", () => {
    expect(parseHHMM("nope")).toBeNull();
    expect(parseHHMM("25:00")).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });

  it("an unparseable clock time falls back to the stored hours", () => {
    const r = computeEffectiveShift({ startTime: "bad", endTime: "17:00", hours: 4 }, SCHED_9_17, TOL);
    expect(r.effectiveHours).toBe(4);
  });
});
