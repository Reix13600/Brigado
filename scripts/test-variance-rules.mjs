// Firestore emulator test for the varianceApprovals rules added in
// Phase B (scheduling/payroll series). NOT part of `npm test` — needs a
// live emulator, same convention as the trial-expiry rules testing
// (CLAUDE.md's "Prefer testing security rules against the Firestore
// emulator" working-style note).
//
// Run with:
//   npx -y firebase-tools@latest emulators:exec --only firestore "node scripts/test-variance-rules.mjs"
//
// Requires @firebase/rules-unit-testing (devDependency) and Java for the
// emulator itself.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "brigado-variance-rules-test";
const RESTAURANT_ID = "la-vague-test";
const OTHER_RESTAURANT_ID = "other-resto-test";
const MANAGER_UID = "manager-uid-1";
const OTHER_MANAGER_UID = "manager-uid-2";
const APPROVAL_ID = "2026-08-10__Marie";

let passed = 0;
let failed = 0;

async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`    ${err.message}`);
  }
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });

  // Seed tenant docs and manager lookups with rules disabled — mirrors
  // how the Admin SDK (Stripe webhook, seed scripts) actually writes
  // this data in production, bypassing client rules entirely.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`restaurants/${RESTAURANT_ID}`).set({ resto_name: "La Vague Test" }); // no subscriptionStatus = legacy, not blocked
    await db.doc(`restaurants/${OTHER_RESTAURANT_ID}`).set({ resto_name: "Other" });
    await db.doc(`restaurants/${RESTAURANT_ID}-blocked`).set({ subscriptionStatus: "trial_expired" });
    await db.doc(`managers/${MANAGER_UID}`).set({ restaurantId: RESTAURANT_ID, email: "manager@lavague.fr" });
    await db.doc(`managers/${OTHER_MANAGER_UID}`).set({ restaurantId: OTHER_RESTAURANT_ID, email: "manager@other.fr" });
    // Pre-seed one approval doc for the invalidation check below.
    await db.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/${APPROVAL_ID}`).set({
      name: "Marie", date: "2026-08-10", approvedBy: "manager@lavague.fr", approvedAt: new Date().toISOString(),
    });
  });

  const managerDb = testEnv.authenticatedContext(MANAGER_UID).firestore();
  const otherManagerDb = testEnv.authenticatedContext(OTHER_MANAGER_UID).firestore();
  const anonStaffDb = testEnv.authenticatedContext("anon-staff-uid").firestore(); // simulates an anonymous staff session — still request.auth != null
  const unauthedDb = testEnv.unauthenticatedContext().firestore();

  console.log("\nvarianceApprovals — read access:");
  await check("manager of this restaurant CAN read the collection", async () => {
    await assertSucceeds(managerDb.collection(`restaurants/${RESTAURANT_ID}/varianceApprovals`).get());
  });
  await check("manager of this restaurant CAN read a single doc", async () => {
    await assertSucceeds(managerDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/${APPROVAL_ID}`).get());
  });
  await check("anonymous/staff signed-in session CANNOT read (manager-only, unlike other subcollections)", async () => {
    await assertFails(anonStaffDb.collection(`restaurants/${RESTAURANT_ID}/varianceApprovals`).get());
  });
  await check("unauthenticated request CANNOT read", async () => {
    await assertFails(unauthedDb.collection(`restaurants/${RESTAURANT_ID}/varianceApprovals`).get());
  });
  await check("a manager of a DIFFERENT restaurant CANNOT read this tenant's approvals (cross-tenant)", async () => {
    await assertFails(otherManagerDb.collection(`restaurants/${RESTAURANT_ID}/varianceApprovals`).get());
  });

  console.log("\nvarianceApprovals — write access:");
  await check("manager of this restaurant CAN approve a day (set)", async () => {
    await assertSucceeds(
      managerDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/2026-08-11__Marie`).set({
        name: "Marie", date: "2026-08-11", approvedBy: "manager@lavague.fr", approvedAt: new Date().toISOString(),
      })
    );
  });
  await check("anonymous/staff session CANNOT write", async () => {
    await assertFails(
      anonStaffDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/2026-08-12__Marie`).set({
        name: "Marie", date: "2026-08-12", approvedBy: "hacker", approvedAt: new Date().toISOString(),
      })
    );
  });
  await check("unauthenticated request CANNOT write", async () => {
    await assertFails(
      unauthedDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/2026-08-13__Marie`).set({
        name: "Marie", date: "2026-08-13", approvedBy: "nobody", approvedAt: new Date().toISOString(),
      })
    );
  });
  await check("a manager of a DIFFERENT restaurant CANNOT write into this tenant's approvals", async () => {
    await assertFails(
      otherManagerDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/2026-08-14__Marie`).set({
        name: "Marie", date: "2026-08-14", approvedBy: "wrong-manager", approvedAt: new Date().toISOString(),
      })
    );
  });
  await check("write is denied on a BLOCKED tenant (tenantBlocked) even for its own manager", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`managers/${MANAGER_UID}-blocked`).set({ restaurantId: `${RESTAURANT_ID}-blocked`, email: "m@x.fr" });
    });
    const blockedManagerDb = testEnv.authenticatedContext(`${MANAGER_UID}-blocked`).firestore();
    await assertFails(
      blockedManagerDb.doc(`restaurants/${RESTAURANT_ID}-blocked/varianceApprovals/2026-08-10__Marie`).set({
        name: "Marie", date: "2026-08-10", approvedBy: "m@x.fr", approvedAt: new Date().toISOString(),
      })
    );
  });

  console.log("\nvarianceApprovals — invalidation (delete on edit):");
  await check("manager CAN delete an approval doc (invalidateVarianceApproval's own operation)", async () => {
    await assertSucceeds(managerDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/${APPROVAL_ID}`).delete());
  });
  await check("after deletion, the doc no longer exists (day reverted to pending)", async () => {
    const snap = await managerDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/${APPROVAL_ID}`).get();
    if (snap.exists) throw new Error("approval doc still exists after delete");
  });
  await check("deleting an ALREADY-ABSENT approval doc is a harmless no-op (matches invalidateVarianceApproval being called unconditionally on every edit)", async () => {
    await assertSucceeds(managerDb.doc(`restaurants/${RESTAURANT_ID}/varianceApprovals/never-existed__Nobody`).delete());
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
