import { describe, expect, it } from "vitest";
import { causalClaimDefinitionSchema, type DoWhyCausalDiagnostics, type NativeCausalResult } from "@paperclipai/shared";
import { causalClaimFixture } from "./helpers/causal-claim-fixture.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { evaluateNativeCausalClaim } from "../services/causal-claims/kernel.js";
import { replayDoWhyCausalClaim } from "../services/causal-claims/dowhy-provider.js";
const profile = { provider: "dowhy" as const, version: "0.14" as const, python: "3.12.14" as const, bundleHash: "a".repeat(64), conformanceHash: "b".repeat(64) };
// Explicit pure software DTO fixtures; these are not actual provider receipts.
function fixture() {
  const f = causalClaimFixture(), definition = causalClaimDefinitionSchema.parse({ ...f.definition, providerProfile: profile }), native = evaluateNativeCausalClaim(definition, f.source);
  const diagnostics: DoWhyCausalDiagnostics = { provider: "dowhy", version: "0.14", python: "3.12.14", bundleHash: profile.bundleHash, method: "backdoor.linear_regression", identification: "identified_under_registered_randomization", adjustmentSet: [], effect: native.estimate!.effect, representation: "anonymous_binary_sufficient_counts", simulations: 16, seed: 1729, sensitivity: "unknown", uncertainty: "native_registered_interval_required", refutations: ["random_common_cause", "placebo_treatment_refuter", "data_subset_refuter"].map(method => ({ method: method as DoWhyCausalDiagnostics["refutations"][number]["method"], effect: 0, pValue: 0.5, status: "passed" })) };
  const retained: NonNullable<NativeCausalResult["providerAnalysis"]> = { profile, nativeResultHash: nativeSha256(native), diagnostics };
  return { ...f, definition, native, retained };
}
describe("Original causal result plus fixed provider diagnostic replay", () => {
  it("preserves native effect/interval/source conditions and permits only conditional advisory wording", () => {
    const f = fixture(), result = replayDoWhyCausalClaim(f.definition, f.source, f.retained);
    expect(result.status).toBe("supported"); expect(result.estimate).toEqual(f.native.estimate); expect(result.identification).toEqual(f.native.identification); expect(result.robustness).toMatchObject({ providerRefutations: "passed", sensitivity: "unknown" }); expect(result.executionAuthority).toBe("advisory_only");
  });
  it.each(["failed", "unknown"] as const)("withholds reliance on %s refutation while retaining the native interval", status => {
    const f = fixture(); f.retained.diagnostics.refutations[1] = { ...f.retained.diagnostics.refutations[1], pValue: status === "failed" ? 0.01 : null, status };
    const result = replayDoWhyCausalClaim(f.definition, f.source, f.retained);
    expect(result).toMatchObject({ status: "inconclusive", language: "causal_reliance_withheld", robustness: { providerRefutations: status } }); expect(result.estimate).toEqual(f.native.estimate);
  });
  it("rejects altered native proof, profile, point, method or diagnostic status", () => {
    const f = fixture();
    for (const retained of [{ ...f.retained, nativeResultHash: "f".repeat(64) }, { ...f.retained, profile: { ...profile, conformanceHash: "f".repeat(64) } }, { ...f.retained, diagnostics: { ...f.retained.diagnostics, effect: 0 } }, { ...f.retained, diagnostics: { ...f.retained.diagnostics, method: "arbitrary" } }, { ...f.retained, diagnostics: { ...f.retained.diagnostics, refutations: f.retained.diagnostics.refutations.map(item => ({ ...item, pValue: null })) } }]) expect(() => replayDoWhyCausalClaim(f.definition, f.source, retained as typeof f.retained)).toThrow();
  });
  it("admits no diagnostics or fabricated point when native Source/assumption gates abstain", () => {
    const f = fixture(); f.definition.assumptions.noInterference.status = "unknown";
    expect(replayDoWhyCausalClaim(f.definition, f.source)).toMatchObject({ status: "inconclusive", estimate: null }); expect(() => replayDoWhyCausalClaim(f.definition, f.source, f.retained)).toThrow();
  });
  it("leaves native historical definition JSON unchanged and rejects optional observational/expanded graphs", () => {
    const f = causalClaimFixture(); expect(causalClaimDefinitionSchema.parse(f.definition)).not.toHaveProperty("providerProfile");
    expect(causalClaimDefinitionSchema.safeParse({ ...f.definition, providerProfile: profile, identificationStrategy: "association_only" }).success).toBe(false);
    expect(causalClaimDefinitionSchema.safeParse({ ...f.definition, providerProfile: profile, experimentEvidence: null }).success).toBe(false);
    expect(causalClaimDefinitionSchema.safeParse({ ...f.definition, providerProfile: profile, graph: { ...f.definition.graph, nodes: [...f.definition.graph.nodes, { key: "context", label: "Unqualified adjustment", role: "context" }] } }).success).toBe(false);
  });
});
