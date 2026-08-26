import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Check, AlertTriangle, GitCompare, Euro, UserX, Edit3 } from "lucide-react";
import { AppData } from "../types";
import { aggregateMonthlyVariance, DayVarianceWithStatus, AUTO_APPROVE_THRESHOLD_MINUTES } from "../utils/variance";
import { computeOperationsRollup } from "../utils/operationsRollup";
import { activeStaffOnly } from "../utils/staffFilters";
import { approveVarianceDay, approveAllRemainingVariance } from "../utils/api";

interface VarianceTabProps {
  appData: AppData;
  lang: "fr" | "en";
  theme: "light" | "dark";
  onRefresh: () => void;
  /** PART 7: one-shot pre-selection from an entry point elsewhere in the
   * app (Settings' staff list, Stats' per-employee table) — same
   * "consume once, then clear" contract as the admin dashboard's
   * pendingFilter. `undefined` when this tab has no such caller. */
  initialName?: string | null;
  onInitialNameConsumed?: () => void;
}

// Local calendar-date string, deliberately not toISOString() — same
// rationale as StatsPage.tsx's own toDateStr: UTC conversion silently
// shifts the date backward a day for any positive UTC offset.
const toDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** "+35 min" below an hour, "+2h30" (or "+2h" with no remainder) at or
 * above one — matches the worked examples in the Phase B spec exactly. */
function formatDeltaMinutes(minutes: number): string {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "";
  const abs = Math.round(Math.abs(minutes));
  if (abs < 60) return `${sign}${abs} min`;
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return mm > 0 ? `${sign}${hh}h${String(mm).padStart(2, "0")}` : `${sign}${hh}h`;
}

/** "147h" / "+4h" style for the summary card — whole-and-a-bit hours,
 * not minute precision, matching the card's exact spec shape. */
