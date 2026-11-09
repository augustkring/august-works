import { afterEach, describe, expect, it } from "vitest";
import { getAssignedMcpGateway, registerAssignedMcpGateway } from "../../services/native-runtime/assigned-mcp-tools.js";
import { createManagedAssignedGatewayResultObserver } from "./assigned-tool-gateway-result-observer.js";

function fakeGateway(label: string) {
  const invocations: Array<{ receiver: unknown; args: unknown[] }> = [];
  const results: Array<Record<string, unknown>> = [];
  return { label, invocations, results, async executeTool(this: unknown, ...args: unknown[]) {
    invocations.push({ receiver: this, args });
    return results.shift() ?? { status: "completed", label };
  } };
}
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

describe("managed fixture assigned-Gateway result observer", () => {
  it("observes Host replacement root and factory-created scoped owners with original owner context", async () => {
    const rootDb = {} as never, scopedDb = {} as never;
    const oldOwner = fakeGateway("pre-host"), rootOwner = fakeGateway("host-root"), scopedOwner = fakeGateway("host-scoped");
    const seen: Array<{ call: unknown; result: unknown; replay?: unknown }> = [];
    const observation = createManagedAssignedGatewayResultObserver(async facts => {
      const entry: { call: unknown; result: unknown; replay?: unknown } = { call: facts.call, result: facts.result };
      if (facts.result && typeof facts.result === "object" && "probeReplay" in facts.result)
        entry.replay = await facts.replay();
      seen.push(entry);
    });
    cleanups.push(() => observation.cleanup());
    observation.observe(oldOwner as never, "fixture_root");
    registerAssignedMcpGateway(rootDb, oldOwner as never);
    // Same wiring as the serial Host: it replaces the root owner and registers
    // scoped owners separately through the existing registry factory.
    const originalRootExecute = rootOwner.executeTool;
    observation.observe(rootOwner as never, "host_root");
    observation.observe(rootOwner as never, "host_root");
    registerAssignedMcpGateway(rootDb, rootOwner as never, () => {
      observation.observe(scopedOwner as never, "scoped");
      return scopedOwner as never;
    });
    expect(getAssignedMcpGateway(rootDb)).toBe(rootOwner);
    expect(getAssignedMcpGateway(rootDb, scopedDb)).toBe(scopedOwner);

    const call = { tool: "fixture:observe", parameters: { exact: "value" } };
    const workflowContext = { workflow: true }, scopedContext = { source: "native" };
    const completed = { status: "completed", probeReplay: true }, replayResult = { status: "completed", replayProbe: true };
    const replayed = { status: "replayed" };
    scopedOwner.results.push(replayed, { status: "error" });
    rootOwner.results.push(completed, replayResult, { status: "failed" }, { status: "error" });
    const rootResult = await getAssignedMcpGateway(rootDb).executeTool(call as never, workflowContext as never, scopedContext as never);
    expect(rootResult).toBe(completed);
    await getAssignedMcpGateway(rootDb).executeTool(call as never, workflowContext as never, scopedContext as never);
    await getAssignedMcpGateway(rootDb).executeTool(call as never, workflowContext as never, scopedContext as never);
    const scopedResult = await getAssignedMcpGateway(rootDb, scopedDb).executeTool(call as never, workflowContext as never, scopedContext as never);
    expect(scopedResult).toBe(replayed);
    await getAssignedMcpGateway(rootDb, scopedDb).executeTool(call as never, workflowContext as never, scopedContext as never);

    expect(rootOwner.invocations[0]).toEqual({ receiver: rootOwner, args: [call, workflowContext, scopedContext] });
    expect(scopedOwner.invocations[0]).toEqual({ receiver: scopedOwner, args: [call, workflowContext, scopedContext] });
    expect(seen.map(entry => entry.result)).toEqual([completed, replayed]);
    expect(seen[0]?.call).toEqual(call);
    expect(seen[0]?.call).not.toBe(call);
    expect(seen[0]?.replay).toBe(replayResult);
    expect(rootOwner.invocations[1]?.receiver).toBe(rootOwner);
    expect(rootOwner.invocations[1]?.args.slice(1)).toEqual([workflowContext, scopedContext]);
    expect(observation.facts()).toEqual({ ownerCounts: { fixture_root: 1, host_root: 1, scoped: 1 },
      resultCounts: { completed: 1, replayed: 1, other: 3, thrown: 0 },
      thrownFailureFacts: [], omittedThrownFailureFacts: 0, observerCallbackCount: 2 });
    observation.cleanup();
    expect(rootOwner.executeTool).toBe(originalRootExecute);
  });

  it("projects a thrown scoped-Gateway failure without exposing arbitrary error fields or replacing the throw", async () => {
    const rootDb = {} as never, scopedDb = {} as never;
    const sentinel = "PRIVATE-SENTINEL-message-token-params";
    const thrown = Object.assign(new Error(sentinel), {
      status: 403, reasonCode: sentinel, code: sentinel, details: { code: sentinel, body: sentinel },
      parameters: sentinel, cause: Object.assign(new Error(sentinel), { name: "TypeError" }),
    });
    const rootOwner = fakeGateway("root");
    const scopedOwner = fakeGateway("scoped");
    scopedOwner.executeTool = async () => { throw thrown; };
    let callbacks = 0;
    const observation = createManagedAssignedGatewayResultObserver(async () => { callbacks += 1; });
    cleanups.push(() => observation.cleanup());
    observation.observe(rootOwner as never, "host_root");
    registerAssignedMcpGateway(rootDb, rootOwner as never, () => {
      observation.observe(scopedOwner as never, "scoped");
      return scopedOwner as never;
    });
    await expect(getAssignedMcpGateway(rootDb, scopedDb).executeTool({ tool: "fixture:observe" } as never))
      .rejects.toBe(thrown);
    expect(callbacks).toBe(0);
    const facts = observation.facts();
    expect(facts).toEqual({ ownerCounts: { fixture_root: 0, host_root: 1, scoped: 1 },
      resultCounts: { completed: 0, replayed: 0, other: 0, thrown: 1 },
      thrownFailureFacts: [{ errorClass: "Error", status: 403, code: "other", causeClass: "TypeError" }],
      omittedThrownFailureFacts: 0, observerCallbackCount: 0 });
    expect(JSON.stringify(facts)).not.toContain(sentinel);
    thrown.reasonCode = "native_memory_capture_required";
    await expect(getAssignedMcpGateway(rootDb, scopedDb).executeTool({ tool: "fixture:observe" } as never))
      .rejects.toBe(thrown);
    expect(observation.facts().thrownFailureFacts.at(-1)?.code).toBe("native_memory_capture_required");
    expect(callbacks).toBe(0);
  });

  it("shows root-only observation misses a scoped owner", async () => {
    const rootDb = {} as never, scopedDb = {} as never;
    const rootOwner = fakeGateway("root-only"), scopedOwner = fakeGateway("unobserved-scoped");
    let observed = 0;
    const observation = createManagedAssignedGatewayResultObserver(async () => { observed += 1; });
    cleanups.push(() => observation.cleanup());
    observation.observe(rootOwner as never, "host_root");
    registerAssignedMcpGateway(rootDb, rootOwner as never, () => scopedOwner as never);
    await getAssignedMcpGateway(rootDb, scopedDb).executeTool({ tool: "fixture:observe" } as never);
    expect(observed).toBe(0);
  });
});
