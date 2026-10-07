import { managementReviewDefinitionSchema, type CapturedManagementSource, type ManagementReviewDefinition, type ManagementReviewPacket } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { compareMetricTarget } from "../business-metrics/target-comparison.js";

function observation(source: CapturedManagementSource) {
  const pin = source.source.kind === "analytical" || source.source.kind === "canonical" ? source.source.reference : null, metric = source.metric;
  if (pin?.type !== "metric_observation" || !metric || metric.observation.id !== pin.id || metric.observation.metricId !== pin.metricId || metric.observation.versionId !== pin.metricVersionId) throw new Error("Comparison requires exact original owner-captured observations");
  return metric;
}
function comparisons(definition: ManagementReviewDefinition, ledger: Map<string, CapturedManagementSource>, asOf: string): ManagementReviewPacket["claims"] {
  return (definition.comparisons ?? []).map((comparison): ManagementReviewPacket["claims"][number] => {
    const left = ledger.get(comparison.leftSourceKey)!, right = ledger.get(comparison.rightSourceKey)!, after = observation(right), base = { key: `comparison_${comparison.key}`, sourceKeys: [left.key, right.key], grade: "native_observation" as const };
    const limitations = [...new Set([...left.limitations, ...right.limitations, "A cited numerical comparison does not establish the cause of a change or verify business impact."])];
    if (comparison.kind === "target_actual") {
      const pin = left.source.kind === "canonical" ? left.source.reference : null;
      if (pin?.type !== "metric_target" || !left.target || left.target.id !== pin.id || left.target.versionId !== pin.versionId) throw new Error("Comparison requires the exact owner-captured approved commitment");
      const result = compareMetricTarget(pin.id, pin.versionId, left.target.definition, after.observation, new Date(asOf));
      return { ...base, facts: { comparison: "actual_against_approved_commitment", status: result.status, observedValue: result.value, reason: result.reason, unit: after.unit, observationAsOf: result.asOf }, limitations };
    }
    const before = observation(left), a = before.observation, b = after.observation, at = Date.parse(asOf);
    let reason: string | null = null;
    if (a.companyId !== b.companyId || a.metricId !== b.metricId || a.versionId !== b.versionId || before.unit !== after.unit || before.timeSemantics !== after.timeSemantics) reason = "observation_definition_mismatch";
    else if (![a.from, a.until, b.from, b.until, a.asOf, b.asOf, a.expiresAt, b.expiresAt].every(value => Number.isFinite(Date.parse(value))) || Date.parse(a.asOf) > at || Date.parse(b.asOf) > at || Date.parse(a.expiresAt) <= at || Date.parse(b.expiresAt) <= at) reason = "observation_not_current";
    else if (Date.parse(a.until) !== Date.parse(b.from) || Date.parse(a.until) - Date.parse(a.from) !== Date.parse(b.until) - Date.parse(b.from) || Date.parse(a.from) >= Date.parse(a.until)) reason = "windows_not_consecutive_and_equal";
    else if (Date.parse(a.asOf) < Date.parse(a.until) || Date.parse(b.asOf) < Date.parse(b.until)) reason = "period_in_progress";
    else if (a.status !== "observed" || b.status !== "observed" || a.value === null || b.value === null || !Number.isFinite(a.value) || !Number.isFinite(b.value)) reason = "observation_unavailable";
    const change = reason === null ? b.value! - a.value! : null, relative = change !== null && a.value !== 0 ? change / Math.abs(a.value!) : null;
    if (change !== null && !Number.isFinite(change) || relative !== null && !Number.isFinite(relative)) reason = "comparison_not_finite";
    return { ...base, facts: { comparison: "two_cited_native_windows", status: reason ? "unknown" : "observed_change", reason, beforeValue: reason ? null : a.value, afterValue: reason ? null : b.value, absoluteChange: reason ? null : change, relativeChangeFraction: reason ? null : relative, unit: before.unit, direction: reason || change === null ? "unknown" : change > 0 ? "increase" : change < 0 ? "decrease" : "stable" }, limitations: [...limitations, "Two selected windows establish a descriptive change, not trend significance. Created-in-window current-state metrics retain their distinct cohorts and capture times; no historical period-end state is reconstructed.", "Relative change is unknown when the original value is zero."] };
  });
}

