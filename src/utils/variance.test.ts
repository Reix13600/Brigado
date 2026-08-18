import { describe, it, expect } from "vitest";
import {
  computeDayVariance,
  aggregateMonthlyVariance,
  varianceApprovalId,
} from "./variance";
import { HourEntry, ScheduledShift, VarianceApproval, Shift } from "../types";

// Unit tests for Phase B's variance calculation. Pure-Node, same vitest
// setup as effectiveHours.test.ts (npm test / npm run test:watch).

const minToHours = (m: number) => m / 60;

const shift = (startTime: string, endTime: string, hours: number, overnight = false): Shift => ({
  startTime, endTime, hours, overnight,
});

const worked = (name: string, date: string, shifts: Shift[], status: HourEntry["status"] = "approved"): HourEntry => ({
  id: Math.floor(Math.random() * 1e9),
  name,
  date,
  type: "worked",
  hours: shifts.reduce((s, sh) => s + sh.hours, 0),
  shifts,
  startTime: shifts[0]?.startTime ?? null,
  endTime: shifts[shifts.length - 1]?.endTime ?? null,
  note: "",
  submittedAt: new Date().toISOString(),
  status,
});

const scheduled = (name: string, date: string, startTime: string, endTime: string, hours: number, id = `${date}-${startTime}`): ScheduledShift => ({
  id, name, date, startTime, endTime, hours, role: "server",
});

describe("computeDayVariance — matched pair, 1-minute floor", () => {
  it("actual 8h01 vs scheduled 8h00 (1 min over, at the floor) → included, +1 min", () => {
    const entry = worked("Marie", "2026-08-10", [shift("09:00", "17:01", minToHours(481))]);
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    const day = computeDayVariance(entry, sched);
    expect(day).not.toBeNull();
    expect(day!.components).toHaveLength(1);
    expect(day!.components[0].unscheduled).toBe(false);
    expect(day!.components[0].deltaMinutes).toBeCloseTo(1, 5);
    expect(day!.deltaMinutes).toBeCloseTo(1, 5);
  });

  it("actual 8h00m54s vs scheduled 8h00 (0.9 min, below the floor) → excluded as noise", () => {
    const entry = worked("Marie", "2026-08-10", [shift("09:00", "17:00", minToHours(480.9))]);
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    expect(computeDayVariance(entry, sched)).toBeNull();
  });

  it("actual exactly equals scheduled (0 min) → excluded", () => {
    const entry = worked("Marie", "2026-08-10", [shift("09:00", "17:00", 8)]);
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    expect(computeDayVariance(entry, sched)).toBeNull();
  });

  it("actual UNDER scheduled → negative delta, still included past the floor", () => {
    const entry = worked("Marie", "2026-08-10", [shift("09:00", "16:30", 7.5)]);
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    const day = computeDayVariance(entry, sched);
    expect(day!.deltaMinutes).toBeCloseTo(-30, 5);
  });
});

describe("computeDayVariance — unscheduled (extra) shifts", () => {
  it("clock record with no matching schedule → full raw duration as the delta, labeled unscheduled", () => {
    const entry = worked("Marie", "2026-08-10", [shift("18:00", "22:00", 4)]);
    const day = computeDayVariance(entry, []); // no scheduled shifts at all that day
    expect(day).not.toBeNull();
    expect(day!.hasUnscheduled).toBe(true);
    expect(day!.components[0].unscheduled).toBe(true);
    expect(day!.components[0].scheduledMinutes).toBe(0);
    expect(day!.deltaMinutes).toBeCloseTo(240, 5);
  });

  it("no floor is applied to unscheduled shifts — even a tiny one counts in full", () => {
    const entry = worked("Marie", "2026-08-10", [shift("18:00", "18:00", minToHours(0.5))]);
    const day = computeDayVariance(entry, []);
    expect(day).not.toBeNull();
    expect(day!.components[0].deltaMinutes).toBeCloseTo(0.5, 5);
  });

  it("split shift: one matched, one unscheduled → both components present, day total sums them", () => {
    const entry = worked("Marie", "2026-08-10", [
      shift("09:00", "14:01", minToHours(301)), // matches 09:00-14:00 (300 min), +1 min
      shift("18:00", "22:00", 4), // no matching schedule
    ]);
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "14:00", 5)];
    const day = computeDayVariance(entry, sched);
    expect(day!.components).toHaveLength(2);
    expect(day!.hasUnscheduled).toBe(true);
    expect(day!.deltaMinutes).toBeCloseTo(1 + 240, 3);
  });
});

describe("computeDayVariance — non-worked / empty entries never produce variance", () => {
  it("absent entry → null", () => {
    const entry: HourEntry = {
      id: 1, name: "Marie", date: "2026-08-10", type: "absent", hours: 0, shifts: [],
      startTime: null, endTime: null, note: "", submittedAt: new Date().toISOString(), status: "approved",
    };
    expect(computeDayVariance(entry, [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)])).toBeNull();
  });

  it("worked entry with zero shifts → null", () => {
    const entry = worked("Marie", "2026-08-10", []);
    expect(computeDayVariance(entry, [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)])).toBeNull();
  });
});

