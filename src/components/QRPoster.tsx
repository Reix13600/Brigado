import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { X, Printer } from "lucide-react";

interface QRPosterProps {
  restaurantName: string;
  slug: string;
  lang: "en" | "fr";
  onClose: () => void;
}

type QrSize = "compact" | "standard" | "large";
const QR_PIXELS: Record<QrSize, number> = { compact: 160, standard: 220, large: 280 };

type AccentColor = "lime" | "black" | "none";
const ACCENT_STYLES: Record<AccentColor, { border: string; qrDark: string }> = {
  lime: { border: "border-4 border-lime-400", qrDark: "#0f172a" },
  black: { border: "border-4 border-slate-900", qrDark: "#0f172a" },
  none: { border: "border border-slate-300", qrDark: "#0f172a" },
};

export default function QRPoster({ restaurantName, slug, lang, onClose }: QRPosterProps) {
  const [title, setTitle] = useState(restaurantName);
  const [subtitle, setSubtitle] = useState(lang === "fr" ? "Scannez pour pointer" : "Scan to clock in");
  const [note, setNote] = useState(lang === "fr" ? "Demandez votre code PIN à votre responsable." : "Ask your manager for your PIN.");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrSize, setQrSize] = useState<QrSize>("standard");
  const [accent, setAccent] = useState<AccentColor>("lime");

  const url = `${window.location.origin}/${slug}?src=qr`;

  useEffect(() => {
    QRCode.toDataURL(url, { width: 600, margin: 1, color: { dark: ACCENT_STYLES[accent].qrDark, light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(console.error);
  }, [url, accent]);

  return createPortal(
    // NOTE: this outer wrapper must NOT have print:hidden — it's the
    // ancestor of the actual print area below. Hiding it with display:none
    // would take the print area down with it.
    // Rendered via a portal (not inline in ManagerDashboard's tree) so
    // print CSS can cleanly hide "everything except this" using
    // `display: none` on the rest of the app — visibility:hidden alone
    // doesn't remove elements from layout, so the app's own scrollable
    // height was generating extra blank printed pages.
    <div id="qr-poster-portal" className="print-portal-root fixed inset-0 bg-slate-950/80 z-50 flex flex-col md:flex-row items-center justify-center gap-6 p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl print:hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-sm font-bold text-slate-100">{lang === "fr" ? "Affiche QR à imprimer" : "Printable QR poster"}</h2>
          <button className="p-1.5 text-slate-500 hover:text-slate-200" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="space-y-3 p-6">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Titre" : "Title"}</label>
              <input
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200"
                value={title}
                maxLength={40}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Sous-titre" : "Subtitle"}</label>
              <input
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200"
                value={subtitle}
                maxLength={50}
                onChange={e => setSubtitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Note (optionnel)" : "Note (optional)"}</label>
              <textarea
                className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200 h-16 resize-none"
                value={note}
                maxLength={120}
                onChange={e => setNote(e.target.value)}
              />
              <p className="text-[10px] text-slate-600 mt-1 text-right">{note.length}/120</p>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Taille du QR" : "QR size"}</label>
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 mt-1 text-xs">
                {(["compact", "standard", "large"] as QrSize[]).map(size => (
                  <button
                    key={size}
                    className={`flex-1 py-1.5 rounded-lg font-semibold transition-all ${qrSize === size ? "bg-lime-400/10 text-lime-400" : "text-slate-400"}`}
                    onClick={() => setQrSize(size)}
                  >
                    {size === "compact" ? (lang === "fr" ? "Petit" : "Compact") : size === "standard" ? (lang === "fr" ? "Moyen" : "Standard") : (lang === "fr" ? "Grand" : "Large")}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lang === "fr" ? "Couleur d'accent" : "Accent color"}</label>
              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 mt-1 text-xs">
                {(["lime", "black", "none"] as AccentColor[]).map(c => (
                  <button
                    key={c}
                    className={`flex-1 py-1.5 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 ${accent === c ? "bg-lime-400/10 text-lime-400" : "text-slate-400"}`}
                    onClick={() => setAccent(c)}
                  >
                    {c !== "none" && (
                      <span className={`w-2.5 h-2.5 rounded-full ${c === "lime" ? "bg-lime-400" : "bg-slate-100"}`} />
                    )}
                    {c === "lime" ? (lang === "fr" ? "Vert" : "Lime") : c === "black" ? (lang === "fr" ? "Noir" : "Black") : (lang === "fr" ? "Aucune" : "None")}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-1">
                {lang === "fr" ? "\"Aucune\" économise l'encre à l'impression." : "\"None\" saves ink when printing."}
              </p>
            </div>

            <p className="text-[10px] text-slate-600 font-mono break-all">{url}</p>
            <button
              className="w-full py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all flex items-center justify-center gap-2"
              onClick={() => window.print()}
            >
              <Printer size={16} /> {lang === "fr" ? "Imprimer" : "Print"}
            </button>
        </div>
      </div>

      {/* PREVIEW / PRINT AREA — a sibling of the editor card (NOT nested
          inside its print:hidden wrapper), so it's the one thing left
          standing when everything else is hidden for print.
          IMPORTANT: no fixed aspect-ratio + overflow:hidden combo here —
          that was clipping content (title's top edge and the note's tail
          were getting cut off whenever the QR + text together exceeded a
          fixed box height). Height is auto and grows to fit; only width
          is constrained, both on screen and via the dedicated print CSS
          in index.css (#qr-poster-print-area). */}
      <div
        id="qr-poster-print-area"
        className={`bg-white text-slate-900 rounded-2xl flex flex-col items-center justify-center text-center flex-shrink-0 py-8 px-6 ${ACCENT_STYLES[accent].border}`}
        style={{ width: "min(90vw, 360px)" }}
      >
        <h1 className="text-2xl font-extrabold leading-tight break-words">{title || " "}</h1>
        <p className="text-base font-semibold text-slate-600 mt-1 leading-snug break-words">{subtitle}</p>
        {qrDataUrl && <img src={qrDataUrl} alt="QR code" className="mt-6" style={{ width: QR_PIXELS[qrSize], height: QR_PIXELS[qrSize] }} />}
        {note && <p className="text-xs text-slate-500 mt-6 max-w-xs leading-snug break-words">{note}</p>}
      </div>
    </div>,
    document.body
  );
}
