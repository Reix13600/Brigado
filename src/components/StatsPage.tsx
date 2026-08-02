import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { BarChart3, AlertTriangle, Flag, Gauge, ChevronLeft, ChevronRight, X, Mail, TrendingUp, TrendingDown, Minus, CalendarDays } from "lucide-react";
import { AppData, RoleType, StaffMember } from "../types";
import { getRoleColor } from "../utils/roleColors";
import { saveWeekRevenue } from "../utils/api";
import MiniCalendar from "./MiniCalendar";

interface StatsPageProps {
  appData: AppData;
  lang: "fr" | "en";
  theme: "light" | "dark";
  onRefresh: () => void;
}

const ROLE_LABELS: Record<RoleType, { fr: string; en: string }> = {
  server: { fr: "Serveur", en: "Server" },
  kitchen: { fr: "Cuisine", en: "Kitchen" },
  cold: { fr: "Froid", en: "Cold Food" },
  dishwasher: { fr: "Plongeur", en: "Dishwasher" },
  bar: { fr: "Bar", en: "Bar" },
  chef: { fr: "Chef", en: "Chef" },
  cleaner: { fr: "Agent d'entretien", en: "Cleaner" },
  host: { fr: "Accueil", en: "Host/Hostess" },
  other: { fr: "Autre", en: "Other" },
};

/** Animates a number counting up from 0 whenever `value` changes — small
 * detail, makes the dashboard feel alive on load instead of static. */
