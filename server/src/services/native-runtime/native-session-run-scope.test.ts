import { describe, expect, it } from "vitest";
import type { PersistedNativeSession } from "../../vendor/paperclip-runner/index.js";
import { nativeSessionWithoutRunScopedState } from "./native-session-run-scope.js";

// CONF15-P3. The Worker lane's cross-Run warm checkpoint strip, shared with
// the conformance resume probe. The Worker output must stay byte-identical to
// the literal it replaced in `loadWarmNativeCheckpoint`.

const identity = { runId: "run-1", sessionId: "session-1", companyId: "company-1", issueId: "task-1", agentId: "agent-1" };
const nextIdentity = { runId: "run-2", sessionId: "session-1", companyId: "company-1", issueId: "task-1", agentId: "agent-1" };
const settled = {
  backendKind: "runner", driverKind: "opencode", sessionId: "driver-1", identity, providerSessionId: "provider-1",
  cursor: "cursor-9", semanticResult: { reportedWorkDisposition: "done" }, terminal: { turnTerminalState: "completed" },
  activeTurnId: "turn-1", terminalTurns: [{ turnId: "turn-1", fingerprint: "fp" }], dispositionOnlyRecoveryConsumed: false,
  pendingRuntimeRequests: [{ id: "request-1" }], goal: null, lineage: [{ threadId: "thread-1" }],
} as unknown as PersistedNativeSession;

// The Worker literal before the extraction, kept verbatim for comparison.
function workerLiteral(snapshot: PersistedNativeSession, next: PersistedNativeSession["identity"]) {
  return {
    ...snapshot,
    identity: { runId: next.runId, sessionId: next.sessionId, companyId: next.companyId, issueId: next.issueId,
      agentId: next.agentId },
    semanticResult: null,
    terminal: null,
    activeTurnId: null,
    terminalTurns: [],
    pendingRuntimeRequests: [],
  };
}

describe("nativeSessionWithoutRunScopedState (CONF15-P3)", () => {
  it("matches the Worker cross-Run literal byte for byte, key order included", () => {
    const stripped = nativeSessionWithoutRunScopedState(settled, { ...nextIdentity });
    expect(JSON.stringify(stripped)).toBe(JSON.stringify(workerLiteral(settled, nextIdentity)));
  });

  it("matches it for a snapshot without the Run-scoped fields", () => {
    const minimal = { backendKind: "runner", sessionId: "driver-1", identity } as unknown as PersistedNativeSession;
    expect(JSON.stringify(nativeSessionWithoutRunScopedState(minimal, { ...nextIdentity })))
      .toBe(JSON.stringify(workerLiteral(minimal, nextIdentity)));
  });

  it("drops exactly the five Run-scoped fields and keeps every other field", () => {
    const stripped = nativeSessionWithoutRunScopedState(settled, identity) as unknown as Record<string, unknown>;
    expect(stripped).toMatchObject({ semanticResult: null, terminal: null, activeTurnId: null, terminalTurns: [],
      pendingRuntimeRequests: [] });
    const kept = Object.keys(settled).filter(key =>
      !["semanticResult", "terminal", "activeTurnId", "terminalTurns", "pendingRuntimeRequests"].includes(key));
    for (const key of kept) expect(stripped[key]).toEqual((settled as unknown as Record<string, unknown>)[key]);
    expect(Object.keys(stripped)).toEqual(Object.keys(settled));
  });

  it("uses the identity it is given and leaves the input unchanged", () => {
    const before = structuredClone(settled);
    expect(nativeSessionWithoutRunScopedState(settled, identity).identity).toBe(identity);
    expect(nativeSessionWithoutRunScopedState(settled, nextIdentity).identity).toBe(nextIdentity);
    expect(settled).toEqual(before);
  });
});
