import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface MiniCalendarProps {
  /** Any date within the month to display */
  anchorDate: string; // YYYY-MM-DD
  /** Dates to highlight, e.g. the requested range */
  highlightDates: string[];
  lang: "en" | "fr";
  /** When provided, day cells become clickable and this fires with the clicked date. */
  onDateClick?: (dateStr: string) => void;
  /** When true, shows prev/next month arrows and the displayed month can move away from anchorDate. */
  navigable?: boolean;
  /** Dates that get a small dot indicator underneath — e.g. "already has data". */
  markedDates?: string[];
}

/**
 * A small month calendar. Read-only by default (used to give managers
 * visual context for a request's date(s) — "is this a weekend, what
 * else is that week"). Pass `navigable` + `onDateClick` to turn it into
 * an interactive date picker instead.
 */
export default function MiniCalendar({ anchorDate, highlightDates, lang, onDateClick, navigable = false, markedDates = [] }: MiniCalendarProps) {
  const [viewAnchor, setViewAnchor] = useState(anchorDate);
  const anchor = new Date((navigable ? viewAnchor : anchorDate) + "T00:00:00");
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const highlightSet = new Set(highlightDates);
  const markedSet = new Set(markedDates);
  const todayStr = new Date().toISOString().slice(0, 10);

  const weekdayLabels = lang === "fr"
    ? ["L", "M", "M", "J", "V", "S", "D"]
    : ["M", "T", "W", "T", "F", "S", "S"];

  const monthLabel = anchor.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric" });

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const shiftMonth = (delta: number) => {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() + delta, 1);
    // Local components, not toISOString() — that converts to UTC first
    // and can roll the date into the wrong month for positive UTC offsets.
    setViewAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  };

  return (
    <div className="bg-slate-950/50 border border-slate-800/60 rounded-xl p-3 w-full max-w-[220px]">
      <div className="flex items-center justify-between mb-2">
        {navigable ? (
          <button type="button" onClick={() => shiftMonth(-1)} className="p-0.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300">
            <ChevronLeft size={12} />
          </button>
        ) : <span className="w-4" />}
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center capitalize">{monthLabel}</div>
        {navigable ? (
          <button type="button" onClick={() => shiftMonth(1)} className="p-0.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300">
            <ChevronRight size={12} />
          </button>
        ) : <span className="w-4" />}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdayLabels.map((d, i) => (
          <div key={i} className="text-[8px] text-slate-600 font-semibold">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isHighlighted = highlightSet.has(dateStr);
          const isToday = dateStr === todayStr;
          const isWeekend = [0, 6].includes(new Date(year, month, day).getDay());
          const isMarked = markedSet.has(dateStr);
          const classes = `relative text-[9px] rounded py-0.5 w-full ${
            isHighlighted
              ? "bg-lime-400 text-slate-950 font-bold"
              : isToday
                ? "border border-lime-400/50 text-lime-400"
                : isWeekend
                  ? "text-sky-400/80"
                  : "text-slate-400"
          } ${onDateClick ? "cursor-pointer hover:bg-slate-800" : ""}`;
          const content = (
            <>
              {day}
              {isMarked && !isHighlighted && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-lime-400/70" />
              )}
            </>
          );
          return onDateClick ? (
            <button key={dateStr} type="button" onClick={() => onDateClick(dateStr)} className={classes}>{content}</button>
          ) : (
            <div key={dateStr} className={classes}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
