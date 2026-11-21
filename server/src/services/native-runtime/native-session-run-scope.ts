import type { PersistedNativeSession } from "../../vendor/paperclip-runner/index.js";

/**
 * Rebind a settled session snapshot for a new Run without its Run-scoped
 * state. A provider session can carry into a later Run only after the
 * previous Run settled: its provider identity survives, but the previous
 * Run's semantic result, terminal state, active turn, terminal-turn
 * fingerprints and pending runtime requests must not cross into the new Run.
 *
 * Used by the Worker lane's cross-Run warm checkpoint
 * (`loadWarmNativeCheckpoint`, with the new Run's identity) and by the
 * conformance resume probe (CONF15-P3, with the snapshot's own identity, so
 * the runner-confirmed binding check still compares against the previous
 * Run). Every other snapshot field is kept unchanged.
 */
export function nativeSessionWithoutRunScopedState(
  snapshot: PersistedNativeSession,
  identity: PersistedNativeSession["identity"],
): PersistedNativeSession {
  return {
    ...snapshot,
    identity,
    semanticResult: null,
    terminal: null,
    activeTurnId: null,
    terminalTurns: [],
    pendingRuntimeRequests: [],
  };
}
