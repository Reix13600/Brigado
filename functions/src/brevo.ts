import * as logger from "firebase-functions/logger";

// ── SHARED ───────────────────────────────────────────────────────────

/**
 * Upserts a contact onto a list. POST /v3/contacts with updateEnabled
 * is an upsert: firing it repeatedly for the same email updates the one
 * contact rather than duplicating, and adding a list never drops the
 * memberships the contact already has (so a converting prospect stays
 * on the outreach list while also joining the customer list).
 */
async function upsertContactOnList(
  email: string,
  listId: number,
  attributes: Record<string, string>,
  apiKey: string,
  context: string,
): Promise<void> {
  try {
    const res = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, updateEnabled: true, listIds: [listId], attributes }),
    });
    if (res.ok || res.status === 204) {
      logger.info(`Brevo: ${email} added/updated on list ${listId} (${context})`);
    } else {
      logger.error(`Brevo: failed to add ${email} to list ${listId} (${context}) — reconcile manually`, {
        status: res.status,
        body: await res.text(),
      });
    }
  } catch (err) {
    logger.error(`Brevo: error adding ${email} to list ${listId} (${context}) — reconcile manually`, err as Error);
  }
}

// ── JOINED LIST ("Joined - Brigado") ─────────────────────────────────
// Every restaurant that completes checkout lands here, keyed on the
// signup email. Fired from provisionRestaurant, so it only ever runs on
// a real successful signup — never on a failed/abandoned checkout.

export interface JoinedContact {
  email: string;
  restaurantName: string;
  restaurantId: string;
  city: string;   // "" for pre-city-field signups
  phone: string;  // "" when unknown
  lang: "fr" | "en";
  /** "paid" = normal Stripe checkout, "comped" = bonus-code signup. */
  signupType: "paid" | "comped";
}

export async function addContactToJoinedList(
  contact: JoinedContact,
  apiKey: string,
  listId: number,
): Promise<void> {
  await upsertContactOnList(
    contact.email,
    listId,
    {
      RESTAURANT_NAME: contact.restaurantName,
      RESTAURANT_ID: contact.restaurantId,
      CITY: contact.city,
      PHONE: contact.phone,
      LANG: contact.lang,
      SIGNUP_TYPE: contact.signupType,
      // Clears any stale marker left by a previous lifecycle of this
      // same email — e.g. someone whose earlier restaurant was purged
      // would otherwise still read SUBSCRIPTION_STATUS="deleted" here.
      SUBSCRIPTION_STATUS: contact.signupType === "comped" ? "comped" : "active",
    },
    apiKey,
    `joined: ${contact.restaurantId}`,
  );
}

// ── TRIAL-EXPIRED LIST ("Trial Expired - Brigado") ───────────────────
// The reminder-email cadence itself (content, timing, branching) lives
// entirely in Brevo's Automation Workflow Editor, built manually in the
// UI — Brevo does not expose automation workflows via API. Code is only
// responsible for list membership + attributes:
//   - trial expires  -> contact added to the list (triggers the automation)
//   - reactivates    -> removed from list + SUBSCRIPTION_STATUS="active"
//   - purged (day 30)-> removed from list + SUBSCRIPTION_STATUS="deleted"
// The contact record itself is never hard-deleted — a list-less contact
// marked "deleted" is the consent/compliance audit trail, and a later
// re-signup under the same email just updates it (updateEnabled: true).
//
// Every function here logs and swallows failures: Brevo being down must
// never block provisioning, reactivation, or the Firestore purge.

export interface TrialExpiredContact {
  email: string;
  restaurantName: string;
  restaurantId: string;
  city: string;      // "" when unknown (pre-city-field signups)
  phone: string;     // "" when unknown
  trialExpiredAt: string; // ISO
  deletionDate: string;   // YYYY-MM-DD, derived once from trialExpiredAt
  reactivationUrl: string;
  lang: "fr" | "en";
}

