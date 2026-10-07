import {assertAnalyticalReader,analyticalPrincipalId} from "../analytical-reader.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  businessScenarios, businessScenarioVersions, businessScenarioSourcePins, businessScenarioPublications, businessScenarioRuns, businessScenarioCalculationPins,
  analyticalLineageManifests, analyticalLineageEdges, businessMetricObservations, companyMemberships, type Db,
} from "@paperclipai/db";
import {
  businessScenarioDefinitionSchema, createBusinessScenarioSchema, reviseBusinessScenarioSchema, publishBusinessScenarioSchema,
  runBusinessScenarioSchema, retireBusinessScenarioSchema, sameBusinessScenarioUnit, v7FeatureEnabled, v8FeatureEnabled,
  type BusinessMetricDefinition, type BusinessScenarioDefinition, type BusinessScenarioCapturedInput, type BusinessScenarioUnit,
  type BusinessScenarioView, type BusinessScenarioVersionView, type BusinessScenarioRunView,
  type CreateBusinessScenario, type ReviseBusinessScenario, type PublishBusinessScenario, type RunBusinessScenario, type RetireBusinessScenario,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockBusinessEventCompany } from "../business-event-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";
import { authorizeStrategyReference } from "../strategy-execution/references.js";
import { inspectDecisionSourceAuthority } from "../decision-intelligence.js";
import { businessMetricService } from "../business-metrics/service.js";
import { inspectBusinessForecastRun } from "../business-forecasting/service.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { evaluateNativeBusinessScenario } from "./kernel.js";
import { inspectScenarioArtifact, executeScenarioArtifact } from "./artifacts.js";