const grades = { metric_observation: "native_observation", process_finding: "native_observation", forecast_run: "predictive", scenario_run: "conditional_scenario", experiment_analysis: "human_interpreted_experiment", causal_analysis: "conditional_causal" } as const;
/** Pure formatting of an already admitted native ledger. This function does not
 * resolve authority, infer causes, rank people, dispatch work or publish. */
export function composeManagementReview(raw: ManagementReviewDefinition, sources: CapturedManagementSource[], asOf: string): ManagementReviewPacket {
  const definition = managementReviewDefinitionSchema.parse(raw), at = Date.parse(asOf);
  if (!Number.isFinite(at) || sources.length !== definition.sources.length || sources.length > 20) throw new Error("A complete bounded management source ledger is required");
  const ledger = new Map<string, CapturedManagementSource>();
  for (const source of sources) {
    const pin = definition.sources.find((item) => item.key === source.key);
    if (!pin || ledger.has(source.key) || nativeSha256(pin.source) !== nativeSha256(source.source) || !/^[a-f0-9]{64}$/.test(source.sourceHash)) throw new Error("Exact unique native management pins are required");
    if (!Number.isFinite(Date.parse(source.capturedAt)) || Date.parse(source.capturedAt) > at || !Number.isFinite(Date.parse(source.expiresAt)) || Date.parse(source.expiresAt) <= at) throw new Error("Current source capture and retention are required");
    const expectedGrade = source.source.kind === "analytical" ? grades[source.source.reference.type] : source.source.kind === "canonical" || source.source.kind === "governance_obligation" ? "native_current_state" : source.source.kind === "decision_outcome" ? "native_outcome_review" : "native_learning_cycle";
    if (source.outcome && (source.source.kind !== "decision_outcome" || source.outcome.id !== source.source.reviewId || source.outcome.decisionId !== source.source.decisionId || source.outcome.revision !== source.source.revision || source.outcome.receipts.length !== source.source.revision)) throw new Error("Outcome details require the exact original native review pin");
    if (source.governance && (source.source.kind !== "governance_obligation" || source.governance.id !== source.source.id || source.governance.contentHash !== source.source.contentHash || nativeSha256(source.governance.obligation) !== source.source.contentHash)) throw new Error("Governance details require the exact original native obligation pin");
    if (source.grade !== expectedGrade) throw new Error("A conditional source cannot be relabeled as an observed outcome");
    if (Object.keys(source.facts).length > 64 || Object.values(source.facts).some((value) => value !== null && typeof value !== "boolean" && !(typeof value === "string" && value.length <= 4000) && !(typeof value === "number" && Number.isFinite(value))) || source.limitations.length > 32 || source.limitations.some((value) => typeof value !== "string" || value.length > 4000)) throw new Error("Management source facts exceed the scalar presentation budget");
    ledger.set(source.key, source);
  }
  const ordered = definition.sources.map((item) => ledger.get(item.key)!);
  const material: Omit<ManagementReviewPacket, "contentHash"> = {
    engineVersion: "aw-native-management-skeleton-v1", definitionHash: nativeSha256(definition), inputHash: nativeSha256(ordered.map((item) => ({ key: item.key, source: item.source, sourceHash: item.sourceHash }))), asOf, period: definition.period,
    claims: [...ordered.map((source) => ({ key: `claim_${source.key}`, sourceKeys: [source.key], grade: source.grade, facts: structuredClone(source.facts), limitations: [...source.limitations] })), ...comparisons(definition, ledger, asOf)],
    agenda: definition.agenda.map((item) => ({ ...structuredClone(item), interpretation: "human_declared_agenda", hypothesisAuthority: item.hypothesis ? "human_hypothesis" : "none" })),
    coverage: "explicit_selected_native_sources", executionAuthority: "read_only_historical_review",
    limitations: ["Explicitly selected native sources; this is not a complete company census.", "Canonical state is observed at source capture, not reconstructed at a historical period boundary.", "Forecasts, scenarios, human interpretations and causal conditions retain their separate evidence grades.", "Agenda order and recommended actions are human declarations; they grant no execution or approval authority.", "Fewer than five agenda items are retained when fewer cited items were declared; no facts are invented to fill a quota.", "Scheduled invocation belongs to existing Routines; this packet sends no notification."],
  };
  if (new TextEncoder().encode(JSON.stringify(material)).length > 512000) throw new Error("Management review exceeds the bounded content budget");
  return { ...material, contentHash: nativeSha256(material) };
}
