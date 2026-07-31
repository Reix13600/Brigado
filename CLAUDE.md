# Brigado — Project Context for Claude Code

Staff hours, roster, and payroll SaaS for French restaurants (HCR sector). Built with Firebase (Hosting, Firestore, Auth, Cloud Functions), React + TypeScript + Vite. Stripe for billing, Resend for transactional email.

## Stack & structure

* `src/` — React app. `App.tsx` handles routing (slug-based: `/{restaurantSlug}` = the app, `/` = public Landing page, `/mentions-legales` `/cgv` `/confidentialite` `/contact` `/features` = static marketing pages).
* `src/components/ManagerDashboard.tsx` and `StaffDashboard.tsx` — the two main views. ManagerDashboard is very large (~5000 lines); most features live here.
* `functions/` — separate Node project (own `package.json`/`tsconfig.json`), Cloud Functions v2. Deploy separately from hosting: `firebase deploy --only functions` vs `firebase deploy --only hosting`.
* Firestore structure: `restaurants/{slug}` (config, staff array, revenueByWeek, ownerContact, managerEmails) with subcollections `entries`, `advances`, `scheduledShifts`, `activeClockIns`, `announcements`, `messages`, `timeOffRequests`, `swapRequests`. Separate `managers/{uid} -> {restaurantId, email}` lookup collection (supports multiple managers per restaurant, all equal access).
* Production domain: `brigado.solutions` (Firebase Hosting custom domain). Firebase project: `brigado-a33b1`.

## Business context

* Pricing: EUR 39/month or EUR 390/year, 7-day free trial, card required upfront. Stripe Payment Links (not custom Checkout code) with `trial_period_days` set per-link.
* Registration flow: Landing page collects restaurant name/slug/email/contact name/phone/postcode -> Stripe Payment Link -> webhook (`stripeWebhook` in functions) provisions the restaurant, manager account, and sends a password-setup email via Resend.
* Target market: French restaurants/small hotels. French is the default language everywhere (`lang` state defaults to `"fr"`); English is a toggle, not the primary language.
* Competitor context: Combo/Snapshift charges per-employee (~EUR 5-7/employee/mo); Brigado's flat fee is a deliberate differentiator for restaurants with bigger teams.

## Key architectural decisions (don't relitigate without reason)

* Trust model: staff use anonymous Firebase Auth (no real accounts, identity enforced by in-app PIN only) — this was a deliberate simplicity choice. Managers use real email/password or Google auth.
* No hard-deletes of staff data by default. Archiving a staff member (`active: false`) hides them from active rosters but never touches their historical entries/payroll — this is intentional, for French payroll record retention (~5 years). Permanent deletion is only exposed in the UI once 5+ years have passed since their last logged activity (see the Former Staff popup in ManagerDashboard).
* Compliance engine (`src/utils/compliance.ts`) cites real Code du travail articles + the HCR collective agreement. Every rule is individually toggleable (not all-or-nothing), defaults to only the 4 near-universal rules being on. There's an explicit "what this does NOT track" disclaimer in the UI — never remove that; overstating legal coverage is a real liability, not just a copy nitpick.
* Print-safe portals: any printable document (QR poster, Timesheet, Bookkeeper export) renders via `createPortal` to `document.body` with class `print-portal-root`. The print CSS in `src/index.css` hides everything except that portal using `body:has(.print-portal-root) > *:not(.print-portal-root) { display: none }`. Do NOT put `print:hidden` on the portal's own root element — that was a real bug once (hides the print area along with everything else). Do NOT remove the `:has()` guard — without it, printing anything else in the app (Roster Planner, Entries) goes blank.
* Messages auto-delete after 30 days (`cleanupOldMessages` scheduled function) — private chat only, NOT announcements, NOT entries/payroll (those are kept indefinitely, no retention automation built yet beyond the 5-year staff-deletion gate above).
* Bilingual pattern: most newer components use inline `lang === "fr" ? "..." : "..."` rather than the `translations.ts` dictionary (which covers older/core UI). Both patterns coexist; match whichever pattern the file you're editing already uses.

## Known pending work / open items

* **StatsPage.tsx integration**: a new self-contained Stats tab component was built (busiest-day chart, absence rate, flagged-entries trend, labor-cost-%-of-revenue gauge, gradient charts, count-up KPIs) but may not yet be wired into `ManagerDashboard.tsx` — check whether the Stats tab still has the old inline implementation or has been swapped for `<StatsPage />`. If not yet applied, the file should exist at `src/components/StatsPage.tsx` — wire it in and remove the old inline Stats tab block.
* This repo was not being pushed to GitHub during earlier development (all changes were applied locally from downloaded files). Recommend setting up a proper `git add / commit / push` habit now that Claude Code has direct file access, so this doesn't happen again — the working directory should become the single source of truth living in both places.
* Custom-roles-vs-fixed-list decision: currently a fixed but generous role list (server/kitchen/cold/dishwasher/bar/chef/cleaner/host/other). Full custom roles per restaurant would be a bigger schema change — only worth it if the fixed list proves genuinely limiting.
* Paid-leave accrual tracking (5-week entitlement, balance tracking) is explicitly NOT built — flagged as a bigger future feature, not a bug.
* GDPR "right to erasure" beyond the 5-year staff-deletion gate is not implemented — deliberately deferred pending the user consulting an actual advisor, since erasure requests can legally conflict with payroll retention requirements.

## Secrets / external services

* Firebase Secret Manager holds `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` — never hardcode these, never put them in client-side code (functions only).
* Resend sending domain: `brigado.solutions`, verified. Sender address convention: `info@brigado.solutions`.
* Any API key or credential that appears in chat/conversation history should be treated as compromised and rotated — this has happened before with both the Firebase service account key and the Resend key.

## Working style established with this project

* Always run `npx tsc --noEmit` and a full `npm run build` (both root app and `functions/` separately) before considering a change done.
* Deploys: `firebase deploy --only hosting` for app changes, `firebase deploy --only functions` for Cloud Functions changes (both if both changed). `firebase use brigado-a33b1` to confirm the right project before deploying (there was a past incident of deploying to the wrong Firebase project).
* The user (Reix) runs a real restaurant (La Vague, slug `la-vague`) as the pilot customer — treat that restaurant's data/settings as real production data, not a test fixture.
