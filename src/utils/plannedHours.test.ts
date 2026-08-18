import { describe, it, expect } from "vitest";
import {
  shiftDurationHours,
  sumPlannedHours,
  computePlannedWeekTotal,
  projectDraftShift,
  WEEKLY_LEGAL_MAX_HOURS,
} from "./plannedHours";
import { ScheduledShift, StaffMember, GeneralConfig } from "../types";

// Unit tests for Phase C's planned-hours counter. Pure-Node, same vitest
// setup as effectiveHours.test.ts / variance.test.ts.

const WEEK = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"];

const sched = (name: string, date: string, startTime: string, endTime: string, id = `${name}-${date}-${startTime}`): ScheduledShift => ({
  id, name, date, startTime, endTime,
  // Deliberately WRONG on purpose in some tests — the module recomputes
  // from start/end and must not trust this field.
  hours: 999,
  role: "server",
});

const staff = (over: Partial<StaffMember> & { name: string }): StaffMember => ({
  role: "server", rate: 12, contract: 35, pin: "1111", ...over,
});

const CONFIG: Partial<GeneralConfig> = { overtime_limit: 35 };

describe("shiftDurationHours", () => {
  it("computes a plain daytime shift", () => {
    expect(shiftDurationHours({ startTime: "09:00", endTime: "17:00" })).toBe(8);
  });
  it("handles a half-hour boundary", () => {
    expect(shiftDurationHours({ startTime: "09:00", endTime: "15:30" })).toBe(6.5);
  });
  it("handles an overnight shift (end <= start ⇒ crosses midnight)", () => {
    expect(shiftDurationHours({ startTime: "22:00", endTime: "06:00" })).toBe(8);
  });
  it("ignores the stored `hours` field entirely — recomputed from start/end", () => {
    // sched() writes hours: 999; the total must be 8, not 999.
    expect(sumPlannedHours("Marie", ["2026-08-17"], [sched("Marie", "2026-08-17", "09:00", "17:00")])).toBe(8);
  });
});

describe("sumPlannedHours", () => {
  it("sums only that person's shifts, only within the given dates", () => {
    const shifts = [
      sched("Marie", "2026-08-17", "09:00", "17:00"), // 8h  — counts
      sched("Marie", "2026-08-18", "09:00", "14:00"), // 5h  — counts
      sched("Thomas", "2026-08-17", "09:00", "17:00"), // different person
      sched("Marie", "2026-08-24", "09:00", "17:00"), // outside the week
    ];
    expect(sumPlannedHours("Marie", WEEK, shifts)).toBe(13);
  });

  it("counts split shifts on the same day separately", () => {
    const shifts = [
      sched("Marie", "2026-08-17", "09:00", "14:00", "a"), // 5h
      sched("Marie", "2026-08-17", "18:00", "23:00", "b"), // 5h
    ];
    expect(sumPlannedHours("Marie", WEEK, shifts)).toBe(10);
  });

  it("does NOT count unassigned/open shifts (name === '') toward a named person", () => {
    const shifts = [sched("", "2026-08-17", "09:00", "17:00")];
    expect(sumPlannedHours("Marie", WEEK, shifts)).toBe(0);
  });
});

describe("computePlannedWeekTotal — threshold levels", () => {
  const roster = [staff({ name: "Marie", contract: 35 })];

  it("UNDER threshold → level 'under', no overBy", () => {
    const shifts = [sched("Marie", "2026-08-17", "09:00", "17:00")]; // 8h of 35
    const t = computePlannedWeekTotal("Marie", WEEK, shifts, roster, CONFIG);
    expect(t.plannedHours).toBe(8);
    expect(t.thresholdHours).toBe(35);
    expect(t.level).toBe("under");
    expect(t.overBy).toBe(0);
  });

  it("EXACTLY AT threshold (35/35) → flags at_or_over_contract, but overBy is 0", () => {
    // 5 x 7h = 35h exactly
    const shifts = WEEK.slice(0, 5).map((d, i) => sched("Marie", d, "09:00", "16:00", `s${i}`));
    const t = computePlannedWeekTotal("Marie", WEEK, shifts, roster, CONFIG);
    expect(t.plannedHours).toBe(35);
    expect(t.level).toBe("at_or_over_contract");
    expect(t.overBy).toBe(0);
  });

  it("OVER threshold → at_or_over_contract with a real overBy", () => {
    const shifts = WEEK.slice(0, 5).map((d, i) => sched("Marie", d, "09:00", "17:00", `s${i}`)); // 40h
    const t = computePlannedWeekTotal("Marie", WEEK, shifts, roster, CONFIG);
    expect(t.plannedHours).toBe(40);
    expect(t.level).toBe("at_or_over_contract");
    expect(t.overBy).toBe(5);
  });

  it("OVER the 48h legal max → escalates to over_legal_max, outranking the contract level", () => {
    const shifts = WEEK.map((d, i) => sched("Marie", d, "09:00", "17:00", `s${i}`)); // 7 x 8 = 56h
    const t = computePlannedWeekTotal("Marie", WEEK, shifts, roster, CONFIG);
    expect(t.plannedHours).toBe(56);
    expect(t.plannedHours).toBeGreaterThan(WEEKLY_LEGAL_MAX_HOURS);
    expect(t.level).toBe("over_legal_max");
  });
});

