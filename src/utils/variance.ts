import { HourEntry, ScheduledShift, VarianceApproval } from "../types";
import { pairShiftsToSchedule } from "./effectiveHours";

// ─────────────────────────────────────────────────────────────────────
// PHASE B of the scheduling/payroll series. Scheduled-vs-actual variance,
// with a manager approval workflow on top.
//
// Reuses pairShiftsToSchedule from effectiveHours.ts for the raw
// shift-to-schedule matching — that function already separates "which
// clock record matched which scheduled shift" from tolerance rounding,
// so nothing here duplicates matching logic. Everything below works with
// RAW actual minutes (Shift.hours as clocked), never the tolerance-
// adjusted effective hours from Phase A — variance is about the real
// deviation from what was scheduled, not what tolerance would forgive.
//
// ⚠️ PURE, LIKE effectiveHours.ts. Nothing here writes to Firestore or
// mutates its arguments. Only the human APPROVAL DECISION (see api.ts's
// varianceApprovals functions) is ever persisted — every number in this
// file is recomputed live from entries + scheduledShifts on every call.
// ─────────────────────────────────────────────────────────────────────

/** Deterministic doc id for a (date, name) approval record — lets
 * approve/invalidate target the doc directly without a query. */
export function varianceApprovalId(date: string, name: string): string {
  return `${date}__${encodeURIComponent(name)}`;
}

/** One clock record's variance against the schedule it matched (or its
 * full duration, when it matched nothing). Raw minutes throughout — no
 * tolerance adjustment. */
export interface VarianceComponent {
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string;
  actualEnd: string;
  /** 0 when unscheduled. */
  scheduledMinutes: number;
  actualMinutes: number;
  /** actualMinutes - scheduledMinutes; equals actualMinutes when unscheduled. */
  deltaMinutes: number;
  /** True when no scheduled shift matched this clock record. */
  unscheduled: boolean;
}

/** One employee's one day of variance. Only exists when there is at
 * least one component worth showing — a day with a scheduled shift and
 * zero clock records (a true no-show) never produces a DayVariance at
 * all, because there is no HourEntry to compute one from. That's what
 * keeps no-shows out of scope here by construction, not by an extra
 * exclusion check. */
export interface DayVariance {
  name: string;
  date: string;
  components: VarianceComponent[];
  /** Sum of this day's components' deltaMinutes. */
  deltaMinutes: number;
  hasUnscheduled: boolean;
}

/**
 * Computes one HourEntry's variance against that day's schedule.
 *
 * Only `type === "worked"` entries produce variance — absence/sick/
 * holiday entries were never clocked against a schedule.
 *
 * A component is only included when |actualMinutes - scheduledMinutes|
 * >= 1 minute — floating-point/rounding noise only. This is an
 * inclusion filter, not a display filter: it also governs the monthly
 * totals in aggregateMonthlyVariance, so scheduled/clocked/difference
 * always reconcile exactly with approved+pending (see that function).
 * A genuine sub-minute deviation is, definitionally, not one — do not
 * lower this to catch smaller real deviations.
 *
 * An unscheduled clock record's entire raw duration is always the delta
 * — there is nothing to net it against, and no floor is applied (a real
 * clock record is never "noise").
 *
 * Returns null when there's nothing to show: a non-worked entry, no
 * shifts, or every matched pair fell within the 1-minute floor.
 *
 * DOES NOT MUTATE `entry` or `allScheduled`.
 */
export function computeDayVariance(
  entry: HourEntry,
  allScheduled: readonly ScheduledShift[],
): DayVariance | null {
  if (entry.type !== "worked") return null;

  const relevantSchedule = allScheduled.filter(s => s.name === entry.name && s.date === entry.date);
  const pairs = pairShiftsToSchedule(entry.shifts ?? [], relevantSchedule);

  const components: VarianceComponent[] = [];
  for (const pair of pairs) {
    const actualMinutes = pair.shift.hours * 60;

    if (pair.scheduled === null) {
      components.push({
        scheduledStart: null,
        scheduledEnd: null,
        actualStart: pair.shift.startTime,
        actualEnd: pair.shift.endTime,
        scheduledMinutes: 0,
        actualMinutes,
        deltaMinutes: actualMinutes,
        unscheduled: true,
      });
      continue;
    }

    // pairShiftsToSchedule returns the matched element BY REFERENCE (it's
    // one of the objects we passed in as `relevantSchedule`), so this cast
    // is safe even though the function's own return type only guarantees
    // startTime/endTime — the runtime object is a full ScheduledShift.
    const scheduledFull = pair.scheduled as ScheduledShift;
    const scheduledMinutes = scheduledFull.hours * 60;
    const deltaMinutes = actualMinutes - scheduledMinutes;
    if (Math.abs(deltaMinutes) < 1) continue;

    components.push({
      scheduledStart: scheduledFull.startTime,
      scheduledEnd: scheduledFull.endTime,
      actualStart: pair.shift.startTime,
      actualEnd: pair.shift.endTime,
      scheduledMinutes,
      actualMinutes,
      deltaMinutes,
      unscheduled: false,
    });
  }

  if (components.length === 0) return null;

  return {
    name: entry.name,
    date: entry.date,
    components,
    deltaMinutes: components.reduce((sum, c) => sum + c.deltaMinutes, 0),
    hasUnscheduled: components.some(c => c.unscheduled),
  };
}

