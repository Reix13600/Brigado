import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import Stripe from "stripe";
import {
  addContactToJoinedList, addContactToTrialExpiredList,
  removeContactFromTrialExpiredList, markBrevoContactConverted,
} from "./brevo";
import { isReservedSlug } from "./reservedSlugs";

initializeApp();
const db = getFirestore();
const auth = getAuth();

// ── SECRETS ──────────────────────────────────────────────────────────
// Set these with:
//   firebase functions:secrets:set STRIPE_SECRET_KEY
//   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
//   firebase functions:secrets:set RESEND_API_KEY
//   firebase functions:secrets:set BREVO_API_KEY
// Never put the actual values in this file or anywhere in the repo.
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const resendApiKey = defineSecret("RESEND_API_KEY");
// Bound to stripeWebhook + purgeExpiredTrials for the Trial Expired -
// Brigado list sync (see brevo.ts). Exported so script-side tooling can
// reference the same name.
export const brevoApiKey = defineSecret("BREVO_API_KEY");
// Brevo list ids, resolved once by scripts/brevo-setup-lists.ts, which
// caches them in functions/.env.
const brevoTrialExpiredListId = defineString("BREVO_TRIAL_EXPIRED_LIST_ID", { default: "" });
const brevoJoinedListId = defineString("BREVO_JOINED_LIST_ID", { default: "" });

/** Resolves Brevo config for a given list, or null (with a loud log)
 * when unset — every caller treats null as "skip Brevo, never block the
 * real work". */
function brevoConfig(which: "trialExpired" | "joined"): { apiKey: string; listId: number } | null {
  const apiKey = brevoApiKey.value();
  const param = which === "joined" ? brevoJoinedListId : brevoTrialExpiredListId;
  const paramName = which === "joined" ? "BREVO_JOINED_LIST_ID" : "BREVO_TRIAL_EXPIRED_LIST_ID";
  const listId = Number(param.value());
  if (!apiKey || !listId) {
    logger.error(`Brevo ${which} sync skipped: BREVO_API_KEY secret or ${paramName} param not configured`);
    return null;
  }
  return { apiKey, listId };
}

/** The restaurant's main registered contact for lifecycle email: the
 * original signup email (stored as signupEmail since Aug 2026), falling
 * back to managerEmails[0] for tenants provisioned before that field
 * existed. Deliberately ONE address — never the whole manager list. */
function primaryEmailOf(data: FirebaseFirestore.DocumentData): string | null {
  return data.signupEmail || data.managerEmails?.[0] || null;
}

const DEFAULT_CONFIG = {
  resto_name: "",
  manager_pin: "1234",
  overtime_limit: 35,
  tax_rate: 22,
  approval_required: true,
  bookkeeper_email: "",
  sheet_url: "",
  enable_scheduling: true,
  compliance_enforced: true,
  strict_clock_required: false,
  digest_email: "",
};

// ── STRIPE WEBHOOK ───────────────────────────────────────────────────
// TODO(stripe): point your Stripe webhook endpoint (Dashboard -> Developers
// -> Webhooks -> Add endpoint) at this function's URL once deployed, and
// subscribe it to: checkout.session.completed, customer.subscription.deleted,
// customer.subscription.updated, customer.subscription.trial_will_end,
// invoice.payment_failed, invoice.paid
export const stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret, brevoApiKey], cors: false },
  async (req, res) => {
    const stripe = new Stripe(stripeSecretKey.value());
    const sig = req.headers["stripe-signature"];

    let event: Stripe.Event;
    try {
      // req.rawBody is provided by the Firebase Functions HTTP wrapper —
      // Stripe signature verification requires the exact raw bytes, not
      // the parsed JSON body.
      event = stripe.webhooks.constructEvent(req.rawBody, sig as string, stripeWebhookSecret.value());
    } catch (err) {
      logger.error("Stripe signature verification failed", err);
      res.status(400).send("Webhook signature verification failed");
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const ref = session.client_reference_id || "";
        // Format v3: slug|name|contactName|phone|postcode|city|lang
        // (pipe-delimited, each part URI-encoded). Shorter pipe variants
        // (pre-city/lang links) and the ancient "slug::name" format still
        // parse, so in-flight checkout links keep provisioning.
        let slug: string, restaurantName: string, contactName: string, phone: string, postcode: string, city: string, langPref: string;
        if (ref.includes("|")) {
          const parts = ref.split("|").map(p => { try { return decodeURIComponent(p); } catch { return p; } });
          [slug, restaurantName, contactName, phone, postcode, city, langPref] = parts;
        } else {
          [slug, restaurantName] = ref.split("::");
          contactName = ""; phone = ""; postcode = ""; city = ""; langPref = "";
        }
        const email = session.customer_details?.email;

        if (!slug || !email) {
          logger.error("Missing slug or email on checkout session", { ref, email });
          res.status(200).send("Missing data, nothing provisioned");
          return;
        }

        await provisionRestaurant(
          slug, restaurantName || slug, email, contactName || "", phone || "", postcode || "",
          city || "", langPref === "en" ? "en" : "fr", session.customer as string
        );
        logger.info(`Provisioned restaurant "${slug}" for ${email}`);
      }

      // ── SUBSCRIPTION LIFECYCLE → subscriptionStatus ────────────────
      // `subscriptionStatus` on restaurants/{slug} is the single source
      // of truth for access blocking (the app never recomputes it from
      // dates). "trial_expired" here means: the subscription ended
      // without ever converting to paid — canceled during trial, or the
      // first charge failed. See CLAUDE.md "Trial expiry & data retention".

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;
        await markTrialExpired(subscription.customer as string, `subscription deleted (${event.id})`);
      }

      if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        if (["canceled", "unpaid", "incomplete_expired"].includes(subscription.status)) {
          await markTrialExpired(customerId, `subscription status became "${subscription.status}" (${event.id})`);
        } else if (subscription.status === "active") {
          await markSubscriptionActive(customerId, `subscription status became "active" (${event.id})`);
        } else {
          // "trialing" / "past_due" / "incomplete": not a blocking state.
          // past_due means Stripe dunning is still retrying the card —
          // invoice.payment_failed below decides whether to block.
          logger.info(`Subscription for customer ${customerId} now "${subscription.status}" — no status change applied`);
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        // A failed charge only means "trial never converted" if this
        // customer has never successfully paid. A long-standing paying
        // restaurant whose renewal card bounces should NOT be blocked
        // mid-service — Stripe dunning retries, and if it truly dies the
        // subscription.updated/deleted terminal states above catch it.
        if (await customerHasEverPaid(stripe, customerId)) {
          logger.warn(`Payment failed for previously-paying customer ${customerId} — dunning in progress, not blocking`, { eventId: event.id });
        } else {
          await markTrialExpired(customerId, `first payment failed, never converted (${event.id})`);
        }
      }

      if (event.type === "invoice.paid") {
        const invoice = event.data.object as Stripe.Invoice;
        // Real money received → reactivate. amount_paid > 0 filters out
        // the €0 invoice Stripe issues when a trial starts.
        if (invoice.amount_paid > 0) {
          await markSubscriptionActive(invoice.customer as string, `invoice paid (${event.id})`);
        }
      }

      if (event.type === "customer.subscription.trial_will_end") {
        // Fires ~3 days before trial end. Not a blocking signal — just
        // recorded so a future "your trial ends soon" email can hang off
        // it. (No such email is sent today; flagged as a known gap.)
        const subscription = event.data.object as Stripe.Subscription;
        const resto = await findRestaurantByCustomer(subscription.customer as string);
        if (resto) {
          await resto.ref.update({ trialWillEndNotedAt: new Date().toISOString() });
          logger.info(`Trial ending soon for restaurant ${resto.id}`);
        }
      }

      res.status(200).send("OK");
    } catch (err) {
      logger.error("Error handling Stripe webhook", err);
      res.status(500).send("Internal error");
    }
  }
);

/**
 * Creates the restaurant doc, the manager's Firebase Auth account (no
 * password set yet), the managers/{uid} lookup doc, and emails a
 * password-setup link. Mirrors what scripts/seed-manager.mjs does
 * manually — this is the same thing, triggered by a real payment.
 */
