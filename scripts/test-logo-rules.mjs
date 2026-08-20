// Firestore + Storage emulator test for Part 3 (restaurant logo upload,
// consent, admin approval, public carousel). NOT part of `npm test` —
// needs both live emulators, same convention as the earlier rules
// tests (scripts/test-variance-rules.mjs, scripts/test-shift-templates-rules.mjs).
//
// Run with:
//   npx -y firebase-tools@latest emulators:exec --only firestore,storage "node scripts/test-logo-rules.mjs"
//
// Requires @firebase/rules-unit-testing (devDependency, supports both
// Firestore and Storage rules testing) and Java for the emulators.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getBytes } from "firebase/storage";

const PROJECT_ID = "brigado-logo-rules-test";
const RESTAURANT_ID = "la-vague-test";
const OTHER_RESTAURANT_ID = "other-resto-test";
const MANAGER_UID = "manager-uid-1";
const OTHER_MANAGER_UID = "manager-uid-2";

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
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc(`restaurants/${RESTAURANT_ID}`).set({ resto_name: "La Vague Test" });
    await db.doc(`restaurants/${OTHER_RESTAURANT_ID}`).set({ resto_name: "Other" });
    await db.doc(`managers/${MANAGER_UID}`).set({ restaurantId: RESTAURANT_ID, email: "manager@lavague.fr" });
    await db.doc(`managers/${OTHER_MANAGER_UID}`).set({ restaurantId: OTHER_RESTAURANT_ID, email: "manager@other.fr" });
    // Pre-seed one approved logo doc for the read checks below.
    await db.doc(`approvedLogos/${RESTAURANT_ID}`).set({
      slug: RESTAURANT_ID, logoUrl: "https://example.com/logo.png", restaurantName: "La Vague Test", approvedAt: new Date().toISOString(),
    });
  });

  const managerDb = testEnv.authenticatedContext(MANAGER_UID).firestore();
  const otherManagerDb = testEnv.authenticatedContext(OTHER_MANAGER_UID).firestore();
  const anonStaffDb = testEnv.authenticatedContext("anon-staff-uid").firestore();
  const unauthedDb = testEnv.unauthenticatedContext().firestore();

  console.log("\napprovedLogos (Firestore) — read access (needed for the public carousel):");
  await check("unauthenticated visitor CAN read the collection (carousel works for anonymous visitors)", async () => {
    await assertSucceeds(unauthedDb.collection("approvedLogos").get());
  });
  await check("unauthenticated visitor CAN read a single doc", async () => {
    await assertSucceeds(unauthedDb.doc(`approvedLogos/${RESTAURANT_ID}`).get());
  });
  await check("anonymous/staff signed-in session CAN also read (same public rule)", async () => {
    await assertSucceeds(anonStaffDb.collection("approvedLogos").get());
  });

  console.log("\napprovedLogos (Firestore) — write access (must be admin-callable ONLY, no client path):");
  await check("a manager of the SAME restaurant CANNOT write (no client write path at all)", async () => {
    await assertFails(
      managerDb.doc(`approvedLogos/${RESTAURANT_ID}`).set({ slug: RESTAURANT_ID, logoUrl: "https://evil.example/x.png", restaurantName: "Hacked", approvedAt: new Date().toISOString() })
    );
  });
  await check("a manager of a DIFFERENT restaurant CANNOT write", async () => {
    await assertFails(
      otherManagerDb.doc(`approvedLogos/${RESTAURANT_ID}`).set({ slug: RESTAURANT_ID, logoUrl: "https://evil.example/x.png", restaurantName: "Hacked", approvedAt: new Date().toISOString() })
    );
  });
  await check("an unauthenticated request CANNOT write", async () => {
    await assertFails(
      unauthedDb.doc(`approvedLogos/${RESTAURANT_ID}`).set({ slug: RESTAURANT_ID, logoUrl: "https://evil.example/x.png", restaurantName: "Hacked", approvedAt: new Date().toISOString() })
    );
  });
  await check("a manager CANNOT delete an approved-logo doc either", async () => {
    await assertFails(managerDb.doc(`approvedLogos/${RESTAURANT_ID}`).delete());
  });

  const managerStorage = testEnv.authenticatedContext(MANAGER_UID).storage();
  const otherManagerStorage = testEnv.authenticatedContext(OTHER_MANAGER_UID).storage();
  const anonStorage = testEnv.authenticatedContext("anon-staff-uid").storage();
  const unauthedStorage = testEnv.unauthenticatedContext().storage();

  const tinyPngBytes = Uint8Array.from(atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  ), c => c.charCodeAt(0));

  console.log("\nlogos/{uid}/* (Storage) — write access:");
  await check("a manager CAN upload into their OWN uid's logo path", async () => {
    await assertSucceeds(
      uploadBytes(ref(managerStorage, `logos/${MANAGER_UID}/logo-test.png`), tinyPngBytes, { contentType: "image/png" })
    );
  });
  await check("a DIFFERENT signed-in user CANNOT upload into someone else's uid path", async () => {
    await assertFails(
      uploadBytes(ref(otherManagerStorage, `logos/${MANAGER_UID}/logo-hack.png`), tinyPngBytes, { contentType: "image/png" })
    );
  });
  await check("an anonymous/staff session CANNOT upload into someone else's uid path", async () => {
    await assertFails(
      uploadBytes(ref(anonStorage, `logos/${MANAGER_UID}/logo-hack2.png`), tinyPngBytes, { contentType: "image/png" })
    );
  });
  await check("an unauthenticated request CANNOT upload", async () => {
    await assertFails(
      uploadBytes(ref(unauthedStorage, `logos/${MANAGER_UID}/logo-hack3.png`), tinyPngBytes, { contentType: "image/png" })
    );
  });
  await check("a non-image content type is REJECTED even for the right uid", async () => {
    await assertFails(
      uploadBytes(ref(managerStorage, `logos/${MANAGER_UID}/not-an-image.txt`), new TextEncoder().encode("hello"), { contentType: "text/plain" })
    );
  });

  console.log("\nlogos/{uid}/* (Storage) — read access (public, matches the app's download-URL pattern):");
  await check("an unauthenticated request CAN read an uploaded file", async () => {
    await assertSucceeds(getBytes(ref(unauthedStorage, `logos/${MANAGER_UID}/logo-test.png`)));
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
