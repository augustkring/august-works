import { forbidden } from "../../errors.js";

/**
 * The wall-clock window of one managed OpenCode provider qualification
 * (CONF15-P5, the CONF15-P4 next stop). One Human request runs all six probes serially
 * (`native-opencode-conformance.ts` `test()`: four on the primary presence, two
 * on the isolation peer), so one shared 300 s plan window refused the later
 * probes' model reservations on slower hosts. Each probe now has its own
 * window, its own start plus the per-probe limit, and the group's harness plans
 * carry the group total, the probe count times that limit, from the group's one
 * start. The group deadline is fixed when the group starts and is never renewed
 * by a probe. Cost ceilings, reservation amounts and budget blocks are separate
 * and unchanged.
 */
export const NATIVE_OPENCODE_CONFORMANCE_PROBE_COUNT = 6;
/** The per-probe limit, the value one plan window used to hold for all six. */
export const NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS = 300;
export const NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS =
  NATIVE_OPENCODE_CONFORMANCE_PROBE_COUNT * NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS;

/** The budgets of one harness plan of a qualification group. Only the wall
 * clock is the group total; the model-cost ceiling is the caller's unchanged
 * quote for that presence's probes, and the plan grants no tools, retries or
 * delegation. */
export function nativeOpenCodeConformanceHarnessBudgets(maximumMinor: number) {
  return { maxModelCostMinor: maximumMinor, maxToolActions: 0,
    maxWallClockSeconds: NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS, maxRetries: 0, maxDelegationDepth: 0 };
}

/**
 * The end (epoch ms) of one probe's window: the probe Run's own start plus the
 * per-probe limit, and never later than the group's start plus its window,
 * itself never more than the group total. NaN, a closed window, for a missing
 * or invalid time, an invalid plan window, or a probe that starts before its
 * group.
 */
export function nativeOpenCodeConformanceProbeDeadline(input: {
  planStartedAt: Date | null; planWallClockSeconds: number; probeStartedAt: Date | null;
}): number {
  const groupStart = input.planStartedAt?.getTime() ?? Number.NaN;
  const probeStart = input.probeStartedAt?.getTime() ?? Number.NaN;
  if (!Number.isFinite(groupStart) || !Number.isFinite(probeStart) || probeStart < groupStart ||
    !Number.isSafeInteger(input.planWallClockSeconds) || input.planWallClockSeconds <= 0) return Number.NaN;
  return Math.min(probeStart + NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS * 1000,
    groupStart + Math.min(input.planWallClockSeconds, NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS) * 1000);
}

/** Refuses once the probe's own window or its group's window has ended, and
 * returns the probe's deadline otherwise. */
export function assertNativeOpenCodeConformanceProbeWindow(input: {
  planStartedAt: Date | null; planWallClockSeconds: number; probeStartedAt: Date | null; now: Date;
}): number {
  const deadline = nativeOpenCodeConformanceProbeDeadline(input);
  if (!(input.now.getTime() < deadline)) throw forbidden("The conformance probe's wall-clock window expired");
  return deadline;
}