async function provisionRestaurant(
  slug: string, restaurantName: string, email: string,
  contactName: string, phone: string, postcode: string,
  city: string, preferredLang: "fr" | "en",
  stripeCustomerId?: string,
  // Set for bonus-code signups: same provisioning, no Stripe. Everything
  // else about the tenant is identical, which is why this is an option on
  // the existing function rather than a parallel implementation.
  comped?: { via: string; untilISO: string | null }
): Promise<void> {
  // Reserved slugs are rejected HERE, not just in the registration form:
  // the slug arrives inside Stripe's client_reference_id and never has to
  // pass through that form, so the client check is UX only. A tenant on a
  // reserved slug would be routed to a static page / the admin dashboard
  // and be permanently unreachable.
  if (isReservedSlug(slug)) {
    logger.error(`Refusing to provision reserved slug "${slug}" — signup must be reconciled manually`);
    throw new Error(`Reserved slug: ${slug}`);
  }

  const restoRef = db.doc(`restaurants/${slug}`);
  const existing = await restoRef.get();
  if (existing.exists) {
    const prior = existing.data()?.subscriptionStatus;
    // An admin-paused tenant must not silently un-pause itself by running
    // through checkout again — only an admin resumes a pause.
    if (prior === "paused") {
      logger.warn(`Restaurant "${slug}" is admin-paused — linking billing but leaving the pause in place.`);
      if (stripeCustomerId) await restoRef.update({ stripeCustomerId });
      return;
    }
    logger.warn(`Restaurant "${slug}" already exists — skipping provisioning, just linking billing.`);
    // A blocked (trial_expired) restaurant re-subscribing through checkout
    // with its original slug lands here: relink billing and lift the block.
    const wasExpired = prior === "trial_expired";
    await restoRef.update({
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      subscriptionStatus: "active",
      subscriptionStatusReason: "re-subscribed via checkout",
      subscriptionStatusUpdatedAt: new Date().toISOString(),
      suspended: false,
      trialExpiredAt: FieldValue.delete(),
      finalNoticeSentAt: FieldValue.delete(),
    });
    if (wasExpired) {
      const brevoConf = brevoConfig("trialExpired");
      const primary = primaryEmailOf(existing.data() || {});
      if (brevoConf && primary) {
        await removeContactFromTrialExpiredList(primary, "active", brevoConf.apiKey, brevoConf.listId);
      }
    }
    return;
  }

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email });
  }

  await db.doc(`managers/${user.uid}`).set({ restaurantId: slug, email });

  await restoRef.set({
    config: { ...DEFAULT_CONFIG, resto_name: restaurantName },
    staff: [],
    dayNotes: {},
    weekNotes: {},
    stripeCustomerId: stripeCustomerId || null,
    suspended: false,
    // "comped" behaves exactly like "active" for access purposes — it is a
    // separate value only so the admin dashboard can tell a bonus-code
    // tenant from a paying one, and so the scheduled sweep can find the
    // ones whose free period has run out.
    subscriptionStatus: comped ? "comped" : "active",
    ...(comped
      ? {
          compedVia: comped.via,
          compedGrantedAt: new Date().toISOString(),
          // null = permanent; the expiry sweep skips these by construction.
          compedUntil: comped.untilISO,
        }
      : {}),
    // When this tenant was provisioned. Added 2026-08-13 for the admin
    // dashboard's Overview tab (signups-over-time) — before this, NO
    // creation date was stored anywhere on the restaurant doc, so
    // adminListBusinesses' `joinedAt` silently resolved to null for every
    // paid signup. Tenants provisioned before this line existed are
    // backfilled by scripts/backfill-created-at.mjs from their earliest
    // manager's Firebase Auth creationTime.
    createdAt: new Date().toISOString(),
    // Seeded at creation so the tenant has a sane value before anyone
    // opens the app (Phase 2 analytics reads this).
    lastActiveAt: new Date().toISOString(),
    managerEmails: [email],
    // The original signup email — the ONE address lifecycle email (e.g.
    // the Brevo trial-expired sequence) goes to, stable even if managers
    // are later added or the original one is removed from managerEmails.
    signupEmail: email,
    // Signup-page language toggle at the moment of checkout. Drives the
    // LANG attribute on Brevo contacts; tenants provisioned before this
    // field existed default to "fr".
    preferredLang,
    // Administrative contact info collected at signup — kept separate
    // from `config` (which is app-behavior settings, not metadata).
    ownerContact: { contactName, phone, postcode, city },
  });

  const resetLink = await auth.generatePasswordResetLink(email);
  try {
    await sendEmail(
      email,
      `Welcome to Brigado, ${restaurantName}!`,
      `<p>Your restaurant "${restaurantName}" is ready at <a href="https://brigado.solutions/${slug}">brigado.solutions/${slug}</a>.</p>
       <p>Set your manager password to log in: <a href="${resetLink}">${resetLink}</a></p>`
    );
  } catch (err) {
    // Provisioning itself already succeeded — don't let a bounced welcome
    // email fail the webhook and cause Stripe to retry (which would try
    // to re-provision an already-existing restaurant).
    logger.error(`Provisioned "${slug}" but welcome email failed to send`, err);
  }

  // ── Marketing bookkeeping (never blocks provisioning) ──────────────
  // Order matters: the joined-list upsert creates the contact if it does
  // not exist yet, so the CONVERTED flag below always lands on a real
  // record — including organic signups that were never cold-outreach
  // prospects, which would otherwise 404.
  const joinedConf = brevoConfig("joined");
  if (joinedConf) {
    await addContactToJoinedList({
      email,
      restaurantName,
      restaurantId: slug,
      city,
      phone,
      lang: preferredLang,
      // "comped" = arrived via a bonus code (no Stripe), "paid" = normal
      // checkout. Lets the Brevo side segment the two without inspecting
      // subscriptionStatus, which changes over a tenant's life.
      signupType: comped ? "comped" : "paid",
    }, joinedConf.apiKey, joinedConf.listId);
  }
  // Setting CONVERTED only marks the contact — it does not itself stop
  // any cold email. The Brevo automation has to test this attribute for
  // it to matter; see the Brevo section in CLAUDE.md.
  if (brevoApiKey.value()) {
    await markBrevoContactConverted(email, brevoApiKey.value());
  }
}

// ── TRIAL EXPIRY: status transitions ─────────────────────────────────

async function findRestaurantByCustomer(customerId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await db.collection("restaurants").where("stripeCustomerId", "==", customerId).limit(1).get();
  if (snap.empty) {
    logger.warn(`No restaurant found for Stripe customer ${customerId}`);
    return null;
  }
  return snap.docs[0];
}

/**
 * Flags a tenant as trial_expired — the single blocking state the app
 * checks. Idempotent on trialExpiredAt: Stripe often sends several
 * events for one expiry (payment_failed + updated + deleted), and the
 * 30-day deletion clock must start from the FIRST one, not reset on
 * each. `suspended` is kept in sync for any not-yet-refreshed client
 * still running the pre-trial-expiry app build.
 */
async function markTrialExpired(customerId: string, reason: string): Promise<void> {
  const resto = await findRestaurantByCustomer(customerId);
  if (!resto) return;
  const data = resto.data();
  const already = data.subscriptionStatus === "trial_expired";
  // The clock keeps its original start on repeat events — which also
  // pins the Brevo DELETION_DATE below to one stable value.
  const effectiveExpiredAt: string = already && data.trialExpiredAt ? data.trialExpiredAt : new Date().toISOString();
  await resto.ref.update({
    subscriptionStatus: "trial_expired",
    subscriptionStatusReason: reason,
    subscriptionStatusUpdatedAt: new Date().toISOString(),
    suspended: true,
    ...(already ? {} : { trialExpiredAt: effectiveExpiredAt }),
  });
  logger.warn(`Restaurant ${resto.id} marked trial_expired (${reason})${already ? " — was already expired, deletion clock unchanged" : ""}`);

  // Enroll the main registered contact in the Brevo "Trial Expired -
  // Brigado" list — this is what starts the manually-built reminder
  // automation. Upsert semantics make re-fires harmless.
  const brevoConf = brevoConfig("trialExpired");
  const primary = primaryEmailOf(data);
  if (!primary) {
    logger.error(`Brevo: restaurant ${resto.id} has no signupEmail or managerEmails — cannot enroll in Trial Expired list`);
  } else if (brevoConf) {
    await addContactToTrialExpiredList({
      email: primary,
      restaurantName: data.config?.resto_name || resto.id,
      restaurantId: resto.id,
      city: data.ownerContact?.city || "",
      phone: data.ownerContact?.phone || "",
      trialExpiredAt: effectiveExpiredAt,
      deletionDate: new Date(Date.parse(effectiveExpiredAt) + TRIAL_DATA_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10),
      reactivationUrl: `https://brigado.solutions/${resto.id}`,
      lang: data.preferredLang === "en" ? "en" : "fr",
    }, brevoConf.apiKey, brevoConf.listId);
  }
}

