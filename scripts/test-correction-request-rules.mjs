// Firestore emulator test for the entries-update rule fix: staff can now
// move an ALREADY-APPROVED entry to `correction` status (the actual root
// cause of "manager never receives my correction request" — see the
// firestore.rules comment on this branch, and CLAUDE.md). NOT part of
// `npm test` — needs a live emulator, same convention as
// test-variance-rules.mjs / test-shift-templates-rules.mjs.
//
// Run with:
//   npx -y firebase-tools@latest emulators:exec --only firestore "node scripts/test-correction-request-rules.mjs"

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const PROJECT_ID = "brigado-correction-rules-test";
const RESTAURANT_ID = "la-vague-test";

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

const approvedEntry = {
  id: 1001, name: "Reigo", date: "2026-08-21", type: "worked", status: "approved",
  hours: 8, shifts: [{ startTime: "09:00", endTime: "17:00", hours: 8, overnight: false }],
  startTime: "09:00", endTime: "17:00", note: "", submittedAt: "2026-08-21T09:00:00.000Z",
};

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`restaurants/${RESTAURANT_ID}`).set({ resto_name: "La Vague Test" });
    await db.doc(`managers/manager-uid-1`).set({ restaurantId: RESTAURANT_ID, email: "manager@lavague.fr" });
  });

  const anonStaffCtx = testEnv.authenticatedContext("staff-anon-uid", {}); // real staff sessions are anonymous Firebase Auth, but the rules only check isSignedIn()
  const managerCtx = testEnv.authenticatedContext("manager-uid-1", {});
  const strangerCtx = testEnv.authenticatedContext("random-signed-in-uid", {}); // signed in, not a manager here

  const entryRef = (ctx) => doc(ctx.firestore(), `restaurants/${RESTAURANT_ID}/entries/1001`);

  // ── THE FIX: staff moving an APPROVED entry to correction ──────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`restaurants/${RESTAURANT_ID}/entries/1001`).set(approvedEntry);
  });
  await check("staff CAN move an approved entry to correction, changing only status/correctionNote/correctionAt", async () => {
    await assertSucceeds(setDoc(entryRef(anonStaffCtx), {
      ...approvedEntry, status: "correction", correctionNote: "Wrong hours, please check", correctionAt: "2026-08-25T10:00:00.000Z",
    }));
  });

  // Reset for the next check.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`restaurants/${RESTAURANT_ID}/entries/1001`).set(approvedEntry);
  });
  await check("staff CANNOT sneak an hours change into the same write that sets status=correction on an approved entry", async () => {
    await assertFails(setDoc(entryRef(anonStaffCtx), {
      ...approvedEntry, hours: 999, status: "correction", correctionNote: "nice try", correctionAt: "2026-08-25T10:00:00.000Z",
    }));
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`restaurants/${RESTAURANT_ID}/entries/1001`).set(approvedEntry);
  });
  await check("staff CANNOT change the shifts array while setting status=correction on an approved entry", async () => {
    await assertFails(setDoc(entryRef(anonStaffCtx), {
      ...approvedEntry, shifts: [{ startTime: "01:00", endTime: "23:00", hours: 22, overnight: false }],
      status: "correction", correctionNote: "nice try", correctionAt: "2026-08-25T10:00:00.000Z",
    }));
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`restaurants/${RESTAURANT_ID}/entries/1001`).set(approvedEntry);
  });
  await check("staff CANNOT change status straight to something other than correction on an approved entry", async () => {
    await assertFails(setDoc(entryRef(anonStaffCtx), { ...approvedEntry, status: "pending" }));
  });

  // ── REGRESSION: everything that worked before must still work ──────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`restaurants/${RESTAURANT_ID}/entries/1002`).set({ ...approvedEntry, id: 1002, status: "pending" });
  });
  await check("REGRESSION: staff can still edit their own pending entry (unaffected by the new branch)", async () => {
    const ref = doc(anonStaffCtx.firestore(), `restaurants/${RESTAURANT_ID}/entries/1002`);
    await assertSucceeds(setDoc(ref, { ...approvedEntry, id: 1002, status: "correction", correctionNote: "typo", correctionAt: "2026-08-25T10:00:00.000Z" }));
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`restaurants/${RESTAURANT_ID}/entries/1001`).set(approvedEntry);
  });
  await check("REGRESSION: staff still CANNOT edit hours on an approved entry outside the correction path", async () => {
    await assertFails(setDoc(entryRef(anonStaffCtx), { ...approvedEntry, hours: 12 }));
  });

  await check("manager CAN update an approved entry however they like (unaffected)", async () => {
    await assertSucceeds(setDoc(entryRef(managerCtx), { ...approvedEntry, hours: 7.5 }));
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(`restaurants/${RESTAURANT_ID}/entries/1001`).set(approvedEntry);
  });
  await check("a signed-in-but-not-a-manager-of-this-tenant stranger can still request a correction (pre-existing PIN-trust model, unaffected)", async () => {
    // Documents the existing trust model: entries rules identify "staff"
    // by isSignedIn() only (PIN enforces identity inside the app, not
    // Firebase Auth) — this test exists to prove the FIX doesn't
    // ACCIDENTALLY narrow that further, not to claim it's newly secure.
    await assertSucceeds(setDoc(entryRef(strangerCtx), {
      ...approvedEntry, status: "correction", correctionNote: "x", correctionAt: "2026-08-25T10:00:00.000Z",
    }));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
