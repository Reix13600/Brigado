import { ActiveClockIn, GeneralConfig, HourEntry, ScheduledShift, StaffMember, VarianceApproval } from "../types";
import { aggregateEffectiveHours, pairShiftsToSchedule } from "./effectiveHours";
import { aggregateMonthlyVariance } from "./variance";

// ─────────────────────────────────────────────────────────────────────
// Shared foundation for the Phase E (scheduling-time overtime warning)
// and Phase F (no-show / forgotten clock-out alerts) work, and the
// payroll-ready screen / risk radar / employee detail / weekly digest
// that read from the same rollup afterwards. Nothing here is new maths —
// every hours/overtime number is effectiveHours.ts's own
// aggregateEffectiveHours, every variance number is variance.ts's own
// aggregateMonthlyVariance. This module adds exactly two things that
// didn't exist anywhere yet (no-shows, forgotten clock-outs) and then
// combines all of it into one per-employee rollup so five different UI
// surfaces don't each grow their own slightly-different version of "how
// is this employee doing."
//
// STEP 0 finding, confirmed against the code (not assumed): no no-show
// or forgotten-clock-out detection exists anywhere in the codebase.
// variance.ts's own docstring says so explicitly — "A day with a
// scheduled shift and zero clock records... never produces a
// DayVariance at all... keeps no-shows out of scope by construction" —
// and grepping the whole src/ tree for no-show/forgottenClockOut turns
// up only that same docstring and this file. Phase B deliberately
// deferred it; this is that later phase.
//
// Two genuinely different conditions, not two names for one thing:
//   - NO-SHOW: a scheduled shift with ZERO matching clock records for
//     that employee's day. Nobody ever clocked in.
//   - FORGOTTEN CLOCK-OUT: a real ActiveClockIn record (they DID clock
//     in) that has stayed open far longer than any real shift would —
//     they're mid-shift-forever because they forgot to clock out, not
//     absent.
// A person can be one, the other, or neither on a given day, but never
// both for the same shift (a no-show has no ActiveClockIn at all; a
// forgotten clock-out has one).
// ─────────────────────────────────────────────────────────────────────

/** One scheduled shift nobody ever clocked in for. */
export interface NoShowInstance {
  name: string;
  date: string;
  scheduled: ScheduledShift;
}

/**
 * Scheduled shifts with zero matching clock records, for one employee
 * across an explicit list of dates.
 *
 * Reuses effectiveHours.ts's own `pairShiftsToSchedule` — the SAME
 * greedy-nearest matching every other phase in this series relies on —
 * rather than reimplementing "does this shift have a clock record."
 * A day with no HourEntry at all naturally produces zero pairs, so every
 * scheduled shift that day comes back unmatched (a true, complete
 * no-show). A split-shift day where only one of two shifts was worked
 * correctly flags only the unworked one, for the same reason
 * pairShiftsToSchedule already handles split shifts correctly elsewhere.
 *
 * `pairShiftsToSchedule` returns its matched `scheduled` value BY
 * REFERENCE (documented on that function) — one of the exact objects
 * passed in as `dayScheduled` below — so identity comparison via a Set
 * is safe and doesn't need a second matching pass.
 *
 * Deliberately does NOT know what "today" is. A future scheduled shift
 * with (obviously) no clock record yet would come back as a "no-show"
 * if asked about — that's correct behaviour for the pure function; it's
 * the CALLER's job to only pass past-or-today dates when scanning for
 * real alerts (see computeOperationsRollup and the Phase F dashboard
 * badge, both of which do).
 *
 * DOES NOT MUTATE any argument.
 */
export function findNoShows(
  name: string,
  dates: readonly string[],
  scheduled: readonly ScheduledShift[],
  entries: readonly HourEntry[],
): NoShowInstance[] {
  const results: NoShowInstance[] = [];

  for (const date of dates) {
    const dayScheduled = scheduled.filter(s => s.name === name && s.date === date);
    if (dayScheduled.length === 0) continue;

    const dayEntry = entries.find(e => e.name === name && e.date === date && e.type === "worked");
    const pairs = pairShiftsToSchedule(dayEntry?.shifts ?? [], dayScheduled);
    const matched = new Set(pairs.map(p => p.scheduled).filter((s): s is ScheduledShift => s !== null));

    for (const s of dayScheduled) {
      if (!matched.has(s)) results.push({ name, date, scheduled: s });
    }
  }

  return results;
}

/** An open clock-in that has stayed active well past any real shift. */
export interface ForgottenClockOutInstance {
  name: string;
  clockInAt: string; // ISO
  hoursElapsed: number;
}

/** Default "this has clearly been forgotten" threshold. 12 hours is
 * comfortably longer than even a long double-shift-plus-overtime day in
 * this industry, short enough to still catch it the same service, and
 * needs no restaurant-specific configuration — a single sensible
 * default, not a new Settings field. */
export const DEFAULT_FORGOTTEN_CLOCKOUT_HOURS = 12;