async function markSubscriptionActive(customerId: string, reason: string): Promise<void> {
  const resto = await findRestaurantByCustomer(customerId);
  if (!resto) return;
  const data = resto.data();
  if (data.subscriptionStatus !== "trial_expired" && data.suspended !== true) return;
  await resto.ref.update({
    subscriptionStatus: "active",
    subscriptionStatusReason: reason,
    subscriptionStatusUpdatedAt: new Date().toISOString(),
    suspended: false,
    trialExpiredAt: FieldValue.delete(),
    finalNoticeSentAt: FieldValue.delete(),
  });
  logger.info(`Restaurant ${resto.id} reactivated (${reason})`);

  // Pull them out of the Brevo reminder sequence immediately — a
  // reactivated restaurant must not keep getting deletion warnings.
  const brevoConf = brevoConfig("trialExpired");
  const primary = primaryEmailOf(data);
  if (brevoConf && primary) {
    await removeContactFromTrialExpiredList(primary, "active", brevoConf.apiKey, brevoConf.listId);
  }
}

/** True if this customer has at least one paid invoice with real money on
 * it — i.e. they converted at some point and are not a failed trial. */
async function customerHasEverPaid(stripe: Stripe, customerId: string): Promise<boolean> {
  const invoices = await stripe.invoices.list({ customer: customerId, status: "paid", limit: 100 });
  return invoices.data.some(inv => inv.amount_paid > 0);
}

// ── TRIAL EXPIRY: reactivation (Stripe billing portal) ───────────────
// Called from the blocked screen AFTER the manager signs in there — the
// portal URL gives access to that customer's billing details, so it must
// never be handed out unauthenticated to anyone who knows the slug.
export const createBillingPortalSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { restaurantId } = request.data as { restaurantId?: string };
    if (!restaurantId) throw new HttpsError("invalid-argument", "restaurantId is required");
    await assertCallerIsManagerOf(request.auth?.uid, restaurantId);

    const restoSnap = await db.doc(`restaurants/${restaurantId}`).get();
    const customerId = restoSnap.data()?.stripeCustomerId;
    if (!customerId) {
      throw new HttpsError("failed-precondition", "No Stripe customer linked to this restaurant — contact support");
    }

    const stripe = new Stripe(stripeSecretKey.value());
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `https://brigado.solutions/${restaurantId}`,
    });
    logger.info(`Billing portal session created for ${restaurantId} by manager ${request.auth?.uid}`);
    return { url: session.url };
  }
);

// ── EMAIL (Resend) ───────────────────────────────────────────────────
// Uses plain fetch — no need for the resend npm package for this simple
// a use case. RESEND_API_KEY lives only in Secret Manager (see above),
// never in any file in this repo.
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Brigado <info@brigado.solutions>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error("Resend send failed", { status: res.status, body });
    // Throwing matters here: without it, every caller (including the
    // contact form and "send digest now" button) reports success to the
    // user regardless of whether the email actually went anywhere.
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

// ── WEEKLY DIGEST ─────────────────────────────────────────────────────
// PART 8 (Phase E/F follow-on) rebuild. Content is now shaped on the
// same rollup categories as operationsRollup.ts's Part 1 (hours worked,
// overtime, missing clock-ins, upcoming week's shift count, pending
// variance) — but this is NOT a straight import of that module.
// functions/ is a genuinely separate TS project from src/ (see "Stack &
// structure" in CLAUDE.md — reservedSlugs.ts is mirrored by hand for the
// same reason), so effectiveHours.ts's tolerance-aware shift-pairing and
// variance.ts's split-shift matcher cannot be called from here. What
// follows is a simplified, day-level PORT of the same categories,
// computed directly against Firestore: date+name presence (not
// per-shift time-pairing) for missing clock-ins, and a 15-minute-floor
// day-total delta (not variance.ts's per-component pairing) for pending
// variance. Good enough for a weekly count in an email; NOT a
// replacement for the app's own Variance tab or effectiveHours-backed
// screens, which remain the precise source of truth.

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

interface WeeklyDigestData {
  restoName: string;
  slug: string;
  lang: "fr" | "en";
  weekStartLabel: string;
  weekEndLabel: string;
  hoursWorked: number;
  overtimeHours: number;
  missingClockIns: number;
  upcomingWeekShiftCount: number;
  pendingVarianceCount: number;
  pendingTimeOffCount: number;
  claimedSwapCount: number;
}

async function buildDigestForRestaurant(slug: string): Promise<{ html: string; restoName: string } | null> {
  const restoSnap = await db.doc(`restaurants/${slug}`).get();
  if (!restoSnap.exists) return null;
  const restoData = restoSnap.data() || {};
  const config = restoData.config || {};
  const restoName = config.resto_name || slug;
  const staff: Array<{ name: string; contract?: number; active?: boolean }> = restoData.staff || [];
  const lang: "fr" | "en" = restoData.preferredLang === "en" ? "en" : "fr";

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = toDateStr(weekAgo);
  const todayStr = toDateStr(now);
  const weekAheadEnd = new Date(now);
  weekAheadEnd.setDate(weekAheadEnd.getDate() + 6);
  const weekAheadEndStr = toDateStr(weekAheadEnd);

  const [entriesSnap, scheduledSnap, approvalsSnap, timeOffSnap, swapSnap] = await Promise.all([
    db.collection(`restaurants/${slug}/entries`).get(),
    db.collection(`restaurants/${slug}/scheduledShifts`).get(),
    db.collection(`restaurants/${slug}/varianceApprovals`).get(),
    db.collection(`restaurants/${slug}/timeOffRequests`).where("status", "==", "pending").get(),
    db.collection(`restaurants/${slug}/swapRequests`).where("status", "==", "claimed").get(),
  ]);

  const entries = entriesSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as any);
  const scheduled = scheduledSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => d.data() as any);
  const approvedIds = new Set(approvalsSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => d.id));

  // Hours worked + overtime — RAW hours (same source the live Payroll
  // tab uses), not tolerance-adjusted effectiveHours, per the discipline
  // that effectiveHours is never wired into anything pay-adjacent
  // without validation (see Phase A in CLAUDE.md). "Overtime" here means
  // this restaurant's own per-employee contract threshold, same
  // getContractHours() definition used everywhere else, applied to the
  // last 7 days.
  const recentApproved = entries.filter((e: any) => e.status === "approved" && e.type === "worked" && e.date >= weekAgoStr && e.date <= todayStr);
  const hoursWorked = recentApproved.reduce((s: number, e: any) => s + (e.hours || 0), 0);
  const hoursByName: Record<string, number> = {};
  recentApproved.forEach((e: any) => { hoursByName[e.name] = (hoursByName[e.name] || 0) + (e.hours || 0); });
  const overtimeLimit = config.overtime_limit || 35;
  let overtimeHours = 0;
  for (const s of staff) {
    if (s.active === false) continue;
    const contract = s.contract || overtimeLimit;
    overtimeHours += Math.max(0, (hoursByName[s.name] || 0) - contract);
  }

  // Missing clock-ins: a scheduled shift in the past 7 days (excluding
  // today, which may still be in progress) with no worked entry at all
  // for that name+date — a true no-show by presence, not by per-shift
  // time-pairing (see module doc comment above).
  const workedKeys = new Set(entries.filter((e: any) => e.type === "worked").map((e: any) => `${e.name}__${e.date}`));
  const missingClockIns = scheduled.filter((s: any) => s.date >= weekAgoStr && s.date < todayStr && !workedKeys.has(`${s.name}__${s.date}`)).length;

  // Upcoming week's shift count: today through +6 days.
  const upcomingWeekShiftCount = scheduled.filter((s: any) => s.date >= todayStr && s.date <= weekAheadEndStr).length;

  // Pending variance: day-level scheduled-vs-worked hour delta over a
  // 15-minute floor (matching variance.ts's AUTO_APPROVE_THRESHOLD_
  // MINUTES in spirit, not the exact per-shift-component floor), with no
  // varianceApprovals doc on record. Doc id format —
  // `${date}__${encodeURIComponent(name)}` — matches
  // src/utils/variance.ts's varianceApprovalId() exactly (see CLAUDE.md).
  const scheduledHoursByKey: Record<string, number> = {};
  scheduled.forEach((s: any) => {
    const k = `${s.name}__${s.date}`;
    scheduledHoursByKey[k] = (scheduledHoursByKey[k] || 0) + (s.hours || 0);
  });
  const workedHoursByKey: Record<string, number> = {};
  entries.filter((e: any) => e.type === "worked" && e.status === "approved").forEach((e: any) => {
    const k = `${e.name}__${e.date}`;
    workedHoursByKey[k] = (workedHoursByKey[k] || 0) + (e.hours || 0);
  });
  let pendingVarianceCount = 0;
  for (const key of Object.keys(scheduledHoursByKey)) {
    if (!(key in workedHoursByKey)) continue;
    if (Math.abs(workedHoursByKey[key] - scheduledHoursByKey[key]) < 0.25) continue;
    const sepIdx = key.indexOf("__");
    const name = key.slice(0, sepIdx);
    const date = key.slice(sepIdx + 2);
    if (approvedIds.has(`${date}__${encodeURIComponent(name)}`)) continue;
    pendingVarianceCount++;
  }

  const dateFmt = (d: Date) => d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { day: "2-digit", month: "short" });
  const html = buildDigestHtml({
    restoName, slug, lang,
    weekStartLabel: dateFmt(weekAgo), weekEndLabel: dateFmt(now),
    hoursWorked, overtimeHours, missingClockIns, upcomingWeekShiftCount, pendingVarianceCount,
    pendingTimeOffCount: timeOffSnap.size, claimedSwapCount: swapSnap.size,
  });
  return { html, restoName };
}

