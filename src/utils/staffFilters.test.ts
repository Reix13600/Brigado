import { describe, it, expect } from "vitest";
import { isActiveStaff, activeStaffOnly } from "./staffFilters";
import { StaffMember } from "../types";

const member = (name: string, active?: boolean): StaffMember => ({
  name, role: "server", rate: 15, contract: 35, pin: "1234",
  ...(active === undefined ? {} : { active }),
});

describe("isActiveStaff", () => {
  it("active: true is active", () => expect(isActiveStaff(member("A", true))).toBe(true));
  it("active: false is NOT active", () => expect(isActiveStaff(member("A", false))).toBe(false));
  it("active omitted defaults to active (legacy records predate the field)", () => expect(isActiveStaff(member("A"))).toBe(true));
});

describe("activeStaffOnly", () => {
  it("filters out archived staff, preserves order of the rest", () => {
    const staff = [member("Marie", true), member("Old", false), member("Anthony", true)];
    expect(activeStaffOnly(staff).map(s => s.name)).toEqual(["Marie", "Anthony"]);
  });

  it("does not mutate the input array", () => {
    const staff = Object.freeze([Object.freeze(member("Marie", true)), Object.freeze(member("Old", false))]);
    expect(() => activeStaffOnly(staff)).not.toThrow();
  });
});
