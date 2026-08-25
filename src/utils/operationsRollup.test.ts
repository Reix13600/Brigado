import { describe, it, expect } from "vitest";
import {
  findNoShows,
  findForgottenClockOuts,
  computeOperationsRollup,
  estimateGrossCost,
  DEFAULT_FORGOTTEN_CLOCKOUT_HOURS,
} from "./operationsRollup";
import { HourEntry, ScheduledShift, ActiveClockIn, StaffMember, Shift, VarianceApproval } from "../types";

const shift = (startTime: string, endTime: string, hours: number): Shift => ({
  startTime, endTime, hours, overnight: false,
});

const scheduled = (name: string, date: string, startTime: string, endTime: string, hours: number, id = `${name}-${date}-${startTime}`): ScheduledShift => ({
  id, name, date, startTime, endTime, hours, role: "server",
});

const worked = (name: string, date: string, shifts: Shift[], status: HourEntry["status"] = "approved", extra: Partial<HourEntry> = {}): HourEntry => ({
  id: Math.floor(Math.random() * 1e9),
  name, date, type: "worked",
  hours: shifts.reduce((s, sh) => s + sh.hours, 0),
  shifts,
  startTime: shifts[0]?.startTime ?? null,
  endTime: shifts[shifts.length - 1]?.endTime ?? null,
  note: "", submittedAt: new Date().toISOString(), status,
  ...extra,
});

const member = (name: string, contract = 35): StaffMember => ({
  name, role: "server", rate: 15, contract, pin: "1234", active: true,
});

