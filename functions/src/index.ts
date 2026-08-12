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
  stripeCustomerId?: string
): Promise<void> {
  const restoRef = db.doc(`restaurants/${slug}`);
  const existing = await restoRef.get();
  if (existing.exists) {
    logger.warn(`Restaurant "${slug}" already exists — skipping provisioning, just linking billing.`);
    // A blocked (trial_expired) restaurant re-subscribing through checkout
    // with its original slug lands here: relink billing and lift the block.
    const wasExpired = existing.data()?.subscriptionStatus === "trial_expired";
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
    subscriptionStatus: "active",
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

async function buildDigestForRestaurant(slug: string): Promise<{ html: string; restoName: string } | null> {
  const restoSnap = await db.doc(`restaurants/${slug}`).get();
  if (!restoSnap.exists) return null;
  const config = restoSnap.data()?.config || {};

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const entriesSnap = await db.collection(`restaurants/${slug}/entries`).get();
  const entries = entriesSnap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => d.data());
  const recentApproved = entries.filter((e: any) => e.status === "approved" && e.type === "worked" && new Date(e.date) >= weekAgo);
  const totalHours = recentApproved.reduce((s: number, e: any) => s + e.hours, 0);
  const flaggedCount = entries.filter((e: any) => e.flagged && new Date(e.date) >= weekAgo).length;
  const pendingCount = entries.filter((e: any) => e.status === "pending" || e.status === "correction").length;

  const timeOffSnap = await db.collection(`restaurants/${slug}/timeOffRequests`).where("status", "==", "pending").get();
  const swapSnap = await db.collection(`restaurants/${slug}/swapRequests`).where("status", "==", "claimed").get();

  const html = `
    <h2>Weekly digest — ${config.resto_name || slug}</h2>
    <ul>
      <li><b>${totalHours.toFixed(1)}h</b> approved hours in the last 7 days</li>
      <li><b>${flaggedCount}</b> flagged entries this week</li>
      <li><b>${pendingCount}</b> entries awaiting approval right now</li>
      <li><b>${timeOffSnap.size}</b> pending time-off requests</li>
      <li><b>${swapSnap.size}</b> cover requests awaiting your decision</li>
    </ul>
    <p><a href="https://brigado.solutions/${slug}">Open Brigado</a></p>
  `;
  return { html, restoName: config.resto_name || slug };
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
      if (data.stripeCustomerId) {
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
