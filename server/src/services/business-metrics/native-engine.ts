import { businessMetricDefinitionSchema, queryBusinessMetricSchema, type BusinessMetricDefinition, type BusinessMetricQuery, type BusinessMetricResult } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

export const NATIVE_METRIC_ENGINE_VERSION = "aw-native-metric/v1";
export interface NativeMetricInput {
  id: string; entity: "issue" | "project"; status: string; projectId: string | null;
  createdAt: string; updatedAt: string;
}
/** Inputs must already be complete, company-bound and authorized. This pure
 * engine never selects, joins, or silently imputes data. */
export function calculateNativeMetric(rawDefinition: BusinessMetricDefinition, rawQuery: BusinessMetricQuery, inputs: NativeMetricInput[]) {
  const definition = businessMetricDefinitionSchema.parse(rawDefinition);
  const query = queryBusinessMetricSchema.parse(rawQuery);
  const calculation = definition.calculation;
  if (calculation.kind === "external_metric") throw new Error("External authority requires its qualified provider");
  if (inputs.length > query.maxRows) throw new Error("Native input budget exceeded");
  if (query.dimensions.some(dimension => !definition.dimensions.includes(dimension))) throw new Error("Undeclared metric dimension");
  const population = calculation.kind === "native_count" ? calculation.population : calculation.denominator;
  const seen = new Set<string>();
  for (const row of inputs) {
    if (seen.has(row.id)) throw new Error("Duplicate native object");
    seen.add(row.id);
    if (row.entity !== population.entity || !population.statuses.includes(row.status as never)
      || (population.entity === "issue" && population.projectId !== null && row.projectId !== population.projectId)
      || !Number.isFinite(Date.parse(row.createdAt)) || Date.parse(row.createdAt) < Date.parse(query.from) || Date.parse(row.createdAt) >= Date.parse(query.until)
      || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error("Input is outside the declared population");
  }
  const ordered = [...inputs].sort((a, b) => a.id.localeCompare(b.id));
  const groups = new Map<string, { dimensions: Record<string, string | null>; numerator: number; denominator: number }>();
  let numerator = 0;
  for (const row of ordered) {
    const contributes = calculation.kind === "native_count" || calculation.numerator.statuses.includes(row.status as never);
    if (contributes) numerator++;
    if (query.dimensions.length) {
      const dimensions = Object.fromEntries(query.dimensions.map(dimension => [dimension, dimension === "status" ? row.status : row.projectId]));
      const key = JSON.stringify(dimensions);
      const group = groups.get(key) ?? { dimensions, numerator: 0, denominator: 0 };
      group.denominator++; if (contributes) group.numerator++;
      groups.set(key, group);
    }
  }
  const ratio = calculation.kind === "native_ratio";
  const undefinedValue = ratio && ordered.length === 0;
  return {
    status: (undefinedValue ? "undefined" : "observed") as BusinessMetricResult["status"],
    value: undefinedValue ? null : ratio ? numerator / ordered.length : numerator,
    reason: undefinedValue ? "empty_denominator" : null,
    groups: [...groups.values()].map(group => ({ dimensions: group.dimensions,
      value: ratio ? group.numerator / group.denominator : group.numerator,
      ...(ratio ? { numerator: group.numerator, denominator: group.denominator } : {}),
    })),
    inputHash: nativeSha256({ engine: NATIVE_METRIC_ENGINE_VERSION, from: query.from, until: query.until, dimensions: query.dimensions, inputs: ordered }),
    definitionHash: nativeSha256(definition),
    sourceWatermark: ordered.reduce((latest, row) => row.updatedAt > latest ? row.updatedAt : latest, "") || "empty_population",
  };
}
