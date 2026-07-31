import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  RadialBarChart, RadialBar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { BarChart3, AlertTriangle, Flag, Gauge } from "lucide-react";
import { AppData, RoleType, StaffMember } from "../types";
import { getRoleColor } from "../utils/roleColors";
import { saveWeekRevenue } from "../utils/api";

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

export default function StatsPage({ appData, lang, theme, onRefresh }: StatsPageProps) {
  const [statsWeeks, setStatsWeeks] = useState<number>(8);
  const [revenueDrafts, setRevenueDrafts] = useState<Record<string, string>>({});
  const [savingRevenue, setSavingRevenue] = useState<string | null>(null);

  const taxRate = appData.config.tax_rate ?? 0;
  const chartAxisColor = theme === "light" ? "#64748b" : "#94a3b8";
  const chartGridColor = theme === "light" ? "#e2e8f0" : "#1e293b";
  const tooltipStyle = {
    backgroundColor: theme === "light" ? "#ffffff" : "#0f172a",
    border: "1px solid #334155", fontSize: 12, borderRadius: 8,
  };
  const roleLabel = (r: RoleType) => ROLE_LABELS[r]?.[lang] ?? r;

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - statsWeeks * 7);

  const inRange = appData.entries.filter(e => new Date(e.date) >= rangeStart);
  const approvedWorked = inRange.filter(e => e.status === "approved" && e.type === "worked");
  const staffByName: Record<string, StaffMember> = Object.fromEntries(appData.staff.map(s => [s.name, s]));

  const weekKeyOf = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day + 1);
    return monday.toISOString().slice(0, 10);
  };

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

  // ── Role breakdown ──
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

  // ── NEW: Busiest day of week ──
  const dayHours = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  approvedWorked.forEach(e => {
    const d = new Date(e.date + "T00:00:00");
    const idx = (d.getDay() + 6) % 7;
    dayHours[idx] += e.hours;
  });
  const dayLabels = lang === "fr" ? ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const busiestDayData = dayLabels.map((label, i) => ({
    day: label,
    hours: Math.round(dayHours[i] * 10) / 10,
    isWeekend: i >= 5,
  }));
  const busiestDay = busiestDayData.reduce((max, d) => (d.hours > max.hours ? d : max), busiestDayData[0]);

  // ── NEW: Absence rate ──
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
    .filter(x => x.absences > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  // ── NEW: Labor cost as % of revenue (only over weeks with revenue entered) ──
  const weeksWithRevenue = weekKeysSorted.filter(k => revenueByWeek[k] != null && revenueByWeek[k] > 0);
  const revenueCoveredCost = weeksWithRevenue.reduce((s, k) => s + weekBuckets[k].cost, 0);
  const revenueCoveredRevenue = weeksWithRevenue.reduce((s, k) => s + (revenueByWeek[k] || 0), 0);
  const costPctOfRevenue = revenueCoveredRevenue > 0 ? (revenueCoveredCost / revenueCoveredRevenue) * 100 : null;
  const gaugeColor = costPctOfRevenue === null ? "#475569" : costPctOfRevenue <= 35 ? "#a3e635" : costPctOfRevenue <= 45 ? "#fbbf24" : "#f87171";

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
                  <Tooltip contentStyle={tooltipStyle} />
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
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`€${v}`, lang === "fr" ? "Coût" : "Cost"]} />
                  <Area type="monotone" dataKey="cost" stroke="#a3e635" strokeWidth={2} fill="url(#costGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ROLE BREAKDOWN + OVERTIME TRACKER */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
                {lang === "fr" ? "Répartition par poste (heures)" : "Hours by role"}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={roleData} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(entry: any) => `${entry.name}`}>
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

          {/* NEW: BUSIEST DAY OF WEEK + ABSENCE RATE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                {lang === "fr" ? "Jours les plus chargés" : "Busiest days of the week"}
              </h3>
              <p className="text-[10px] text-slate-500 mb-4">
                {lang === "fr" ? `Le plus chargé : ${busiestDay?.day ?? "—"}` : `Busiest: ${busiestDay?.day ?? "—"}`}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={busiestDayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}h`, lang === "fr" ? "Heures" : "Hours"]} />
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
                      <span className="font-mono text-amber-400">{a.rate.toFixed(0)}% ({a.absences})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* NEW: FLAGGED ENTRIES TREND */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Flag size={13} className="text-rose-400" /> {lang === "fr" ? "Tendance des heures signalées" : "Flagged entries trend"}
            </h3>
            <p className="text-[10px] text-slate-500 mb-4">
              {lang === "fr" ? "Saisies soumises sans scan QR récent — signalé au manager uniquement." : "Entries submitted without a fresh QR scan — manager-only signal."}
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: chartAxisColor }} />
                <YAxis tick={{ fontSize: 10, fill: chartAxisColor }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="flagged" name={lang === "fr" ? "Signalées" : "Flagged"} fill="#f43f5e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* NEW: LABOR COST AS % OF REVENUE */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Gauge size={13} className="text-lime-400" /> {lang === "fr" ? "Coût de la main-d'œuvre en % du CA" : "Labor cost as % of revenue"}
            </h3>
            <p className="text-[10px] text-slate-500 mb-4">
              {lang === "fr"
                ? "Repère habituel : 25–35%. Renseignez le chiffre d'affaires par semaine ci-dessous pour l'activer."
                : "Common target: 25–35%. Enter weekly revenue below to activate this."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div className="flex flex-col items-center justify-center">
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

              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {trendData.slice().reverse().map(d => (
                  <div key={d.key} className="flex items-center gap-2 bg-slate-950/40 rounded-lg px-3 py-2">
                    <span className="text-[10px] text-slate-400 w-16 flex-shrink-0">{d.week}</span>
                    <span className="text-[10px] text-slate-600 flex-shrink-0">€{d.cost}</span>
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-[10px] text-slate-500">€</span>
                      <input
                        type="number"
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                        placeholder={lang === "fr" ? "CA" : "Revenue"}
                        defaultValue={d.revenue ?? ""}
                        onChange={e => setRevenueDrafts(prev => ({ ...prev, [d.key]: e.target.value }))}
                        onBlur={() => handleSaveRevenue(d.key)}
                      />
                    </div>
                    {savingRevenue === d.key && <span className="text-[9px] text-lime-400">...</span>}
                  </div>
                ))}
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
