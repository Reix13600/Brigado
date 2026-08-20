import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, limit, writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage, getRestaurantId } from "../firebase";
import { defaultComplianceRules } from "./compliance";
import { isBlockedStatus } from "./tenantStatus";
import { varianceApprovalId } from "./variance";
import {
  AppData, GeneralConfig, StaffMember, HourEntry, CashAdvance, ScheduledShift, ActiveClockIn, Shift,
  Announcement, PrivateMessage, TimeOffRequest, SwapRequest, VarianceApproval, ShiftTemplate, ApprovedLogo,
} from "../types";

// These are functions, not constants — RESTAURANT_ID is resolved fresh on
// every call, since which restaurant we're talking to depends on which
// URL slug the app booted with (see firebase.ts / App.tsx).
const restoRef = () => doc(db, "restaurants", getRestaurantId());
const entriesCol = () => collection(db, "restaurants", getRestaurantId(), "entries");
const advancesCol = () => collection(db, "restaurants", getRestaurantId(), "advances");
const scheduleCol = () => collection(db, "restaurants", getRestaurantId(), "scheduledShifts");
const activeClockInsCol = () => collection(db, "restaurants", getRestaurantId(), "activeClockIns");
const announcementsCol = () => collection(db, "restaurants", getRestaurantId(), "announcements");
const messagesCol = () => collection(db, "restaurants", getRestaurantId(), "messages");
const timeOffCol = () => collection(db, "restaurants", getRestaurantId(), "timeOffRequests");
const swapCol = () => collection(db, "restaurants", getRestaurantId(), "swapRequests");
const varianceApprovalsCol = () => collection(db, "restaurants", getRestaurantId(), "varianceApprovals");
const shiftTemplatesCol = () => collection(db, "restaurants", getRestaurantId(), "shiftTemplates");

const DEFAULT_CONFIG: GeneralConfig = {
  resto_name: "La Vague",
  manager_pin: "1234",
  overtime_limit: 35,
  // Kept in sync with DEFAULT_TOLERANCE_MINUTES in effectiveHours.ts.
  tolerance_minutes: 10,
  tax_rate: 22,
  deductions: [{ id: "tax", label: "Tax", rate: 22 }],
  approval_required: true,
  bookkeeper_email: "",
  sheet_url: "",
  enable_scheduling: true,
  compliance_enforced: true,
  strict_clock_required: false,
  digest_email: "",
  timesheet_signatures: true,
  compliance_rules: defaultComplianceRules(),
  smic_hourly: 12.02,
};

const DEFAULT_STAFF: StaffMember[] = [
  { name: "Marie", role: "server", rate: 12, contract: 35, pin: "1111" },
  { name: "Thomas", role: "kitchen", rate: 14, contract: 35, pin: "2222" },
  { name: "Sophie", role: "server", rate: 12, contract: 30, pin: "3333" },
  { name: "Lucas", role: "dishwasher", rate: 11, contract: 20, pin: "4444" },
  { name: "Emma", role: "bar", rate: 13, contract: 35, pin: "5555" },
];

async function getAllEntries(): Promise<HourEntry[]> {
  const snap = await getDocs(entriesCol());
  return snap.docs.map(d => d.data() as HourEntry);
}

async function getAllAdvances(): Promise<CashAdvance[]> {
  const snap = await getDocs(advancesCol());
  return snap.docs.map(d => d.data() as CashAdvance);
}

async function getAllScheduledShifts(): Promise<ScheduledShift[]> {
  const snap = await getDocs(scheduleCol());
  return snap.docs.map(d => d.data() as ScheduledShift);
}

async function getAllActiveClockIns(): Promise<ActiveClockIn[]> {
  const snap = await getDocs(activeClockInsCol());
  return snap.docs.map(d => d.data() as ActiveClockIn);
}

