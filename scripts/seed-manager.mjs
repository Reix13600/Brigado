// One-time setup script: creates (or reuses) a Firebase Auth user for the
// manager and registers them as an authorized manager for RESTAURANT_ID.
//
// This uses the Admin SDK, which bypasses Firestore security rules —
// that's intentional, since the rules explicitly forbid writing to
// managers/{uid} from the client (see firestore.rules).
//
// Setup:
//   1. Firebase Console -> Project settings -> Service accounts
//      -> "Generate new private key" -> save the JSON file somewhere safe,
//      e.g. ./service-account.json (do NOT commit this file).
//   2. npm install --save-dev firebase-admin
//   3. Run:
//      node scripts/seed-manager.mjs manager@lavaguerestaurant.fr "a-strong-password"
//
// Re-running with the same email is safe — it just updates the password
// and confirms the managers/{uid} doc exists.

import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const RESTAURANT_ID = "la-vague";
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH ?? "./service-account.json";

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error("Usage: node scripts/seed-manager.mjs <email> <password>");
  process.exit(1);
}
if (password.length < 6) {
  console.error("Firebase requires passwords to be at least 6 characters.");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const db = getFirestore();

async function main() {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password });
    console.log(`Existing user found, password updated: ${email} (${user.uid})`);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await auth.createUser({ email, password });
    console.log(`Created new manager account: ${email} (${user.uid})`);
  }

  await db.doc(`managers/${user.uid}`).set({ restaurantId: RESTAURANT_ID, email });
  console.log(`Granted manager access to restaurant "${RESTAURANT_ID}".`);

  // Make sure the restaurant doc exists so the app doesn't seed placeholder
  // defaults on first load.
  const restoRef = db.doc(`restaurants/${RESTAURANT_ID}`);
  const restoSnap = await restoRef.get();
  if (!restoSnap.exists) {
    await restoRef.set({
      config: {
        resto_name: "La Vague",
        manager_pin: "1234",
        overtime_limit: 35,
        tax_rate: 22,
        approval_required: true,
        bookkeeper_email: "",
        sheet_url: "",
        enable_scheduling: true,
        compliance_enforced: true,
      },
      staff: [],
      dayNotes: {},
      weekNotes: {},
    });
    console.log(`Created restaurants/${RESTAURANT_ID} with empty staff list — add staff from the manager dashboard.`);
  } else {
    console.log(`restaurants/${RESTAURANT_ID} already exists — left untouched.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
