import { RoleType, StaffMember } from "../types";

// ─────────────────────────────────────────────────────────────────────
// CSV staff import. Pure and framework-free (same discipline as
// effectiveHours.ts / variance.ts / timeOffConflicts.ts) so it can be
// unit-tested without rendering anything — see staffCsv.test.ts.
//
// Deliberately NEVER assigns a PIN. Imported staff land with pin: ""
// exactly like a manager who adds someone via the "+ Add employee"
// modal and leaves the PIN field blank. That matches current real
// behaviour: a staff member has no PIN until a manager sets one, and
// until then tapping their name on the staff page opens their section
// without a challenge. That is a known, accepted limitation of the
// existing trust model (see CLAUDE.md "Trust model") — importing does
// not change it, and must not silently paper over it either, which is
// why the PIN-reminder indicator exists alongside this.
// ─────────────────────────────────────────────────────────────────────

/** The fixed role set. Mirrors RoleType — kept here as a value (the type
 * alone can't be iterated at runtime) so validation and the UI's role
 * dropdown can't drift apart. */
export const ROLE_KEYS: RoleType[] = [
  "server", "kitchen", "cold", "dishwasher", "bar", "chef", "cleaner", "host", "other",
];

/** Accepted spellings per role, beyond the canonical key itself. A French
 * manager exports "Serveur" from their own spreadsheet, not "server", so
 * both the FR and EN labels are accepted. Compared accent- and
 * case-insensitively (see `normalize`), so "Plongeur"/"plongeur"/
 * "PLONGEUR" all match. */
const ROLE_ALIASES: Record<RoleType, string[]> = {
  server: ["serveur", "serveuse", "server", "waiter", "waitress", "salle"],
  kitchen: ["cuisine", "kitchen", "cuisinier", "commis"],
  cold: ["froid", "cold", "garde manger", "gardemanger"],
  dishwasher: ["plongeur", "plonge", "dishwasher", "dish"],
  bar: ["bar", "barman", "barmaid", "bartender"],
  chef: ["chef", "chef de cuisine", "head chef"],
  cleaner: ["agent d entretien", "agent dentretien", "entretien", "cleaner", "menage"],
  host: ["accueil", "host", "hostess", "hote", "hotesse"],
  other: ["autre", "other", "divers"],
};

/** Lowercases, strips accents and collapses punctuation/whitespace so
 * "Agent d'entretien", "agent d entretien" and "AGENT D’ENTRETIEN" all
 * compare equal. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’\-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_LOOKUP: Map<string, RoleType> = (() => {
  const m = new Map<string, RoleType>();
  for (const key of ROLE_KEYS) {
    m.set(normalize(key), key);
    for (const alias of ROLE_ALIASES[key]) m.set(normalize(alias), key);
  }
  return m;
})();

export function resolveRole(raw: string): RoleType | null {
  return ALIAS_LOOKUP.get(normalize(raw)) ?? null;
}

export interface ParsedStaffRow {
  name: string;
  role: RoleType;
  contract: number;
}

export interface StaffCsvError {
  /** 1-based line number in the ORIGINAL file, so the message points at
   * something the manager can actually find in their spreadsheet. */
  line: number;
  raw: string;
  reason: string;
}

export interface StaffCsvResult {
  rows: ParsedStaffRow[];
  errors: StaffCsvError[];
}

/** Splits one CSV line, honouring double-quoted fields (with "" escapes).
 * Accepts comma OR semicolon — French Excel writes semicolons by default,
 * and silently mis-parsing those would look like "the file is broken". */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}

function detectDelimiter(headerLine: string): string {
  const semis = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semis > commas ? ";" : ",";
}

const HEADER_HINTS = ["nom", "name", "role", "rôle", "poste", "contrat", "contract", "heures", "hours"];

/**
 * Parses a staff CSV with columns: Name, Role, Weekly contract hours.
 *
 * A leading header row is detected and skipped when its cells look like
 * headers rather than data (so a file without one still imports).
 *
 * NOTHING IS SILENTLY DROPPED. Every line that cannot be imported comes
 * back in `errors` with its original line number and a plain-language
 * reason — an unmatched role is reported, never coerced to "other".
 *
 * `existingNames` blocks collisions with staff who already exist; names
 * duplicated *within* the file are also rejected (second one onwards),
 * since the staff array is keyed by name throughout this app.
 */
export function parseStaffCsv(text: string, existingNames: readonly string[] = []): StaffCsvResult {
  const rows: ParsedStaffRow[] = [];
  const errors: StaffCsvError[] = [];

  const clean = text.replace(/^﻿/, ""); // strip BOM (Excel writes one)
  const lines = clean.split(/\r\n|\n|\r/);

  const firstNonEmpty = lines.findIndex(l => l.trim() !== "");
  if (firstNonEmpty === -1) return { rows, errors };

  const delimiter = detectDelimiter(lines[firstNonEmpty]);

  const firstCells = splitLine(lines[firstNonEmpty], delimiter).map(normalize);
  const looksLikeHeader = firstCells.some(c => HEADER_HINTS.includes(c));

  const seen = new Set(existingNames.map(n => normalize(n)));

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    if (i === firstNonEmpty && looksLikeHeader) continue;

    const line = i + 1;
    const cells = splitLine(raw, delimiter);
    const [nameRaw = "", roleRaw = "", contractRaw = ""] = cells;

    const name = nameRaw.trim();
    if (!name) {
      errors.push({ line, raw, reason: "Missing name" });
      continue;
    }
    if (seen.has(normalize(name))) {
      errors.push({ line, raw, reason: `"${name}" already exists (or is duplicated in this file)` });
      continue;
    }

    const role = resolveRole(roleRaw);
    if (!role) {
      errors.push({
        line, raw,
        reason: roleRaw.trim()
          ? `Unrecognised role "${roleRaw.trim()}"`
          : "Missing role",
      });
      continue;
    }

    const contract = Number(String(contractRaw).replace(",", "."));
    if (!contractRaw.trim() || !Number.isFinite(contract) || contract < 0 || contract > 60) {
      errors.push({
        line, raw,
        reason: contractRaw.trim()
          ? `Invalid contract hours "${contractRaw.trim()}" (expected 0–60)`
          : "Missing contract hours",
      });
      continue;
    }

    seen.add(normalize(name));
    rows.push({ name, role, contract });
  }

  return { rows, errors };
}

/** Turns parsed rows into real StaffMember records ready for saveStaff().
 * `rate` is not a CSV column (pay is sensitive and usually set per person
 * afterwards), so it starts at `defaultRate` — the same value the
 * "+ Add employee" modal defaults to. PIN is deliberately empty. */
export function toStaffMembers(rows: readonly ParsedStaffRow[], defaultRate: number): StaffMember[] {
  return rows.map(r => ({
    name: r.name,
    role: r.role,
    rate: defaultRate,
    contract: r.contract,
    pin: "",
    active: true,
  }));
}