async function getAllAnnouncements(): Promise<Announcement[]> {
  const snap = await getDocs(announcementsCol());
  return snap.docs.map(d => d.data() as Announcement).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

async function getAllMessages(): Promise<PrivateMessage[]> {
  const snap = await getDocs(messagesCol());
  return snap.docs.map(d => d.data() as PrivateMessage).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

async function getAllTimeOffRequests(): Promise<TimeOffRequest[]> {
  const snap = await getDocs(timeOffCol());
  return snap.docs.map(d => d.data() as TimeOffRequest).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

async function getAllSwapRequests(): Promise<SwapRequest[]> {
  const snap = await getDocs(swapCol());
  return snap.docs.map(d => d.data() as SwapRequest).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/**
 * `varianceApprovals` is manager-only to READ (see firestore.rules) —
 * unlike every other subcollection here, which any signed-in session can
 * read. `fetchAppData` is called for EVERY session, staff included, and
 * runs before anyone has necessarily signed in as a manager (the very
 * first load of a fresh anonymous staff session, or even a manager's
 * session before they've completed ManagerDashboard's own internal
 * auth gate). A `permission-denied` here is therefore the EXPECTED
 * outcome for most callers, not a real error — swallowing it and
 * returning [] is what keeps the rest of `fetchAppData`'s Promise.all
 * from being taken down by a read nobody but a manager needs anyway
 * (only VarianceTab, itself manager-only UI, consumes this array).
 * Anything other than permission-denied still throws normally.
 */
async function getAllVarianceApprovals(): Promise<VarianceApproval[]> {
  try {
    const snap = await getDocs(varianceApprovalsCol());
    return snap.docs.map(d => d.data() as VarianceApproval);
  } catch (err: any) {
    if (err?.code === "permission-denied") return [];
    throw err;
  }
}

/**
 * `shiftTemplates` is manager-only to READ, same as `varianceApprovals`
 * (see that function's own comment) — and for the exact same reason,
 * this must swallow `permission-denied` rather than let it take down
 * `fetchAppData`'s whole Promise.all for every non-manager session.
 * Real bug this codebase already shipped once (see CLAUDE.md's "My
 * Schedule" section) — not repeating it here.
 */
async function getAllShiftTemplates(): Promise<ShiftTemplate[]> {
  try {
    const snap = await getDocs(shiftTemplatesCol());
    return snap.docs.map(d => d.data() as ShiftTemplate);
  } catch (err: any) {
    if (err?.code === "permission-denied") return [];
    throw err;
  }
}

export async function fetchAppData(): Promise<AppData> {
  const restoSnap = await getDoc(restoRef());

  // No auto-seeding anymore: with arbitrary slugs, a mistyped URL must
  // fail loudly (RESTAURANT_NOT_FOUND) rather than silently spinning up
  // a blank restaurant. Real provisioning happens via the Stripe webhook
  // / seed-manager script, not on first page load.
  if (!restoSnap.exists()) {
    throw new Error("RESTAURANT_NOT_FOUND");
  }

  const restoData = restoSnap.data();

  // A blocked tenant's subcollections are denied by security rules, so
  // fetching them here would reject the Promise.all below and surface as
  // the generic "failed to load" error screen — which renders BEFORE the
  // trial-expired/paused branches in App.tsx and would therefore hide the
  // block screen (and with it the reactivation sign-in / paused notice)
  // behind a dead end. The blocked screens read none of this data, so
  // skip it entirely. isBlockedStatus() is the single source of truth for
  // this — see its own comment for why (a real bug shipped from this
  // exact check being duplicated by hand and only one copy updated).
  const blocked = isBlockedStatus(restoData.subscriptionStatus);
  const [entries, advances, scheduledShifts, activeClockIns, announcements, messages, timeOffRequests, swapRequests, varianceApprovals, shiftTemplates] = blocked
    ? [[], [], [], [], [], [], [], [], [], []] as [
        HourEntry[], CashAdvance[], ScheduledShift[], ActiveClockIn[],
        Announcement[], PrivateMessage[], TimeOffRequest[], SwapRequest[], VarianceApproval[], ShiftTemplate[],
      ]
    : await Promise.all([
        getAllEntries(),
        getAllAdvances(),
        getAllScheduledShifts(),
        getAllActiveClockIns(),
        getAllAnnouncements(),
        getAllMessages(),
        getAllTimeOffRequests(),
        getAllSwapRequests(),
        getAllVarianceApprovals(),
        getAllShiftTemplates(),
      ]);

  return {
    config: { ...DEFAULT_CONFIG, ...restoData.config },
    staff: restoData.staff ?? DEFAULT_STAFF,
    dayNotes: restoData.dayNotes ?? {},
    weekNotes: restoData.weekNotes ?? {},
    revenueByWeek: restoData.revenueByWeek ?? {},
    entries,
    advances,
    scheduledShifts,
    activeClockIns,
    announcements,
    messages,
    timeOffRequests,
    swapRequests,
    varianceApprovals,
    shiftTemplates,
    suspended: restoData.suspended === true,
    subscriptionStatus: restoData.subscriptionStatus,
    trialExpiredAt: restoData.trialExpiredAt,
    lastActiveAt: restoData.lastActiveAt,
    managerEmails: restoData.managerEmails ?? [],
    logoUrl: restoData.logoUrl,
    logoConsentGiven: restoData.logoConsentGiven,
    logoConsentAt: restoData.logoConsentAt,
    logoApprovalStatus: restoData.logoApprovalStatus,
  };
}

export async function saveConfig(config: Partial<GeneralConfig>): Promise<GeneralConfig> {
  const current = (await getDoc(restoRef())).data()?.config;
  const merged = { ...current, ...config };
  await updateDoc(restoRef(), { config: merged });
  return merged;
}

export async function saveStaff(staff: StaffMember[]): Promise<StaffMember[]> {
  await updateDoc(restoRef(), { staff });
  return staff;
}

export async function saveEntry(entry: HourEntry): Promise<HourEntry[]> {
  // Mirror the old upsert rule: match on id first, otherwise on
  // (name + date) so a staff correction overwrites the same day
  // instead of creating a duplicate row.
  const byNameDate = await getDocs(
    query(entriesCol(), where("name", "==", entry.name), where("date", "==", entry.date), limit(1))
  );

  const targetRef = !byNameDate.empty
    ? byNameDate.docs[0].ref
    : doc(entriesCol(), String(entry.id));

  await setDoc(targetRef, entry);
  return getAllEntries();
}

export async function deleteEntry(id: number): Promise<HourEntry[]> {
  await deleteDoc(doc(entriesCol(), String(id)));
  return getAllEntries();
}

export async function approveAllEntries(): Promise<HourEntry[]> {
  const snap = await getDocs(
    query(entriesCol(), where("status", "in", ["pending", "correction"]))
  );
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { status: "approved" }));
  await batch.commit();
  return getAllEntries();
}

export async function approveEntriesByRole(role: string): Promise<HourEntry[]> {
  const restoSnap = await getDoc(restoRef());
  const staff: StaffMember[] = restoSnap.data()?.staff ?? [];
  const namesForRole = new Set(staff.filter(s => s.role === role).map(s => s.name));

  const snap = await getDocs(query(entriesCol(), where("status", "==", "pending")));
  const batch = writeBatch(db);
  snap.docs.forEach(d => {
    const e = d.data() as HourEntry;
    if (namesForRole.has(e.name)) batch.update(d.ref, { status: "approved" });
  });
  await batch.commit();
  return getAllEntries();
}

export async function saveAdvance(advance: CashAdvance): Promise<CashAdvance[]> {
  await setDoc(doc(advancesCol(), advance.id), advance);
  return getAllAdvances();
}

export async function deleteAdvance(id: string): Promise<CashAdvance[]> {
  await deleteDoc(doc(advancesCol(), id));
  return getAllAdvances();
}

export async function saveDayNote(date: string, note: string): Promise<Record<string, string>> {
  const restoSnap = await getDoc(restoRef());
  const dayNotes = { ...(restoSnap.data()?.dayNotes ?? {}) };
  if (note.trim()) {
    dayNotes[date] = note;
  } else {
    delete dayNotes[date];
  }
  await updateDoc(restoRef(), { dayNotes });
  return dayNotes;
}

export async function saveWeekNote(key: string, note: string): Promise<Record<string, string>> {
  const restoSnap = await getDoc(restoRef());
  const weekNotes = { ...(restoSnap.data()?.weekNotes ?? {}) };
  if (note.trim()) {
    weekNotes[key] = note;
  } else {
    delete weekNotes[key];
  }
  await updateDoc(restoRef(), { weekNotes });
  return weekNotes;
}

export async function saveWeekRevenue(key: string, amount: number): Promise<Record<string, number>> {
  const restoSnap = await getDoc(restoRef());
  const revenueByWeek = { ...(restoSnap.data()?.revenueByWeek ?? {}) };
  if (amount > 0) {
    revenueByWeek[key] = amount;
  } else {
    delete revenueByWeek[key];
  }
  await updateDoc(restoRef(), { revenueByWeek });
  return revenueByWeek;
}

export async function clockIn(name: string, flagged: boolean, note: string): Promise<ActiveClockIn[]> {
  const entry: ActiveClockIn = { name, clockInAt: new Date().toISOString(), flagged, note };
  await setDoc(doc(activeClockInsCol(), name), entry);
  return getAllActiveClockIns();
}

export async function cancelClockIn(name: string): Promise<ActiveClockIn[]> {
  await deleteDoc(doc(activeClockInsCol(), name));
  return getAllActiveClockIns();
}

/**
 * Clocks a staff member out: computes the elapsed shift, folds it into
 * today's HourEntry (appending a second shift if they already clocked
 * in/out earlier today — same "split shift" model as manual entry), and
 * removes the active clock-in record.
 */
export async function clockOut(name: string): Promise<{ entries: HourEntry[]; activeClockIns: ActiveClockIn[] }> {
  const activeRef = doc(activeClockInsCol(), name);
  const activeSnap = await getDoc(activeRef);
  if (!activeSnap.exists()) {
    throw new Error("No active clock-in found for " + name);
  }
  const active = activeSnap.data() as ActiveClockIn;

  const clockInDate = new Date(active.clockInAt);
  const now = new Date();
  const hours = Math.max(0, (now.getTime() - clockInDate.getTime()) / (1000 * 60 * 60));
  const pad = (n: number) => String(n).padStart(2, "0");
  const newShift: Shift = {
    startTime: `${pad(clockInDate.getHours())}:${pad(clockInDate.getMinutes())}`,
    endTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    hours: Math.round(hours * 100) / 100,
    overnight: now.toDateString() !== clockInDate.toDateString(),
  };

  const todayStr = `${clockInDate.getFullYear()}-${pad(clockInDate.getMonth() + 1)}-${pad(clockInDate.getDate())}`;

  const existing = await getDocs(
    query(entriesCol(), where("name", "==", name), where("date", "==", todayStr), limit(1))
  );

  const restoSnap = await getDoc(restoRef());
  const isPending = restoSnap.data()?.config?.approval_required ?? true;

  if (!existing.empty) {
    const existingEntry = existing.docs[0].data() as HourEntry;
    const shifts = [...existingEntry.shifts, newShift];
    const updated: HourEntry = {
      ...existingEntry,
      shifts,
      hours: shifts.reduce((s, sh) => s + sh.hours, 0),
      endTime: newShift.endTime,
      flagged: existingEntry.flagged || active.flagged,
      status: existingEntry.status === "approved" ? existingEntry.status : (isPending ? "pending" : "approved"),
    };
    await setDoc(existing.docs[0].ref, updated);
  } else {
    const newEntry: HourEntry = {
      id: Date.now(),
      name,
      date: todayStr,
      type: "worked",
      hours: newShift.hours,
      shifts: [newShift],
      startTime: newShift.startTime,
      endTime: newShift.endTime,
      note: active.note ?? "",
      submittedAt: new Date().toISOString(),
      status: isPending ? "pending" : "approved",
      flagged: active.flagged,
    };
    await setDoc(doc(entriesCol(), String(newEntry.id)), newEntry);
  }

  await deleteDoc(activeRef);

  const [entries, activeClockIns] = await Promise.all([getAllEntries(), getAllActiveClockIns()]);
  return { entries, activeClockIns };
}

export async function clearAllData(): Promise<Pick<AppData, "entries" | "advances" | "dayNotes" | "weekNotes" | "scheduledShifts" | "activeClockIns" | "announcements" | "messages" | "timeOffRequests" | "swapRequests">> {
  const [entriesSnap, advancesSnap, scheduleSnap, clockInsSnap, announceSnap, msgSnap, timeOffSnap, swapSnap] = await Promise.all([
    getDocs(entriesCol()), getDocs(advancesCol()), getDocs(scheduleCol()), getDocs(activeClockInsCol()),
    getDocs(announcementsCol()), getDocs(messagesCol()), getDocs(timeOffCol()), getDocs(swapCol()),
  ]);
  const batch = writeBatch(db);
  entriesSnap.docs.forEach(d => batch.delete(d.ref));
  advancesSnap.docs.forEach(d => batch.delete(d.ref));
  scheduleSnap.docs.forEach(d => batch.delete(d.ref));
  clockInsSnap.docs.forEach(d => batch.delete(d.ref));
  announceSnap.docs.forEach(d => batch.delete(d.ref));
  msgSnap.docs.forEach(d => batch.delete(d.ref));
  timeOffSnap.docs.forEach(d => batch.delete(d.ref));
  swapSnap.docs.forEach(d => batch.delete(d.ref));
  batch.update(restoRef(), { dayNotes: {}, weekNotes: {} });
  await batch.commit();
  return {
    entries: [], advances: [], dayNotes: {}, weekNotes: {}, scheduledShifts: [], activeClockIns: [],
    announcements: [], messages: [], timeOffRequests: [], swapRequests: [],
  };
}

export async function saveScheduledShift(shift: ScheduledShift): Promise<ScheduledShift[]> {
  await setDoc(doc(scheduleCol(), shift.id), shift);
  return getAllScheduledShifts();
}

export async function deleteScheduledShift(id: string): Promise<ScheduledShift[]> {
  await deleteDoc(doc(scheduleCol(), id));
  return getAllScheduledShifts();
}

// ── SHIFT TEMPLATES (Phase D) ────────────────────────────────────────
// Manager-saved reusable shift shapes for the tray under the Rota
// Planner. A template is never consumed by use — dragging it only reads
// its label/startTime/endTime/role to stamp a new ScheduledShift via
// saveScheduledShift() above, the same function a manually-added shift
// uses. See ShiftTemplate's own doc comment in types.ts.

export async function saveShiftTemplate(template: ShiftTemplate): Promise<ShiftTemplate[]> {
  await setDoc(doc(shiftTemplatesCol(), template.id), template);
  return getAllShiftTemplates();
}

export async function deleteShiftTemplate(id: string): Promise<ShiftTemplate[]> {
  await deleteDoc(doc(shiftTemplatesCol(), id));
  return getAllShiftTemplates();
}

// ── ANNOUNCEMENTS (manager -> everyone, read-only for staff) ──────────

export async function postAnnouncement(message: string): Promise<Announcement[]> {
  const announcement: Announcement = { id: String(Date.now()), message, postedAt: new Date().toISOString() };
  await setDoc(doc(announcementsCol(), announcement.id), announcement);
  return getAllAnnouncements();
}

export async function deleteAnnouncement(id: string): Promise<Announcement[]> {
  await deleteDoc(doc(announcementsCol(), id));
  return getAllAnnouncements();
}

// ── PRIVATE MESSAGES (one thread per staff member, manager <-> staff) ──

export async function sendMessage(staffName: string, from: "manager" | "staff", text: string): Promise<PrivateMessage[]> {
  const message: PrivateMessage = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), staffName, from, text, sentAt: new Date().toISOString() };
  await setDoc(doc(messagesCol(), message.id), message);
  return getAllMessages();
}

