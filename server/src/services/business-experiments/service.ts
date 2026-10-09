import {assertAnalyticalReader,analyticalPrincipalId} from "../analytical-reader.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, businessExperiments, businessExperimentVersions, businessExperimentMetricPins, businessExperimentTransitions, businessMetrics, companyMemberships, type Db } from "@paperclipai/db";
import { BUSINESS_EXPERIMENT_TRANSITIONS, ISSUE_STATUSES, PROJECT_STATUSES, businessExperimentDefinitionSchema, createBusinessExperimentSchema, amendBusinessExperimentSchema, transitionBusinessExperimentSchema, v7FeatureEnabled, v8FeatureEnabled,
  type BusinessExperimentDefinition, type BusinessExperimentMetricPin, type BusinessExperimentView, type BusinessExperimentVersionView, type BusinessExperimentTransitionView } from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockBusinessEventCompany } from "../business-event-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";
import { authorizeStrategyReference } from "../strategy-execution/references.js";
import { inspectDecisionSourceAuthority } from "../decision-intelligence.js";
import { businessMetricService } from "../business-metrics/service.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { inspectBusinessExperimentReceipts } from "./receipts.js";

type Root = typeof businessExperiments.$inferSelect;
type Version = typeof businessExperimentVersions.$inferSelect;
type Edge = Pick<typeof analyticalLineageEdges.$inferInsert, "inputType" | "inputRef" | "inputHash" | "relationship">;
const ENGINE = "aw-native-business-experiment-owner-v1", DAY = 86_400_000;
function budget(deadline: number) { if (performance.now() > deadline) throw unprocessable("Experiment source admission exceeds its time budget"); }
function mergeEdges(edges: Edge[]): Edge[] {
  const result = new Map<string, Edge>();
  for (const edge of edges) {
    const key = `${edge.inputType}:${edge.inputRef}`, prior = result.get(key);
    if (prior && prior.inputHash !== edge.inputHash) throw conflict("Experiment source hashes conflict");
    result.set(key, { inputType: edge.inputType, inputRef: edge.inputRef, inputHash: edge.inputHash, relationship: edge.relationship });
  }
  if (result.size > 256) throw unprocessable("Experiment protocol source budget exceeded");
  return [...result.values()].sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
}
async function admit(tx: Db, companyId: string, actor: AuthorizationActor, write = false, flagsRequired = true) {
  if(write)v7HumanActorId(actor);else await assertAnalyticalReader(tx,companyId,actor);
  await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
  const flags = await instanceSettingsService(tx).getExperimental();
  if (flagsRequired && (!v8FeatureEnabled(flags, "business_experiments_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7"))) throw notFound("Governed business experiments are not enabled");
  await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
  await tx.execute(sql`set local statement_timeout='8s'`);
}
async function root(tx: Db, companyId: string, id: string) {
  const [row] = await tx.select().from(businessExperiments).where(and(eq(businessExperiments.companyId, companyId), eq(businessExperiments.id, id))).for("update");
  if (!row) throw notFound("Experiment is unavailable"); return row;
}
function rootView(row: Root): BusinessExperimentView { return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function versionView(row: Version, current: boolean): BusinessExperimentVersionView {
  return { id: row.id, companyId: row.companyId, experimentId: row.experimentId, revision: row.revision, definition: row.definition, contentHash: row.contentHash,
    metricPins: row.metricPins, amendmentReason: row.amendmentReason, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), currentQualification: current ? "current" : "needs_revalidation" };
}
async function capture(tx: Db, companyId: string, actor: AuthorizationActor, definition: BusinessExperimentDefinition, storedPins: BusinessExperimentMetricPin[] | undefined, requireCurrent: boolean, deadline: number) {
  // Existing analytical purposes authorize advisory business objects only.
  // A protocol cannot relabel that authority as live customer consent or AI
  // deployment approval. Those modes need their canonical governance owners.
  if (definition.ethics.personImpact !== "none" || definition.ethics.requiresConsent || definition.ethics.changesMaterialAiDecisions)
    throw conflict("Native experiment admission currently supports approved business-object analysis without personal impact or material AI deployment changes");
  const policies = await currentAnalyticalPurpose(tx, companyId, definition, "experiment");
  if (definition.ownerUserId !== analyticalPrincipalId(actor)) {
    const [owner] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, definition.ownerUserId), eq(companyMemberships.status, "active"))).for("share");
    if (!owner) throw conflict("Experiment owner must be a current company human");
  }
  let expiresAt = new Date(Math.min(Date.now() + definition.retentionDays * DAY, ...policies.map(row => row.nextReviewAt.getTime())));
  const edges: Edge[] = policies.map(row => ({ inputType: "governance_obligation", inputRef: row.id, inputHash: row.obligationHash, relationship: "policy" }));
  if (definition.scope.type === "project") {
    const admitted = await authorizeStrategyReference(tx, companyId, actor, { type: "project", id: definition.scope.id }, definition.sensitivity);
    edges.push(...admitted.projectIds.map(id => ({ inputType: "project" as const, inputRef: id, inputHash: nativeSha256({ type: "project", id }), relationship: "source" as const })));
  }
  if (definition.decisionId) {
    const admitted = await authorizeStrategyReference(tx, companyId, actor, { type: "decision", id: definition.decisionId }, definition.sensitivity);
    edges.push(...admitted.issueIds.map(id => ({ inputType: "issue" as const, inputRef: id, inputHash: nativeSha256({ type: "issue", id }), relationship: "source" as const })),
      ...admitted.projectIds.map(id => ({ inputType: "project" as const, inputRef: id, inputHash: nativeSha256({ type: "project", id }), relationship: "source" as const })));
  }
  const declarations: { key: string; role: BusinessExperimentMetricPin["role"]; metricId: string; metricVersionId?: string }[] = [
    { ...definition.primaryMetric, role: "primary" }, ...definition.guardrailMetrics.map(item => ({ ...item, role: "guardrail" as const })),
    ...definition.secondaryMetrics.map(item => ({ ...item, role: "exploratory" as const })),
    ...definition.diagnostics.invariantMetricRefs.map((metricId, index) => ({ key: `invariant_${index + 1}`, metricId, role: "invariant" as const })),
  ];
  const pins: BusinessExperimentMetricPin[] = []; let current = true;
  for (const declaration of declarations) {
    budget(deadline);
    const prior = storedPins?.find(item => item.key === declaration.key);
    let versionId = declaration.metricVersionId ?? prior?.metricVersionId;
    if (!versionId) {
      const [metric] = await tx.select({ versionId: businessMetrics.publishedVersionId }).from(businessMetrics).where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.id, declaration.metricId))).for("share");
      if (!metric?.versionId) throw conflict("Invariant must use a published native metric"); versionId = metric.versionId;
    }
    const source = await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, declaration.metricId, versionId);
    const metric = source.version.definition, calculation = metric.calculation;
    if (metric.sensitivity === "confidential" && definition.sensitivity !== "confidential") throw forbidden("Experiment sensitivity cannot downgrade native metric sources");
    if (metric.authorityMode !== "aw_native" || calculation.kind !== "native_ratio" || metric.grain !== definition.population.randomizationUnit)
      throw conflict("Native individual binary experiments require native ratio definitions on the registered randomization unit");
    const statuses = definition.population.randomizationUnit === "issue" ? ISSUE_STATUSES : PROJECT_STATUSES;
    if (calculation.denominator.statuses.length !== statuses.length || !statuses.every(status => (calculation.denominator.statuses as readonly string[]).includes(status)))
      throw conflict("Experiment denominator must retain every native status; outcome-based population filtering would violate intention to treat");
    if (calculation.denominator.entity === "issue" && calculation.denominator.projectId !== (definition.scope.type === "project" ? definition.scope.id : null)
      || definition.population.randomizationUnit === "project" && definition.scope.type === "project") throw conflict("Experiment and native metric population scopes must agree");
    if (source.metric.publishedVersionId !== versionId) current = false;
    pins.push({ key: declaration.key, role: declaration.role, metricId: declaration.metricId, metricVersionId: versionId, contentHash: source.version.contentHash });
    edges.push({ inputType: "metric_version", inputRef: versionId, inputHash: source.version.contentHash, relationship: "definition" });
    const metricPolicies = await currentAnalyticalPurpose(tx, companyId, metric, "metrics");
    edges.push(...metricPolicies.map(row => ({ inputType: "governance_obligation" as const, inputRef: row.id, inputHash: row.obligationHash, relationship: "policy" as const })));
    expiresAt = new Date(Math.min(expiresAt.getTime(), source.version.createdAt.getTime() + metric.reviewFrequencyDays * DAY, ...metricPolicies.map(row => row.nextReviewAt.getTime())));
  }
  if (storedPins && nativeSha256(pins) !== nativeSha256(storedPins)) throw conflict("Experiment preregistered metric pins changed");
  if (requireCurrent && !current) throw conflict("Experiment requires current published metric versions");
  const merged = mergeEdges(edges); await inspectDecisionSourceAuthority(tx, companyId, actor, merged, deadline); budget(deadline);
  if (expiresAt <= new Date()) throw conflict("Experiment source evidence expired during admission");
  return { pins, edges: merged, expiresAt, current };
}
async function appendVersion(tx: Db, row: Root, actor: AuthorizationActor, definition: BusinessExperimentDefinition, reason: string, deadline: number) {
  const source = await capture(tx, row.companyId, actor, definition, undefined, true, deadline), id = randomUUID(), manifestId = randomUUID(), contentHash = nativeSha256(definition), inputHash = nativeSha256(source.pins);
  await tx.insert(analyticalLineageManifests).values({ id: manifestId, companyId: row.companyId, analysisType: "experiment_version", analysisRef: id, engineVersion: ENGINE, definitionHash: contentHash, inputHash,
    requestedBy: v7HumanActorId(actor), sourceWatermark: row.updatedAt.toISOString(), sourceCount: source.edges.length, parameters: { lineageHash: nativeSha256(source.edges) }, createdAt: row.updatedAt, expiresAt: source.expiresAt });
  await tx.insert(analyticalLineageEdges).values(source.edges.map(edge => ({ ...edge, companyId: row.companyId, manifestId })));
  const [value] = await tx.insert(businessExperimentVersions).values({ id, companyId: row.companyId, experimentId: row.id, revision: row.revision, definition, contentHash, inputHash, metricPins: source.pins,
    decisionId: definition.decisionId, lineageManifestId: manifestId, amendmentReason: reason, createdBy: v7HumanActorId(actor), createdAt: row.updatedAt, expiresAt: source.expiresAt }).returning();
  await tx.insert(businessExperimentMetricPins).values(source.pins.map(pin => ({ companyId: row.companyId, experimentId: row.id, versionId: id, key: pin.key, metricId: pin.metricId, metricVersionId: pin.metricVersionId, contentHash: pin.contentHash })));
  budget(deadline); return value;
}
async function version(tx: Db, row: Root, actor: AuthorizationActor, id: string, requireCurrent: boolean, deadline: number) {
  const [value] = await tx.select().from(businessExperimentVersions).where(and(eq(businessExperimentVersions.companyId, row.companyId), eq(businessExperimentVersions.experimentId, row.id), eq(businessExperimentVersions.id, id))).for("share");
  if (!value || value.expiresAt <= new Date() || !businessExperimentDefinitionSchema.safeParse(value.definition).success || nativeSha256(value.definition) !== value.contentHash || nativeSha256(value.metricPins) !== value.inputHash)
    throw notFound("Experiment protocol is erased, expired or unavailable");
  const source = await capture(tx, row.companyId, actor, value.definition, value.metricPins, requireCurrent, deadline);
  const [manifest] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, row.companyId), eq(analyticalLineageManifests.id, value.lineageManifestId))).for("share");
  const edges = await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, row.companyId), eq(analyticalLineageEdges.manifestId, value.lineageManifestId))).limit(257);
  const pins = await tx.select().from(businessExperimentMetricPins).where(and(eq(businessExperimentMetricPins.companyId, row.companyId), eq(businessExperimentMetricPins.versionId, value.id))).for("share");
  if (!manifest || manifest.engineVersion !== ENGINE || manifest.analysisType !== "experiment_version" || manifest.analysisRef !== value.id || manifest.expiresAt.getTime() !== value.expiresAt.getTime()
    || manifest.createdAt.getTime() !== value.createdAt.getTime() || manifest.definitionHash !== value.contentHash || manifest.inputHash !== value.inputHash || manifest.sourceCount !== edges.length
    || manifest.parameters.lineageHash !== nativeSha256(mergeEdges(edges)) || nativeSha256(mergeEdges(edges)) !== nativeSha256(source.edges) || pins.length !== value.metricPins.length
    || value.metricPins.some(pin => !pins.some(item => item.key === pin.key && item.metricId === pin.metricId && item.metricVersionId === pin.metricVersionId && item.contentHash === pin.contentHash)))
    throw notFound("Experiment native source ownership is unavailable");
  const receipts = await inspectBusinessExperimentReceipts(tx, row.companyId, actor, value, deadline);
  if (Math.min(value.expiresAt.getTime(), source.expiresAt.getTime()) <= Date.now()) throw notFound("Experiment current Source expired before inspection completed");
  budget(deadline); return { value, source, receipts };
}
async function audit(tx: Db, publications: Parameters<typeof logActivity>[2], companyId: string, actor: AuthorizationActor, id: string, action: string, details: Record<string, unknown>) {
  await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), entityType: "business_experiment", entityId: id, action: `business_experiment.${action}`, details }, publications);
}
export function businessExperimentService(db: Db) {
  return {
    async create(companyId: string, actor: AuthorizationActor, raw: Parameters<typeof createBusinessExperimentSchema.parse>[0]) {
      const input = createBusinessExperimentSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const now = new Date();
        const [row] = await tx.insert(businessExperiments).values({ companyId, key: input.key, createdBy: v7HumanActorId(actor), createdAt: now, updatedAt: now }).returning();
        const pin = await appendVersion(tx, row, actor, input.definition, "Initial human experiment preregistration proposal", performance.now() + 30_000);
        const [updated] = await tx.update(businessExperiments).set({ currentVersionId: pin.id }).where(eq(businessExperiments.id, row.id)).returning();
        await audit(tx, publications, companyId, actor, row.id, "created", { versionId: pin.id, contentHash: pin.contentHash });
        return { experiment: rootView(updated), version: versionView(pin, true) };
      });
    },
    async amend(companyId: string, actor: AuthorizationActor, id: string, raw: Parameters<typeof amendBusinessExperimentSchema.parse>[0]) {
      const input = amendBusinessExperimentSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const prior = await root(tx, companyId, id);
        if (prior.revision !== input.expectedRevision || !["draft", "in_review", "ready"].includes(prior.state)) throw conflict("Amendment requires the current unstarted protocol; a running protocol cannot be replaced");
        const next = { ...prior, revision: prior.revision + 1, state: "draft" as const, updatedAt: new Date() };
        const pin = await appendVersion(tx, next, actor, input.definition, input.reason, performance.now() + 30_000);
        const [row] = await tx.update(businessExperiments).set({ revision: next.revision, state: "draft", currentVersionId: pin.id, updatedAt: next.updatedAt }).where(eq(businessExperiments.id, id)).returning();
        await audit(tx, publications, companyId, actor, id, "amended", { revision: row.revision, versionId: pin.id, contentHash: pin.contentHash, reasonHash: nativeSha256(input.reason) });
        return { experiment: rootView(row), version: versionView(pin, true) };
      });
    },
    async transition(companyId: string, actor: AuthorizationActor, id: string, raw: Parameters<typeof transitionBusinessExperimentSchema.parse>[0]) {
      const input = transitionBusinessExperimentSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true, input.state !== "cancelled"); const prior = await root(tx, companyId, id);
        if (prior.revision !== input.expectedRevision || prior.currentVersionId !== input.versionId || !BUSINESS_EXPERIMENT_TRANSITIONS[prior.state].includes(input.state)) throw conflict("Experiment state/version changed or transition is invalid");
        // No transition can acquire execution or people-impact authority from a
        // prose protocol. Running is admitted by the receipt owner separately.
        if (!["draft", "in_review", "ready", "cancelled"].includes(input.state)) throw conflict("Experiment execution requires the native assignment/exposure receipt owner");
        const now = new Date();
        if (input.state !== "cancelled") {
          const pin = await version(tx, prior, actor, input.versionId, true, performance.now() + 30_000);
          if (Date.parse(pin.value.definition.sampleOrDurationPlan.from) <= now.getTime()) throw conflict("Preregistration review must precede the experiment horizon");
          if (input.state === "ready" && Date.parse(pin.value.definition.sampleOrDurationPlan.until) >= pin.value.expiresAt.getTime()) throw conflict("Registered horizon must end before its source/governance review expiry");
        }
        await tx.insert(businessExperimentTransitions).values({ companyId, experimentId: id, versionId: input.versionId, revision: prior.revision + 1, fromState: prior.state, toState: input.state, rationale: input.rationale, createdBy: v7HumanActorId(actor), createdAt: now });
        const [row] = await tx.update(businessExperiments).set({ state: input.state, revision: prior.revision + 1, updatedAt: now }).where(eq(businessExperiments.id, id)).returning();
        await audit(tx, publications, companyId, actor, id, "transitioned", { versionId: input.versionId, revision: row.revision, from: prior.state, to: row.state, rationaleHash: nativeSha256(input.rationale) }); return rootView(row);
      });
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db; await admit(tx, companyId, actor); const row = await root(tx, companyId, id), deadline = performance.now() + 30_000;
        const saved = await tx.select().from(businessExperimentVersions).where(and(eq(businessExperimentVersions.companyId, companyId), eq(businessExperimentVersions.experimentId, id))).orderBy(desc(businessExperimentVersions.revision)).limit(5);
        const versions: BusinessExperimentVersionView[] = [];
        for (const item of saved) { const pin = await version(tx, row, actor, item.id, false, deadline); versions.push(versionView(item, pin.source.current)); }
        if (!versions.length) throw notFound("Experiment protocol sources are unavailable");
        const transitions = await tx.select().from(businessExperimentTransitions).where(and(eq(businessExperimentTransitions.companyId, companyId), eq(businessExperimentTransitions.experimentId, id), inArray(businessExperimentTransitions.versionId, saved.map(item => item.id)))).orderBy(desc(businessExperimentTransitions.revision)).limit(100);
        return { experiment: rootView(row), versions, transitions: transitions.map(item => ({ ...item, createdAt: item.createdAt.toISOString() })) as BusinessExperimentTransitionView[], coverage: "bounded_recent_versions_and_transitions" as const };
      });
    },
    async list(companyId: string, actor: AuthorizationActor, cursor?: string) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db; await admit(tx, companyId, actor); const deadline = performance.now() + 30_000;
        const rows = await tx.select().from(businessExperiments).where(and(eq(businessExperiments.companyId, companyId), cursor ? sql`${businessExperiments.id}>${cursor}::uuid` : undefined)).orderBy(asc(businessExperiments.id)).limit(21);
        const items: { experiment: BusinessExperimentView; version: BusinessExperimentVersionView }[] = [];
        for (const row of rows.slice(0, 20)) {
          if (!row.currentVersionId) continue;
          try { const pin = await version(tx, row, actor, row.currentVersionId, false, deadline); items.push({ experiment: rootView(row), version: versionView(pin.value, pin.source.current) }); }
          catch (error) { if (!error || typeof error !== "object" || !("status" in error) || ![403, 404, 409].includes(Number(error.status))) throw error; }
        }
        budget(deadline); return { items, nextCursor: rows.length > 20 ? rows[19].id : null, coverage: "bounded_current_authorized_page" as const };
      });
    },
  };
}
/** Private native recording consumers reuse the registry's actual authority,
 * source proof and locks inside their own company-serialized transaction. */
export { admit as admitBusinessExperiment, root as lockBusinessExperimentRoot, version as inspectBusinessExperimentVersion, rootView as businessExperimentRootView, audit as auditBusinessExperiment };