// "auto-approved" is a COMPUTED status, never persisted (see
// aggregateMonthlyVariance's autoApproveEnabled param below) — it exists
// so a day can be counted as effectively approved for display/totals
// purposes without a real VarianceApproval doc ever being written, and
// so callers can render it visually distinct from a genuine manual
// "approved" (approvedBy is only ever set for the latter).
export type VarianceStatus = "approved" | "pending" | "auto-approved";

// A day auto-approves only when the delta is small enough that it isn't
// worth a human's attention. Fixed at 15 minutes per the feature spec —
// not manager-configurable (only the on/off toggle is), so there is
// exactly one number to reason about across the whole codebase.
export const AUTO_APPROVE_THRESHOLD_MINUTES = 15;

export interface DayVarianceWithStatus extends DayVariance {
  status: VarianceStatus;
  approval: VarianceApproval | null;
}

export interface MonthlyVarianceSummary {
  name: string;
  scheduledHours: number;
  clockedHours: number;
  /** clockedHours - scheduledHours. Always equals approvedHours + pendingHours. */
  differenceHours: number;
  approvedHours: number;
  pendingHours: number;
  days: DayVarianceWithStatus[];
}

/**
 * Per-employee monthly aggregation. Deliberately does NOT do its own
 * date-range bucketing — same convention as effectiveHours.ts's
 * aggregateEffectiveHours: hand it one period's entries, it aggregates
 * them. `allScheduled` does not need pre-filtering to the period; each
 * day's matching already filters by date internally.
 *
 * Only entries with status "approved" participate — mirrors the live
 * payroll export's own filter, so variance is never shown for hours
 * that haven't even been confirmed as real yet.
 *
 * scheduledHours/clockedHours are summed ONLY from the components that
 * survived the 1-minute floor (see computeDayVariance) — a component
 * dropped as noise has actual≈scheduled by definition, so this is
 * invisible at real display precision, and it guarantees
 * differenceHours (clockedHours - scheduledHours) exactly equals
 * approvedHours + pendingHours, with no separate rounding path to drift
 * out of sync.
 *
 * `autoApproveEnabled` (default false — every existing caller keeps
 * today's exact behaviour) implements the auto-approve toggle: a day
 * with NO real VarianceApproval doc and |deltaMinutes| below
 * AUTO_APPROVE_THRESHOLD_MINUTES is COMPUTED as "auto-approved" and its
 * minutes fold into approvedHours (it IS effectively approved for
 * counting purposes) rather than pendingHours. This is purely a
 * per-call computation — nothing is written, so flipping the setting
 * off makes these days revert to "pending" on the very next render, with
 * zero data migration. Callers must render "auto-approved" visibly
 * distinct from a real "approved" (see VarianceTab.tsx) — `day.approval`
 * stays null for an auto-approved day precisely because no one actually
 * approved it.
 */
export function aggregateMonthlyVariance(
  name: string,
  entries: readonly HourEntry[],
  allScheduled: readonly ScheduledShift[],
  approvals: readonly VarianceApproval[],
  autoApproveEnabled: boolean = false,
): MonthlyVarianceSummary {
  const approvalByDate = new Map(
    approvals.filter(a => a.name === name).map(a => [a.date, a] as const)
  );

  const days: DayVarianceWithStatus[] = entries
    .filter(e => e.name === name && e.status === "approved")
    .map(e => computeDayVariance(e, allScheduled))
    .filter((d): d is DayVariance => d !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      const approval = approvalByDate.get(d.date) ?? null;
      let status: VarianceStatus;
      if (approval) status = "approved";
      else if (autoApproveEnabled && Math.abs(d.deltaMinutes) < AUTO_APPROVE_THRESHOLD_MINUTES) status = "auto-approved";
      else status = "pending";
      return { ...d, status, approval };
    });

  let scheduledMinutes = 0;
  let clockedMinutes = 0;
  let approvedMinutes = 0;
  let pendingMinutes = 0;

  for (const day of days) {
    for (const c of day.components) {
      scheduledMinutes += c.scheduledMinutes;
      clockedMinutes += c.actualMinutes;
    }
    if (day.status === "approved" || day.status === "auto-approved") approvedMinutes += day.deltaMinutes;
    else pendingMinutes += day.deltaMinutes;
  }

  return {
    name,
    scheduledHours: scheduledMinutes / 60,
    clockedHours: clockedMinutes / 60,
    differenceHours: (clockedMinutes - scheduledMinutes) / 60,
    approvedHours: approvedMinutes / 60,
    pendingHours: pendingMinutes / 60,
    days,
  };
}
