import { TimeOffRequest, TimeOffStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────
// Part 6 of the same staff-UX round that added the calendar "My
// Schedule" view. Step 0 findings, confirmed against the existing data
// model (not assumed):
//
// 1. TimeOffRequest already carries everything needed to detect a
//    conflict: `staffName`, an inclusive `startDate`..`endDate` range,
//    and `status: "pending" | "approved" | "denied"`. No schema change
//    needed for this feature.
// 2. ScheduledShift links to an employee by `name` + a single `date`
//    (no ID relationship to TimeOffRequest, or to staff at all — same
//    fragile-but-established name+date match every other scheduling
//    feature in this codebase already relies on, see CLAUDE.md's "My
//    Schedule" section). A shift "conflicts" with time off exactly when
//    its `date` falls inside an approved request's inclusive range for
//    the same `name`.
//
// This module is a single, pure, no-Firestore-access helper reused in
// both directions the Rota Planner needs it: flagging a cell BEFORE a
// shift is saved there (pending heads-up, approved hard block), and
// flagging an EXISTING shift whose date/employee later gained approved
// time off (the reverse case — approval happened after the shift did).
// Same function, same question — "does this employee have time off of
// this status covering this date" — asked from two different moments.
// ─────────────────────────────────────────────────────────────────────

/**
 * The first TimeOffRequest (of any status in `statuses`) covering this
 * employee+date, or null. `startDate`/`endDate` are inclusive, matching
 * how the request UI itself treats the range (see StaffDashboard's own
 * time-off form and ManagerDashboard's requests list).
 */
export function findTimeOffConflict(
  name: string,
  date: string,
  requests: readonly TimeOffRequest[],
  statuses: readonly TimeOffStatus[] = ["approved"],
): TimeOffRequest | null {
  return (
    requests.find(
      r => r.staffName === name && statuses.includes(r.status) && date >= r.startDate && date <= r.endDate
    ) ?? null
  );
}
