import type { AdapterExecutionResult } from "../adapters/types.js";

/** Live adapter ownership shared by routes and scheduler service instances. */
export function createAdapterExecutionControl() {
  const controller = new AbortController();
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { controller, settled, finish };
}

export const adapterExecutionControls = new Map<
  string,
  ReturnType<typeof createAdapterExecutionControl>
>();

// A Stop with no opted-in adapter may still be awaiting its terminal write.
// Readiness must not pass that write using an earlier "running" snapshot.
// These are in-process ordering barriers, never cancellation acknowledgments.
const pendingUnregisteredAdapterStops = new Map<string, Set<Promise<void>>>();

export function captureAdapterStopOwnership(runId: string) {
  const control = adapterExecutionControls.get(runId);
  if (control) return { control, release: () => {} };
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let owners = pendingUnregisteredAdapterStops.get(runId);
  if (!owners) {
    owners = new Set();
    pendingUnregisteredAdapterStops.set(runId, owners);
  }
  owners.add(settled);
  let released = false;
  return {
    control,
    release: () => {
      if (released) return;
      released = true;
      owners.delete(settled);
      if (
        owners.size === 0 &&
        pendingUnregisteredAdapterStops.get(runId) === owners
      ) {
        pendingUnregisteredAdapterStops.delete(runId);
      }
      settle();
    },
  };
}

export async function registerAdapterExecutionControl(
  runId: string,
  control: ReturnType<typeof createAdapterExecutionControl>,
) {
  // Do not expose a joinable owner while waiting: a duplicate Stop must not
  // join an adapter whose readiness is waiting for that same Stop to settle.
  for (;;) {
    const pending = pendingUnregisteredAdapterStops.get(runId);
    if (!pending?.size) break;
    await Promise.all([...pending]);
  }
  // No await between observing no earlier Stop owners and publishing readiness.
  adapterExecutionControls.set(runId, control);
}

export async function waitForAdapterStop(
  settled: Promise<void>,
  timeoutMs = 60_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      settled,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Execution is still stopping; termination has not been verified.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A legacy process adapter's signal exit can race the operator cancellation CAS while
// its owned process group is still being joined. Keep that exit from becoming
// a successful result (or a competing failure) before Stop settles. This is an
// in-process ordering barrier, not durable cancellation or provider authority.
// Embedded adapters use their own cancellation control and acknowledgement.
export const processRunCancellationSettlements = new Map<
  string,
  {
    settled: Promise<void>;
    failed: boolean;
    error?: unknown;
  }
>();
// Keep failed Stop evidence until the exact executor exits, independently of
// the active owner barrier. A later Stop may retry a still-owned live child.
export const failedProcessRunCancellations = new Map<
  string,
  { settled: Promise<void>; failed: boolean; error?: unknown }
>();
export type RunSessionOutcome =
  "succeeded" | "interrupted" | "failed" | "cancelled" | "timed_out";

export function classifyAdapterExecutionOutcome(
  latestRun: { status: string } | null,
  executionControl: ReturnType<typeof createAdapterExecutionControl>,
  adapterResult: AdapterExecutionResult,
  processCancellation: { failed: boolean } | undefined,
  isHeartbeatRunTerminalStatus: (
    status: string | null | undefined,
  ) => status is RunSessionOutcome,
): RunSessionOutcome {
  let outcome: RunSessionOutcome;
  if (isHeartbeatRunTerminalStatus(latestRun?.status)) {
    outcome = latestRun.status;
  } else if (executionControl.controller.signal.aborted) {
    outcome = "cancelled";
  } else if (adapterResult.nativeFinalization) {
    const nativeTerminal =
      adapterResult.nativeFinalization.terminal.runTerminalState;
    outcome =
      nativeTerminal === "succeeded"
        ? "succeeded"
        : nativeTerminal === "cancelled"
          ? "cancelled"
          : "failed";
  } else if (adapterResult.timedOut) {
    outcome = "timed_out";
  } else if (
    (adapterResult.exitCode ?? 0) === 0 &&
    !adapterResult.errorMessage &&
    !adapterResult.signal &&
    !processCancellation?.failed
  ) {
    outcome = "succeeded";
  } else {
    outcome = "failed";
  }
  return outcome;
}

export function joinProcessRunCancellation(runId: string): Promise<void> | undefined {
  const pendingProcessCancellation = processRunCancellationSettlements.get(runId);
  if (!pendingProcessCancellation) return undefined;
  return (async () => {
    await pendingProcessCancellation.settled;
    if (pendingProcessCancellation.failed)
      throw pendingProcessCancellation.error;
  })();
}

export function registerProcessRunCancellation(runId: string) {
  let releaseProcessCancellation: (() => void) | undefined;
  const processCancellationSettlement = {
    settled: new Promise<void>((resolve) => {
      releaseProcessCancellation = resolve;
    }),
    failed: false,
    error: undefined as unknown,
  };
  // No await between joining an existing owner and registering ours.
  processRunCancellationSettlements.set(runId, processCancellationSettlement);
  return { settlement: processCancellationSettlement, release: releaseProcessCancellation };
}

export async function settleProcessRunCancellation<T>(
  runId: string,
  owner: ReturnType<typeof registerProcessRunCancellation>,
  performCancellation: () => Promise<T>,
  executionStillActive: () => boolean,
): Promise<T> {
  const processCancellationSettlement = owner.settlement;
  const releaseProcessCancellation = owner.release;
  try {
    return await performCancellation();
  } catch (error) {
    if (processCancellationSettlement) {
      processCancellationSettlement.failed = true;
      processCancellationSettlement.error = error;
      if (executionStillActive()) {
        failedProcessRunCancellations.set(
          runId,
          processCancellationSettlement,
        );
      }
    }
    throw error;
  } finally {
    if (processCancellationSettlement) {
      if (
        processRunCancellationSettlements.get(runId) ===
        processCancellationSettlement
      ) {
        processRunCancellationSettlements.delete(runId);
      }
      // Always settle waiters, including termination and DB errors. A
      // failed Stop remains an error to its caller, never a cancellation
      // receipt; the signal-bearing executor may then record failure.
      releaseProcessCancellation?.();
    }
  }
}

export function finishProcessRunCancellationExecution(runId: string) {
  failedProcessRunCancellations.delete(runId);
}
