import React, { useState, useRef, useEffect } from "react";

interface InfoTooltipProps {
  text: string;
  /** Custom tap target instead of the default "i" bubble — e.g. an
   * existing ⚠️ alert icon that should open this same popup rather than
   * gaining a second, redundant "i" trigger next to it. Every existing
   * call site omits this and keeps the original "i" button unchanged. */
  trigger?: React.ReactNode;
  /** Popup text wraps by default; pass through for content that already
   * has its own line breaks (e.g. joined warning messages). */
  preWrap?: boolean;
}

/**
 * A small "ⓘ" (or a custom trigger) that reveals an explanation on
 * click/tap — deliberately NOT a CSS :hover tooltip, since hover doesn't
 * exist on touch devices and a manager using this on their phone would
 * never be able to open it.
 */
export default function InfoTooltip({ text, trigger, preWrap }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <span className="relative inline-block" ref={ref}>
      {trigger ? (
        <span
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setOpen(v => !v); } }}
        >
          {trigger}
        </span>
      ) : (
        <button
          type="button"
          className="w-3.5 h-3.5 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-[9px] font-bold leading-none flex items-center justify-center flex-shrink-0 ml-1.5 align-middle"
          onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          aria-label="More info"
        >
          i
        </button>
      )}
      {open && (
        <div
          className={`absolute z-50 left-0 top-5 w-64 bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-[10px] text-slate-300 leading-relaxed shadow-xl ${preWrap ? "whitespace-pre-line" : ""}`}
          onClick={e => e.stopPropagation()}
        >
          {text}
        </div>
      )}
    </span>
  );
}