/**
 * Marks a thread's incoming messages as read. `viewerRole` is who's
 * opening the thread right now — marks every message from the OTHER
 * party that doesn't already have `readAt`. Bug this fixes: "unread"
 * used to be inferred from "who sent the last message" (from !== me),
 * which never cleared once the reader viewed but didn't reply — the dot
 * stayed on indefinitely. This is the real read receipt.
 */
export async function markThreadRead(staffName: string, viewerRole: "manager" | "staff"): Promise<PrivateMessage[]> {
  const otherParty = viewerRole === "manager" ? "staff" : "manager";
  const snap = await getDocs(
    query(messagesCol(), where("staffName", "==", staffName), where("from", "==", otherParty))
  );
  const unread = snap.docs.filter(d => !(d.data() as PrivateMessage).readAt);
  if (unread.length > 0) {
    const batch = writeBatch(db);
    const readAt = new Date().toISOString();
    unread.forEach(d => batch.update(d.ref, { readAt }));
    await batch.commit();
  }
  return getAllMessages();
}

// ── TIME OFF REQUESTS ───────────────────────────────────────────────

export async function requestTimeOff(staffName: string, startDate: string, endDate: string, reason: string): Promise<TimeOffRequest[]> {
  const request: TimeOffRequest = {
    id: String(Date.now()), staffName, startDate, endDate, reason,
    status: "pending", requestedAt: new Date().toISOString(),
  };
  await setDoc(doc(timeOffCol(), request.id), request);
  return getAllTimeOffRequests();
}

