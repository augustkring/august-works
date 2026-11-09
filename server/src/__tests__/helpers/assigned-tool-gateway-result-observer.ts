import type { createToolGatewayService } from "../../services/tool-gateway.js";
type ToolGateway = ReturnType<typeof createToolGatewayService>;
type GatewayCall = Parameters<ToolGateway["executeTool"]>[0];
type GatewayResult = Awaited<ReturnType<ToolGateway["executeTool"]>>;
type GatewayOwnerKind = "fixture_root" | "host_root" | "scoped";
type ThrownFailureFact = { errorClass: string; status: number | null; code: string; causeClass: string };
const ERROR_CLASSES = ["Error", "HttpError", "ToolGatewayHttpError", "ToolRuntimeSupervisorError",
  "ToolContentValidationError", "ConflictError", "TypeError", "RangeError", "AbortError"] as const;
const CAUSE_CLASSES = ["Error", "HttpError", "ToolGatewayHttpError", "ToolRuntimeSupervisorError",
  "ToolContentValidationError", "ConflictError", "TypeError", "RangeError", "AbortError", "TimeoutError"] as const;
const FAILURE_CODES = new Set([
  "memory_agent_authority_unavailable", "memory_operation_ambiguous", "memory_operation_conflict",
  "memory_operation_record_unavailable", "memory_project_scope_unavailable", "memory_binding_unavailable",
  "memory_binding_ambiguous", "memory_task_context_required", "memory_source_task_not_found",
  "memory_source_project_mismatch", "memory_sensitivity_denied", "private_memory_read_denied",
  "shared_memory_disabled", "memory_project_scope_denied", "memory_tools_disabled", "private_memory_disabled",
  "memory_record_not_found", "memory_capture_source_busy", "memory_operation_deleted", "memory_source_deleted",
  "memory_resolution_conflict", "memory_resolution_source_conflict", "native_memory_output_requires_new_draft",
  "native_memory_capture_invalid", "native_memory_capture_required", "memory_operation_rejected",
  "scoped_tool_context_invalid", "gateway_token_action_denied", "tool_not_found", "operation_manifest_incomplete",
  "scoped_tool_not_connected", "tool_idempotency_unsettled", "deny_missing_agent", "deny_run_context_mismatch",
  "deny_company_boundary", "deny_missing_tool", "deny_policy_block", "deny_default", "requires_approval_policy", "rate_limited",
]);
function closedName(value: unknown, values: readonly string[]): string {
  return typeof value === "string" && values.includes(value) ? value : "other";
}
function thrownFailureFact(error: unknown): ThrownFailureFact {
  try {
    const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const details = candidate.details && typeof candidate.details === "object"
      ? candidate.details as Record<string, unknown> : {};
    const rawCode = candidate.reasonCode ?? details.code ?? candidate.code;
    const rawStatus = candidate.status;
    const cause = candidate.cause && typeof candidate.cause === "object"
      ? (candidate.cause as Record<string, unknown>).name : undefined;
    return {
      errorClass: closedName(candidate.name, ERROR_CLASSES),
      status: typeof rawStatus === "number" && Number.isInteger(rawStatus) &&
        [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504].includes(rawStatus) ? rawStatus : null,
      code: typeof rawCode === "string" && FAILURE_CODES.has(rawCode) ? rawCode : "other",
      causeClass: cause === undefined ? "none" : closedName(cause, CAUSE_CLASSES),
    };
  } catch {
    return { errorClass: "other", status: null, code: "other", causeClass: "other" };
  }
}
type ResultObserver = (facts: { call: GatewayCall; result: GatewayResult; replay: () => Promise<GatewayResult> }) => Promise<void>;
/** Per-fixture observer for the exact Gateway owners registered by the managed Host. */
export function createManagedAssignedGatewayResultObserver(observer: ResultObserver) {
  const wrappedOwners = new WeakMap<ToolGateway, { original: ToolGateway["executeTool"]; wrapper: ToolGateway["executeTool"] }>();
  const owners: ToolGateway[] = [];
  const ownerCounts: Record<GatewayOwnerKind, number> = { fixture_root: 0, host_root: 0, scoped: 0 };
  const resultCounts = { completed: 0, replayed: 0, other: 0, thrown: 0 };
  const thrownFailureFacts: ThrownFailureFact[] = [];
  let omittedThrownFailureFacts = 0;
  let observerCallbackCount = 0;
  return {
    observe(owner: ToolGateway, ownerKind: GatewayOwnerKind): void {
      if (wrappedOwners.has(owner)) return;
      const original = owner.executeTool;
      const wrapper: ToolGateway["executeTool"] = async function (this: ToolGateway, call, ...context) {
        const capturedCall = structuredClone(call);
        const replayCall = structuredClone(capturedCall);
        const invoke = async (exactCall: GatewayCall): Promise<GatewayResult> => {
          try { return await original.apply(this, [exactCall, ...context]); }
          catch (error) {
            resultCounts.thrown += 1;
            try {
              if (thrownFailureFacts.length < 8) thrownFailureFacts.push(thrownFailureFact(error));
              else omittedThrownFailureFacts += 1;
            } catch { omittedThrownFailureFacts += 1; }
            throw error;
          }
        };
        const result = await invoke(call);
        if (result.status === "completed" || result.status === "replayed") {
          resultCounts[result.status] += 1;
          observerCallbackCount += 1;
          await observer({ call: capturedCall, result,
            replay: () => invoke(structuredClone(replayCall)) });
        } else resultCounts.other += 1;
        return result;
      };
      wrappedOwners.set(owner, { original, wrapper });
      owners.push(owner);
      ownerCounts[ownerKind] += 1;
      owner.executeTool = wrapper;
    },
    facts() {
      return { ownerCounts: { ...ownerCounts }, resultCounts: { ...resultCounts },
        thrownFailureFacts: thrownFailureFacts.map(fact => ({ ...fact })), omittedThrownFailureFacts,
        observerCallbackCount };
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
