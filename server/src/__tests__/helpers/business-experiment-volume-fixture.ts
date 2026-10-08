import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, businessExperimentAssignments, businessExperimentExecutions, businessExperimentExposures, businessExperimentVersions, issues, type Db } from "@paperclipai/db";
import { nativeSha256 } from "../../services/native-runtime/canonical.js";
import { calculateNativeMetric } from "../../services/business-metrics/native-engine.js";
import { businessMetricService } from "../../services/business-metrics/service.js";
import { assignmentMaterial, exposureMaterial, EXPERIMENT_OWNER_ENGINE, experimentAssignmentKey, experimentEdges, signedExperimentReceipt, type ExperimentAssignment, type ExperimentExposure } from "../../services/business-experiments/receipts.js";
import { assignNativeBusinessExperimentUnit } from "../../services/business-experiments/kernel.js";

/** Explicit bulk software prerequisites for maximum-population reader testing.
 * Actual same-company native Tasks, original signing/calculation owners and all
 * migrated PostgreSQL guards run. This does NOT perform 4,000 enrollment commands,
 * Human attestations, provider execution, a business trial or observed outcomes. */
export async function experimentVolumeFixture(db: Db, companyId: string, versionId: string, count: number, exposureReports = false) {
  const actor = { type: "board" as const, source: "local_implicit" as const };
  const [version] = await db.select().from(businessExperimentVersions).where(and(eq(businessExperimentVersions.companyId, companyId), eq(businessExperimentVersions.id, versionId)));
  const [execution] = await db.select().from(businessExperimentExecutions).where(and(eq(businessExperimentExecutions.companyId, companyId), eq(businessExperimentExecutions.versionId, versionId)));
  const inherited = await db.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), eq(analyticalLineageEdges.manifestId, version.lineageManifestId)));
  const definitions = new Map<string, Awaited<ReturnType<ReturnType<typeof businessMetricService>["inspectPublishedDefinition"]>>>();
  for (const pin of version.metricPins.filter(pin => pin.role === "invariant")) definitions.set(pin.key, await businessMetricService(db).inspectPublishedDefinition(companyId, actor, pin.metricId, pin.metricVersionId));
  const at = new Date(), key = experimentAssignmentKey(companyId, versionId);
  const units: Array<typeof issues.$inferSelect> = [];
  for (let offset = 0; offset < count; offset += 200) units.push(...await db.insert(issues).values(Array.from({ length: Math.min(200, count - offset) }, () => ({ companyId, title: "Explicit synthetic maximum-population Source prerequisite", status: "todo", createdAt: at, updatedAt: at }))).returning());
  await db.transaction(async tx => {
    for (let offset = 0; offset < units.length; offset += 100) {
      const assignments: ExperimentAssignment[] = [], manifests: Array<typeof analyticalLineageManifests.$inferInsert> = [], lineage: Array<typeof analyticalLineageEdges.$inferInsert> = [];
      for (const unit of units.slice(offset, offset + 100)) {
        const snapshot = { id: unit.id, entity: "issue" as const, status: unit.status, projectId: unit.projectId, createdAt: unit.createdAt.toISOString(), updatedAt: unit.updatedAt.toISOString() };
        const invariantReceipts = version.metricPins.filter(pin => pin.role === "invariant").map(pin => {
          const calculated = calculateNativeMetric(definitions.get(pin.key)!.version.definition, { metricId: pin.metricId, versionId: pin.metricVersionId, from: version.definition.sampleOrDurationPlan.from, until: version.definition.sampleOrDurationPlan.until, dimensions: [], maxRows: 1 }, [snapshot]);
          if (calculated.status !== "observed" || calculated.value !== 0 && calculated.value !== 1) throw new Error("Volume prerequisite has no exact native binary invariant");
          return { key: pin.key, metricId: pin.metricId, metricVersionId: pin.metricVersionId, observedAt: at.toISOString(), value: calculated.value as 0 | 1, inputHash: calculated.inputHash };
        });
        const value: ExperimentAssignment = { id: randomUUID(), companyId, experimentId: version.experimentId, versionId, unitType: "issue", unitId: unit.id, issueId: unit.id, projectId: null, arm: assignNativeBusinessExperimentUnit(key, companyId, versionId, unit.id, version.definition.assignment.treatmentProbability), sourceSnapshot: snapshot, sourceHash: nativeSha256({ snapshot, invariantReceipts }), invariantReceipts, lineageManifestId: randomUUID(), receiptHash: "", signature: "", assignedBy: "local-board", assignedAt: at };
        Object.assign(value, signedExperimentReceipt("assignment", assignmentMaterial(value, execution.receiptHash, version.contentHash)));
        const edges = experimentEdges([...inherited, { inputType: "issue", inputRef: unit.id, inputHash: nativeSha256({ type: "issue", id: unit.id }), relationship: "source" }]);
        manifests.push({ id: value.lineageManifestId, companyId, analysisType: "experiment_assignment", analysisRef: value.id, engineVersion: EXPERIMENT_OWNER_ENGINE, definitionHash: version.contentHash, inputHash: value.sourceHash, requestedBy: "local-board", sourceWatermark: snapshot.updatedAt, sourceCount: edges.length, parameters: { receiptHash: value.receiptHash, lineageHash: nativeSha256(edges) }, createdAt: at, expiresAt: version.expiresAt });
        lineage.push(...edges.map(edge => ({ ...edge, companyId, manifestId: value.lineageManifestId }))); assignments.push(value);
      }
      await tx.insert(analyticalLineageManifests).values(manifests);
      await tx.insert(analyticalLineageEdges).values(lineage);
      await tx.insert(businessExperimentAssignments).values(assignments);
      if (exposureReports) await tx.insert(businessExperimentExposures).values(assignments.map(assignment => {
        const exposure: ExperimentExposure = { id: randomUUID(), companyId, experimentId: version.experimentId, versionId, assignmentId: assignment.id, arm: assignment.arm, status: "not_applied", provenance: "human_attestation", assertedAppliedAt: null, rationale: "Explicit synthetic software prerequisite; no actual Human or intervention trial performed", receiptHash: "", signature: "", recordedBy: "local-board", recordedAt: at };
        return Object.assign(exposure, signedExperimentReceipt("exposure", exposureMaterial(exposure, assignment.receiptHash)));
      }));
    }
  });
  return units;
}
