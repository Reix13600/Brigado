// PART 2 (Phase E/F follow-on): the proactive fix behind a real
// production bug — Reigo's Aug-21 entry, a forgotten clock-out that
// closed against the wrong reference point, producing a nonsense
// 95.26h shift. This module is the single source of truth for "how
// long was this shift, and is that plausible" at the exact moment a
// clock-out is about to be saved.
//
// Kept pure and framework-free (no Firebase imports) on purpose, same
// discipline as effectiveHours.ts/variance.ts/plannedHours.ts/
// operationsRollup.ts — those files stay importable in vitest without
// pulling in firebase.ts's initializeApp() at module scope. api.ts's
// clockOut() imports THIS file rather than the other way around, so
// the number the UI warns on and the number that gets saved can never
// drift apart.

/** Long enough that a genuine unusual double-shift never trips it,
 * well below anything physically normal for one continuous shift.
 * Separate from operationsRollup.ts's DEFAULT_FORGOTTEN_CLOCKOUT_HOURS
 * (12h): that one flags a clock-in that is STILL open right now; this
 * one warns at the moment a shift is actually being CLOSED, on the
 * exact duration about to be saved — a different question with a
 * different number, not the same threshold reused. */
export const IMPLAUSIBLE_DURATION_THRESHOLD_HOURS = 16;

/**
 * The exact elapsed-hours formula clockOut() saves. `now` is
 * injectable for deterministic testing. Never negative (a clock-in
 * timestamp in the future — clock skew — floors at 0 rather than
 * producing a negative "shift").
 *
 * DOES NOT MUTATE any argument.
 */
export function computeElapsedHours(clockInAt: string, now: Date = new Date()): number {
  return Math.max(0, (now.getTime() - new Date(clockInAt).getTime()) / (1000 * 60 * 60));
}
