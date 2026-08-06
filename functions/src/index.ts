import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import Stripe from "stripe";

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
// Not bound to any function yet — add to a function's `secrets: [...]` array
// when Brevo automation lands. Exported so future function files can reuse it.
export const brevoApiKey = defineSecret("BREVO_API_KEY");

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
// subscribe it to at least: checkout.session.completed, customer.subscription.deleted
export const stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret], cors: false },
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
        // New format: slug|name|contactName|phone|postcode (pipe-delimited,
        // each part URI-encoded). Falls back to the old "slug::name" format
        // so any in-flight checkout links from before this change still work.
        let slug: string, restaurantName: string, contactName: string, phone: string, postcode: string;
        if (ref.includes("|")) {
          const parts = ref.split("|").map(p => { try { return decodeURIComponent(p); } catch { return p; } });
          [slug, restaurantName, contactName, phone, postcode] = parts;
        } else {
          [slug, restaurantName] = ref.split("::");
          contactName = ""; phone = ""; postcode = "";
        }
        const email = session.customer_details?.email;

        if (!slug || !email) {
          logger.error("Missing slug or email on checkout session", { ref, email });
          res.status(200).send("Missing data, nothing provisioned");
          return;
        }

        await provisionRestaurant(slug, restaurantName || slug, email, contactName || "", phone || "", postcode || "", session.customer as string);
        logger.info(`Provisioned restaurant "${slug}" for ${email}`);
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const snap = await db.collection("restaurants").where("stripeCustomerId", "==", customerId).limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({ suspended: true, suspendedAt: new Date().toISOString() });
          logger.info(`Suspended restaurant ${snap.docs[0].id} after subscription cancellation`);
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
  stripeCustomerId?: string
): Promise<void> {
  const restoRef = db.doc(`restaurants/${slug}`);
  const existing = await restoRef.get();
  if (existing.exists) {
    logger.warn(`Restaurant "${slug}" already exists — skipping provisioning, just linking billing.`);
    if (stripeCustomerId) await restoRef.update({ stripeCustomerId });
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
    managerEmails: [email],
    // Administrative contact info collected at signup — kept separate
    // from `config` (which is app-behavior settings, not metadata).
    ownerContact: { contactName, phone, postcode },
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
}

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
