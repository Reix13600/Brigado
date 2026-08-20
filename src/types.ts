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
  // Audit trail for a MANAGER's own edit to `hours` (saveInlineEdit). Added
  // in the variance-view phase, which surfaced that manager edits carried
  // no editor identity, reason, or previous value — unlike staff-initiated
  // corrections (correctionNote/correctionAt above). Purely additive: does
  // not change how hours are saved or calculated.
  editedBy?: string; // manager email/uid
  editedAt?: string; // ISO string
  previousHours?: number; // value being overwritten
  editReason?: string; // optional free text
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
  // Clock-in/out grace window in minutes, per restaurant. Feeds the
  // tolerance-aware effective-hours calculation in
  // src/utils/effectiveHours.ts — see the tolerance rule in CLAUDE.md.
  // Unset = DEFAULT_TOLERANCE_MINUTES (10). NOT yet used by the live
  // payroll export; Phase A builds the calculation, a later phase wires
  // it in after validation.
  tolerance_minutes?: number;
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
  // When true, a variance day with no explicit approval record and
  // |deltaMinutes| < 15 is COMPUTED as "effectively approved" wherever
  // variance status is counted or displayed — see src/utils/variance.ts's
  // VarianceStatus. Nothing is ever written to varianceApprovals for
  // these; toggling this off reverts them to pending immediately, since
  // there was never a real record to begin with. Reuses the tolerance-
  // setting's own Settings location (Hours & tax card), per CLAUDE.md.
  auto_approve_variance_enabled?: boolean;
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

// A manager's APPROVAL DECISION for one employee's one day of
// scheduled-vs-actual variance (see src/utils/variance.ts). The variance
// numbers themselves are never stored here or anywhere — they're always
// recomputed live from entries + scheduledShifts, same "pure function, no
// cached duplicate" discipline as effectiveHours.ts. This doc is only the
// human decision on top of that live number. Absence of a doc for a given
// (name, date) means "pending" — there is no separate pending doc.
// Doc id is a deterministic `${date}__${encodeURIComponent(name)}` key so
// approve/invalidate can target it directly without a query.
export interface VarianceApproval {
  name: string;
  date: string; // YYYY-MM-DD
  approvedBy: string; // manager email/uid
  approvedAt: string; // ISO string
  note?: string;
}

// Phase D: a manager-saved, reusable shift shape (e.g. "Server – Lunch,
// 11:30–15:00") shown in a tray under the Rota Planner and dragged onto
// the grid to instantly create a shift. The template itself is never
// consumed by a drag — only ever read to stamp a brand-new
// ScheduledShift, which is created through the exact same
// saveScheduledShift() call a manually-added shift uses.
export interface ShiftTemplate {
  id: string;
  label: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  // Optional: a template isn't tied to a specific person, so a role isn't
  // required the way it is on a ScheduledShift (which inherits from
  // whoever it's assigned to). When set, it pre-fills the created shift's
  // role instead of falling back to the target staff member's own role.
  role?: RoleType;
  createdAt: string; // ISO string
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
  // Set when the RECIPIENT (the party who didn't send it) opens the
  // thread. Absent = unread. This is the real read state — "unread" was
  // previously (wrongly) inferred from "who sent the last message",
  // which never cleared for a read-but-not-replied-to message.
  readAt?: string;
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
  varianceApprovals: VarianceApproval[];
  shiftTemplates: ShiftTemplate[];
  swapRequests: SwapRequest[];
  // Set true by the Stripe webhook when a subscription is cancelled.
  // Soft-suspend, not deletion — data stays intact.
  suspended?: boolean;
  // Single source of truth for access blocking, written only by the
  // Stripe webhook functions. "trial_expired" = the trial ended without
  // ever converting to paid; the app must show the blocked screen and
  // nothing else. Data is retained 30 days from trialExpiredAt, then
  // permanently deleted by the purgeExpiredTrials scheduled function.
  // "active"        — normal paying/trialing tenant, full access
  // "comped"        — bonus-code signup, no Stripe; full access exactly
  //                   like "active" until compedUntil passes
  // "paused"        — admin-paused; blocked, but NO deletion countdown
  // "trial_expired" — blocked, 30-day retention, then auto-purged
  subscriptionStatus?: "active" | "comped" | "paused" | "trial_expired";
  trialExpiredAt?: string; // ISO, set when subscriptionStatus flips to trial_expired
  // Set while paused; the block screen shows a different message for
  // these than for trial_expired (no deletion date, no billing portal).
  pausedAt?: string;
  pauseReason?: string;
  // Comped (bonus-code) tenants. compedUntil === null means permanent.
  compedUntil?: string | null;
  compedVia?: string;
  // Throttled activity heartbeat — "someone at this restaurant used the
  // app recently". Write-only for now: nothing in the app reads it, and
  // the Phase 2 admin analytics view is what will surface it.
  lastActiveAt?: string;
  // All manager email addresses for this restaurant — lets the Settings
  // UI list/invite/remove managers without needing a Firestore query
  // capability the security rules don't otherwise allow.
  managerEmails?: string[];
  // Logo upload + consent + admin approval for the marketing site's
  // "Trusted by" carousel. logoUrl exists as soon as a manager uploads
  // one; it is NEVER shown publicly without BOTH logoConsentGiven and
  // logoApprovalStatus === "approved" — see the `approvedLogos` public
  // collection below, which is the only thing Landing.tsx actually reads.
  logoUrl?: string;
  logoConsentGiven?: boolean;
  logoConsentAt?: string; // ISO
  logoApprovalStatus?: "pending" | "approved" | "rejected";
}

// PUBLIC, purpose-built projection for the Landing page's logo carousel —
// deliberately NOT a query against `restaurants` (that collection holds
// owner contact info, config, etc.; a broad `list` rule there to support
// a public carousel would leak all of it). Written ONLY by the
// `adminSetLogoApproval` callable (Admin SDK, bypasses client rules) when
// a logo is approved, and deleted by the same callable on rejection/
// un-approval — never client-writable.
export interface ApprovedLogo {
  slug: string;
  logoUrl: string;
  restaurantName: string;
  approvedAt: string; // ISO
}
