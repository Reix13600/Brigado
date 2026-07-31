import React, { useState, useEffect, useRef } from "react";
import { AppData, HourEntry, Shift, EntryType, CashAdvance } from "../types";
import { getFrenchHoliday } from "../utils/holidays";
import { getRoleColor } from "../utils/roleColors";
import { getTranslation, LangType } from "../utils/translations";
import { saveEntry, saveDayNote, deleteEntry, clockIn, clockOut, cancelClockIn, sendMessage, requestTimeOff, requestSwap, claimSwap, cancelSwapClaim } from "../utils/api";
import { 
  User, Calendar, Clock, CheckCircle2, AlertTriangle, ShieldAlert,
  ArrowRight, Check, X, Clipboard, ArrowLeft, RefreshCw, Eye, EyeOff, LogIn, LogOut
} from "lucide-react";

interface StaffDashboardProps {
  appData: AppData;
  lang: LangType;
  setLang: (lang: LangType) => void;
  onRefresh: () => void;
  theme?: "light" | "dark";
  qrSessionAt: number | null;
}

export default function StaffDashboard({ appData, lang, setLang, onRefresh, theme = "dark", qrSessionAt }: StaffDashboardProps) {
  const t = (k: string, vars?: Record<string, any>) => getTranslation(lang, k, vars);

  // True when this session either never opened via the printed QR link,
  // or opened more than 3 minutes ago. Manager-only signal — staff never
  // see this, it just quietly tags the entry.
  const isFlaggedNow = () => qrSessionAt === null || (Date.now() - qrSessionAt) > 3 * 60 * 1000;

  // Live clock in/out
  const [clockNowTick, setClockNowTick] = useState<number>(Date.now());
  const [clockingBusy, setClockingBusy] = useState<boolean>(false);
  const [clockNote, setClockNote] = useState<string>("");
  useEffect(() => {
    const interval = setInterval(() => setClockNowTick(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  // Form states
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [shiftType, setShiftType] = useState<EntryType>("worked");
  const [note, setNote] = useState<string>("");
  
  // Shift times
  const [s1StartH, setS1StartH] = useState<number>(9);
  const [s1StartM, setS1StartM] = useState<number>(0);
  const [s1EndH, setS1EndH] = useState<number>(15);
  const [s1EndM, setS1EndM] = useState<number>(30);
  
  const [splitActive, setSplitActive] = useState<boolean>(false);
  const [s2StartH, setS2StartH] = useState<number>(19);
  const [s2StartM, setS2StartM] = useState<number>(0);
  const [s2EndH, setS2EndH] = useState<number>(23);
  const [s2EndM, setS2EndM] = useState<number>(0);

  // Security & PIN verification
  const [unlockedStaff, setUnlockedStaff] = useState<string | null>(null);
  const [pinBuffer, setPinBuffer] = useState<string>("");
  const [pinModalStaff, setPinModalStaff] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string>("");
  const [isPinShaking, setIsPinShaking] = useState<boolean>(false);

  // Submission / success screens
  const [submittedEntry, setSubmittedEntry] = useState<HourEntry | null>(null);
  const [submitting, setSubmitted] = useState<boolean>(false);

  // Correction request states
  const [correctionTargetId, setCorrectionTargetId] = useState<number | null>(null);
  const [correctionNote, setCorrectionNote] = useState<string>("");
  const [correctionModalOpen, setCorrectionModalOpen] = useState<boolean>(false);
  const [showOlderDayPicker, setShowOlderDayPicker] = useState<boolean>(false);

  // Initialize date to today's local date
  useEffect(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    setSelectedDate(`${y}-${m}-${d}`);
  }, []);

  const staffList = appData.staff.filter(s => s.active !== false);
  const config = appData.config;
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  // Pre-fill the time pickers from the Rota Planner's scheduled shift for
  // this day, if one exists — staff just adjusts if reality differed,
  // instead of scrolling through pickers from scratch every time.
  useEffect(() => {
    if (!selectedStaff || !selectedDate || shiftType !== "worked") return;
    const dayShift = (appData.scheduledShifts || []).find(s => s.name === selectedStaff && s.date === selectedDate);
    if (!dayShift) return;
    const [startH, startM] = dayShift.startTime.split(":").map(Number);
    const [endH, endM] = dayShift.endTime.split(":").map(Number);
    if (!isNaN(startH)) { setS1StartH(startH); setS1StartM(startM || 0); }
    if (!isNaN(endH)) { setS1EndH(endH); setS1EndM(endM || 0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStaff, selectedDate, shiftType]);

  const handleSelectStaff = (name: string) => {
    const staffMember = staffList.find(s => s.name === name);
    if (!staffMember) return;

    if (staffMember.pin && unlockedStaff !== name) {
      setPinModalStaff(name);
      setPinBuffer("");
      setPinError("");
    } else {
      setSelectedStaff(name);
    }
  };

  const handlePinKey = (digit: string) => {
    if (!pinModalStaff) return;
    const staffMember = staffList.find(s => s.name === pinModalStaff);
    const requiredLen = staffMember?.pin.length || 4;
    
    if (pinBuffer.length >= requiredLen) return;
    const newBuf = pinBuffer + digit;
    setPinBuffer(newBuf);

    if (newBuf.length === requiredLen) {
      // Auto-validate
      setTimeout(() => {
        if (newBuf === staffMember?.pin) {
          setUnlockedStaff(pinModalStaff);
          setSelectedStaff(pinModalStaff);
          setPinModalStaff(null);
          setPinBuffer("");
        } else {
          setIsPinShaking(true);
          setPinError(t("incorrectPin"));
          setTimeout(() => {
            setIsPinShaking(false);
            setPinBuffer("");
          }, 400);
        }
      }, 100);
    }
  };

  const handlePinBackspace = () => {
    if (pinBuffer.length > 0) {
      setPinBuffer(pinBuffer.slice(0, -1));
    }
  };

  const handleCancelPin = () => {
    setPinModalStaff(null);
    setPinBuffer("");
    setPinError("");
  };

  // Helper calculations
  const calcShiftMins = (sh: number, sm: number, eh: number, em: number) => {
    const start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end <= start) end += 24 * 60; // overnight
    return end - start;
  };

  const minsToObj = (sh: number, sm: number, eh: number, em: number): Shift => {
    const mins = calcShiftMins(sh, sm, eh, em);
    const overnight = eh * 60 + em <= sh * 60 + sm;
    return {
      startTime: String(sh).padStart(2, "0") + ":" + String(sm).padStart(2, "0"),
      endTime: String(eh).padStart(2, "0") + ":" + String(em).padStart(2, "0"),
      hours: Math.round((mins / 60) * 100) / 100,
      overnight
    };
  };

  const s1 = minsToObj(s1StartH, s1StartM, s1EndH, s1EndM);
  const s2 = minsToObj(s2StartH, s2StartM, s2EndH, s2EndM);
  const shifts: Shift[] = splitActive ? [s1, s2] : [s1];
  const totalHours = shiftType === "worked" ? shifts.reduce((sum, s) => sum + s.hours, 0) : 0;

  // Retrieve hours worked this week for contract utilisation
  const getWeekHours = (name: string, excludeDate?: string) => {
    if (!selectedDate) return 0;
    const refDate = new Date(selectedDate);
    const day = refDate.getDay() || 7; // Monday-first
    const ws = new Date(refDate);
    ws.setDate(refDate.getDate() - day + 1);
    ws.setHours(0, 0, 0, 0);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    we.setHours(23, 59, 59, 999);

    return appData.entries
      .filter(e => e.name === name && e.type === "worked" && e.status !== "pending" && e.date !== excludeDate)
      .filter(e => {
        const d = new Date(e.date);
        return d >= ws && d <= we;
      })
      .reduce((sum, e) => sum + e.hours, 0);
  };

  const getWeekDates = () => {
    const today = new Date();
    const day = today.getDay() || 7; // Monday = 1, Sunday = 7
    const monday = new Date(today);
    monday.setDate(today.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, "0");
      const dStr = String(d.getDate()).padStart(2, "0");
      dates.push({
        dateStr: `${yStr}-${mStr}-${dStr}`,
        label: t("days")[d.getDay()],
        num: d.getDate()
      });
    }
    return dates;
  };

  const currentWeekHours = selectedStaff ? getWeekHours(selectedStaff, selectedDate) : 0;
  const projectedTotalWeekHours = currentWeekHours + totalHours;
  const contractHours = selectedStaff ? (appData.staff.find(s => s.name === selectedStaff)?.contract || config.overtime_limit) : config.overtime_limit;
  const overWeeklyLimit = projectedTotalWeekHours > contractHours;

  const handleSubmit = async () => {
    if (!selectedStaff || !selectedDate) return;

    const isPending = config.approval_required;
    const entry: HourEntry = {
      id: Date.now(),
      name: selectedStaff,
      date: selectedDate,
      type: shiftType,
      hours: totalHours,
      shifts: shiftType === "worked" ? shifts : [],
      startTime: shiftType === "worked" ? shifts[0].startTime : null,
      endTime: shiftType === "worked" ? shifts[shifts.length - 1].endTime : null,
      note: note,
      submittedAt: new Date().toISOString(),
      status: isPending ? "pending" : "approved",
      flagged: isFlaggedNow(),
    };

    setSubmitted(true);
    try {
      await saveEntry(entry);
      setSubmittedEntry(entry);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitted(false);
    }
  };

  const activeClockIn = selectedStaff
    ? appData.activeClockIns.find(a => a.name === selectedStaff) ?? null
    : null;

  const handleClockIn = async () => {
    if (!selectedStaff) return;
    setClockingBusy(true);
    try {
      await clockIn(selectedStaff, isFlaggedNow(), clockNote);
      setClockNote("");
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setClockingBusy(false);
    }
  };

  const handleClockOut = async () => {
    if (!selectedStaff) return;
    setClockingBusy(true);
    try {
      await clockOut(selectedStaff);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setClockingBusy(false);
    }
  };

  const handleCancelClockIn = async () => {
    if (!selectedStaff) return;
    setClockingBusy(true);
    try {
      await cancelClockIn(selectedStaff);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setClockingBusy(false);
    }
  };

  // Phase 3: My Space (messages / time off / cover requests)
  const [spaceView, setSpaceView] = useState<"messages" | "timeoff" | "cover" | null>(null);
  const [staffMessageDraft, setStaffMessageDraft] = useState<string>("");
  const [timeOffStart, setTimeOffStart] = useState<string>(todayStr);
  const [timeOffEnd, setTimeOffEnd] = useState<string>(todayStr);
  const [timeOffReason, setTimeOffReason] = useState<string>("");
  const [timeOffBusy, setTimeOffBusy] = useState<boolean>(false);
  const [coverBusyId, setCoverBusyId] = useState<string | null>(null);
  const [coverReasonDraft, setCoverReasonDraft] = useState<Record<string, string>>({});
  const [showUpcomingShifts, setShowUpcomingShifts] = useState<boolean>(false);

  const handleSendStaffMessage = async () => {
    if (!selectedStaff || !staffMessageDraft.trim()) return;
    try {
      await sendMessage(selectedStaff, "staff", staffMessageDraft.trim());
      setStaffMessageDraft("");
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRequestTimeOff = async () => {
    if (!selectedStaff || !timeOffStart || !timeOffEnd) return;
    setTimeOffBusy(true);
    try {
      await requestTimeOff(selectedStaff, timeOffStart, timeOffEnd, timeOffReason.trim());
      setTimeOffReason("");
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setTimeOffBusy(false);
    }
  };

  const handleRequestCover = async (shift: import("../types").ScheduledShift) => {
    setCoverBusyId(shift.id);
    try {
      await requestSwap(shift, coverReasonDraft[shift.id]?.trim() || "");
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setCoverBusyId(null);
    }
  };

  const handleClaimCover = async (requestId: string) => {
    if (!selectedStaff) return;
    setCoverBusyId(requestId);
    try {
      await claimSwap(requestId, selectedStaff);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setCoverBusyId(null);
    }
  };

  const handleCancelCoverClaim = async (requestId: string) => {
    setCoverBusyId(requestId);
    try {
      await cancelSwapClaim(requestId);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setCoverBusyId(null);
    }
  };

  const handleOpenCorrection = (id: number) => {
    setCorrectionTargetId(id);
    setCorrectionNote("");
    setCorrectionModalOpen(true);
  };

  const handleSendCorrection = async () => {
    if (!correctionTargetId || !correctionNote.trim()) return;

    const matched = appData.entries.find(e => e.id === correctionTargetId);
    if (!matched) return;

    const updated: HourEntry = {
      ...matched,
      status: "correction",
      correctionNote: correctionNote,
      correctionAt: new Date().toISOString()
    };

    try {
      await saveEntry(updated);
      onRefresh();
      setCorrectionModalOpen(false);
      setCorrectionTargetId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReset = () => {
    setSelectedStaff(null);
    setShiftType("worked");
    setNote("");
    setSplitActive(false);
    setSubmittedEntry(null);
    setUnlockedStaff(null);
  };

  // Generate last 14 days buttons
  const dateScrollRef = useRef<HTMLDivElement>(null);
  const dayButtons = [];
  const today = new Date();
  
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const yStr = d.getFullYear();
    const mStr = String(d.getMonth() + 1).padStart(2, "0");
    const dStr = String(d.getDate()).padStart(2, "0");
    const dateKey = `${yStr}-${mStr}-${dStr}`;
    
    const dayLabel = i === 0 ? t("today") : i === 1 ? t("yesterday") : t("days")[d.getDay()];
    const monthLabel = d.getDate() + " " + t("months")[d.getMonth()].slice(0, 3);
    
    dayButtons.push({
      dateKey,
      dayLabel,
      monthLabel,
      isToday: i === 0
    });
  }

  // Find recent submissions & advances for verified staff
  const recentSubmissions = selectedStaff 
    ? appData.entries.filter(e => e.name === selectedStaff).sort((a,b) => b.id - a.id).slice(0, 5)
    : [];

  const staffAdvances = selectedStaff
    ? appData.advances.filter(a => a.name === selectedStaff).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const totalAdvances = staffAdvances.reduce((sum, a) => sum + a.amount, 0);

  return (
    <div className="max-w-md mx-auto w-full px-4 py-6" id="staff-app">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-lime-400/10 border border-lime-400/30 rounded-xl flex items-center justify-center text-lime-400 font-bold text-lg">
            🍽️
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{config.resto_name}</h2>
            <p className="text-xs text-slate-400">{t("staffHours")}</p>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-full p-1">
          <button 
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${lang === "fr" ? "bg-lime-400 text-slate-950" : "text-slate-400 hover:text-slate-100"}`}
            onClick={() => setLang("fr")}
          >
            FR
          </button>
          <button 
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${lang === "en" ? "bg-lime-400 text-slate-950" : "text-slate-400 hover:text-slate-100"}`}
            onClick={() => setLang("en")}
          >
            EN
          </button>
        </div>
      </div>

      {!submittedEntry ? (
        <div className="space-y-4 animate-fade-in">
          {/* WELCOME */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-100">
              {selectedStaff ? `Bonjour, ${selectedStaff.split(" ")[0]} 👋` : "Bonjour 👋"}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {new Date().toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>

          {/* STAFF SELECT */}
          <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-3">{t("whoAreYou")}</div>
            <div className="grid grid-cols-2 gap-2">
              {staffList.map(s => {
                const isSelected = selectedStaff === s.name;
                return (
                  <button
                    key={s.name}
                    className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all ${isSelected ? "bg-lime-400/10 border-lime-400 text-lime-400" : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"}`}
                    onClick={() => handleSelectStaff(s.name)}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedStaff && (
            <div className="space-y-4 animate-slide-up">
              {/* WEEK PROGRESS */}
              <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{t("yourHoursThisWeek")}</span>
                  <span className="font-mono text-xs font-semibold text-slate-200">
                    {currentWeekHours.toFixed(1)}h / {contractHours}h
                  </span>
                </div>
                <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-lime-400 transition-all duration-300" 
                    style={{ width: `${Math.min((currentWeekHours / contractHours) * 100, 100)}%` }}
                  />
                </div>
                {overWeeklyLimit && (
                  <p className="text-[11px] text-rose-400 mt-2 flex items-center gap-1">
                    <AlertTriangle size={12} /> {t("overWeeklyLimit", { limit: contractHours })}
                  </p>
                )}
              </div>

              {/* MY SPACE: messages / time off / cover requests */}
              {(() => {
                const myMessages = appData.messages.filter(m => m.staffName === selectedStaff);
                const lastMsg = [...myMessages].sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
                const hasUnread = lastMsg?.from === "manager";
                const myUpcomingShifts = (appData.scheduledShifts || [])
                  .filter(s => s.name === selectedStaff && s.date >= todayStr)
                  .sort((a, b) => a.date.localeCompare(b.date));
                const myOwnSwapIds = new Set(
                  appData.swapRequests.filter(r => r.originalStaff === selectedStaff).map(r => r.shiftId)
                );
                const myRole = appData.staff.find(s => s.name === selectedStaff)?.role;
                const claimableSwaps = appData.swapRequests.filter(
                  r => r.status === "open" && r.originalStaff !== selectedStaff && r.role === myRole
                );
                const myClaims = appData.swapRequests.filter(r => r.claimedBy === selectedStaff && r.status !== "denied");
                const myTimeOffRequests = appData.timeOffRequests.filter(r => r.staffName === selectedStaff);

                return (
                  <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl overflow-hidden">
                    <div className="grid grid-cols-3 border-b border-slate-800/80">
                      {([
                        ["messages", lang === "fr" ? "Messages" : "Messages", hasUnread],
                        ["timeoff", lang === "fr" ? "Congés" : "Time off", false],
                        ["cover", lang === "fr" ? "Services" : "Cover", claimableSwaps.length > 0],
                      ] as const).map(([key, label, alert]) => (
                        <button
                          key={key}
                          className={`relative py-3 text-xs font-semibold transition-all ${spaceView === key ? "bg-lime-400/10 text-lime-400" : "text-slate-400 hover:text-slate-200"}`}
                          onClick={() => setSpaceView(spaceView === key ? null : key)}
                        >
                          {label}
                          {alert && <span className="absolute top-1.5 right-1/4 w-1.5 h-1.5 bg-amber-400 rounded-full" />}
                        </button>
                      ))}
                    </div>

                    {spaceView === "messages" && (
                      <div className="p-4 space-y-3">
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {myMessages.length === 0 && (
                            <p className="text-xs text-slate-500 italic">{lang === "fr" ? "Pas encore de messages." : "No messages yet."}</p>
                          )}
                          {myMessages.map(m => (
                            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${m.from === "staff" ? "bg-lime-400/10 text-lime-300 ml-auto" : "bg-slate-800 text-slate-200"}`}>
                              {m.text}
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                            placeholder={lang === "fr" ? "Écrire au gérant..." : "Message the manager..."}
                            value={staffMessageDraft}
                            onChange={e => setStaffMessageDraft(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleSendStaffMessage()}
                          />
                          <button className="px-3 py-2 bg-lime-400 text-slate-950 font-bold rounded-xl text-xs" onClick={handleSendStaffMessage}>
                            {lang === "fr" ? "Envoyer" : "Send"}
                          </button>
                        </div>
                      </div>
                    )}

                    {spaceView === "timeoff" && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <input type="date" className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200" value={timeOffStart} onChange={e => setTimeOffStart(e.target.value)} />
                          <span className="text-slate-500">→</span>
                          <input type="date" className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200" value={timeOffEnd} onChange={e => setTimeOffEnd(e.target.value)} />
                        </div>
                        <input
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                          placeholder={lang === "fr" ? "Raison (optionnel)" : "Reason (optional)"}
                          value={timeOffReason}
                          onChange={e => setTimeOffReason(e.target.value)}
                        />
                        <button
                          className="w-full py-2.5 bg-lime-400 text-slate-950 font-bold rounded-xl text-xs disabled:opacity-50"
                          onClick={handleRequestTimeOff}
                          disabled={timeOffBusy}
                        >
                          {timeOffBusy ? "..." : (lang === "fr" ? "Demander ces congés" : "Request this time off")}
                        </button>
                        {myTimeOffRequests.length > 0 && (
                          <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
                            {myTimeOffRequests.map(r => (
                              <div key={r.id} className="flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-mono">{r.startDate} → {r.endDate}</span>
                                <span className={`font-semibold ${r.status === "approved" ? "text-lime-400" : r.status === "denied" ? "text-rose-400" : "text-amber-400"}`}>
                                  {r.status === "approved" ? (lang === "fr" ? "Approuvé" : "Approved") : r.status === "denied" ? (lang === "fr" ? "Refusé" : "Denied") : (lang === "fr" ? "En attente" : "Pending")}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {spaceView === "cover" && (
                      <div className="p-4 space-y-4">
                        {myUpcomingShifts.length > 0 && (
                          <div className="space-y-2">
                            <button
                              className="w-full flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-500 hover:text-slate-300 uppercase transition-all"
                              onClick={() => setShowUpcomingShifts(v => !v)}
                            >
                              <span>{lang === "fr" ? "Mes prochains services" : "My upcoming shifts"} ({myUpcomingShifts.length})</span>
                              <span>{showUpcomingShifts ? "▾" : "▸"}</span>
                            </button>
                            {showUpcomingShifts && myUpcomingShifts.map(s => {
                              const alreadyRequested = myOwnSwapIds.has(s.id);
                              const d = new Date(s.date + "T00:00:00");
                              const isWeekend = [0, 6].includes(d.getDay());
                              const dayName = d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "short" });
                              return (
                                <div key={s.id} className={`bg-slate-950/40 border rounded-xl p-3 space-y-2 ${isWeekend ? "border-sky-500/30" : "border-slate-800/60"}`}>
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-300 font-mono">
                                      <span className={isWeekend ? "text-sky-400 font-semibold" : ""}>{dayName}</span> {s.date} · {s.startTime}–{s.endTime}
                                    </span>
                                    {alreadyRequested ? (
                                      <span className="text-amber-400 text-[10px] font-semibold">{lang === "fr" ? "Demande envoyée" : "Cover requested"}</span>
                                    ) : (
                                      <button
                                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-semibold disabled:opacity-50"
                                        onClick={() => handleRequestCover(s)}
                                        disabled={coverBusyId === s.id}
                                      >
                                        {lang === "fr" ? "Demander une couverture" : "Request cover"}
                                      </button>
                                    )}
                                  </div>
                                  {!alreadyRequested && (
                                    <input
                                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-[10px] text-slate-300"
                                      placeholder={lang === "fr" ? "Raison (optionnel)" : "Reason (optional)"}
                                      value={coverReasonDraft[s.id] || ""}
                                      onChange={e => setCoverReasonDraft(prev => ({ ...prev, [s.id]: e.target.value }))}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {myClaims.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                              {lang === "fr" ? "Mes réclamations" : "My claims"}
                            </div>
                            {myClaims.map(r => (
                              <div key={r.id} className="flex items-center justify-between bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 text-xs">
                                <span className="text-slate-300 font-mono flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getRoleColor(r.role, theme) }} />
                                  {r.date} · {r.startTime}–{r.endTime} ({r.originalStaff})
                                </span>
                                {r.status === "claimed" ? (
                                  <button className="text-rose-400 text-[10px] font-semibold" onClick={() => handleCancelCoverClaim(r.id)} disabled={coverBusyId === r.id}>
                                    {lang === "fr" ? "Annuler" : "Cancel"}
                                  </button>
                                ) : (
                                  <span className="text-lime-400 text-[10px] font-semibold">{lang === "fr" ? "Approuvé" : "Approved"}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                            {lang === "fr" ? "Services à couvrir" : "Open cover requests"}
                          </div>
                          {claimableSwaps.length === 0 ? (
                            <p className="text-xs text-slate-500 italic">{lang === "fr" ? "Aucun pour le moment (aucun de votre poste)." : "None right now (none for your role)."}</p>
                          ) : (
                            claimableSwaps.map(r => {
                              const d = new Date(r.date + "T00:00:00");
                              const isWeekend = [0, 6].includes(d.getDay());
                              const dayName = d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "short" });
                              return (
                                <div key={r.id} className="flex items-center justify-between bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 text-xs">
                                  <span className="text-slate-300 font-mono flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getRoleColor(r.role, theme) }} />
                                    {r.originalStaff} · <span className={isWeekend ? "text-sky-400 font-semibold" : ""}>{dayName}</span> {r.date} · {r.startTime}–{r.endTime}
                                  </span>
                                  <button
                                    className="px-2.5 py-1 bg-lime-400/10 text-lime-400 hover:bg-lime-400/20 rounded-lg text-[10px] font-semibold disabled:opacity-50"
                                    onClick={() => handleClaimCover(r.id)}
                                    disabled={coverBusyId === r.id}
                                  >
                                    {lang === "fr" ? "Je le prends" : "I'll take it"}
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* MY WEEK — doubles as both the schedule display AND the day
                  selector (tap a tile to log hours for that day). This used
                  to be two separate, visually near-identical strips stacked
                  on top of each other; merged into one. */}
              {config.enable_scheduling ? (
                <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-800/50 pb-2">
                    <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1">
                      <Calendar size={12} className="text-lime-400" /> {lang === "fr" ? "Mon Planning Rota" : "My Weekly Rota"}
                    </span>
                    <span className="text-[9px] bg-lime-400/15 text-lime-400 px-1.5 py-0.5 rounded font-mono font-bold uppercase">
                      {lang === "fr" ? "Actif" : "Active"}
                    </span>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center">
                    {getWeekDates().map(day => {
                      const isToday = day.dateStr === todayStr;
                      const isSelected = day.dateStr === selectedDate;
                      const isPast = day.dateStr <= todayStr;
                      const isWeekend = [0, 6].includes(new Date(day.dateStr + "T00:00:00").getDay());
                      const dayShift = (appData.scheduledShifts || []).find(s => s.name === selectedStaff && s.date === day.dateStr);
                      const holiday = getFrenchHoliday(day.dateStr);
                      const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";
                      return (
                        <button
                          key={day.dateStr}
                          title={holidayTitle || undefined}
                          disabled={!isPast}
                          onClick={() => isPast && setSelectedDate(day.dateStr)}
                          className={`p-1 rounded-lg border flex flex-col items-center justify-between min-h-[64px] transition-all ${!isPast ? "cursor-default" : "cursor-pointer hover:border-slate-600"} ${
                            isSelected
                              ? "border-lime-400 bg-lime-400/10 ring-1 ring-lime-400/40"
                              : isToday
                                ? "border-lime-400/40 bg-lime-400/5"
                                : holiday
                                  ? "border-indigo-500/40 bg-indigo-500/5"
                                  : isWeekend
                                    ? "border-sky-500/20 bg-sky-500/[0.04]"
                                    : dayShift
                                      ? "border-slate-800 bg-slate-900/40"
                                      : "border-slate-800/30 bg-slate-950/10 opacity-50"
                          }`}
                        >
                          <span className={`text-[8px] font-medium ${isSelected || isToday ? "text-lime-400 font-bold" : holiday ? "text-indigo-400 font-semibold" : isWeekend ? "text-sky-400/80 font-semibold" : "text-slate-500"}`}>
                            {day.label.slice(0, 3)}
                            {holiday && <span className="ml-0.5" title={holidayTitle}>🎉</span>}
                          </span>
                          <span className={`text-[11px] font-bold ${isSelected || isToday ? "text-lime-400" : holiday ? "text-indigo-400" : isWeekend ? "text-sky-400" : "text-slate-300"} mt-0.5`}>
                            {day.num}
                          </span>
                          <div className="w-full mt-1 flex flex-col items-center">
                            {dayShift ? (
                              <div className="w-full text-center">
                                <div className="text-[8px] font-bold text-lime-400 leading-tight truncate">
                                  {dayShift.startTime}
                                </div>
                                <div className="text-[8px] font-bold text-lime-400 leading-tight truncate">
                                  {dayShift.endTime}
                                </div>
                                <span className="inline-block text-[6px] text-slate-500 leading-none uppercase truncate max-w-full">
                                  {t(`role${dayShift.role.charAt(0).toUpperCase() + dayShift.role.slice(1)}`)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-700 leading-none">—</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    className="text-[11px] font-semibold text-lime-500/90 hover:text-lime-400 underline decoration-lime-500/40 hover:decoration-lime-400 underline-offset-2 transition-all pt-1"
                    onClick={() => setShowOlderDayPicker(v => !v)}
                  >
                    {showOlderDayPicker
                      ? (lang === "fr" ? "▾ Masquer" : "▾ Hide")
                      : (lang === "fr" ? "▸ Besoin d'un jour plus ancien ?" : "▸ Need an older day?")}
                  </button>

                  {showOlderDayPicker && (
                    <div className="relative pt-1">
                      <div ref={dateScrollRef} className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                        {dayButtons.map(btn => {
                          const isSelected = selectedDate === btn.dateKey;
                          const holiday = getFrenchHoliday(btn.dateKey);
                          const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";
                          return (
                            <button
                              key={btn.dateKey}
                              title={holidayTitle || undefined}
                              className={`flex-shrink-0 py-2 px-4 rounded-xl border text-center transition-all ${
                                isSelected
                                  ? "bg-lime-400/10 border-lime-400 text-lime-400 font-semibold"
                                  : holiday
                                    ? "bg-indigo-950/40 border-indigo-500/30 text-indigo-400 hover:border-indigo-400/50"
                                    : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                              }`}
                              onClick={() => setSelectedDate(btn.dateKey)}
                            >
                              <span className="block text-xs flex items-center justify-center gap-0.5">
                                {btn.dayLabel}
                                {holiday && <span className="text-[10px]" title={holidayTitle}>🎉</span>}
                              </span>
                              <span className="block text-[10px] opacity-75 mt-0.5">{btn.monthLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Scheduling disabled restaurant-wide — fall back to the
                   plain day picker as the only way to choose a date. */
                <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4">
                  <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-3">{t("whichDay")}</div>
                  <div className="relative">
                    <div ref={dateScrollRef} className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                      {dayButtons.map(btn => {
                        const isSelected = selectedDate === btn.dateKey;
                        const holiday = getFrenchHoliday(btn.dateKey);
                        const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";
                        return (
                          <button
                            key={btn.dateKey}
                            title={holidayTitle || undefined}
                            className={`flex-shrink-0 py-2 px-4 rounded-xl border text-center transition-all ${
                              isSelected
                                ? "bg-lime-400/10 border-lime-400 text-lime-400 font-semibold"
                                : holiday
                                  ? "bg-indigo-950/40 border-indigo-500/30 text-indigo-400 hover:border-indigo-400/50"
                                  : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                            }`}
                            onClick={() => setSelectedDate(btn.dateKey)}
                          >
                            <span className="block text-xs flex items-center justify-center gap-0.5">
                              {btn.dayLabel}
                              {holiday && <span className="text-[10px]" title={holidayTitle}>🎉</span>}
                            </span>
                            <span className="block text-[10px] opacity-75 mt-0.5">{btn.monthLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* SERVICE TYPE */}
              <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4">
                <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-3">{t("shiftType")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`py-3 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all ${shiftType === "worked" ? "bg-lime-400/10 border-lime-400 text-lime-400" : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"}`}
                    onClick={() => setShiftType("worked")}
                  >
                    <span className="text-lg">✅</span>
                    {t("worked")}
                  </button>
                  <button
                    className={`py-3 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all ${shiftType === "absent" ? "bg-rose-400/10 border-rose-400 text-rose-400" : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"}`}
                    onClick={() => setShiftType("absent")}
                  >
                    <span className="text-lg">🚫</span>
                    {t("absent")}
                  </button>
                  <button
                    className={`py-3 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all ${shiftType === "sick" ? "bg-orange-400/10 border-orange-400 text-orange-400" : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"}`}
                    onClick={() => setShiftType("sick")}
                  >
                    <span className="text-lg">🤒</span>
                    {t("sickDay")}
                  </button>
                  <button
                    className={`py-3 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition-all ${shiftType === "holiday" ? "bg-sky-400/10 border-sky-400 text-sky-400" : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"}`}
                    onClick={() => setShiftType("holiday")}
                  >
                    <span className="text-lg">🏖️</span>
                    {t("holiday")}
                  </button>
                </div>
              </div>

              {/* TIMEPICKERS FOR WORKED SHIFTS (freehand mode) */}
              {shiftType === "worked" && !config.strict_clock_required && (
                <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4 space-y-4">
                  <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{t("startFinish")}</div>
                  
                  {/* SHIFT 1 */}
                  <div className="space-y-3">
                    <div className="text-[10px] font-bold text-lime-400 uppercase tracking-wider">
                      {splitActive ? `${t("start")} 1` : t("startFinish")}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-slate-400 w-12">{t("start")}</span>
                      <div className="flex items-center gap-2 flex-1">
                        <select 
                          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                          value={s1StartH}
                          onChange={e => setS1StartH(Number(e.target.value))}
                        >
                          {Array.from({ length: 24 }).map((_, i) => (
                            <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                          ))}
                        </select>
                        <span className="font-mono text-slate-500 font-bold">:</span>
                        <select 
                          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                          value={s1StartM}
                          onChange={e => setS1StartM(Number(e.target.value))}
                        >
                          {[0, 15, 30, 45].map(v => (
                            <option key={v} value={v}>{String(v).padStart(2, "0")}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-xs text-slate-400 w-12">{t("finish")}</span>
                      <div className="flex items-center gap-2 flex-1">
                        <select 
                          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                          value={s1EndH}
                          onChange={e => setS1EndH(Number(e.target.value))}
                        >
                          {Array.from({ length: 24 }).map((_, i) => (
                            <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                          ))}
                        </select>
                        <span className="font-mono text-slate-500 font-bold">:</span>
                        <select 
                          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                          value={s1EndM}
                          onChange={e => setS1EndM(Number(e.target.value))}
                        >
                          {[0, 15, 30, 45].map(v => (
                            <option key={v} value={v}>{String(v).padStart(2, "0")}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* SPLIT SHIFT TOGGLE BUTTON */}
                  <div className="flex items-center gap-2 py-2">
                    <div className="flex-1 h-px bg-slate-800" />
                    <button
                      className="px-4 py-1.5 border border-slate-800 hover:border-slate-700 bg-slate-900/60 rounded-full text-[10px] font-bold text-slate-400 transition-all"
                      onClick={() => setSplitActive(!splitActive)}
                    >
                      {splitActive ? "✕ Supprimer service du soir" : "+ Ajouter service du soir"}
                    </button>
                    <div className="flex-1 h-px bg-slate-800" />
                  </div>

                  {/* SHIFT 2 */}
                  {splitActive && (
                    <div className="space-y-3 animate-slide-down">
                      <div className="text-[10px] font-bold text-lime-400 uppercase tracking-wider">
                        Service 2 (soir)
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-slate-400 w-12">{t("start")}</span>
                        <div className="flex items-center gap-2 flex-1">
                          <select 
                            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                            value={s2StartH}
                            onChange={e => setS2StartH(Number(e.target.value))}
                          >
                            {Array.from({ length: 24 }).map((_, i) => (
                              <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                            ))}
                          </select>
                          <span className="font-mono text-slate-500 font-bold">:</span>
                          <select 
                            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                            value={s2StartM}
                            onChange={e => setS2StartM(Number(e.target.value))}
                          >
                            {[0, 15, 30, 45].map(v => (
                              <option key={v} value={v}>{String(v).padStart(2, "0")}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="text-xs text-slate-400 w-12">{t("finish")}</span>
                        <div className="flex items-center gap-2 flex-1">
                          <select 
                            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                            value={s2EndH}
                            onChange={e => setS2EndH(Number(e.target.value))}
                          >
                            {Array.from({ length: 24 }).map((_, i) => (
                              <option key={i} value={i}>{String(i).padStart(2, "0")}</option>
                            ))}
                          </select>
                          <span className="font-mono text-slate-500 font-bold">:</span>
                          <select 
                            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-center text-slate-200"
                            value={s2EndM}
                            onChange={e => setS2EndM(Number(e.target.value))}
                          >
                            {[0, 15, 30, 45].map(v => (
                              <option key={v} value={v}>{String(v).padStart(2, "0")}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SUMMARY */}
                  <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-slate-400">{t("hoursWorked")}</div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {splitActive ? `(${s1.hours}h + ${s2.hours}h)` : `${s1.startTime} → ${s1.endTime}${s1.overnight ? ' ' + t("overnightShift") : ""}`}
                      </div>
                    </div>
                    <div className="text-3xl font-mono font-bold text-lime-400">
                      {Math.floor(totalHours)}h{Math.round((totalHours % 1) * 60) > 0 ? ` ${Math.round((totalHours % 1) * 60)}m` : ""}
                    </div>
                  </div>
                </div>
              )}

              {/* LIVE CLOCK IN / CLOCK OUT (strict mode) */}
              {shiftType === "worked" && config.strict_clock_required && (
                <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-5 space-y-4">
                  {selectedDate !== todayStr ? (
                    <p className="text-xs text-slate-500 text-center py-4">
                      {lang === "fr"
                        ? "Le pointage en direct n'est disponible que pour aujourd'hui."
                        : "Live clock in/out is only available for today."}
                    </p>
                  ) : activeClockIn ? (
                    <>
                      <div className="text-center space-y-1">
                        <div className="text-[10px] font-bold tracking-wider text-lime-400 uppercase">
                          {lang === "fr" ? "Pointé depuis" : "Clocked in since"}
                        </div>
                        <div className="text-2xl font-mono font-bold text-slate-100">
                          {new Date(activeClockIn.clockInAt).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <div className="text-xs text-slate-500 font-mono">
                          {(() => {
                            const mins = Math.max(0, Math.round((clockNowTick - new Date(activeClockIn.clockInAt).getTime()) / 60000));
                            const h = Math.floor(mins / 60), m = mins % 60;
                            return `${h}h${String(m).padStart(2, "0")}${lang === "fr" ? " écoulées" : " elapsed"}`;
                          })()}
                        </div>
                      </div>
                      <button
                        className="w-full py-4 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        onClick={handleClockOut}
                        disabled={clockingBusy}
                      >
                        <LogOut size={18} />
                        {clockingBusy ? "..." : (lang === "fr" ? "Pointer la sortie" : "Clock Out")}
                      </button>
                      <button
                        className="w-full py-2 text-[11px] text-slate-500 hover:text-rose-400 transition-all"
                        onClick={handleCancelClockIn}
                        disabled={clockingBusy}
                      >
                        {lang === "fr" ? "Annuler ce pointage (erreur)" : "Cancel this clock-in (mistake)"}
                      </button>
                    </>
                  ) : (
                    <>
                      <textarea
                        className="w-full h-14 bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 resize-none placeholder-slate-600"
                        placeholder={t("notePlaceholder")}
                        value={clockNote}
                        onChange={e => setClockNote(e.target.value)}
                      />
                      <button
                        className="w-full py-4 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        onClick={handleClockIn}
                        disabled={clockingBusy}
                      >
                        <LogIn size={18} />
                        {clockingBusy ? "..." : (lang === "fr" ? "Pointer l'entrée" : "Clock In")}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* NOTES / SUBMIT (hidden in live clock mode — clocking in/out is the action) */}
              {!(shiftType === "worked" && config.strict_clock_required) && (
                <>
                  <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4">
                    <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-2">{t("noteForManager")}</div>
                    <textarea
                      id="shift-notes-textarea"
                      className="w-full h-16 bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 resize-none placeholder-slate-600"
                      placeholder={t("notePlaceholder")}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                    />
                  </div>

                  {/* SUBMISSION / OT ADVISORIES */}
                  {overWeeklyLimit && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-xs text-rose-400 flex gap-2">
                      <ShieldAlert className="flex-shrink-0" size={16} />
                      <div>
                        {t("otWarning", {
                          name: selectedStaff,
                          total: projectedTotalWeekHours.toFixed(1),
                          over: (projectedTotalWeekHours - contractHours).toFixed(1),
                          limit: contractHours
                        })}
                      </div>
                    </div>
                  )}

                  {config.approval_required && (
                    <p className="text-[11px] text-amber-400 text-center px-4 leading-relaxed">
                      {t("approvalRequired")}
                    </p>
                  )}

                  {/* CONFIRM / SUBMIT CARD */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
                    <button
                      className="w-full py-4 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      onClick={handleSubmit}
                      disabled={submitting}
                    >
                      <Check size={18} />
                      {submitting ? "..." : t("confirmSubmit")}
                    </button>
                  </div>
                </>
              )}
              {recentSubmissions.length > 0 && (
                <div className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-4 space-y-3">
                  <div className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">{t("yourRecentSubmissions")}</div>
                  <div className="space-y-2">
                    {recentSubmissions.map(e => {
                      const hourStr = e.type === "worked" ? `${Math.floor(e.hours)}h${Math.round((e.hours % 1) * 60) > 0 ? ` ${Math.round((e.hours % 1) * 60)}m` : ""}` : e.type;
                      const badgeBg = e.status === "approved" ? "bg-lime-400/10 text-lime-400" : e.status === "correction" ? "bg-rose-400/10 text-rose-400 border border-rose-500/30" : "bg-amber-400/10 text-amber-400";
                      
                      return (
                        <div key={e.id} className="flex items-center justify-between p-2.5 bg-slate-950/40 border border-slate-800/60 rounded-xl text-xs">
                          <div>
                            <div className="font-semibold text-slate-200">{e.date}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {e.type === "worked" ? `${e.startTime} → ${e.endTime}` : t(e.type)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-300 font-medium">{hourStr}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${badgeBg}`}>
                              {t(`status${e.status.charAt(0).toUpperCase() + e.status.slice(1)}`)}
                            </span>
                            {e.status !== "correction" && (
                              <button 
                                className="text-[10px] text-amber-400 underline pl-1"
                                onClick={() => handleOpenCorrection(e.id)}
                              >
                                {t("requestFix")}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ADVANCES RECEIVED */}
              {staffAdvances.length > 0 && (
                <div className="bg-amber-400/[0.04] border border-amber-400/20 rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between items-center text-[10px] font-bold tracking-wider text-amber-400 uppercase">
                    <span>{t("advancesReceived")}</span>
                    <span className="font-mono font-bold text-amber-400">€{totalAdvances.toFixed(2)}</span>
                  </div>
                  <div className="space-y-1.5">
                    {staffAdvances.map(a => (
                      <div key={a.id} className="flex justify-between items-center text-xs border-b border-amber-400/10 pb-1.5 last:border-b-0 last:pb-0">
                        <span className="font-mono text-amber-400 font-semibold">€{a.amount.toFixed(2)}</span>
                        <span className="text-slate-500 text-[10px]">{a.date}</span>
                        {a.note && <span className="text-slate-400 text-[10px] max-w-[120px] truncate">({a.note})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* SUCCESS SCREEN */
        <div className="text-center py-10 space-y-6 animate-fade-in">
          <div className="w-16 h-16 bg-lime-400/10 border border-lime-400/30 rounded-full flex items-center justify-center text-3xl text-lime-400 mx-auto">
            ✓
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-100">{t("hoursSubmitted")}</h2>
            {config.approval_required && (
              <p className="text-xs text-amber-400">{t("pendingApproval")}</p>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-left text-sm space-y-3 max-w-sm mx-auto">
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">{t("name")}</span>
              <span className="font-semibold text-slate-200">{submittedEntry.name}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">{t("date")}</span>
              <span className="font-mono font-semibold text-slate-200">{submittedEntry.date}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">{t("type")}</span>
              <span className="font-semibold text-slate-200">{t(submittedEntry.type)}</span>
            </div>
            {submittedEntry.type === "worked" && (
              <>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">{t("start")}</span>
                  <span className="font-mono text-slate-200">{submittedEntry.startTime}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">{t("finish")}</span>
                  <span className="font-mono text-slate-200">{submittedEntry.endTime}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">{t("totalHours")}</span>
                  <span className="font-mono font-bold text-lime-400">{submittedEntry.hours.toFixed(1)}h</span>
                </div>
              </>
            )}
            {submittedEntry.note && (
              <div className="flex justify-between pb-1">
                <span className="text-slate-400">{t("note")}</span>
                <span className="text-slate-300 italic text-right max-w-[180px] truncate">"{submittedEntry.note}"</span>
              </div>
            )}
          </div>

          <button
            className="px-6 py-3 border border-slate-800 hover:border-slate-700 bg-slate-900 rounded-xl text-slate-300 font-semibold text-sm transition-all"
            onClick={handleReset}
          >
            {t("submitAnother")}
          </button>
        </div>
      )}

      {/* SECURITY / PIN ENTRY MODAL */}
      {pinModalStaff && (
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-xs text-center space-y-4">
            <div className="text-3xl">🔒</div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">{pinModalStaff}</h3>
              <p className="text-xs text-slate-400 mt-1">{lang === "fr" ? "Entrez votre code PIN" : "Enter your PIN code"}</p>
            </div>
            
            {/* PIN DOTS */}
            <div className={`flex justify-center gap-3 py-2 ${isPinShaking ? "animate-shake" : ""}`}>
              {Array.from({ length: staffList.find(s => s.name === pinModalStaff)?.pin.length || 4 }).map((_, i) => (
                <div 
                  key={i} 
                  className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${pinError ? "bg-rose-500 border-rose-500" : pinBuffer.length > i ? "bg-lime-400 border-lime-400" : "bg-slate-800 border-slate-700"}`}
                />
              ))}
            </div>

            <div className="text-xs text-rose-400 min-h-[16px]">{pinError}</div>

            {/* NUMPAD */}
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => (
                <button
                  key={n}
                  className="py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 font-semibold text-lg hover:bg-slate-800 hover:border-slate-700 active:scale-95 transition-all"
                  onClick={() => handlePinKey(n)}
                >
                  {n}
                </button>
              ))}
              <button
                className="py-3 text-xs text-slate-500 font-semibold flex items-center justify-center hover:text-slate-300"
                onClick={handleCancelPin}
              >
                {t("cancel")}
              </button>
              <button
                className="py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 font-semibold text-lg hover:bg-slate-800 hover:border-slate-700 active:scale-95 transition-all"
                onClick={() => handlePinKey("0")}
              >
                0
              </button>
              <button
                className="py-3 text-slate-500 flex items-center justify-center hover:text-slate-300 active:scale-95 transition-all text-lg"
                onClick={handlePinBackspace}
              >
                ⌫
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CORRECTION REQUEST MODAL */}
      {correctionModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="text-base font-semibold text-slate-100">{t("requestCorrection")}</h3>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                {t("whatNeedsFixing")}
              </label>
              <textarea
                className="w-full h-24 bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 resize-none placeholder-slate-600"
                placeholder={t("correctionPlaceholder")}
                value={correctionNote}
                onChange={e => setCorrectionNote(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 py-3 bg-amber-400 text-slate-950 font-bold rounded-xl hover:bg-amber-300 transition-all text-sm"
                onClick={handleSendCorrection}
              >
                {t("sendToManager")}
              </button>
              <button
                className="py-3 px-4 border border-slate-800 hover:border-slate-700 bg-slate-900 rounded-xl text-slate-400 text-sm"
                onClick={() => setCorrectionModalOpen(false)}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
