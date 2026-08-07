// Shared Brevo client for local scripts. SERVER-SIDE ONLY — never import
// from src/ (the Vite app): BREVO_API_KEY must never reach the browser bundle.
// Reads the key from .env (gitignored). Cloud Functions use their own helper
// in functions/src/brevo.ts with the BREVO_API_KEY secret instead.
import "dotenv/config";
import { BrevoClient } from "@getbrevo/brevo";

const apiKey = process.env.BREVO_API_KEY;
if (!apiKey) {
  throw new Error("BREVO_API_KEY is not set. Add it to .env at the repo root.");
}

export const brevo = new BrevoClient({ apiKey });

export const SENDER = { name: "Brigado", email: "info@brigado.solutions" };

/**
 * Marks a contact as converted (started a trial) so the Brevo automation
 * workflow can exclude them from further cold-outreach emails.
 * Requires the CONVERTED boolean attribute (created by brevo-setup-sequence.ts).
 */
export async function markContactConverted(email: string): Promise<void> {
  await brevo.contacts.updateContact({
    identifier: email,
    attributes: { CONVERTED: true },
  });
}