type Root = typeof businessScenarios.$inferSelect;
type Version = typeof businessScenarioVersions.$inferSelect;
type Run = typeof businessScenarioRuns.$inferSelect;
type Edge = Pick<typeof analyticalLineageEdges.$inferInsert, "inputType" | "inputRef" | "inputHash" | "relationship">;
const DAY = 86_400_000, MAX_EDGES = 20_065, ENGINE = "aw-native-business-scenario-owner-v1";
function budget(deadline: number) { if (performance.now() > deadline) throw unprocessable("Scenario exceeds the native source time budget"); }
function mergeEdges(groups: Edge[][]) {
  const entries = new Map<string, Edge>();
  for (const group of groups) for (const edge of group) {
    const item: Edge = { inputType: edge.inputType, inputRef: edge.inputRef, relationship: edge.relationship,
      inputHash: edge.inputType === "issue" || edge.inputType === "project" ? nativeSha256({ type: edge.inputType, id: edge.inputRef }) : edge.inputHash };
    const key = `${item.inputType}:${item.inputRef}`, prior = entries.get(key);
    if (prior && prior.inputHash !== item.inputHash) throw conflict("Scenario source definition pins conflict");
    entries.set(key, item);
    if (entries.size > MAX_EDGES) throw unprocessable("Scenario exceeds its bounded native source population");
  }
  return [...entries.values()].sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
}
async function lineage(tx: Db, companyId: string, id: string) {
  const [manifest] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), eq(analyticalLineageManifests.id, id))).for("share");
  const edges = await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), eq(analyticalLineageEdges.manifestId, id))).limit(MAX_EDGES + 1);
  if (!manifest || manifest.expiresAt <= new Date() || edges.length > MAX_EDGES) throw notFound("Scenario source lineage is erased or expired");
  return { manifest, edges: mergeEdges([edges]) };
}
async function admit(tx: Db, companyId: string, actor: AuthorizationActor, write = false, flagsRequired = true) {
  if(write)v7HumanActorId(actor);else await assertAnalyticalReader(tx,companyId,actor);
  await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
  const flags = await instanceSettingsService(tx).getExperimental();
  if (flagsRequired && (!v8FeatureEnabled(flags, "scenario_planning_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7"))) throw notFound("Governed scenario planning is not enabled");
  await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
  await tx.execute(sql`set local statement_timeout='8s'`);
}
async function root(tx: Db, companyId: string, id: string) {
  const [row] = await tx.select().from(businessScenarios).where(and(eq(businessScenarios.companyId, companyId), eq(businessScenarios.id, id))).for("update");
  if (!row) throw notFound("Scenario is unavailable"); return row;
}
function rootView(row: Root): BusinessScenarioView { return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function versionView(row: Version, current: boolean): BusinessScenarioVersionView {
  return { id: row.id, companyId: row.companyId, scenarioId: row.scenarioId, revision: row.revision, definition: row.definition, contentHash: row.contentHash, inputHash: row.inputHash, inputs: row.inputs,
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), currentQualification: current ? "current" : "needs_revalidation" };
}
function metricUnit(definition: BusinessMetricDefinition): BusinessScenarioUnit {
  if (definition.authorityMode !== "aw_native" || !["native_count", "native_ratio"].includes(definition.calculation.kind)) throw conflict("A qualified native scenario metric source is required");
  return definition.calculation.kind === "native_count" ? { [definition.grain]: 1 } : {};
}
async function capture(tx: Db, companyId: string, actor: AuthorizationActor, definition: BusinessScenarioDefinition, requireCurrent: boolean, deadline: number) {
  const policies = await currentAnalyticalPurpose(tx, companyId, definition, "scenario");
  const ownerIds = [...new Set([definition.ownerUserId, ...definition.assumptions.map(item => item.ownerUserId)])].filter(id => id !== analyticalPrincipalId(actor));
  if (ownerIds.length) {
    const owners = await tx.select({ id: companyMemberships.principalId }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.status, "active"), inArray(companyMemberships.principalId, ownerIds))).for("share");
    if (ownerIds.some(id => !owners.some(owner => owner.id === id))) throw conflict("All scenario and assumption owners must be current company humans");
  }
  let expiresAt = new Date(Math.min(Date.now() + definition.retentionDays * DAY, ...policies.map(policy => policy.nextReviewAt.getTime())));
  let edges: Edge[] = policies.map(policy => ({ inputType: "governance_obligation", inputRef: policy.id, inputHash: policy.obligationHash, relationship: "policy" }));
  if (definition.scope.type === "project") {
    await authorizeStrategyReference(tx, companyId, actor, { type: "project", id: definition.scope.id }, definition.sensitivity);
    edges.push({ inputType: "project", inputRef: definition.scope.id, inputHash: nativeSha256({ type: "project", id: definition.scope.id }), relationship: "source" });
  }
  const calculation = await inspectScenarioArtifact(tx, companyId, actor, definition, requireCurrent);
  const inputs: BusinessScenarioCapturedInput[] = []; let current = calculation?.current ?? true;
  for (const input of definition.inputs) {
    budget(deadline); let value: number, contentHash: string, unit: BusinessScenarioUnit, manifestId: string, sourceExpires: Date, sourceSensitivity: "internal" | "confidential";
    if (input.kind === "metric_observation") {
      const measurement = await businessMetricService(tx).inspectCurrentObservation(companyId, actor, input.observationId);
      budget(deadline);
      const metric = await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, input.metricId, input.metricVersionId);
      if (measurement.metricId !== input.metricId || measurement.versionId !== input.metricVersionId || measurement.status !== "observed" || measurement.value === null || !Number.isFinite(measurement.value)) throw conflict("Scenario requires exact observed native measurement pins");
      if (metric.metric.publishedVersionId !== input.metricVersionId) current = false;
      const [correction] = await tx.select({ id: businessMetricObservations.id }).from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId, companyId), eq(businessMetricObservations.metricId, input.metricId), eq(businessMetricObservations.versionId, input.metricVersionId),
        sql`${businessMetricObservations.id}<>${input.observationId}::uuid`, sql`${businessMetricObservations.observedAt}>=${measurement.asOf}::timestamptz`, sql`${businessMetricObservations.expiresAt}>now()`,
        sql`(${businessMetricObservations.result}->>'from')::timestamptz=${measurement.from}::timestamptz`, sql`(${businessMetricObservations.result}->>'until')::timestamptz=${measurement.until}::timestamptz`)).limit(1);
      // Equal capture times are ambiguous, not resolved by arbitrary UUID order.
      if (correction) current = false;
      const [observation] = await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId, companyId), eq(businessMetricObservations.id, input.observationId))).for("share");
      if (!observation) throw notFound("Scenario measurement was erased");
      unit = metricUnit(metric.version.definition); value = measurement.value; contentHash = nativeSha256(measurement);
      sourceSensitivity = metric.version.definition.sensitivity; manifestId = observation.lineageManifestId;
      sourceExpires = new Date(Math.min(observation.expiresAt.getTime(), metric.version.createdAt.getTime() + metric.version.definition.reviewFrequencyDays * DAY));
      if (value < 0 || metric.version.definition.valueType === "ratio" && value > 1 || metric.version.definition.valueType === "count" && !Number.isInteger(value)) throw conflict("Scenario measurement exceeds its native value domain");
    } else {
      const forecast = await inspectBusinessForecastRun(tx, companyId, actor, input.specId, input.versionId, input.runId, requireCurrent);
      budget(deadline);
      const point = forecast.view.result.points[input.pointIndex];
      if (!point || forecast.view.result.status !== "qualified" || !Number.isFinite(point.value)) throw conflict("Scenario requires a retained native forecast point");
      if (forecast.view.currentQualification !== "qualified") current = false;
      unit = metricUnit(forecast.metricDefinition); value = point.value;
      contentHash = nativeSha256({ runContentHash: forecast.view.contentHash, pointIndex: input.pointIndex, point });
      sourceSensitivity = forecast.forecastDefinition.sensitivity; manifestId = forecast.lineageManifestId; sourceExpires = new Date(forecast.view.expiresAt);
    }
    if (definition.sensitivity === "internal" && sourceSensitivity === "confidential") throw conflict("Scenario sensitivity cannot weaken its source");
    if (!sameBusinessScenarioUnit(unit, input.unit)) throw conflict("Scenario declared unit differs from its actual native source");
    const source = await lineage(tx, companyId, manifestId); budget(deadline);
    edges = mergeEdges([edges, source.edges]); expiresAt = new Date(Math.min(expiresAt.getTime(), sourceExpires.getTime(), source.manifest.expiresAt.getTime()));
    inputs.push({ key: input.key, kind: input.kind, sourceId: input.kind === "metric_observation" ? input.observationId : input.runId,
      versionId: input.kind === "metric_observation" ? input.metricVersionId : input.versionId, pointIndex: input.kind === "forecast_point" ? input.pointIndex : null, value, unit, contentHash });
  }
  if (requireCurrent && !current) throw conflict("Scenario requires current source definitions and qualified forecast pins");
  edges = mergeEdges([edges]); await inspectDecisionSourceAuthority(tx, companyId, actor, edges, deadline); budget(deadline);
  if (expiresAt <= new Date()) throw conflict("Scenario source evidence expired during admission");
  return { inputs, edges, expiresAt, current, calculation };
}
async function appendManifest(tx: Db, companyId: string, id: string, type: string, actor: AuthorizationActor, definitionHash: string, inputHash: string, createdAt: Date, expiresAt: Date, edges: Edge[], parameters: Record<string, unknown>) {
  const manifestId = randomUUID();
  await tx.insert(analyticalLineageManifests).values({ id: manifestId, companyId, analysisRef: id, analysisType: type, engineVersion: ENGINE, definitionHash, inputHash, requestedBy: v7HumanActorId(actor),
    sourceWatermark: createdAt.toISOString(), sourceCount: edges.length, parameters: { ...parameters, lineageHash: nativeSha256(edges) }, createdAt, expiresAt });
  for (let start = 0; start < edges.length; start += 500) await tx.insert(analyticalLineageEdges).values(edges.slice(start, start + 500).map(edge => ({ ...edge, companyId, manifestId })));
  return manifestId;
}
async function appendVersion(tx: Db, row: Root, actor: AuthorizationActor, definition: BusinessScenarioDefinition, deadline: number) {
  const admitted = await capture(tx, row.companyId, actor, definition, true, deadline), id = randomUUID(), contentHash = nativeSha256(definition), inputHash = nativeSha256(admitted.inputs);
  const lineageManifestId = await appendManifest(tx, row.companyId, id, "scenario_version", actor, contentHash, inputHash, row.updatedAt, admitted.expiresAt, admitted.edges, { revision: row.revision });
  const [value] = await tx.insert(businessScenarioVersions).values({ id, companyId: row.companyId, scenarioId: row.id, revision: row.revision, definition, contentHash, inputHash, inputs: admitted.inputs,
    lineageManifestId, createdBy: v7HumanActorId(actor), createdAt: row.updatedAt, expiresAt: admitted.expiresAt }).returning();
  if (definition.inputs.length) await tx.insert(businessScenarioSourcePins).values(definition.inputs.map(input => ({ companyId: row.companyId, scenarioId: row.id, versionId: id, inputKey: input.key,
    metricObservationId: input.kind === "metric_observation" ? input.observationId : null, forecastRunId: input.kind === "forecast_point" ? input.runId : null })));
  if (definition.calculationRef) await tx.insert(businessScenarioCalculationPins).values({ companyId: row.companyId, scenarioId: row.id, versionId: id,
    artifactVersionId: definition.calculationRef.versionId, artifactHash: definition.calculationRef.contentHash });
  budget(deadline); return value;
}
async function version(tx: Db, row: Root, actor: AuthorizationActor, id: string, requireCurrent: boolean, deadline: number) {
  const [value] = await tx.select().from(businessScenarioVersions).where(and(eq(businessScenarioVersions.companyId, row.companyId), eq(businessScenarioVersions.scenarioId, row.id), eq(businessScenarioVersions.id, id))).for("share");
  if (!value || value.expiresAt <= new Date() || !businessScenarioDefinitionSchema.safeParse(value.definition).success || nativeSha256(value.definition) !== value.contentHash || nativeSha256(value.inputs) !== value.inputHash) throw notFound("Scenario definition is erased or expired");
  const admitted = await capture(tx, row.companyId, actor, value.definition, requireCurrent, deadline), source = await lineage(tx, row.companyId, value.lineageManifestId);
  if (nativeSha256(admitted.inputs) !== value.inputHash || source.manifest.engineVersion !== ENGINE || source.manifest.analysisType !== "scenario_version" || source.manifest.analysisRef !== value.id
    || source.manifest.definitionHash !== value.contentHash || source.manifest.inputHash !== value.inputHash || source.manifest.sourceCount !== source.edges.length
    || source.manifest.createdAt.getTime() !== value.createdAt.getTime() || source.manifest.expiresAt.getTime() !== value.expiresAt.getTime() || source.manifest.parameters.lineageHash !== nativeSha256(source.edges)
    || nativeSha256(admitted.edges) !== nativeSha256(source.edges)) throw conflict("Scenario captured source or lineage integrity is unavailable");
  const calculations = await tx.select().from(businessScenarioCalculationPins).where(and(eq(businessScenarioCalculationPins.companyId, row.companyId), eq(businessScenarioCalculationPins.versionId, value.id))).for("share");
  const ref = value.definition.calculationRef;
  if (ref ? calculations.length !== 1 || calculations[0].scenarioId !== row.id || calculations[0].artifactVersionId !== ref.versionId || calculations[0].artifactHash !== ref.contentHash : calculations.length !== 0) throw notFound("Scenario artifact source ownership is unavailable");
  await inspectDecisionSourceAuthority(tx, row.companyId, actor, source.edges, deadline); budget(deadline);
  return { value, source, admitted };
}
function runHash(row: Pick<Run, "definitionHash" | "inputHash" | "result">) { return nativeSha256({ definitionHash: row.definitionHash, inputHash: row.inputHash, result: row.result }); }
async function runView(tx: Db, row: Root, actor: AuthorizationActor, value: Run, deadline: number): Promise<BusinessScenarioRunView> {
  const pin = await version(tx, row, actor, value.versionId, false, deadline), source = await lineage(tx, row.companyId, value.lineageManifestId);
  if (value.expiresAt <= new Date() || value.definitionHash !== pin.value.contentHash || value.inputHash !== pin.value.inputHash || value.contentHash !== runHash(value)
    || source.manifest.engineVersion !== ENGINE || source.manifest.analysisType !== "scenario_run" || source.manifest.analysisRef !== value.id || source.manifest.definitionHash !== value.definitionHash
    || source.manifest.inputHash !== value.inputHash || source.manifest.sourceCount !== source.edges.length || source.manifest.parameters.artifactHash !== value.contentHash
    || source.manifest.parameters.lineageHash !== nativeSha256(source.edges) || nativeSha256(source.edges) !== nativeSha256(pin.source.edges)
    || source.manifest.createdAt.getTime() !== value.createdAt.getTime() || source.manifest.expiresAt.getTime() !== value.expiresAt.getTime()) throw notFound("Scenario run integrity or retained sources are unavailable");
  budget(deadline);
  return { id: value.id, companyId: value.companyId, scenarioId: value.scenarioId, versionId: value.versionId, result: value.result, contentHash: value.contentHash,
    createdAt: value.createdAt.toISOString(), expiresAt: value.expiresAt.toISOString(), currentQualification: row.status === "published" && row.publishedVersionId === value.versionId && pin.admitted.current ? "current" : "needs_revalidation" };
}
async function audit(tx: Db, companyId: string, actor: AuthorizationActor, id: string, action: string, details: Record<string, unknown>, publications: Parameters<typeof logActivity>[2]) {
  await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: `business_scenario.${action}`, entityType: "business_scenario", entityId: id, details }, publications);
}
/** Native pinned consumer; caller owns the company/Memory transaction.
 * Reads admitted retained facts, never reruns arithmetic or publishes effects. */