/** Professional, inline-styled, table-based HTML — deliberately not
 * relying on <style>/@media, which many email clients strip. The header
 * logo (public/logo-email.png → served at brigado.solutions/logo-email.
 * png once deployed) has its own solid navy background BAKED INTO the
 * PNG, so it reads correctly regardless of the email client's own
 * background — sidesteps the light/dark-theme contrast problem the
 * in-app logo needed a second recolored asset for entirely, since email
 * has no equivalent of the app's theme toggle to react to. System font
 * stack only (no @font-face) for the same reliability reason. ~1 page:
 * one stat grid, two secondary lines, one CTA, one footer. */
function buildDigestHtml(d: WeeklyDigestData): string {
  const fr = d.lang === "fr";
  const stat = (label: string, value: string, accent = false) => `
    <td style="padding:14px 10px;text-align:center;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:${accent ? "#65a30d" : "#0f172a"};line-height:1.2;">${value}</div>
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;margin-top:4px;">${label}</div>
    </td>`;
  const spacer = `<td style="width:8px;"></td>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f6;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- HEADER — logo carries its own dark background, contrast-safe in any client -->
          <tr>
            <td style="background:#0a0e1a;padding:20px 24px;">
              <img src="https://brigado.solutions/logo-email.png" alt="Brigado" width="140" style="display:block;border:0;height:auto;" />
            </td>
          </tr>

          <!-- INTRO -->
          <tr>
            <td style="padding:28px 24px 8px 24px;">
              <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#65a30d;">
                ${fr ? "Résumé hebdomadaire" : "Weekly digest"}
              </div>
              <h1 style="font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;color:#0f172a;margin:6px 0 2px 0;">
                ${d.restoName}
              </h1>
              <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#64748b;margin:0;">
                ${d.weekStartLabel} – ${d.weekEndLabel}
              </p>
            </td>
          </tr>

          <!-- STAT GRID -->
          <tr>
            <td style="padding:16px 24px 4px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${stat(fr ? "Heures travaillées" : "Hours worked", `${d.hoursWorked.toFixed(1)}h`)}
                  ${spacer}
                  ${stat(fr ? "Heures sup." : "Overtime", `${d.overtimeHours.toFixed(1)}h`, d.overtimeHours > 0)}
                </tr>
                <tr><td colspan="3" style="height:8px;"></td></tr>
                <tr>
                  ${stat(fr ? "Pointages manqués" : "Missing clock-ins", String(d.missingClockIns), d.missingClockIns > 0)}
                  ${spacer}
                  ${stat(fr ? "Services — semaine prochaine" : "Shifts — next week", String(d.upcomingWeekShiftCount))}
                </tr>
                <tr><td colspan="3" style="height:8px;"></td></tr>
                <tr>
                  ${stat(fr ? "Écarts en attente" : "Pending variance", String(d.pendingVarianceCount), d.pendingVarianceCount > 0)}
                  ${spacer}
                  ${stat(fr ? "Congés en attente" : "Pending time off", String(d.pendingTimeOffCount))}
                </tr>
              </table>
            </td>
          </tr>

          ${d.claimedSwapCount > 0 ? `
          <tr>
            <td style="padding:16px 24px 0 24px;">
              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#92400e;">
                ${fr
                  ? `<b>${d.claimedSwapCount}</b> échange(s) de service en attente de votre décision.`
                  : `<b>${d.claimedSwapCount}</b> cover request(s) awaiting your decision.`}
              </div>
            </td>
          </tr>` : ""}

          <!-- CTA -->
          <tr>
            <td style="padding:24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#a3e635;border-radius:10px;">
                    <a href="https://brigado.solutions/${d.slug}"
                       style="display:inline-block;padding:12px 22px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:800;color:#0f172a;text-decoration:none;">
                      ${fr ? "Ouvrir Brigado →" : "Open Brigado →"}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:16px 24px 24px 24px;border-top:1px solid #e2e8f0;">
              <p style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#94a3b8;margin:0;line-height:1.5;">
                ${fr
                  ? "Chiffres estimés à titre indicatif — vérifiez dans l'app avant toute décision de paie."
                  : "Estimated figures for visibility only — verify in the app before any payroll decision."}
                <br />Brigado · brigado.solutions
              </p>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// Runs every Sunday at 20:00 Europe/Paris, across every restaurant that
// has set a digest_email in Settings.
export const weeklyDigestSchedule = onSchedule(
  { schedule: "0 20 * * 0", timeZone: "Europe/Paris", secrets: [resendApiKey] },
  async () => {
    const restaurantsSnap = await db.collection("restaurants").get();
    for (const doc of restaurantsSnap.docs) {
      const config = doc.data()?.config || {};
      if (!config.digest_email) continue;
      const digest = await buildDigestForRestaurant(doc.id);
      if (!digest) continue;
      try {
        await sendEmail(config.digest_email, `Brigado weekly digest — ${digest.restoName}`, digest.html);
      } catch (err) {
        logger.error(`Weekly digest failed to send for ${doc.id}`, err);
      }
    }
  }
);

// ── MESSAGE RETENTION ────────────────────────────────────────────────
// Brigado's private manager<->staff threads are for quick coordination,
// not a permanent chat archive — deleting anything older than 30 days
// keeps Firestore storage bounded as restaurants accumulate history.
// Announcements are deliberately NOT covered by this: they're closer to
// a bulletin board people may want to look back on, and are much lower
// volume than a two-way chat thread.
const MESSAGE_RETENTION_DAYS = 30;

export const cleanupOldMessages = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Europe/Paris" }, // daily at 3am
  async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MESSAGE_RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const restaurantsSnap = await db.collection("restaurants").get();
    for (const restoDoc of restaurantsSnap.docs) {
      const oldMessages = await db
        .collection(`restaurants/${restoDoc.id}/messages`)
        .where("sentAt", "<", cutoffIso)
        .get();
      if (oldMessages.empty) continue;

      const batch = db.batch();
      oldMessages.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      logger.info(`Deleted ${oldMessages.size} messages older than ${MESSAGE_RETENTION_DAYS} days for ${restoDoc.id}`);
    }
  }
);

// ── TRIAL EXPIRY: 30-DAY RETENTION & PURGE ───────────────────────────
// Tenants whose trial ended without converting keep their data fully
// intact for TRIAL_DATA_RETENTION_DAYS from trialExpiredAt, so a late
// reactivation restores everything. After that the tenant is permanently
// deleted — this is DISTINCT from the 5-year staff-record soft-archive
// policy, which applies only to restaurants with a live subscription.
//
// GDPR framing: for a customer who never converted there is no contract
// and no payroll-retention obligation on our side, so holding their
// staff PII indefinitely would itself be the compliance problem. 30 days
// with emailed warnings (the Brevo sequence) before erasure is the
// defensible middle.
//
// Note: this app stores nothing in Firebase Storage (verified — no
// storage SDK usage anywhere in src/ or functions/), so Firestore + Auth
// cleanup below IS the complete erasure.
const TRIAL_DATA_RETENTION_DAYS = 30;

// Reminder emails during the 30 days (including the final notice) are
// NOT sent from here anymore — they live in a Brevo automation built
// manually in the Brevo UI, triggered by list membership which
// markTrialExpired sets up the moment the trial expires. This job's only
// email-adjacent duty is taking the contact OFF that list at deletion.

export const purgeExpiredTrials = onSchedule(
  { schedule: "30 4 * * *", timeZone: "Europe/Paris", secrets: [stripeSecretKey, brevoApiKey] },
  async () => {
    const stripe = new Stripe(stripeSecretKey.value());
    const now = Date.now();

    // ── Comped tenants whose free period has run out ──────────────────
    // Runs BEFORE the purge sweep so a code that expired today enters the
    // pipeline on the same run, with a fresh 30-day clock. It only flips
    // the status; deletion is the ordinary path from there, unchanged.
    // Permanent comps (compedUntil === null) are skipped by construction.
    const compedSnap = await db.collection("restaurants").where("subscriptionStatus", "==", "comped").get();
    for (const resto of compedSnap.docs) {
      const until = resto.data().compedUntil;
      if (!until) continue; // permanent comp — never expires
      const untilMs = Date.parse(until);
      if (isNaN(untilMs)) {
        logger.error(`compedExpiry: ${resto.id} has an unparseable compedUntil ("${until}") — leaving alone, investigate manually`);
        continue;
      }
      if (untilMs > now) continue;
      await resto.ref.update({
        subscriptionStatus: "trial_expired",
        subscriptionStatusReason: `comped period ended ${until}`,
        subscriptionStatusUpdatedAt: new Date().toISOString(),
        suspended: true,
        trialExpiredAt: new Date().toISOString(),
        deletionReason: "comped_expired",
      });
      logger.warn(`compedExpiry: ${resto.id} comped period ended (${until}) — moved to trial_expired, 30-day clock started`);
    }

    // Single-field equality query — no composite index needed; the age
    // cutoff is applied in code (tenant counts are small).
    const expiredSnap = await db.collection("restaurants").where("subscriptionStatus", "==", "trial_expired").get();
    logger.info(`purgeExpiredTrials: ${expiredSnap.size} tenant(s) in trial_expired state`);

    for (const resto of expiredSnap.docs) {
      const slug = resto.id;
      const data = resto.data();
      const expiredAtMs = Date.parse(data.trialExpiredAt || "");
      if (isNaN(expiredAtMs)) {
        logger.error(`purgeExpiredTrials: ${slug} is trial_expired but has no valid trialExpiredAt — refusing to act, investigate manually`);
        continue;
      }
      const daysExpired = (now - expiredAtMs) / 86_400_000;
      if (daysExpired < TRIAL_DATA_RETENTION_DAYS) continue;

      // SAFETY: before deletion, re-check live Stripe state.
      // A missed/out-of-order webhook must never let us delete a paying
      // customer — the stored flag alone is not trusted this close to
      // deletion. Any Stripe error → skip this tenant, try again tomorrow.
      //
      // EXCEPTION: an admin-initiated deletion is a deliberate human
      // decision, so a still-live subscription is not evidence of a missed
      // webhook and must not resurrect the tenant. Without this, deleting
      // a paying business from the admin dashboard would be silently
      // undone on the next nightly run. The subscription itself is NOT
      // cancelled here — billing is ended in Stripe by hand, on purpose:
      // no dashboard button should move real money.
      if (data.deletionReason === "admin_delete") {
        logger.warn(`purgeExpiredTrials: ${slug} was deleted by admin ${data.deletionInitiatedBy || "?"} — skipping the Stripe restore check. If a subscription is still live it must be cancelled in Stripe manually.`);
      } else if (data.stripeCustomerId) {
        let subs: Stripe.ApiList<Stripe.Subscription>;
        try {
          subs = await stripe.subscriptions.list({ customer: data.stripeCustomerId, status: "all", limit: 100 });
        } catch (err) {
          logger.error(`purgeExpiredTrials: Stripe check failed for ${slug} — skipping this run`, err);
          continue;
        }
        const alive = subs.data.find(s => ["active", "trialing", "past_due"].includes(s.status));
        if (alive) {
          logger.warn(`purgeExpiredTrials: ${slug} flagged trial_expired but Stripe shows a "${alive.status}" subscription (${alive.id}) — missed webhook? Restoring access instead of deleting.`);
          await markSubscriptionActive(data.stripeCustomerId, `live Stripe re-check found ${alive.status} subscription during purge run`);
          continue;
        }
      } else {
        logger.warn(`purgeExpiredTrials: ${slug} has no stripeCustomerId — cannot double-check Stripe, proceeding on stored flag only`);
      }

      await purgeTenant(resto);
    }
  }
);

/** Writes the audit record, then irreversibly deletes the tenant:
 * every subcollection, the root doc, the managers/{uid} lookups, and
 * the manager Firebase Auth accounts (staff have no accounts — they
 * ride on anonymous auth, nothing to clean up there). */
async function purgeTenant(resto: FirebaseFirestore.QueryDocumentSnapshot): Promise<void> {
  const slug = resto.id;
  const data = resto.data();

  // Audit trail first (deliberately PII-light: no staff names, no
  // manager emails — just enough to answer "what was deleted, when,
  // and was the retention window respected").
  const subcollections = await resto.ref.listCollections();
  const docCounts: Record<string, number> = {};
  for (const col of subcollections) {
    docCounts[col.id] = (await col.count().get()).data().count;
  }
  const managersSnap = await db.collection("managers").where("restaurantId", "==", slug).get();
  await db.collection("deletionAudit").doc(`${slug}-${Date.now()}`).set({
    slug,
    restaurantName: data.config?.resto_name || slug,
    stripeCustomerId: data.stripeCustomerId || null,
    trialExpiredAt: data.trialExpiredAt,
    deletedAt: new Date().toISOString(),
    staffCount: (data.staff || []).length,
    managerAccountCount: managersSnap.size,
    subcollectionDocCounts: docCounts,
    reason: `trial_expired for ${TRIAL_DATA_RETENTION_DAYS}+ days without reactivation`,
    // How this tenant entered the pipeline. "admin_delete" = a human
    // pressed delete in the admin dashboard; "comped_expired" = a bonus
    // code's free period ran out; absent/"trial_expiry" = an ordinary
    // Stripe trial expiry. The retention window and mechanics are
    // identical in all three cases — this only records the origin.
    deletionReason: data.deletionReason || "trial_expiry",
    deletionInitiatedBy: data.deletionInitiatedBy || null,
  });
  logger.warn(`purgeExpiredTrials: DELETING tenant ${slug}`, { docCounts, managerAccounts: managersSnap.size });

  // End the Brevo reminder sequence for this tenant: off the Trial
  // Expired list, contact record kept (list-less, marked "deleted") as
  // the consent/compliance trail. Never blocks the Firestore purge.
  const brevoConf = brevoConfig("trialExpired");
  const primary = primaryEmailOf(data);
  if (brevoConf && primary) {
    await removeContactFromTrialExpiredList(primary, "deleted", brevoConf.apiKey, brevoConf.listId);
  }

  // Manager lookup docs + their Auth accounts (each uid maps to exactly
  // one restaurant, so these accounts serve no other tenant).
  for (const mgrDoc of managersSnap.docs) {
    await mgrDoc.ref.delete();
    try {
      await auth.deleteUser(mgrDoc.id);
    } catch (err) {
      logger.error(`purgeExpiredTrials: failed to delete auth user ${mgrDoc.id} for ${slug}`, err);
    }
  }

  // Root doc + all subcollections, whatever they are named — safer than
  // a hardcoded list if a future feature adds one.
  await db.recursiveDelete(resto.ref);
  logger.warn(`purgeExpiredTrials: tenant ${slug} deleted`);
}

// Callable from the app: a manager clicking "Email me this digest now"
// in Settings. Sends to whatever email they pass in, without waiting
// for Sunday.
export const sendDigestNow = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { slug, email } = request.data as { slug?: string; email?: string };
    if (!slug || !email) {
      throw new HttpsError("invalid-argument", "slug and email are required");
    }
    // PART 8: this previously had no caller check at all — any signed-in
    // (or, depending on client config, even unauthenticated) caller
    // could trigger a digest send to an arbitrary email for an arbitrary
    // slug. Closed using the same assertCallerIsManagerOf helper
    // inviteManager already relies on, rather than inventing a second
    // auth pattern.
    await assertCallerIsManagerOf(request.auth?.uid, slug);
    const digest = await buildDigestForRestaurant(slug);
    if (!digest) {
      throw new HttpsError("not-found", `No restaurant found for slug "${slug}"`);
    }
    try {
      await sendEmail(email, `Brigado weekly digest — ${digest.restoName}`, digest.html);
    } catch (err) {
      throw new HttpsError("internal", "Failed to send email — check Resend configuration");
    }
    return { sent: true };
  }
);

// Public contact form on the marketing site (no auth required — anyone
// visiting brigado.solutions/contact can use this, logged in or not).
const CONTACT_INBOX = "info@brigado.solutions";

export const submitContactForm = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { name, email, reason, reasonLabel, message } = request.data as {
      name?: string; email?: string; reason?: string; reasonLabel?: string; message?: string;
    };
    if (!name || !email || !message) {
      throw new HttpsError("invalid-argument", "name, email, and message are required");
    }
    const html = `
      <h2>New contact form submission</h2>
      <p><b>From:</b> ${name} (${email})</p>
      <p><b>Reason:</b> ${reasonLabel || reason || "—"}</p>
      <p><b>Message:</b></p>
      <p>${message.replace(/\n/g, "<br>")}</p>
    `;
    try {
      await sendEmail(CONTACT_INBOX, `[Brigado Contact] ${reasonLabel || reason || "New message"} — ${name}`, html);
    } catch (err) {
      throw new HttpsError("internal", "Failed to send — email service is temporarily unavailable");
    }
    return { sent: true };
  }
);

// ── MULTI-MANAGER ────────────────────────────────────────────────────
// managers/{uid} -> { restaurantId, email } already supports many
// managers per restaurant — this just adds a self-service way to invite
// one, instead of it only happening once via the Stripe webhook.

async function assertCallerIsManagerOf(authUid: string | undefined, restaurantId: string): Promise<void> {
  if (!authUid) throw new HttpsError("unauthenticated", "Must be signed in");
  const callerDoc = await db.doc(`managers/${authUid}`).get();
  if (!callerDoc.exists || callerDoc.data()?.restaurantId !== restaurantId) {
    throw new HttpsError("permission-denied", "You are not a manager of this restaurant");
  }
}

export const inviteManager = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { restaurantId, email } = request.data as { restaurantId?: string; email?: string };
    if (!restaurantId || !email) {
      throw new HttpsError("invalid-argument", "restaurantId and email are required");
    }
    await assertCallerIsManagerOf(request.auth?.uid, restaurantId);

    const restoRef = db.doc(`restaurants/${restaurantId}`);
    const restoSnap = await restoRef.get();
    if (!restoSnap.exists) throw new HttpsError("not-found", "Restaurant not found");
    const restoName = restoSnap.data()?.config?.resto_name || restaurantId;

    let user;
    let isNewUser = false;
    try {
      user = await auth.getUserByEmail(email);
    } catch {
      user = await auth.createUser({ email });
      isNewUser = true;
    }

    await db.doc(`managers/${user.uid}`).set({ restaurantId, email });
    await restoRef.update({ managerEmails: FieldValue.arrayUnion(email) });

    try {
      if (isNewUser) {
        const resetLink = await auth.generatePasswordResetLink(email);
        await sendEmail(
          email,
          `You've been added as a manager for ${restoName} on Brigado`,
          `<p>You now have manager access to "${restoName}" on Brigado.</p>
           <p>Set your password to log in: <a href="${resetLink}">${resetLink}</a></p>
           <p><a href="https://brigado.solutions/${restaurantId}">brigado.solutions/${restaurantId}</a></p>`
        );
      } else {
        await sendEmail(
          email,
          `You've been added as a manager for ${restoName} on Brigado`,
          `<p>You now have manager access to "${restoName}" on Brigado.</p>
           <p>Log in with your existing Brigado account at
           <a href="https://brigado.solutions/${restaurantId}">brigado.solutions/${restaurantId}</a>.</p>`
        );
      }
    } catch (err) {
      logger.error(`Manager "${email}" added to ${restaurantId} but invite email failed`, err);
    }

    return { added: true, email };
  }
);

