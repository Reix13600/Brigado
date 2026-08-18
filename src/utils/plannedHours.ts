import { ScheduledShift, StaffMember, GeneralConfig } from "../types";
import { getContractHours } from "./effectiveHours";

// ─────────────────────────────────────────────────────────────────────
// PHASE C of the scheduling/payroll series. Weekly PLANNED-hours totals
// for the Rota Planner's running counter ("Marie: 33/35h").
//
// ⚠️ THIS MODULE IS ABOUT PLANNED HOURS ONLY — what the roster adds up
// to before anyone works it. It reads ScheduledShift[] and NOTHING else:
// no HourEntry, no clock records, no tolerance. That is the whole point
// of it being a separate module from its two siblings:
//
//   effectiveHours.ts — actual clocked hours, tolerance-adjusted (pay)
//   variance.ts       — actual vs. scheduled, raw (review workflow)
//   plannedHours.ts   — scheduled only, nothing actual (this file)
//
// A shift being on the rota says nothing about whether it was worked.
// Do not "unify" this with the other two by having it consult entries —
// the counter must answer "what have I rostered this person for" even
// for a week entirely in the future, where no clock data can exist.
//
// Pure and computed at render time, same discipline as Phase A/B:
// nothing here writes to Firestore or mutates its arguments.
// ─────────────────────────────────────────────────────────────────────

/**
 * The legal weekly ceiling (Art. L3121-20 — the `weekly48h` rule in
 * compliance.ts, whose own description is literally "Total scheduled
 * hours for one staff member in a single week shouldn't exceed 48
 * hours"). This is NOT a new overtime threshold — the overtime
 * threshold is and remains `getContractHours()`. This constant only
 * names the 48 that was already hardcoded in ManagerDashboard's Rota
 * Total column, so the two states have one definition between them.
 */
export const WEEKLY_LEGAL_MAX_HOURS = 48;

/**
 * One scheduled shift's duration in hours.
 *
 * ⚠️ Deliberately recomputed from startTime/endTime rather than trusting
 * the stored `ScheduledShift.hours` field, mirroring ManagerDashboard's
 * existing `getShiftHours()` exactly — including its overnight handling
 * (`end <= start` ⇒ the shift crosses midnight, add 24h). The stored
 * `hours` field is written at save time and can be stale relative to a
 * draft the manager is still editing, which is precisely the case the
 * live counter has to get right.
 */
export function shiftDurationHours(shift: Pick<ScheduledShift, "startTime" | "endTime">): number {
  const toMinutes = (timeStr: string) => {
    const [h, m] = String(timeStr).split(":").map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };
  const start = toMinutes(shift.startTime);
  let end = toMinutes(shift.endTime);
  if (end <= start) end += 1440; // overnight
  return (end - start) / 60;
}

/**
 * Total planned hours for one person across an explicit set of dates.
 *
 * Takes the dates as a list rather than a range so the caller stays the
 * single source of truth for "which week am I looking at" — same
 * convention as `aggregateEffectiveHours`/`aggregateMonthlyVariance`,
 * which also refuse to do their own date bucketing. ManagerDashboard
 * already has `getScheduleWeekDates()`; this consumes its output.
 *
 * Matches on exact `name`. Unassigned/open shifts (`name === ""`) belong
 * to nobody and therefore count toward nobody's total — asking for the
 * total of `""` is a caller error, not an "open shifts" query.
 */
export function sumPlannedHours(
  name: string,
  dates: readonly string[],
  shifts: readonly ScheduledShift[],
): number {
  const dateSet = new Set(dates);
  return shifts
    .filter(s => s.name === name && dateSet.has(s.date))
    .reduce((sum, s) => sum + shiftDurationHours(s), 0);
}

/** Severity of a planned-hours total against its thresholds. Ordered by
 * escalation so a caller can compare, and named for what it MEANS rather
 * than for a colour, so the visual treatment stays the component's call. */
export type PlannedHoursLevel = "under" | "at_or_over_contract" | "over_legal_max";

export interface PlannedWeekTotal {
  name: string;
  /** Hours rostered for this person across the given dates. */
  plannedHours: number;
  /** The contract/overtime threshold — `getContractHours()`, unchanged. */
  thresholdHours: number;
  level: PlannedHoursLevel;
  /** plannedHours − thresholdHours when at/over, else 0. */
  overBy: number;
}

/**
 * The whole counter for one person, in one call.
 *
 * ⚠️ The threshold is `getContractHours()` from effectiveHours.ts —
 * REUSED, not reimplemented, and not "fixed". It carries Phase A's
 * deliberate `member?.contract || config.overtime_limit` semantics: a
 * contract of 0 falls THROUGH to the restaurant's overtime limit (itself
 * defaulting to 35) rather than being treated as a literal 0-hour
 * threshold. Changing that `||` to `??` here would make every rostered
 * minute read as overtime for 0-contract staff. See CLAUDE.md.
 *
 * `at_or_over_contract` triggers at `>=` the threshold, not `>` — a
 * counter reading exactly "35/35h" is already the thing a manager needs
 * to notice, since the very next shift is overtime.
 */
export function computePlannedWeekTotal(
  name: string,
  dates: readonly string[],
  shifts: readonly ScheduledShift[],
  staff: readonly StaffMember[],
  config?: Partial<GeneralConfig> | null,
): PlannedWeekTotal {
  const plannedHours = sumPlannedHours(name, dates, shifts);
  const thresholdHours = getContractHours(name, staff, config);

  const level: PlannedHoursLevel =
    plannedHours > WEEKLY_LEGAL_MAX_HOURS
      ? "over_legal_max"
      : plannedHours >= thresholdHours && plannedHours > 0
        ? "at_or_over_contract"
        : "under";

  return {
    name,
    plannedHours,
    thresholdHours,
    level,
    overBy: plannedHours > thresholdHours ? plannedHours - thresholdHours : 0,
  };
}

/** A shift the manager is composing in the modal but has NOT saved yet.
 * `id` is null for a brand-new shift, or the existing shift's id when
 * editing one (so the projection replaces rather than double-counts). */
export interface DraftShift {
  id: string | null;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Overlays an unsaved draft onto the saved shift list, producing the
 * list as it WOULD be if the draft were saved. This is what makes the
 * counter live "before saving, not just after": the component feeds the
 * projection (not `appData.scheduledShifts`) to `computePlannedWeekTotal`
 * while the modal is open, so the total reacts as the manager types.
 *
 * Editing an existing shift replaces it in place — by id, so moving a
 * shift to a different person/date correctly removes those hours from
 * the old owner's total and adds them to the new one's in the same pass.
 *
 * Returns the input array UNCHANGED (same reference) when there is no
 * draft, so the no-modal-open case costs nothing.
 *
 * DOES NOT MUTATE `shifts` or `draft`.
 */
export function projectDraftShift(
  shifts: readonly ScheduledShift[],
  draft: DraftShift | null,
): readonly ScheduledShift[] {
  if (!draft) return shifts;
  // An incomplete draft (no assignee, or no date yet) can't be attributed
  // to anyone's week, so it contributes nothing until it is.
  if (!draft.name || !draft.date) {
    return draft.id ? shifts.filter(s => s.id !== draft.id) : shifts;
  }

  const projected: ScheduledShift = {
    id: draft.id ?? "__draft__",
    name: draft.name,
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    hours: shiftDurationHours(draft),
    // Role never affects an hours total; the real value is applied on
    // save. Kept off the projection so this module needs no RoleType.
    role: "other",
  };

  const withoutOriginal = draft.id ? shifts.filter(s => s.id !== draft.id) : shifts;
  return [...withoutOriginal, projected];
}
