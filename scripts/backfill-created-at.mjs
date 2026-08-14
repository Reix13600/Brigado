// One-off backfill: gives existing restaurants a `createdAt` they never had.
//
// WHY THIS EXISTS: provisionRestaurant did not write any creation
// timestamp until 2026-08-13, so every tenant provisioned before that has
// no signup date stored anywhere on its doc — which is why the admin
// dashboard's Businesses list showed "Joined —" and why the Overview
// tab's signups-over-time chart had no data source at all.
//
// SOURCE OF TRUTH used here: the earliest Firebase Auth `creationTime`
// among that restaurant's manager accounts. For a tenant provisioned by
// the Stripe webhook this is the same moment the restaurant doc was
// created (provisionRestaurant creates the Auth user and the doc in the
// same call), so it is an accurate reconstruction rather than a guess.
// It is still a PROXY though: if a manager account was created
// separately/later, or the original manager was deleted, the date can be
// off. Tenants where no manager Auth account survives are skipped and
// reported, never given a made-up date.
//
//   node scripts/backfill-created-at.mjs           # dry run, prints plan
//   node scripts/backfill-created-at.mjs --apply   # actually writes
//
// Idempotent: never overwrites an existing createdAt.
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const APPLY = process.argv.includes("--apply");
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT_PATH ?? "./service-account.json";

const sa = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const auth = getAuth();

console.log(`project: ${sa.project_id}`);
console.log(APPLY ? "MODE: APPLY (will write)\n" : "MODE: DRY RUN (no writes — pass --apply to commit)\n");

const restaurants = await db.collection("restaurants").get();
let wrote = 0, skippedHas = 0, skippedNoSource = 0;

for (const doc of restaurants.docs) {
  const d = doc.data();
  const slug = doc.id;

  if (d.createdAt) {
    console.log(`  = ${slug}: already has createdAt=${d.createdAt}, left alone`);
    skippedHas++;
    continue;
  }

  // A comped tenant provisioned before createdAt existed still has an
  // exact grant date — prefer that over the Auth proxy.
  let source = null, sourceLabel = "";
  if (d.compedGrantedAt) {
    source = d.compedGrantedAt;
    sourceLabel = "compedGrantedAt (exact)";
  } else {
    const mgrs = await db.collection("managers").where("restaurantId", "==", slug).get();
    const times = [];
    for (const m of mgrs.docs) {
      try {
        const u = await auth.getUser(m.id);
        if (u.metadata?.creationTime) times.push(new Date(u.metadata.creationTime).toISOString());
      } catch {
        // Auth account gone (purged tenant, manual deletion) — just skip it.
      }
    }
    if (times.length) {
      times.sort();
      source = times[0];
      sourceLabel = `earliest of ${times.length} manager Auth account(s) (proxy)`;
    }
  }

  if (!source) {
    console.log(`  ! ${slug}: NO usable source (no compedGrantedAt, no surviving manager Auth account) — skipped, left without a creation date`);
    skippedNoSource++;
    continue;
  }

  console.log(`  ${APPLY ? "+" : "~"} ${slug}: createdAt <- ${source}   [${sourceLabel}]`);
  if (APPLY) {
    await doc.ref.update({
      createdAt: source,
      // Marks this date as reconstructed rather than recorded at signup,
      // so nobody later mistakes a proxy for a precise signup timestamp.
      createdAtBackfilled: true,
    });
    wrote++;
  }
}

console.log(`\n${APPLY ? "wrote" : "would write"}: ${wrote || (APPLY ? 0 : restaurants.size - skippedHas - skippedNoSource)}`);
console.log(`already had createdAt: ${skippedHas}`);
console.log(`no usable source (skipped): ${skippedNoSource}`);
if (!APPLY) console.log("\nRe-run with --apply to commit these writes.");