describe("aggregateMonthlyVariance — no-show exclusion", () => {
  it("a scheduled shift with zero clock records that day never appears — no HourEntry means computeDayVariance is never even called for it", () => {
    const sched = [scheduled("Marie", "2026-08-05", "09:00", "17:00", 8)];
    // No entries at all for Marie this month.
    const summary = aggregateMonthlyVariance("Marie", [], sched, []);
    expect(summary.days).toHaveLength(0);
    expect(summary.scheduledHours).toBe(0);
    expect(summary.clockedHours).toBe(0);
  });

  it("mixed month: one real no-show day (scheduled, no entry) alongside one worked day with real variance — only the worked day appears", () => {
    const sched = [
      scheduled("Marie", "2026-08-05", "09:00", "17:00", 8), // no-show — excluded
      scheduled("Marie", "2026-08-06", "09:00", "17:00", 8),
    ];
    const entries = [
      worked("Marie", "2026-08-06", [shift("09:00", "17:35", minToHours(515))]), // +35 min
    ];
    const summary = aggregateMonthlyVariance("Marie", entries, sched, []);
    expect(summary.days).toHaveLength(1);
    expect(summary.days[0].date).toBe("2026-08-06");
    expect(summary.days[0].deltaMinutes).toBeCloseTo(35, 5);
  });
});

describe("aggregateMonthlyVariance — approved vs pending split, and the summary-card identity", () => {
  it("splits days into approved/pending based on VarianceApproval records, and Scheduled + Difference == Clocked, Approved + Pending == Difference", () => {
    const sched = [
      scheduled("Marie", "2026-08-04", "09:00", "17:00", 8),
      scheduled("Marie", "2026-08-05", "09:00", "17:00", 8),
    ];
    const entries = [
      worked("Marie", "2026-08-04", [shift("09:00", "17:35", minToHours(515))]), // +35 min, approved day
      worked("Marie", "2026-08-05", [shift("09:00", "17:55", minToHours(535))]), // +55 min, pending day
    ];
    const approvals: VarianceApproval[] = [
      { name: "Marie", date: "2026-08-04", approvedBy: "manager@lavague.fr", approvedAt: new Date().toISOString() },
    ];
    const summary = aggregateMonthlyVariance("Marie", entries, sched, approvals);

    expect(summary.days).toHaveLength(2);
    const approvedDay = summary.days.find(d => d.date === "2026-08-04")!;
    const pendingDay = summary.days.find(d => d.date === "2026-08-05")!;
    expect(approvedDay.status).toBe("approved");
    expect(pendingDay.status).toBe("pending");

    expect(summary.scheduledHours).toBeCloseTo(16, 5);
    expect(summary.clockedHours).toBeCloseTo((515 + 535) / 60, 5);
    expect(summary.differenceHours).toBeCloseTo(summary.clockedHours - summary.scheduledHours, 10);
    expect(summary.approvedHours).toBeCloseTo(35 / 60, 5);
    expect(summary.pendingHours).toBeCloseTo(55 / 60, 5);
    expect(summary.approvedHours + summary.pendingHours).toBeCloseTo(summary.differenceHours, 10);
  });

  it("a day with a stale approval record (name/date no longer present) simply doesn't match anything — approvals are matched by (name, date) only", () => {
    const sched = [scheduled("Marie", "2026-08-04", "09:00", "17:00", 8)];
    const entries = [worked("Marie", "2026-08-04", [shift("09:00", "17:35", minToHours(515))])];
    const approvals: VarianceApproval[] = [
      { name: "Someone Else", date: "2026-08-04", approvedBy: "x", approvedAt: "x" },
      { name: "Marie", date: "2099-01-01", approvedBy: "x", approvedAt: "x" },
    ];
    const summary = aggregateMonthlyVariance("Marie", entries, sched, approvals);
    expect(summary.days[0].status).toBe("pending");
  });
});

describe("aggregateMonthlyVariance — only approved entries participate", () => {
  it("a pending (not-yet-approved) HourEntry contributes no variance", () => {
    const sched = [scheduled("Marie", "2026-08-04", "09:00", "17:00", 8)];
    const entries = [worked("Marie", "2026-08-04", [shift("09:00", "17:35", minToHours(515))], "pending")];
    const summary = aggregateMonthlyVariance("Marie", entries, sched, []);
    expect(summary.days).toHaveLength(0);
  });
});

describe("varianceApprovalId — deterministic, URI-safe doc id", () => {
  it("combines date and name with a separator, URI-encoding the name", () => {
    expect(varianceApprovalId("2026-08-10", "Marie")).toBe("2026-08-10__Marie");
    expect(varianceApprovalId("2026-08-10", "Jean-François")).toBe("2026-08-10__Jean-Fran%C3%A7ois");
  });

  it("is stable across repeated calls (pure)", () => {
    expect(varianceApprovalId("2026-08-10", "Marie")).toBe(varianceApprovalId("2026-08-10", "Marie"));
  });
});

describe("purity — inputs are never mutated", () => {
  it("computeDayVariance does not mutate the entry or the scheduled array", () => {
    const entry = Object.freeze(worked("Marie", "2026-08-10", [Object.freeze(shift("09:00", "17:35", minToHours(515)))]));
    const sched = Object.freeze([Object.freeze(scheduled("Marie", "2026-08-10", "09:00", "17:00", 8))]);
    expect(() => computeDayVariance(entry, sched)).not.toThrow();
  });

  it("repeat calls with the same input produce identical output", () => {
    const entry = worked("Marie", "2026-08-10", [shift("09:00", "17:35", minToHours(515))]);
    const sched = [scheduled("Marie", "2026-08-10", "09:00", "17:00", 8)];
    const a = computeDayVariance(entry, sched);
    const b = computeDayVariance(entry, sched);
    expect(a).toEqual(b);
  });
});
