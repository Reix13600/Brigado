import React, { useState, useEffect } from "react";
import {
  signInManagerWithEmail, signInManagerWithGoogle, signOutManager,
  isAuthorizedManager, watchAuthState,
} from "../utils/auth";
import { 
  AppData, HourEntry, StaffMember, CashAdvance, GeneralConfig, EntryType, RoleType, ScheduledShift, Deduction, Shift
} from "../types";
import { getTranslation, LangType, TRANSLATIONS } from "../utils/translations";
import { getRestaurantId, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";
import QRCode from "qrcode";
import QRPoster from "./QRPoster";
import Toggle from "./Toggle";
import MiniCalendar from "./MiniCalendar";
import Timesheet from "./Timesheet";
import BookkeeperExport from "./BookkeeperExport";
import InfoTooltip from "./InfoTooltip";
import logoIcon from "../assets/logo-icon.png";
import { getRoleColor } from "../utils/roleColors";
import { COMPLIANCE_RULES, isRuleEnabled, defaultComplianceRules, NOT_TRACKED_EN, NOT_TRACKED_FR, ComplianceCategory } from "../utils/compliance";
import { getFrenchHoliday } from "../utils/holidays";
import { 
  saveConfig, saveStaff, saveEntry, deleteEntry, approveAllEntries, 
  approveEntriesByRole, saveAdvance, deleteAdvance, saveDayNote, saveWeekNote, clearAllData,
  saveScheduledShift, deleteScheduledShift,
  postAnnouncement, deleteAnnouncement, sendMessage, decideTimeOffRequest, decideSwap,
  saveTimeOffNote, saveSwapNote, deleteStaffMemberData
} from "../utils/api";
import { 
  Users, Calendar, DollarSign, BarChart3, Settings, Clipboard,
  TrendingUp, Award, Clock, ArrowRight, ShieldAlert, AlertCircle,
  FileSpreadsheet, Printer, Mail, Plus, Trash2, Check, X, Eye, EyeOff, Copy
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

interface ManagerDashboardProps {
  appData: AppData;
  lang: LangType;
  setLang: (lang: LangType) => void;
  onRefresh: () => void;
  theme?: "light" | "dark";
}

export default function ManagerDashboard({ appData, lang, setLang, onRefresh, theme = "dark" }: ManagerDashboardProps) {
  const t = (k: string, vars?: Record<string, any>) => getTranslation(lang, k, vars);

  const getRole = (name: string): RoleType => {
    const member = appData.staff.find(s => s.name === name);
    return member ? member.role : "other";
  };

  const getLang = () => lang;

  const fmtHours = (h: number) => {
    if (!h && h !== 0) return "—";
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return hh + "h" + (mm > 0 ? " " + mm + "m" : "");
  };

  const editEntryInline = (id: number) => {
    setActiveTab("entries");
    setInlineEditId(id);
    const entry = appData.entries.find(e => e.id === id);
    if (entry) {
      setInlineEditHours(String(entry.hours));
    }
  };

  const openAdvanceModal = (name: string) => {
    setAdvanceModalStaff(name);
  };

  const closeAdvanceModal = () => {
    setAdvanceModalStaff(null);
  };

  const exportCSV = () => {
    const data = filterByRole(getRangeData());
    let csv = "Name,Role,Date,Type,Hours,Status,Note\n";
    data.forEach(e => {
      const roleStr = ROLES[getRole(e.name)] || "Other";
      const noteStr = (e.note || "").replace(/"/g, '""');
      csv += `"${e.name}","${roleStr}","${e.date}","${e.type}","${e.hours}","${e.status}","${noteStr}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `payroll_export_${new Date().toISOString().split("T")[0]}.csv`);
    link.click();
  };

  const sendEmail = () => {
    const email = appData.config.bookkeeper_email;
    if (!email) {
      alert(t("setBookkeeperEmail"));
      return;
    }
    const data = filterByRole(getRangeData());
    const { start, end } = getRange();
    let body = `Payroll Report — ${start.toLocaleDateString()} to ${end.toLocaleDateString()}\nRestaurant: ${restoName}\n\n`;
    body += `NAME           | ROLE         | HRS   | OT     | GROSS     | TAX       | NET       | ADV       | TO PAY\n${"─".repeat(88)}\n`;
    let tg = 0, tAdv = 0;
    appData.staff.forEach(member => {
      if (activeRoleFilter !== "all" && member.role !== activeRoleFilter) return;
      const personEntries = data.filter(e => e.name === member.name && e.status === "approved");
      const hrs = personEntries.filter(e => e.type === "worked").reduce((s, e) => s + e.hours, 0);
      const contract = getContractHours(member.name);
      const ot = Math.max(0, hrs - contract);
      const gross = hrs * member.rate;
      const net = gross * (1 - taxRate / 100);
      const advs = getAdvancesByScope(member.name).reduce((sum, a) => sum + a.amount, 0);
      const toPay = Math.max(net - advs, 0);
      tg += gross;
      tAdv += advs;
      body += `${member.name.padEnd(14)} | ${(ROLES[member.role] || "Other").padEnd(12)} | ${fmtHours(hrs).padEnd(7)} | ${(ot > 0 ? "+" + fmtHours(ot) : "—").padEnd(8)} | €${gross.toFixed(2).padStart(8)} | €${(gross - net).toFixed(2).padStart(8)} | €${net.toFixed(2).padStart(8)} | ${advs > 0 ? "-€" + advs.toFixed(2).padStart(7) : "—".padEnd(8)} | €${toPay.toFixed(2)}\n`;
    });
    body += `${"─".repeat(88)}\nTOTAL GROSS: €${tg.toFixed(2)}\nTOTAL ADVANCES: -€${tAdv.toFixed(2)}\n`;
    const abs = data.filter(e => e.type === "absent" || e.type === "sick");
    if (abs.length) {
      body += `\nABSENCES:\n`;
      abs.forEach(e => {
        body += `• ${e.name} (${ROLES[getRole(e.name)]}) — ${e.date} (${e.type})${e.note ? ": " + e.note : ""}\n`;
      });
    }
    const wn = appData.weekNotes[getRangeKey()];
    if (wn) body += `\nMANAGER NOTES:\n${wn}\n`;
    window.open(`mailto:${email}?subject=${encodeURIComponent("Payroll " + start.toLocaleDateString() + " - " + end.toLocaleDateString())}&body=${encodeURIComponent(body)}`);
  };
  
  // Auth
  const [emailInput, setEmailInput] = useState<string>("");
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [loginError, setLoginError] = useState<string>("");
  const [loginBusy, setLoginBusy] = useState<boolean>(false);

  // Restore a manager session automatically on reload (Firebase Auth
  // persists sign-in across page loads by default).
  useEffect(() => {
    const unsubscribe = watchAuthState(async (user) => {
      if (user && !user.isAnonymous) {
        setIsAuthenticated(await isAuthorizedManager(user.uid));
      } else {
        setIsAuthenticated(false);
      }
      setAuthChecking(false);
    });
    return unsubscribe;
  }, []);

  // Tabs: 'overview' | 'calendar' | 'entries' | 'payroll' | 'stats' | 'settings'
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Filter states
  const [activeRoleFilter, setActiveRoleFilter] = useState<string>("all");
  const [activePersonFilter, setPersonFilter] = useState<string>("all");

  // Date range state
  const [rangeMode, setRangeMode] = useState<"week" | "month" | "year" | "custom">("week");
  const [rangeOffset, setRangeOffset] = useState<number>(0);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  // Config settings state
  const [restoName, setRestoName] = useState<string>("");
  const [newManagerPin, setNewManagerPin] = useState<string>("");
  const [overtimeLimit, setOvertimeLimit] = useState<number>(35);
  const [taxRate, setTaxRate] = useState<number>(22);
  const [deductions, setDeductions] = useState<Deduction[]>([{ id: "tax", label: "Tax", rate: 22 }]);
  const [approvalRequired, setApprovalRequired] = useState<boolean>(true);
  const [bookkeeperEmail, setBookkeeperEmail] = useState<string>("");
  const [sheetUrl, setSheetUrl] = useState<string>("");
  const [enableScheduling, setEnableScheduling] = useState<boolean>(true);
  const [complianceEnforced, setComplianceEnforced] = useState<boolean>(true);
  const [strictClockRequired, setStrictClockRequired] = useState<boolean>(false);
  const [showQRPoster, setShowQRPoster] = useState<boolean>(false);
  const [showComplianceInfo, setShowComplianceInfo] = useState<boolean>(false);
  const [complianceRules, setComplianceRules] = useState<Record<string, boolean>>({});
  const [smicHourly, setSmicHourly] = useState<number>(12.02);
  const [showTimesheet, setShowTimesheet] = useState<boolean>(false);
  const [showBookkeeperExport, setShowBookkeeperExport] = useState<boolean>(false);
  const [timesheetSignatures, setTimesheetSignatures] = useState<boolean>(true);
  const [staffRoleFilter, setStaffRoleFilter] = useState<RoleType | "all">("all");
  const [selectedFormerStaff, setSelectedFormerStaff] = useState<StaffMember | null>(null);
  const [showFormerStaff, setShowFormerStaff] = useState<boolean>(false);
  const [showFormerHistoryTimesheet, setShowFormerHistoryTimesheet] = useState<boolean>(false);
  const [formerDeleteVerifyText, setFormerDeleteVerifyText] = useState<string>("");
  const [deletingFormerStaff, setDeletingFormerStaff] = useState<boolean>(false);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/${getRestaurantId()}?src=qr`, { width: 150, margin: 1 })
      .then(setQrPreviewUrl)
      .catch(console.error);
  }, []);
  const [digestEmail, setDigestEmail] = useState<string>("");
  const [digestEnabled, setDigestEnabled] = useState<boolean>(false);
  const [digestSending, setDigestSending] = useState<boolean>(false);
  const [digestSentMsg, setDigestSentMsg] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteBusy, setInviteBusy] = useState<boolean>(false);
  const [inviteMsg, setInviteMsg] = useState<string>("");
  const [removeBusy, setRemoveBusy] = useState<string | null>(null);

  // Manager weekly notes state
  const [weekNoteText, setWeekNoteInput] = useState<string>("");

  // Staff management state
  const [newStaffName, setNewStaffName] = useState<string>("");
  const [newStaffRole, setNewStaffRole] = useState<RoleType>("server");
  const [newStaffRate, setNewStaffRate] = useState<number>(12);
  const [newStaffContract, setNewStaffContract] = useState<number>(35);
  const [newStaffPin, setNewStaffPin] = useState<string>("");
  const [newStaffIsMinor, setNewStaffIsMinor] = useState<boolean>(false);
  const [showAddStaffModal, setShowAddStaffModal] = useState<boolean>(false);

  // Calendar states
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayNoteText, setDayNoteInput] = useState<string>("");

  // Cash Advance Modal states
  const [advanceModalStaff, setAdvanceModalStaff] = useState<string | null>(null);
  const [advScope, setAdvScope] = useState<"period" | "all">("period");
  const [newAdvAmount, setNewAdvAmount] = useState<string>("");
  const [newAdvDate, setNewAdvDate] = useState<string>("");
  const [newAdvNote, setNewAdvNote] = useState<string>("");

  // Clear data confirm modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);
  const [deleteVerifyText, setDeleteVerifyText] = useState<string>("");

  // Inline edit state in Saisies
  const [inlineEditId, setInlineEditId] = useState<number | null>(null);
  const [inlineEditHours, setInlineEditHours] = useState<string>("");

  // Schedule Planner States
  const [scheduleOffset, setScheduleOffset] = useState<number>(0);
  const [scheduleViewMode, setScheduleViewMode] = useState<"weekly" | "monthly">("weekly");
  const [scheduleMonthOffset, setScheduleMonthOffset] = useState<number>(0);
  const [selectedScheduleShift, setSelectedScheduleShift] = useState<ScheduledShift | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState<boolean>(false);
  const [printHideAlerts, setPrintHideAlerts] = useState<boolean>(true);
  const [statsWeeks, setStatsWeeks] = useState<number>(8);
  const [printHideTotals, setPrintHideTotals] = useState<boolean>(false);
  const [scheduleForm, setScheduleForm] = useState<{
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    role: RoleType;
  }>({
    name: "",
    date: "",
    startTime: "09:00",
    endTime: "15:30",
    role: "server"
  });

  // Load configuration to local states
  useEffect(() => {
    if (appData) {
      setRestoName(appData.config.resto_name);
      setOvertimeLimit(appData.config.overtime_limit);
      setTaxRate(appData.config.tax_rate);
      setDeductions(
        appData.config.deductions && appData.config.deductions.length > 0
          ? appData.config.deductions
          : [{ id: "tax", label: "Tax", rate: appData.config.tax_rate ?? 22 }]
      );
      setApprovalRequired(appData.config.approval_required);
      setBookkeeperEmail(appData.config.bookkeeper_email);
      setSheetUrl(appData.config.sheet_url);
      setEnableScheduling(appData.config.enable_scheduling !== false);
      setComplianceEnforced(appData.config.compliance_enforced !== false);
      setStrictClockRequired(appData.config.strict_clock_required === true);
      setDigestEmail(appData.config.digest_email || "");
      setDigestEnabled(!!appData.config.digest_email);
      setTimesheetSignatures(appData.config.timesheet_signatures !== false);
      setComplianceRules(appData.config.compliance_rules ?? defaultComplianceRules());
      setSmicHourly(appData.config.smic_hourly ?? 12.02);
    }
  }, [appData]);

  // Sync selected week notes
  useEffect(() => {
    const key = getRangeKey();
    setWeekNoteInput(appData.weekNotes[key] || "");
  }, [rangeMode, rangeOffset, customStart, customEnd, appData]);

  // Initialize date selection for advances
  useEffect(() => {
    setNewAdvDate(new Date().toISOString().split("T")[0]);
  }, []);

  const ROLES: Record<RoleType, string> = {
    server: t("roleServer"),
    kitchen: t("roleKitchen"),
    cold: t("roleCold"),
    dishwasher: t("roleDishwasher"),
    bar: t("roleBar"),
    chef: t("roleChef"),
    cleaner: t("roleCleaner"),
    host: t("roleHost"),
    other: t("roleOther"),
  };

  const RC: Record<RoleType, string> = Object.fromEntries(
    (Object.keys(ROLES) as RoleType[]).map(r => [r, getRoleColor(r, theme)])
  ) as Record<RoleType, string>;

  const TIME_OPTIONS: string[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    for (const mm of ["00", "15", "30", "45"]) {
      TIME_OPTIONS.push(`${hh}:${mm}`);
    }
  }

  const handleLogin = async () => {
    setLoginError("");
    setLoginBusy(true);
    try {
      const user = await signInManagerWithEmail(emailInput, passwordInput);
      const authorized = await isAuthorizedManager(user.uid);
      if (authorized) {
        setIsAuthenticated(true);
      } else {
        await signOutManager();
        setLoginError(t("notAuthorizedManager"));
      }
    } catch (err) {
      setLoginError(t("incorrectCredentials"));
    } finally {
      setLoginBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoginError("");
    setLoginBusy(true);
    try {
      const user = await signInManagerWithGoogle();
      const authorized = await isAuthorizedManager(user.uid);
      if (authorized) {
        setIsAuthenticated(true);
      } else {
        await signOutManager();
        setLoginError(t("notAuthorizedManager"));
      }
    } catch (err) {
      setLoginError(t("incorrectCredentials"));
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    await signOutManager();
    setIsAuthenticated(false);
  };

  // ── RANGE CALCULATIONS ────────────────────────────────
  const getRange = (offset = rangeOffset) => {
    const now = new Date();
    if (rangeMode === "week") {
      const day = now.getDay() || 7;
      const mon = new Date(now);
      mon.setDate(now.getDate() - day + 1 + offset * 7);
      mon.setHours(0, 0, 0, 0);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      sun.setHours(23, 59, 59, 999);
      return { start: mon, end: sun };
    }
    if (rangeMode === "month") {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return {
        start: new Date(d.getFullYear(), d.getMonth(), 1),
        end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
      };
    }
    if (rangeMode === "year") {
      const y = now.getFullYear() + offset;
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59, 999) };
    }
    // Custom
    if (rangeMode === "custom" && customStart && customEnd) {
      const s = new Date(customStart);
      s.setHours(0, 0, 0, 0);
      const e = new Date(customEnd);
      e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }
    const day = now.getDay() || 7;
    const mon = new Date(now);
    mon.setDate(now.getDate() - day + 1);
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { start: mon, end: sun };
  };

  const getRangeLabel = () => {
    const { start, end } = getRange();
    const isFr = lang === "fr";
    const yf = rangeMode === "year" || rangeMode === "custom" ? "numeric" : undefined;
    const fmt = (d: Date) => d.toLocaleDateString(isFr ? "fr-FR" : "en-GB", { day: "2-digit", month: "short", year: yf });
    
    if (rangeMode === "week") {
      return (rangeOffset === 0 ? t("thisWeek") + " · " : rangeOffset === -1 ? t("lastWeek") + " · " : "") + fmt(start) + " – " + fmt(end);
    }
    if (rangeMode === "month") {
      return start.toLocaleDateString(isFr ? "fr-FR" : "en-GB", { month: "long", year: "numeric" });
    }
    if (rangeMode === "year") {
      return start.getFullYear().toString();
    }
    return fmt(start) + " – " + fmt(end);
  };

  const getRangeKey = () => {
    const { start } = getRange();
    return rangeMode + ":" + start.toISOString().split("T")[0];
  };

  const getRangeData = (offset = rangeOffset) => {
    const { start, end } = getRange(offset);
    return appData.entries.filter(e => {
      const d = new Date(e.date);
      return d >= start && d <= end;
    });
  };

  const getContractHours = (name: string) => {
    const member = appData.staff.find(s => s.name === name);
    return member?.contract || overtimeLimit;
  };

  // Role filtering
  const filterByRole = <T extends { name: string }>(list: T[]): T[] => {
    if (activeRoleFilter === "all") return list;
    return list.filter(item => {
      const m = appData.staff.find(s => s.name === item.name);
      return (m?.role || "other") === activeRoleFilter;
    });
  };

  // Status & Counts
  const pendingEntries = appData.entries.filter(e => e.status === "pending" || e.status === "correction");
  const pendingTimeOff = appData.timeOffRequests.filter(r => r.status === "pending");
  const claimedSwaps = appData.swapRequests.filter(r => r.status === "claimed");
  const requestsBadgeCount = pendingTimeOff.length + claimedSwaps.length;
  const unreadThreads = Array.from(new Set(appData.messages.map(m => m.staffName))).filter(name => {
    const thread = appData.messages.filter(m => m.staffName === name).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    return thread[0]?.from === "staff";
  });
  const messagesBadgeCount = unreadThreads.length;

  // ── CORE DATA SAVE TRIGGERS ─────────────────────────
  const triggerSaveGeneral = async () => {
    try {
      const summedTaxRate = deductions.reduce((s, d) => s + (Number(d.rate) || 0), 0);
      const updated: Partial<GeneralConfig> = { 
        resto_name: restoName, 
        overtime_limit: overtimeLimit, 
        tax_rate: summedTaxRate,
        deductions: deductions,
        enable_scheduling: enableScheduling,
        compliance_enforced: complianceEnforced
      };
      if (newManagerPin.length >= 4) {
        updated.manager_pin = newManagerPin;
      }
      await saveConfig(updated);
      onRefresh();
      setNewManagerPin("");
      alert(t("saved"));
    } catch (err) {
      console.error(err);
    }
  };

  const updateDeduction = (id: string, field: "label" | "rate", value: string | number) => {
    setDeductions(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  const addDeduction = () => {
    setDeductions(prev => [...prev, { id: `d-${Date.now()}`, label: "", rate: 0 }]);
  };

  const removeDeduction = (id: string) => {
    setDeductions(prev => prev.filter(d => d.id !== id));
  };

  const triggerSaveBookkeeper = async () => {
    try {
      await saveConfig({ bookkeeper_email: bookkeeperEmail, sheet_url: sheetUrl });
      onRefresh();
      alert(t("saved"));
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveBehaviour = async (val: boolean) => {
    setApprovalRequired(val);
    try {
      await saveConfig({ approval_required: val });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveEnableScheduling = async (val: boolean) => {
    setEnableScheduling(val);
    try {
      await saveConfig({ enable_scheduling: val });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveComplianceEnforced = async (val: boolean) => {
    setComplianceEnforced(val);
    try {
      await saveConfig({ compliance_enforced: val });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerToggleComplianceRule = async (id: string, val: boolean) => {
    const updated = { ...complianceRules, [id]: val };
    setComplianceRules(updated);
    try {
      await saveConfig({ compliance_rules: updated });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSetAllComplianceRules = async (val: boolean) => {
    const updated = Object.fromEntries(COMPLIANCE_RULES.map(r => [r.id, val]));
    setComplianceRules(updated);
    try {
      await saveConfig({ compliance_rules: updated });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerToggleCategoryRules = async (category: ComplianceCategory, val: boolean) => {
    const updated = { ...complianceRules };
    COMPLIANCE_RULES.filter(r => r.category === category).forEach(r => { updated[r.id] = val; });
    setComplianceRules(updated);
    try {
      await saveConfig({ compliance_rules: updated });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveSmic = async () => {
    try {
      await saveConfig({ smic_hourly: smicHourly });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveStrictClock = async (val: boolean) => {
    setStrictClockRequired(val);
    try {
      await saveConfig({ strict_clock_required: val });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveDigestEmail = async () => {
    try {
      await saveConfig({ digest_email: digestEmail.trim() });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveTimesheetSignatures = async (val: boolean) => {
    setTimesheetSignatures(val);
    try {
      await saveConfig({ timesheet_signatures: val });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSendDigestNow = async () => {
    if (!digestEmail.trim()) return;
    setDigestSending(true);
    setDigestSentMsg("");
    try {
      const sendDigestNow = httpsCallable(functions, "sendDigestNow");
      await sendDigestNow({ slug: getRestaurantId(), email: digestEmail.trim() });
      setDigestSentMsg(lang === "fr" ? "Envoyé !" : "Sent!");
    } catch (err) {
      console.error(err);
      setDigestSentMsg(lang === "fr" ? "Échec de l'envoi — la fonction est-elle déployée ?" : "Failed to send — is the function deployed yet?");
    } finally {
      setDigestSending(false);
    }
  };

  const triggerInviteManager = async () => {
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    setInviteMsg("");
    try {
      const invite = httpsCallable(functions, "inviteManager");
      await invite({ restaurantId: getRestaurantId(), email: inviteEmail.trim() });
      setInviteMsg(lang === "fr" ? `Invitation envoyée à ${inviteEmail.trim()}` : `Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      onRefresh();
    } catch (err: any) {
      console.error(err);
      setInviteMsg(err?.message || (lang === "fr" ? "Échec de l'invitation" : "Failed to invite"));
    } finally {
      setInviteBusy(false);
    }
  };

  const triggerRemoveManager = async (email: string) => {
    if (!confirm(lang === "fr" ? `Retirer l'accès manager de ${email} ?` : `Remove manager access for ${email}?`)) return;
    setRemoveBusy(email);
    try {
      const remove = httpsCallable(functions, "removeManager");
      await remove({ restaurantId: getRestaurantId(), email });
      onRefresh();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || (lang === "fr" ? "Échec de la suppression" : "Failed to remove"));
    } finally {
      setRemoveBusy(null);
    }
  };

  // Phase 3: messaging + requests
  const [announcementDraft, setAnnouncementDraft] = useState<string>("");
  const [selectedMessageThread, setSelectedMessageThread] = useState<string | null>(null);
  const [managerReplyDraft, setManagerReplyDraft] = useState<string>("");
  const [requestsBusy, setRequestsBusy] = useState<string | null>(null);

  const triggerPostAnnouncement = async () => {
    if (!announcementDraft.trim()) return;
    try {
      await postAnnouncement(announcementDraft.trim());
      setAnnouncementDraft("");
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDeleteAnnouncement = async (id: string) => {
    try {
      await deleteAnnouncement(id);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSendReply = async () => {
    if (!selectedMessageThread || !managerReplyDraft.trim()) return;
    try {
      await sendMessage(selectedMessageThread, "manager", managerReplyDraft.trim());
      setManagerReplyDraft("");
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDecideTimeOff = async (id: string, approve: boolean) => {
    setRequestsBusy(id);
    try {
      await decideTimeOffRequest(id, approve);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setRequestsBusy(null);
    }
  };

  const triggerDecideSwap = async (id: string, approve: boolean) => {
    setRequestsBusy(id);
    try {
      await decideSwap(id, approve);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setRequestsBusy(null);
    }
  };

  // Request notes ("on hold" is just a note — no separate status)
  const [openNoteFor, setOpenNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");

  const triggerSaveTimeOffNote = async (id: string) => {
    try {
      await saveTimeOffNote(id, noteDraft.trim());
      setOpenNoteFor(null);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveSwapNote = async (id: string) => {
    try {
      await saveSwapNote(id, noteDraft.trim());
      setOpenNoteFor(null);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerAddStaff = async () => {
    if (!newStaffName.trim()) return;
    if (appData.staff.some(s => s.name === newStaffName)) {
      alert(t("alreadyInList"));
      return;
    }

    const updatedStaff = [
      ...appData.staff,
      {
        name: newStaffName, role: newStaffRole, rate: newStaffRate, contract: newStaffContract,
        pin: newStaffPin.trim(), active: true, is_minor: newStaffIsMinor,
      }
    ];

    try {
      await saveStaff(updatedStaff);
      onRefresh();
      setNewStaffName("");
      setNewStaffRate(12);
      setNewStaffContract(35);
      setNewStaffPin("");
      setNewStaffIsMinor(false);
      setShowAddStaffModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  const triggerArchiveStaff = async (name: string) => {
    if (!confirm(t("confirmRemoveStaff", { name }))) return;
    const updatedStaff = appData.staff.map(s => s.name === name ? { ...s, active: false } : s);
    try {
      await saveStaff(updatedStaff);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerReactivateStaff = async (name: string) => {
    const updatedStaff = appData.staff.map(s => s.name === name ? { ...s, active: true } : s);
    try {
      await saveStaff(updatedStaff);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDeleteFormerStaffData = async (name: string) => {
    if (formerDeleteVerifyText !== "DELETE") return;
    setDeletingFormerStaff(true);
    try {
      await deleteStaffMemberData(name);
      setSelectedFormerStaff(null);
      setFormerDeleteVerifyText("");
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingFormerStaff(false);
    }
  };

  const triggerSaveStaffMemberFields = async (name: string, fields: Partial<StaffMember>) => {
    const updatedStaff = appData.staff.map(s => {
      if (s.name === name) {
        return { ...s, ...fields };
      }
      return s;
    });

    try {
      await saveStaff(updatedStaff);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSaveWeekNote = async () => {
    try {
      await saveWeekNote(getRangeKey(), weekNoteText);
      onRefresh();
      alert(t("saved"));
    } catch (err) {
      console.error(err);
    }
  };

  const triggerApproveEntry = async (id: number) => {
    const e = appData.entries.find(entry => entry.id === id);
    if (!e) return;
    try {
      await saveEntry({ ...e, status: "approved", correctionNote: undefined, correctionAt: undefined });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDeleteEntry = async (id: number) => {
    if (!confirm(t("confirmDeleteEntry"))) return;
    try {
      await deleteEntry(id);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerApproveAll = async () => {
    try {
      await approveAllEntries();
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerApproveRole = async (role: string) => {
    try {
      await approveEntriesByRole(role);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerClearAll = async () => {
    try {
      await clearAllData();
      onRefresh();
      setDeleteConfirmOpen(false);
      setDeleteVerifyText("");
      alert(t("allDataCleared"));
    } catch (err) {
      console.error(err);
    }
  };

  // ── SCHEDULE PLANNER HANDLERS & HELPERS ────────────────
  const parseTimeToMinutes = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(":").map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };

  const getShiftHours = (s: ScheduledShift) => {
    const start = parseTimeToMinutes(s.startTime);
    let end = parseTimeToMinutes(s.endTime);
    if (end <= start) end += 1440; // Overnight
    return (end - start) / 60;
  };

  const getShiftInterval = (s: ScheduledShift) => {
    const [year, month, day] = s.date.split("-").map(Number);
    const start = new Date(year, month - 1, day);
    const [startH, startM] = s.startTime.split(":").map(Number);
    start.setHours(startH, startM, 0, 0);

    const [endH, endM] = s.endTime.split(":").map(Number);
    const end = new Date(year, month - 1, day);
    end.setHours(endH, endM, 0, 0);

    if (end.getTime() <= start.getTime()) {
      end.setDate(end.getDate() + 1);
    }
    return { start: start.getTime(), end: end.getTime() };
  };

  const getOverlappingShifts = (shift: ScheduledShift, allShifts: ScheduledShift[]): ScheduledShift[] => {
    if (!shift.name) return [];
    const targetInterval = getShiftInterval(shift);
    
    return allShifts.filter(s => {
      if (s.id === shift.id) return false;
      if (s.name !== shift.name) return false;
      
      const interval = getShiftInterval(s);
      return targetInterval.start < interval.end && interval.start < targetInterval.end;
    });
  };

  const checkComplianceWarnings = (shift: ScheduledShift, allShifts: ScheduledShift[]): string[] => {
    const warnings: string[] = [];

    // Always detect overlapping shifts as they are critical scheduling conflicts
    const overlaps = getOverlappingShifts(shift, allShifts);
    overlaps.forEach(os => {
      warnings.push(t("shiftOverlapWarning", {
        name: shift.name,
        start: os.startTime,
        end: os.endTime,
        date: os.date
      }));
    });

    if (!complianceEnforced) return warnings;

    const rules = appData.config.compliance_rules;
    const on = (id: string) => isRuleEnabled(rules, id);
    const staffMember = appData.staff.find(s => s.name === shift.name);
    const isMinor = staffMember?.is_minor === true;

    const sameDayShifts = allShifts.filter(s => s.name === shift.name && s.date === shift.date);
    const dailyHours = sameDayShifts.reduce((sum, s) => sum + getShiftHours(s), 0);

    // Daily work limit (10h)
    if (on("daily10h") && dailyHours > 10) {
      warnings.push(t("dailyLimitWarning", { hours: dailyHours.toFixed(1) }));
    }

    // Minors: max 8h/day
    if (on("minorMaxHours") && isMinor && dailyHours > 8) {
      warnings.push(lang === "fr"
        ? `Mineur : ${dailyHours.toFixed(1)}h ce jour (max légal 8h)`
        : `Minor: ${dailyHours.toFixed(1)}h this day (legal max 8h)`);
    }

    // Daily Rest (11h, or 12h for minors)
    const d = new Date(shift.date);
    d.setDate(d.getDate() - 1);
    const prevDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const prevDayShifts = allShifts.filter(s => s.name === shift.name && s.date === prevDateStr);
    prevDayShifts.forEach(prevShift => {
      const prevEnd = parseTimeToMinutes(prevShift.endTime);
      const start = parseTimeToMinutes(shift.startTime);
      const restMins = (1440 + start) - prevEnd;
      if (on("rest11h") && restMins < 11 * 60) {
        warnings.push(t("dailyRestWarning", {
          name: shift.name, prevEnd: prevShift.endTime, prevDate: prevShift.date, start: shift.startTime, date: shift.date
        }));
      }
      if (on("minorDailyRest") && isMinor && restMins < 12 * 60) {
        warnings.push(lang === "fr"
          ? `Mineur : seulement ${(restMins / 60).toFixed(1)}h de repos avant ce service (min. 12h)`
          : `Minor: only ${(restMins / 60).toFixed(1)}h rest before this shift (min. 12h)`);
      }
    });

    // Minors: no night work (22:00-06:00)
    if (on("minorNightWork") && isMinor) {
      const sH = parseInt(shift.startTime.split(":")[0], 10);
      const eH = parseInt(shift.endTime.split(":")[0], 10);
      const touchesNight = sH >= 22 || sH < 6 || eH > 22 || eH <= 6 || eH < sH;
      if (touchesNight) {
        warnings.push(lang === "fr"
          ? `Mineur : ce service touche la plage de nuit (22h-6h), interdit`
          : `Minor: this shift touches the night window (22:00-06:00), not permitted`);
      }
    }

    // Split-shift break ("coupure") capped at 2h
    if (on("coupure2h") && sameDayShifts.length >= 2) {
      const sorted = [...sameDayShifts].sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
      for (let i = 0; i < sorted.length - 1; i++) {
        const gapMins = parseTimeToMinutes(sorted[i + 1].startTime) - parseTimeToMinutes(sorted[i].endTime);
        if (gapMins > 120) {
          warnings.push(lang === "fr"
            ? `Coupure de ${(gapMins / 60).toFixed(1)}h ce jour (max convention HCR : 2h)`
            : `${(gapMins / 60).toFixed(1)}h split break today (HCR agreement max: 2h)`);
        }
      }
    }

    // 20-min break after 6h continuous (no split recorded)
    if (on("breakAfter6h") && sameDayShifts.length === 1 && dailyHours > 6) {
      warnings.push(lang === "fr"
        ? "Service de plus de 6h sans coupure/pause enregistrée"
        : "Shift over 6h with no recorded break");
    }

    // Weekly aggregates (Monday-Sunday containing this shift's date)
    const shiftDate = new Date(shift.date + "T00:00:00");
    const dow = shiftDate.getDay() || 7;
    const monday = new Date(shiftDate);
    monday.setDate(shiftDate.getDate() - dow + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekShifts = allShifts.filter(s => {
      if (s.name !== shift.name) return false;
      const sd = new Date(s.date + "T00:00:00");
      return sd >= monday && sd <= sunday;
    });
    const weeklyHours = weekShifts.reduce((sum, s) => sum + getShiftHours(s), 0);
    const distinctDays = new Set(weekShifts.map(s => s.date)).size;

    if (on("weekly48h") && weeklyHours > 48) {
      warnings.push(lang === "fr"
        ? `${weeklyHours.toFixed(1)}h planifiées cette semaine (max légal 48h)`
        : `${weeklyHours.toFixed(1)}h scheduled this week (legal max 48h)`);
    }
    if (on("minorMaxHours") && isMinor && weeklyHours > 35) {
      warnings.push(lang === "fr"
        ? `Mineur : ${weeklyHours.toFixed(1)}h cette semaine (max légal 35h)`
        : `Minor: ${weeklyHours.toFixed(1)}h this week (legal max 35h)`);
    }
    if (on("max6Days") && distinctDays > 6) {
      warnings.push(lang === "fr" ? "Plus de 6 jours travaillés cette semaine" : "More than 6 working days this week");
    }
    if (on("overtime43h") && weeklyHours > 43) {
      warnings.push(lang === "fr"
        ? `Au-delà de la 43e heure cette semaine (majoration +50%)`
        : `Beyond the 43rd hour this week (+50% surcharge tier)`);
    }

    // Weekly rest: needs at least one 35h consecutive gap somewhere in the week
    if (on("weeklyRest35h") && weekShifts.length > 0) {
      const sorted = [...weekShifts].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
      let maxGapMins = sorted.length > 1 ? -Infinity : Infinity;
      for (let i = 0; i < sorted.length - 1; i++) {
        const endDT = new Date(`${sorted[i].date}T${sorted[i].endTime}`);
        const startDT = new Date(`${sorted[i + 1].date}T${sorted[i + 1].startTime}`);
        const gapMins = (startDT.getTime() - endDT.getTime()) / 60000;
        if (gapMins > maxGapMins) maxGapMins = gapMins;
      }
      if (sorted.length > 1 && maxGapMins < 35 * 60) {
        warnings.push(lang === "fr"
          ? "Aucun repos de 35h consécutives cette semaine"
          : "No 35-consecutive-hour rest period this week");
      }
    }

    // Informational: Sunday / public holiday shifts
    if (on("sundayWork") && shiftDate.getDay() === 0) {
      warnings.push(lang === "fr" ? "Service dominical — vérifiez la dérogation et la compensation" : "Sunday shift — check the derogation and compensation apply");
    }
    if (on("holidayWork")) {
      const holiday = getFrenchHoliday(shift.date);
      if (holiday) {
        const name = lang === "fr" ? holiday.nameFr : holiday.nameEn;
        warnings.push(lang === "fr" ? `Jour férié (${name}) — vérifiez la compensation` : `Public holiday (${name}) — check compensation applies`);
      }
    }

    return warnings;
  };

  /**
   * Same rule set as checkComplianceWarnings, but retroactive — runs
   * against actual logged HourEntry records instead of planned
   * ScheduledShifts. Used for the 🚩-style flag in the Entries tab so a
   * manager sees WHY an entry is flagged, not just that it is.
   */
  const checkEntryComplianceWarnings = (entry: HourEntry, allEntries: HourEntry[]): string[] => {
    const warnings: string[] = [];
    if (!complianceEnforced || entry.type !== "worked") return warnings;

    const rules = appData.config.compliance_rules;
    const on = (id: string) => isRuleEnabled(rules, id);
    const staffMember = appData.staff.find(s => s.name === entry.name);
    const isMinor = staffMember?.is_minor === true;

    const entryShifts: Shift[] = entry.shifts && entry.shifts.length > 0
      ? entry.shifts
      : (entry.startTime && entry.endTime ? [{ startTime: entry.startTime, endTime: entry.endTime, hours: entry.hours, overnight: false }] : []);

    const dailyHours = entry.hours;

    if (on("daily10h") && dailyHours > 10) {
      warnings.push(t("dailyLimitWarning", { hours: dailyHours.toFixed(1) }));
    }
    if (on("minorMaxHours") && isMinor && dailyHours > 8) {
      warnings.push(lang === "fr" ? `Mineur : ${dailyHours.toFixed(1)}h ce jour (max légal 8h)` : `Minor: ${dailyHours.toFixed(1)}h this day (legal max 8h)`);
    }

    // Daily rest vs. the previous day's worked entry
    if (entryShifts.length > 0) {
      const d = new Date(entry.date);
      d.setDate(d.getDate() - 1);
      const prevDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const prevEntry = allEntries.find(e => e.name === entry.name && e.date === prevDateStr && e.type === "worked");
      if (prevEntry) {
        const prevShifts: Shift[] = prevEntry.shifts && prevEntry.shifts.length > 0
          ? prevEntry.shifts
          : (prevEntry.startTime && prevEntry.endTime ? [{ startTime: prevEntry.startTime, endTime: prevEntry.endTime, hours: prevEntry.hours, overnight: false }] : []);
        if (prevShifts.length > 0) {
          const prevEnd = parseTimeToMinutes(prevShifts[prevShifts.length - 1].endTime);
          const start = parseTimeToMinutes(entryShifts[0].startTime);
          const restMins = (1440 + start) - prevEnd;
          if (on("rest11h") && restMins < 11 * 60) {
            warnings.push(lang === "fr"
              ? `Seulement ${(restMins / 60).toFixed(1)}h de repos avant ce service (min. légal 11h)`
              : `Only ${(restMins / 60).toFixed(1)}h rest before this shift (legal min. 11h)`);
          }
          if (on("minorDailyRest") && isMinor && restMins < 12 * 60) {
            warnings.push(lang === "fr"
              ? `Mineur : seulement ${(restMins / 60).toFixed(1)}h de repos avant ce service (min. 12h)`
              : `Minor: only ${(restMins / 60).toFixed(1)}h rest before this shift (min. 12h)`);
          }
        }
      }
    }

    // Minors: no night work
    if (on("minorNightWork") && isMinor) {
      entryShifts.forEach(s => {
        const sH = parseInt(s.startTime.split(":")[0], 10);
        const eH = parseInt(s.endTime.split(":")[0], 10);
        const touchesNight = sH >= 22 || sH < 6 || eH > 22 || eH <= 6 || eH < sH;
        if (touchesNight) {
          warnings.push(lang === "fr" ? "Mineur : service touchant la plage de nuit (22h-6h)" : "Minor: shift touches the night window (22:00-06:00)");
        }
      });
    }

    // Split shift break ("coupure")
    if (on("coupure2h") && entryShifts.length >= 2) {
      const sorted = [...entryShifts].sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
      for (let i = 0; i < sorted.length - 1; i++) {
        const gapMins = parseTimeToMinutes(sorted[i + 1].startTime) - parseTimeToMinutes(sorted[i].endTime);
        if (gapMins > 120) {
          warnings.push(lang === "fr"
            ? `Coupure de ${(gapMins / 60).toFixed(1)}h ce jour (max convention HCR : 2h)`
            : `${(gapMins / 60).toFixed(1)}h split break today (HCR agreement max: 2h)`);
        }
      }
    }

    if (on("breakAfter6h") && entryShifts.length === 1 && dailyHours > 6) {
      warnings.push(lang === "fr" ? "Service de plus de 6h sans coupure/pause enregistrée" : "Shift over 6h with no recorded break");
    }

    // Weekly aggregates
    const entryDate = new Date(entry.date + "T00:00:00");
    const dow = entryDate.getDay() || 7;
    const monday = new Date(entryDate);
    monday.setDate(entryDate.getDate() - dow + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekEntries = allEntries.filter(e => {
      if (e.name !== entry.name || e.type !== "worked") return false;
      const ed = new Date(e.date + "T00:00:00");
      return ed >= monday && ed <= sunday;
    });
    const weeklyHours = weekEntries.reduce((sum, e) => sum + e.hours, 0);
    const distinctDays = new Set(weekEntries.map(e => e.date)).size;

    if (on("weekly48h") && weeklyHours > 48) {
      warnings.push(lang === "fr" ? `${weeklyHours.toFixed(1)}h travaillées cette semaine (max légal 48h)` : `${weeklyHours.toFixed(1)}h worked this week (legal max 48h)`);
    }
    if (on("minorMaxHours") && isMinor && weeklyHours > 35) {
      warnings.push(lang === "fr" ? `Mineur : ${weeklyHours.toFixed(1)}h cette semaine (max légal 35h)` : `Minor: ${weeklyHours.toFixed(1)}h this week (legal max 35h)`);
    }
    if (on("max6Days") && distinctDays > 6) {
      warnings.push(lang === "fr" ? "Plus de 6 jours travaillés cette semaine" : "More than 6 working days this week");
    }
    if (on("overtime43h") && weeklyHours > 43) {
      warnings.push(lang === "fr" ? "Au-delà de la 43e heure cette semaine (majoration +50%)" : "Beyond the 43rd hour this week (+50% surcharge tier)");
    }

    if (on("weeklyRest35h") && weekEntries.length > 1) {
      const sortedEntries = [...weekEntries].sort((a, b) => a.date.localeCompare(b.date));
      let maxGapMins = -Infinity;
      for (let i = 0; i < sortedEntries.length - 1; i++) {
        const curShifts: Shift[] = sortedEntries[i].shifts?.length ? sortedEntries[i].shifts : (sortedEntries[i].startTime && sortedEntries[i].endTime ? [{ startTime: sortedEntries[i].startTime!, endTime: sortedEntries[i].endTime!, hours: sortedEntries[i].hours, overnight: false }] : []);
        const nextShifts: Shift[] = sortedEntries[i + 1].shifts?.length ? sortedEntries[i + 1].shifts : (sortedEntries[i + 1].startTime && sortedEntries[i + 1].endTime ? [{ startTime: sortedEntries[i + 1].startTime!, endTime: sortedEntries[i + 1].endTime!, hours: sortedEntries[i + 1].hours, overnight: false }] : []);
        if (curShifts.length === 0 || nextShifts.length === 0) continue;
        const endDT = new Date(`${sortedEntries[i].date}T${curShifts[curShifts.length - 1].endTime}`);
        const startDT = new Date(`${sortedEntries[i + 1].date}T${nextShifts[0].startTime}`);
        const gapMins = (startDT.getTime() - endDT.getTime()) / 60000;
        if (gapMins > maxGapMins) maxGapMins = gapMins;
      }
      if (maxGapMins < 35 * 60) {
        warnings.push(lang === "fr" ? "Aucun repos de 35h consécutives cette semaine" : "No 35-consecutive-hour rest period this week");
      }
    }

    if (on("sundayWork") && entryDate.getDay() === 0) {
      warnings.push(lang === "fr" ? "Service dominical — vérifiez la dérogation et la compensation" : "Sunday shift — check the derogation and compensation apply");
    }
    if (on("holidayWork")) {
      const holiday = getFrenchHoliday(entry.date);
      if (holiday) {
        const name = lang === "fr" ? holiday.nameFr : holiday.nameEn;
        warnings.push(lang === "fr" ? `Jour férié (${name}) — vérifiez la compensation` : `Public holiday (${name}) — check compensation applies`);
      }
    }

    return warnings;
  };

  const getScheduleWeekDates = () => {
    const today = new Date();
    const day = today.getDay() || 7; // Monday-first
    const monday = new Date(today);
    monday.setDate(today.getDate() - day + 1 + (scheduleOffset * 7));
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
        num: d.getDate(),
        fullLabel: d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "short", day: "numeric", month: "short" })
      });
    }
    return dates;
  };

  const getActiveMonthDetails = () => {
    const today = new Date();
    const activeMonthDate = new Date(today.getFullYear(), today.getMonth() + scheduleMonthOffset, 1);
    const year = activeMonthDate.getFullYear();
    const month = activeMonthDate.getMonth(); // 0-indexed
    const monthName = activeMonthDate.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric" });
    
    // Get first day of the month (1 = Monday, ..., 7 = Sunday)
    const rawDay = new Date(year, month, 1).getDay();
    const firstDayIndex = rawDay === 0 ? 7 : rawDay; 
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    return { year, month, monthName, firstDayIndex, totalDays };
  };

  const getMonthlyGridDays = () => {
    const { year, month, firstDayIndex, totalDays } = getActiveMonthDetails();
    const daysGrid = [];
    
    // Padding from previous month
    const prevMonthDate = new Date(year, month, 0);
    const prevMonthDaysCount = prevMonthDate.getDate();
    const startPadding = firstDayIndex - 1; // days to pad on Monday-first calendar
    
    for (let i = startPadding - 1; i >= 0; i--) {
      const dayNum = prevMonthDaysCount - i;
      const d = new Date(year, month - 1, dayNum);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, "0");
      const dStr = String(d.getDate()).padStart(2, "0");
      daysGrid.push({
        dateStr: `${yStr}-${mStr}-${dStr}`,
        num: dayNum,
        isCurrentMonth: false,
      });
    }
    
    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(year, month, i);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, "0");
      const dStr = String(d.getDate()).padStart(2, "0");
      daysGrid.push({
        dateStr: `${yStr}-${mStr}-${dStr}`,
        num: i,
        isCurrentMonth: true,
      });
    }
    
    // Padding for next month
    const totalCells = daysGrid.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
      const d = new Date(year, month + 1, i);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, "0");
      const dStr = String(d.getDate()).padStart(2, "0");
      daysGrid.push({
        dateStr: `${yStr}-${mStr}-${dStr}`,
        num: i,
        isCurrentMonth: false,
      });
    }
    
    return daysGrid;
  };

  const getWeekDatesOffset = (offset: number) => {
    const today = new Date();
    const day = today.getDay() || 7; // Monday-first
    const monday = new Date(today);
    monday.setDate(today.getDate() - day + 1 + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, "0");
      const dStr = String(d.getDate()).padStart(2, "0");
      dates.push(`${yStr}-${mStr}-${dStr}`);
    }
    return dates;
  };

  const handleOpenAddShift = (name: string, date: string) => {
    setSelectedScheduleShift(null);
    const staffMember = appData.staff.find(s => s.name === name);
    setScheduleForm({
      name: name,
      date: date || new Date().toISOString().split("T")[0],
      startTime: "09:00",
      endTime: "15:30",
      role: staffMember ? staffMember.role : "server"
    });
    setScheduleModalOpen(true);
  };

  const handleOpenEditShift = (shift: ScheduledShift) => {
    setSelectedScheduleShift(shift);
    setScheduleForm({
      name: shift.name,
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      role: shift.role
    });
    setScheduleModalOpen(true);
  };

  const handleSaveScheduleShift = async () => {
    const hours = getShiftHours({
      id: "",
      name: scheduleForm.name,
      date: scheduleForm.date,
      startTime: scheduleForm.startTime,
      endTime: scheduleForm.endTime,
      hours: 0,
      role: scheduleForm.role
    });

    const shift: ScheduledShift = {
      id: selectedScheduleShift ? selectedScheduleShift.id : `shift-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name: scheduleForm.name,
      date: scheduleForm.date,
      startTime: scheduleForm.startTime,
      endTime: scheduleForm.endTime,
      hours: hours,
      role: scheduleForm.role
    };

    try {
      await saveScheduledShift(shift);
      onRefresh();
      setScheduleModalOpen(false);
      setSelectedScheduleShift(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveAsCopyScheduleShift = async () => {
    const hours = getShiftHours({
      id: "",
      name: scheduleForm.name,
      date: scheduleForm.date,
      startTime: scheduleForm.startTime,
      endTime: scheduleForm.endTime,
      hours: 0,
      role: scheduleForm.role
    });

    const shift: ScheduledShift = {
      id: `shift-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name: scheduleForm.name,
      date: scheduleForm.date,
      startTime: scheduleForm.startTime,
      endTime: scheduleForm.endTime,
      hours: hours,
      role: scheduleForm.role
    };

    try {
      await saveScheduledShift(shift);
      onRefresh();
      setScheduleModalOpen(false);
      setSelectedScheduleShift(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteScheduleShift = async (id: string) => {
    if (!confirm(t("deleteShiftPrompt"))) return;
    try {
      await deleteScheduledShift(id);
      onRefresh();
      setScheduleModalOpen(false);
      setSelectedScheduleShift(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDuplicateShiftDirectly = async (e: React.MouseEvent, shift: ScheduledShift) => {
    e.stopPropagation();
    const hours = getShiftHours(shift);
    const newShift: ScheduledShift = {
      ...shift,
      id: `shift-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      hours: hours
    };
    try {
      await saveScheduledShift(newShift);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyPreviousWeekSchedule = async () => {
    if (!confirm(t("copyWeekPrompt"))) return;
    
    const prevWeekDays = getWeekDatesOffset(scheduleOffset - 1);
    const currWeekDays = getWeekDatesOffset(scheduleOffset);
    
    const allShifts = appData.scheduledShifts || [];
    const prevWeekShifts = allShifts.filter(s => prevWeekDays.includes(s.date));
    
    if (prevWeekShifts.length === 0) {
      alert(lang === "fr" ? "Aucun service planifié trouvé dans la semaine précédente." : "No scheduled shifts found in the previous week.");
      return;
    }
    
    try {
      for (const shift of prevWeekShifts) {
        const prevDayIdx = prevWeekDays.indexOf(shift.date);
        const correspondingCurrDay = currWeekDays[prevDayIdx];
        
        const newShift: ScheduledShift = {
          id: `shift-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name: shift.name,
          date: correspondingCurrDay,
          startTime: shift.startTime,
          endTime: shift.endTime,
          hours: shift.hours,
          role: shift.role,
        };
        await saveScheduledShift(newShift);
      }
      onRefresh();
      alert(lang === "fr" ? "Planning copié avec succès !" : "Schedule copied successfully!");
    } catch (err) {
      console.error(err);
    }
  };

  const handleDragStart = (e: React.DragEvent, shiftId: string) => {
    e.dataTransfer.setData("text/plain", shiftId);
  };

  const handleDropShift = async (e: React.DragEvent, targetDate: string, targetName: string) => {
    e.preventDefault();
    const shiftId = e.dataTransfer.getData("text/plain");
    const allShifts = appData.scheduledShifts || [];
    const matchedShift = allShifts.find(s => s.id === shiftId);
    if (!matchedShift) return;
    
    const targetMember = appData.staff.find(s => s.name === targetName);
    const updatedShift: ScheduledShift = {
      ...matchedShift,
      date: targetDate,
      name: targetName,
      role: targetMember ? targetMember.role : matchedShift.role
    };
    
    try {
      await saveScheduledShift(updatedShift);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Inline edit in Saisies
  const startInlineEdit = (e: HourEntry) => {
    setInlineEditId(e.id);
    setInlineEditHours(String(e.hours));
  };

  const saveInlineEdit = async (id: number) => {
    const hours = parseFloat(inlineEditHours);
    if (isNaN(hours)) return;

    const matched = appData.entries.find(e => e.id === id);
    if (!matched) return;

    try {
      await saveEntry({ ...matched, hours });
      onRefresh();
      setInlineEditId(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Advances Management
  const triggerAddAdvance = async () => {
    const amt = parseFloat(newAdvAmount);
    if (!amt || amt <= 0 || !advanceModalStaff) return;

    const adv: CashAdvance = {
      id: Date.now().toString(),
      name: advanceModalStaff,
      amount: amt,
      date: newAdvDate || new Date().toISOString().split("T")[0],
      note: newAdvNote.trim(),
      createdAt: new Date().toISOString()
    };

    try {
      await saveAdvance(adv);
      onRefresh();
      setNewAdvAmount("");
      setNewAdvNote("");
    } catch (err) {
      console.error(err);
    }
  };

  const triggerDeleteAdvance = async (id: string) => {
    if (!confirm(getLang() === "fr" ? "Supprimer cette avance ?" : "Delete this advance?")) return;
    try {
      await deleteAdvance(id);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Calendar Navigation & Helpers
  const calPrev = () => {
    let nextMonth = calMonth - 1;
    let nextYear = calYear;
    if (nextMonth < 0) {
      nextMonth = 11;
      nextYear--;
    }
    setCalMonth(nextMonth);
    setCalYear(nextYear);
  };

  const calNext = () => {
    let nextMonth = calMonth + 1;
    let nextYear = calYear;
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear++;
    }
    setCalMonth(nextMonth);
    setCalYear(nextYear);
  };

  const selectDay = (dateStr: string) => {
    setSelectedDay(dateStr);
    setDayNoteInput(appData.dayNotes[dateStr] || "");
  };

  const triggerSaveDayNote = async () => {
    if (!selectedDay) return;
    try {
      await saveDayNote(selectedDay, dayNoteText);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Copy last week
  const triggerCopyLastWeek = async () => {
    if (!confirm(t("confirmCopyLastWeek"))) return;
    const { start: cs } = getRange();
    const { start: ps, end: pe } = getRange(rangeOffset - 1);
    
    const approvedLastWeek = appData.entries.filter(e => {
      const d = new Date(e.date);
      return d >= ps && d <= pe && e.status === "approved";
    });

    const diff = (cs.getTime() - ps.getTime()) / (1000 * 60 * 60 * 24);
    const existingKeys = new Set(appData.entries.map(e => e.name + "|" + e.date));

    let count = 0;
    for (const e of approvedLastWeek) {
      const nd = new Date(e.date);
      nd.setDate(nd.getDate() + diff);
      const ndStr = nd.toISOString().split("T")[0];

      if (!existingKeys.has(e.name + "|" + ndStr)) {
        count++;
        await saveEntry({
          ...e,
          id: Date.now() + Math.random(),
          date: ndStr,
          submittedAt: new Date().toISOString(),
          status: "pending"
        });
      }
    }

    if (count === 0) {
      alert(t("nothingToCopy"));
    } else {
      onRefresh();
      alert(t("entriesCopied", { n: count }));
    }
  };

  // ── DATA PREPARATION FOR TABLES ─────────────────────────
  const data = filterByRole(getRangeData());
  const approved = (e: HourEntry) => e.status !== "pending";

  const getWeekHoursForSummary = (name: string, excludeDate?: string) => {
    return data
      .filter(e => e.name === name && e.type === "worked" && approved(e) && e.date !== excludeDate)
      .reduce((sum, e) => sum + e.hours, 0);
  };

  // Advances Filtered
  const getAdvancesByScope = (name: string) => {
    const list = appData.advances.filter(a => a.name === name);
    if (advScope === "period") {
      const { start, end } = getRange();
      return list.filter(a => {
        const d = new Date(a.date);
        return d >= start && d <= end;
      });
    }
    return list;
  };

  const triggerExportPayrollCSV = () => {
    const rows = appData.staff
      .filter(s => activeRoleFilter === "all" || s.role === activeRoleFilter)
      .map(member => {
        const personEntries = data.filter(e => e.name === member.name && e.status === "approved");
        const hours = personEntries.filter(e => e.type === "worked").reduce((sum, e) => sum + e.hours, 0);
        const contract = getContractHours(member.name);
        const ot = Math.max(0, hours - contract);
        const gross = hours * member.rate;
        const net = gross * (1 - taxRate / 100);
        const advs = getAdvancesByScope(member.name).reduce((sum, a) => sum + a.amount, 0);
        const toPay = Math.max(net - advs, 0);
        return [member.name, ROLES[member.role], hours.toFixed(2), ot.toFixed(2), member.rate.toFixed(2), gross.toFixed(2), (gross - net).toFixed(2), net.toFixed(2), advs.toFixed(2), toPay.toFixed(2)];
      });

    const headers = [t("staff"), t("role"), t("hours"), "Overtime", "Rate", "Gross", `Tax (${taxRate}%)`, "Net", "Advances", t("toPay")];
    const csvLines = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","));
    const csvContent = csvLines.join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `brigado-payroll-${getRangeLabel().replace(/[^a-zA-Z0-9]+/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── RENDER CONTROLLER ──────────────────────────────────
  if (authChecking) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="w-8 h-8 rounded-full border-4 border-lime-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 w-full max-w-sm text-center space-y-5 animate-fade-in shadow-xl">
          <div className="text-4xl">🔒</div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">{t("managerAccess")}</h2>
            <p className="text-xs text-slate-400 mt-1">{t("enterEmailPassword")}</p>
          </div>
          <div className="space-y-2">
            <input
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-lime-400/50"
              type="email"
              placeholder={t("email")}
              value={emailInput}
              autoComplete="username"
              onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
            <input
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-lime-400/50"
              type="password"
              placeholder={t("password")}
              value={passwordInput}
              autoComplete="current-password"
              onChange={e => setPasswordInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
          </div>
          <button
            className="w-full py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-sm disabled:opacity-50"
            onClick={handleLogin}
            disabled={loginBusy}
          >
            {loginBusy ? "…" : t("enterDashboard")}
          </button>
          <div className="flex items-center gap-2 text-[10px] text-slate-600">
            <div className="flex-1 h-px bg-slate-800" />
            {t("or")}
            <div className="flex-1 h-px bg-slate-800" />
          </div>
          <button
            className="w-full py-3 bg-slate-950 border border-slate-800 text-slate-200 font-semibold rounded-xl hover:bg-slate-800 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            onClick={handleGoogleLogin}
            disabled={loginBusy}
          >
            {t("signInWithGoogle")}
          </button>
          {loginError && <p className="text-xs text-rose-400">{loginError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6" id="manager-app">
      <style>{`
        @media print {
          body, html, #root {
            background-color: white !important;
            color: #0f172a !important;
          }
          #manager-app {
            padding: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            color: #0f172a !important;
          }
          .bg-slate-900, .bg-slate-950, .bg-slate-950\/20, .bg-slate-950\/80 {
            background-color: #ffffff !important;
            color: #0f172a !important;
            border-color: #cbd5e1 !important;
          }
          .text-slate-100, .text-slate-200, .text-slate-300, .text-slate-400 {
            color: #0f172a !important;
          }
          .text-slate-500, .text-slate-600 {
            color: #475569 !important;
          }
          .border-slate-800, .border-slate-850, .border-slate-800\/20, .border-slate-800\/40, .border-slate-800\/60 {
            border-color: #cbd5e1 !important;
          }
          td, th {
            border-color: #cbd5e1 !important;
            color: #0f172a !important;
          }
          .group\/shift, [draggable="true"] {
            background-color: #f1f5f9 !important;
            border: 1.5px solid #475569 !important;
            color: #0f172a !important;
          }
          .group\/shift span, .group\/shift div {
            color: #0f172a !important;
          }
          .print\\:hidden, #manager-app > div.print\\:hidden, button, .bg-slate-950.border.border-slate-800 {
            display: none !important;
          }
          @page {
            size: landscape;
            margin: 12mm;
          }
        }
      `}</style>
      {/* HEADERBAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/60 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-lime-400/10 border border-lime-400/30 rounded-xl flex items-center justify-center overflow-hidden p-1.5">
            <img src={logoIcon} alt="Brigado" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100">{restoName} — Admin</h1>
            <p className="text-xs text-slate-400">{t("overview")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* TAB SWITCHES */}
          <div className="flex bg-slate-950 border border-slate-800/80 rounded-xl p-1 text-xs">
            {["overview", "calendar", "entries", "payroll", "schedule", "requests", "messages", "stats", "settings"]
              .filter(tab => tab !== "schedule" || enableScheduling)
              .map(tab => {
                const isActive = activeTab === tab;
                const hasAlert = (tab === "entries" && pendingEntries.length > 0)
                  || (tab === "requests" && requestsBadgeCount > 0)
                  || (tab === "messages" && messagesBadgeCount > 0);
                return (
                  <button
                    key={tab}
                    className={`relative px-3 py-2 rounded-lg font-semibold transition-all ${isActive ? "bg-lime-400/10 text-lime-400 font-bold" : "text-slate-400 hover:text-slate-100"}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === "schedule" ? t("tabSchedule") : t(tab)}
                    {hasAlert && (
                      <span className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full" />
                    )}
                  </button>
                );
              })}
          </div>

          <div className="flex gap-1 bg-slate-950 border border-slate-800 rounded-full p-1">
            <button 
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${lang === "fr" ? "bg-lime-400 text-slate-950" : "text-slate-400 hover:text-slate-100"}`}
              onClick={() => setLang("fr")}
            >
              FR
            </button>
            <button 
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${lang === "en" ? "bg-lime-400 text-slate-950" : "text-slate-400 hover:text-slate-100"}`}
              onClick={() => setLang("en")}
            >
              EN
            </button>
          </div>

          <button
            className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-400/40 transition-all print:hidden"
            onClick={handleLogout}
          >
            {t("signOut")}
          </button>
        </div>
      </div>

      {/* ── APERÇU (OVERVIEW) TAB ───────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-fade-in">
          {/* RANGE SELECT */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
              {(["week", "month", "year", "custom"] as const).map(mode => (
                <button
                  key={mode}
                  className={`px-3 py-1.5 rounded-lg transition-all ${rangeMode === mode ? "bg-lime-400/10 text-lime-400 font-bold" : "text-slate-400 hover:text-slate-200"}`}
                  onClick={() => { setRangeMode(mode); setRangeOffset(0); }}
                >
                  {t(mode)}
                </button>
              ))}
            </div>
            {rangeMode !== "custom" && (
              <div className="flex items-center gap-1.5">
                <button className="w-8 h-8 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 flex items-center justify-center font-bold" onClick={() => setRangeOffset(prev => prev - 1)}>‹</button>
                <button className="w-8 h-8 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 flex items-center justify-center font-bold" onClick={() => setRangeOffset(prev => prev + 1)}>›</button>
              </div>
            )}
            <span className="text-sm font-semibold text-slate-200">{getRangeLabel()}</span>
            {rangeMode === "custom" && (
              <div className="flex items-center gap-2 text-xs">
                <input type="date" className="bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-200" value={customStart} onChange={e => setCustomStart(e.target.value)} />
                <span className="text-slate-500">→</span>
                <input type="date" className="bg-slate-950 border border-slate-800 rounded-xl p-2 text-slate-200" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            )}
          </div>

          {/* CURRENTLY CLOCKED IN */}
          {appData.activeClockIns.length > 0 && (
            <div className="bg-lime-400/[0.04] border border-lime-400/20 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-lime-400 uppercase tracking-wider flex items-center gap-2">
                <Clock size={14} /> {lang === "fr" ? "Actuellement pointés" : "Currently clocked in"} ({appData.activeClockIns.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {appData.activeClockIns.map(a => {
                  const mins = Math.max(0, Math.round((Date.now() - new Date(a.clockInAt).getTime()) / 60000));
                  const h = Math.floor(mins / 60), m = mins % 60;
                  return (
                    <div key={a.name} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2">
                      <span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse" />
                      <span className="text-xs font-semibold text-slate-200">{a.name}</span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {new Date(a.clockInAt).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })} · {h}h{String(m).padStart(2, "0")}
                      </span>
                      {a.flagged && <span className="text-amber-400 text-xs cursor-help" title={t("flaggedEntryTooltip")}>🚩</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PENDING NOTIFICATION SECTION */}
          {pendingEntries.length > 0 && (
            <div className="bg-amber-400/[0.04] border border-amber-400/30 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                  <AlertCircle size={14} /> {t("awaitingApproval")} ({pendingEntries.length})
                </h3>
                <button 
                  className="px-4 py-1.5 bg-amber-400 text-slate-950 text-xs font-bold rounded-xl hover:bg-amber-300 transition-all"
                  onClick={triggerApproveAll}
                >
                  {t("approveAll")}
                </button>
              </div>
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {pendingEntries.map(e => (
                  <div key={e.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-200 text-sm">{e.name}</strong>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-slate-400 bg-slate-900 border border-slate-800">
                          {ROLES[getRole(e.name)]}
                        </span>
                      </div>
                      <div className="text-slate-400 mt-1">
                        {e.date} · {t(e.type)} {e.type === "worked" ? `· ${e.startTime} → ${e.endTime} · ${e.hours.toFixed(1)}h` : ""}
                      </div>
                      {e.note && <div className="text-slate-500 italic mt-1">"{e.note}"</div>}
                      {e.status === "correction" && (
                        <div className="mt-2 p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-[11px]">
                          <strong>{t("workerSays")}</strong> "{e.correctionNote}"
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      <button className="px-3 py-1.5 bg-lime-400 text-slate-950 font-bold rounded-lg hover:bg-lime-300 transition-all" onClick={() => triggerApproveEntry(e.id)}>✓ {t("approve")}</button>
                      {e.status === "correction" && (
                        <button className="px-3 py-1.5 border border-slate-800 bg-slate-900 rounded-lg text-slate-300" onClick={() => editEntryInline(e.id)}>{t("editFix")}</button>
                      )}
                      <button className="px-3 py-1.5 border border-slate-800 bg-slate-900 rounded-lg text-rose-400 hover:border-rose-500/30" onClick={() => triggerDeleteEntry(e.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ROLE DEPT FILTER */}
          <div className="flex flex-wrap items-center gap-2">
            <button 
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${activeRoleFilter === "all" ? "bg-lime-400/10 border-lime-400 text-lime-400 font-bold" : "bg-slate-900/60 border-slate-800 text-slate-400"}`}
              onClick={() => setActiveRoleFilter("all")}
            >
              {t("allRoles")}
            </button>
            {(Object.keys(ROLES) as RoleType[]).map(r => {
              const active = activeRoleFilter === r;
              const col = RC[r];
              return (
                <button
                  key={r}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all`}
                  style={{
                    backgroundColor: active ? `${col}15` : "rgba(15,23,42,0.6)",
                    borderColor: active ? col : "rgba(30,41,59,0.8)",
                    color: active ? col : "#94a3b8"
                  }}
                  onClick={() => setActiveRoleFilter(r)}
                >
                  <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: col }} />
                  {ROLES[r]}
                </button>
              );
            })}
          </div>

          {/* MAIN STATS PREVIEWS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Net Cost */}
            {(() => {
              const approvedOnly = (e: HourEntry) => e.status === "approved";
              const gross = data.filter(e => e.type === "worked" && approvedOnly(e)).reduce((sum, e) => {
                const member = appData.staff.find(s => s.name === e.name);
                const r = member ? member.rate : 0;
                return sum + e.hours * r;
              }, 0);
              const net = gross * (1 - taxRate / 100);
              
              const prevData = getRangeData(rangeOffset - 1);
              const prevGross = prevData.filter(e => e.type === "worked" && approvedOnly(e)).reduce((sum, e) => {
                const member = appData.staff.find(s => s.name === e.name);
                const r = member ? member.rate : 0;
                return sum + e.hours * r;
              }, 0);
              const prevNet = prevGross * (1 - taxRate / 100);
              const dCost = net - prevNet;
              
              return (
                <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("netCostEstimated")}</div>
                  <div className="text-3xl font-mono font-bold text-lime-400">€{net.toFixed(0)}</div>
                  <div className={`text-xs ${dCost > 0 ? "text-rose-400" : dCost < 0 ? "text-lime-400" : "text-slate-500"}`}>
                    {dCost > 0 ? "↑" : dCost < 0 ? "↓" : "→"} €{Math.abs(dCost).toFixed(0)} {t("vsPrevPeriod")}
                  </div>
                </div>
              );
            })()}

            {/* Total Hours */}
            {(() => {
              const approvedOnly = (e: HourEntry) => e.status === "approved";
              const hours = data.filter(e => e.type === "worked" && approvedOnly(e)).reduce((sum, e) => sum + e.hours, 0);
              const prevData = getRangeData(rangeOffset - 1);
              const prevHours = prevData.filter(e => e.type === "worked" && approvedOnly(e)).reduce((sum, e) => sum + e.hours, 0);
              const dHours = hours - prevHours;

              return (
                <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("totalHoursLabel")}</div>
                  <div className="text-3xl font-mono font-bold text-slate-100">{hours.toFixed(1)}h</div>
                  <div className={`text-xs ${dHours > 0 ? "text-lime-400" : dHours < 0 ? "text-rose-400" : "text-slate-500"}`}>
                    {dHours > 0 ? "↑" : dHours < 0 ? "↓" : "→"} {Math.abs(dHours).toFixed(1)}h {t("vsPrevPeriod")}
                  </div>
                </div>
              );
            })()}

            {/* Overtime Alerts */}
            {(() => {
              const otAlertsCount = appData.staff.filter(s => {
                if (activeRoleFilter !== "all" && s.role !== activeRoleFilter) return false;
                const hrs = getWeekHoursForSummary(s.name);
                return hrs > getContractHours(s.name);
              }).length;

              return (
                <div className={`bg-slate-900 border rounded-2xl p-4 space-y-2 ${otAlertsCount > 0 ? "border-rose-500/30" : "border-slate-800/80"}`}>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("overtimeAlerts")}</div>
                  <div className={`text-3xl font-mono font-bold ${otAlertsCount > 0 ? "text-rose-400" : "text-slate-100"}`}>{otAlertsCount}</div>
                  <div className="text-[11px] text-slate-500">au-dessus du contrat</div>
                </div>
              );
            })()}

            {/* Total Absences */}
            {(() => {
              const absCount = data.filter(e => e.type === "absent" || e.type === "sick").length;
              return (
                <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("absences")}</div>
                  <div className="text-3xl font-mono font-bold text-slate-100">{absCount}</div>
                  <div className="text-[11px] text-slate-500">{t("currentPeriod")}</div>
                </div>
              );
            })()}
          </div>

          {/* PER PERSON TABLE */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-800/60 bg-slate-950/20">
              <h3 className="text-sm font-semibold text-slate-100">{t("perPerson")}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/40 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="p-4">{t("staff")}</th>
                    <th className="p-4">{t("role")}</th>
                    <th className="p-4">{t("hours")}</th>
                    <th className="p-4">Contrat</th>
                    <th className="p-4 w-44">Utilisation</th>
                    <th className="p-4">H. sup.</th>
                    <th className="p-4">{t("netCost")}</th>
                    <th className="p-4">{t("status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {appData.staff
                    .filter(s => activeRoleFilter === "all" || s.role === activeRoleFilter)
                    .map(member => {
                      const personEntries = data.filter(e => e.name === member.name);
                      const hours = personEntries.filter(e => e.type === "worked" && e.status === "approved").reduce((sum, e) => sum + e.hours, 0);
                      const pendingH = personEntries.filter(e => e.type === "worked" && e.status === "pending").reduce((sum, e) => sum + e.hours, 0);
                      const contract = getContractHours(member.name);
                      const ot = Math.max(0, hours - contract);
                      const utilPct = contract > 0 ? Math.min(Math.round((hours / contract) * 100), 100) : 0;
                      const absences = personEntries.filter(e => e.type === "absent" || e.type === "sick").length;
                      const costNet = (hours * member.rate) * (1 - taxRate / 100);

                      let badge = <span className="px-2.5 py-0.5 rounded bg-lime-400/10 text-lime-400 font-semibold border border-lime-400/20">✓ OK</span>;
                      if (!personEntries.length) {
                        badge = <span className="px-2.5 py-0.5 rounded bg-slate-800 text-slate-400">Aucune saisie</span>;
                      } else if (personEntries.some(e => e.status === "pending")) {
                        badge = <span className="px-2.5 py-0.5 rounded bg-amber-400/10 text-amber-400 font-semibold border border-amber-400/20">En attente</span>;
                      } else if (personEntries.some(e => e.status === "correction")) {
                        badge = <span className="px-2.5 py-0.5 rounded bg-rose-400/10 text-rose-400 font-semibold border border-rose-500/20">Correction</span>;
                      } else if (ot > 0) {
                        badge = <span className="px-2.5 py-0.5 rounded bg-rose-400/10 text-rose-400 font-semibold border border-rose-500/20">HS +{ot.toFixed(1)}h</span>;
                      } else if (absences > 0) {
                        badge = <span className="px-2.5 py-0.5 rounded bg-orange-400/10 text-orange-400 font-semibold border border-orange-400/20">Absence</span>;
                      }

                      return (
                        <tr key={member.name} className="hover:bg-slate-900/30">
                          <td className="p-4 font-semibold text-slate-200">{member.name}</td>
                          <td className="p-4">
                            <span 
                              className="px-2.5 py-0.5 rounded-full text-[10px] font-bold border"
                              style={{ 
                                backgroundColor: `${RC[member.role]}15`, 
                                borderColor: `${RC[member.role]}30`, 
                                color: RC[member.role] 
                              }}
                            >
                              {ROLES[member.role]}
                            </span>
                          </td>
                          <td className={`p-4 font-mono font-semibold ${ot > 0 ? "text-rose-400" : "text-slate-100"}`}>
                            {hours.toFixed(1)}h {pendingH > 0 && <span className="text-amber-400 text-[10px] font-normal">(+{pendingH.toFixed(1)}h ⏳)</span>}
                          </td>
                          <td className="p-4 font-mono text-slate-500">{contract}h</td>
                          <td className="p-4">
                            <div className="h-3 bg-slate-950 rounded overflow-hidden relative">
                              <div 
                                className="h-full transition-all" 
                                style={{ 
                                  width: `${utilPct}%`,
                                  backgroundColor: ot > 0 ? "rgb(244, 63, 94)" : "rgb(163, 230, 53)"
                                }} 
                              />
                              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-extrabold text-white mix-blend-difference">
                                {utilPct}%
                              </span>
                            </div>
                          </td>
                          <td className={`p-4 font-mono ${ot > 0 ? "text-rose-400 font-bold" : "text-slate-500"}`}>
                            {ot > 0 ? `+${ot.toFixed(1)}h` : "—"}
                          </td>
                          <td className="p-4 font-mono font-semibold text-emerald-400">€{costNet.toFixed(2)}</td>
                          <td className="p-4">{badge}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* MANAGER WEEK NOTES */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200">
                {t("managerNotes")} — <span className="text-slate-400 font-normal">{getRangeLabel()}</span>
              </h3>
              <button 
                className="px-4 py-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-100 rounded-xl text-xs transition-all font-semibold flex items-center gap-1.5"
                onClick={triggerCopyLastWeek}
              >
                📋 {t("copyLastWeek")}
              </button>
            </div>
            <textarea
              className="w-full h-24 bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 resize-none placeholder-slate-600"
              placeholder={t("managerNotesPlaceholder")}
              value={weekNoteText}
              onChange={e => setWeekNoteInput(e.target.value)}
            />
            <button className="px-5 py-2.5 bg-lime-400 text-slate-950 text-xs font-bold rounded-xl hover:bg-lime-300 transition-all shadow-md" onClick={triggerSaveWeekNote}>
              {t("saveNote")}
            </button>
          </div>
        </div>
      )}

      {/* ── CALENDRIER (CALENDAR) TAB ───────────────────────── */}
      {activeTab === "calendar" && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            {/* NAV */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/20">
              <div className="flex items-center gap-1.5">
                <button className="w-9 h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 flex items-center justify-center font-bold text-base" onClick={calPrev}>‹</button>
                <button className="w-9 h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 flex items-center justify-center font-bold text-base" onClick={calNext}>›</button>
              </div>
              <h2 className="text-base font-bold text-slate-100">
                {t("months")[calMonth]} {calYear}
              </h2>
              <button className="p-2 border border-slate-800 bg-slate-950 text-slate-400 hover:text-lime-400 hover:border-lime-400/30 rounded-xl transition-all" onClick={() => window.print()}>
                <Printer size={16} />
              </button>
            </div>

            {/* DEPT FILTER */}
            <div className="p-3 border-b border-slate-800 bg-slate-950/10 flex flex-wrap gap-2">
              <button 
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${activeRoleFilter === "all" ? "bg-lime-400/10 border-lime-400 text-lime-400" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                onClick={() => { setActiveRoleFilter("all"); onRefresh(); }}
              >
                {t("allRoles")}
              </button>
              {(Object.keys(ROLES) as RoleType[]).map(r => (
                <button
                  key={r}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all`}
                  style={{
                    backgroundColor: activeRoleFilter === r ? `${RC[r]}10` : "rgba(2,6,23,0.4)",
                    borderColor: activeRoleFilter === r ? RC[r] : "rgba(30,41,59,0.8)",
                    color: activeRoleFilter === r ? RC[r] : "#94a3b8"
                  }}
                  onClick={() => { setActiveRoleFilter(r); onRefresh(); }}
                >
                  {ROLES[r]}
                </button>
              ))}
            </div>

            {/* GRID */}
            <div>
              {/* DOW HEADERS */}
              <div className="grid grid-cols-7 border-b border-slate-800/60 bg-slate-950/30 text-center text-[10px] font-bold text-slate-400 uppercase py-2.5">
                {((TRANSLATIONS[lang]?.days || TRANSLATIONS.en.days) as string[]).map(d => <div key={d}>{d.slice(0,3)}</div>)}
              </div>

              {/* DAY CELLS */}
              <div className="grid grid-cols-7 bg-slate-950/20 divide-y divide-x divide-slate-800/40">
                {(() => {
                  const firstDay = new Date(calYear, calMonth, 1);
                  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first
                  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();
                  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;
                  const todayStr = new Date().toISOString().split("T")[0];

                  return Array.from({ length: totalCells }).map((_, i) => {
                    const dayNum = i - startOffset + 1;
                    const isValid = dayNum >= 1 && dayNum <= totalDays;
                    const dateStr = isValid ? `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}` : "";
                    const isToday = dateStr === todayStr;

                    const dayEntries = isValid 
                      ? filterByRole(appData.entries.filter(e => e.date === dateStr))
                      : [];

                    const dayNote = appData.dayNotes[dateStr];
                    const hasNote = !!dayNote;
                    const holiday = getFrenchHoliday(dateStr);
                    const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";

                    return (
                      <div 
                        key={i} 
                        title={holidayTitle || undefined}
                        className={`min-h-[84px] p-2 hover:bg-slate-900/30 transition-all cursor-pointer relative flex flex-col justify-between ${!isValid ? "opacity-20 pointer-events-none" : ""} ${isToday ? "bg-lime-400/[0.03]" : ""} ${holiday ? "bg-indigo-500/[0.04] border border-indigo-500/20 shadow-inner" : ""}`}
                        onClick={() => isValid && selectDay(dateStr)}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1">
                            <span 
                              className={`text-xs font-semibold ${isToday ? "text-lime-400 font-bold text-sm" : holiday ? "text-indigo-400 font-extrabold" : "text-slate-400"}`}
                              title={holidayTitle || undefined}
                            >
                              {isValid ? dayNum : ""}
                            </span>
                            {holiday && <span className="text-[10px]" title={holidayTitle}>🎉</span>}
                          </div>
                          <div className="flex gap-1.5 items-center">
                            {holiday && (
                              <span 
                                className="text-[8px] bg-indigo-500/10 text-indigo-400 px-1 py-0.5 rounded font-bold uppercase truncate max-w-[65px] select-none"
                                title={holidayTitle}
                              >
                                {holidayTitle}
                              </span>
                            )}
                            {hasNote && <div className="w-1.5 h-1.5 rounded-full bg-lime-400" title={dayNote} />}
                          </div>
                        </div>

                        {/* MINI LISTING */}
                        <div className="space-y-1 overflow-hidden flex-1 flex flex-col justify-end">
                          {dayEntries.slice(0, 3).map(e => {
                            const role = getRole(e.name);
                            const col = RC[role];
                            return (
                              <div 
                                key={e.id} 
                                className="text-[9px] px-1.5 py-0.5 rounded leading-tight truncate border"
                                style={{
                                  backgroundColor: `${col}12`,
                                  borderColor: `${col}25`,
                                  color: col
                                }}
                              >
                                {e.name.split(" ")[0]} {e.type === "worked" ? `${e.hours.toFixed(1)}h` : e.type.charAt(0).toUpperCase()}
                              </div>
                            );
                          })}
                          {dayEntries.length > 3 && (
                            <div className="text-[8px] text-slate-500 pl-1">
                              +{dayEntries.length - 3} {lang === "fr" ? "autres" : "more"}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          {/* DAY DETAIL */}
          {selectedDay && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 animate-slide-up shadow-xl">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800/60">
                <h3 className="text-base font-bold text-slate-100">
                  {new Date(selectedDay).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "long", day: "numeric", month: "long" })}
                </h3>
                <button className="text-xs text-slate-500" onClick={() => setSelectedDay(null)}>✕</button>
              </div>

              {/* ENTRIES FOR DAY */}
              {(() => {
                const dayEntries = filterByRole(appData.entries.filter(e => e.date === selectedDay));
                if (dayEntries.length === 0) {
                  return <p className="text-xs text-slate-500 italic py-2">{t("noSubmissionsDay")}</p>;
                }

                return (
                  <div className="space-y-2">
                    {dayEntries.map(e => {
                      const totalStr = e.type === "worked" ? `${e.hours.toFixed(1)}h` : t(e.type);
                      return (
                        <div key={e.id} className="flex justify-between items-center p-3 bg-slate-950/40 border border-slate-800/60 rounded-xl text-xs">
                          <div>
                            <div className="font-semibold text-slate-200">
                              {e.name} <span className="text-[10px] text-slate-500 font-normal">({ROLES[getRole(e.name)]})</span>
                            </div>
                            {e.type === "worked" && <div className="text-[10px] text-slate-400 mt-0.5">{e.startTime} → {e.endTime}</div>}
                            {e.note && <div className="text-slate-500 italic mt-1">"{e.note}"</div>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-200 font-semibold">{totalStr}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${e.status === "approved" ? "bg-lime-400/10 text-lime-400" : "bg-amber-400/10 text-amber-400"}`}>
                              {t(`status${e.status.charAt(0).toUpperCase() + e.status.slice(1)}`)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* SAVE DAY NOTE */}
              <div className="pt-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">{t("dayNote")}</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 placeholder-slate-600"
                    placeholder={t("dayNotePlaceholder")}
                    value={dayNoteText}
                    onChange={e => setDayNoteInput(e.target.value)}
                  />
                  <button className="px-5 py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-xs" onClick={triggerSaveDayNote}>
                    {t("save")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SAISIES (ENTRIES) TAB ───────────────────────── */}
      {activeTab === "entries" && (
        <div className="space-y-6 animate-fade-in">
          {/* CONTROL ROW */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
              {(["week", "month", "year", "custom"] as const).map(mode => (
                <button
                  key={mode}
                  className={`px-3 py-1.5 rounded-lg transition-all ${rangeMode === mode ? "bg-lime-400/10 text-lime-400 font-bold" : "text-slate-400 hover:text-slate-200"}`}
                  onClick={() => { setRangeMode(mode); setRangeOffset(0); }}
                >
                  {t(mode)}
                </button>
              ))}
            </div>
            {rangeMode !== "custom" && (
              <div className="flex items-center gap-1.5">
                <button className="w-8 h-8 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 flex items-center justify-center font-bold" onClick={() => setRangeOffset(prev => prev - 1)}>‹</button>
                <button className="w-8 h-8 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 flex items-center justify-center font-bold" onClick={() => setRangeOffset(prev => prev + 1)}>›</button>
              </div>
            )}
            <span className="text-sm font-semibold text-slate-200">{getRangeLabel()}</span>
            
            <div className="flex gap-2 ml-auto">
              <button className="px-4 py-2 border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-100 rounded-xl text-xs transition-all font-semibold" onClick={exportCSV}>
                Exporter CSV
              </button>
              <button className="px-4 py-2 border border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-100 rounded-xl text-xs transition-all font-semibold" onClick={() => window.print()}>
                🖨 Imprimer
              </button>
            </div>
          </div>

          {/* INDIVIDUAL STAFF FILTER */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-900/10 border border-slate-800/40 rounded-2xl p-3">
            <button 
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border transition-all ${activePersonFilter === "all" ? "bg-lime-400/10 border-lime-400 text-lime-400 font-bold" : "bg-slate-950 border-slate-800 text-slate-400"}`}
              onClick={() => setPersonFilter("all")}
            >
              Tous
            </button>
            {appData.staff.map(s => {
              const active = activePersonFilter === s.name;
              return (
                <button
                  key={s.name}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border transition-all ${active ? "bg-lime-400/10 border-lime-400 text-lime-400 font-bold" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                  onClick={() => setPersonFilter(s.name)}
                >
                  {s.name}
                </button>
              );
            })}
            {activePersonFilter !== "all" && (
              <button
                className="ml-auto px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-slate-800 bg-slate-950 text-slate-300 hover:border-lime-400/50 hover:text-lime-400 transition-all flex items-center gap-1.5"
                onClick={() => setShowTimesheet(true)}
              >
                <FileSpreadsheet size={13} /> {lang === "fr" ? "Imprimer relevé d'heures" : "Print timesheet"}
              </button>
            )}
          </div>

          {/* LIST BY MONTH */}
          {(() => {
            let list = filterByRole(getRangeData());
            if (activePersonFilter !== "all") {
              list = list.filter(e => e.name === activePersonFilter);
            }
            list.sort((a,b) => b.id - a.id);

            if (!list.length) {
              return (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-slate-500 italic">
                  {t("noEntriesForPeriod")}
                </div>
              );
            }

            // Group by year-month
            const groups: Record<string, HourEntry[]> = {};
            list.forEach(e => {
              const key = e.date.slice(0, 7);
              if (!groups[key]) groups[key] = [];
              groups[key].push(e);
            });

            return (
              <div className="space-y-4">
                {Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(key => {
                  const entries = groups[key];
                  const [yr, mo] = key.split("-");
                  const monthName = t("months")[parseInt(mo) - 1] + " " + yr;
                  const totalH = entries.filter(e => e.type === "worked" && approved(e)).reduce((sum, e) => sum + e.hours, 0);

                  return (
                    <div key={key} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
                      <div className="flex justify-between items-center p-4 border-b border-slate-800/60 bg-slate-950/20">
                        <span className="font-bold text-slate-100 text-sm">{monthName}</span>
                        <span className="text-xs font-mono text-slate-400">
                          {entries.length} saisies {totalH > 0 && `· ${totalH.toFixed(1)}h`}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-950/40 text-slate-400 uppercase tracking-wider text-[10px]">
                              {activePersonFilter === "all" && (
                                <>
                                  <th className="p-3">{t("staff")}</th>
                                  <th className="p-3">{t("role")}</th>
                                </>
                              )}
                              <th className="p-3">{t("date")}</th>
                              <th className="p-3">Type</th>
                              <th className="p-3">{t("start")}</th>
                              <th className="p-3">{t("finish")}</th>
                              <th className="p-3">{t("hours")}</th>
                              <th className="p-3">Saisi le</th>
                              <th className="p-3">{t("status")}</th>
                              <th className="p-3">Note</th>
                              <th className="p-3">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {entries.map(e => {
                              const isWork = e.type === "worked";
                              const role = getRole(e.name);
                              const col = RC[role];
                              const isEditing = inlineEditId === e.id;

                              return (
                                <tr key={e.id} className="hover:bg-slate-900/30">
                                  {activePersonFilter === "all" && (
                                    <>
                                      <td className="p-3 font-semibold text-slate-200">{e.name}</td>
                                      <td className="p-3">
                                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold border" style={{ backgroundColor: `${col}15`, borderColor: `${col}30`, color: col }}>
                                          {ROLES[role]}
                                        </span>
                                      </td>
                                    </>
                                  )}
                                  <td className="p-3 font-mono text-slate-400">{e.date}</td>
                                  <td className="p-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${e.type === "worked" ? "bg-lime-400/10 text-lime-400" : e.type === "absent" ? "bg-rose-400/10 text-rose-400" : e.type === "sick" ? "bg-orange-400/10 text-orange-400" : "bg-sky-400/10 text-sky-400"}`}>
                                      {t(e.type)}
                                    </span>
                                  </td>
                                  <td className="p-3 font-mono text-slate-400">{isWork ? (e.shifts && e.shifts.length > 1 ? e.shifts.map(s => s.startTime).join(" + ") : e.startTime || "—") : "—"}</td>
                                  <td className="p-3 font-mono text-slate-400">{isWork ? (e.shifts && e.shifts.length > 1 ? e.shifts.map(s => s.endTime + (s.overnight ? " +1" : "")).join(" + ") : e.endTime || "—") : "—"}</td>
                                  <td className="p-3 font-mono text-lime-400 font-bold">
                                    {isEditing ? (
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          className="w-14 bg-slate-950 border border-lime-400/50 rounded p-1 text-center font-mono font-bold text-xs"
                                          type="number"
                                          step="0.1"
                                          value={inlineEditHours}
                                          onChange={evt => setInlineEditHours(evt.target.value)}
                                        />
                                        <button className="px-2 py-1 bg-lime-400 text-slate-950 font-extrabold rounded" onClick={() => saveInlineEdit(e.id)}>OK</button>
                                      </div>
                                    ) : (
                                      isWork ? fmtHours(e.hours) : "—"
                                    )}
                                  </td>
                                  <td className="p-3 text-[11px] text-slate-500 whitespace-nowrap">
                                    {new Date(e.submittedAt).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "short" })}{" "}
                                    {new Date(e.submittedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                  </td>
                                  <td className="p-3">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${e.status === "approved" ? "bg-lime-400/10 text-lime-400" : e.status === "correction" ? "bg-rose-400/10 text-rose-400" : "bg-amber-400/10 text-amber-400"}`}>
                                        {t(`status${e.status.charAt(0).toUpperCase() + e.status.slice(1)}`)}
                                      </span>
                                      {e.flagged && (
                                        <span className="text-amber-400 cursor-help" title={t("flaggedEntryTooltip")}>🚩</span>
                                      )}
                                      {(() => {
                                        const complianceWarnings = checkEntryComplianceWarnings(e, appData.entries);
                                        return complianceWarnings.length > 0 && (
                                          <span className="text-amber-400 cursor-help" title={complianceWarnings.join("\n")}>⚖️</span>
                                        );
                                      })()}
                                    </div>
                                  </td>
                                  <td className="p-3 text-slate-400 italic max-w-[120px] truncate" title={e.note}>{e.note || "—"}</td>
                                  <td className="p-3">
                                    <div className="flex items-center gap-1">
                                      {e.status === "pending" && (
                                        <button className="p-1 text-lime-400 hover:bg-lime-400/10 rounded" title="Approve" onClick={() => triggerApproveEntry(e.id)}>✓</button>
                                      )}
                                      {isWork && !isEditing && (
                                        <button className="p-1 text-amber-400 hover:bg-amber-400/10 rounded" title="Edit Hours" onClick={() => startInlineEdit(e)}>✎</button>
                                      )}
                                      <button className="p-1 text-rose-400 hover:bg-rose-400/10 rounded" title="Delete" onClick={() => triggerDeleteEntry(e.id)}>✕</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── PAIE (PAYROLL) TAB ───────────────────────── */}
      {activeTab === "payroll" && (
        <div className="space-y-6 animate-fade-in">
          {/* CONTROL CARD */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
              {(["week", "month", "year", "custom"] as const).map(mode => (
                <button
                  key={mode}
                  className={`px-3 py-1.5 rounded-lg transition-all ${rangeMode === mode ? "bg-lime-400/10 text-lime-400 font-bold" : "text-slate-400 hover:text-slate-200"}`}
                  onClick={() => { setRangeMode(mode); setRangeOffset(0); }}
                >
                  {t(mode)}
                </button>
              ))}
            </div>
            {rangeMode !== "custom" && (
              <div className="flex items-center gap-1.5">
                <button className="w-8 h-8 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 flex items-center justify-center font-bold" onClick={() => setRangeOffset(prev => prev - 1)}>‹</button>
                <button className="w-8 h-8 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 flex items-center justify-center font-bold" onClick={() => setRangeOffset(prev => prev + 1)}>›</button>
              </div>
            )}
            <span className="text-sm font-semibold text-slate-200">{getRangeLabel()}</span>

            <button
              className="px-3 py-1.5 bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5"
              onClick={triggerExportPayrollCSV}
            >
              <FileSpreadsheet size={14} /> {lang === "fr" ? "Exporter CSV" : "Export CSV"}
            </button>

            <button
              className="px-3 py-1.5 bg-slate-950 border border-slate-800 hover:border-lime-400/50 hover:text-lime-400 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5"
              onClick={() => setShowBookkeeperExport(true)}
              title={lang === "fr" ? "Export simplifié : heures et brut uniquement, sans calculs fiscaux" : "Clean export: hours and gross pay only, no tax calculations"}
            >
              <FileSpreadsheet size={14} /> {lang === "fr" ? "Export comptable" : "Bookkeeper Export"}
            </button>

            {/* DEPT FILTER */}
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
              <button className={`px-2.5 py-1 rounded-lg ${activeRoleFilter === "all" ? "bg-lime-400/10 text-lime-400" : "text-slate-400"}`} onClick={() => setActiveRoleFilter("all")}>{t("allRoles")}</button>
              {(Object.keys(ROLES) as RoleType[]).map(r => (
                <button key={r} className={`px-2.5 py-1 rounded-lg ${activeRoleFilter === r ? "bg-lime-400/10 text-lime-400" : "text-slate-400"}`} onClick={() => setActiveRoleFilter(r)}>{ROLES[r]}</button>
              ))}
            </div>
          </div>

          {/* WARNING SECTION */}
          {pendingEntries.length > 0 && (
            <div className="bg-amber-400/[0.04] border border-amber-400/30 rounded-2xl p-4 text-xs text-amber-400 flex gap-2">
              <ShieldAlert className="flex-shrink-0" size={16} />
              <div>
                {t("lastSubmissionDaysAgo", { n: pendingEntries.length, date: "" })} {getLang() === "fr" ? "Certaines saisies d'heures sont en attente d'approbation et n'apparaissent pas encore dans les totaux de paie." : "Some logged hours are pending approval and do not show up in the totals yet."}
              </div>
            </div>
          )}

          {/* ADVANCE PERIOD TOGGLE */}
          <div className="flex justify-end items-center gap-2 text-xs">
            <span className="text-slate-500">{t("advancesShownLabel")}</span>
            <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-[10px] font-bold uppercase tracking-wider">
              <button className={`px-3 py-1.5 rounded-lg ${advScope === "period" ? "bg-amber-400 text-slate-950" : "text-slate-400"}`} onClick={() => setAdvScope("period")}>{t("thisPeriod")}</button>
              <button className={`px-3 py-1.5 rounded-lg ${advScope === "all" ? "bg-amber-400 text-slate-950" : "text-slate-400"}`} onClick={() => setAdvScope("all")}>Toutes</button>
            </div>
          </div>

          {/* PAYROLL CALCULATION TABLE */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/40 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="p-4">{t("staff")}</th>
                    <th className="p-4">{t("role")}</th>
                    <th className="p-4">{t("hours")}</th>
                    <th className="p-4">H. sup.</th>
                    <th className="p-4">Taux/h</th>
                    <th className="p-4">Brut</th>
                    <th className="p-4 cursor-help" title={deductions.map(d => `${d.label || "—"}: ${d.rate}%`).join("\n")}>
                      Charges ({taxRate}%)
                    </th>
                    <th className="p-4">Net</th>
                    <th className="p-4">Avances</th>
                    <th className="p-4 font-bold text-lime-400">{t("toPay")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(() => {
                    let totalGrossSum = 0;
                    let totalNetSum = 0;
                    let totalAdvancesSum = 0;
                    let totalToPaySum = 0;

                    const rows = appData.staff
                      .filter(s => activeRoleFilter === "all" || s.role === activeRoleFilter)
                      .map(member => {
                        const personEntries = data.filter(e => e.name === member.name && e.status === "approved");
                        const hours = personEntries.filter(e => e.type === "worked").reduce((sum, e) => sum + e.hours, 0);
                        const contract = getContractHours(member.name);
                        const ot = Math.max(0, hours - contract);
                        const gross = hours * member.rate;
                        const net = gross * (1 - taxRate / 100);
                        const advs = getAdvancesByScope(member.name).reduce((sum, a) => sum + a.amount, 0);
                        const toPay = Math.max(net - advs, 0);

                        totalGrossSum += gross;
                        totalNetSum += net;
                        totalAdvancesSum += advs;
                        totalToPaySum += toPay;

                        return (
                          <tr key={member.name} className="hover:bg-slate-900/30">
                            <td className="p-4 font-semibold text-slate-200">{member.name}</td>
                            <td className="p-4">
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold border" style={{ backgroundColor: `${RC[member.role]}15`, borderColor: `${RC[member.role]}30`, color: RC[member.role] }}>
                                {ROLES[member.role]}
                              </span>
                            </td>
                            <td className="p-4 font-mono font-bold text-slate-300">{hours.toFixed(1)}h</td>
                            <td className={`p-4 font-mono ${ot > 0 ? "text-rose-400 font-bold" : "text-slate-500"}`}>{ot > 0 ? `+${ot.toFixed(1)}h` : "—"}</td>
                            <td className="p-4 font-mono text-slate-400">€{member.rate.toFixed(2)}</td>
                            <td className="p-4 font-mono text-slate-300">€{gross.toFixed(2)}</td>
                            <td className="p-4 font-mono text-rose-400/80">-€{(gross - net).toFixed(2)}</td>
                            <td className="p-4 font-mono text-emerald-400 font-semibold">€{net.toFixed(2)}</td>
                            <td className="p-4">
                              <div className="flex flex-col gap-1">
                                {advs > 0 ? (
                                  <span className={`font-mono font-bold text-xs ${advs > net ? "text-rose-400 line-through" : "text-amber-400"}`}>
                                    -€{advs.toFixed(2)}
                                  </span>
                                ) : "—"}
                                <button className="text-[10px] text-amber-400 hover:text-amber-300 underline text-left" onClick={() => openAdvanceModal(member.name)}>
                                  Gérer avances
                                </button>
                              </div>
                            </td>
                            <td className="p-4 font-mono font-extrabold text-lime-400 text-sm">€{toPay.toFixed(2)}</td>
                          </tr>
                        );
                      });

                    // Store sums to render in cards below
                    setTimeout(() => {
                      const tg = document.getElementById("p-gross");
                      const tn = document.getElementById("p-net");
                      const ta = document.getElementById("p-advances");
                      const tp = document.getElementById("p-topay");
                      if (tg) tg.textContent = "€" + totalGrossSum.toFixed(2);
                      if (tn) tn.textContent = "€" + totalNetSum.toFixed(2);
                      if (ta) ta.textContent = "€" + totalAdvancesSum.toFixed(2);
                      if (tp) tp.textContent = "€" + totalToPaySum.toFixed(2);
                    }, 0);

                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* SUMMARY CARDS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("totalGross")}</div>
              <div id="p-gross" className="text-xl font-mono font-bold text-slate-200 mt-1">€0.00</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("totalNet")}</div>
              <div id="p-net" className="text-xl font-mono font-bold text-emerald-400 mt-1">€0.00</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-amber-400">Total avances {advScope === "period" ? "(période)" : "(toutes)"}</div>
              <div id="p-advances" className="text-xl font-mono font-bold text-amber-400 mt-1">€0.00</div>
            </div>
            <div className="bg-lime-400/10 border border-lime-400/30 rounded-2xl p-4">
              <div className="text-[10px] font-bold text-lime-400 uppercase tracking-wider">{t("totalToPay")}</div>
              <div id="p-topay" className="text-2xl font-mono font-extrabold text-lime-400 mt-1">€0.00</div>
            </div>
          </div>

          {/* ACTIONS */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button className="flex-1 py-4 bg-lime-400 hover:bg-lime-300 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md text-sm" onClick={sendEmail}>
              <Mail size={16} /> {t("sendToBookkeeper")}
            </button>
            <button className="flex-1 py-4 border border-slate-800 hover:border-slate-700 bg-slate-900 text-slate-300 font-semibold rounded-xl flex items-center justify-center gap-2 transition-all text-sm" onClick={window.print}>
              <Printer size={16} /> {t("printPayroll")}
            </button>
          </div>
        </div>
      )}

      {/* ── ROTATION / PLANNING (SCHEDULE) TAB ────────────────── */}
      {activeTab === "schedule" && enableScheduling && (
        <div className={`space-y-6 animate-fade-in ${printHideAlerts ? "print-hide-alerts" : ""}`}>
          {/* HEADER AND WEEK/MONTH SELECTOR */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg print:hidden">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-1.5 uppercase tracking-wider">
                <Calendar size={16} className="text-lime-400" />
                {lang === "fr" 
                  ? (scheduleViewMode === "weekly" ? "Planning de Rota Interactif (Hebdo)" : "Planning de Rota Interactif (Mensuel)") 
                  : (scheduleViewMode === "weekly" ? "Interactive Rota Planner (Weekly)" : "Interactive Rota Planner (Monthly)")}
              </h2>
              <p className="text-[11px] text-slate-400">
                {complianceEnforced 
                  ? t("legalEnforcementActive")
                  : t("legalEnforcementInactive")}
              </p>
            </div>
            
            {/* SWITCHERS */}
            {scheduleViewMode === "weekly" ? (
              <div className="flex items-center gap-2 self-stretch md:self-auto justify-between md:justify-end">
                <button 
                  className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition-all text-xs"
                  onClick={() => setScheduleOffset(prev => prev - 1)}
                >
                  ◀
                </button>
                <span className="font-mono text-xs font-bold text-slate-200 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl">
                  {(() => {
                    const days = getScheduleWeekDates();
                    return `${days[0].fullLabel} — ${days[6].fullLabel}`;
                  })()}
                </span>
                <button 
                  className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition-all text-xs"
                  onClick={() => setScheduleOffset(prev => prev + 1)}
                >
                  ▶
                </button>
                <button 
                  className="px-3 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-semibold"
                  onClick={() => setScheduleOffset(0)}
                >
                  {lang === "fr" ? "Actuelle" : "Current"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 self-stretch md:self-auto justify-between md:justify-end">
                <button 
                  className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition-all text-xs"
                  onClick={() => setScheduleMonthOffset(prev => prev - 1)}
                >
                  ◀
                </button>
                <span className="font-mono text-xs font-bold text-slate-200 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl uppercase">
                  {getActiveMonthDetails().monthName}
                </span>
                <button 
                  className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition-all text-xs"
                  onClick={() => setScheduleMonthOffset(prev => prev + 1)}
                >
                  ▶
                </button>
                <button 
                  className="px-3 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl text-xs font-semibold"
                  onClick={() => setScheduleMonthOffset(0)}
                >
                  {lang === "fr" ? "Actuel" : "Current"}
                </button>
              </div>
            )}

            {/* QUICK ACTIONS */}
            <div className="flex gap-2 w-full md:w-auto">
              {scheduleViewMode === "weekly" && (
                <button 
                  className="flex-1 md:flex-none px-4 py-2 bg-slate-950 hover:bg-slate-850 text-amber-400 hover:text-amber-300 border border-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                  onClick={handleCopyPreviousWeekSchedule}
                >
                  📄 {lang === "fr" ? "Copier Rota Précédent" : "Copy Previous Week"}
                </button>
              )}
              <button 
                className="flex-1 md:flex-none px-4 py-2 bg-lime-400 hover:bg-lime-300 text-slate-950 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all shadow-md"
                onClick={() => {
                  const initialDate = scheduleViewMode === "weekly" 
                    ? getScheduleWeekDates()[0].dateStr 
                    : `${getActiveMonthDetails().year}-${String(getActiveMonthDetails().month + 1).padStart(2, "0")}-01`;
                  handleOpenAddShift("", initialDate);
                }}
              >
                ➕ {t("addShift")}
              </button>
            </div>
          </div>

          {/* VIEW MODE, ROLE FILTER, & PRINT ACTIONS BAR */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg print:hidden">
            {/* View Mode Toggle (Weekly vs Monthly) */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Affichage :" : "View Mode:"}</span>
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
                <button
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${scheduleViewMode === "weekly" ? "bg-lime-400 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-100"}`}
                  onClick={() => setScheduleViewMode("weekly")}
                >
                  📅 {lang === "fr" ? "Hebdomadaire" : "Weekly"}
                </button>
                <button
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${scheduleViewMode === "monthly" ? "bg-lime-400 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-100"}`}
                  onClick={() => setScheduleViewMode("monthly")}
                >
                  📆 {lang === "fr" ? "Mensuel" : "Monthly"}
                </button>
              </div>
            </div>

            {/* Role filter (specific to roster print/view) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Filtrer par Rôle :" : "Filter Role:"}</span>
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs flex-wrap gap-1">
                <button
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${activeRoleFilter === "all" ? "bg-lime-400/10 text-lime-400" : "text-slate-400 hover:text-slate-200"}`}
                  onClick={() => setActiveRoleFilter("all")}
                >
                  {t("allRoles")}
                </button>
                {(Object.keys(ROLES) as RoleType[]).map(r => (
                  <button
                    key={r}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${activeRoleFilter === r ? "bg-lime-400/10 text-lime-400" : "text-slate-400 hover:text-slate-200"}`}
                    onClick={() => setActiveRoleFilter(r)}
                  >
                    {ROLES[r]}
                  </button>
                ))}
              </div>
            </div>

            {/* Print Action */}
            <button
              className="w-full md:w-auto px-4 py-2 bg-slate-950 hover:bg-slate-850 text-slate-200 hover:text-lime-400 border border-slate-800 hover:border-lime-400/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
              onClick={() => window.print()}
            >
              <Printer size={14} />
              {lang === "fr" ? "Imprimer planning" : "Print Schedule"}
            </button>
          </div>

          {/* PRINT & DISPLAY OPTIONS */}
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-4 bg-slate-900/40 border border-slate-800/40 p-4 rounded-2xl text-xs print:hidden shadow-inner">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">{lang === "fr" ? "Options d'impression :" : "Print Options:"}</span>
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Toggle checked={printHideAlerts} onChange={setPrintHideAlerts} />
                <span className="text-slate-300 font-medium">
                  ⚠️ {lang === "fr" ? "Masquer les alertes & heures sup. (recommandé pour l'équipe)" : "Hide alerts & overtime warnings (clean print for staff)"}
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Toggle checked={printHideTotals} onChange={setPrintHideTotals} />
                <span className="text-slate-300 font-medium">
                  📊 {lang === "fr" ? "Masquer la colonne Rota Total" : "Hide Rota Total column in print"}
                </span>
              </label>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 italic pl-1 flex items-center gap-1.5 print:hidden">
            {t("dragDropInfo")}
          </p>

          {/* PRINT-ONLY HEADER */}
          <div className="hidden print:block mb-6 text-center text-slate-900">
            <h1 className="text-2xl font-bold uppercase tracking-wider">{restoName || "Restaurant"}</h1>
            <p className="text-sm mt-1 font-semibold text-slate-700">
              {scheduleViewMode === "weekly" 
                ? `${lang === "fr" ? "Planning de Rota Hebdomadaire" : "Weekly Rota Schedule"} (${getScheduleWeekDates()[0].fullLabel} — ${getScheduleWeekDates()[6].fullLabel})`
                : `${lang === "fr" ? "Planning de Rota Mensuel" : "Monthly Rota Schedule"} (${getActiveMonthDetails().monthName})`}
              {activeRoleFilter !== "all" && ` · ${ROLES[activeRoleFilter as RoleType]}`}
            </p>
          </div>

          {/* MAIN CALENDAR GRID */}
          {scheduleViewMode === "weekly" ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold">
                      <th className="p-4 w-44">{lang === "fr" ? "Employé / Rôle" : "Staff Member / Role"}</th>
                      {getScheduleWeekDates().map(day => {
                        const isToday = day.dateStr === new Date().toISOString().split("T")[0];
                        const holiday = getFrenchHoliday(day.dateStr);
                        const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";
                        const isWeekend = [0, 6].includes(new Date(day.dateStr + "T00:00:00").getDay());
                        return (
                          <th 
                            key={day.dateStr} 
                            title={holidayTitle || undefined}
                            className={`p-4 text-center border-l border-slate-800/40 relative ${
                              isToday 
                                ? "bg-lime-400/5 text-lime-400 font-extrabold" 
                                : holiday 
                                  ? "bg-indigo-500/[0.04] text-indigo-400" 
                                  : isWeekend
                                    ? "bg-sky-500/[0.03] text-sky-400/90"
                                    : ""
                            }`}
                          >
                            <span className="block text-xs">{day.label}</span>
                            <div className="flex items-center justify-center gap-1 mt-0.5">
                              <span className={`block text-[10px] ${holiday ? "text-indigo-400 font-bold" : isWeekend ? "text-sky-400 font-semibold" : "text-slate-500"}`}>{day.num}</span>
                              {holiday && <span className="text-[10px]" title={holidayTitle}>🎉</span>}
                            </div>
                            {isToday && (
                              <span className="absolute top-0 inset-x-0 h-0.5 bg-lime-400" />
                            )}
                          </th>
                        );
                      })}
                      <th className={`p-4 text-center w-20 ${printHideTotals ? "print:hidden" : ""}`}>{lang === "fr" ? "Total Rota" : "Rota Total"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {/* STAFF ROWS (FILTERED BY ROLE) */}
                    {appData.staff
                      .filter(member => activeRoleFilter === "all" || member.role === activeRoleFilter)
                      .map(member => {
                        const days = getScheduleWeekDates();
                        const weekDates = days.map(d => d.dateStr);
                        const shifts = appData.scheduledShifts || [];
                        const staffShifts = shifts.filter(s => s.name === member.name && weekDates.includes(s.date));
                        const totalScheduledHours = staffShifts.reduce((sum, s) => sum + getShiftHours(s), 0);
                        
                        const otLimit = member.contract;
                        const exceedsOT = totalScheduledHours > otLimit;
                        const exceeds48h = totalScheduledHours > 48;

                        return (
                          <tr key={member.name} className="hover:bg-slate-950/10 group">
                            {/* Member Identity column */}
                            <td className="p-4 font-semibold text-slate-200 border-r border-slate-800/20">
                              <div>{member.name}</div>
                              <span className="inline-block mt-1 text-[8px] font-bold uppercase tracking-wider text-slate-500">
                                {ROLES[member.role]} · {member.contract}h
                              </span>
                            </td>
                            
                            {/* Weekly grid columns */}
                            {days.map(day => {
                              const cellShifts = staffShifts.filter(s => s.date === day.dateStr);
                              const holiday = getFrenchHoliday(day.dateStr);
                              const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";
                              const isWeekend = [0, 6].includes(new Date(day.dateStr + "T00:00:00").getDay());
                              return (
                                <td 
                                  key={day.dateStr}
                                  title={holidayTitle || undefined}
                                  className={`p-2 border-l border-slate-850 text-center min-h-[80px] relative transition-all ${holiday ? "bg-indigo-500/[0.015]" : isWeekend ? "bg-sky-500/[0.02]" : ""}`}
                                  onDragOver={e => e.preventDefault()}
                                  onDrop={e => handleDropShift(e, day.dateStr, member.name)}
                                  onClick={() => {
                                    if (cellShifts.length === 0) {
                                      handleOpenAddShift(member.name, day.dateStr);
                                    }
                                  }}
                                >
                                  <div className="space-y-1.5 flex flex-col justify-center items-center min-h-[50px]">
                                    {cellShifts.map(shift => {
                                      const hours = getShiftHours(shift);
                                      const warnings = checkComplianceWarnings(shift, shifts);
                                      const hasOverlapConflict = getOverlappingShifts(shift, shifts).length > 0;
                                      const hasComplianceWarning = warnings.length > 0 && !hasOverlapConflict;
                                      const col = RC[shift.role];
                                      
                                      return (
                                        <div 
                                          key={shift.id}
                                          draggable
                                          onDragStart={e => handleDragStart(e, shift.id)}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenEditShift(shift);
                                          }}
                                          className={`w-full p-2 rounded-xl text-left border relative select-none cursor-grab active:cursor-grabbing hover:shadow-md transition-all animate-scale-in group/shift ${
                                            hasOverlapConflict ? "ring-2 ring-rose-500/20 animate-pulse border-rose-500 shift-card-conflict" :
                                            hasComplianceWarning ? "ring-2 ring-amber-500/20 border-amber-500 shift-card-conflict" : ""
                                          }`}
                                          style={{
                                            backgroundColor: hasOverlapConflict ? (theme === "light" ? "#fff1f2" : "#88133725") : hasComplianceWarning ? (theme === "light" ? "#fffbeb" : "#78350f25") : `${col}15`,
                                            borderColor: hasOverlapConflict ? "#f43f5e" : hasComplianceWarning ? "#f59e0b" : `${col}35`,
                                            color: hasOverlapConflict ? (theme === "light" ? "#e11d48" : "#f43f5e") : hasComplianceWarning ? (theme === "light" ? "#b45309" : "#fbbf24") : col
                                          }}
                                        >
                                          <div className="flex justify-between items-center">
                                            <span className="font-mono font-bold text-[10px] leading-none">
                                              {shift.startTime} - {shift.endTime}
                                            </span>
                                            <div className="flex items-center gap-1">
                                              <button
                                                title={lang === "fr" ? "Dupliquer" : "Duplicate"}
                                                onClick={(e) => handleDuplicateShiftDirectly(e, shift)}
                                                className="opacity-0 group-hover/shift:opacity-100 hover:scale-110 p-0.5 rounded transition-all text-slate-400 hover:text-lime-400 bg-slate-900/40"
                                              >
                                                <Copy size={10} />
                                              </button>
                                              {warnings.length > 0 && (
                                                <span 
                                                  className={`font-extrabold cursor-help text-xs ${hasOverlapConflict ? "text-rose-400" : "text-amber-400"} ${printHideAlerts ? "print:hidden" : ""}`} 
                                                  title={warnings.join("\n")}
                                                >
                                                  ⚠️
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          <div className="text-[9px] text-slate-400 mt-1 uppercase font-semibold leading-none flex justify-between">
                                            <span>{t(`role${shift.role.charAt(0).toUpperCase() + shift.role.slice(1)}`)}</span>
                                            <span className="font-mono text-slate-500 font-bold">{hours.toFixed(1)}h</span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    
                                    {cellShifts.length === 0 && (
                                      <span className="text-[10px] text-slate-700 font-mono opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                        + {lang === "fr" ? "Ajouter" : "Add"}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            
                            {/* Weekly Summary Column */}
                            <td className={`p-4 text-center border-l border-slate-800/40 ${printHideTotals ? "print:hidden" : ""}`}>
                              <span className={`inline-block font-mono text-xs font-bold px-2 py-1 rounded ${
                                exceeds48h 
                                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/20 font-extrabold animate-pulse ot-badge-danger" 
                                  : exceedsOT 
                                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 ot-badge-warn" 
                                    : "bg-slate-950 text-slate-400"
                              }`}>
                                {totalScheduledHours.toFixed(1)}h
                              </span>
                              {exceeds48h && (
                                <span className={`block text-[8px] text-rose-400 font-extrabold mt-1.5 uppercase leading-tight ${printHideAlerts ? "print:hidden" : ""}`}>
                                  ⚠️ &gt;48H MAX
                                </span>
                              )}
                              {exceedsOT && !exceeds48h && (
                                <span className={`block text-[10px] text-rose-400 font-black mt-2 leading-tight bg-rose-950/40 border border-rose-500/20 rounded py-0.5 px-1 animate-pulse ${printHideAlerts ? "print:hidden" : ""}`}>
                                  ⚠️ +{(totalScheduledHours - otLimit).toFixed(1)}h
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                    {/* UNASSIGNED / AVAILABLE SHIFTS ROW */}
                    <tr className="bg-slate-950/20 border-t-2 border-slate-800">
                      <td className="p-4 font-bold text-amber-400">
                        <div>{t("unassigned")}</div>
                        <span className="text-[8px] text-slate-500 uppercase tracking-wider block mt-1">
                          {lang === "fr" ? "Besoins d'heures" : "Open shift requirements"}
                        </span>
                      </td>
                      
                      {getScheduleWeekDates().map(day => {
                        const shifts = appData.scheduledShifts || [];
                        const cellShifts = shifts.filter(s => s.name === "" && s.date === day.dateStr);
                        const holiday = getFrenchHoliday(day.dateStr);
                        const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";
                        const isWeekend = [0, 6].includes(new Date(day.dateStr + "T00:00:00").getDay());
                        return (
                          <td 
                            key={day.dateStr}
                            title={holidayTitle || undefined}
                            className={`p-2 border-l border-slate-850 text-center min-h-[80px] relative transition-all ${holiday ? "bg-indigo-500/[0.015]" : isWeekend ? "bg-sky-500/[0.02]" : ""}`}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => handleDropShift(e, day.dateStr, "")}
                            onClick={() => {
                              if (cellShifts.length === 0) {
                                handleOpenAddShift("", day.dateStr);
                              }
                            }}
                          >
                            <div className="space-y-1.5 flex flex-col justify-center items-center min-h-[50px]">
                              {cellShifts.map(shift => {
                                const hours = getShiftHours(shift);
                                
                                return (
                                  <div 
                                    key={shift.id}
                                    draggable
                                    onDragStart={e => handleDragStart(e, shift.id)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenEditShift(shift);
                                    }}
                                    className="w-full p-2 rounded-xl text-left border relative select-none cursor-grab active:cursor-grabbing hover:shadow-md transition-all animate-scale-in group/shift"
                                    style={{
                                      backgroundColor: "rgba(245, 158, 11, 0.08)",
                                      borderColor: "rgba(245, 158, 11, 0.25)",
                                      color: "#f59e0b"
                                    }}
                                  >
                                    <div className="flex justify-between items-center">
                                      <span className="font-mono font-bold text-[10px] leading-none">
                                        {shift.startTime} - {shift.endTime}
                                      </span>
                                      <button
                                        title={lang === "fr" ? "Dupliquer" : "Duplicate"}
                                        onClick={(e) => handleDuplicateShiftDirectly(e, shift)}
                                        className="opacity-0 group-hover/shift:opacity-100 hover:scale-110 p-0.5 rounded transition-all text-slate-400 hover:text-amber-400 bg-slate-900/40"
                                      >
                                        <Copy size={10} />
                                      </button>
                                    </div>
                                    <div className="text-[9px] text-slate-400 mt-1 uppercase font-semibold leading-none flex justify-between">
                                      <span>{t(`role${shift.role.charAt(0).toUpperCase() + shift.role.slice(1)}`)}</span>
                                      <span className="font-mono text-amber-500/80 font-bold">{hours.toFixed(1)}h</span>
                                    </div>
                                  </div>
                                );
                              })}
                              
                              {cellShifts.length === 0 && (
                                <span className="text-[10px] text-slate-700 font-mono opacity-20 hover:opacity-100 transition-opacity cursor-pointer">
                                  + open
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      
                      <td className="p-4 text-center border-l border-slate-800/40 text-slate-500 font-mono text-xs font-bold">
                        {(() => {
                          const days = getScheduleWeekDates();
                          const weekDates = days.map(d => d.dateStr);
                          const unassignedHours = (appData.scheduledShifts || [])
                            .filter(s => s.name === "" && weekDates.includes(s.date))
                            .reduce((sum, s) => sum + getShiftHours(s), 0);
                          return unassignedHours > 0 ? `${unassignedHours.toFixed(1)}h` : "—";
                        })()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* MONTHLY CALENDAR GRID */
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl p-4">
              {/* Days of the week headers */}
              <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-3 border-b border-slate-800">
                {(() => {
                  const monFirstDays = [
                    t("days")[1], // Mon
                    t("days")[2], // Tue
                    t("days")[3], // Wed
                    t("days")[4], // Thu
                    t("days")[5], // Fri
                    t("days")[6], // Sat
                    t("days")[0], // Sun
                  ];
                  return monFirstDays.map((dayLabel, idx) => (
                    <div key={idx} className="p-2">
                      {dayLabel}
                    </div>
                  ));
                })()}
              </div>

              {/* Calendar cells */}
              <div className="grid grid-cols-7 gap-2 mt-3">
                {getMonthlyGridDays().map((cell, idx) => {
                  const isToday = cell.dateStr === new Date().toISOString().split("T")[0];
                  
                  // Get shifts for this cell date
                  const rawShifts = appData.scheduledShifts || [];
                  const cellShifts = rawShifts.filter(s => {
                    if (s.date !== cell.dateStr) return false;
                    if (activeRoleFilter !== "all" && s.role !== activeRoleFilter) return false;
                    return true;
                  });

                  const holiday = getFrenchHoliday(cell.dateStr);
                  const holidayTitle = holiday ? (lang === "fr" ? holiday.nameFr : holiday.nameEn) : "";

                  return (
                    <div
                      key={idx}
                      onClick={() => handleOpenAddShift("", cell.dateStr)}
                      title={holidayTitle || undefined}
                      className={`min-h-[120px] p-2 bg-slate-950/40 border rounded-xl flex flex-col justify-between transition-all hover:border-slate-700/80 cursor-pointer ${
                        cell.isCurrentMonth ? "border-slate-800/80" : "border-slate-800/20 opacity-30"
                      } ${isToday ? "bg-lime-400/[0.02] border-lime-400/50 ring-1 ring-lime-400/20" : ""} ${holiday ? "bg-indigo-500/[0.04] border-indigo-500/20 ring-1 ring-indigo-500/10" : ""}`}
                    >
                      {/* Cell Header */}
                      <div className="flex justify-between items-center mb-1.5" title={holidayTitle || undefined}>
                        <span className={`font-mono text-[10px] font-bold ${
                          isToday ? "text-lime-400" : holiday ? "text-indigo-400 font-extrabold" : cell.isCurrentMonth ? "text-slate-300" : "text-slate-600"
                        }`}>
                          {cell.num}
                          {holiday && <span className="ml-1 text-[10px]" title={holidayTitle}>🎉</span>}
                        </span>
                        {isToday ? (
                          <span className="text-[8px] bg-lime-400/10 text-lime-400 px-1 py-0.5 rounded font-extrabold uppercase tracking-wide">
                            {lang === "fr" ? "Aujourd'hui" : "Today"}
                          </span>
                        ) : holiday ? (
                          <span className="text-[8px] bg-indigo-500/10 text-indigo-400 px-1 py-0.5 rounded font-bold uppercase tracking-wide truncate max-w-[65px]" title={holidayTitle}>
                            {holidayTitle}
                          </span>
                        ) : null}
                      </div>

                      {/* Cell Shifts List */}
                      <div className="flex-1 space-y-1 overflow-y-auto max-h-[90px] scrollbar-thin">
                        {cellShifts.map(shift => {
                          const hours = getShiftHours(shift);
                          const hasOverlapConflict = getOverlappingShifts(shift, rawShifts).length > 0;
                          const col = RC[shift.role] || "#a7f3d0";
                          return (
                            <div
                              key={shift.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditShift(shift);
                              }}
                              className={`p-1 rounded text-left border relative select-none cursor-pointer hover:shadow-md transition-all text-[9px] group/shift ${
                                hasOverlapConflict ? "ring-1 ring-rose-500/20 border-rose-500 font-bold" : ""
                              }`}
                              style={{
                                backgroundColor: hasOverlapConflict ? (theme === "light" ? "#fff1f2" : "#88133718") : `${col}12`,
                                borderColor: hasOverlapConflict ? "#f43f5e" : `${col}28`,
                                color: hasOverlapConflict ? (theme === "light" ? "#e11d48" : "#f43f5e") : col
                              }}
                              title={`${shift.name || "Open"}: ${shift.startTime} - ${shift.endTime} (${hours.toFixed(1)}h)`}
                            >
                              <div className="flex justify-between items-center font-bold leading-tight">
                                <span className="truncate max-w-[55px] font-semibold text-slate-100 flex items-center gap-0.5">
                                  {hasOverlapConflict && <span className="text-rose-500 animate-pulse" title="Conflict">⚠️</span>}
                                  <span className={hasOverlapConflict ? "text-rose-500" : ""}>{shift.name || (lang === "fr" ? "Libre" : "Open")}</span>
                                </span>
                                <span className="opacity-80">
                                  {hours.toFixed(0)}h
                                </span>
                              </div>
                              <div className="flex justify-between items-center mt-0.5 text-[8px] text-slate-400">
                                <span>{shift.startTime}</span>
                                <span className="uppercase font-semibold tracking-wide text-[7px] opacity-75">{t(`role${shift.role.charAt(0).toUpperCase() + shift.role.slice(1)}`)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STATS (STATISTICS) TAB ───────────────────────── */}
      {activeTab === "requests" && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Clipboard size={16} className="text-lime-400" /> {t("requests")}
            </h2>
          </div>

          {pendingTimeOff.length === 0 && claimedSwaps.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
              {lang === "fr" ? "Aucune demande en attente." : "No pending requests."}
            </div>
          ) : (
            <>
              {pendingTimeOff.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-lg">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    {lang === "fr" ? "Demandes de congé" : "Time off requests"}
                  </h3>
                  {pendingTimeOff.map(r => {
                    const rangeDates: string[] = [];
                    const cursor = new Date(r.startDate + "T00:00:00");
                    const end = new Date(r.endDate + "T00:00:00");
                    while (cursor <= end) {
                      rangeDates.push(cursor.toISOString().slice(0, 10));
                      cursor.setDate(cursor.getDate() + 1);
                    }
                    return (
                      <div key={r.id} className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3">
                        <div className="flex flex-col sm:flex-row gap-3 justify-between">
                          <div className="flex-1 space-y-1">
                            <div className="text-sm font-semibold text-slate-200">{r.staffName}</div>
                            <div className="text-xs text-slate-400 font-mono">{r.startDate} → {r.endDate}</div>
                            {r.reason && <div className="text-xs text-slate-500 italic">{r.reason}</div>}
                            {r.managerNote && (
                              <div className="text-[11px] text-amber-400 flex items-start gap-1 mt-1">📌 {r.managerNote}</div>
                            )}
                            <div className="flex items-center gap-2 pt-2">
                              <button
                                className="p-2 bg-lime-400/10 text-lime-400 hover:bg-lime-400/20 rounded-lg disabled:opacity-40"
                                onClick={() => triggerDecideTimeOff(r.id, true)}
                                disabled={requestsBusy === r.id}
                                title={lang === "fr" ? "Approuver" : "Approve"}
                              >
                                <Check size={16} />
                              </button>
                              <button
                                className="p-2 bg-rose-400/10 text-rose-400 hover:bg-rose-400/20 rounded-lg disabled:opacity-40"
                                onClick={() => triggerDecideTimeOff(r.id, false)}
                                disabled={requestsBusy === r.id}
                                title={lang === "fr" ? "Refuser" : "Deny"}
                              >
                                <X size={16} />
                              </button>
                              <button
                                className="text-[10px] text-slate-500 hover:text-amber-400 transition-all"
                                onClick={() => { setOpenNoteFor(openNoteFor === r.id ? null : r.id); setNoteDraft(r.managerNote || ""); }}
                              >
                                {r.managerNote ? (lang === "fr" ? "✎ Modifier la note" : "✎ Edit note") : (lang === "fr" ? "+ Note / en attente" : "+ Note / hold")}
                              </button>
                            </div>
                            {openNoteFor === r.id && (
                              <div className="flex gap-2 pt-1">
                                <input
                                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-slate-200"
                                  value={noteDraft}
                                  onChange={e => setNoteDraft(e.target.value)}
                                  placeholder={lang === "fr" ? "ex. en attente de retour de Marie..." : "e.g. waiting to hear back from Marie..."}
                                  onKeyDown={e => e.key === "Enter" && triggerSaveTimeOffNote(r.id)}
                                />
                                <button className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-semibold" onClick={() => triggerSaveTimeOffNote(r.id)}>
                                  {lang === "fr" ? "OK" : "Save"}
                                </button>
                              </div>
                            )}
                          </div>
                          <MiniCalendar anchorDate={r.startDate} highlightDates={rangeDates} lang={lang} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {claimedSwaps.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-lg">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    {lang === "fr" ? "Échanges de service (réclamés)" : "Cover requests (claimed)"}
                  </h3>
                  {claimedSwaps.map(r => (
                    <div key={r.id} className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3">
                      <div className="flex flex-col sm:flex-row gap-3 justify-between">
                        <div className="flex-1 space-y-1">
                          <div className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                              style={{ backgroundColor: `${RC[r.role]}18`, color: RC[r.role] }}
                            >
                              {ROLES[r.role]}
                            </span>
                            {r.originalStaff} <ArrowRight size={12} className="inline mx-1 text-slate-500" /> {r.claimedBy}
                          </div>
                          <div className="text-xs text-slate-400 font-mono">{r.date} · {r.startTime}–{r.endTime}</div>
                          {r.reason && <div className="text-xs text-slate-500 italic">{r.reason}</div>}
                          {r.managerNote && (
                            <div className="text-[11px] text-amber-400 flex items-start gap-1 mt-1">📌 {r.managerNote}</div>
                          )}
                          <div className="flex items-center gap-2 pt-2">
                            <button
                              className="p-2 bg-lime-400/10 text-lime-400 hover:bg-lime-400/20 rounded-lg disabled:opacity-40"
                              onClick={() => triggerDecideSwap(r.id, true)}
                              disabled={requestsBusy === r.id}
                              title={lang === "fr" ? "Approuver" : "Approve"}
                            >
                              <Check size={16} />
                            </button>
                            <button
                              className="p-2 bg-rose-400/10 text-rose-400 hover:bg-rose-400/20 rounded-lg disabled:opacity-40"
                              onClick={() => triggerDecideSwap(r.id, false)}
                              disabled={requestsBusy === r.id}
                              title={lang === "fr" ? "Refuser" : "Deny"}
                            >
                              <X size={16} />
                            </button>
                            <button
                              className="text-[10px] text-slate-500 hover:text-amber-400 transition-all"
                              onClick={() => { setOpenNoteFor(openNoteFor === r.id ? null : r.id); setNoteDraft(r.managerNote || ""); }}
                            >
                              {r.managerNote ? (lang === "fr" ? "✎ Modifier la note" : "✎ Edit note") : (lang === "fr" ? "+ Note / en attente" : "+ Note / hold")}
                            </button>
                          </div>
                          {openNoteFor === r.id && (
                            <div className="flex gap-2 pt-1">
                              <input
                                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-slate-200"
                                value={noteDraft}
                                onChange={e => setNoteDraft(e.target.value)}
                                placeholder={lang === "fr" ? "ex. à confirmer..." : "e.g. to confirm..."}
                                onKeyDown={e => e.key === "Enter" && triggerSaveSwapNote(r.id)}
                              />
                              <button className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-semibold" onClick={() => triggerSaveSwapNote(r.id)}>
                                {lang === "fr" ? "OK" : "Save"}
                              </button>
                            </div>
                          )}
                        </div>
                        <MiniCalendar anchorDate={r.date} highlightDates={[r.date]} lang={lang} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Open (unclaimed) cover requests — informational, no action needed yet */}
          {appData.swapRequests.filter(r => r.status === "open").length > 0 && (
            <div className="bg-slate-900/50 border border-slate-800/60 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {lang === "fr" ? "Services ouverts (en attente de réclamation)" : "Open cover requests (awaiting a claim)"}
              </h3>
              {appData.swapRequests.filter(r => r.status === "open").map(r => (
                <div key={r.id} className="text-xs text-slate-400 flex items-center justify-between bg-slate-950/30 rounded-xl p-3">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                      style={{ backgroundColor: `${RC[r.role]}18`, color: RC[r.role] }}
                    >
                      {ROLES[r.role]}
                    </span>
                    {r.originalStaff} · {r.date} · {r.startTime}–{r.endTime}
                  </span>
                  <span className="text-slate-600">{lang === "fr" ? "personne n'a réclamé" : "unclaimed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "messages" && (
        <div className="space-y-6 animate-fade-in">
          {/* ANNOUNCEMENTS */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-lg">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Mail size={14} className="text-lime-400" /> {lang === "fr" ? "Annonces" : "Announcements"}
            </h3>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                placeholder={lang === "fr" ? "Écrire une annonce pour toute l'équipe..." : "Write an announcement for the whole team..."}
                value={announcementDraft}
                onChange={e => setAnnouncementDraft(e.target.value)}
                onKeyDown={e => e.key === "Enter" && triggerPostAnnouncement()}
              />
              <button
                className="px-4 py-2 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-xs"
                onClick={triggerPostAnnouncement}
              >
                {lang === "fr" ? "Publier" : "Post"}
              </button>
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {appData.announcements.length === 0 && (
                <p className="text-xs text-slate-500 italic py-2">{lang === "fr" ? "Aucune annonce." : "No announcements yet."}</p>
              )}
              {appData.announcements.map(a => (
                <div key={a.id} className="flex items-start justify-between gap-2 bg-slate-950/40 border border-slate-800/60 rounded-xl p-3">
                  <div>
                    <p className="text-sm text-slate-200">{a.message}</p>
                    <p className="text-[10px] text-slate-500 mt-1 font-mono">
                      {new Date(a.postedAt).toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button className="p-1 text-slate-600 hover:text-rose-400 rounded" onClick={() => triggerDeleteAnnouncement(a.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* PRIVATE THREADS */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
              {lang === "fr" ? "Messages privés" : "Private messages"}
            </h3>
            <p className="text-[10px] text-slate-600 mb-3">
              {lang === "fr" ? "Les messages sont automatiquement supprimés après 30 jours." : "Messages are automatically deleted after 30 days."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 md:col-span-1">
                {appData.staff.map(s => {
                  const thread = appData.messages.filter(m => m.staffName === s.name).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
                  const hasUnread = thread[0]?.from === "staff";
                  return (
                    <button
                      key={s.name}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-all ${selectedMessageThread === s.name ? "bg-lime-400/10 text-lime-400" : "bg-slate-950/40 text-slate-300 hover:bg-slate-800"}`}
                      onClick={() => setSelectedMessageThread(s.name)}
                    >
                      {s.name}
                      {hasUnread && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                    </button>
                  );
                })}
              </div>
              <div className="md:col-span-2 bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 flex flex-col min-h-[280px]">
                {!selectedMessageThread ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                    {lang === "fr" ? "Sélectionnez un employé pour voir la conversation." : "Select a staff member to view the conversation."}
                  </div>
                ) : (
                  <>
                    <div className="flex-1 space-y-2 overflow-y-auto max-h-64 mb-3">
                      {appData.messages.filter(m => m.staffName === selectedMessageThread).length === 0 && (
                        <p className="text-xs text-slate-500 italic">{lang === "fr" ? "Pas encore de messages." : "No messages yet."}</p>
                      )}
                      {appData.messages.filter(m => m.staffName === selectedMessageThread).map(m => (
                        <div key={m.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${m.from === "manager" ? "bg-lime-400/10 text-lime-300 ml-auto" : "bg-slate-800 text-slate-200"}`}>
                          {m.text}
                          <div className="text-[9px] opacity-60 mt-1 font-mono">
                            {new Date(m.sentAt).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                        placeholder={lang === "fr" ? "Répondre..." : "Reply..."}
                        value={managerReplyDraft}
                        onChange={e => setManagerReplyDraft(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && triggerSendReply()}
                      />
                      <button
                        className="px-3 py-2 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-xs"
                        onClick={triggerSendReply}
                      >
                        {lang === "fr" ? "Envoyer" : "Send"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "stats" && (() => {
        const now = new Date();
        const weeksBack = statsWeeks;
        const rangeStart = new Date(now);
        rangeStart.setDate(rangeStart.getDate() - weeksBack * 7);

        const approvedInRange = appData.entries.filter(
          e => e.status === "approved" && e.type === "worked" && new Date(e.date) >= rangeStart
        );

        const weekKeyOf = (dateStr: string) => {
          const d = new Date(dateStr);
          const day = d.getDay() || 7;
          const monday = new Date(d);
          monday.setDate(d.getDate() - day + 1);
          return monday.toISOString().slice(0, 10);
        };

        const staffByName: Record<string, StaffMember> = Object.fromEntries(appData.staff.map(s => [s.name, s]));

        const weekBuckets: Record<string, { hours: number; cost: number }> = {};
        approvedInRange.forEach(e => {
          const key = weekKeyOf(e.date);
          const rate = staffByName[e.name]?.rate ?? 0;
          if (!weekBuckets[key]) weekBuckets[key] = { hours: 0, cost: 0 };
          weekBuckets[key].hours += e.hours;
          weekBuckets[key].cost += e.hours * rate * (1 - taxRate / 100);
        });
        const trendData = Object.entries(weekBuckets)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([week, v]) => ({
            week: new Date(week).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "2-digit", month: "short" }),
            hours: Math.round(v.hours * 10) / 10,
            cost: Math.round(v.cost),
          }));

        const roleHours: Record<string, number> = {};
        approvedInRange.forEach(e => {
          const role = staffByName[e.name]?.role ?? "other";
          roleHours[role] = (roleHours[role] ?? 0) + e.hours;
        });
        const roleData = Object.entries(roleHours)
          .filter(([, h]) => h > 0)
          .map(([role, hours]) => ({
            role, name: ROLES[role as RoleType],
            hours: Math.round(hours * 10) / 10,
            color: RC[role as RoleType],
          }));

        const staffHours: Record<string, number> = {};
        approvedInRange.forEach(e => { staffHours[e.name] = (staffHours[e.name] ?? 0) + e.hours; });
        const otData = appData.staff
          .map(s => ({
            name: s.name,
            contract: s.contract,
            avgWeekly: weeksBack > 0 ? Math.round(((staffHours[s.name] ?? 0) / weeksBack) * 10) / 10 : 0,
          }))
          .sort((a, b) => b.avgWeekly - a.avgWeekly);

        const totalHours = approvedInRange.reduce((s, e) => s + e.hours, 0);
        const totalCost = approvedInRange.reduce((s, e) => s + e.hours * (staffByName[e.name]?.rate ?? 0) * (1 - taxRate / 100), 0);
        const avgPerStaff = appData.staff.length > 0 ? totalHours / appData.staff.length : 0;
        const pendingCount = appData.entries.filter(e => e.status === "pending" || e.status === "correction").length;
        const advancesInRange = appData.advances
          .filter(a => new Date(a.date) >= rangeStart)
          .reduce((s, a) => s + a.amount, 0);

        const chartAxisColor = theme === "light" ? "#64748b" : "#94a3b8";
        const chartGridColor = theme === "light" ? "#e2e8f0" : "#1e293b";
        const tooltipStyle = {
          backgroundColor: theme === "light" ? "#ffffff" : "#0f172a",
          border: "1px solid #334155", fontSize: 12, borderRadius: 8,
        };

        return (
          <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <BarChart3 size={16} className="text-lime-400" /> {t("stats")}
              </h2>
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs font-semibold">
                {[4, 8, 12, 26].map(w => (
                  <button
                    key={w}
                    className={`px-3 py-1.5 rounded-lg transition-all ${statsWeeks === w ? "bg-lime-400 text-slate-950" : "text-slate-400 hover:text-slate-200"}`}
                    onClick={() => setStatsWeeks(w)}
                  >
                    {w === 26 ? (lang === "fr" ? "6 mois" : "6 months") : `${w} ${lang === "fr" ? "sem." : "wks"}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("totalHours")}</div>
                <div className="text-2xl font-mono font-bold text-slate-100">{totalHours.toFixed(1)}h</div>
              </div>
              <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("netCost")}</div>
                <div className="text-2xl font-mono font-bold text-lime-400">€{totalCost.toFixed(0)}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-1">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Moy. h / employé" : "Avg h / staff"}</div>
                <div className="text-2xl font-mono font-bold text-slate-100">{avgPerStaff.toFixed(1)}h</div>
              </div>
              <div className={`bg-slate-900 border rounded-2xl p-4 space-y-1 ${pendingCount > 0 ? "border-amber-500/30" : "border-slate-800/80"}`}>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "En attente" : "Pending approvals"}</div>
                <div className={`text-2xl font-mono font-bold ${pendingCount > 0 ? "text-amber-400" : "text-slate-100"}`}>{pendingCount}</div>
              </div>
            </div>

            {trendData.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
                {lang === "fr" ? "Pas encore assez de données approuvées pour cette période." : "Not enough approved data yet for this period."}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                      {lang === "fr" ? "Tendance des heures (par semaine)" : "Hours trend (weekly)"}
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                        <XAxis dataKey="week" tick={{ fontSize: 10, fill: chartAxisColor }} />
                        <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="hours" fill="#a3e635" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                      {lang === "fr" ? "Coût de la main-d'œuvre (net, par semaine)" : "Labor cost (net, weekly)"}
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                        <XAxis dataKey="week" tick={{ fontSize: 10, fill: chartAxisColor }} />
                        <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`€${v}`, lang === "fr" ? "Coût" : "Cost"]} />
                        <Line type="monotone" dataKey="cost" stroke="#a3e635" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                      {lang === "fr" ? "Répartition par poste (heures)" : "Hours by role"}
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={roleData} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(entry) => `${entry.name}`}>
                          {roleData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}h`, ""]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                      {lang === "fr" ? "Heures moy./semaine vs. contrat" : "Avg weekly hours vs. contract"}
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={otData} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: chartAxisColor }} />
                        <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 10, fill: chartAxisColor }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="contract" name={lang === "fr" ? "Contrat" : "Contract"} fill={theme === "light" ? "#cbd5e1" : "#334155"} radius={[0, 4, 4, 0]} />
                        <Bar dataKey="avgWeekly" name={lang === "fr" ? "Moy. réel" : "Avg actual"} fill="#a3e635" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  {lang === "fr" ? "Avances en espèces (période)" : "Cash advances (period)"}
                </h3>
                <p className="text-[11px] text-slate-500 mt-1">
                  {lang === "fr" ? "Total avancé sur la période sélectionnée" : "Total advanced over the selected period"}
                </p>
              </div>
              <div className="text-2xl font-mono font-bold text-amber-400">€{advancesInRange.toFixed(0)}</div>
            </div>
          </div>
        );
      })()}

      {/* ── PARAMÈTRES (SETTINGS) TAB ───────────────────────── */}
      {activeTab === "settings" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
          {/* LEFT: RESTO & HOUR CONFIG */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Settings size={15} /> {t("restaurantInfo")}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{t("restaurantName")}</label>
                  <input className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 placeholder-slate-600" placeholder={t("restaurantNamePlaceholder")} value={restoName} onChange={e => setRestoName(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{t("newManagerPin")}</label>
                  <input className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 placeholder-slate-600" type="password" placeholder={t("pinPlaceholder")} value={newManagerPin} onChange={e => setNewManagerPin(e.target.value)} />
                </div>
              </div>
              <button className="px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-md" onClick={triggerSaveGeneral}>{t("save")}</button>
            </div>

            {/* MANAGERS */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Users size={15} /> {lang === "fr" ? "Gérants" : "Managers"}
              </h3>
              <p className="text-[11px] text-slate-500 leading-normal">
                {lang === "fr"
                  ? "Plusieurs personnes peuvent gérer ce restaurant avec un accès identique et complet."
                  : "More than one person can manage this restaurant, each with identical full access."}
              </p>

              <div className="space-y-1.5">
                {(appData.managerEmails || []).map(em => (
                  <div key={em} className="flex items-center justify-between bg-slate-950/40 border border-slate-800/60 rounded-xl p-2.5">
                    <span className="text-xs text-slate-300">{em}</span>
                    <button
                      className="text-[10px] text-slate-500 hover:text-rose-400 font-semibold disabled:opacity-40"
                      onClick={() => triggerRemoveManager(em)}
                      disabled={removeBusy === em || (appData.managerEmails || []).length <= 1}
                      title={(appData.managerEmails || []).length <= 1 ? (lang === "fr" ? "Il doit rester au moins un gérant" : "Must keep at least one manager") : undefined}
                    >
                      {removeBusy === em ? "..." : (lang === "fr" ? "Retirer" : "Remove")}
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <input
                  type="email"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                  placeholder={lang === "fr" ? "email@exemple.com" : "email@example.com"}
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && triggerInviteManager()}
                />
                <button
                  className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                  onClick={triggerInviteManager}
                  disabled={inviteBusy || !inviteEmail.trim()}
                >
                  {inviteBusy ? "..." : (lang === "fr" ? "Inviter" : "Invite")}
                </button>
              </div>
              {inviteMsg && <p className="text-[10px] text-slate-500">{inviteMsg}</p>}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <DollarSign size={15} /> {t("hoursAndTax")}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{t("weeklyOTLimit")}</label>
                  <input className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50" type="number" value={overtimeLimit} onChange={e => setOvertimeLimit(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-500 block mt-1">{t("franceStandard")}</span>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    {lang === "fr" ? "Retenues / cotisations" : "Deductions"}
                  </label>
                  <div className="space-y-2">
                    {deductions.map(d => (
                      <div key={d.id} className="flex items-center gap-2">
                        <input
                          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                          placeholder={lang === "fr" ? "ex. Impôt sur le revenu" : "e.g. Income tax"}
                          value={d.label}
                          onChange={e => updateDeduction(d.id, "label", e.target.value)}
                        />
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <input
                            className="w-16 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-center text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                            type="number"
                            value={d.rate}
                            onChange={e => updateDeduction(d.id, "rate", Number(e.target.value))}
                          />
                          <span className="text-[10px] text-slate-500">%</span>
                        </div>
                        <button
                          className="p-1.5 text-slate-600 hover:text-rose-400 flex-shrink-0"
                          onClick={() => removeDeduction(d.id)}
                          disabled={deductions.length <= 1}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="text-[10px] text-lime-400 hover:text-lime-300 font-semibold mt-2"
                    onClick={addDeduction}
                  >
                    + {lang === "fr" ? "Ajouter une retenue" : "Add deduction"}
                  </button>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-800/60 text-[11px]">
                    <span className="text-slate-500">{lang === "fr" ? "Total" : "Total"}</span>
                    <span className="font-mono font-bold text-slate-300">{deductions.reduce((s, d) => s + (Number(d.rate) || 0), 0)}%</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2 leading-snug">
                    {lang === "fr"
                      ? "Vous pouvez laisser ceci vide si vous préférez calculer les retenues en dehors de Brigado."
                      : "You can leave this empty if you'd rather calculate deductions outside of Brigado."}
                  </p>
                </div>
              </div>
              <button className="px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-md" onClick={triggerSaveGeneral}>{t("save")}</button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Clipboard size={15} /> {t("behaviour")}
              </h3>
              <div className="flex justify-between items-center bg-slate-950/40 p-3 border border-slate-800/60 rounded-xl">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center">
                    {t("requireApproval")}
                    <InfoTooltip text={lang === "fr"
                      ? "Activé : les heures saisies par le personnel restent \"en attente\" et ne comptent qu'une fois validées par vous. Désactivé : les heures saisies sont approuvées automatiquement."
                      : "On: hours staff submit show as \"pending\" and only count once you approve them. Off: submitted hours are approved automatically."} />
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">{t("requireApprovalSub")}</div>
                </div>
                <Toggle checked={approvalRequired} onChange={triggerSaveBehaviour} />
              </div>

              {/* Toggle Scheduling */}
              <div className="flex justify-between items-center bg-slate-950/40 p-3 border border-slate-800/60 rounded-xl">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center">
                    {t("enableScheduling")}
                    <InfoTooltip text={lang === "fr"
                      ? "Affiche ou masque complètement l'onglet Planning Rota. Si vous ne planifiez pas les services à l'avance, vous pouvez le désactiver pour simplifier l'application."
                      : "Shows or completely hides the Rota Planner tab. If you don't build advance schedules, turning this off simplifies the app."} />
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                    {lang === "fr" ? "Activer ou désactiver le planning rota de l'établissement." : "Enable or disable the rota planner for this restaurant."}
                  </div>
                </div>
                <Toggle checked={enableScheduling} onChange={triggerSaveEnableScheduling} />
              </div>

              {/* Compliance rules menu */}
              <div className="bg-slate-950/40 p-3 border border-slate-800/60 rounded-xl">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xs font-semibold text-slate-200 flex items-center">
                      {t("complianceEnforced")}
                      <InfoTooltip text={lang === "fr"
                        ? "Active le moteur d'alertes légales dans son ensemble. Utilisez \"Gérer les règles individuelles\" ci-dessous pour choisir précisément lesquelles s'appliquent à votre établissement."
                        : "Turns the legal-alerts engine on/off as a whole. Use \"Manage individual rules\" below to choose exactly which ones apply to your business."} />
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                      {lang === "fr" ? "Afficher des alertes sur le planning selon la législation française." : "Show visual alert icons for daily rest and maximum work violations."}
                    </div>
                  </div>
                  <Toggle checked={complianceEnforced} onChange={triggerSaveComplianceEnforced} />
                </div>
                <button
                  className="text-[11px] font-semibold text-lime-500/90 hover:text-lime-400 underline decoration-lime-500/40 hover:decoration-lime-400 underline-offset-2 transition-all mt-2"
                  onClick={() => setShowComplianceInfo(v => !v)}
                >
                  {showComplianceInfo
                    ? (lang === "fr" ? "▾ Masquer les règles" : "▾ Hide rules")
                    : (lang === "fr" ? "▸ Gérer les règles individuelles" : "▸ Manage individual rules")}
                </button>

                {showComplianceInfo && (
                  <div className="mt-3 pt-3 border-t border-slate-800/60 space-y-4">
                    <div className="flex gap-2">
                      <button className="text-[10px] px-2.5 py-1 bg-lime-400/10 text-lime-400 rounded-lg font-semibold" onClick={() => triggerSetAllComplianceRules(true)}>
                        {lang === "fr" ? "Tout activer" : "Select all"}
                      </button>
                      <button className="text-[10px] px-2.5 py-1 bg-slate-800 text-slate-300 rounded-lg font-semibold" onClick={() => triggerSetAllComplianceRules(false)}>
                        {lang === "fr" ? "Tout désactiver" : "Deselect all"}
                      </button>
                    </div>

                    {([
                      ["hours", lang === "fr" ? "Temps de travail" : "Working Hours"],
                      ["rest", lang === "fr" ? "Périodes de repos" : "Rest Periods"],
                      ["overtime", lang === "fr" ? "Heures supplémentaires" : "Overtime"],
                      ["night_sunday", lang === "fr" ? "Nuit / Dimanche" : "Night / Sunday Work"],
                      ["minors", lang === "fr" ? "Mineurs" : "Minors"],
                    ] as [ComplianceCategory, string][]).map(([cat, catLabel]) => {
                      const rulesInCat = COMPLIANCE_RULES.filter(r => r.category === cat);
                      const allOn = rulesInCat.every(r => isRuleEnabled(complianceRules, r.id));
                      return (
                        <div key={cat} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{catLabel}</span>
                            <button
                              className="text-[9px] text-slate-600 hover:text-lime-400"
                              onClick={() => triggerToggleCategoryRules(cat, !allOn)}
                            >
                              {allOn ? (lang === "fr" ? "tout désactiver" : "turn all off") : (lang === "fr" ? "tout activer" : "turn all on")}
                            </button>
                          </div>
                          {rulesInCat.map(rule => (
                            <div key={rule.id} className="flex items-start justify-between gap-3 bg-slate-900/40 rounded-lg p-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-slate-200">{lang === "fr" ? rule.labelFr : rule.labelEn}</div>
                                <div className="text-[10px] text-slate-400 font-medium mt-0.5 leading-snug">{lang === "fr" ? rule.descFr : rule.descEn}</div>
                                <a href={rule.link} target="_blank" rel="noopener noreferrer" className="text-[9px] text-lime-500/80 hover:text-lime-400 underline">
                                  {rule.article} ↗
                                </a>
                              </div>
                              <Toggle checked={isRuleEnabled(complianceRules, rule.id)} onChange={val => triggerToggleComplianceRule(rule.id, val)} />
                            </div>
                          ))}
                        </div>
                      );
                    })}

                    <div className="pt-2 border-t border-slate-800/60">
                      <p className="text-[10px] font-semibold text-amber-400/90 mb-1">
                        {lang === "fr" ? "Non suivi par Brigado (à connaître) :" : "Not tracked by Brigado (worth knowing about):"}
                      </p>
                      <ul className="text-[10px] text-slate-500 list-disc list-inside space-y-0.5 leading-snug">
                        {(lang === "fr" ? NOT_TRACKED_FR : NOT_TRACKED_EN).map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                        {lang === "fr"
                          ? "Ces règles ne sont pas des avis juridiques — vérifiez toujours avec un professionnel pour votre situation exacte."
                          : "These rules aren't legal advice — always verify with a professional for your exact situation."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* SMIC */}
              <div className="bg-slate-950/40 p-3 border border-slate-800/60 rounded-xl">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  {lang === "fr" ? "SMIC horaire actuel" : "Current SMIC hourly rate"}
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-500">€</span>
                    <input
                      className="w-20 bg-slate-950 border border-slate-800 rounded-xl p-2 text-center font-mono text-xs text-slate-200"
                      type="number"
                      step="0.01"
                      value={smicHourly}
                      onChange={e => setSmicHourly(Number(e.target.value))}
                      onBlur={triggerSaveSmic}
                    />
                    <span className="text-[10px] text-slate-500">/h</span>
                  </div>
                  <span className="text-[10px] text-slate-600">{lang === "fr" ? "mis à jour manuellement chaque année" : "manually updated once a year"}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-2 leading-snug">
                  {lang === "fr"
                    ? "Réglez sur 0 pour désactiver l'alerte de taux sous le SMIC."
                    : "Set to 0 to disable the below-SMIC alert."}
                </p>
                {appData.staff.filter(s => s.active !== false && s.rate < smicHourly).length > 0 && (
                  <div className="mt-2 text-[10px] text-rose-400">
                    ⚠️ {lang === "fr" ? "Taux sous le SMIC :" : "Below SMIC:"} {appData.staff.filter(s => s.active !== false && s.rate < smicHourly).map(s => s.name).join(", ")}
                  </div>
                )}
              </div>

              {/* Toggle Mandatory Clock In/Out */}
              <div className="flex justify-between items-center bg-slate-950/40 p-3 border border-slate-800/60 rounded-xl">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center">
                    {t("strictClockRequired")}
                    <InfoTooltip text={lang === "fr"
                      ? "Utile si votre équipe travaille des horaires variables ou si vous voulez des heures précises à la minute plutôt qu'estimées. Concerne uniquement les services \"Travaillé\" — absences, maladie et congés restent des sélections manuelles."
                      : "Useful if your team's hours vary a lot, or you want minute-accurate timestamps instead of estimated ones. Only affects \"Worked\" shifts — absence, sick, and holiday entries stay manual either way."} />
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">{t("strictClockRequiredSub")}</div>
                </div>
                <Toggle checked={strictClockRequired} onChange={triggerSaveStrictClock} />
              </div>

              {/* Timesheet signatures */}
              <div className="flex justify-between items-center bg-slate-950/40 p-3 border border-slate-800/60 rounded-xl">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center">
                    {lang === "fr" ? "Lignes de signature sur le relevé d'heures" : "Signature lines on printed timesheets"}
                    <InfoTooltip text={lang === "fr"
                      ? "Ajoute deux lignes vierges (employé et responsable) en bas du relevé d'heures imprimable, pour les entreprises qui souhaitent une trace signée sur papier."
                      : "Adds two blank lines (employee and manager) at the bottom of the printable timesheet, for businesses that want a signed paper record."} />
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                    {lang === "fr" ? "Ajoute des lignes de signature (employé + responsable) au document imprimé." : "Adds employee + manager signature lines to the printed document."}
                  </div>
                </div>
                <Toggle checked={timesheetSignatures} onChange={triggerSaveTimesheetSignatures} />
              </div>

              {/* Weekly digest email */}
              <div className="bg-slate-950/40 p-3 border border-slate-800/60 rounded-xl space-y-2">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-semibold text-slate-200 flex items-center">
                    {lang === "fr" ? "Résumé hebdomadaire par e-mail" : "Weekly email digest"}
                    <InfoTooltip text={lang === "fr"
                      ? "Un e-mail automatique chaque dimanche soir avec les heures de la semaine, les alertes signalées et les demandes en attente — pour ne rien manquer sans devoir ouvrir l'application."
                      : "An automatic email every Sunday evening with the week's hours, flagged alerts, and pending requests — so nothing slips through without opening the app."} />
                  </div>
                  <Toggle
                    checked={digestEnabled}
                    onChange={val => {
                      setDigestEnabled(val);
                      if (!val) {
                        setDigestEmail("");
                        saveConfig({ digest_email: "" }).then(onRefresh).catch(console.error);
                      }
                    }}
                  />
                </div>
                <div className="text-[10px] text-slate-400 font-medium leading-snug">
                  {lang === "fr"
                    ? "Envoyé automatiquement chaque dimanche soir : heures approuvées, alertes signalées et demandes en attente des 7 derniers jours."
                    : "Sent automatically every Sunday evening: approved hours, flagged alerts, and pending requests from the last 7 days."}
                </div>
                {digestEnabled && (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200"
                        placeholder="you@restaurant.com"
                        value={digestEmail}
                        onChange={e => setDigestEmail(e.target.value)}
                        onBlur={triggerSaveDigestEmail}
                      />
                      <button
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[10px] font-semibold disabled:opacity-50 whitespace-nowrap"
                        onClick={triggerSendDigestNow}
                        disabled={digestSending || !digestEmail.trim()}
                      >
                        {digestSending ? "..." : (lang === "fr" ? "Envoyer maintenant" : "Send now")}
                      </button>
                    </div>
                    {digestSentMsg && <p className="text-[10px] text-slate-500">{digestSentMsg}</p>}
                  </>
                )}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Mail size={15} /> {t("bookkeeper")}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{t("emailAddress")}</label>
                  <input className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 placeholder-slate-600" type="email" placeholder={t("emailPlaceholder")} value={bookkeeperEmail} onChange={e => setBookkeeperEmail(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{t("sheetsUrl")}</label>
                  <input className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 placeholder-slate-600" placeholder={t("sheetsPlaceholder")} value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} />
                </div>
              </div>
              <button className="px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-md" onClick={triggerSaveBookkeeper}>{t("save")}</button>
            </div>
          </div>

          {/* RIGHT: STAFF LIST MANAGEMENT & QR */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Users size={15} /> {t("staffListRates")}
              </h3>
              <p className="text-[11px] text-slate-500 leading-normal">{t("staffListSub")}</p>

              {/* ROLE FILTER */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all ${staffRoleFilter === "all" ? "bg-lime-400/10 border-lime-400 text-lime-400" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                  onClick={() => setStaffRoleFilter("all")}
                >
                  {lang === "fr" ? "Tous" : "All"}
                </button>
                {(Object.keys(ROLES) as RoleType[]).map(r => (
                  <button
                    key={r}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all ${staffRoleFilter === r ? "border-current" : "bg-slate-950 border-slate-800 text-slate-400"}`}
                    style={staffRoleFilter === r ? { color: RC[r], backgroundColor: `${RC[r]}15` } : undefined}
                    onClick={() => setStaffRoleFilter(r)}
                  >
                    {ROLES[r]}
                  </button>
                ))}
              </div>
              
              {/* STAFF LIST — active first */}
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {appData.staff
                  .filter(s => s.active !== false && (staffRoleFilter === "all" || s.role === staffRoleFilter))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(member => (
                  <div key={member.name} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="w-8 h-8 flex-shrink-0 rounded-full border flex items-center justify-center font-bold text-[10px]"
                        style={{ backgroundColor: `${RC[member.role]}20`, borderColor: `${RC[member.role]}50`, color: RC[member.role] }}
                      >
                        {member.name.charAt(0)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-slate-200 truncate">{member.name}</span>
                        <select 
                          className={`bg-transparent text-[10px] focus:outline-none cursor-pointer mt-0.5 ${theme === "light" ? "text-slate-600" : "text-slate-400"}`}
                          value={member.role}
                          onChange={e => triggerSaveStaffMemberFields(member.name, { role: e.target.value as RoleType })}
                        >
                          {(Object.keys(ROLES) as RoleType[]).map(r => (
                            <option key={r} value={r} className={theme === "light" ? "bg-white text-slate-700" : "bg-slate-900 text-slate-300"}>{ROLES[r]}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 self-end sm:self-center">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500">€</span>
                        <input 
                          className={`w-16 bg-slate-950 border rounded px-1.5 py-1.5 text-center font-mono font-bold text-xs text-slate-200 focus:outline-none focus:border-lime-400/50 ${member.rate < smicHourly ? "border-rose-500/60" : "border-slate-800"}`}
                          type="number"
                          value={member.rate}
                          title={member.rate < smicHourly ? (lang === "fr" ? `Sous le SMIC (€${smicHourly}/h)` : `Below SMIC (€${smicHourly}/h)`) : undefined}
                          onChange={e => triggerSaveStaffMemberFields(member.name, { rate: Number(e.target.value) })}
                        />
                        <span className="text-[10px] text-slate-500">/h</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500" title="Contract Hours">⏱</span>
                        <input 
                          className="w-14 bg-slate-950 border border-slate-800 rounded px-1.5 py-1.5 text-center font-mono font-bold text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                          type="number"
                          value={member.contract}
                          onChange={e => triggerSaveStaffMemberFields(member.name, { contract: Number(e.target.value) })}
                        />
                        <span className="text-[10px] text-slate-500">h</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500" title="Personal PIN">🔒</span>
                        <input 
                          className="w-20 bg-slate-950 border border-slate-800 rounded px-1.5 py-1.5 text-center font-mono font-bold text-xs text-slate-200 focus:outline-none focus:border-lime-400/50"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="PIN"
                          value={member.pin || ""}
                          onChange={e => triggerSaveStaffMemberFields(member.name, { pin: e.target.value.trim() })}
                        />
                      </div>

                      <button
                        className={`p-1.5 rounded flex-shrink-0 text-xs ${member.is_minor ? "bg-amber-500/15 text-amber-400" : "text-slate-600 hover:text-slate-400"}`}
                        title={lang === "fr" ? "Marquer comme mineur (moins de 18 ans)" : "Mark as minor (under 18)"}
                        onClick={() => triggerSaveStaffMemberFields(member.name, { is_minor: !member.is_minor })}
                      >
                        {member.is_minor ? "🔞" : "👤"}
                      </button>

                      <button
                        className="p-1 hover:bg-amber-500/10 rounded text-slate-500 hover:text-amber-400 flex-shrink-0"
                        title={lang === "fr" ? "Archiver (ancien employé)" : "Archive (former staff)"}
                        onClick={() => triggerArchiveStaff(member.name)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* ADD NEW MEMBER */}
              <div className="pt-2 border-t border-slate-800">
                <button
                  className="w-full py-2.5 bg-slate-950 border border-slate-800 hover:border-lime-400/50 hover:text-lime-400 text-slate-300 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                  onClick={() => { setNewStaffContract(overtimeLimit); setShowAddStaffModal(true); }}
                >
                  + {lang === "fr" ? "Ajouter un employé" : "Add staff member"}
                </button>
              </div>
            </div>

            {/* FORMER STAFF — own section, not tucked under active roster.
                Data is never deleted just by archiving someone — click a
                row for tenure history, reactivation, export, and (only
                once 5+ years past their last activity) permanent deletion. */}
            {(() => {
              const former = appData.staff
                .filter(s => s.active === false && (staffRoleFilter === "all" || s.role === staffRoleFilter))
                .sort((a, b) => a.name.localeCompare(b.name));
              if (former.length === 0) return null;
              return (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
                  <button
                    className="w-full flex items-center justify-between gap-2"
                    onClick={() => setShowFormerStaff(v => !v)}
                  >
                    <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                      <Users size={15} className="text-slate-500" /> {lang === "fr" ? "Anciens employés" : "Former staff"} ({former.length})
                    </h3>
                    <span className="text-slate-500 text-xs">{showFormerStaff ? "▾" : "▸"}</span>
                  </button>
                  {showFormerStaff && (
                    <div className="space-y-3 mt-3">
                      <p className="text-[11px] text-slate-500 leading-normal">
                        {lang === "fr"
                          ? "Leur historique d'heures et de paie reste intact. Cliquez sur un nom pour voir leur historique, réactiver, ou exporter."
                          : "Their hours and payroll history stays intact. Click a name to see their history, reactivate, or export."}
                      </p>
                      <div className="space-y-1.5">
                        {former.map(member => (
                          <button
                            key={member.name}
                            className="w-full flex items-center justify-between gap-2 p-2.5 bg-slate-950/20 hover:bg-slate-950/40 border border-slate-800/40 rounded-xl transition-all text-left"
                            onClick={() => setSelectedFormerStaff(member)}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs text-slate-300 font-semibold truncate">{member.name}</span>
                              <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex-shrink-0"
                                style={{ backgroundColor: `${RC[member.role]}15`, color: RC[member.role] }}
                              >
                                {ROLES[member.role]}
                              </span>
                            </div>
                            <span className="text-slate-600 text-xs flex-shrink-0">→</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* QR CODE GENERATOR */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg text-center">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center justify-center gap-2">
                {t("qrTitle")}
              </h3>
              <p className="text-[11px] text-slate-500 leading-normal">{t("qrSub")}</p>

              <div className="inline-block bg-white p-2.5 rounded-xl border-4 border-lime-400 shadow-md">
                {qrPreviewUrl ? (
                  <img src={qrPreviewUrl} alt="QR code" className="w-32 h-32" />
                ) : (
                  <div className="w-32 h-32 flex items-center justify-center bg-slate-950 text-lime-400 font-bold text-center text-xs p-3 select-none rounded">
                    ...
                  </div>
                )}
              </div>
              <div className="text-[10px] font-mono text-slate-500 max-w-[280px] mx-auto truncate">
                {`${window.location.origin}/${getRestaurantId()}?src=qr`}
              </div>
              <button
                className="w-full py-3 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-slate-100 font-semibold rounded-xl text-xs transition-all flex items-center justify-center gap-2"
                onClick={() => setShowQRPoster(true)}
              >
                {t("printQR")}
              </button>
            </div>

            {/* DANGER ZONE */}
            <div className="bg-rose-500/[0.03] border border-rose-500/20 rounded-2xl p-5 space-y-3 shadow-lg">
              <h3 className="text-sm font-semibold text-rose-400">{t("dangerZone")}</h3>
              <p className="text-[11px] text-slate-500 leading-normal">{t("dangerSub")}</p>
              <button 
                className="w-full py-3 border border-rose-500/30 hover:border-rose-500 bg-transparent text-rose-400 font-bold rounded-xl text-xs transition-all"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                {t("deleteAll")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CASH ADVANCE MODAL */}
      {advanceModalStaff && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-sm space-y-4 animate-scale-in">
            <div>
              <h3 className="text-base font-bold text-slate-100">{t("advances")} — {advanceModalStaff}</h3>
              <p className="text-xs text-slate-400 mt-1">{t("manageAdvancesForEmployee")}</p>
            </div>

            {/* ADVANCE LIST FOR PERSON */}
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {getAdvancesByScope(advanceModalStaff).length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">{t("noAdvancesRecorded")}</p>
              ) : (
                getAdvancesByScope(advanceModalStaff).map(a => (
                  <div key={a.id} className="flex justify-between items-center text-xs bg-slate-950/40 p-2 border border-slate-800/60 rounded-xl">
                    <span className="font-mono text-amber-400 font-bold">€{a.amount.toFixed(2)}</span>
                    <span className="text-slate-500 text-[10px]">{a.date}</span>
                    <button className="p-1 text-slate-500 hover:text-rose-400 text-[10px]" onClick={() => triggerDeleteAdvance(a.id)}>✕</button>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-800 pt-3 space-y-3">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nouvelle avance</div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1 flex-1">
                  <span className="text-xs text-slate-500">€</span>
                  <input
                    className="w-full bg-transparent text-sm font-mono font-bold text-slate-100 focus:outline-none placeholder-slate-700"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newAdvAmount}
                    onChange={e => setNewAdvAmount(e.target.value)}
                  />
                </div>
                <input
                  type="date"
                  className="bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-200"
                  value={newAdvDate}
                  onChange={e => setNewAdvDate(e.target.value)}
                />
              </div>
              <input
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none placeholder-slate-700"
                placeholder="Note (optionnel)"
                value={newAdvNote}
                onChange={e => setNewAdvNote(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button className="flex-1 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-xl transition-all text-xs" onClick={triggerAddAdvance}>
                Enregistrer l'avance
              </button>
              <button className="py-3 px-4 border border-slate-800 hover:border-slate-700 bg-slate-900 rounded-xl text-slate-400 text-xs" onClick={closeAdvanceModal}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SYSTEM CLEAR ALL MODAL */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-bold text-rose-400">⚠️ {lang === "fr" ? "Confirmation finale" : "Final confirmation"}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === "fr" 
                ? "Cette action est permanente. Toutes les heures, saisies et historiques seront perdus à jamais."
                : "This action is permanent. All hours, entries and history will be lost forever."}
              <br /><br />
              {lang === "fr" ? "Tapez" : "Type"}{" "}
              <strong className="text-rose-400 font-mono">DELETE</strong>{" "}
              {lang === "fr" ? "pour confirmer." : "to confirm."}
            </p>
            <input
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-center text-sm font-mono text-slate-100 uppercase tracking-widest focus:outline-none"
              placeholder="DELETE"
              value={deleteVerifyText}
              onChange={e => setDeleteVerifyText(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-3 bg-rose-500 text-slate-100 font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:bg-rose-400 transition-all text-xs"
                disabled={deleteVerifyText !== "DELETE"}
                onClick={triggerClearAll}
              >
                Supprimer définitivement
              </button>
              <button
                className="py-3 px-4 border border-slate-800 hover:border-slate-700 bg-slate-900 rounded-xl text-slate-400 text-xs"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD/EDIT SCHEDULE SHIFT MODAL */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-850 rounded-2xl p-6 w-full max-w-sm space-y-4 animate-scale-in">
            <div>
              <h3 className="text-base font-bold text-slate-100">
                {selectedScheduleShift ? t("editShift") : t("addShift")}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {selectedScheduleShift
                  ? (lang === "fr" ? "Ajustez les heures, le poste, ou réattribuez ce service à quelqu'un d'autre." : "Adjust the time, role, or reassign this shift to someone else.")
                  : "Attribuez des heures de service à un collaborateur."}
              </p>
            </div>
            
            <div className="space-y-3">
              {/* Staff Select */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  {lang === "fr" ? "Employé" : "Staff Member"}
                  {selectedScheduleShift && (
                    <span className="text-slate-600 normal-case font-normal ml-1">
                      {lang === "fr" ? "— changez ceci pour réattribuer" : "— change this to reassign"}
                    </span>
                  )}
                </label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                  value={scheduleForm.name}
                  onChange={e => {
                    const selectedName = e.target.value;
                    const staffMember = appData.staff.find(s => s.name === selectedName);
                    setScheduleForm(prev => ({
                      ...prev,
                      name: selectedName,
                      role: staffMember ? staffMember.role : prev.role
                    }));
                  }}
                >
                  <option value="">-- {t("unassigned")} --</option>
                  {appData.staff
                    .filter(s => s.active !== false || s.name === scheduleForm.name)
                    .map(s => (
                      <option key={s.name} value={s.name}>
                        {s.name}{s.active === false ? ` (${lang === "fr" ? "archivé" : "archived"})` : ""}
                      </option>
                    ))}
                </select>
              </div>

              {/* Date Input */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  {t("date")}
                </label>
                <input
                  type="date"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                  value={scheduleForm.date}
                  onChange={e => setScheduleForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>

              {/* Start & End Times */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    {t("start")}
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                    value={scheduleForm.startTime}
                    onChange={e => setScheduleForm(prev => ({ ...prev, startTime: e.target.value }))}
                  >
                    {!TIME_OPTIONS.includes(scheduleForm.startTime) && scheduleForm.startTime && (
                      <option value={scheduleForm.startTime}>{scheduleForm.startTime}</option>
                    )}
                    {TIME_OPTIONS.map(time => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    {t("finish")}
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                    value={scheduleForm.endTime}
                    onChange={e => setScheduleForm(prev => ({ ...prev, endTime: e.target.value }))}
                  >
                    {!TIME_OPTIONS.includes(scheduleForm.endTime) && scheduleForm.endTime && (
                      <option value={scheduleForm.endTime}>{scheduleForm.endTime}</option>
                    )}
                    {TIME_OPTIONS.map(time => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Role Select */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  {t("selectRole")}
                </label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                  value={scheduleForm.role}
                  onChange={e => setScheduleForm(prev => ({ ...prev, role: e.target.value as RoleType }))}
                >
                  {(Object.keys(ROLES) as RoleType[]).map(r => (
                    <option key={r} value={r}>{ROLES[r]}</option>
                  ))}
                </select>
              </div>

              {/* Overlap Live Warning */}
              {(() => {
                if (!scheduleForm.name) return null;
                const tempShift: ScheduledShift = {
                  id: selectedScheduleShift?.id || "temp",
                  name: scheduleForm.name,
                  date: scheduleForm.date,
                  startTime: scheduleForm.startTime,
                  endTime: scheduleForm.endTime,
                  hours: 0,
                  role: scheduleForm.role
                };
                const modalOverlaps = getOverlappingShifts(tempShift, appData.scheduledShifts || []);
                if (modalOverlaps.length === 0) return null;
                
                return (
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-[11px] text-rose-400 font-medium space-y-1 animate-scale-in">
                    <div className="font-extrabold flex items-center gap-1 text-rose-500">
                      ⚠️ {lang === "fr" ? "Conflit de planning" : "Scheduling Conflict"}
                    </div>
                    {modalOverlaps.map(os => (
                      <div key={os.id} className="leading-normal">
                        {t("shiftOverlapWarning", {
                          name: os.name,
                          start: os.startTime,
                          end: os.endTime,
                          date: os.date
                        })}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Modal actions */}
            <div className="space-y-2 pt-2 border-t border-slate-800/60">
              <button 
                className="w-full py-3 bg-lime-400 hover:bg-lime-300 text-slate-950 font-extrabold rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5"
                onClick={handleSaveScheduleShift}
              >
                {t("saveShift")}
              </button>

              {selectedScheduleShift && (
                <button 
                  className="w-full py-3 bg-slate-950 hover:bg-slate-800 text-amber-400 border border-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                  onClick={handleSaveAsCopyScheduleShift}
                >
                  <Copy size={13} />
                  {t("saveAsCopy")}
                </button>
              )}
              
              <div className="flex gap-2">
                {selectedScheduleShift && (
                  <button 
                    className="flex-1 py-2.5 bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-400 font-bold rounded-xl text-xs transition-all"
                    onClick={() => handleDeleteScheduleShift(selectedScheduleShift.id)}
                  >
                    {t("deleteShift")}
                  </button>
                )}

                <button 
                  className="flex-1 py-2.5 border border-slate-800 hover:border-slate-700 bg-slate-900 rounded-xl text-slate-400 text-xs"
                  onClick={() => setScheduleModalOpen(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showQRPoster && (
        <QRPoster
          restaurantName={appData.config.resto_name}
          slug={getRestaurantId()}
          lang={lang}
          onClose={() => setShowQRPoster(false)}
        />
      )}

      {showTimesheet && activePersonFilter !== "all" && (() => {
        const staffMember = appData.staff.find(s => s.name === activePersonFilter);
        if (!staffMember) return null;
        const periodEntries = getRangeData().filter(e => e.name === activePersonFilter);
        return (
          <Timesheet
            staff={staffMember}
            entries={periodEntries}
            periodLabel={getRangeLabel()}
            config={appData.config}
            lang={lang}
            onClose={() => setShowTimesheet(false)}
          />
        );
      })()}

      {showBookkeeperExport && (() => {
        const { start, end } = getRange();
        const periodAdvances = appData.advances.filter(a => {
          const d = new Date(a.date);
          return d >= start && d <= end;
        });
        return (
          <BookkeeperExport
            staff={appData.staff}
            periodEntries={getRangeData()}
            periodAdvances={periodAdvances}
            periodLabel={getRangeLabel()}
            restoName={appData.config.resto_name}
            roleLabels={ROLES}
            lang={lang}
            onClose={() => setShowBookkeeperExport(false)}
          />
        );
      })()}

      {selectedFormerStaff && (() => {
        const member = selectedFormerStaff;
        const personEntries = appData.entries.filter(e => e.name === member.name && e.type === "worked" && e.status === "approved");
        const dates = personEntries.map(e => e.date).sort();
        const firstDate = dates[0];
        const lastDate = dates[dates.length - 1];
        const totalHours = personEntries.reduce((s, e) => s + e.hours, 0);
        const fiveYearsMs = 5 * 365.25 * 24 * 60 * 60 * 1000;
        const pastRetention = !lastDate || (Date.now() - new Date(lastDate).getTime()) > fiveYearsMs;

        const handleExportCSV = () => {
          const headers = [
            lang === "fr" ? "Date" : "Date", lang === "fr" ? "Type" : "Type",
            lang === "fr" ? "Début" : "Start", lang === "fr" ? "Fin" : "End", lang === "fr" ? "Heures" : "Hours",
          ];
          const rows = appData.entries
            .filter(e => e.name === member.name)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(e => [e.date, e.type, e.startTime || "", e.endTime || "", e.hours.toFixed(2)]);
          const csvLines = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","));
          const blob = new Blob([csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `brigado-${member.name.replace(/[^a-zA-Z0-9]+/g, "-")}-historique.csv`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        };

        return (
          <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-100">{member.name}</h3>
                  <span
                    className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                    style={{ backgroundColor: `${RC[member.role]}15`, color: RC[member.role] }}
                  >
                    {ROLES[member.role]}
                  </span>
                </div>
                <button className="p-1.5 text-slate-500 hover:text-slate-200" onClick={() => { setSelectedFormerStaff(null); setFormerDeleteVerifyText(""); }}>
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-950/40 rounded-xl p-3">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Premier jour" : "First day"}</div>
                  <div className="font-mono font-bold text-slate-200 mt-0.5">{firstDate || "—"}</div>
                </div>
                <div className="bg-slate-950/40 rounded-xl p-3">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Dernier jour" : "Last day"}</div>
                  <div className="font-mono font-bold text-slate-200 mt-0.5">{lastDate || "—"}</div>
                </div>
                <div className="bg-slate-950/40 rounded-xl p-3 col-span-2">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Total heures approuvées" : "Total approved hours"}</div>
                  <div className="font-mono font-bold text-lime-400 text-lg mt-0.5">{totalHours.toFixed(1)}h</div>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  className="w-full py-2.5 bg-lime-400/10 text-lime-400 rounded-xl text-xs font-bold hover:bg-lime-400/20 transition-all"
                  onClick={() => { triggerReactivateStaff(member.name); setSelectedFormerStaff(null); }}
                >
                  {lang === "fr" ? "Réactiver" : "Reactivate"}
                </button>
                <button
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all"
                  onClick={() => setShowFormerHistoryTimesheet(true)}
                >
                  {lang === "fr" ? "Imprimer l'historique" : "Print history"}
                </button>
                <button
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all"
                  onClick={handleExportCSV}
                >
                  {lang === "fr" ? "Exporter en CSV" : "Export CSV"}
                </button>
              </div>

              {pastRetention ? (
                <div className="pt-3 border-t border-rose-900/40 space-y-2">
                  <p className="text-[10px] text-rose-400 leading-snug">
                    {lang === "fr"
                      ? "Aucune activité depuis plus de 5 ans — la suppression définitive est possible."
                      : "No activity for over 5 years — permanent deletion is available."}
                  </p>
                  <input
                    className="w-full bg-slate-950 border border-rose-900/50 rounded-xl p-2 text-xs text-center text-slate-200"
                    placeholder="DELETE"
                    value={formerDeleteVerifyText}
                    onChange={e => setFormerDeleteVerifyText(e.target.value)}
                  />
                  <button
                    className="w-full py-2.5 bg-rose-500/10 text-rose-400 rounded-xl text-xs font-bold hover:bg-rose-500/20 transition-all disabled:opacity-40"
                    disabled={formerDeleteVerifyText !== "DELETE" || deletingFormerStaff}
                    onClick={() => triggerDeleteFormerStaffData(member.name)}
                  >
                    {deletingFormerStaff ? "..." : (lang === "fr" ? "Supprimer définitivement" : "Permanently delete")}
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-slate-600 text-center pt-2 border-t border-slate-800/60 leading-relaxed">
                  {lang === "fr"
                    ? "La suppression définitive ne sera possible que 5 ans après leur dernière activité (protection des registres de paie)."
                    : "Permanent deletion becomes available 5 years after their last activity (payroll record protection)."}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {showFormerHistoryTimesheet && selectedFormerStaff && (
        <Timesheet
          staff={selectedFormerStaff}
          entries={appData.entries.filter(e => e.name === selectedFormerStaff.name)}
          periodLabel={lang === "fr" ? "Historique complet" : "Full history"}
          config={appData.config}
          lang={lang}
          onClose={() => setShowFormerHistoryTimesheet(false)}
        />
      )}

      {showAddStaffModal && (
        <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100">{lang === "fr" ? "Ajouter un employé" : "Add staff member"}</h3>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{lang === "fr" ? "Nom" : "Name"}</label>
              <input
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                value={newStaffName}
                onChange={e => setNewStaffName(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{lang === "fr" ? "Poste" : "Role"}</label>
              <select
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200 focus:outline-none"
                value={newStaffRole}
                onChange={e => setNewStaffRole(e.target.value as RoleType)}
              >
                {(Object.keys(ROLES) as RoleType[]).map(r => (
                  <option key={r} value={r}>{ROLES[r]}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{lang === "fr" ? "Taux/h" : "Rate/h"}</label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">€</span>
                  <input
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-center text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                    type="number"
                    value={newStaffRate}
                    onChange={e => setNewStaffRate(Number(e.target.value))}
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{lang === "fr" ? "Contrat/sem." : "Contract/wk"}</label>
                <div className="flex items-center gap-1">
                  <input
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-center text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
                    type="number"
                    value={newStaffContract}
                    onChange={e => setNewStaffContract(Number(e.target.value))}
                  />
                  <span className="text-xs text-slate-500">h</span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{lang === "fr" ? "Code PIN" : "PIN"}</label>
              <input
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-center text-sm text-slate-200 font-mono focus:outline-none focus:border-lime-400/50"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="1234"
                value={newStaffPin}
                onChange={e => setNewStaffPin(e.target.value.trim())}
              />
            </div>

            <label className="flex items-start gap-2.5 bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 cursor-pointer">
              <div className="pt-0.5">
                <Toggle checked={newStaffIsMinor} onChange={setNewStaffIsMinor} />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-200">{lang === "fr" ? "Employé mineur (moins de 18 ans)" : "Minor (under 18)"}</div>
                <div className="text-[10px] text-slate-400 font-medium mt-0.5 leading-snug">
                  {lang === "fr"
                    ? "Applique les protections spécifiques : horaires max réduits, pas de travail de nuit, repos plus long — si ces règles sont activées dans les paramètres de conformité."
                    : "Applies youth-labor protections: shorter max hours, no night work, longer rest — if those rules are enabled in compliance settings."}
                </div>
              </div>
            </label>

            <div className="flex gap-2 pt-2">
              <button
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all"
                onClick={() => setShowAddStaffModal(false)}
              >
                {lang === "fr" ? "Annuler" : "Cancel"}
              </button>
              <button
                className="flex-1 py-2.5 bg-lime-400 hover:bg-lime-300 text-slate-950 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
                onClick={triggerAddStaff}
                disabled={!newStaffName.trim()}
              >
                {t("add")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
