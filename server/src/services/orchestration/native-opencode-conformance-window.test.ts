import { describe, expect, it } from "vitest";
import {
  assertNativeOpenCodeConformanceProbeWindow, nativeOpenCodeConformanceHarnessBudgets, nativeOpenCodeConformanceProbeDeadline,
  NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS, NATIVE_OPENCODE_CONFORMANCE_PROBE_COUNT,
  NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS,
} from "./native-opencode-conformance-window.js";

// CONF15-P5 (the CONF15-P4 next stop): six serial managed probes outlived one shared 300 s plan
// window. Each probe now has its own window inside the group total.
const now = new Date("2026-11-16T12:00:00.000Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
type WindowInput = Parameters<typeof assertNativeOpenCodeConformanceProbeWindow>[0];
const window = (planStartedAgo: number, probeStartedAgo: number,
  planWallClockSeconds = NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS): WindowInput =>
  ({ planStartedAt: ago(planStartedAgo), planWallClockSeconds, probeStartedAt: ago(probeStartedAgo), now });
const open = (input: WindowInput) => {
  try { assertNativeOpenCodeConformanceProbeWindow(input); return true; } catch { return false; }
};

describe("managed OpenCode qualification wall-clock window", () => {
  it("is one per-probe limit per probe, and the group total is the probe count times it", () => {
    expect(NATIVE_OPENCODE_CONFORMANCE_PROBE_COUNT).toBe(6);
    expect(NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS).toBe(300);
    expect(NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS).toBe(6 * 300);
  });

  it("gives each harness plan the group total and nothing else new", () => {
    // The cost ceiling is the caller's quote, unchanged; no tools, retries or delegation.
    expect(nativeOpenCodeConformanceHarnessBudgets(12)).toEqual({ maxModelCostMinor: 12, maxToolActions: 0,
      maxWallClockSeconds: NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS, maxRetries: 0, maxDelegationDepth: 0 });
  });

  it("admits a later probe's reservation after the old single 300 s window", () => {
    // The CI and local failure: probe 2's reservation 331.5 s after the group start.
    expect(open(window(331, 30))).toBe(true);
    expect(open(window(1500, 299))).toBe(true);
    expect(nativeOpenCodeConformanceProbeDeadline(window(331, 30))).toBe(ago(30).getTime() + 300_000);
  });

  it("refuses a reservation after the probe's own window", () => {
    expect(open(window(400, 300))).toBe(false);
    expect(open(window(400, 301))).toBe(false);
    expect(() => assertNativeOpenCodeConformanceProbeWindow(window(400, 301)))
      .toThrow("The conformance probe's wall-clock window expired");
  });

  it("refuses a reservation after the group total, even inside the probe's own window", () => {
    expect(open(window(NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS, 10))).toBe(false);
    expect(open(window(NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS + 1, 10))).toBe(false);
    expect(open(window(NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS - 1, 10))).toBe(true);
    // A longer plan window never extends the group total; a shorter one binds.
    expect(open(window(NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS + 1, 10, 86_400))).toBe(false);
    expect(open(window(61, 10, 60))).toBe(false);
    expect(open(window(59, 10, 60))).toBe(true);
  });

  it("closes for a missing or invalid time, an invalid plan window, or a probe before its group", () => {
    expect(open({ ...window(100, 10), planStartedAt: null })).toBe(false);
    expect(open({ ...window(100, 10), probeStartedAt: null })).toBe(false);
    expect(open({ ...window(100, 10), planStartedAt: new Date(Number.NaN) })).toBe(false);
    expect(open({ ...window(100, 10), probeStartedAt: new Date(Number.NaN) })).toBe(false);
    expect(open({ ...window(100, 10), now: new Date(Number.NaN) })).toBe(false);
    expect(open(window(10, 100))).toBe(false);
    for (const planWallClockSeconds of [0, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY])
      expect(open(window(100, 10, planWallClockSeconds))).toBe(false);
  });
});