/**
 * Open clock-ins for one employee that have been active longer than
 * `thresholdHours`.
 *
 * Deliberately NOT date-range parameterized like every other function in
 * this module — `ActiveClockIn` (see types.ts) represents CURRENT live
 * state, keyed one-per-person, not a historical log to bucket by date.
 * There is no "forgotten clock-out that happened last Tuesday" to query
 * for; either someone is over-threshold clocked in right now, or they
 * are not. `now` is injectable for deterministic testing.
 *
 * DOES NOT MUTATE any argument.
 */
export function findForgottenClockOuts(
  name: string,
  activeClockIns: readonly ActiveClockIn[],
  thresholdHours: number = DEFAULT_FORGOTTEN_CLOCKOUT_HOURS,
  now: Date = new Date(),
): ForgottenClockOutInstance[] {
  return activeClockIns
    .filter(a => a.name === name)
    .map(a => ({
      name,
      clockInAt: a.clockInAt,
      hoursElapsed: (now.getTime() - new Date(a.clockInAt).getTime()) / 3600000,
    }))
    .filter(a => a.hoursElapsed >= thresholdHours);
}

/** One employee's rollup over the requested date range. Every hours/
 * overtime figure is effectiveHours.ts's own — ACTUAL clocked hours,
 * tolerance-adjusted, against the contract threshold — NOT
 * plannedHours.ts's forward-looking scheduled-hours counter. Those two
 * answer different questions ("what did they actually work" vs. "what
 * have I rostered them for") and this rollup is squarely the former: a
 * no-show, a forgotten clock-out, and a manager correction are all
 * facts about what happened, not what's planned. Phase 2 below reuses
 * plannedHours.ts separately, for its own genuinely different,
 * forward-looking question. */
export interface EmployeeOperationsSummary {
  name: string;
  effectiveHours: number;
  actualHours: number;
  overtimeHours: number;
  contractHours: number;
  noShowCount: number;
  noShows: NoShowInstance[];
  forgottenClockOutCount: number;
  forgottenClockOuts: ForgottenClockOutInstance[];
  /** Manager-initiated hour edits in range (HourEntry.editedBy set) —
   * distinct from staff-initiated correction REQUESTS (status ===
   * "correction"), which is a different, staff-side workflow. "Manager
   * corrections" per the spec means the audit-trail fields Phase B
   * added specifically for a manager's own edit. */
  correctionsCount: number;
  /** Variance days still pending (or, if auto-approve is enabled,
   * still genuinely pending after that computed status is applied) —
   * i.e. "unexplained deviations" nobody has signed off on yet. Reuses
   * variance.ts's own aggregateMonthlyVariance rather than
   * recalculating deltas here. */
  pendingVarianceCount: number;
  /** Follow-on to Parts 1-8: entries with `HourEntry.flagged === true`
   * in range — submitted without a fresh QR scan (or >3 min after one),
   * per that field's own definition in types.ts. This is an anti-
   * fraud/legitimacy signal set once at submission time, NOT a "these
   * hours look wrong" signal — the two are independent (an entry can be
   * flagged with perfectly ordinary hours, or have absurd hours and not
   * be flagged). There is no "resolve"/"unflag" action anywhere in the
   * codebase, so a flagged entry stays flagged until a manager notices
   * and corrects it — today the ONLY place it's visible at all is a 🚩
   * icon on that one row in the Entries tab. This count is what lets
   * the Risk Radar surface it without a manager having to stumble on
   * it by scrolling. */
  flaggedEntryCount: number;
  /** PART 6 (Phase E/F follow-on): rate × effective hours, GROSS ONLY —
   * no tax/charges applied. This is deliberately a DIFFERENT number from
   * the live Payroll tab / Stats page's existing gross/net figures,
   * which are rate × RAW HourEntry.hours (see triggerExportPayrollCSV
   * and StatsPage.tsx's totalCost). Those are the real payroll
   * calculation; this is a tolerance-aware ESTIMATE for operational
   * visibility (Rota planner / Stats / employee-detail), same
   * "effectiveHours is not wired into real payroll" discipline as
   * effectiveHours.ts itself (see CLAUDE.md). Every caller must label
   * this as an estimate — see estimateGrossCost's own doc comment. */
  estimatedGrossCost: number;
}

/**
 * rate × effective hours, gross only. THE one calculation Part 6 shares
 * across all three surfaces (Rota planner weekly counter, Stats page,
 * employee detail) — deliberately not duplicated as `hours * rate` at
 * each call site. Never applies tax/charges: this estimate answers "what
 * would this cost, roughly," not "what would we actually pay," which
 * stays the live Payroll tab's job (raw hours, tax rate, advances).
 */
export function estimateGrossCost(effectiveHours: number, rate: number): number {
  return effectiveHours * rate;
}

export interface OperationsRollup {
  employees: EmployeeOperationsSummary[];
  totals: {
    employeeCount: number;
    totalEffectiveHours: number;
    totalOvertimeHours: number;
    totalNoShows: number;
    totalForgottenClockOuts: number;
    totalCorrections: number;
    totalPendingVariance: number;
    totalEstimatedGrossCost: number;
    totalFlaggedEntries: number;
  };
}

