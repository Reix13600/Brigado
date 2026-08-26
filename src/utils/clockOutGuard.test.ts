import { describe, it, expect } from "vitest";
import { computeElapsedHours, IMPLAUSIBLE_DURATION_THRESHOLD_HOURS } from "./clockOutGuard";

describe("computeElapsedHours", () => {
  it("computes a plain elapsed duration in hours", () => {
    const clockInAt = "2026-08-21T09:00:00.000Z";
    const now = new Date("2026-08-21T17:00:00.000Z");
    expect(computeElapsedHours(clockInAt, now)).toBeCloseTo(8, 5);
  });

  it("floors at 0 for a clock-in timestamp in the future (clock skew), never negative", () => {
    const clockInAt = "2026-08-21T17:00:00.000Z";
    const now = new Date("2026-08-21T09:00:00.000Z");
    expect(computeElapsedHours(clockInAt, now)).toBe(0);
  });

  it("defaults `now` to the current time when not supplied", () => {
    const clockInAt = new Date(Date.now() - 3600000).toISOString();
    expect(computeElapsedHours(clockInAt)).toBeCloseTo(1, 1);
  });

  it("does not mutate anything — repeat calls are identical", () => {
    const clockInAt = "2026-08-21T09:00:00.000Z";
    const now = new Date("2026-08-21T17:00:00.000Z");
    expect(computeElapsedHours(clockInAt, now)).toBe(computeElapsedHours(clockInAt, now));
  });
});

describe("IMPLAUSIBLE_DURATION_THRESHOLD_HOURS boundary — under/at/over", () => {
  const clockInAt = "2026-08-21T00:00:00.000Z";
  const at = (hours: number) => new Date(new Date(clockInAt).getTime() + hours * 3600000);

  it("UNDER threshold (15.9h) does not exceed it", () => {
    const hours = computeElapsedHours(clockInAt, at(15.9));
    expect(hours).toBeLessThan(IMPLAUSIBLE_DURATION_THRESHOLD_HOURS);
  });

  it("AT threshold (exactly 16h) does not exceed it — the UI check is a strict `>`, so exactly-16h does not warn", () => {
    const hours = computeElapsedHours(clockInAt, at(16));
    expect(hours).toBeCloseTo(IMPLAUSIBLE_DURATION_THRESHOLD_HOURS, 5);
    expect(hours > IMPLAUSIBLE_DURATION_THRESHOLD_HOURS).toBe(false);
  });

  it("OVER threshold (16.1h) exceeds it", () => {
    const hours = computeElapsedHours(clockInAt, at(16.1));
    expect(hours).toBeGreaterThan(IMPLAUSIBLE_DURATION_THRESHOLD_HOURS);
  });

  it("a real double-shift (e.g. 18h) still exceeds it — this only WARNS, saving is never blocked at this layer", () => {
    const hours = computeElapsedHours(clockInAt, at(18));
    expect(hours).toBeGreaterThan(IMPLAUSIBLE_DURATION_THRESHOLD_HOURS);
  });

  it("the actual Reigo production anomaly (95.26h) is comfortably over the threshold", () => {
    const hours = computeElapsedHours(clockInAt, at(95.26));
    expect(hours).toBeGreaterThan(IMPLAUSIBLE_DURATION_THRESHOLD_HOURS);
  });
});