function formatHours(hours: number, withSign = false): string {
  const sign = withSign ? (hours > 0 ? "+" : hours < 0 ? "−" : "") : (hours < 0 ? "−" : "");
  const abs = Math.abs(hours);
  const rounded = Math.round(abs * 10) / 10;
  return `${sign}${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

export default function VarianceTab({ appData, lang, theme, onRefresh, initialName, onInitialNameConsumed }: VarianceTabProps) {
  const activeStaff = useMemo(() => activeStaffOnly(appData.staff), [appData.staff]);
  const [selectedName, setSelectedName] = useState<string>(activeStaff[0]?.name ?? "");
  const [monthOffset, setMonthOffset] = useState<number>(0);

  // PART 7: consume a one-shot jump-in name from Settings/Stats, then
  // clear it so a manual re-selection afterwards isn't fought on the
  // next render. `initialName` may not (yet) be in `activeStaff` if the
  // caller's own data is stale by one refresh — set it regardless, the
  // <select> just won't show a highlighted match until data catches up.
  useEffect(() => {
    if (initialName) {
      setSelectedName(initialName);
      onInitialNameConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialName]);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);

  const monthAnchor = new Date();
  monthAnchor.setDate(1);
  monthAnchor.setMonth(monthAnchor.getMonth() + monthOffset);
  const monthKey = monthKeyOf(monthAnchor);
  const monthStart = toDateStr(monthAnchor);
  const monthEndDate = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
  const monthEnd = toDateStr(monthEndDate);
  const monthLabel = monthAnchor.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric" });

  const monthEntries = useMemo(
    () => appData.entries.filter(e => e.date >= monthStart && e.date <= monthEnd),
    [appData.entries, monthStart, monthEnd]
  );

  const autoApproveEnabled = !!appData.config.auto_approve_variance_enabled;

  const summary = useMemo(
    () => selectedName
      ? aggregateMonthlyVariance(selectedName, monthEntries, appData.scheduledShifts, appData.varianceApprovals, autoApproveEnabled)
      : null,
    [selectedName, monthEntries, appData.scheduledShifts, appData.varianceApprovals, autoApproveEnabled]
  );

  const pendingDates = useMemo(
    () => (summary?.days ?? []).filter(d => d.status === "pending").map(d => d.date),
    [summary]
  );

  // PART 7: the same monthly rollup driving the Payroll Ready screen
  // (Part 4) and the Risk Radar card (Part 5), scoped to this one
  // employee/month — total hours, overtime, missing clock-in/out,
  // manager corrections, and (Part 6) the shared estimated-cost
  // calculation. Reuses computeOperationsRollup rather than deriving any
  // of these numbers separately.
  const monthDates = useMemo(() => {
    const dates: string[] = [];
    const d = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    while (d <= monthEndDate) {
      dates.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }, [monthKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const opsSummary = useMemo(() => {
    if (!selectedName) return null;
    const rollup = computeOperationsRollup(
      monthDates, appData.entries, appData.scheduledShifts, appData.activeClockIns,
      appData.varianceApprovals, appData.staff, appData.config,
      { staffFilter: s => s.name === selectedName },
    );
    return rollup.employees[0] ?? null;
  }, [monthDates, appData.entries, appData.scheduledShifts, appData.activeClockIns, appData.varianceApprovals, appData.staff, appData.config, selectedName]);

  const dayLabel = (dateStr: string) =>
    new Date(dateStr + "T00:00:00").toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "long", day: "2-digit", month: "short" });

  const handleApproveDay = async (date: string) => {
    setBusyDate(date);
    try {
      await approveVarianceDay(selectedName, date, noteDrafts[date]);
      setNoteDrafts(prev => { const next = { ...prev }; delete next[date]; return next; });
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setBusyDate(null);
    }
  };

  const handleApproveAllRemaining = async () => {
    if (pendingDates.length === 0) return;
    setBulkBusy(true);
    try {
      await approveAllRemainingVariance(selectedName, pendingDates);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setBulkBusy(false);
    }
  };

  const deltaColor = (minutes: number) =>
    minutes === 0 ? "text-slate-400" : minutes > 0 ? "text-lime-400" : "text-amber-400";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <GitCompare size={16} className="text-lime-400" /> {lang === "fr" ? "Écarts planning / pointage" : "Scheduled vs. actual variance"}
          {autoApproveEnabled && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-sky-400/10 text-sky-400 border border-sky-400/30 normal-case">
              {lang === "fr" ? `Approbation auto < ${AUTO_APPROVE_THRESHOLD_MINUTES} min activée` : `Auto-approve < ${AUTO_APPROVE_THRESHOLD_MINUTES} min is on`}
            </span>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-200"
            value={selectedName}
            onChange={e => setSelectedName(e.target.value)}
          >
            {activeStaff.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setMonthOffset(o => o - 1)}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              aria-label={lang === "fr" ? "Mois précédent" : "Previous month"}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[11px] text-slate-300 font-mono w-28 text-center capitalize">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setMonthOffset(o => Math.min(0, o + 1))}
              disabled={monthOffset === 0}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none"
              aria-label={lang === "fr" ? "Mois suivant" : "Next month"}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* PART 7: employee detail — extends this tab rather than a new
          screen. Same Part 1 rollup as the Payroll Ready card and Risk
          Radar, scoped to this one employee/month. Shown regardless of
          whether the day-by-day variance list below has anything in it —
          "no scheduled-vs-actual deviation this month" doesn't mean
          "nothing to show about this employee this month." */}
      {selectedName && opsSummary && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
            {lang === "fr" ? `Résumé du mois — ${selectedName}` : `Month summary — ${selectedName}`}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Heures" : "Hours"}</div>
              <div className="text-lg font-mono font-bold text-slate-100">{formatHours(opsSummary.effectiveHours)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Heures sup." : "Overtime"}</div>
              <div className={`text-lg font-mono font-bold ${opsSummary.overtimeHours > 0 ? "text-amber-400" : "text-slate-100"}`}>
                {opsSummary.overtimeHours > 0 ? `+${formatHours(opsSummary.overtimeHours)}` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Euro size={10} /> {lang === "fr" ? "Coût estimé" : "Est. cost"}
              </div>
              <div className="text-lg font-mono font-bold text-slate-100">€{opsSummary.estimatedGrossCost.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <UserX size={10} /> {lang === "fr" ? "Pointages manqués" : "Missing clock-ins"}
              </div>
              <div className={`text-lg font-mono font-bold ${opsSummary.noShowCount + opsSummary.forgottenClockOutCount > 0 ? "text-rose-400" : "text-slate-100"}`}>
                {opsSummary.noShowCount + opsSummary.forgottenClockOutCount}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Edit3 size={10} /> {lang === "fr" ? "Corrections manager" : "Manager corrections"}
              </div>
              <div className="text-lg font-mono font-bold text-slate-100">{opsSummary.correctionsCount}</div>
            </div>
          </div>
          <p className="text-[9px] text-slate-600 mt-3 italic">
            {lang === "fr"
              ? "Coût estimé = taux horaire × heures effectives (avec tolérance), brut uniquement — sans charges ni impôts. À titre indicatif, ne remplace pas l'onglet Paie."
              : "Estimated cost = hourly rate × effective hours (tolerance-adjusted), gross only — no tax or charges. For visibility only, not a replacement for the Payroll tab."}
          </p>
        </div>
      )}

      {!selectedName ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
          {lang === "fr" ? "Aucun employé actif." : "No active staff."}
        </div>
      ) : !summary || summary.days.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-sm text-slate-500">
          {lang === "fr"
            ? "Aucun écart planning / pointage pour ce mois — aucune journée avec à la fois un planning et un pointage approuvé, hors tolérance d'une minute."
            : "No scheduled-vs-actual variance this month — no day has both a schedule and an approved clock record outside the 1-minute floor."}
        </div>
      ) : (
        <>
          {/* SUMMARY CARD — exact shape from spec */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Prévu" : "Scheduled"}</div>
                <div className="text-xl font-mono font-bold text-slate-100">{formatHours(summary.scheduledHours)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Pointé" : "Clocked"}</div>
                <div className="text-xl font-mono font-bold text-slate-100">{formatHours(summary.clockedHours)}</div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(x => !x)}
                className="text-left rounded-xl -m-1 p-1 hover:bg-slate-800/40 transition-colors"
              >
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  {lang === "fr" ? "Différence" : "Difference"} {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </div>
                <div className={`text-xl font-mono font-bold ${deltaColor(summary.differenceHours * 60)}`}>{formatHours(summary.differenceHours, true)}</div>
              </button>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{lang === "fr" ? "Approuvé" : "Approved"}</div>
                <div className="text-xl font-mono font-bold text-lime-400">{formatHours(summary.approvedHours, true)}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{lang === "fr" ? "En attente" : "Pending"}</div>
                <div className={`text-xl font-mono font-bold ${pendingDates.length > 0 ? "text-amber-400" : "text-slate-100"}`}>{formatHours(summary.pendingHours, true)}</div>
              </div>
            </div>
            {pendingDates.length > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleApproveAllRemaining}
                  disabled={bulkBusy}
                  className="px-3 py-1.5 rounded-lg bg-lime-400 text-slate-950 text-xs font-bold hover:bg-lime-300 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check size={13} />
                  {bulkBusy
                    ? "..."
                    : lang === "fr"
                      ? `Tout approuver (${pendingDates.length} en attente)`
                      : `Approve all remaining (${pendingDates.length} pending)`}
                </button>
              </div>
            )}
          </div>

          {/* DAY-BY-DAY LIST */}
          {expanded && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800/60 shadow-lg overflow-hidden">
              {summary.days.map((day: DayVarianceWithStatus) => {
                const isPending = day.status === "pending";
                const isAutoApproved = day.status === "auto-approved";
                const isBusy = busyDate === day.date;
                return (
                  <div key={day.date} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-200 capitalize">{dayLabel(day.date)}</span>
                        <span className={`font-mono text-sm font-bold ${deltaColor(day.deltaMinutes)}`}>{formatDeltaMinutes(day.deltaMinutes)}</span>
                        {day.hasUnscheduled && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-sky-400/10 text-sky-400 border border-sky-400/30">
                            {lang === "fr" ? "Non planifié" : "Unscheduled"}
                          </span>
                        )}
                        {/* Auto-approved gets its own colour (sky, not
                            lime) — never visually indistinguishable from a
                            genuine human "Approved", per the auto-approve
                            feature's own design constraint (see
                            CLAUDE.md / api layer comment on this toggle). */}
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                          isPending ? "bg-amber-400/10 text-amber-400"
                          : isAutoApproved ? "bg-sky-400/10 text-sky-400"
                          : "bg-lime-400/10 text-lime-400"
                        }`}>
                          {isPending ? (lang === "fr" ? "En attente" : "Pending")
                            : isAutoApproved ? (lang === "fr" ? "Approuvé auto" : "Auto-approved")
                            : (lang === "fr" ? "Approuvé" : "Approved")}
                        </span>
                      </div>
                      {isPending ? (
                        <p className="text-[10px] text-slate-500 mt-1">
                          {day.components.map((c, i) => (
                            <span key={i}>
                              {i > 0 && " · "}
                              {c.unscheduled
                                ? (lang === "fr" ? `Pointé ${c.actualStart}–${c.actualEnd}, sans planning` : `Clocked ${c.actualStart}–${c.actualEnd}, no schedule`)
                                : (lang === "fr" ? `Prévu ${c.scheduledStart}–${c.scheduledEnd}, pointé ${c.actualStart}–${c.actualEnd}` : `Scheduled ${c.scheduledStart}–${c.scheduledEnd}, clocked ${c.actualStart}–${c.actualEnd}`)}
                            </span>
                          ))}
                        </p>
                      ) : isAutoApproved ? (
                        <p className="text-[10px] text-slate-500 mt-1">
                          {lang === "fr"
                            ? `Sous ${AUTO_APPROVE_THRESHOLD_MINUTES} min — aucune révision manuelle enregistrée`
                            : `Under ${AUTO_APPROVE_THRESHOLD_MINUTES} min — no manual review on record`}
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-500 mt-1">
                          {lang === "fr" ? "Approuvé par" : "Approved by"} {day.approval?.approvedBy}
                          {day.approval?.note ? ` — "${day.approval.note}"` : ""}
                        </p>
                      )}
                    </div>
                    {isPending && (
                      <div className="flex items-center gap-1.5">
                        <input
                          className="w-36 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600"
                          type="text"
                          placeholder={lang === "fr" ? "Note (optionnel)" : "Note (optional)"}
                          value={noteDrafts[day.date] ?? ""}
                          onChange={e => setNoteDrafts(prev => ({ ...prev, [day.date]: e.target.value }))}
                        />
                        <button
                          type="button"
                          onClick={() => handleApproveDay(day.date)}
                          disabled={isBusy}
                          className="px-3 py-1.5 rounded-lg bg-lime-400 text-slate-950 text-xs font-bold hover:bg-lime-300 disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
                        >
                          <Check size={13} /> {isBusy ? "..." : (lang === "fr" ? "Approuver" : "Approve")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!expanded && (
            <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-slate-600" />
              {lang === "fr"
                ? "Cliquez sur « Différence » pour voir le détail par jour et approuver."
                : "Click “Difference” above for the day-by-day breakdown and approval actions."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