export const removeManager = onCall(
  async (request) => {
    const { restaurantId, email } = request.data as { restaurantId?: string; email?: string };
    if (!restaurantId || !email) {
      throw new HttpsError("invalid-argument", "restaurantId and email are required");
    }
    await assertCallerIsManagerOf(request.auth?.uid, restaurantId);

    const restoRef = db.doc(`restaurants/${restaurantId}`);
    const restoSnap = await restoRef.get();
    const currentEmails: string[] = restoSnap.data()?.managerEmails || [];
    if (currentEmails.length <= 1) {
      throw new HttpsError("failed-precondition", "A restaurant must always have at least one manager");
    }

    let targetUser;
    try {
      targetUser = await auth.getUserByEmail(email);
    } catch {
      throw new HttpsError("not-found", "No account found for that email");
    }

    const targetDoc = await db.doc(`managers/${targetUser.uid}`).get();
    if (!targetDoc.exists || targetDoc.data()?.restaurantId !== restaurantId) {
      throw new HttpsError("not-found", "That person is not a manager of this restaurant");
    }

    await db.doc(`managers/${targetUser.uid}`).delete();
    await restoRef.update({ managerEmails: FieldValue.arrayRemove(email) });
    return { removed: true, email };
  }
);

// ── PLATFORM ADMIN (Site Manager dashboard) ──────────────────────────
// Everything below is gated by assertCallerIsPlatformAdmin, checked
// server-side on EVERY call. The /admin route's client-side guard is
// convenience only — it decides what to render, never what is
// permitted. platformAdmins is unreadable from the client (see
// firestore.rules), so the client cannot even enumerate admins.

