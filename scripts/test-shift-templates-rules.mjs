// Firestore emulator test for the shiftTemplates rules added in
// Phase D (scheduling/payroll series). NOT part of `npm test` — needs a
// live emulator, same convention as the varianceApprovals rules test
// this mirrors (scripts/test-variance-rules.mjs).
//
// Run with:
//   npx -y firebase-tools@latest emulators:exec --only firestore "node scripts/test-shift-templates-rules.mjs"
//
// Requires @firebase/rules-unit-testing (devDependency) and Java for the
// emulator itself.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "brigado-shift-templates-rules-test";
const RESTAURANT_ID = "la-vague-test";
const OTHER_RESTAURANT_ID = "other-resto-test";
const MANAGER_UID = "manager-uid-1";
const OTHER_MANAGER_UID = "manager-uid-2";
const TEMPLATE_ID = "template-test-1";

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

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`restaurants/${RESTAURANT_ID}`).set({ resto_name: "La Vague Test" });
    await db.doc(`restaurants/${OTHER_RESTAURANT_ID}`).set({ resto_name: "Other" });
    await db.doc(`restaurants/${RESTAURANT_ID}-blocked`).set({ subscriptionStatus: "trial_expired" });
    await db.doc(`managers/${MANAGER_UID}`).set({ restaurantId: RESTAURANT_ID, email: "manager@lavague.fr" });
    await db.doc(`managers/${OTHER_MANAGER_UID}`).set({ restaurantId: OTHER_RESTAURANT_ID, email: "manager@other.fr" });
    await db.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/${TEMPLATE_ID}`).set({
      id: TEMPLATE_ID, label: "Server – Lunch", startTime: "11:30", endTime: "15:00", createdAt: new Date().toISOString(),
    });
  });

  const managerDb = testEnv.authenticatedContext(MANAGER_UID).firestore();
  const otherManagerDb = testEnv.authenticatedContext(OTHER_MANAGER_UID).firestore();
  const anonStaffDb = testEnv.authenticatedContext("anon-staff-uid").firestore();
  const unauthedDb = testEnv.unauthenticatedContext().firestore();

  console.log("\nshiftTemplates — read access:");
  await check("manager of this restaurant CAN read the collection", async () => {
    await assertSucceeds(managerDb.collection(`restaurants/${RESTAURANT_ID}/shiftTemplates`).get());
  });
  await check("manager of this restaurant CAN read a single doc", async () => {
    await assertSucceeds(managerDb.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/${TEMPLATE_ID}`).get());
  });
  await check("anonymous/staff signed-in session CANNOT read (manager-only)", async () => {
    await assertFails(anonStaffDb.collection(`restaurants/${RESTAURANT_ID}/shiftTemplates`).get());
  });
  await check("unauthenticated request CANNOT read", async () => {
    await assertFails(unauthedDb.collection(`restaurants/${RESTAURANT_ID}/shiftTemplates`).get());
  });
  await check("a manager of a DIFFERENT restaurant CANNOT read this tenant's templates (cross-tenant)", async () => {
    await assertFails(otherManagerDb.collection(`restaurants/${RESTAURANT_ID}/shiftTemplates`).get());
  });

  console.log("\nshiftTemplates — write access:");
  await check("manager of this restaurant CAN add a template (set)", async () => {
    await assertSucceeds(
      managerDb.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/template-test-2`).set({
        id: "template-test-2", label: "Bar – Evening", startTime: "18:00", endTime: "23:00", createdAt: new Date().toISOString(),
      })
    );
  });
  await check("anonymous/staff session CANNOT write", async () => {
    await assertFails(
      anonStaffDb.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/template-test-3`).set({
        id: "template-test-3", label: "hacker", startTime: "00:00", endTime: "01:00", createdAt: new Date().toISOString(),
      })
    );
  });
  await check("unauthenticated request CANNOT write", async () => {
    await assertFails(
      unauthedDb.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/template-test-4`).set({
        id: "template-test-4", label: "nobody", startTime: "00:00", endTime: "01:00", createdAt: new Date().toISOString(),
      })
    );
  });
  await check("a manager of a DIFFERENT restaurant CANNOT write into this tenant's templates", async () => {
    await assertFails(
      otherManagerDb.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/template-test-5`).set({
        id: "template-test-5", label: "wrong-manager", startTime: "00:00", endTime: "01:00", createdAt: new Date().toISOString(),
      })
    );
  });
  await check("write is denied on a BLOCKED tenant (tenantBlocked) even for its own manager", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`managers/${MANAGER_UID}-blocked`).set({ restaurantId: `${RESTAURANT_ID}-blocked`, email: "m@x.fr" });
    });
    const blockedManagerDb = testEnv.authenticatedContext(`${MANAGER_UID}-blocked`).firestore();
    await assertFails(
      blockedManagerDb.doc(`restaurants/${RESTAURANT_ID}-blocked/shiftTemplates/template-test-6`).set({
        id: "template-test-6", label: "blocked", startTime: "00:00", endTime: "01:00", createdAt: new Date().toISOString(),
      })
    );
  });

  console.log("\nshiftTemplates — delete (a template is never consumed by a drag, only by an explicit delete):");
  await check("manager CAN delete a template", async () => {
    await assertSucceeds(managerDb.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/${TEMPLATE_ID}`).delete());
  });
  await check("anonymous/staff session CANNOT delete", async () => {
    await assertFails(anonStaffDb.doc(`restaurants/${RESTAURANT_ID}/shiftTemplates/template-test-2`).delete());
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