/**
 * Approves or denies a time-off request. On approval, auto-generates
 * "absent" entries for every day in the range — so Stats/Payroll/Roster
 * only ever have to know about one absence system (entries), not two.
 */
export async function decideTimeOffRequest(id: string, approve: boolean): Promise<{ timeOffRequests: TimeOffRequest[]; entries: HourEntry[] }> {
  const reqRef = doc(timeOffCol(), id);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Time-off request not found");
  const request = reqSnap.data() as TimeOffRequest;

  await setDoc(reqRef, { ...request, status: approve ? "approved" : "denied", decidedAt: new Date().toISOString() });

  if (approve) {
    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    let cursor = new Date(start);
    let i = 0;
    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const existing = await getDocs(
        query(entriesCol(), where("name", "==", request.staffName), where("date", "==", dateStr), limit(1))
      );
      const entry: HourEntry = {
        id: Date.now() + i,
        name: request.staffName,
        date: dateStr,
        type: "absent",
        hours: 0,
        shifts: [],
        startTime: null,
        endTime: null,
        note: request.reason || "Time off",
        submittedAt: new Date().toISOString(),
        status: "approved",
      };
      const targetRef = !existing.empty ? existing.docs[0].ref : doc(entriesCol(), String(entry.id));
      await setDoc(targetRef, entry);
      cursor.setDate(cursor.getDate() + 1);
      i++;
    }
  }

  const [timeOffRequests, entries] = await Promise.all([getAllTimeOffRequests(), getAllEntries()]);
  return { timeOffRequests, entries };
}

