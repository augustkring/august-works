import type { NativeExecutionInput, NativeSessionBackend } from "../../vendor/paperclip-runner/index.js";

/** Existing API-policy backend control, shared with its UI caller. This does
 * not dispatch a model or qualify provider/SDK behavior. */
export function createControlledNativeSignoffBackend() {
  type BackendControl = { started: Promise<void>; completion: Promise<void>; release: () => void; markStarted: () => void;
    waitForStart: () => Promise<void>; attempts: number; observations: { descriptor: boolean; openSession: boolean; startTurn: boolean } };
  const controlsByRun = new Map<string, BackendControl>();
  let backendFactoryClosing = false;
  async function waitForBackend(runId: string): Promise<BackendControl> {
    const deadline = Date.now() + 30_000;
    let control = controlsByRun.get(runId);
    while (!control && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      control = controlsByRun.get(runId);
    }
    if (!control) throw new Error("managed_signoff_backend_factory_timeout");
    return control;
  }
  function createControl(): BackendControl {
    let signalStarted: () => void = () => {};
    let releaseEvents: () => void = () => {};
    const startedPromise = new Promise<void>(resolve => { signalStarted = resolve; });
    const completionGate = new Promise<void>(resolve => { releaseEvents = resolve; });
    const observations = { descriptor: false, openSession: false, startTurn: false };
    return { started: startedPromise, completion: completionGate, release: releaseEvents,
      markStarted: signalStarted, attempts: 0, observations,
      waitForStart: async () => {
        let handle: ReturnType<typeof setTimeout> | undefined;
        try {
          const timer = new Promise<never>((_, reject) => {
            handle = setTimeout(() => {
              try { console.info("managed_signoff_backend_start_timeout_facts", JSON.stringify(observations)); }
              catch { /* Diagnostics must not replace the original timeout. */ }
              reject(new Error("managed_signoff_backend_start_timeout"));
            }, 30_000);
            handle.unref();
          });
          await Promise.race([startedPromise, timer]);
        } finally { if (handle) clearTimeout(handle); }
      } };
  }
  function controlledBackend(execution: NativeExecutionInput): NativeSessionBackend {
    const runId = execution.binding.runId;
    const control = controlsByRun.get(runId) ?? createControl();
    if (!controlsByRun.has(runId)) controlsByRun.set(runId, control);
    const attempt = ++control.attempts;
    if (backendFactoryClosing) control.release();
    let cancelled = false;
    let attemptClosed = false;
    let closeAttempt: () => void = () => {};
    const attemptClosedPromise = new Promise<void>(resolve => { closeAttempt = resolve; });
    const contract = execution.completionContract.contract;
    const result = {
      schema: "paperclip.run_result.v1" as const,
      reportedWorkDisposition: "done" as const,
      summary: "The controlled Native backend completed the API-policy fixture turn without provider dispatch.",
      completionClaim: { contractRevision: contract.revision, objectiveSatisfied: true,
        criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied" as const, evidenceRefs: [] })),
        remainingWork: [] },
      evidence: [], verification: [], attentionRequests: [], artifacts: [],
    };
    const terminal = { schema: "paperclip.prp.terminal.v1" as const, turnTerminalState: "completed" as const,
      runTerminalState: "succeeded" as const, reportedWorkDisposition: "done" as const };
    return {
      async descriptor() { control.observations.descriptor = true; return { kind: "mock", name: "managed-signoff-api-policy", version: "1",
        capabilities: { resume: false, typedEvents: true, steering: false, interruption: true, structuredResult: true },
        runtimeContextCapabilities: { instructions: "native", skills: "native", mcp: "native" } }; },
      async openSession(openInput) {
        control.observations.openSession = true;
        const identity = openInput.identity;
        const turnId = `managed-signoff-api-policy-${identity.runId}-${attempt}`;
        return {
          identity: () => identity,
          async capabilities() { return { resume: false, typedEvents: true, steering: false, interruption: true, structuredResult: true }; },
          async *events() {
            const released = await Promise.race([
              control.completion.then(() => true),
              attemptClosedPromise.then(() => false),
            ]);
            if (!released || cancelled || attemptClosed) return;
            yield { schema: "paperclip.prp.event.v1" as const, sourceEventId: `${turnId}:terminal`, sourceSeq: 1,
              sourceInstanceId: turnId, sourceKind: "runner" as const, runId: identity.runId,
              normalizedSessionId: identity.sessionId, turnId, eventType: "turn.completed" as const,
              schemaVersion: 1 as const, priority: 0 as const, emittedAt: new Date().toISOString(), payload: {} };
          },
          async startTurn() { control.observations.startTurn = true; control.markStarted(); return { turnId }; },
          async result() { return { result, terminal, turnId }; },
          async snapshot() { return { backendKind: "mock", sessionId: identity.sessionId, identity,
            providerSessionId: "managed-signoff-api-policy" }; },
          cancel() { cancelled = true; attemptClosed = true; closeAttempt(); return { cleanup: Promise.resolve() }; },
          async close() { attemptClosed = true; closeAttempt(); },
        };
      },
    };
  }

  return { controlsByRun, waitForBackend, controlledBackend,
    close: () => {
      backendFactoryClosing = true;
      for (const control of controlsByRun.values()) control.release();
    } };
}
