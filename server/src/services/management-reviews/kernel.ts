import { managementReviewDefinitionSchema, type CapturedManagementSource, type ManagementReviewDefinition, type ManagementReviewPacket } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

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
    const expectedGrade = source.source.kind === "analytical" ? grades[source.source.reference.type] : source.source.kind === "canonical" ? "native_current_state" : source.source.kind === "decision_outcome" ? "native_outcome_review" : "native_learning_cycle";
    if (source.grade !== expectedGrade) throw new Error("A conditional source cannot be relabeled as an observed outcome");
    if (Object.keys(source.facts).length > 64 || Object.values(source.facts).some((value) => value !== null && typeof value !== "boolean" && !(typeof value === "string" && value.length <= 4000) && !(typeof value === "number" && Number.isFinite(value))) || source.limitations.length > 32 || source.limitations.some((value) => typeof value !== "string" || value.length > 4000)) throw new Error("Management source facts exceed the scalar presentation budget");
    ledger.set(source.key, source);
  }
  const ordered = definition.sources.map((item) => ledger.get(item.key)!);
  const material: Omit<ManagementReviewPacket, "contentHash"> = {
    engineVersion: "aw-native-management-skeleton-v1", definitionHash: nativeSha256(definition), inputHash: nativeSha256(ordered.map((item) => ({ key: item.key, source: item.source, sourceHash: item.sourceHash }))), asOf, period: definition.period,
    claims: ordered.map((source) => ({ key: `claim_${source.key}`, sourceKeys: [source.key], grade: source.grade, facts: structuredClone(source.facts), limitations: [...source.limitations] })),
    agenda: definition.agenda.map((item) => ({ ...structuredClone(item), interpretation: "human_declared_agenda", hypothesisAuthority: item.hypothesis ? "human_hypothesis" : "none" })),
    coverage: "explicit_selected_native_sources", executionAuthority: "read_only_historical_review",
    limitations: ["Explicitly selected native sources; this is not a complete company census.", "Canonical state is observed at source capture, not reconstructed at a historical period boundary.", "Forecasts, scenarios, human interpretations and causal conditions retain their separate evidence grades.", "Agenda order and recommended actions are human declarations; they grant no execution or approval authority.", "Fewer than five agenda items are retained when fewer cited items were declared; no facts are invented to fill a quota.", "Scheduled invocation belongs to existing Routines; this packet sends no notification."],
  };
  if (new TextEncoder().encode(JSON.stringify(material)).length > 512000) throw new Error("Management review exceeds the bounded content budget");
  return { ...material, contentHash: nativeSha256(material) };
}