// ── SWAP / COVER REQUESTS (open model) ─────────────────────────────

export async function saveTimeOffNote(id: string, note: string): Promise<TimeOffRequest[]> {
  await updateDoc(doc(timeOffCol(), id), { managerNote: note });
  return getAllTimeOffRequests();
}

export async function saveSwapNote(id: string, note: string): Promise<SwapRequest[]> {
  await updateDoc(doc(swapCol(), id), { managerNote: note });
  return getAllSwapRequests();
}

export async function requestSwap(shift: ScheduledShift, reason: string): Promise<SwapRequest[]> {
  const request: SwapRequest = {
    id: String(Date.now()), shiftId: shift.id, originalStaff: shift.name, date: shift.date,
    startTime: shift.startTime, endTime: shift.endTime, role: shift.role, reason,
    status: "open", requestedAt: new Date().toISOString(),
  };
  await setDoc(doc(swapCol(), request.id), request);
  return getAllSwapRequests();
}

export async function claimSwap(id: string, claimant: string): Promise<SwapRequest[]> {
  const reqRef = doc(swapCol(), id);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Swap request not found");
  const request = reqSnap.data() as SwapRequest;
  await setDoc(reqRef, { ...request, status: "claimed", claimedBy: claimant, claimedAt: new Date().toISOString() });
  return getAllSwapRequests();
}

