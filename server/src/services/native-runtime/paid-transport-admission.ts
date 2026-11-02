/** Admission policy for paid Native provider transports. */
export const NATIVE_PAID_ADMISSION_OWNER = "Managed model gateway owner";
export const NATIVE_PAID_ADMISSION_REASON = "paid_transport_unqualified";
export const NATIVE_PAID_RUNTIME_UNAVAILABLE_MESSAGE =
  "This runtime is not available for managed model calls. Choose an available runtime in Runtime settings.";

export class NativePaidTransportAdmissionError extends Error {
  readonly code = "configuration_incomplete";
  readonly owner = NATIVE_PAID_ADMISSION_OWNER;
  readonly resultJson: Record<string, unknown>;
  readonly provider: string;

  constructor(provider: string, binding?: { companyId: string; agentId: string }) {
    super(NATIVE_PAID_RUNTIME_UNAVAILABLE_MESSAGE);
    this.name = "NativePaidTransportAdmissionError";
    this.provider = provider;
    this.resultJson = {
      configurationIncomplete: {
        reason: NATIVE_PAID_ADMISSION_REASON,
        owner: NATIVE_PAID_ADMISSION_OWNER,
        provider,
        companyId: binding?.companyId ?? null,
        agentId: binding?.agentId ?? null,
        actionUrl: binding?.agentId ? `/agents/${binding.agentId}/runtime` : null,
      },
    };
  }
}

/** Run before resolving a provider-bound AI Connection into Native env. A
 * direct connection binding is a CLI credential path, not a server reservation
 * route. OpenCode remains a candidate because its route is checked again
 * against the execution target and current manifest by RuntimeControl. */
export function assertNativePaidTransportCandidate(input: {
  provider: string;
  serverOwnedDraft?: boolean;
  aiConnectionBound?: boolean;
}): void {
  if (input.aiConnectionBound) {
    throw new NativePaidTransportAdmissionError(`${input.provider} direct AI Connection`);
  }
  if (input.provider === "aw_text_only" && input.serverOwnedDraft) return;
  if (input.provider === "opencode") return;
  throw new NativePaidTransportAdmissionError(input.provider);
}

/** Final launch guard. A server-selected Sandbox target is the only Native
 * OpenCode launch route that enters RuntimeControl's existing current-source,
 * manifest, model-profile and typed-credential checks. Caller environment
 * values are deliberately not treated as admission evidence. */
export function assertNativePaidTransportAdmitted(input: {
  provider: string;
  adapterType?: string;
  serverOwnedDraft?: boolean;
  companyId: string;
  agentId: string;
  useRunnerd?: boolean;
  backendDriverKind?: string;
  executionTarget?: { kind?: string; transport?: string } | null;
}): void {
  if (input.provider === "aw_text_only" && input.adapterType === "paperclip_runner" && input.serverOwnedDraft) return;
  if (input.adapterType === "paperclip_runner" && input.provider === "opencode" &&
      input.backendDriverKind === "opencode_server" && input.useRunnerd === true &&
      input.executionTarget?.kind === "remote" && input.executionTarget.transport === "sandbox") return;
  throw new NativePaidTransportAdmissionError(input.provider, input);
}

/** Admission for platform-initiated model operations, regardless of payer,
 * environment or legacy mode. There is no qualified forced model route or
 * whole-invocation liability contract for legacy adapter.execute today. */
export function withLegacyPaidTransportAdmission<T>(input: {
  adapterType: string; companyId: string; agentId: string;
  operation: "model_dispatch" | "provider_conformance";
}, dispatch: () => T): T {
  // Heartbeat Native execution has its existing candidate/executor gates.
  // Only its separately installed draft conformance owner can run paid probes;
  // that owner returns before this generic probe entry is reached.
  if (input.adapterType === "paperclip_runner" && input.operation === "model_dispatch") return dispatch();
  throw new NativePaidTransportAdmissionError(input.adapterType, input);
}

/** Disclosure is not admission. Do not print a hard-stop policy claim for
 * compatibility whose provider-local spend is outside a forced model route. */
export function runtimeSpendPolicies(input: {
  unsupportedExternalSpend: boolean; required?: string[]; retained?: string[];
  adapterType: string; companyId: string; agentId: string;
}): string[] {
  if (input.unsupportedExternalSpend &&
      (input.required?.includes("budget_hard_stop") || input.retained?.includes("budget_hard_stop")))
    throw new NativePaidTransportAdmissionError(input.adapterType, input);
  return input.required ?? [input.unsupportedExternalSpend ? "reported_cost_threshold_only" : "budget_hard_stop",
    "source_provenance", "approval_before_side_effects"];
}

/** Unsupported tool model effects are independent of the selected runtime. */
export const TOOL_MODEL_EFFECT_ADMISSION_REASON = "tool_model_effect_unqualified";
export const TOOL_MODEL_EFFECT_UNAVAILABLE_MESSAGE =
  "This tool is not available for managed work. Choose an available tool or contact your company administrator.";
export class ToolModelEffectAdmissionError extends Error {
  readonly code = "configuration_incomplete";
  readonly owner = NATIVE_PAID_ADMISSION_OWNER;
  readonly resultJson: Record<string, unknown>;
  constructor(readonly provider: string, binding?: { companyId: string; agentId?: string | null }) {
    super(TOOL_MODEL_EFFECT_UNAVAILABLE_MESSAGE);
    this.name = "ToolModelEffectAdmissionError";
    this.resultJson = { configurationIncomplete: {
      reason: TOOL_MODEL_EFFECT_ADMISSION_REASON, owner: this.owner, provider,
      companyId: binding?.companyId ?? null, agentId: binding?.agentId ?? null,
      actionUrl: "/apps",
    } };
  }
}
