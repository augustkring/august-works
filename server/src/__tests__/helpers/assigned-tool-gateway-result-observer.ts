import type { createToolGatewayService } from "../../services/tool-gateway.js";
type ToolGateway = ReturnType<typeof createToolGatewayService>;
type GatewayCall = Parameters<ToolGateway["executeTool"]>[0];
type GatewayResult = Awaited<ReturnType<ToolGateway["executeTool"]>>;
type GatewayOwnerKind = "fixture_root" | "host_root" | "scoped";
type ResultObserver = (facts: { call: GatewayCall; result: GatewayResult; replay: () => Promise<GatewayResult> }) => Promise<void>;
/** Per-fixture observer for the exact Gateway owners registered by the managed Host. */
export function createManagedAssignedGatewayResultObserver(observer: ResultObserver) {
  const wrappedOwners = new WeakMap<ToolGateway, { original: ToolGateway["executeTool"]; wrapper: ToolGateway["executeTool"] }>();
  const owners: ToolGateway[] = [];
  const ownerCounts: Record<GatewayOwnerKind, number> = { fixture_root: 0, host_root: 0, scoped: 0 };
  const resultCounts = { completed: 0, replayed: 0, other: 0, thrown: 0 };
  let observerCallbackCount = 0;
  return {
    observe(owner: ToolGateway, ownerKind: GatewayOwnerKind): void {
      if (wrappedOwners.has(owner)) return;
      const original = owner.executeTool;
      const wrapper: ToolGateway["executeTool"] = async function (this: ToolGateway, call, ...context) {
        const capturedCall = structuredClone(call);
        const replayCall = structuredClone(capturedCall);
        let result: GatewayResult;
        try { result = await original.apply(this, [call, ...context]); }
        catch (error) { resultCounts.thrown += 1; throw error; }
        if (result.status === "completed" || result.status === "replayed") {
          resultCounts[result.status] += 1;
          observerCallbackCount += 1;
          await observer({ call: capturedCall, result,
            replay: () => original.apply(this, [structuredClone(replayCall), ...context]) });
        } else resultCounts.other += 1;
        return result;
      };
      wrappedOwners.set(owner, { original, wrapper });
      owners.push(owner);
      ownerCounts[ownerKind] += 1;
      owner.executeTool = wrapper;
    },
    facts() {
      return { ownerCounts: { ...ownerCounts }, resultCounts: { ...resultCounts }, observerCallbackCount };
    },
    cleanup(): void {
      for (const owner of owners) {
        const wrapped = wrappedOwners.get(owner);
        if (wrapped && owner.executeTool === wrapped.wrapper) owner.executeTool = wrapped.original;
        wrappedOwners.delete(owner);
      }
      owners.length = 0;
    },
  };
}