describe("findNoShows", () => {
  it("a scheduled shift with NO entry at all that day → no-show", () => {
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    const result = findNoShows("Marie", ["2026-08-10"], sched, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Marie", date: "2026-08-10" });
    expect(result[0].scheduled).toBe(sched[0]);
  });

  it("a scheduled shift WITH a matching clock record → not a no-show", () => {
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    const entries = [worked("Marie", "2026-08-10", [shift("09:00", "17:00", 8)])];
    expect(findNoShows("Marie", ["2026-08-10"], sched, entries)).toHaveLength(0);
  });

  it("split shift: one worked, one not → flags only the unworked one", () => {
    const sched = [
      scheduled("Marie", "2026-08-10", "09:00", "14:00", 5, "s1"),
      scheduled("Marie", "2026-08-10", "18:00", "23:00", 5, "s2"),
    ];
    const entries = [worked("Marie", "2026-08-10", [shift("09:00", "14:00", 5)])];
    const result = findNoShows("Marie", ["2026-08-10"], sched, entries);
    expect(result).toHaveLength(1);
    expect(result[0].scheduled.id).toBe("s2");
  });

  it("a non-worked entry (absence/sick/holiday) that day still counts as a no-show for scheduling purposes", () => {
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    const entries: HourEntry[] = [{
      id: 1, name: "Marie", date: "2026-08-10", type: "sick", hours: 0, shifts: [],
      startTime: null, endTime: null, note: "", submittedAt: new Date().toISOString(), status: "approved",
    }];
    // A sick day has no `worked` entry, so pairShiftsToSchedule sees no
    // clock records — matches the no-entry case exactly. Whether that
    // should visually read as "no-show" vs "known absence" is a caller/
    // UI concern; the underlying fact ("no clock record") is correct.
    expect(findNoShows("Marie", ["2026-08-10"], sched, entries)).toHaveLength(1);
  });

  it("no scheduled shift that day → nothing to flag, not an error", () => {
    expect(findNoShows("Marie", ["2026-08-10"], [], [])).toHaveLength(0);
  });

  it("different employee's schedule never counts against this one", () => {
    const sched = [scheduled("Anthony", "2026-08-10", "09:00", "17:00", 8)];
    expect(findNoShows("Marie", ["2026-08-10"], sched, [])).toHaveLength(0);
  });

  it("a FUTURE scheduled date with no entry yet still comes back as a no-show — caller's job to filter dates, not this function's", () => {
    const sched = [scheduled("Marie", "2099-01-01", "09:00", "17:00", 8)];
    expect(findNoShows("Marie", ["2099-01-01"], sched, [])).toHaveLength(1);
  });

  it("scans multiple dates in one call, aggregating across all of them", () => {
    const sched = [
      scheduled("Marie", "2026-08-10", "09:00", "17:00", 8, "a"),
      scheduled("Marie", "2026-08-11", "09:00", "17:00", 8, "b"),
      scheduled("Marie", "2026-08-12", "09:00", "17:00", 8, "c"),
    ];
    const entries = [worked("Marie", "2026-08-11", [shift("09:00", "17:00", 8)])];
    const result = findNoShows("Marie", ["2026-08-10", "2026-08-11", "2026-08-12"], sched, entries);
    expect(result.map(r => r.date).sort()).toEqual(["2026-08-10", "2026-08-12"]);
  });

  it("does not mutate its inputs", () => {
    const sched = Object.freeze([Object.freeze(scheduled("Marie", "2026-08-10", "09:00", "17:00", 8))]);
    const entries = Object.freeze([]);
    expect(() => findNoShows("Marie", ["2026-08-10"], sched, entries)).not.toThrow();
  });
});

describe("findForgottenClockOuts", () => {
  const clockedInAt = (hoursAgo: number): ActiveClockIn => ({
    name: "Marie",
    clockInAt: new Date(Date.now() - hoursAgo * 3600000).toISOString(),
    flagged: false,
  });

  it("clocked in well past the default threshold → forgotten", () => {
    const result = findForgottenClockOuts("Marie", [clockedInAt(14)]);
    expect(result).toHaveLength(1);
    expect(result[0].hoursElapsed).toBeGreaterThanOrEqual(DEFAULT_FORGOTTEN_CLOCKOUT_HOURS);
  });

  it("clocked in recently (normal mid-shift) → not flagged", () => {
    expect(findForgottenClockOuts("Marie", [clockedInAt(4)])).toHaveLength(0);
  });

  it("boundary is inclusive: exactly at the threshold counts", () => {
    const now = new Date("2026-08-10T20:00:00.000Z");
    const clockIn: ActiveClockIn = { name: "Marie", clockInAt: "2026-08-10T08:00:00.000Z", flagged: false };
    // exactly 12h elapsed
    expect(findForgottenClockOuts("Marie", [clockIn], 12, now)).toHaveLength(1);
  });

  it("a custom threshold is honoured", () => {
    expect(findForgottenClockOuts("Marie", [clockedInAt(5)], 4)).toHaveLength(1);
    expect(findForgottenClockOuts("Marie", [clockedInAt(3)], 4)).toHaveLength(0);
  });

  it("no active clock-in at all → nothing flagged", () => {
    expect(findForgottenClockOuts("Marie", [])).toHaveLength(0);
  });

  it("a different employee's open clock-in never counts against this one", () => {
    const other: ActiveClockIn = { name: "Anthony", clockInAt: new Date(Date.now() - 20 * 3600000).toISOString(), flagged: false };
    expect(findForgottenClockOuts("Marie", [other])).toHaveLength(0);
  });

  it("deterministic `now` injection makes this testable without real elapsed time", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const clockIn: ActiveClockIn = { name: "Marie", clockInAt: "2026-08-10T00:00:00.000Z", flagged: false };
    const result = findForgottenClockOuts("Marie", [clockIn], DEFAULT_FORGOTTEN_CLOCKOUT_HOURS, now);
    expect(result[0].hoursElapsed).toBe(12);
  });
});

