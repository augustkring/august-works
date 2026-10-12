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
  ["publication_baseline_changed", "authoringBlockers.publication_baseline_changed"],
  ["publication_agent_not_ready", "authoringBlockers.publication_agent_not_ready"],
  ["publication_work_in_flight", "authoringBlockers.publication_work_in_flight"],
  ["publication_native_guards_missing", "authoringBlockers.publication_native_guards_missing"],
  ["publication_runtime_changed", "authoringBlockers.publication_runtime_changed"],
  ["knowledge_mapping_required", "authoringBlockers.knowledge_mapping_required"],
  ["memory_mapping_required", "authoringBlockers.memory_mapping_required"],
  ["internal_draft_authority_required", "authoringBlockers.internal_draft_authority_required"],
  ["capability_mapping_required", "authoringBlockers.capability_mapping_required"],
]);
export function agentAuthoringBlockerKey(code: string): string {
  return blockerKeys.get(code) ?? "authoringBlockers.unavailable";
}
