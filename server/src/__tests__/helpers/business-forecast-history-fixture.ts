import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, businessMetricObservations, businessMetricPublications, businessMetrics, businessMetricVersions, issues, type Db } from "@paperclipai/db";
import { businessMetricDefinitionSchema, type BusinessMetricResult } from "@paperclipai/shared";
import { nativeSha256 } from "../../services/native-runtime/canonical.js";
import { metricDefinition } from "./business-metric-fixture.js";

/** The same chronologically coherent synthetic prerequisites as the Native
 * forecasting integration suite, reused for the built UI. These are NOT
 * collected historical observations, real outcomes or launch qualification.
 * Original lineage/SQL/current-source readers and calculation writers run. */
export async function businessForecastHistoryFixture(db: Db, companyId: string, projectId: string, policyId: string, values = Array(10).fill(1) as number[], ownerUserId = "local-board") {
  const day = 86400000, cutoff = new Date(Math.floor(Date.now() / day) * day), start = new Date(cutoff.getTime() - values.length * day), metricId = randomUUID(), versionId = randomUUID();
  const definition = businessMetricDefinitionSchema.parse({ ...metricDefinition(policyId), ownerUserId, valueType: "count", unit: "objects", reviewFrequencyDays: 60, freshnessSeconds: 20 * day / 1000,
    calculation: { kind: "native_count", population: { entity: "issue", statuses: ["done"], projectId } } });
  const definitionHash = nativeSha256(definition), createdAt = new Date(start.getTime() - day);
  await db.insert(businessMetrics).values({ id: metricId, companyId, key: `history_${randomUUID().replaceAll("-", "")}`, createdBy: ownerUserId, createdAt, updatedAt: createdAt });
  await db.insert(businessMetricVersions).values({ id: versionId, companyId, metricId, revision: 1, definition, contentHash: definitionHash, createdBy: ownerUserId, createdAt });
  await db.insert(businessMetricPublications).values({ companyId, metricId, versionId, publishedBy: ownerUserId, publishedAt: createdAt });
  await db.update(businessMetrics).set({ revision: 2, status: "published", publishedVersionId: versionId, updatedAt: createdAt }).where(eq(businessMetrics.id, metricId));
  const observations: BusinessMetricResult[] = [], sourceIds: string[] = [];
  const [policy] = await db.execute<{ h: string }>(sql`select obligation_hash as h from governance_obligations where id=${policyId}::uuid`);
  for (const [index, value] of values.entries()) {
    const from = new Date(start.getTime() + index * day), until = new Date(from.getTime() + day), observedAt = until, expiresAt = new Date(Date.now() + 20 * day), id = randomUUID(), manifestId = randomUUID(), inputHash = nativeSha256({ index, value });
    const ownIds = Array.from({ length: value }, () => randomUUID()); sourceIds.push(...ownIds);
    if (ownIds.length) await db.insert(issues).values(ownIds.map(id => ({ id, companyId, projectId, title: "PRIVATE synthetic forecast Source prose", status: "done", createdAt: new Date(from.getTime() + 43200000), updatedAt: new Date(from.getTime() + 43200000) })));
    await db.insert(analyticalLineageManifests).values({ id: manifestId, companyId, analysisType: "business_metric", analysisRef: id, engineVersion: "aw-native-metric-v1", inputHash, definitionHash, requestedBy: ownerUserId, sourceWatermark: observedAt.toISOString(), sourceCount: ownIds.length, parameters: { syntheticFixture: true }, createdAt: observedAt, expiresAt });
    await db.insert(analyticalLineageEdges).values([
      { companyId, manifestId, inputType: "metric_version", inputRef: versionId, inputHash: definitionHash, relationship: "definition" },
      { companyId, manifestId, inputType: "project", inputRef: projectId, inputHash: nativeSha256({ id: projectId }), relationship: "source" },
      { companyId, manifestId, inputType: "governance_obligation", inputRef: policyId, inputHash: policy.h, relationship: "policy" },
      ...ownIds.map(source => ({ companyId, manifestId, inputType: "issue" as const, inputRef: source, inputHash: nativeSha256({ id: source }), relationship: "source" as const })),
    ]);
    const result: BusinessMetricResult = { id, companyId, metricId, versionId, from: from.toISOString(), until: until.toISOString(), asOf: observedAt.toISOString(), expiresAt: expiresAt.toISOString(), status: "observed", value, reason: null, groups: [], inputHash, definitionHash, engineVersion: "aw-native-metric-v1", lineageManifestId: manifestId, sourceWatermark: observedAt.toISOString() };
    await db.insert(businessMetricObservations).values({ id, companyId, metricId, versionId, result, definitionHash, inputHash, lineageManifestId: manifestId, requestedBy: ownerUserId, observedAt, expiresAt }); observations.push(result);
  }
  return { metricId, versionId, cutoff, observations, sourceIds };
}
