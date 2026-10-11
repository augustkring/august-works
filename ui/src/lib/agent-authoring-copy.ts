/** Translate fixed native readiness reasons without treating server copy as a locale. */
const blockerKeys = new Map<string, string>([
  ["hire_release_unavailable", "authoringBlockers.hire_release_unavailable"],
  ["outcome_required", "authoringBlockers.outcome_required"],
  ["identity_required", "authoringBlockers.identity_required"],
  ["instructions_required", "authoringBlockers.instructions_required"],
  ["references_changed", "authoringBlockers.references_changed"],
  ["production_baseline_changed", "authoringBlockers.production_baseline_changed"],
  ["runtime_required", "authoringBlockers.runtime_required"],
  ["representative_test_unqualified", "authoringBlockers.representative_test_unqualified"],
  ["native_promotion_unqualified", "authoringBlockers.native_promotion_unqualified"],
]);
export function agentAuthoringBlockerKey(code: string): string {
  return blockerKeys.get(code) ?? "authoringBlockers.unavailable";
}
