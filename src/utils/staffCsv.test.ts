import { describe, it, expect } from "vitest";
import { parseStaffCsv, resolveRole, toStaffMembers, ROLE_KEYS } from "./staffCsv";

describe("resolveRole — fixed role set, accent/case insensitive", () => {
  it("accepts the canonical RoleType keys", () => {
    for (const k of ROLE_KEYS) expect(resolveRole(k)).toBe(k);
  });

  it("accepts French labels a real manager would type", () => {
    expect(resolveRole("Serveur")).toBe("server");
    expect(resolveRole("Plongeur")).toBe("dishwasher");
    expect(resolveRole("Cuisine")).toBe("kitchen");
    expect(resolveRole("Accueil")).toBe("host");
  });

  it("is accent- and punctuation-insensitive", () => {
    expect(resolveRole("AGENT D'ENTRETIEN")).toBe("cleaner");
    expect(resolveRole("agent d entretien")).toBe("cleaner");
    expect(resolveRole("Ménage")).toBe("cleaner");
  });

  it("returns null for anything outside the fixed set — never coerces to 'other'", () => {
    expect(resolveRole("Sommelier")).toBeNull();
    expect(resolveRole("")).toBeNull();
    expect(resolveRole("manager")).toBeNull();
  });
});

describe("parseStaffCsv — happy path", () => {
  it("parses a comma file with a header row", () => {
    const csv = "Name,Role,Weekly contract hours\nMarie,Serveur,35\nPaul,Cuisine,30";
    const { rows, errors } = parseStaffCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([
      { name: "Marie", role: "server", contract: 35 },
      { name: "Paul", role: "kitchen", contract: 30 },
    ]);
  });

  it("parses a semicolon file (French Excel default)", () => {
    const csv = "Nom;Poste;Heures\nMarie;Serveur;35";
    const { rows, errors } = parseStaffCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0]).toEqual({ name: "Marie", role: "server", contract: 35 });
  });

  it("works with no header row at all", () => {
    const { rows, errors } = parseStaffCsv("Marie,Serveur,35");
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("strips a UTF-8 BOM and tolerates CRLF", () => {
    const csv = "﻿Name,Role,Hours\r\nMarie,Serveur,35\r\n";
    const { rows, errors } = parseStaffCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].name).toBe("Marie");
  });

  it("honours quoted fields containing the delimiter", () => {
    const csv = 'Name,Role,Hours\n"Dupont, Marie",Serveur,35';
    const { rows } = parseStaffCsv(csv);
    expect(rows[0].name).toBe("Dupont, Marie");
  });

  it("accepts a comma decimal in contract hours (French locale)", () => {
    const { rows } = parseStaffCsv("Marie;Serveur;17,5");
    expect(rows[0].contract).toBe(17.5);
  });

  it("skips blank lines without reporting them as errors", () => {
    const { rows, errors } = parseStaffCsv("Name,Role,Hours\nMarie,Serveur,35\n\n\nPaul,Cuisine,30\n");
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });
});

describe("parseStaffCsv — reports problems, never silently drops", () => {
  it("reports an unrecognised role with its real line number and keeps the good rows", () => {
    const csv = "Name,Role,Hours\nMarie,Serveur,35\nJean,Sommelier,35\nPaul,Cuisine,30";
    const { rows, errors } = parseStaffCsv(csv);
    expect(rows.map(r => r.name)).toEqual(["Marie", "Paul"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
    expect(errors[0].reason).toContain("Sommelier");
    expect(errors[0].raw).toContain("Jean");
  });

  it("reports a missing name", () => {
    const { errors } = parseStaffCsv("Name,Role,Hours\n,Serveur,35");
    expect(errors[0].reason).toBe("Missing name");
  });

  it("reports missing and invalid contract hours distinctly", () => {
    const { errors } = parseStaffCsv("Marie,Serveur,\nPaul,Cuisine,abc\nLuc,Bar,99");
    expect(errors).toHaveLength(3);
    expect(errors[0].reason).toBe("Missing contract hours");
    expect(errors[1].reason).toContain("Invalid contract hours");
    expect(errors[2].reason).toContain("0–60");
  });

  it("rejects a name that already exists in the restaurant", () => {
    const { rows, errors } = parseStaffCsv("Marie,Serveur,35", ["Marie"]);
    expect(rows).toHaveLength(0);
    expect(errors[0].reason).toContain("already exists");
  });

  it("rejects a name duplicated within the file itself (keeps the first)", () => {
    const { rows, errors } = parseStaffCsv("Marie,Serveur,35\nMarie,Cuisine,30");
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("server");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });

  it("an entirely empty file yields nothing at all, not a crash", () => {
    expect(parseStaffCsv("")).toEqual({ rows: [], errors: [] });
    expect(parseStaffCsv("\n\n  \n")).toEqual({ rows: [], errors: [] });
  });
});

describe("toStaffMembers — imported staff NEVER get a PIN", () => {
  it("produces active members with an empty pin and the default rate", () => {
    const { rows } = parseStaffCsv("Marie,Serveur,35\nPaul,Cuisine,30");
    const members = toStaffMembers(rows, 12);
    expect(members).toEqual([
      { name: "Marie", role: "server", rate: 12, contract: 35, pin: "", active: true },
      { name: "Paul", role: "kitchen", rate: 12, contract: 30, pin: "", active: true },
    ]);
    expect(members.every(m => m.pin === "")).toBe(true);
  });
});
