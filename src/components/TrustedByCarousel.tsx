import React, { useEffect, useState } from "react";
import { getApprovedLogos } from "../utils/api";
import { ApprovedLogo } from "../types";

/**
 * "Trusted by" logo strip for the Landing page. Reads ONLY the public
 * `approvedLogos` collection (see ApprovedLogo in types.ts) — never
 * `restaurants` directly, which holds owner contact info and other data
 * that must never be broadly listable from an anonymous visitor.
 *
 * Renders nothing at all — not an empty section, not a loading
 * skeleton — until there is at least one approved logo. A section with
 * zero or one real logo in it reads as more suspicious than reassuring.
 */
export default function TrustedByCarousel({ lang }: { lang: "fr" | "en" }) {
  const [logos, setLogos] = useState<ApprovedLogo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApprovedLogos()
      .then(result => { if (!cancelled) setLogos(result); })
      .catch(err => { console.error(err); if (!cancelled) setLogos([]); });
    return () => { cancelled = true; };
  }, []);

  if (!logos || logos.length === 0) return null;

  // Repeated 3x so a linear scroll of exactly 1/3 of the track's width
  // loops with no visible seam, even with just one or two logos.
  const track = [...logos, ...logos, ...logos];

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <p className="text-center text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-6">
        {lang === "fr" ? "Ils nous font confiance" : "Trusted by"}
      </p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="flex items-center gap-8 w-max animate-trusted-by-scroll">
          {track.map((logo, i) => (
            <div
              key={`${logo.slug}-${i}`}
              title={logo.restaurantName}
              className="flex-shrink-0 h-16 w-32 flex items-center justify-center bg-white rounded-xl border border-slate-800/60 p-3"
            >
              <img src={logo.logoUrl} alt={logo.restaurantName} className="max-h-full max-w-full object-contain" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