export async function inspectBusinessScenarioRun(tx: Db, companyId: string, actor: AuthorizationActor, scenarioId: string, versionId: string, runId: string, requireCurrent = true) {
  await admit(tx, companyId, actor); const row = await root(tx, companyId, scenarioId), deadline = performance.now() + 30_000;
  const [value] = await tx.select().from(businessScenarioRuns).where(and(eq(businessScenarioRuns.companyId, companyId), eq(businessScenarioRuns.scenarioId, scenarioId), eq(businessScenarioRuns.versionId, versionId), eq(businessScenarioRuns.id, runId))).for("share");
  if (!value) throw notFound("Pinned native scenario run is unavailable");
  const view = await runView(tx, row, actor, value, deadline), pin = await version(tx, row, actor, versionId, requireCurrent, deadline);
  if (requireCurrent && view.currentQualification !== "current") throw conflict("A currently reviewed native scenario run is required");
  return { view, definition: pin.value.definition, lineageManifestId: value.lineageManifestId };
}
export function businessScenarioService(db: Db) {
  return {
    async create(companyId: string, actor: AuthorizationActor, raw: CreateBusinessScenario) {
      const input = createBusinessScenarioSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const now = new Date(), deadline = performance.now() + 30_000;
        if ((await tx.select({ id: businessScenarios.id }).from(businessScenarios).where(and(eq(businessScenarios.companyId, companyId), eq(businessScenarios.key, input.key)))).length) throw conflict("Scenario key already exists");
        const [row] = await tx.insert(businessScenarios).values({ companyId, key: input.key, createdBy: v7HumanActorId(actor), createdAt: now, updatedAt: now }).returning();
        const value = await appendVersion(tx, row, actor, input.definition, deadline);
        await audit(tx, companyId, actor, row.id, "created", { versionId: value.id, definitionHash: value.contentHash, inputHash: value.inputHash }, publications);
        return { scenario: rootView(row), version: versionView(value, true) };
      });
    },
    async revise(companyId: string, actor: AuthorizationActor, id: string, raw: ReviseBusinessScenario) {
      const input = reviseBusinessScenarioSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const prior = await root(tx, companyId, id), deadline = performance.now() + 30_000;
        if (prior.revision !== input.expectedRevision || prior.status === "retired") throw conflict("Scenario changed or was retired");
        const [row] = await tx.update(businessScenarios).set({ revision: prior.revision + 1, updatedAt: new Date() }).where(and(eq(businessScenarios.companyId, companyId), eq(businessScenarios.id, id), eq(businessScenarios.revision, prior.revision))).returning();
        const value = await appendVersion(tx, row, actor, input.definition, deadline);
        await audit(tx, companyId, actor, id, "version_created", { versionId: value.id, definitionHash: value.contentHash, inputHash: value.inputHash }, publications);
        return { scenario: rootView(row), version: versionView(value, true) };
      });
    },
    async publish(companyId: string, actor: AuthorizationActor, id: string, raw: PublishBusinessScenario) {
      const input = publishBusinessScenarioSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const prior = await root(tx, companyId, id), pin = await version(tx, prior, actor, input.versionId, true, performance.now() + 30_000);
        if (prior.revision !== input.expectedRevision || prior.status === "retired" || pin.value.revision !== prior.revision) throw conflict("Publication requires the exact latest human-proposed version");
        const now = new Date();
        await tx.insert(businessScenarioPublications).values({ companyId, scenarioId: id, versionId: input.versionId, publishedBy: v7HumanActorId(actor), rationale: input.rationale, publishedAt: now });
        const [row] = await tx.update(businessScenarios).set({ revision: prior.revision + 1, status: "published", publishedVersionId: input.versionId, updatedAt: now }).where(and(eq(businessScenarios.companyId, companyId), eq(businessScenarios.id, id), eq(businessScenarios.revision, prior.revision))).returning();
        await audit(tx, companyId, actor, id, "published", { versionId: input.versionId, revision: row.revision }, publications); return rootView(row);
      });
    },
    async run(companyId: string, actor: AuthorizationActor, id: string, raw: RunBusinessScenario) {
      const input = runBusinessScenarioSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const row = await root(tx, companyId, id), deadline = performance.now() + 30_000;
        if (row.revision !== input.expectedRevision || row.status !== "published" || row.publishedVersionId !== input.versionId) throw conflict("Run requires the current human-published scenario version");
        const pin = await version(tx, row, actor, input.versionId, true, deadline), createdAt = new Date(), runId = randomUUID();
        if ((pin.value.definition.calculationType === "bounded_monte_carlo") !== (input.seed !== null)) throw conflict("Seed must match the published scenario uncertainty policy");
        const outputs = pin.value.definition.calculationType === "validated_automation_artifact"
          ? await executeScenarioArtifact(tx, companyId, actor, pin.value.definition, pin.value.inputs, deadline) : undefined;
        const result = evaluateNativeBusinessScenario(pin.value.definition, pin.value.inputs, input.seed, outputs); budget(deadline);
        if (pin.value.expiresAt <= new Date()) throw conflict("Scenario evidence expired during calculation");
        const material = { definitionHash: pin.value.contentHash, inputHash: pin.value.inputHash, result }, contentHash = runHash(material);
        const lineageManifestId = await appendManifest(tx, companyId, runId, "scenario_run", actor, material.definitionHash, material.inputHash, createdAt, pin.value.expiresAt, pin.source.edges, { artifactHash: contentHash, kernelVersion: result.engineVersion });
        const [value] = await tx.insert(businessScenarioRuns).values({ id: runId, companyId, scenarioId: id, versionId: pin.value.id, lineageManifestId, ...material, contentHash, createdBy: v7HumanActorId(actor), createdAt, expiresAt: pin.value.expiresAt }).returning();
        budget(deadline); if (value.expiresAt <= new Date()) throw conflict("Scenario evidence expired before result retention completed");
        await audit(tx, companyId, actor, id, "run", { runId, contentHash, status: result.status }, publications);
        return { id: value.id, companyId, scenarioId: id, versionId: pin.value.id, result, contentHash, createdAt: createdAt.toISOString(), expiresAt: value.expiresAt.toISOString(), currentQualification: "current" as const };
      });
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db; await admit(tx, companyId, actor); const row = await root(tx, companyId, id), deadline = performance.now() + 30_000;
        const rows = await tx.select().from(businessScenarioVersions).where(and(eq(businessScenarioVersions.companyId, companyId), eq(businessScenarioVersions.scenarioId, id))).orderBy(desc(businessScenarioVersions.revision)).limit(5);
        const versions: BusinessScenarioVersionView[] = [];
        for (const item of rows) { const pin = await version(tx, row, actor, item.id, false, deadline); versions.push(versionView(item, pin.admitted.current)); }
        if (!versions.length) throw notFound("Scenario source definitions are unavailable"); return { scenario: rootView(row), versions };
      });
    },
    async list(companyId: string, actor: AuthorizationActor, cursor?: string) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db; await admit(tx, companyId, actor); const deadline = performance.now() + 30_000;
        const rows = await tx.select().from(businessScenarios).where(and(eq(businessScenarios.companyId, companyId), cursor ? sql`${businessScenarios.id}>${cursor}::uuid` : undefined)).orderBy(asc(businessScenarios.id)).limit(21);
        const items: Array<{ scenario: BusinessScenarioView; version: BusinessScenarioVersionView }> = [];
        for (const row of rows.slice(0, 20)) {
          budget(deadline);
          const [latest] = await tx.select({ id: businessScenarioVersions.id }).from(businessScenarioVersions).where(and(eq(businessScenarioVersions.companyId, companyId), eq(businessScenarioVersions.scenarioId, row.id))).orderBy(desc(businessScenarioVersions.revision)).limit(1);
          if (!latest) continue;
          try { const pin = await version(tx, row, actor, latest.id, false, deadline); items.push({ scenario: rootView(row), version: versionView(pin.value, pin.admitted.current) }); }
          catch (error) { if (!error || typeof error !== "object" || !("status" in error) || ![403, 404, 409].includes(Number(error.status))) throw error; }
        }
        budget(deadline); return { items, nextCursor: rows.length > 20 ? rows[19].id : null, coverage: "bounded_current_authorized_page" as const };
      });
    },
    async listRuns(companyId: string, actor: AuthorizationActor, id: string, cursor?: string) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db; await admit(tx, companyId, actor); const row = await root(tx, companyId, id), deadline = performance.now() + 30_000;
        const rows = await tx.select().from(businessScenarioRuns).where(and(eq(businessScenarioRuns.companyId, companyId), eq(businessScenarioRuns.scenarioId, id), sql`${businessScenarioRuns.expiresAt}>now()`, cursor ? sql`${businessScenarioRuns.id}>${cursor}::uuid` : undefined)).orderBy(asc(businessScenarioRuns.id)).limit(21);
        const items: BusinessScenarioRunView[] = [];
        for (const value of rows.slice(0, 20)) {
          try { items.push(await runView(tx, row, actor, value, deadline)); }
          catch (error) { if (!error || typeof error !== "object" || !("status" in error) || ![403, 404, 409].includes(Number(error.status))) throw error; }
        }
        budget(deadline); return { items, nextCursor: rows.length > 20 ? rows[19].id : null, coverage: "bounded_current_authorized_page" as const };
      });
    },
    async result(companyId: string, actor: AuthorizationActor, id: string, runId: string) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db; await admit(tx, companyId, actor); const row = await root(tx, companyId, id), deadline = performance.now() + 30_000;
        const [value] = await tx.select().from(businessScenarioRuns).where(and(eq(businessScenarioRuns.companyId, companyId), eq(businessScenarioRuns.scenarioId, id), eq(businessScenarioRuns.id, runId))).for("share");
        if (!value) throw notFound("Scenario run is unavailable"); return runView(tx, row, actor, value, deadline);
      });
    },
    async retire(companyId: string, actor: AuthorizationActor, id: string, raw: RetireBusinessScenario) {
      const input = retireBusinessScenarioSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true, false); const prior = await root(tx, companyId, id);
        if (prior.revision !== input.expectedRevision || prior.status === "retired") throw conflict("Scenario changed or was retired");
        const [row] = await tx.update(businessScenarios).set({ status: "retired", publishedVersionId: null, revision: prior.revision + 1, updatedAt: new Date() }).where(and(eq(businessScenarios.companyId, companyId), eq(businessScenarios.id, id), eq(businessScenarios.revision, prior.revision))).returning();
        await audit(tx, companyId, actor, id, "retired", { revision: row.revision, rationaleHash: nativeSha256(input.rationale) }, publications); return rootView(row);
      });
    },
  };
}
