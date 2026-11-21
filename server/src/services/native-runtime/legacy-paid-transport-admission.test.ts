import { describe, expect, it, vi } from "vitest";
import { withLegacyPaidTransportAdmission, runtimeSpendPolicies, NativePaidTransportAdmissionError } from "./paid-transport-admission.js";
const binding = { companyId: "company", agentId: "agent" };
describe("platform-initiated paid model admission", () => {
  it.each(["claude_local", "codex_local", "hermes_local", "openclaw_gateway", "opencode_local", "custom"])(
    "denies unqualified %s credential and model-entry callbacks regardless of environment or payer", adapterType => {
      const credentialSelect = vi.fn(() => "credential");
      const adapterExecute = vi.fn(() => "provider started");
      for (const entry of [credentialSelect, adapterExecute]) {
        expect(() => withLegacyPaidTransportAdmission({ ...binding, adapterType, operation: "model_dispatch" }, entry))
          .toThrow(NativePaidTransportAdmissionError);
        expect(entry).not.toHaveBeenCalled();
      }
    });
  it.each(["hermes_local", "openclaw_gateway", "claude_local", "paperclip_runner"])(
    "denies a generic paid %s conformance probe before credentials or invocation", adapterType => {
      const resolveSecrets = vi.fn();
      const invokeProbe = vi.fn();
      expect(() => withLegacyPaidTransportAdmission({ ...binding, adapterType,
        operation: "provider_conformance" }, () => { resolveSecrets(); invokeProbe(); })).toThrow();
      expect(resolveSecrets).not.toHaveBeenCalled();
      expect(invokeProbe).not.toHaveBeenCalled();
    });
  it("retains the existing Runtime unavailable owner and deep link", () => {
    expect(() => withLegacyPaidTransportAdmission({ ...binding, adapterType: "external",
      operation: "model_dispatch" }, vi.fn())).toThrowError(expect.objectContaining({
      code: "configuration_incomplete", resultJson: { configurationIncomplete: {
        owner: "Managed model gateway owner", reason: "paid_transport_unqualified",
        provider: "external", companyId: "company", agentId: "agent", actionUrl: "/agents/agent/runtime" } } }));
  });
  it("qualifies Fabric's compatibility policy disclosure and rejects required or retained hard-stop claims", () => {
    const input = { ...binding, adapterType: "external", unsupportedExternalSpend: true };
    expect(runtimeSpendPolicies(input)).toEqual(["reported_cost_threshold_only", "source_provenance", "approval_before_side_effects"]);
    for (const changed of [{ required: ["budget_hard_stop"] }, { retained: ["budget_hard_stop"] }])
      expect(() => runtimeSpendPolicies({ ...input, ...changed })).toThrow(NativePaidTransportAdmissionError);
    expect(runtimeSpendPolicies({ ...input, unsupportedExternalSpend: false })).toContain("budget_hard_stop");
  });
  it("leaves Native model dispatch to its existing candidate and executor gates", () => {
    const nativeEntry = vi.fn(() => "existing guarded Native route");
    expect(withLegacyPaidTransportAdmission({ ...binding, adapterType: "paperclip_runner",
      operation: "model_dispatch" }, nativeEntry)).toBe("existing guarded Native route");
    expect(nativeEntry).toHaveBeenCalledOnce();
  });
});
