// One-off setup: seeds the platformAdmins collection with the founding
// admins. Idempotent — re-running leaves existing docs alone (it never
// overwrites addedBy/addedAt, so a real admin who was later added by
// another admin does not get rewritten back to "seed").
//
// Uses the Admin SDK, which bypasses Firestore rules — intentional,
// since platformAdmins is fully locked to client access (see
// firestore.rules). There is deliberately no in-app path to create the
// FIRST admin; that would be a privilege-escalation hole.
//
//   node scripts/seed-platform-admins.mjs
//   node scripts/seed-platform-admins.mjs someone@else.com   (add one more)
//
// After the first two exist, further admins are added from the /admin
// dashboard's "Add admin" action, which is itself admin-gated.
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH ?? "./service-account.json";

// The founding pair. Application logic must NEVER hardcode these — every
// admin check reads platformAdmins at call time. They live here only
// because the collection has to be bootstrapped from somewhere.
const SEED_ADMINS = ["reix380@gmail.com", "info@brigado.solutions"];

const extra = process.argv.slice(2).filter(a => a.includes("@"));
const emails = (extra.length ? extra : SEED_ADMINS).map(e => e.trim().toLowerCase());

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

let created = 0;
let skipped = 0;
for (const email of emails) {
  // Doc id IS the lowercased email, so lookups are a direct get() with no
  // query — that is what makes the per-call admin check cheap.
  const ref = db.doc(`platformAdmins/${email}`);
  const snap = await ref.get();
  if (snap.exists) {
    console.log(`  = ${email} — already an admin (added ${snap.data().addedAt ?? "?"} by ${snap.data().addedBy ?? "?"}), left alone`);
    skipped++;
    continue;
  }
  await ref.set({
    addedAt: new Date().toISOString(),
    addedBy: extra.length ? "manual-script" : "seed",
    email,
  });
  console.log(`  + ${email} — added`);
  created++;
}

console.log(`\nplatformAdmins: ${created} created, ${skipped} already present.`);
const all = await db.collection("platformAdmins").get();
console.log(`Collection now holds ${all.size} admin(s): ${all.docs.map(d => d.id).join(", ")}`);
process.exit(0);
