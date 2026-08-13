import type { AppData } from "../types";

// Single source of truth (client-side) for "does this subscriptionStatus
// block access to the tenant?" — created after a real bug: fetchAppData's
// skip-subcollections logic and App.tsx's heartbeat-skip logic each
// re-listed "trial_expired" | "paused" by hand, and when "paused" was
// added, one of the two call sites was updated and the other was not
// (see CLAUDE.md — the paused-tenant fetchAppData bug found 2026-08-13,
// caught live in production during the admin-dashboard deploy). Anywhere
// that needs a plain "is this tenant blocked at all" boolean should call
// isBlockedStatus() instead of re-listing statuses, so a future third
// blocking status only has to be added in ONE place to take effect
// everywhere that matters.
//
// Mirrored in firestore.rules' tenantBlocked() function — Firestore's
// rules language cannot import this file, so that list must be kept in
// sync BY HAND. If you add a status here, add it there too.
//
// Deliberately NOT mirrored into functions/: every blocking-status check
// in functions/src/index.ts is narrow on purpose — e.g. markSubscriptionActive
// must NOT treat "paused" as reactivatable (a routine Stripe webhook must
// never silently lift an admin pause), and purgeExpiredTrials' query must
// match "trial_expired" only (a "paused" tenant must never enter the purge
// pipeline). Collapsing those into a general "is blocked" check would
// break both of those invariants. Only add a functions/-side equivalent
// if a genuine "blocked, regardless of which status" need arises there.
export const BLOCKING_STATUSES = ["trial_expired", "paused"] as const satisfies readonly NonNullable<AppData["subscriptionStatus"]>[];

export function isBlockedStatus(status: AppData["subscriptionStatus"]): boolean {
  return !!status && (BLOCKING_STATUSES as readonly string[]).includes(status);
}
