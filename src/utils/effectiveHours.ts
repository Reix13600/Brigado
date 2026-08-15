import { HourEntry, ScheduledShift, Shift, StaffMember, GeneralConfig } from "../types";

// ─────────────────────────────────────────────────────────────────────
// PHASE A of the scheduling/payroll series. Shared, tolerance-aware
// hours calculation. Later phases (variance view, weekly counter,
// shift-template tray, overtime warning, no-show alerts, payroll-ready
// screen) all consume THIS module rather than reimplementing the maths.
//
// ⚠️ NOT WIRED INTO THE LIVE PAYROLL EXPORT. Deliberate — see CLAUDE.md.
// The existing export still sums raw HourEntry.hours. This module exists
// so Phase B's variance view can show effective-vs-actual side by side
// and be validated against real data BEFORE anything changes real pay
// numbers. Do not "finish the job" by wiring this into the export
// without that validation step.
//
// ⚠️ PURITY IS A HARD REQUIREMENT, NOT A STYLE PREFERENCE.
// Every function here is pure and computed at read/export time. Nothing
// here ever writes to Firestore and nothing here mutates its arguments.
// The raw clock record (HourEntry.shifts[].startTime/endTime, as written
// by clockOut()) is the legal record of what actually happened, and a
// later phase needs it intact to show true deviations. "Effective hours"
// is a DERIVED number for pay/reporting only.
// ─────────────────────────────────────────────────────────────────────

/** Manager-adjustable, per restaurant. 10 minutes is the default when
 * config.tolerance_minutes is unset — chosen to absorb ordinary
 * clock-pad queueing without swallowing genuine lateness. */
export const DEFAULT_TOLERANCE_MINUTES = 10;

/** Reads the configured tolerance, falling back to the default.
 * Guards against nonsense values (negative, NaN) that would otherwise
 * make every comparison behave unpredictably. A tolerance of exactly 0
 * IS meaningful (= no adjustment ever) and is preserved. */
export function resolveToleranceMinutes(config?: Partial<GeneralConfig> | null): number {
  const raw = config?.tolerance_minutes;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return DEFAULT_TOLERANCE_MINUTES;
  }
  return raw;
}

/** "HH:MM" → minutes since midnight. Returns null for anything
 * unparseable rather than silently yielding NaN, so callers must decide
 * what to do about bad data instead of it becoming a 0-hour shift. */
