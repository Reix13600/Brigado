// One-off setup for the Brevo lists the Cloud Functions write to.
// Idempotent: re-running skips anything that already exists.
//
//   npx tsx scripts/brevo-setup-lists.ts
//
// Ensures:
//   - Contact list "Trial Expired - Brigado" (created if missing)
//   - Contact list "Joined - Brigado" (already exists; id resolved, not
//     recreated). Kept fully separate from the prospects list.
//   - Contact attributes the Cloud Functions write (see
//     functions/src/brevo.ts): RESTAURANT_NAME, RESTAURANT_ID, CITY,
//     PHONE, TRIAL_EXPIRED_DATE, DELETION_DATE, REACTIVATION_URL, LANG,
//     SUBSCRIPTION_STATUS
//   - Caches both ids as BREVO_TRIAL_EXPIRED_LIST_ID and
//     BREVO_JOINED_LIST_ID in functions/.env (the defineString params the
//     functions read at deploy time)
//
// The emails themselves (content, timing, branching, exit conditions)
// are built manually in Brevo's Automation Workflow Editor — Brevo does
// not expose automation workflows via API. Suggested exit condition for
// the trial-expired workflow: contact removed from that list OR
// SUBSCRIPTION_STATUS attribute no longer "trial_expired".
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { brevo } from "./brevo";

const TRIAL_EXPIRED_LIST = "Trial Expired - Brigado";
const JOINED_LIST = "Joined - Brigado";
// Same folder as the existing Brigado lists (prospects, Hot Leads, etc.).
const FOLDER_ID = 1;

const ATTRIBUTES = [
  { name: "RESTAURANT_NAME", type: "text" },
  { name: "RESTAURANT_ID", type: "text" },
  { name: "CITY", type: "text" },
  { name: "PHONE", type: "text" },
  { name: "TRIAL_EXPIRED_DATE", type: "date" },
  { name: "DELETION_DATE", type: "date" },
  { name: "REACTIVATION_URL", type: "text" },
  { name: "LANG", type: "text" },
  { name: "SUBSCRIPTION_STATUS", type: "text" },
  // "paid" (normal Stripe checkout) vs "comped" (bonus-code signup).
  { name: "SIGNUP_TYPE", type: "text" },
] as const;

async function ensureAttributes(): Promise<void> {
  const existing = await brevo.contacts.getAttributes();
  const existingNames = new Set(
    (existing.attributes ?? []).map((a) => (a.name ?? "").toUpperCase()),
  );
  for (const attr of ATTRIBUTES) {
    if (existingNames.has(attr.name)) {
      console.log(`attribute ${attr.name}: already exists, skipped`);
      continue;
    }
    await brevo.contacts.createAttribute({
      attributeCategory: "normal",
      attributeName: attr.name,
      type: attr.type,
    });
    console.log(`attribute ${attr.name}: created (${attr.type})`);
  }
}

async function findList(name: string): Promise<number | undefined> {
  // Paginate defensively even though the account has only a handful of lists.
  for (let offset = 0; ; offset += 50) {
    const page = await brevo.contacts.getLists({ limit: 50, offset });
    const lists = page.lists ?? [];
    const match = lists.find((l) => l.name === name);
    if (match?.id !== undefined) return match.id;
    if (lists.length < 50) return undefined;
  }
}

async function ensureList(name: string): Promise<number> {
  const existingId = await findList(name);
  if (existingId !== undefined) {
    console.log(`list "${name}": already exists, ID ${existingId}`);
    return existingId;
  }
  const created = await brevo.contacts.createList({ name, folderId: FOLDER_ID });
  console.log(`list "${name}": created, ID ${created.id}`);
  return created.id;
}

/** Upserts the given KEY=value lines into functions/.env, which is
 * gitignored — the Cloud Functions defineString params read it at deploy. */
function cacheEnv(entries: Record<string, number>): void {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "functions", ".env");
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    if (content.includes(`${key}=`)) {
      content = content.replace(new RegExp(`${key}=.*`, "g"), line);
    } else {
      content = content.trimEnd() + (content.trim() ? "\n" : "") + line + "\n";
    }
    console.log(`functions/.env: ${line}`);
  }
  writeFileSync(envPath, content, "utf8");
}

async function main(): Promise<void> {
  await ensureAttributes();
  const trialExpiredId = await ensureList(TRIAL_EXPIRED_LIST);
  const joinedId = await ensureList(JOINED_LIST);
  cacheEnv({
    BREVO_TRIAL_EXPIRED_LIST_ID: trialExpiredId,
    BREVO_JOINED_LIST_ID: joinedId,
  });
  console.log("\nDone. Build the reminder automation manually in the Brevo dashboard,");
  console.log(`triggered by contacts entering list ${trialExpiredId} ("${TRIAL_EXPIRED_LIST}").`);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
