import * as logger from "firebase-functions/logger";

// Marks a Brevo contact as converted (CONVERTED=true) so the cold-outreach
// automation excludes them once they start a trial.
//
// Uses the REST API directly (Node 22 global fetch) — no Brevo SDK dependency
// in the functions bundle.
//
// Wiring it into the trial-start path (stripeWebhook in index.ts):
//   1. add brevoApiKey to the webhook's `secrets: [...]` array
//   2. after provisioning succeeds, call:
//        await markBrevoContactConverted(ownerEmail, brevoApiKey.value());
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