export async function addContactToTrialExpiredList(
  contact: TrialExpiredContact,
  apiKey: string,
  listId: number,
): Promise<void> {
  // Every attribute derives from trialExpiredAt, which is never reset by
  // repeated expiry events — so DELETION_DATE cannot drift if this fires
  // more than once for the same tenant.
  await upsertContactOnList(
    contact.email,
    listId,
    {
      RESTAURANT_NAME: contact.restaurantName,
      RESTAURANT_ID: contact.restaurantId,
      CITY: contact.city,
      PHONE: contact.phone,
      TRIAL_EXPIRED_DATE: contact.trialExpiredAt.slice(0, 10),
      DELETION_DATE: contact.deletionDate,
      REACTIVATION_URL: contact.reactivationUrl,
      LANG: contact.lang,
      SUBSCRIPTION_STATUS: "trial_expired",
    },
    apiKey,
    `trial expired: ${contact.restaurantId}`,
  );
}

/**
 * Pulls the contact off the Trial Expired list and stamps why
 * ("active" = reactivated, "deleted" = purged at day 30). Both the list
 * removal and the attribute change are exit signals a manually-built
 * Brevo automation can key on — removal is the critical one, so it runs
 * first and each step is reported independently.
 */
export async function removeContactFromTrialExpiredList(
  email: string,
  newStatus: "active" | "deleted",
  apiKey: string,
  listId: number,
): Promise<void> {
  try {
    const removeRes = await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}/contacts/remove`, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ emails: [email] }),
    });
    if (removeRes.ok) {
      logger.info(`Brevo: ${email} removed from Trial Expired list (-> ${newStatus})`);
    } else {
      const body = await removeRes.text();
      // "not in list / unknown contact" answers are fine (e.g. expiry
      // add failed earlier, or double-fired reactivation) — anything
      // else means a reactivated restaurant may keep getting deletion
      // warnings, which is exactly what must not happen silently.
      if (removeRes.status === 404 || body.includes("invalid_parameter")) {
        logger.info(`Brevo: ${email} was not on Trial Expired list, nothing to remove`);
      } else {
        logger.error(`Brevo: FAILED to remove ${email} from Trial Expired list — they may keep receiving deletion emails, reconcile manually`, {
          status: removeRes.status, body,
        });
      }
    }

    const attrRes = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
      method: "PUT",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: { SUBSCRIPTION_STATUS: newStatus } }),
    });
    if (attrRes.ok || attrRes.status === 204) {
      logger.info(`Brevo: ${email} SUBSCRIPTION_STATUS=${newStatus}`);
    } else if (attrRes.status === 404) {
      logger.info(`Brevo: ${email} has no contact record, skipping SUBSCRIPTION_STATUS update`);
    } else {
      logger.error(`Brevo: failed to set SUBSCRIPTION_STATUS=${newStatus} for ${email}`, {
        status: attrRes.status, body: await attrRes.text(),
      });
    }
  } catch (err) {
    logger.error(`Brevo: error removing ${email} from Trial Expired list — reconcile manually`, err as Error);
  }
}

// Marks a Brevo contact as converted (CONVERTED=true) at signup, so the
// cold-outreach cadence can exclude them once they start a trial.
//
// IMPORTANT — this only sets the flag; it does not by itself stop any
// email. The Brevo-side automation must actually test CONVERTED (as an
// entry filter, exit condition, or list-segment rule) for this to have
// any effect, and that logic is not readable via the API. See the Brevo
// section in CLAUDE.md before assuming a converting prospect is safe
// from further cold emails.
//
// Called from provisionRestaurant AFTER addContactToJoinedList, so the
// contact is guaranteed to exist by this point (organic signups included)
// and this never no-ops on a 404.
//
// Failures are logged but never thrown — marketing bookkeeping must not
// break restaurant provisioning.
export async function markBrevoContactConverted(
  email: string,
  apiKey: string,
): Promise<void> {
  try {
    const res = await fetch(
      `https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`,
      {
        method: "PUT",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ attributes: { CONVERTED: true } }),
      },
    );
    if (res.ok) {
      logger.info(`Brevo: marked ${email} as CONVERTED`);
    } else if (res.status === 404) {
      // Not in the prospect list (e.g. organic signup) — nothing to update.
      logger.info(`Brevo: contact ${email} not found, skipping CONVERTED flag`);
    } else {
      logger.warn(`Brevo: failed to mark ${email} as CONVERTED`, {
        status: res.status,
        body: await res.text(),
      });
    }
  } catch (err) {
    logger.warn(`Brevo: error marking ${email} as CONVERTED`, err as Error);
  }
}
