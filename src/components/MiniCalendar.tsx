import React from "react";

interface MiniCalendarProps {
  /** Any date within the month to display */
  anchorDate: string; // YYYY-MM-DD
  /** Dates to highlight, e.g. the requested range */
  highlightDates: string[];
  lang: "en" | "fr";
}

/**
 * A small read-only month calendar used to give managers visual context
 * for a request's date(s) — "is this a weekend, what else is that week"
 * — instead of just reading a raw date string.
 */
export default function MiniCalendar({ anchorDate, highlightDates, lang }: MiniCalendarProps) {
  const anchor = new Date(anchorDate + "T00:00:00");
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const highlightSet = new Set(highlightDates);
  const todayStr = new Date().toISOString().slice(0, 10);

  const weekdayLabels = lang === "fr"
    ? ["L", "M", "M", "J", "V", "S", "D"]
    : ["M", "T", "W", "T", "F", "S", "S"];

  const monthLabel = anchor.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric" });

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="bg-slate-950/50 border border-slate-800/60 rounded-xl p-3 w-full max-w-[220px]">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center mb-2 capitalize">{monthLabel}</div>
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
          return (
            <div
              key={dateStr}
              className={`text-[9px] rounded py-0.5 ${
                isHighlighted
                  ? "bg-lime-400 text-slate-950 font-bold"
                  : isToday
                    ? "border border-lime-400/50 text-lime-400"
                    : isWeekend
                      ? "text-sky-400/80"
                      : "text-slate-400"
              }`}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}