describe("computePlannedWeekTotal — contract: 0 preserves Phase A's deliberate || fallback", () => {
  it("a 0-contract employee falls through to config.overtime_limit (35), NOT a literal 0 threshold", () => {
    const roster = [staff({ name: "Extra", contract: 0 })];
    const shifts = [sched("Extra", "2026-08-17", "09:00", "17:00")]; // 8h
    const t = computePlannedWeekTotal("Extra", WEEK, shifts, roster, CONFIG);
    expect(t.thresholdHours).toBe(35);
    // The bug this prevents: with a literal 0 threshold, 8h would read as
    // overtime. It must read as comfortably under.
    expect(t.level).toBe("under");
  });

  it("with contract 0 AND no configured overtime_limit, falls all the way through to 35", () => {
    const roster = [staff({ name: "Extra", contract: 0 })];
    const t = computePlannedWeekTotal("Extra", WEEK, [], roster, null);
    expect(t.thresholdHours).toBe(35);
  });

  it("a 0-contract employee still crosses into overtime at the fallback threshold, not before", () => {
    const roster = [staff({ name: "Extra", contract: 0 })];
    const shifts = WEEK.slice(0, 5).map((d, i) => sched("Extra", d, "09:00", "17:00", `s${i}`)); // 40h
    const t = computePlannedWeekTotal("Extra", WEEK, shifts, roster, CONFIG);
    expect(t.level).toBe("at_or_over_contract");
    expect(t.overBy).toBe(5);
  });

  it("a non-zero contract still wins over config.overtime_limit", () => {
    const roster = [staff({ name: "PartTime", contract: 20 })];
    const shifts = WEEK.slice(0, 3).map((d, i) => sched("PartTime", d, "09:00", "17:00", `s${i}`)); // 24h
    const t = computePlannedWeekTotal("PartTime", WEEK, shifts, roster, CONFIG);
    expect(t.thresholdHours).toBe(20);
    expect(t.level).toBe("at_or_over_contract");
    expect(t.overBy).toBe(4);
  });
});

describe("computePlannedWeekTotal — employee with no shifts that week", () => {
  it("reports 0 planned hours against a real threshold, and is NOT flagged", () => {
    const roster = [staff({ name: "Marie", contract: 35 })];
    const t = computePlannedWeekTotal("Marie", WEEK, [], roster, CONFIG);
    expect(t.plannedHours).toBe(0);
    expect(t.thresholdHours).toBe(35);
    expect(t.level).toBe("under");
    expect(t.overBy).toBe(0);
  });

  it("0 hours against a 0 threshold is still 'under', not a spurious at-threshold flag", () => {
    // Guards the `plannedHours > 0` clause: without it, 0 >= 0 would flag.
    // Note: getContractHours' fallback only kicks in when overtime_limit is
    // NOT a finite number — an explicit 0 is itself a valid configured
    // limit, so thresholdHours is genuinely 0 here (0 || 0 === 0).
    const roster = [staff({ name: "Ghost", contract: 0 })];
    const t = computePlannedWeekTotal("Ghost", WEEK, [], roster, { overtime_limit: 0 });
    expect(t.thresholdHours).toBe(0);
    expect(t.level).toBe("under");
  });

  it("an employee not on the roster at all still resolves a usable threshold", () => {
    const t = computePlannedWeekTotal("Stranger", WEEK, [], [], CONFIG);
    expect(t.plannedHours).toBe(0);
    expect(t.thresholdHours).toBe(35);
    expect(t.level).toBe("under");
  });
});