export interface OperationsRollupOptions {
  /** Which staff to include. Defaults to every ACTIVE staff member —
   * matches VarianceTab's own `staff.filter(s => s.active !== false)`
   * convention, so "N employees" on the payroll-ready screen means the
   * same population every other manager-facing view already uses. */
  staffFilter?: (member: StaffMember) => boolean;
  autoApproveEnabled?: boolean;
  forgottenClockOutThresholdHours?: number;
  now?: Date;
}

/**
 * THE rollup. One function, date-range parameterized (hand it a day's,
 * week's, or month's list of dates), backing the scheduling-time warning
 * is NOT here (that's Phase 2/Part 2, a live save-time check with no
 * rollup involved) but the no-show/forgotten-clock-out badge (Part 3),
 * the payroll-ready screen (Part 4), the risk radar card (Part 5), and
 * the weekly digest (Part 8) all call this ONE function rather than each
 * re-deriving their own version of "how many hours, how much overtime,
 * how many issues."
 *
 * `entries` and `scheduled` should already be filtered/relevant to
 * `dates` by the caller where that matters for performance — this
 * function itself filters internally wherever a per-day answer is
 * needed (no-shows, corrections), same "caller supplies the period,
 * this aggregates it" convention as aggregateEffectiveHours and
 * aggregateMonthlyVariance, which are both called from here unfiltered
 * and do their own entry-level date checks.
 *
 * Forgotten clock-outs are NOT date-range filtered (see
 * findForgottenClockOuts) — they reflect current live state regardless
 * of what date range was asked for, since "is someone stuck clocked in
 * right now" doesn't have a meaningful date-range answer.
 *
 * DOES NOT MUTATE any argument.
 */
export function computeOperationsRollup(
  dates: readonly string[],
  entries: readonly HourEntry[],
  scheduled: readonly ScheduledShift[],
  activeClockIns: readonly ActiveClockIn[],
  approvals: readonly VarianceApproval[],
  staff: readonly StaffMember[],
  config: Partial<GeneralConfig> | null | undefined,
  options?: OperationsRollupOptions,
): OperationsRollup {
  const staffFilter = options?.staffFilter ?? ((s: StaffMember) => s.active !== false);
  const dateSet = new Set(dates);
  const inRangeEntries = entries.filter(e => dateSet.has(e.date));

  const effectiveByName = new Map(
    aggregateEffectiveHours(inRangeEntries, scheduled, staff, config).map(e => [e.name, e])
  );

  const relevantStaff = staff.filter(staffFilter);

  const employees: EmployeeOperationsSummary[] = relevantStaff.map(member => {
    const name = member.name;
    const eff = effectiveByName.get(name);

    const noShows = findNoShows(name, dates, scheduled, entries);
    const forgottenClockOuts = findForgottenClockOuts(
      name,
      activeClockIns,
      options?.forgottenClockOutThresholdHours,
      options?.now,
    );

    const correctionsCount = inRangeEntries.filter(e => e.name === name && !!e.editedBy).length;
    const flaggedEntryCount = inRangeEntries.filter(e => e.name === name && !!e.flagged).length;

    const variance = aggregateMonthlyVariance(name, inRangeEntries, scheduled, approvals, options?.autoApproveEnabled);
    const pendingVarianceCount = variance.days.filter(d => d.status === "pending").length;
    const effectiveHours = eff?.effectiveHours ?? 0;

    return {
      name,
      effectiveHours,
      actualHours: eff?.actualHours ?? 0,
      overtimeHours: eff?.overtimeHours ?? 0,
      contractHours: eff?.contractHours ?? 0,
      noShowCount: noShows.length,
      noShows,
      forgottenClockOutCount: forgottenClockOuts.length,
      forgottenClockOuts,
      correctionsCount,
      pendingVarianceCount,
      flaggedEntryCount,
      estimatedGrossCost: estimateGrossCost(effectiveHours, member.rate),
    };
  });

  const totals = employees.reduce(
    (acc, e) => ({
      employeeCount: acc.employeeCount + 1,
      totalEffectiveHours: acc.totalEffectiveHours + e.effectiveHours,
      totalOvertimeHours: acc.totalOvertimeHours + e.overtimeHours,
      totalNoShows: acc.totalNoShows + e.noShowCount,
      totalForgottenClockOuts: acc.totalForgottenClockOuts + e.forgottenClockOutCount,
      totalCorrections: acc.totalCorrections + e.correctionsCount,
      totalPendingVariance: acc.totalPendingVariance + e.pendingVarianceCount,
      totalEstimatedGrossCost: acc.totalEstimatedGrossCost + e.estimatedGrossCost,
      totalFlaggedEntries: acc.totalFlaggedEntries + e.flaggedEntryCount,
    }),
    { employeeCount: 0, totalEffectiveHours: 0, totalOvertimeHours: 0, totalNoShows: 0, totalForgottenClockOuts: 0, totalCorrections: 0, totalPendingVariance: 0, totalEstimatedGrossCost: 0, totalFlaggedEntries: 0 },
  );

  return { employees, totals };
}
