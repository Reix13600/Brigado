import { describe, it, expect } from "vitest";
import { formatTime24 } from "./timeFormat";

describe("formatTime24", () => {
  it("formats an afternoon time as 24h, never AM/PM", () => {
    // 15:00 UTC — use a fixed offset-free ISO string with an explicit Z
    // and account for the local zone by constructing from parts instead,
    // so this test is stable regardless of the machine's timezone.
    const d = new Date(2026, 7, 21, 15, 0); // 21 Aug 2026, 15:00 local
    expect(formatTime24(d)).toBe("15:00");
  });

  it("formats midnight and near-midnight without AM/PM markers", () => {
    expect(formatTime24(new Date(2026, 7, 21, 0, 5))).toBe("00:05");
    expect(formatTime24(new Date(2026, 7, 21, 23, 59))).toBe("23:59");
  });

  it("accepts an ISO string directly, not just a Date object", () => {
    const iso = new Date(2026, 7, 21, 9, 30).toISOString();
    expect(formatTime24(iso)).toBe(formatTime24(new Date(iso)));
  });

  it("never contains AM/PM markers regardless of hour", () => {
    for (let h = 0; h < 24; h++) {
      const result = formatTime24(new Date(2026, 7, 21, h, 0));
      expect(result.toUpperCase()).not.toMatch(/AM|PM/);
    }
  });
});