/** Throws unless the caller is signed in AND their email has a
 * platformAdmins/{email} doc. The doc id is the lowercased email, so
 * this is a single get() rather than a query. Returns that email. */
async function assertCallerIsPlatformAdmin(
  auth_: { uid?: string; token?: Record<string, unknown> } | undefined,
): Promise<string> {
  const uid = auth_?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in");
  // Read the email from the VERIFIED ID token, never from request.data —
  // the token is signed by Firebase and cannot be forged by the caller.
  const email = String(auth_?.token?.email ?? "").trim().toLowerCase();
  if (!email) throw new HttpsError("permission-denied", "Not a platform admin");
  const adminDoc = await db.doc(`platformAdmins/${email}`).get();
  if (!adminDoc.exists) {
    logger.warn(`Platform admin check FAILED for uid=${uid} email=${email}`);
    throw new HttpsError("permission-denied", "Not a platform admin");
  }
  return email;
}

/** Cheap "am I an admin?" probe for the dashboard's route guard. Returns
 * a boolean instead of throwing so the client can render a clean
 * "not authorised" screen rather than an error state. */
export const adminWhoAmI = onCall(async (request) => {
  try {
    const email = await assertCallerIsPlatformAdmin(request.auth);
    return { isAdmin: true, email };
  } catch {
    return { isAdmin: false, email: null };
  }
});

/** Plan label for the Businesses list. Comped fields win over Stripe,
 * because a comped tenant has no subscription at all. */
function derivePlan(data: FirebaseFirestore.DocumentData): string {
  if (data.subscriptionStatus === "comped" || data.compedGrantedAt) {
    return data.compedUntil
      ? `Comped until ${String(data.compedUntil).slice(0, 10)}`
      : "Comped (permanent)";
  }
  if (data.stripePlan === "yearly" || data.stripePlan === "monthly") return data.stripePlan;
  return data.stripeCustomerId ? "Paid" : "Trial";
}