export async function cancelSwapClaim(id: string): Promise<SwapRequest[]> {
  const reqRef = doc(swapCol(), id);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Swap request not found");
  const request = reqSnap.data() as SwapRequest;
  const { claimedBy, claimedAt, ...rest } = request;
  await setDoc(reqRef, { ...rest, status: "open" });
  return getAllSwapRequests();
}

/**
 * Manager's final call on a claimed swap. On approval, the underlying
 * ScheduledShift is reassigned to the claimant.
 */
export async function decideSwap(id: string, approve: boolean): Promise<{ swapRequests: SwapRequest[]; scheduledShifts: ScheduledShift[] }> {
  const reqRef = doc(swapCol(), id);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Swap request not found");
  const request = reqSnap.data() as SwapRequest;

  await setDoc(reqRef, { ...request, status: approve ? "approved" : "denied", decidedAt: new Date().toISOString() });

  if (approve && request.claimedBy) {
    const shiftRef = doc(scheduleCol(), request.shiftId);
    const shiftSnap = await getDoc(shiftRef);
    if (shiftSnap.exists()) {
      await updateDoc(shiftRef, { name: request.claimedBy });
    }
  }

  const [swapRequests, scheduledShifts] = await Promise.all([getAllSwapRequests(), getAllScheduledShifts()]);
  return { swapRequests, scheduledShifts };
}

