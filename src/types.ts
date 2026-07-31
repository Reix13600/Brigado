export type RoleType = 'server' | 'kitchen' | 'cold' | 'dishwasher' | 'bar' | 'chef' | 'cleaner' | 'host' | 'other';
export type EntryType = 'worked' | 'absent' | 'sick' | 'holiday';
export type EntryStatus = 'approved' | 'pending' | 'correction';

export interface Shift {
  startTime: string;
  endTime: string;
  hours: number;
  overnight: boolean;
}

export interface HourEntry {
  id: number;
  name: string;
  date: string; // YYYY-MM-DD
  type: EntryType;
  hours: number;
  shifts: Shift[];
  startTime: string | null;
  endTime: string | null;
  note: string;
  submittedAt: string; // ISO string
  status: EntryStatus;
  correctionNote?: string;
  correctionAt?: string;
  // True when this entry was submitted without a fresh QR scan (or more
  // than 3 minutes after one) — manager-only signal, staff never see it.
  flagged?: boolean;
}

export interface StaffMember {
  name: string;
  role: RoleType;
  rate: number;
  contract: number;
  pin: string;
  // Soft-delete: false/undefined-checked-as-false means archived — hidden
  // from active rosters (PIN login, new shift assignment) but their name
  // stays intact so past entries/payroll/timesheets still resolve
  // correctly. Never hard-deleted here; that's a legal-retention question
  // to answer separately, not a UI toggle.
  active?: boolean;
  // Drives youth-labor protections (shorter max hours, no night work,
  // longer rest) in the compliance rule set. No birthdate stored — just
  // a manager-set flag, kept deliberately minimal.
  is_minor?: boolean;
}

export interface CashAdvance {
  id: string;
  name: string;
  amount: number;
  date: string; // YYYY-MM-DD
  note: string;
  createdAt: string; // ISO string
}

export interface Deduction {
  id: string;
  label: string;
  rate: number; // percentage
}

export interface GeneralConfig {
  resto_name: string;
  manager_pin: string;
  overtime_limit: number;
  // tax_rate is the SUM of all deductions[].rate — kept in sync whenever
  // deductions change, so every existing calculation that reads tax_rate
  // (Payroll, Stats, CSV export, the weekly digest) keeps working
  // unmodified. deductions is the editable, named breakdown shown to the
  // manager (e.g. "Income tax 15%" + "Social charge 7%" = tax_rate 22%).
  tax_rate: number;
  deductions: Deduction[];
  approval_required: boolean;
  bookkeeper_email: string;
  sheet_url: string;
  enable_scheduling: boolean;
  compliance_enforced: boolean;
  // Which individual compliance rules are active, keyed by rule id (see
  // src/utils/compliance.ts). Missing key = treated as off. Lets a
  // manager enable only what's relevant to their situation instead of
  // an all-or-nothing switch.
  compliance_rules?: Record<string, boolean>;
  // Current SMIC hourly rate (€), for the "below minimum wage" staff
  // check. Changes yearly — manager-maintained, Brigado doesn't fetch it.
  smic_hourly?: number;
  // When true, staff can't freehand-type "worked" hours — they must use
  // the live Clock In / Clock Out buttons instead.
  strict_clock_required: boolean;
  // Optional email address for the weekly Sunday-night digest. Empty
  // string means "don't send one."
  digest_email: string;
  // Whether the printable per-employee timesheet includes signature
  // lines for employee + manager.
  timesheet_signatures: boolean;
}

export interface ScheduledShift {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  hours: number;
  role: RoleType;
  note?: string;
}

// A staff member who has clocked in but not yet clocked out.
export interface ActiveClockIn {
  name: string;
  clockInAt: string; // ISO string
  flagged: boolean;
  note?: string;
}

// Manager -> everyone. Read-only for staff.
export interface Announcement {
  id: string;
  message: string;
  postedAt: string; // ISO
}

// Private two-way thread between one staff member and the manager.
export interface PrivateMessage {
  id: string;
  staffName: string; // which thread this belongs to
  from: "manager" | "staff";
  text: string;
  sentAt: string; // ISO
}

export type TimeOffStatus = "pending" | "approved" | "denied";
export interface TimeOffRequest {
  id: string;
  staffName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
  status: TimeOffStatus;
  requestedAt: string; // ISO
  decidedAt?: string; // ISO
  // Manager-only note, e.g. "waiting to hear back from Marie" — a
  // lightweight "on hold" signal without a separate status to track.
  managerNote?: string;
}

// "Open cover request" model: staff marks one of their scheduled shifts
// as needing cover, any other staff member can claim it, manager gives
// final approval before the shift actually reassigns.
export type SwapStatus = "open" | "claimed" | "approved" | "denied";
export interface SwapRequest {
  id: string;
  shiftId: string; // references ScheduledShift.id
  originalStaff: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  role: RoleType;
  reason: string;
  status: SwapStatus;
  requestedAt: string; // ISO
  claimedBy?: string;
  claimedAt?: string;
  decidedAt?: string;
  // Manager-only note, same "on hold" purpose as TimeOffRequest.
  managerNote?: string;
}

export interface AppData {
  config: GeneralConfig;
  staff: StaffMember[];
  entries: HourEntry[];
  advances: CashAdvance[];
  dayNotes: Record<string, string>; // YYYY-MM-DD -> note
  weekNotes: Record<string, string>; // "week:YYYY-MM-DD" -> note
  // Manager-entered weekly revenue, keyed by the Monday of that week
  // (YYYY-MM-DD) — powers the labor-cost-as-%-of-revenue stat. Only
  // populated for weeks the manager has actually filled in.
  revenueByWeek?: Record<string, number>;
  scheduledShifts: ScheduledShift[];
  activeClockIns: ActiveClockIn[];
  announcements: Announcement[];
  messages: PrivateMessage[];
  timeOffRequests: TimeOffRequest[];
  swapRequests: SwapRequest[];
  // Set true by the Stripe webhook when a subscription is cancelled.
  // Soft-suspend, not deletion — data stays intact.
  suspended?: boolean;
  // All manager email addresses for this restaurant — lets the Settings
  // UI list/invite/remove managers without needing a Firestore query
  // capability the security rules don't otherwise allow.
  managerEmails?: string[];
}
