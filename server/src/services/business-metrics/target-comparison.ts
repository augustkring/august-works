import type { BusinessMetricTargetDefinition, BusinessMetricResult, BusinessMetricTargetComparison } from "@paperclipai/shared";
/** A target is a commitment, never an extrapolation. An open period does not
 * establish success/failure, including an already-reached reversible ratio. */
export function compareMetricTarget(targetId: string, targetVersionId: string, definition: BusinessMetricTargetDefinition, observation: BusinessMetricResult, now: Date): BusinessMetricTargetComparison {
  const base = { targetId, targetVersionId, observationId: observation.id, asOf: observation.asOf };
  if (observation.metricId !== definition.metricId || observation.versionId !== definition.metricVersionId || Date.parse(observation.from) !== Date.parse(definition.periodStart) || Date.parse(observation.until) !== Date.parse(definition.periodEnd)) return { ...base, status: "unknown", value: null, reason: "observation_definition_or_period_mismatch" };
  if (!Number.isFinite(now.getTime()) || ![observation.asOf, observation.expiresAt, definition.periodEnd].every(time => Number.isFinite(Date.parse(time))) || Date.parse(observation.asOf) > now.getTime() || Date.parse(observation.expiresAt) <= now.getTime()) return { ...base, status: "unknown", value: null, reason: "observation_not_current" };
  if (observation.status !== "observed" || observation.value === null || !Number.isFinite(observation.value)) return { ...base, status: "unknown", value: null, reason: observation.reason ?? "observation_unavailable" };
  if (Date.parse(observation.asOf) < Date.parse(definition.periodEnd)) return { ...base, status: "period_in_progress", value: observation.value, reason: "current_observation_is_not_a_forecast" };
  const criterion = definition.criterion;
  if (criterion.kind === "equals_boolean") return { ...base, status: "unknown", value: null, reason: "boolean_observation_provider_unqualified" };
  const met = criterion.kind === "between" ? observation.value >= criterion.lower && observation.value <= criterion.upper : criterion.kind === "at_least" ? observation.value >= criterion.value : observation.value <= criterion.value;
  return { ...base, status: met ? "met" : "not_met", value: observation.value, reason: null };
}
