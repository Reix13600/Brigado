import { StaffMember } from "../types";

// THE single definition of "active staff" for every FORWARD-LOOKING
// staff list/picker/drag-target in the app — Rota planner assignment,
// message recipients, PIN login tiles, the Variance employee selector,
// etc. Found via a real-user report: an archived (former) staff member
// still appeared as a schedulable row in the Rota planner grid, because
// that one site built its own unfiltered list instead of going through
// a shared definition.
//
// Historical displays must NOT use this — a former staff member's past
// entries/shifts/payroll for a period they actually worked stay visible
// regardless of current active status (see BookkeeperExport.tsx for the
// opposite mistake: over-filtering hid a former employee's already-
// earned pay for a period, which is just as wrong as under-filtering).
// Pure, framework-free (only a type import) so it's safe to use from
// operationsRollup.ts and other Firebase-free util modules, not just
// components.
export function isActiveStaff(member: StaffMember): boolean {
  return member.active !== false;
}

export function activeStaffOnly(staff: readonly StaffMember[]): StaffMember[] {
  return staff.filter(isActiveStaff);
}