describe("computeOperationsRollup — mixed real-world scenario", () => {
  it("combines hours, overtime, no-shows, forgotten clock-outs, corrections, and pending variance per employee", () => {
    const dates = ["2026-08-10", "2026-08-11"];
    const staff = [member("Marie", 35), member("Anthony", 35)];

    const sched: ScheduledShift[] = [
      scheduled("Marie", "2026-08-10", "09:00", "17:00", 8, "m1"),
      scheduled("Marie", "2026-08-11", "09:00", "17:00", 8, "m2"), // Marie no-shows this one
      scheduled("Anthony", "2026-08-10", "09:00", "17:00", 8, "a1"),
    ];

    const entries: HourEntry[] = [
      // Marie worked day 1, exactly on schedule (no variance).
      worked("Marie", "2026-08-10", [shift("09:00", "17:00", 8)]),
      // Anthony worked day 1 with a manager-corrected entry, a real deviation
      // (pending variance), AND flagged (no fresh QR scan at submission).
      worked("Anthony", "2026-08-10", [shift("09:00", "17:45", 8.75)], "approved", {
        editedBy: "manager@lavague.fr", editedAt: new Date().toISOString(), previousHours: 8, flagged: true,
      }),
    ];

    const activeClockIns: ActiveClockIn[] = [
      { name: "Anthony", clockInAt: new Date(Date.now() - 15 * 3600000).toISOString(), flagged: false },
    ];

    const approvals: VarianceApproval[] = [];

    const rollup = computeOperationsRollup(dates, entries, sched, activeClockIns, approvals, staff, { overtime_limit: 35 });

    const marie = rollup.employees.find(e => e.name === "Marie")!;
    const anthony = rollup.employees.find(e => e.name === "Anthony")!;

    expect(marie.effectiveHours).toBeCloseTo(8, 5);
    expect(marie.noShowCount).toBe(1);
    expect(marie.noShows[0].date).toBe("2026-08-11");
    expect(marie.forgottenClockOutCount).toBe(0);
    expect(marie.correctionsCount).toBe(0);
    expect(marie.flaggedEntryCount).toBe(0);
    // rate 15 (member() default) × 8 effective hours.
    expect(marie.estimatedGrossCost).toBeCloseTo(120, 5);

    expect(anthony.noShowCount).toBe(0);
    expect(anthony.forgottenClockOutCount).toBe(1);
    expect(anthony.correctionsCount).toBe(1);
    expect(anthony.flaggedEntryCount).toBe(1);
    expect(anthony.pendingVarianceCount).toBe(1); // +45min, no approval on record

    expect(rollup.totals.employeeCount).toBe(2);
    expect(rollup.totals.totalNoShows).toBe(1);
    expect(rollup.totals.totalForgottenClockOuts).toBe(1);
    expect(rollup.totals.totalCorrections).toBe(1);
    expect(rollup.totals.totalPendingVariance).toBe(1);
    expect(rollup.totals.totalFlaggedEntries).toBe(1);
    // 8h (Marie) + 8.75h (Anthony) at rate 15 = 251.25.
    expect(rollup.totals.totalEstimatedGrossCost).toBeCloseTo(251.25, 5);
  });

  it("flaggedEntryCount counts every flagged entry in range for that employee, regardless of hours plausibility", () => {
    // flagged is an anti-fraud/QR-freshness signal, independent of the
    // hours value itself — a flagged entry with perfectly ordinary hours
    // still counts, and this test also covers multiple flagged entries
    // for the same employee across different dates.
    const dates = ["2026-08-10", "2026-08-11", "2026-08-12"];
    const staff = [member("Reigo")];
    const entries: HourEntry[] = [
      worked("Reigo", "2026-08-10", [shift("09:00", "17:00", 8)], "approved", { flagged: true }),
      worked("Reigo", "2026-08-11", [shift("09:00", "17:00", 8)], "approved", { flagged: false }),
      worked("Reigo", "2026-08-12", [shift("17:16", "16:31", 95.26)], "approved", { flagged: true }),
    ];
    const rollup = computeOperationsRollup(dates, entries, [], [], [], staff, null);
    expect(rollup.employees[0].flaggedEntryCount).toBe(2);
    expect(rollup.totals.totalFlaggedEntries).toBe(2);
  });

  it("flaggedEntryCount is 0, not undefined, when nothing in range is flagged", () => {
    const staff = [member("Marie")];
    const entries = [worked("Marie", "2026-08-10", [shift("09:00", "17:00", 8)])];
    const rollup = computeOperationsRollup(["2026-08-10"], entries, [], [], [], staff, null);
    expect(rollup.employees[0].flaggedEntryCount).toBe(0);
    expect(rollup.totals.totalFlaggedEntries).toBe(0);
  });

  it("a fully clean employee (no issues at all) reports all zeros, not undefined/NaN", () => {
    const staff = [member("Marie")];
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    const entries = [worked("Marie", "2026-08-10", [shift("09:00", "17:00", 8)])];
    const rollup = computeOperationsRollup(["2026-08-10"], entries, sched, [], [], staff, null);
    const marie = rollup.employees[0];
    expect(marie.noShowCount).toBe(0);
    expect(marie.forgottenClockOutCount).toBe(0);
    expect(marie.correctionsCount).toBe(0);
    expect(marie.pendingVarianceCount).toBe(0);
    expect(marie.effectiveHours).toBeCloseTo(8, 5);
  });

  it("an employee with zero activity in range still appears with zeroed numbers, not omitted", () => {
    const staff = [member("Marie"), member("Ghost")];
    const rollup = computeOperationsRollup(["2026-08-10"], [], [], [], [], staff, null);
    expect(rollup.employees).toHaveLength(2);
    const ghost = rollup.employees.find(e => e.name === "Ghost")!;
    expect(ghost.effectiveHours).toBe(0);
    expect(ghost.noShowCount).toBe(0);
  });

  it("archived (inactive) staff are excluded by default, matching VarianceTab's own convention", () => {
    const staff = [member("Marie"), { ...member("OldStaff"), active: false }];
    const rollup = computeOperationsRollup(["2026-08-10"], [], [], [], [], staff, null);
    expect(rollup.employees.map(e => e.name)).toEqual(["Marie"]);
  });

  it("a custom staffFilter overrides the active-only default", () => {
    const staff = [member("Marie"), { ...member("OldStaff"), active: false }];
    const rollup = computeOperationsRollup(["2026-08-10"], [], [], [], [], staff, null, { staffFilter: () => true });
    expect(rollup.employees.map(e => e.name).sort()).toEqual(["Marie", "OldStaff"]);
  });

  it("forgotten clock-outs are not date-range filtered — they reflect current live state regardless of the requested range", () => {
    const staff = [member("Marie")];
    const activeClockIns: ActiveClockIn[] = [
      { name: "Marie", clockInAt: new Date(Date.now() - 20 * 3600000).toISOString(), flagged: false },
    ];
    // A date range nowhere near today.
    const rollup = computeOperationsRollup(["2020-01-01"], [], [], activeClockIns, [], staff, null);
    expect(rollup.employees[0].forgottenClockOutCount).toBe(1);
  });

  it("does not mutate any of its array/object inputs", () => {
    const staff = Object.freeze([Object.freeze(member("Marie"))]);
    const sched = Object.freeze([Object.freeze(scheduled("Marie", "2026-08-10", "09:00", "17:00", 8))]);
    const entries = Object.freeze([Object.freeze(worked("Marie", "2026-08-10", [shift("09:00", "17:00", 8)]))]);
    expect(() => computeOperationsRollup(["2026-08-10"], entries, sched, [], [], staff, null)).not.toThrow();
  });
});

describe("estimateGrossCost", () => {
  it("is a plain multiply, gross only", () => {
    expect(estimateGrossCost(10, 15)).toBe(150);
  });
  it("zero hours or zero rate → zero cost", () => {
    expect(estimateGrossCost(0, 15)).toBe(0);
    expect(estimateGrossCost(10, 0)).toBe(0);
  });
});
