// Manually mark a contact as converted (started a trial):
//
//   npx tsx scripts/brevo-mark-converted.ts someone@restaurant.fr
//
// The Cloud Functions equivalent (for automatic marking from the Stripe
// webhook) lives in functions/src/brevo.ts.
import { markContactConverted } from "./brevo";

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("Usage: npx tsx scripts/brevo-mark-converted.ts <email>");
  process.exit(1);
}

markContactConverted(email)
  .then(() => console.log(`${email}: CONVERTED=true`))
  .catch((err) => {
    console.error(`Failed to mark ${email} as converted:`, err);
    process.exit(1);
  });
