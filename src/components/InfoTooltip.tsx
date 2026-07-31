import React, { useState, useRef, useEffect } from "react";

interface InfoTooltipProps {
  text: string;
}

/**
 * A small "ⓘ" that reveals an explanation on click/tap — deliberately
 * NOT a CSS :hover tooltip, since hover doesn't exist on touch devices
 * and a manager using this on their phone would never be able to open it.
 */
export default function InfoTooltip({ text }: InfoTooltipProps) {
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
      <button
        type="button"
        className="w-3.5 h-3.5 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-[9px] font-bold leading-none flex items-center justify-center flex-shrink-0 ml-1.5 align-middle"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label="More info"
      >
        i
      </button>
      {open && (
        <div
          className="absolute z-50 left-0 top-5 w-60 bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-[10px] text-slate-300 leading-relaxed shadow-xl"
          onClick={e => e.stopPropagation()}
        >
          {text}
        </div>
      )}
    </span>
  );
}