function CountUp({ value, decimals = 0, prefix = "", suffix = "" }: { value: number; decimals?: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 700;
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{prefix}{display.toFixed(decimals)}{suffix}</>;
}

/** Tiny axis-less trend line next to a KPI number. */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const points = data.map((v, i) => ({ v, i }));
  return (
    <ResponsiveContainer width={64} height={24}>
      <LineChart data={points}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const mondayOf = (d: Date) => {
  const day = d.getDay() || 7;
  const m = new Date(d);
  m.setDate(d.getDate() - day + 1);
  m.setHours(0, 0, 0, 0);
  return m;
};

// Local calendar-date string — deliberately NOT toISOString(), which
// converts to UTC first and silently shifts the date backward by one
// day for any positive UTC offset (all of metropolitan France included).
const toDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export default function StatsPage({ appData, lang, theme, onRefresh }: StatsPageProps) {
  const [statsWeeks, setStatsWeeks] = useState<number>(8);
  const [revenueDrafts, setRevenueDrafts] = useState<Record<string, string>>({});
  const [savingRevenue, setSavingRevenue] = useState<string | null>(null);
  const [busiestWeekOffset, setBusiestWeekOffset] = useState<number>(0);
  const [dismissedAbsentees, setDismissedAbsentees] = useState<Set<string>>(new Set());
  const [selectedRevenueDate, setSelectedRevenueDate] = useState<string>(toDateStr(new Date()));

  const taxRate = appData.config.tax_rate ?? 0;
  const chartAxisColor = theme === "light" ? "#64748b" : "#94a3b8";
  const chartGridColor = theme === "light" ? "#e2e8f0" : "#1e293b";
  const tooltipTextColor = theme === "light" ? "#1e293b" : "#e2e8f0";
  const tooltipStyle = {
    backgroundColor: theme === "light" ? "#ffffff" : "#0f172a",
    border: "1px solid #334155", fontSize: 12, borderRadius: 8,
    color: tooltipTextColor,
  };
  // Recharts defaults both the tooltip label and each item's text to
  // black, which disappears against the dark theme's cards — every
  // <Tooltip> below must pass these explicitly to stay readable.
  const tooltipLabelStyle = { color: tooltipTextColor, fontWeight: 600, marginBottom: 4 };
  const tooltipItemStyle = { color: tooltipTextColor };
  const roleLabel = (r: RoleType) => ROLE_LABELS[r]?.[lang] ?? r;

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - statsWeeks * 7);

  const inRange = appData.entries.filter(e => new Date(e.date) >= rangeStart);
  const approvedWorked = inRange.filter(e => e.status === "approved" && e.type === "worked");
  const staffByName: Record<string, StaffMember> = Object.fromEntries(appData.staff.map(s => [s.name, s]));

  const weekKeyOf = (dateStr: string) => toDateStr(mondayOf(new Date(dateStr)));

  // ── Weekly buckets: hours, cost, flagged count, revenue ──
  const weekBuckets: Record<string, { hours: number; cost: number; flagged: number }> = {};
  approvedWorked.forEach(e => {
    const key = weekKeyOf(e.date);
    const rate = staffByName[e.name]?.rate ?? 0;
    if (!weekBuckets[key]) weekBuckets[key] = { hours: 0, cost: 0, flagged: 0 };
    weekBuckets[key].hours += e.hours;
    weekBuckets[key].cost += e.hours * rate * (1 - taxRate / 100);
  });
  inRange.forEach(e => {
    if (!e.flagged) return;
    const key = weekKeyOf(e.date);
    if (!weekBuckets[key]) weekBuckets[key] = { hours: 0, cost: 0, flagged: 0 };
    weekBuckets[key].flagged += 1;
  });

  const revenueByWeek = appData.revenueByWeek || {};
  const weekKeysSorted = Object.keys(weekBuckets).sort();
  const trendData = weekKeysSorted.map(key => ({
    key,
    week: new Date(key).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "2-digit", month: "short" }),
    hours: Math.round(weekBuckets[key].hours * 10) / 10,
    cost: Math.round(weekBuckets[key].cost),
    flagged: weekBuckets[key].flagged,
    revenue: revenueByWeek[key] ?? null,
  }));

  const totalHours = approvedWorked.reduce((s, e) => s + e.hours, 0);
  const totalCost = approvedWorked.reduce((s, e) => s + e.hours * (staffByName[e.name]?.rate ?? 0) * (1 - taxRate / 100), 0);
  const avgPerStaff = appData.staff.length > 0 ? totalHours / appData.staff.length : 0;
  const pendingCount = appData.entries.filter(e => e.status === "pending" || e.status === "correction").length;
  const advancesInRange = appData.advances.filter(a => new Date(a.date) >= rangeStart).reduce((s, a) => s + a.amount, 0);

  // Trend direction for KPI glow: is the most recent week's cost above the
  // average of the rest of the period?
  const costTrendingUp = trendData.length >= 3 &&
    trendData[trendData.length - 1].cost > (trendData.slice(0, -1).reduce((s, d) => s + d.cost, 0) / Math.max(1, trendData.length - 1)) * 1.15;

  // ── Role breakdown (donut) ──
  const roleHours: Record<string, number> = {};
  approvedWorked.forEach(e => {
    const role = staffByName[e.name]?.role ?? "other";
    roleHours[role] = (roleHours[role] ?? 0) + e.hours;
  });
  const roleData = Object.entries(roleHours)
    .filter(([, h]) => h > 0)
    .map(([role, hours]) => ({
      role, name: roleLabel(role as RoleType),
      hours: Math.round(hours * 10) / 10,
      color: getRoleColor(role as RoleType, theme),
    }));
  const totalRoleHours = roleData.reduce((s, r) => s + r.hours, 0);

  // ── Overtime tracker ──
  const staffHoursTotal: Record<string, number> = {};
  approvedWorked.forEach(e => { staffHoursTotal[e.name] = (staffHoursTotal[e.name] ?? 0) + e.hours; });
  const otData = appData.staff
    .filter(s => s.active !== false)
    .map(s => ({
      name: s.name,
      contract: s.contract,
      avgWeekly: statsWeeks > 0 ? Math.round(((staffHoursTotal[s.name] ?? 0) / statsWeeks) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.avgWeekly - a.avgWeekly);

  // ── Busiest day of week — a single navigable week, not the whole period ──
  const dayLabels = lang === "fr" ? ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const busiestWeekStart = mondayOf(new Date());
  busiestWeekStart.setDate(busiestWeekStart.getDate() - busiestWeekOffset * 7);
  const busiestWeekEnd = new Date(busiestWeekStart);
  busiestWeekEnd.setDate(busiestWeekStart.getDate() + 6);

  const busiestWeekEntries = appData.entries.filter(e => {
    if (e.status !== "approved" || e.type !== "worked") return false;
    const d = new Date(e.date + "T00:00:00");
    return d >= busiestWeekStart && d <= busiestWeekEnd;
  });
  const busiestDayHours = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  busiestWeekEntries.forEach(e => {
    const d = new Date(e.date + "T00:00:00");
    const idx = (d.getDay() + 6) % 7;
    busiestDayHours[idx] += e.hours;
  });
  const busiestDayData = dayLabels.map((label, i) => ({
    day: label,
    hours: Math.round(busiestDayHours[i] * 10) / 10,
    isWeekend: i >= 5,
  }));
  const busiestDay = busiestDayData.reduce((max, d) => (d.hours > max.hours ? d : max), busiestDayData[0]);
  const dateFmt = (d: Date) => d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "2-digit", month: "short" });
  const busiestWeekLabel = `${dateFmt(busiestWeekStart)} – ${dateFmt(busiestWeekEnd)}`;

  // ── Weekly digest: always this week vs last week (Mon–Sun), regardless
  // of the statsWeeks period selector that scopes the rest of the page ──
  const thisWeekStart = mondayOf(new Date());
  const thisWeekKey = toDateStr(thisWeekStart);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekKey = toDateStr(lastWeekStart);

  let twHours = 0, lwHours = 0, twFlagged = 0, lwFlagged = 0;
  const twRoleHours: Record<string, number> = {};
  const lwRoleHours: Record<string, number> = {};
  appData.entries.forEach(e => {
    const key = weekKeyOf(e.date);
    const isThisWeek = key === thisWeekKey;
    const isLastWeek = key === lastWeekKey;
    if (!isThisWeek && !isLastWeek) return;
    if (e.flagged) {
      if (isThisWeek) twFlagged += 1; else lwFlagged += 1;
    }
    if (e.status !== "approved" || e.type !== "worked") return;
    const role = staffByName[e.name]?.role ?? "other";
    if (isThisWeek) {
      twHours += e.hours;
      twRoleHours[role] = (twRoleHours[role] ?? 0) + e.hours;
    } else {
      lwHours += e.hours;
      lwRoleHours[role] = (lwRoleHours[role] ?? 0) + e.hours;
    }
  });
  const digestRoles = [...new Set([...Object.keys(twRoleHours), ...Object.keys(lwRoleHours)])]
    .map(role => ({
      role,
      tw: Math.round((twRoleHours[role] ?? 0) * 10) / 10,
      lw: Math.round((lwRoleHours[role] ?? 0) * 10) / 10,
      color: getRoleColor(role as RoleType, theme),
    }))
    .sort((a, b) => b.tw - a.tw);
  const digestRoleMax = Math.max(1, ...digestRoles.map(r => Math.max(r.tw, r.lw)));
  const hoursDelta = twHours - lwHours;
  const hoursDeltaPct = lwHours > 0 ? (hoursDelta / lwHours) * 100 : null;
  const flaggedDelta = twFlagged - lwFlagged;
  const thisWeekEnd = new Date(thisWeekStart);
  thisWeekEnd.setDate(thisWeekStart.getDate() + 6);

  // Direction chip: lime when the change is good news, amber/rose when not.
  const DeltaChip = ({ delta, pct, upIsBad }: { delta: number; pct: number | null; upIsBad?: boolean }) => {
    const up = delta > 0, flat = delta === 0;
    const color = flat ? "text-slate-500 bg-slate-800/60"
      : up === !upIsBad ? "text-lime-400 bg-lime-400/10"
      : upIsBad && up ? "text-rose-400 bg-rose-400/10"
      : "text-amber-400 bg-amber-400/10";
    const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>
        <Icon size={11} />
        {delta > 0 ? "+" : ""}{Math.round(delta * 10) / 10}
        {pct !== null && <span className="opacity-70">({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)</span>}
      </span>
    );
  };

  // ── Top 5 busiest individual dates within the selected period ──
  const dateAgg: Record<string, { hours: number; people: Set<string> }> = {};
  approvedWorked.forEach(e => {
    if (!dateAgg[e.date]) dateAgg[e.date] = { hours: 0, people: new Set() };
    dateAgg[e.date].hours += e.hours;
    dateAgg[e.date].people.add(e.name);
  });
  const busiestDates = Object.entries(dateAgg)
    .map(([date, v]) => ({
      date,
      hours: Math.round(v.hours * 10) / 10,
      headcount: v.people.size,
      avg: v.people.size > 0 ? v.hours / v.people.size : 0,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);
  const busiestDateFmt = (dateStr: string) =>
    new Date(dateStr + "T00:00:00").toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "short", day: "2-digit", month: "short" });

  // ── Absence rate ──
  const dayTypeEntries = inRange.filter(e => e.status === "approved" && (e.type === "worked" || e.type === "absent" || e.type === "sick"));
  const absenceEntries = dayTypeEntries.filter(e => e.type === "absent" || e.type === "sick");
  const absenceRate = dayTypeEntries.length > 0 ? (absenceEntries.length / dayTypeEntries.length) * 100 : 0;
  const absenceByPerson: Record<string, { absences: number; total: number }> = {};
  dayTypeEntries.forEach(e => {
    if (!absenceByPerson[e.name]) absenceByPerson[e.name] = { absences: 0, total: 0 };
    absenceByPerson[e.name].total += 1;
    if (e.type === "absent" || e.type === "sick") absenceByPerson[e.name].absences += 1;
  });
  const topAbsentees = Object.entries(absenceByPerson)
    .map(([name, v]) => ({ name, rate: v.total > 0 ? (v.absences / v.total) * 100 : 0, absences: v.absences }))
    // Archived (former) staff are hidden automatically; dismissedAbsentees
    // covers the case where someone left but hasn't been archived yet.
    .filter(x => x.absences > 0 && staffByName[x.name]?.active !== false && !dismissedAbsentees.has(x.name))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  // ── Labor cost as % of revenue (only over weeks with revenue entered) ──
  const weeksWithRevenue = weekKeysSorted.filter(k => revenueByWeek[k] != null && revenueByWeek[k] > 0);
  const revenueCoveredCost = weeksWithRevenue.reduce((s, k) => s + weekBuckets[k].cost, 0);
  const revenueCoveredRevenue = weeksWithRevenue.reduce((s, k) => s + (revenueByWeek[k] || 0), 0);
  const costPctOfRevenue = revenueCoveredRevenue > 0 ? (revenueCoveredCost / revenueCoveredRevenue) * 100 : null;
  const gaugeColor = costPctOfRevenue === null ? "#475569" : costPctOfRevenue <= 35 ? "#a3e635" : costPctOfRevenue <= 45 ? "#fbbf24" : "#f87171";

  // Calendar-driven revenue picker: click any day, it resolves to that
  // day's Monday-anchored week, which is what actually gets saved.
  const selectedRevenueWeekKey = weekKeyOf(selectedRevenueDate);
  const selectedRevenueWeekStart = new Date(selectedRevenueWeekKey + "T00:00:00");
  const selectedRevenueWeekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(selectedRevenueWeekStart);
    d.setDate(d.getDate() + i);
    return toDateStr(d);
  });
  const revenueMarkedDates = weeksWithRevenue.flatMap(weekKey => {
    const start = new Date(weekKey + "T00:00:00");
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return toDateStr(d);
    });
  });
  const selectedWeekCost = weekBuckets[selectedRevenueWeekKey]?.cost ?? 0;
  const selectedWeekSavedRevenue = revenueByWeek[selectedRevenueWeekKey];

  const handleSaveRevenue = async (weekKey: string) => {
    const raw = revenueDrafts[weekKey];
    const amount = Number(raw);
    if (raw === undefined || isNaN(amount)) return;
    setSavingRevenue(weekKey);
    try {
      await saveWeekRevenue(weekKey, amount);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingRevenue(null);
    }
  };

  return (
    <div className="relative space-y-6 animate-fade-in">
      {/* Subtle futuristic background glow, same language as the Landing hero */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-30"
        style={{ background: "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(163,230,53,0.08), transparent 70%)" }}
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <BarChart3 size={16} className="text-lime-400" /> {lang === "fr" ? "Statistiques" : "Stats"}
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

      {/* WEEKLY DIGEST — in-app mirror of the email digest: always this week
          vs last week, deliberately unaffected by the period selector above */}
      <div className="relative bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{ background: "radial-gradient(ellipse 45% 90% at 8% 0%, rgba(163,230,53,0.10), transparent 70%)" }}
        />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-4">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Mail size={13} className="text-lime-400" /> {lang === "fr" ? "Résumé de la semaine" : "Weekly digest"}
          </h3>
          <span className="text-[10px] text-slate-500 font-mono">
            {dateFmt(thisWeekStart)} – {dateFmt(thisWeekEnd)} · {lang === "fr" ? "vs semaine dernière" : "vs last week"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-950/40 rounded-xl p-4 space-y-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {lang === "fr" ? "Heures travaillées" : "Hours worked"}
            </div>
            <div className="text-3xl font-mono font-bold text-slate-100"><CountUp value={twHours} decimals={1} suffix="h" /></div>
            <DeltaChip delta={hoursDelta} pct={hoursDeltaPct} />
            <div className="text-[10px] text-slate-600">
              {lang === "fr" ? `Sem. dernière : ${Math.round(lwHours * 10) / 10}h` : `Last week: ${Math.round(lwHours * 10) / 10}h`}
            </div>
          </div>
          <div className="bg-slate-950/40 rounded-xl p-4 space-y-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Flag size={10} className="text-rose-400" /> {lang === "fr" ? "Saisies signalées" : "Flagged entries"}
            </div>
            <div className={`text-3xl font-mono font-bold ${twFlagged > 0 ? "text-rose-400" : "text-slate-100"}`}><CountUp value={twFlagged} /></div>
            <DeltaChip delta={flaggedDelta} pct={null} upIsBad />
            <div className="text-[10px] text-slate-600">
              {lang === "fr" ? `Sem. dernière : ${lwFlagged}` : `Last week: ${lwFlagged}`}
            </div>
          </div>
          <div className="bg-slate-950/40 rounded-xl p-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              {lang === "fr" ? "Par poste" : "By role"}
            </div>
            {digestRoles.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-3 text-center">
                {lang === "fr" ? "Aucune heure approuvée sur ces deux semaines." : "No approved hours in either week yet."}
              </p>
            ) : (
              <div className="space-y-2">
                {digestRoles.map(r => {
                  const delta = Math.round((r.tw - r.lw) * 10) / 10;
                  return (
                    <div key={r.role}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
                          {roleLabel(r.role as RoleType)}
                        </span>
                        <span className="font-mono text-slate-400">
                          {r.lw}h → {r.tw}h{" "}
                          <span className={delta === 0 ? "text-slate-500" : delta > 0 ? "text-lime-400" : "text-amber-400"}>
                            {delta === 0 ? "＝" : delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
                          </span>
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full rounded-full bg-slate-600" style={{ width: `${(r.lw / digestRoleMax) * 100}%` }} />
                        </div>
                        <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-lime-500 to-lime-300" style={{ width: `${(r.tw / digestRoleMax) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-3 pt-1 text-[9px] text-slate-600">
                  <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-slate-600 inline-block" /> {lang === "fr" ? "Sem. dernière" : "Last week"}</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-lime-400 inline-block" /> {lang === "fr" ? "Cette semaine" : "This week"}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Total heures" : "Total hours"}</div>
            <Sparkline data={trendData.map(d => d.hours)} color="#a3e635" />
          </div>
          <div className="text-2xl font-mono font-bold text-slate-100"><CountUp value={totalHours} decimals={1} suffix="h" /></div>
        </div>
        <div className={`bg-slate-900 border rounded-2xl p-4 space-y-1 transition-all ${costTrendingUp ? "border-amber-500/40 shadow-[0_0_20px_-8px_rgba(251,191,36,0.5)]" : "border-slate-800/80"}`}>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Coût net" : "Net cost"}</div>
            <Sparkline data={trendData.map(d => d.cost)} color={costTrendingUp ? "#fbbf24" : "#a3e635"} />
          </div>
          <div className={`text-2xl font-mono font-bold ${costTrendingUp ? "text-amber-400" : "text-lime-400"}`}><CountUp value={totalCost} decimals={0} prefix="€" /></div>
        </div>
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-1">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Moy. h / employé" : "Avg h / staff"}</div>
          <div className="text-2xl font-mono font-bold text-slate-100"><CountUp value={avgPerStaff} decimals={1} suffix="h" /></div>
        </div>
        <div className={`bg-slate-900 border rounded-2xl p-4 space-y-1 transition-all ${pendingCount > 0 ? "border-amber-500/40 shadow-[0_0_20px_-8px_rgba(251,191,36,0.5)]" : "border-slate-800/80"}`}>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "En attente" : "Pending approvals"}</div>
          <div className={`text-2xl font-mono font-bold ${pendingCount > 0 ? "text-amber-400" : "text-slate-100"}`}><CountUp value={pendingCount} /></div>
        </div>
      </div>

      {trendData.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
          {lang === "fr" ? "Pas encore assez de données approuvées pour cette période." : "Not enough approved data yet for this period."}
        </div>
      ) : (
        <>
          {/* HOURS + COST TREND — gradient area charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                {lang === "fr" ? "Tendance des heures (par semaine)" : "Hours trend (weekly)"}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="hoursGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a3e635" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#a3e635" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                  <Area type="monotone" dataKey="hours" stroke="#a3e635" strokeWidth={2} fill="url(#hoursGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                {lang === "fr" ? "Coût de la main-d'œuvre (net, par semaine)" : "Labor cost (net, weekly)"}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a3e635" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#a3e635" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} formatter={(v: number) => [`€${v}`, lang === "fr" ? "Coût" : "Cost"]} />
                  <Area type="monotone" dataKey="cost" stroke="#a3e635" strokeWidth={2} fill="url(#costGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ROLE BREAKDOWN (futuristic donut) + OVERTIME TRACKER */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                {lang === "fr" ? "Répartition par poste (heures)" : "Hours by role"}
              </h3>
              <div className="relative" style={{ filter: "drop-shadow(0 0 14px rgba(163,230,53,0.12))" }}>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <defs>
                      {roleData.map(r => (
                        <linearGradient key={r.role} id={`roleGrad-${r.role}`} x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor={r.color} stopOpacity={1} />
                          <stop offset="100%" stopColor={r.color} stopOpacity={0.55} />
                        </linearGradient>
                      ))}
                    </defs>
                    <Pie
                      data={roleData} dataKey="hours" nameKey="name"
                      cx="50%" cy="50%" innerRadius={60} outerRadius={88}
                      paddingAngle={3} cornerRadius={6} stroke="none"
                    >
                      {roleData.map((entry, i) => (
                        <Cell key={i} fill={`url(#roleGrad-${entry.role})`} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} formatter={(v: number) => [`${v}h`, ""]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-xl font-mono font-bold text-slate-100">{totalRoleHours.toFixed(0)}h</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Total" : "Total"}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                {roleData.map(r => (
                  <div key={r.role} className="flex items-center gap-1.5 text-[10px] bg-slate-950/40 rounded-full px-2.5 py-1">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
                    <span className="text-slate-300">{r.name}</span>
                    <span className="text-slate-500 font-mono">{r.hours}h</span>
                  </div>
                ))}
              </div>
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
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} formatter={(value: string) => <span style={{ color: chartAxisColor }}>{value}</span>} />
                  <Bar dataKey="contract" name={lang === "fr" ? "Contrat" : "Contract"} fill={theme === "light" ? "#cbd5e1" : "#334155"} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="avgWeekly" name={lang === "fr" ? "Moy. réel" : "Avg actual"} fill="#a3e635" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* BUSIEST DAY OF WEEK (week-navigable) + ABSENCE RATE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  {lang === "fr" ? "Jours les plus chargés" : "Busiest days of the week"}
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setBusiestWeekOffset(o => o + 1)}
                    className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                    aria-label={lang === "fr" ? "Semaine précédente" : "Previous week"}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-[10px] text-slate-500 font-mono w-24 text-center">{busiestWeekLabel}</span>
                  <button
                    type="button"
                    onClick={() => setBusiestWeekOffset(o => Math.max(0, o - 1))}
                    disabled={busiestWeekOffset === 0}
                    className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none"
                    aria-label={lang === "fr" ? "Semaine suivante" : "Next week"}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mb-4">
                {lang === "fr" ? `Le plus chargé : ${busiestDay?.day ?? "—"}` : `Busiest: ${busiestDay?.day ?? "—"}`}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={busiestDayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} formatter={(v: number) => [`${v}h`, lang === "fr" ? "Heures" : "Hours"]} />
                  <Bar dataKey="hours" radius={[6, 6, 0, 0]}>
                    {busiestDayData.map((d, i) => <Cell key={i} fill={d.isWeekend ? "#60a5fa" : "#a3e635"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-amber-400" /> {lang === "fr" ? "Taux d'absence" : "Absence rate"}
                </h3>
                <span className="text-lg font-mono font-bold text-amber-400">{absenceRate.toFixed(1)}%</span>
              </div>
              <p className="text-[10px] text-slate-500 mb-4">
                {lang === "fr" ? "Part des journées prévues terminées en absence ou maladie." : "Share of expected work days that ended up absent or sick."}
              </p>
              {topAbsentees.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4 text-center">{lang === "fr" ? "Aucune absence sur cette période." : "No absences this period."}</p>
              ) : (
                <div className="space-y-1.5">
                  {topAbsentees.map(a => (
                    <div key={a.name} className="flex items-center justify-between text-xs bg-slate-950/40 rounded-lg px-3 py-2">
                      <span className="text-slate-300">{a.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-amber-400">{a.rate.toFixed(0)}% ({a.absences})</span>
                        <button
                          type="button"
                          onClick={() => setDismissedAbsentees(prev => new Set(prev).add(a.name))}
                          className="text-slate-600 hover:text-rose-400 transition-colors"
                          title={lang === "fr" ? "Masquer (a quitté ?)" : "Hide (left the team?)"}
                          aria-label={lang === "fr" ? "Masquer" : "Hide"}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* FLAGGED ENTRIES TREND + BUSIEST SPECIFIC DATES */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Flag size={13} className="text-rose-400" /> {lang === "fr" ? "Tendance des heures signalées" : "Flagged entries trend"}
              </h3>
              <p className="text-[10px] text-slate-500 mb-4">
                {lang === "fr" ? "Saisies soumises sans scan QR récent — signalé au manager uniquement." : "Entries submitted without a fresh QR scan — manager-only signal."}
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="flaggedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} formatter={(v: number) => [v, lang === "fr" ? "Signalées" : "Flagged"]} />
                  <Area type="monotone" dataKey="flagged" stroke="#f43f5e" strokeWidth={2} fill="url(#flaggedGradient)" dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <CalendarDays size={13} className="text-lime-400" /> {lang === "fr" ? "Dates les plus chargées" : "Busiest dates"}
              </h3>
              <p className="text-[10px] text-slate-500 mb-4">
                {lang === "fr" ? "Top 5 des journées sur la période sélectionnée." : "Top 5 single days in the selected period."}
              </p>
              {busiestDates.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4 text-center">
                  {lang === "fr" ? "Aucune journée travaillée sur cette période." : "No worked days in this period."}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {busiestDates.map((d, i) => (
                    <div key={d.date} className="flex items-center justify-between text-xs bg-slate-950/40 rounded-lg px-3 py-2">
                      <span className="flex items-center gap-2.5">
                        <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${i === 0 ? "bg-lime-400/15 text-lime-400" : "bg-slate-800 text-slate-500"}`}>
                          {i + 1}
                        </span>
                        <span className="text-slate-300 capitalize">{busiestDateFmt(d.date)}</span>
                      </span>
                      <span className="font-mono text-[11px]">
                        <span className="text-lime-400 font-bold">{d.hours}h</span>
                        <span className="text-slate-500"> · {d.headcount} {lang === "fr" ? "pers." : "staff"}</span>
                        <span className="text-slate-600"> · {d.avg.toFixed(1)}h/{lang === "fr" ? "pers." : "ea."}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* LABOR COST AS % OF REVENUE — calendar-driven entry */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Gauge size={13} className="text-lime-400" /> {lang === "fr" ? "Coût de la main-d'œuvre en % du CA" : "Labor cost as % of revenue"}
            </h3>
            <p className="text-[10px] text-slate-500 mb-4">
              {lang === "fr"
                ? "Repère habituel : 25–35%. Cliquez une date dans le calendrier pour renseigner le CA de sa semaine."
                : "Common target: 25–35%. Click a date on the calendar to enter that week's revenue."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              <div className="flex flex-col items-center justify-center md:col-span-1">
                {costPctOfRevenue === null ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-slate-500">{lang === "fr" ? "Aucune donnée de CA pour cette période." : "No revenue data for this period yet."}</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <RadialBarChart
                      innerRadius="70%" outerRadius="100%" barSize={16}
                      data={[{ name: "pct", value: Math.min(costPctOfRevenue, 100), fill: gaugeColor }]}
                      startAngle={90} endAngle={-270}
                    >
                      <RadialBar background={{ fill: theme === "light" ? "#e2e8f0" : "#1e293b" }} dataKey="value" cornerRadius={8} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                )}
                {costPctOfRevenue !== null && (
                  <div className="text-center -mt-24">
                    <div className="text-3xl font-mono font-bold" style={{ color: gaugeColor }}>{costPctOfRevenue.toFixed(1)}%</div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {lang === "fr" ? `${weeksWithRevenue.length} sem. avec CA renseigné` : `${weeksWithRevenue.length} wks with revenue entered`}
                    </div>
                  </div>
                )}
              </div>

              <div className="md:col-span-2 flex flex-col sm:flex-row gap-4 items-start">
                <MiniCalendar
                  anchorDate={selectedRevenueDate}
                  highlightDates={selectedRevenueWeekDates}
                  lang={lang}
                  navigable
                  onDateClick={d => setSelectedRevenueDate(d)}
                  markedDates={revenueMarkedDates}
                />
                <div className="flex-1 w-full bg-slate-950/40 rounded-xl px-4 py-3 space-y-2">
                  <div className="text-[10px] text-slate-400">
                    {lang === "fr" ? "Semaine du" : "Week of"} {dateFmt(selectedRevenueWeekStart)} – {dateFmt(new Date(selectedRevenueWeekDates[6] + "T00:00:00"))}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {lang === "fr" ? "Coût main-d'œuvre" : "Labor cost"}: €{Math.round(selectedWeekCost)}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-slate-500">€</span>
                    <input
                      type="number"
                      className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-200"
                      placeholder={lang === "fr" ? "Chiffre d'affaires" : "Revenue"}
                      value={revenueDrafts[selectedRevenueWeekKey] ?? (selectedWeekSavedRevenue ?? "")}
                      onChange={e => setRevenueDrafts(prev => ({ ...prev, [selectedRevenueWeekKey]: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveRevenue(selectedRevenueWeekKey)}
                      disabled={savingRevenue === selectedRevenueWeekKey}
                      className="px-3 py-1.5 rounded-lg bg-lime-400 text-slate-950 text-xs font-bold hover:bg-lime-300 disabled:opacity-50 flex-shrink-0"
                    >
                      {savingRevenue === selectedRevenueWeekKey ? "..." : (lang === "fr" ? "Enreg." : "Save")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* CASH ADVANCES */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{lang === "fr" ? "Avances en espèces (période)" : "Cash advances (period)"}</h3>
          <p className="text-[11px] text-slate-500 mt-1">{lang === "fr" ? "Total avancé sur la période sélectionnée" : "Total advanced over the selected period"}</p>
        </div>
        <div className="text-2xl font-mono font-bold text-amber-400">€{advancesInRange.toFixed(0)}</div>
      </div>
    </div>
  );
}
