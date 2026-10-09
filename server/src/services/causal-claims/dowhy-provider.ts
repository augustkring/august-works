import { doWhyCausalDiagnosticsSchema, doWhyCausalProfileSchema, type CausalClaimDefinition, type DoWhyCausalProfile, type NativeCausalResult, type NativeCausalSource } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { evaluateNativeCausalClaim } from "./kernel.js";
import { DoWhyWorkerError, runDoWhyWorker, type DoWhyWorkerRequest } from "./dowhy-worker.js";
// Fixed public synthetic software proofs only; never cache tenant data/results.
const profiles = new Map<string, DoWhyCausalProfile>();
async function numeric(input: DoWhyWorkerRequest, options: Parameters<typeof runDoWhyWorker>[1]) { const output = await runDoWhyWorker(input, options); if (!("effect" in output)) throw new DoWhyWorkerError("invalid_result"); return output; }
export async function currentDoWhyCausalProfile(options: Parameters<typeof runDoWhyWorker>[1] = {}): Promise<DoWhyCausalProfile> {
  const health = await runDoWhyWorker({ operation: "health" }, options);
  if (!("dependencies" in health)) throw new DoWhyWorkerError("invalid_result");
  const cached = profiles.get(health.bundleHash); if (cached) return cached;
  const input: DoWhyWorkerRequest = { operation: "registered_binary_itt", control: { units: 8, successes: 2 }, treatment: { units: 8, successes: 6 } };
  const positive = await numeric(input, options), repeated = await numeric(input, options), constant = await numeric({ ...input, control: { units: 8, successes: 0 }, treatment: { units: 8, successes: 0 } }, options);
  if ([positive, repeated, constant].some(output => output.bundleHash !== health.bundleHash) || Math.abs(positive.effect - 0.5) > 1e-9 || nativeSha256(positive) !== nativeSha256(repeated) || positive.refutations.some(item => item.status !== "passed") || constant.effect !== 0 || constant.refutations.some(item => item.status !== "unknown" || item.pValue !== null)) throw new DoWhyWorkerError("invalid_result");
  const profile = doWhyCausalProfileSchema.parse({ provider: "dowhy", version: "0.14", python: "3.12.14", bundleHash: health.bundleHash, conformanceHash: nativeSha256({ contract: "aw-dowhy-registered-binary-conformance-v1", health, input, positive, repeated, constant }) });
  if (profiles.size >= 4) profiles.clear(); profiles.set(health.bundleHash, profile); return profile;
}
/** Pure retained replay: re-admit native result and signed fixed diagnostics.
 * Retained replay never invokes Python; health/conformance admission is separate. */
export function replayDoWhyCausalClaim(definition: CausalClaimDefinition, source: NativeCausalSource | null, raw?: NativeCausalResult["providerAnalysis"]): NativeCausalResult {
  const native = evaluateNativeCausalClaim(definition, source);
  if (!native.estimate) { if (raw) throw new DoWhyWorkerError("invalid_result"); return native; }
  if (!raw || !definition.providerProfile || nativeSha256(raw.profile) !== nativeSha256(definition.providerProfile) || raw.nativeResultHash !== nativeSha256(native)) throw new DoWhyWorkerError("invalid_result");
  const diagnostics = doWhyCausalDiagnosticsSchema.parse(raw.diagnostics);
  if (diagnostics.bundleHash !== definition.providerProfile.bundleHash || Math.abs(diagnostics.effect - native.estimate.effect) > 1e-9) throw new DoWhyWorkerError("invalid_result");
  const refutations = diagnostics.refutations.some(item => item.status === "failed") ? "failed" : diagnostics.refutations.every(item => item.status === "passed") ? "passed" : "unknown";
  return { ...native, providerAnalysis: { profile: definition.providerProfile, nativeResultHash: raw.nativeResultHash, diagnostics }, robustness: { ...native.robustness, providerRefutations: refutations }, status: refutations === "passed" ? native.status : "inconclusive", language: refutations === "passed" ? native.language : "causal_reliance_withheld", reasons: refutations === "passed" ? native.reasons : [...native.reasons, "optional_provider_refutations_do_not_admit_causal_reliance"], limitations: [...native.limitations.filter(value => !value.includes("No independent provider refutation")), "Exposure/concurrent-change assessments remain human attestations; three bounded DoWhy diagnostics ran, while sensitivity and refutation calibration remain unknown.", "Anonymous sufficient-count diagnostics do not independently establish interference, external validity, verified outcomes or business impact."] };
}
export async function evaluateDoWhyCausalClaim(definition: CausalClaimDefinition, source: NativeCausalSource | null, options: Parameters<typeof runDoWhyWorker>[1] = {}): Promise<NativeCausalResult> {
  const native = evaluateNativeCausalClaim(definition, source);
  if (!native.estimate) return native;
  const profile = await currentDoWhyCausalProfile(options);
  if (!definition.providerProfile || nativeSha256(profile) !== nativeSha256(definition.providerProfile)) throw new DoWhyWorkerError("invalid_result");
  const primary = source!.analysis.result.metrics.find(item => item.role === "primary" && item.key === source!.definition.primaryMetric.key)!;
  const diagnostics = await numeric({ operation: "registered_binary_itt", control: { units: primary.control.units, successes: primary.control.successes }, treatment: { units: primary.treatment.units, successes: primary.treatment.successes } }, options);
  return replayDoWhyCausalClaim(definition, source, { profile, nativeResultHash: nativeSha256(native), diagnostics });
}