export const adminListBusinesses = onCall(async (request) => {
  await assertCallerIsPlatformAdmin(request.auth);
  const snap = await db.collection("restaurants").get();
  const businesses = snap.docs.map((d) => {
    const x = d.data();
    return {
      slug: d.id,
      name: x.config?.resto_name || d.id,
      city: x.ownerContact?.city || "",
      signupEmail: x.signupEmail || x.managerEmails?.[0] || "",
      // A tenant provisioned before subscriptionStatus existed reads as
      // "active", matching how the rules and App.tsx treat a missing field.
      status: x.subscriptionStatus || "active",
      plan: derivePlan(x),
      // createdAt is the canonical creation date (written by
      // provisionRestaurant since 2026-08-13, backfilled for older
      // tenants). compedGrantedAt is kept as a fallback because comped
      // tenants provisioned before createdAt existed only have that one.
      // Still null-able: a tenant that predates both and was never
      // backfilled has no creation date at all, and the Overview tab
      // counts those separately rather than guessing a date for them.
      joinedAt: x.createdAt || x.compedGrantedAt || null,
      lastActiveAt: x.lastActiveAt || null,
      trialExpiredAt: x.trialExpiredAt || null,
      pausedAt: x.pausedAt || null,
      pauseReason: x.pauseReason || null,
      compedUntil: x.compedUntil || null,
      compedVia: x.compedVia || null,
      staffCount: (x.staff || []).length,
      adminNotes: x.adminNotes || "",
      hasStripe: !!x.stripeCustomerId,
      deletionReason: x.deletionReason || null,
      logoUrl: x.logoUrl || null,
      logoConsentGiven: !!x.logoConsentGiven,
      logoApprovalStatus: x.logoApprovalStatus || null,
    };
  });
  return { businesses };
});

export const adminPauseBusiness = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const { slug, reason } = request.data as { slug?: string; reason?: string };
  if (!slug) throw new HttpsError("invalid-argument", "slug is required");

  const ref = db.doc(`restaurants/${slug}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Restaurant not found");
  const prior = snap.data()?.subscriptionStatus || "active";
  if (prior === "paused") throw new HttpsError("failed-precondition", "Already paused");

  await ref.update({
    subscriptionStatus: "paused",
    // Captured so resume restores the real prior state instead of
    // guessing "active" — a comped tenant must come back as comped.
    statusBeforePause: prior,
    pausedAt: new Date().toISOString(),
    pausedBy: adminEmail,
    pauseReason: reason || null,
    subscriptionStatusReason: `paused by admin ${adminEmail}`,
    subscriptionStatusUpdatedAt: new Date().toISOString(),
    // Deliberately NOT setting suspended:true. markSubscriptionActive()
    // reactivates anything with suspended===true, so mirroring the legacy
    // flag here would let a routine Stripe invoice.paid silently un-pause
    // an admin pause. Blocking for "paused" is driven by
    // subscriptionStatus alone, in both App.tsx and firestore.rules.
    suspended: false,
  });
  logger.warn(`ADMIN: ${adminEmail} paused ${slug} (was ${prior})`);
  return { ok: true, slug, previousStatus: prior };
});

export const adminResumeBusiness = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const { slug } = request.data as { slug?: string };
  if (!slug) throw new HttpsError("invalid-argument", "slug is required");

  const ref = db.doc(`restaurants/${slug}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Restaurant not found");
  const data = snap.data() || {};
  if (data.subscriptionStatus !== "paused") {
    throw new HttpsError("failed-precondition", "That business is not paused");
  }

  // Fall back to "active" only if the pause predates statusBeforePause.
  // Never resume INTO trial_expired: that would drop the tenant straight
  // back into the deletion pipeline on a stale clock. Such a tenant comes
  // back active and can be deleted deliberately if that is the intent.
  const restored =
    data.statusBeforePause && data.statusBeforePause !== "trial_expired"
      ? data.statusBeforePause
      : "active";

  await ref.update({
    subscriptionStatus: restored,
    subscriptionStatusReason: `resumed by admin ${adminEmail}`,
    subscriptionStatusUpdatedAt: new Date().toISOString(),
    suspended: false,
    statusBeforePause: FieldValue.delete(),
    pausedAt: FieldValue.delete(),
    pausedBy: FieldValue.delete(),
    pauseReason: FieldValue.delete(),
  });
  logger.warn(`ADMIN: ${adminEmail} resumed ${slug} -> ${restored}`);
  return { ok: true, slug, restoredTo: restored };
});

/** Admin delete does NOT delete anything immediately. It puts the tenant
 * into the SAME trial-expiry pipeline a real expiry uses: 30 days behind
 * the block screen, then purgeExpiredTrials erases it. That reuse is the
 * point — one deletion path, one retention guarantee, one audit trail,
 * nothing bespoke to get wrong. */
export const adminDeleteBusiness = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const { slug, confirmName } = request.data as { slug?: string; confirmName?: string };
  if (!slug) throw new HttpsError("invalid-argument", "slug is required");

  const ref = db.doc(`restaurants/${slug}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Restaurant not found");
  const data = snap.data() || {};
  const realName = data.config?.resto_name || slug;

  // Re-checked server-side: the typed-name confirmation is a real guard,
  // not just a UI speed bump.
  if ((confirmName || "").trim() !== String(realName).trim()) {
    throw new HttpsError("failed-precondition", "Typed name does not match the restaurant name");
  }
  if (data.subscriptionStatus === "trial_expired") {
    throw new HttpsError("failed-precondition", "That business is already pending deletion");
  }

  const nowISO = new Date().toISOString();
  await ref.update({
    subscriptionStatus: "trial_expired",
    trialExpiredAt: nowISO,
    suspended: true,
    subscriptionStatusReason: `deleted by admin ${adminEmail}`,
    subscriptionStatusUpdatedAt: nowISO,
    // Read by purgeExpiredTrials: tells the Stripe safety rail this is a
    // deliberate human decision, not a missed webhook, so a still-live
    // subscription must not resurrect the tenant. Both fields also ride
    // into the deletionAudit record written at purge time.
    deletionReason: "admin_delete",
    deletionInitiatedBy: adminEmail,
    statusBeforePause: FieldValue.delete(),
  });

  const purgeAfter = new Date(Date.now() + TRIAL_DATA_RETENTION_DAYS * 86_400_000).toISOString();
  logger.warn(`ADMIN: ${adminEmail} scheduled ${slug} for deletion (retention until ${purgeAfter.slice(0, 10)})`);
  if (data.stripeCustomerId) {
    logger.warn(`ADMIN: ${slug} still has Stripe customer ${data.stripeCustomerId} — the subscription is NOT cancelled automatically. Cancel it in Stripe if billing should stop.`);
  }
  return { ok: true, slug, deletionScheduledFor: purgeAfter, hadStripe: !!data.stripeCustomerId };
});

export const adminSetNotes = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const { slug, notes } = request.data as { slug?: string; notes?: string };
  if (!slug) throw new HttpsError("invalid-argument", "slug is required");
  await db.doc(`restaurants/${slug}`).update({ adminNotes: String(notes ?? "").slice(0, 4000) });
  logger.info(`ADMIN: ${adminEmail} updated notes on ${slug}`);
  return { ok: true };
});

/**
 * Approve or reject a manager-uploaded logo for the Landing page
 * carousel. This is the ONLY writer of `approvedLogos` — a logo is
 * genuinely public only once this has run with status "approved", and
 * un-approving/rejecting removes it from that collection immediately
 * (the underlying Storage file and the tenant doc's logoUrl are left
 * alone; only public exposure is toggled here).
 *
 * Requires the tenant to have actually given consent (logoConsentGiven)
 * — belt-and-suspenders on top of the client already blocking upload
 * without it; an admin action can never be the path that makes an
 * unconsented logo public.
 */
export const adminSetLogoApproval = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const { slug, status } = request.data as { slug?: string; status?: "approved" | "rejected" };
  if (!slug) throw new HttpsError("invalid-argument", "slug is required");
  if (status !== "approved" && status !== "rejected") {
    throw new HttpsError("invalid-argument", "status must be 'approved' or 'rejected'");
  }

  const restoRef = db.doc(`restaurants/${slug}`);
  const snap = await restoRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Restaurant not found");
  const data = snap.data() || {};

  if (status === "approved" && !data.logoConsentGiven) {
    throw new HttpsError("failed-precondition", "This tenant has not given consent to display their logo");
  }
  if (status === "approved" && !data.logoUrl) {
    throw new HttpsError("failed-precondition", "This tenant has no uploaded logo");
  }

  await restoRef.update({ logoApprovalStatus: status });

  const approvedLogoRef = db.doc(`approvedLogos/${slug}`);
  if (status === "approved") {
    await approvedLogoRef.set({
      slug,
      logoUrl: data.logoUrl,
      restaurantName: data.config?.resto_name || slug,
      approvedAt: new Date().toISOString(),
    });
  } else {
    await approvedLogoRef.delete();
  }

  logger.warn(`ADMIN: ${adminEmail} set logo approval for ${slug} to ${status}`);
  return { ok: true, slug, status };
});

// ── Admin management ─────────────────────────────────────────────────

export const adminListAdmins = onCall(async (request) => {
  await assertCallerIsPlatformAdmin(request.auth);
  const snap = await db.collection("platformAdmins").get();
  return {
    admins: snap.docs.map((d) => ({
      email: d.id,
      addedAt: d.data().addedAt || null,
      addedBy: d.data().addedBy || null,
    })),
  };
});

export const adminAddAdmin = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const raw = String((request.data as { email?: string })?.email ?? "").trim().toLowerCase();
  if (!raw || !raw.includes("@") || raw.length > 254) {
    throw new HttpsError("invalid-argument", "A valid email is required");
  }
  const ref = db.doc(`platformAdmins/${raw}`);
  if ((await ref.get()).exists) throw new HttpsError("already-exists", "That email is already an admin");
  await ref.set({ email: raw, addedAt: new Date().toISOString(), addedBy: adminEmail });
  logger.warn(`ADMIN: ${adminEmail} granted platform admin to ${raw}`);
  return { ok: true, email: raw };
});

// ── Bonus codes ──────────────────────────────────────────────────────

export const adminCreateBonusCode = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const { code, durationDays, maxRedemptions, note, expiresAt } = request.data as {
    code?: string;
    durationDays?: number | null;
    maxRedemptions?: number;
    note?: string;
    expiresAt?: string | null;
  };
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!normalized || normalized.length < 3 || !/^[A-Z0-9-]+$/.test(normalized)) {
    throw new HttpsError("invalid-argument", "Code must be 3+ characters, A-Z 0-9 and dashes only");
  }
  if (maxRedemptions !== undefined && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    throw new HttpsError("invalid-argument", "maxRedemptions must be a positive integer");
  }
  if (durationDays !== null && durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays < 1)) {
    throw new HttpsError("invalid-argument", "durationDays must be a positive integer, or null for permanent");
  }

  const ref = db.doc(`bonusCodes/${normalized}`);
  if ((await ref.get()).exists) throw new HttpsError("already-exists", "That code already exists");
  await ref.set({
    code: normalized,
    durationDays: durationDays ?? null, // null = permanent comp
    maxRedemptions: maxRedemptions ?? 1,
    redemptionCount: 0,
    active: true,
    expiresAt: expiresAt || null,
    note: note || "",
    createdAt: new Date().toISOString(),
    createdBy: adminEmail,
  });
  logger.warn(`ADMIN: ${adminEmail} created bonus code ${normalized}`);
  return { ok: true, code: normalized };
});

export const adminListBonusCodes = onCall(async (request) => {
  await assertCallerIsPlatformAdmin(request.auth);
  const snap = await db.collection("bonusCodes").get();
  return {
    codes: snap.docs.map((d) => {
      const x = d.data();
      return {
        code: d.id,
        durationDays: x.durationDays ?? null,
        maxRedemptions: x.maxRedemptions ?? 1,
        redemptionCount: x.redemptionCount ?? 0,
        active: x.active !== false,
        expiresAt: x.expiresAt || null,
        note: x.note || "",
        createdAt: x.createdAt || null,
        createdBy: x.createdBy || null,
      };
    }),
  };
});

export const adminToggleBonusCode = onCall(async (request) => {
  const adminEmail = await assertCallerIsPlatformAdmin(request.auth);
  const { code, active } = request.data as { code?: string; active?: boolean };
  if (!code || typeof active !== "boolean") {
    throw new HttpsError("invalid-argument", "code and active are required");
  }
  const ref = db.doc(`bonusCodes/${String(code).toUpperCase()}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Code not found");
  await ref.update({ active });
  logger.warn(`ADMIN: ${adminEmail} set ${code} active=${active}`);
  return { ok: true };
});

