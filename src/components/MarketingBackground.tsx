import React from "react";

// Shared ambient backdrop for the public marketing/legal pages — a faint
// glow + grid that scrolls with a fixed viewport-anchored layer so every
// section reads as part of the same atmosphere, not just the hero.
export default function MarketingBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-full opacity-[0.12]"
        style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(163,230,53,0.15), transparent 70%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}