// ── VARIANCE APPROVALS (Phase B) ────────────────────────────────────
// Only the human approval DECISION is ever persisted here — the variance
// numbers themselves are always recomputed live from entries +
// scheduledShifts via src/utils/variance.ts. See VarianceApproval's own
// doc comment in types.ts.

/**
 * Approves one employee's one day of variance, with an optional note.
 * Upsert by construction: writing the deterministic (date, name) doc id
 * again (e.g. re-approving after a note edit) just overwrites it.
 */
export async function approveVarianceDay(name: string, date: string, note?: string): Promise<VarianceApproval[]> {
  const approval: VarianceApproval = {
    name,
    date,
    approvedBy: auth.currentUser?.email || auth.currentUser?.uid || "unknown",
    approvedAt: new Date().toISOString(),
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
  await setDoc(doc(varianceApprovalsCol(), varianceApprovalId(date, name)), approval);
  return getAllVarianceApprovals();
}

/** Bulk "approve all remaining pending" for one employee — caller (the
 * UI, via aggregateMonthlyVariance) supplies exactly the dates that are
 * currently pending for that employee+month; this just writes them all
 * in one batch rather than recomputing which days qualify. */
export async function approveAllRemainingVariance(name: string, dates: readonly string[]): Promise<VarianceApproval[]> {
  const approvedBy = auth.currentUser?.email || auth.currentUser?.uid || "unknown";
  const approvedAt = new Date().toISOString();
  const batch = writeBatch(db);
  dates.forEach(date => {
    const approval: VarianceApproval = { name, date, approvedBy, approvedAt };
    batch.set(doc(varianceApprovalsCol(), varianceApprovalId(date, name)), approval);
  });
  await batch.commit();
  return getAllVarianceApprovals();
}

/**
 * Deletes a day's approval record, reverting it to pending. Called
 * whenever that day's underlying hours are edited (see ManagerDashboard's
 * saveInlineEdit) so an approval can never silently keep applying to
 * numbers that have since changed. Safe to call unconditionally — deleting
 * a doc that doesn't exist (the common case: most edited days were never
 * approved) is a no-op, not an error.
 */
export async function invalidateVarianceApproval(name: string, date: string): Promise<void> {
  await deleteDoc(doc(varianceApprovalsCol(), varianceApprovalId(date, name)));
}

/**
 * Permanently deletes a former staff member's record AND all their
 * historical hours/advances. This is real erasure, not archiving —
 * the UI only exposes this once a manager-side retention check confirms
 * their last activity was more than 5 years ago. That check lives in
 * ManagerDashboard, not here; this function trusts the caller.
 */
export async function deleteStaffMemberData(name: string): Promise<{ staff: StaffMember[]; entries: HourEntry[]; advances: CashAdvance[] }> {
  const restoSnap = await getDoc(restoRef());
  const staff = ((restoSnap.data()?.staff || []) as StaffMember[]).filter(s => s.name !== name);
  await updateDoc(restoRef(), { staff });

  const [entriesToDelete, advancesToDelete] = await Promise.all([
    getDocs(query(entriesCol(), where("name", "==", name))),
    getDocs(query(advancesCol(), where("name", "==", name))),
  ]);
  const batch = writeBatch(db);
  entriesToDelete.docs.forEach(d => batch.delete(d.ref));
  advancesToDelete.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();

  const [entries, advances] = await Promise.all([getAllEntries(), getAllAdvances()]);
  return { staff, entries, advances };
}

// ── RESTAURANT LOGO (upload, consent, public carousel) ──────────────
// See ApprovedLogo's doc comment in types.ts for why the public-facing
// read goes through a separate `approvedLogos` collection rather than a
// query against `restaurants` directly.

/**
 * Uploads a manager's logo file to Storage and records it on the tenant
 * doc, along with the consent decision. `consentGiven` MUST be true — the
 * UI's checkbox is the only path to true, but this is checked here too
 * so a future call site can't accidentally skip it. Always starts at
 * logoApprovalStatus "pending": uploading is never itself publication,
 * see the admin approval gate (adminSetLogoApproval, functions/).
 *
 * Storage path is keyed by the UPLOADER'S OWN UID (`logos/{uid}/...`),
 * not the restaurant slug — see storage.rules' own comment for why: a
 * cross-service Storage-Rules-to-Firestore isManagerOf() check proved
 * unreliable in the local emulator, so the uid-keyed path (which needs
 * no cross-service call to secure) is used instead. The actual
 * restaurant association happens right below, in the Firestore write —
 * an ordinary isManagerOf()-gated update, the same proven rule every
 * other manager-only field on this doc already relies on.
 */
export async function uploadRestaurantLogo(file: File, consentGiven: boolean): Promise<string> {
  if (!consentGiven) {
    throw new Error("Cannot upload a logo without consent to display it on the marketing site.");
  }
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("Must be signed in as a manager to upload a logo.");
  }
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `logos/${uid}/logo-${Date.now()}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const logoUrl = await getDownloadURL(storageRef);

  await updateDoc(restoRef(), {
    logoUrl,
    logoConsentGiven: true,
    logoConsentAt: new Date().toISOString(),
    logoApprovalStatus: "pending",
  });

  return logoUrl;
}

/** Public: every approved logo, for the Landing page carousel. No auth
 * required — `approvedLogos` is `allow read: if true` by design (see
 * types.ts), and this is the ONLY function that reads it. */
export async function getApprovedLogos(): Promise<ApprovedLogo[]> {
  const snap = await getDocs(collection(db, "approvedLogos"));
  return snap.docs.map(d => d.data() as ApprovedLogo);
}