describe("projectDraftShift — the live 'before saving' overlay", () => {
  const saved = [sched("Marie", "2026-08-17", "09:00", "17:00", "existing-1")]; // 8h

  it("returns the input list unchanged (same reference) when there is no draft", () => {
    expect(projectDraftShift(saved, null)).toBe(saved);
  });

  it("a NEW draft adds its hours to that person's projected total", () => {
    const projected = projectDraftShift(saved, {
      id: null, name: "Marie", date: "2026-08-18", startTime: "09:00", endTime: "14:00", // +5h
    });
    expect(sumPlannedHours("Marie", WEEK, projected as ScheduledShift[])).toBe(13);
  });

  it("an EDIT draft replaces the original rather than double-counting it", () => {
    const projected = projectDraftShift(saved, {
      id: "existing-1", name: "Marie", date: "2026-08-17", startTime: "09:00", endTime: "12:00", // 8h -> 3h
    });
    expect(sumPlannedHours("Marie", WEEK, projected as ScheduledShift[])).toBe(3);
  });

  it("reassigning an existing shift moves the hours off the old person and onto the new one in one pass", () => {
    const projected = projectDraftShift(saved, {
      id: "existing-1", name: "Thomas", date: "2026-08-17", startTime: "09:00", endTime: "17:00",
    });
    expect(sumPlannedHours("Marie", WEEK, projected as ScheduledShift[])).toBe(0);
    expect(sumPlannedHours("Thomas", WEEK, projected as ScheduledShift[])).toBe(8);
  });

  it("an incomplete draft (no assignee yet) contributes nothing to anyone", () => {
    const projected = projectDraftShift(saved, {
      id: null, name: "", date: "2026-08-18", startTime: "09:00", endTime: "14:00",
    });
    expect(sumPlannedHours("Marie", WEEK, projected as ScheduledShift[])).toBe(8);
  });

  it("clearing the assignee while EDITING removes the original's hours (the shift is becoming unassigned)", () => {
    const projected = projectDraftShift(saved, {
      id: "existing-1", name: "", date: "2026-08-17", startTime: "09:00", endTime: "17:00",
    });
    expect(sumPlannedHours("Marie", WEEK, projected as ScheduledShift[])).toBe(0);
  });

  it("an overnight draft is measured across midnight, not as negative", () => {
    const projected = projectDraftShift([], {
      id: null, name: "Marie", date: "2026-08-17", startTime: "22:00", endTime: "06:00",
    });
    expect(sumPlannedHours("Marie", WEEK, projected as ScheduledShift[])).toBe(8);
  });

  it("a draft pushes the level over the threshold live — the whole point of the preview", () => {
    const roster = [staff({ name: "Marie", contract: 35 })];
    const nearlyFull = WEEK.slice(0, 4).map((d, i) => sched("Marie", d, "09:00", "17:00", `s${i}`)); // 32h
    expect(computePlannedWeekTotal("Marie", WEEK, nearlyFull, roster, CONFIG).level).toBe("under");

    const projected = projectDraftShift(nearlyFull, {
      id: null, name: "Marie", date: "2026-08-21", startTime: "09:00", endTime: "17:00", // +8h = 40h
    });
    const t = computePlannedWeekTotal("Marie", WEEK, projected as ScheduledShift[], roster, CONFIG);
    expect(t.plannedHours).toBe(40);
    expect(t.level).toBe("at_or_over_contract");
    expect(t.overBy).toBe(5);
  });
});

describe("purity — inputs are never mutated", () => {
  it("projectDraftShift does not mutate the saved list", () => {
    const saved = Object.freeze([Object.freeze(sched("Marie", "2026-08-17", "09:00", "17:00", "x"))]);
    expect(() => projectDraftShift(saved, {
      id: null, name: "Marie", date: "2026-08-18", startTime: "09:00", endTime: "14:00",
    })).not.toThrow();
    expect(saved).toHaveLength(1);
  });

  it("computePlannedWeekTotal is pure — repeat calls are identical", () => {
    const roster = [staff({ name: "Marie", contract: 35 })];
    const shifts = [sched("Marie", "2026-08-17", "09:00", "17:00")];
    expect(computePlannedWeekTotal("Marie", WEEK, shifts, roster, CONFIG))
      .toEqual(computePlannedWeekTotal("Marie", WEEK, shifts, roster, CONFIG));
  });
});
