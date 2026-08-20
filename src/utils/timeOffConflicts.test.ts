import { describe, it, expect } from "vitest";
import { findTimeOffConflict } from "./timeOffConflicts";
import { TimeOffRequest } from "../types";

const request = (overrides: Partial<TimeOffRequest> & Pick<TimeOffRequest, "staffName" | "startDate" | "endDate" | "status">): TimeOffRequest => ({
  id: `req-${Math.random()}`,
  reason: "",
  requestedAt: new Date().toISOString(),
  ...overrides,
});

describe("findTimeOffConflict — Part 6 (time-off awareness in rota planning)", () => {
  it("returns the request when the date falls inside an inclusive range", () => {
    const r = request({ staffName: "Reigo", startDate: "2026-08-20", endDate: "2026-08-25", status: "approved" });
    expect(findTimeOffConflict("Reigo", "2026-08-22", [r])).toBe(r);
  });

  it("range boundaries are inclusive on both ends", () => {
    const r = request({ staffName: "Reigo", startDate: "2026-08-20", endDate: "2026-08-25", status: "approved" });
    expect(findTimeOffConflict("Reigo", "2026-08-20", [r])).toBe(r);
    expect(findTimeOffConflict("Reigo", "2026-08-25", [r])).toBe(r);
  });

  it("one day outside the range on either side → no conflict", () => {
    const r = request({ staffName: "Reigo", startDate: "2026-08-20", endDate: "2026-08-25", status: "approved" });
    expect(findTimeOffConflict("Reigo", "2026-08-19", [r])).toBeNull();
    expect(findTimeOffConflict("Reigo", "2026-08-26", [r])).toBeNull();
  });

  it("a different employee's request never conflicts, even on the same date", () => {
    const r = request({ staffName: "Anthony", startDate: "2026-08-20", endDate: "2026-08-25", status: "approved" });
    expect(findTimeOffConflict("Reigo", "2026-08-22", [r])).toBeNull();
  });

  it("default statuses filter is ['approved'] — a pending or denied request for the same date does not conflict unless asked for", () => {
    const pending = request({ staffName: "Reigo", startDate: "2026-08-20", endDate: "2026-08-25", status: "pending" });
    const denied = request({ staffName: "Reigo", startDate: "2026-08-20", endDate: "2026-08-25", status: "denied" });
    expect(findTimeOffConflict("Reigo", "2026-08-22", [pending])).toBeNull();
    expect(findTimeOffConflict("Reigo", "2026-08-22", [denied])).toBeNull();
    expect(findTimeOffConflict("Reigo", "2026-08-22", [pending], ["pending"])).toBe(pending);
  });

  it("statuses param can widen or narrow which statuses count — e.g. checking for a heads-up flag on pending only", () => {
    const approved = request({ staffName: "Reigo", startDate: "2026-08-20", endDate: "2026-08-25", status: "approved" });
    expect(findTimeOffConflict("Reigo", "2026-08-22", [approved], ["pending"])).toBeNull();
    expect(findTimeOffConflict("Reigo", "2026-08-22", [approved], ["pending", "approved"])).toBe(approved);
  });

  it("a single-day request (startDate === endDate) still matches that exact day", () => {
    const r = request({ staffName: "Reigo", startDate: "2026-08-22", endDate: "2026-08-22", status: "approved" });
    expect(findTimeOffConflict("Reigo", "2026-08-22", [r])).toBe(r);
  });

  it("no requests at all → null, not a throw", () => {
    expect(findTimeOffConflict("Reigo", "2026-08-22", [])).toBeNull();
  });
});