export const adminListRedemptions = onCall(async (request) => {
  await assertCallerIsPlatformAdmin(request.auth);
  const { code } = request.data as { code?: string };
  if (!code) throw new HttpsError("invalid-argument", "code is required");
  const snap = await db.collection(`bonusCodes/${String(code).toUpperCase()}/redemptions`).get();
  return {
    redemptions: snap.docs.map((d) => ({
      slug: d.id,
      redeemedAt: d.data().redeemedAt || null,
      restaurantName: d.data().restaurantName || d.id,
    })),
  };
});

/** Public callable used by the registration form's "I have a code" path.
 *
 * Concurrency: the slot is RESERVED inside a transaction — incrementing
 * the counter and writing the redemption doc together — before any
 * provisioning happens. Two simultaneous redemptions of a
 * maxRedemptions=1 code therefore cannot both win: the second
 * transaction re-reads the incremented count and fails. If provisioning
 * then throws, the reservation is rolled back so the slot is not burned.
 * (Incrementing only AFTER provisioning cannot be made concurrency-safe:
 * reserving the slot IS the increment.) */
export const redeemBonusCode = onCall(
  { secrets: [resendApiKey, brevoApiKey] },
  async (request) => {
    const { code, slug, restaurantName, email, contactName, phone, postcode, city, lang } =
      request.data as Record<string, string>;
    const normalized = String(code ?? "").trim().toUpperCase();
    if (!normalized) throw new HttpsError("invalid-argument", "A code is required");
    if (!slug || !restaurantName || !email) {
      throw new HttpsError("invalid-argument", "slug, restaurantName and email are required");
    }
    if (isReservedSlug(slug)) {
      throw new HttpsError("invalid-argument", "That address is reserved — please choose another");
    }
    if ((await db.doc(`restaurants/${slug}`).get()).exists) {
      throw new HttpsError("already-exists", "That address is already taken");
    }

    const codeRef = db.doc(`bonusCodes/${normalized}`);
    const nowISO = new Date().toISOString();

    // ── Reserve the slot atomically ──
    const reserved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(codeRef);
      if (!snap.exists) throw new HttpsError("not-found", "Unknown code");
      const c = snap.data() || {};
      if (c.active === false) throw new HttpsError("failed-precondition", "This code is no longer active");
      if (c.expiresAt && Date.parse(c.expiresAt) < Date.now()) {
        throw new HttpsError("failed-precondition", "This code has expired");
      }
      const count = c.redemptionCount ?? 0;
      const max = c.maxRedemptions ?? 1;
      if (count >= max) {
        throw new HttpsError("resource-exhausted", "This code has already been fully redeemed");
      }
      tx.update(codeRef, { redemptionCount: count + 1 });
      tx.set(codeRef.collection("redemptions").doc(slug), { redeemedAt: nowISO, restaurantName });
      return { durationDays: (c.durationDays ?? null) as number | null };
    });

    // ── Provision (outside the transaction: it creates Auth users and
    // sends email, neither of which can take part in one) ──
    const untilISO =
      reserved.durationDays === null
        ? null
        : new Date(Date.now() + reserved.durationDays * 86_400_000).toISOString();
    try {
      await provisionRestaurant(
        slug,
        restaurantName,
        email,
        contactName || "",
        phone || "",
        postcode || "",
        city || "",
        lang === "en" ? "en" : "fr",
        undefined, // no Stripe customer — this path never touches Stripe
        { via: normalized, untilISO },
      );
    } catch (err) {
      // Release the reservation so a failed provision does not silently
      // consume the last slot of a limited code.
      logger.error(`redeemBonusCode: provisioning failed for ${slug} with ${normalized} — releasing the reserved slot`, err);
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(codeRef);
          const count = snap.data()?.redemptionCount ?? 1;
          tx.update(codeRef, { redemptionCount: Math.max(0, count - 1) });
          tx.delete(codeRef.collection("redemptions").doc(slug));
        });
      } catch (rollbackErr) {
        logger.error(`redeemBonusCode: ROLLBACK FAILED for ${normalized}/${slug} — redemptionCount may be one too high, reconcile manually`, rollbackErr);
      }
      throw new HttpsError("internal", "Could not create the restaurant — nothing was charged. Please contact support.");
    }

    logger.warn(`Bonus code ${normalized} redeemed by ${slug} (comped until ${untilISO ?? "permanent"})`);
    return { ok: true, slug, compedUntil: untilISO };
  },
);