export function parseHHMM(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** minutes since midnight → "HH:MM", wrapping past 24h back into a
 * clock time (an overnight end of 1500 renders as "01:00"). */
export function formatHHMM(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Normalises an end time that falls before its start (overnight shift)
 * by pushing it into the next day. 22:00→06:00 becomes 1320→1800. */
function normaliseEnd(startMin: number, endMin: number): number {
  return endMin < startMin ? endMin + 1440 : endMin;
}

export type ToleranceEdge = "start" | "end";

/**
 * THE CORE RULE. Applies tolerance at one edge of a shift.
 *
 *   |actual − scheduled| <= tolerance
 *     → start: take the EARLIER of the two
 *     → end:   take the LATER of the two
 *   otherwise
 *     → take the ACTUAL, raw and unadjusted
 *
 * The within-tolerance branch is deliberately generous to the employee
 * at BOTH edges: a slightly-early arrival is paid from when they
 * actually started, and a slightly-early departure is still paid to the
 * scheduled end. Outside tolerance there is no adjustment in either
 * direction — a 15-minute-late arrival is paid from 15 minutes late,
 * and a 20-minute-early departure is docked those 20 minutes.
 *
 * Both arguments are minutes-since-midnight in the SAME frame of
 * reference (see normaliseEnd for overnight handling) — passing a raw
 * 06:00 end against a 22:00 start would otherwise compare 360 to 1320.
 */
export function applyTolerance(
  actualMin: number,
  scheduledMin: number,
  toleranceMinutes: number,
  edge: ToleranceEdge,
): number {
  const withinTolerance = Math.abs(actualMin - scheduledMin) <= toleranceMinutes;
  if (!withinTolerance) return actualMin;
  return edge === "start"
    ? Math.min(actualMin, scheduledMin)
    : Math.max(actualMin, scheduledMin);
}

/** One clock record paired with the scheduled shift it belongs to (if
 * any), plus the derived effective window. Raw values are carried
 * through untouched so callers never have to go back to the source. */
export interface EffectiveShift {
  /** Raw clocked start, exactly as stored. Never adjusted. */
  actualStart: string;
  /** Raw clocked end, exactly as stored. Never adjusted. */
  actualEnd: string;
  /** Raw clocked duration, exactly as stored on Shift.hours. */
  actualHours: number;
  /** Scheduled window this was matched to, or null when unscheduled. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Tolerance-adjusted window used for pay. Equals the actual window
   * when unscheduled, or when both edges fell outside tolerance. */
  effectiveStart: string;
  effectiveEnd: string;
  effectiveHours: number;
  /** True when no scheduled shift matched — effective == actual by
   * construction. Phase B surfaces these separately. */
  unscheduled: boolean;
}

/** Computes the effective window for ONE clock record against ONE
 * scheduled shift (or none). Pure; does not touch its arguments. */
export function computeEffectiveShift(
  shift: Pick<Shift, "startTime" | "endTime" | "hours">,
  scheduled: Pick<ScheduledShift, "startTime" | "endTime"> | null,
  toleranceMinutes: number,
): EffectiveShift {
  const actualStartMin = parseHHMM(shift.startTime);
  const actualEndRaw = parseHHMM(shift.endTime);

  // Unparseable clock data: fall back to the stored hours and report the
  // raw strings unchanged. Better than inventing a window from NaN.
  if (actualStartMin === null || actualEndRaw === null) {
    return {
      actualStart: shift.startTime,
      actualEnd: shift.endTime,
      actualHours: shift.hours,
      scheduledStart: scheduled?.startTime ?? null,
      scheduledEnd: scheduled?.endTime ?? null,
      effectiveStart: shift.startTime,
      effectiveEnd: shift.endTime,
      effectiveHours: shift.hours,
      unscheduled: scheduled === null,
    };
  }

  const actualEndMin = normaliseEnd(actualStartMin, actualEndRaw);

  // No schedule to compare against → no adjustment is even definable.
  // Effective == actual, which also means a restaurant that never uses
  // scheduling gets effective totals identical to its current payroll.
  if (!scheduled) {
    return {
      actualStart: shift.startTime,
      actualEnd: shift.endTime,
      actualHours: shift.hours,
      scheduledStart: null,
      scheduledEnd: null,
      effectiveStart: shift.startTime,
      effectiveEnd: shift.endTime,
      effectiveHours: (actualEndMin - actualStartMin) / 60,
      unscheduled: true,
    };
  }

  const schedStartMin = parseHHMM(scheduled.startTime);
  const schedEndRaw = parseHHMM(scheduled.endTime);
  if (schedStartMin === null || schedEndRaw === null) {
    // Scheduled shift itself is malformed — treat as unscheduled rather
    // than comparing against garbage.
    return {
      actualStart: shift.startTime,
      actualEnd: shift.endTime,
      actualHours: shift.hours,
      scheduledStart: scheduled.startTime,
      scheduledEnd: scheduled.endTime,
      effectiveStart: shift.startTime,
      effectiveEnd: shift.endTime,
      effectiveHours: (actualEndMin - actualStartMin) / 60,
      unscheduled: true,
    };
  }
  const schedEndMin = normaliseEnd(schedStartMin, schedEndRaw);

  const effStartMin = applyTolerance(actualStartMin, schedStartMin, toleranceMinutes, "start");
  const effEndMin = applyTolerance(actualEndMin, schedEndMin, toleranceMinutes, "end");

  // Clamp: a shift can never be negative length. This only bites on
  // corrupt data (end before start after adjustment), never on the
  // documented rule.
  const durationMin = Math.max(0, effEndMin - effStartMin);

  return {
    actualStart: shift.startTime,
    actualEnd: shift.endTime,
    actualHours: shift.hours,
    scheduledStart: scheduled.startTime,
    scheduledEnd: scheduled.endTime,
    effectiveStart: formatHHMM(effStartMin),
    effectiveEnd: formatHHMM(effEndMin),
    effectiveHours: durationMin / 60,
    unscheduled: false,
  };
}

/**
 * Pairs a day's clock records to that day's scheduled shifts.
 *
 * No stored link exists between the two — HourEntry has no
 * scheduledShiftId, and ScheduledShift.id (string) has no counterpart on
 * the entry (number id). Verified against the schema 2026-08-15. So the
 * pairing is derived: same person, same date, then greedily match each
 * clock record to the NEAREST unmatched scheduled shift by start time.
 *
 * Greedy-nearest handles split shifts correctly (09:00–14:00 +
 * 18:00–23:00 pair to the right halves regardless of clock order), and
 * each scheduled shift is consumed at most once so three clock records
 * against two scheduled shifts leaves exactly one unscheduled.
 */
export function pairShiftsToSchedule(
  shifts: readonly Pick<Shift, "startTime" | "endTime" | "hours">[],
  scheduled: readonly Pick<ScheduledShift, "startTime" | "endTime">[],
): { shift: Pick<Shift, "startTime" | "endTime" | "hours">; scheduled: Pick<ScheduledShift, "startTime" | "endTime"> | null }[] {
  const remaining = scheduled.map((s, i) => ({ s, i, startMin: parseHHMM(s.startTime) }));
  const used = new Set<number>();

  return shifts.map(shift => {
    const actualStart = parseHHMM(shift.startTime);
    if (actualStart === null) return { shift, scheduled: null };

    let best: { s: Pick<ScheduledShift, "startTime" | "endTime">; i: number } | null = null;
    let bestDistance = Infinity;

    for (const cand of remaining) {
      if (used.has(cand.i) || cand.startMin === null) continue;
      // Compare across the midnight boundary too: a 23:50 clock-in
      // against a 00:05 scheduled start is 15 minutes apart, not 1425.
      const direct = Math.abs(actualStart - cand.startMin);
      const wrapped = 1440 - direct;
      const distance = Math.min(direct, wrapped);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { s: cand.s, i: cand.i };
      }
    }

    if (!best) return { shift, scheduled: null };
    used.add(best.i);
    return { shift, scheduled: best.s };
  });
}

/** One day's worth of effective hours for one person. */
export interface EffectiveDay {
  name: string;
  date: string;
  shifts: EffectiveShift[];
  /** Sum of effective hours across the day's shifts. */
  effectiveHours: number;
  /** Sum of the RAW stored hours — what the current payroll export
   * uses. Carried alongside so Phase B can show the delta without
   * recomputing anything. */
  actualHours: number;
}

/**
 * Computes one entry's effective hours against the schedule.
 *
 * Only `type === "worked"` entries produce hours — absence/sick/holiday
 * entries carry hours for other purposes and must not be tolerance-
 * adjusted against a shift they never clocked.
 *
 * DOES NOT MUTATE `entry` or `allScheduled`.
 */
export function computeEffectiveDay(
  entry: HourEntry,
  allScheduled: readonly ScheduledShift[],
  toleranceMinutes: number,
): EffectiveDay {
  const relevantSchedule =
    entry.type === "worked"
      ? allScheduled.filter(s => s.name === entry.name && s.date === entry.date)
      : [];

  const pairs =
    entry.type === "worked" ? pairShiftsToSchedule(entry.shifts ?? [], relevantSchedule) : [];

  const shifts = pairs.map(p => computeEffectiveShift(p.shift, p.scheduled, toleranceMinutes));

  return {
    name: entry.name,
    date: entry.date,
    shifts,
    effectiveHours: shifts.reduce((sum, s) => sum + s.effectiveHours, 0),
    // Mirrors what the live export sums today, so the two are directly
    // comparable. For non-worked entries this stays 0, matching the
    // export's `type === "worked"` filter.
    actualHours: entry.type === "worked" ? shifts.reduce((sum, s) => sum + s.actualHours, 0) : 0,
  };
}

/**
 * The employee's weekly hours threshold before overtime.
 *
 * ⚠️ MIRRORS ManagerDashboard's existing getContractHours() EXACTLY,
 * including its `||` semantics: a contract of 0 (or undefined/NaN)
 * falls through to config.overtime_limit, which itself defaults to 35.
 * This is the established source of truth — do NOT introduce a separate
 * 35h constant here. The `||` (rather than `??`) is intentional
 * duplication of current behaviour; "fixing" it to `??` would silently
 * change existing overtime numbers for anyone on a 0h contract.
 */
export function getContractHours(
  name: string,
  staff: readonly StaffMember[],
  config?: Partial<GeneralConfig> | null,
): number {
  const member = staff.find(s => s.name === name);
  const fallback =
    typeof config?.overtime_limit === "number" && Number.isFinite(config.overtime_limit)
      ? config.overtime_limit
      : 35;
  return member?.contract || fallback;
}

export interface WeeklyEffectiveHours {
  name: string;
  /** Effective (tolerance-adjusted) hours across the period. */
  effectiveHours: number;
  /** Raw stored hours across the same period — today's payroll number. */
  actualHours: number;
  /** effectiveHours − actualHours. Positive = tolerance credited time. */
  varianceHours: number;
  /** Threshold from getContractHours (contract, else config, else 35). */
  contractHours: number;
  /** Hours beyond the threshold, based on EFFECTIVE hours. */
  overtimeHours: number;
  /** Per-day breakdown, for drill-down in later phases. */
  days: EffectiveDay[];
}

/**
 * Per-employee aggregation over whatever set of entries it's handed.
 *
 * Deliberately does NOT do its own date-range/week bucketing: the caller
 * already has range logic (ManagerDashboard's getRangeData) and having
 * two competing definitions of "this week" is exactly the kind of drift
 * this module exists to prevent. Hand it one period's entries; it
 * aggregates them.
 *
 * Overtime is computed from EFFECTIVE hours against the same contract
 * threshold the live export uses, so the only difference between this
 * number and the current one is the tolerance adjustment itself.
 */
export function aggregateEffectiveHours(
  entries: readonly HourEntry[],
  allScheduled: readonly ScheduledShift[],
  staff: readonly StaffMember[],
  config?: Partial<GeneralConfig> | null,
  options?: { includeStatuses?: readonly HourEntry["status"][] },
): WeeklyEffectiveHours[] {
  const tolerance = resolveToleranceMinutes(config);
  // Default matches the live CSV export, which counts approved entries
  // only. Overridable so a variance view can preview pending ones.
  const allowed = options?.includeStatuses ?? (["approved"] as const);

  const byName = new Map<string, EffectiveDay[]>();
  for (const entry of entries) {
    if (entry.type !== "worked") continue;
    if (!allowed.includes(entry.status)) continue;
    const day = computeEffectiveDay(entry, allScheduled, tolerance);
    const list = byName.get(entry.name);
    if (list) list.push(day);
    else byName.set(entry.name, [day]);
  }

  return [...byName.entries()].map(([name, days]) => {
    const effectiveHours = days.reduce((sum, d) => sum + d.effectiveHours, 0);
    const actualHours = days.reduce((sum, d) => sum + d.actualHours, 0);
    const contractHours = getContractHours(name, staff, config);
    return {
      name,
      effectiveHours,
      actualHours,
      varianceHours: effectiveHours - actualHours,
      contractHours,
      overtimeHours: Math.max(0, effectiveHours - contractHours),
      days,
    };
  });
}
