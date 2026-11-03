import { businessMetricDefinitionSchema, queryBusinessMetricSchema, type BusinessMetricDefinition, type BusinessMetricQuery, type BusinessMetricResult } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

export const NATIVE_METRIC_ENGINE_VERSION = "aw-native-metric/v1";
export interface NativeMetricInput {
  id: string; entity: "issue" | "project"; status: string; projectId: string | null;
  createdAt: string; updatedAt: string;
}
const preparedInputs = new WeakMap<object, { envelope: string; rows: NativeMetricInput[]; inputHash: string }>();
export type PreparedNativeMetricInput = object;
function freezeCopy<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freezeCopy(child);
    Object.freeze(value);
  }
  return value;
}
function inputEnvelope(query: BusinessMetricQuery) {
  return JSON.stringify({ engine: NATIVE_METRIC_ENGINE_VERSION, from: query.from, until: query.until, dimensions: query.dimensions });
}
/** Prepare one immutable, exact singleton input lineage for reuse by multiple
 * metric definitions over the same query. Each calculator still performs its
 * own definition-specific population validation and arithmetic. */
export function prepareNativeMetricInput(rawQuery: BusinessMetricQuery, rawInputs: NativeMetricInput[]): PreparedNativeMetricInput {
  const query = queryBusinessMetricSchema.parse(rawQuery);
  const rows = freezeCopy(structuredClone(rawInputs)) as NativeMetricInput[];
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const token = Object.freeze({});
  preparedInputs.set(token, { envelope: inputEnvelope(query), rows, inputHash: nativeSha256({ engine: NATIVE_METRIC_ENGINE_VERSION, from: query.from, until: query.until, dimensions: query.dimensions, inputs: ordered }) });
  return token;
}
/** Inputs must already be complete, company-bound and authorized. This pure
 * engine never selects, joins, or silently imputes data. */
export function prepareNativeMetric(rawDefinition: BusinessMetricDefinition, rawQuery: BusinessMetricQuery) {
  const definition = businessMetricDefinitionSchema.parse(rawDefinition);
  const query = queryBusinessMetricSchema.parse(rawQuery);
  const calculation = definition.calculation;
  if (calculation.kind === "external_metric") throw new Error("External authority requires its qualified provider");
  const definitionHash=nativeSha256(definition),from=Date.parse(query.from),until=Date.parse(query.until);
  const envelope = inputEnvelope(query);
  return (rawInputs:NativeMetricInput[] | PreparedNativeMetricInput) => {
    const prepared = !Array.isArray(rawInputs) ? preparedInputs.get(rawInputs) : undefined;
    if (!Array.isArray(rawInputs) && (!prepared || prepared.envelope !== envelope)) throw new Error("Prepared native input does not match the exact metric query");
    const inputs = prepared?.rows ?? rawInputs as NativeMetricInput[];
    if (inputs.length > query.maxRows) throw new Error("Native input budget exceeded");
    if (query.dimensions.some(dimension => !definition.dimensions.includes(dimension))) throw new Error("Undeclared metric dimension");
    const population = calculation.kind === "native_count" ? calculation.population : calculation.denominator;
    const seen = new Set<string>();
    for (const row of inputs) {
      if (seen.has(row.id)) throw new Error("Duplicate native object");
      seen.add(row.id);
      if (row.entity !== population.entity || !population.statuses.includes(row.status as never)
        || (population.entity === "issue" && population.projectId !== null && row.projectId !== population.projectId)
        || !Number.isFinite(Date.parse(row.createdAt)) || Date.parse(row.createdAt) < from || Date.parse(row.createdAt) >= until
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
      inputHash: prepared?.inputHash ?? nativeSha256({ engine: NATIVE_METRIC_ENGINE_VERSION, from: query.from, until: query.until, dimensions: query.dimensions, inputs: ordered }),
      definitionHash,
      sourceWatermark: ordered.reduce((latest, row) => row.updatedAt > latest ? row.updatedAt : latest, "") || "empty_population",
    };
  };
}

/** One-shot callers retain the original validation, arithmetic and hashes. */
export function calculateNativeMetric(rawDefinition:BusinessMetricDefinition,rawQuery:BusinessMetricQuery,inputs:NativeMetricInput[]) {
  return prepareNativeMetric(rawDefinition,rawQuery)(inputs);
}
