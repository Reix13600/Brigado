import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, limit, writeBatch,
} from "firebase/firestore";
import { db, getRestaurantId } from "../firebase";
import { defaultComplianceRules } from "./compliance";
import {
  AppData, GeneralConfig, StaffMember, HourEntry, CashAdvance, ScheduledShift, ActiveClockIn, Shift,
  Announcement, PrivateMessage, TimeOffRequest, SwapRequest,
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

const DEFAULT_CONFIG: GeneralConfig = {
  resto_name: "La Vague",
  manager_pin: "1234",
  overtime_limit: 35,
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
  const [entries, advances, scheduledShifts, activeClockIns, announcements, messages, timeOffRequests, swapRequests] = await Promise.all([
    getAllEntries(),
    getAllAdvances(),
    getAllScheduledShifts(),
    getAllActiveClockIns(),
    getAllAnnouncements(),
    getAllMessages(),
    getAllTimeOffRequests(),
    getAllSwapRequests(),
  ]);

  return {
    config: { ...DEFAULT_CONFIG, ...restoData.config },
    staff: restoData.staff ?? DEFAULT_STAFF,
    dayNotes: restoData.dayNotes ?? {},
    weekNotes: restoData.weekNotes ?? {},
    entries,
    advances,
    scheduledShifts,
    activeClockIns,
    announcements,
    messages,
    timeOffRequests,
    swapRequests,
    suspended: restoData.suspended === true,
    managerEmails: restoData.managerEmails ?? [],
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
