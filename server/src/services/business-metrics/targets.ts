import { and, asc, desc, eq, sql } from "drizzle-orm";
import { businessMetricTargets, businessMetricTargetVersions, businessMetricTargetApprovals, companyMemberships, goals, projects, type Db } from "@paperclipai/db";
import { approveBusinessMetricTargetSchema, businessMetricTargetDefinitionSchema, createBusinessMetricTargetSchema, retireBusinessMetricTargetSchema, reviseBusinessMetricTargetSchema, v8FeatureEnabled, v7FeatureEnabled, type BusinessMetricTargetDefinition, type CreateBusinessMetricTarget, type ReviseBusinessMetricTarget, type ApproveBusinessMetricTarget, type RetireBusinessMetricTarget, type BusinessMetricTargetComparison, type BusinessMetricResult } from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { accessService } from "../access.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { businessMetricService } from "./service.js";
import { compareMetricTarget } from "./target-comparison.js";

type Target = typeof businessMetricTargets.$inferSelect;
export function businessMetricTargetService(db: Db) {
  async function admit(tx: Db, companyId: string, actor: AuthorizationActor, write = false, flagsRequired = true) {
    v7HumanActorId(actor);
    await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
    const flags = await instanceSettingsService(tx).getExperimental();
    if (flagsRequired && (!v8FeatureEnabled(flags, "business_metrics_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7"))) throw notFound("Governed business metric targets are not enabled");
  }
  async function scope(tx: Db, companyId: string, actor: AuthorizationActor, definition: Pick<BusinessMetricTargetDefinition, "scope">) {
    if (definition.scope.type === "goal") {
      const [row] = await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.companyId, companyId), eq(goals.id, definition.scope.goalId))).for("share");
      if (!row) throw notFound("Target goal is unavailable in this company");
    }
    if (definition.scope.type === "project") {
      const [row] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, definition.scope.projectId))).for("share");
      if (!row || !(await accessService(tx).decide({ actor, action: "project:read", enforceResponsibleUserIntersection: true, resource: { type: "project", companyId, projectId: row.id } })).allowed) throw forbidden("Target project is outside current authority");
    }
  }
  async function owner(tx: Db, companyId: string, actor: AuthorizationActor, ownerId: string) {
    if (ownerId === v7HumanActorId(actor)) return;
    const [row] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, ownerId), eq(companyMemberships.status, "active"))).for("share");
    if (!row) throw conflict("Target owner must be a current company human principal");
  }
  async function definitionAdmission(tx: Db, companyId: string, actor: AuthorizationActor, definition: BusinessMetricTargetDefinition) {
    await scope(tx, companyId, actor, definition); await owner(tx, companyId, actor, definition.ownerUserId);
    const pinned = await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, definition.metricId, definition.metricVersionId);
    if (pinned.metric.publishedVersionId !== definition.metricVersionId) throw conflict("Target metric has changed; review the current published definition");
    const metric = pinned.version.definition; const criterion = definition.criterion;
    if ((metric.valueType === "boolean") !== (criterion.kind === "equals_boolean")) throw unprocessable("Target criterion must use the metric's value type and unit");
    if (criterion.kind !== "equals_boolean") {
      const values = criterion.kind === "between" ? [criterion.lower, criterion.upper] : [criterion.value];
      if (metric.calculation.kind === "native_count" && values.some(value => value < 0 || !Number.isInteger(value))) throw unprocessable("Native count targets require nonnegative integer object counts");
      if (metric.calculation.kind === "native_ratio" && values.some(value => value < 0 || value > 1)) throw unprocessable("Native subset-ratio targets use values between zero and one");
    }
    return pinned;
  }
  async function target(tx: Db, companyId: string, actor: AuthorizationActor, id: string, write = false) {
    const query = tx.select().from(businessMetricTargets).where(and(eq(businessMetricTargets.companyId, companyId), eq(businessMetricTargets.id, id)));
    const [row] = await (write ? query.for("update") : query.for("share"));
    if (!row) throw notFound("Metric target not found");
    await scope(tx, companyId, actor, { scope: row.scopeType === "goal" ? { type: "goal", goalId: row.goalId! } : row.scopeType === "project" ? { type: "project", projectId: row.projectId! } : row.scopeType === "portfolio" ? { type: "portfolio", mode: "company_unit" } : { type: "company" } });
    return row;
  }
  async function version(tx: Db, companyId: string, targetId: string, id: string) {
    const [row] = await tx.select().from(businessMetricTargetVersions).where(and(eq(businessMetricTargetVersions.companyId, companyId), eq(businessMetricTargetVersions.targetId, targetId), eq(businessMetricTargetVersions.id, id))).for("share");
    if (!row || !businessMetricTargetDefinitionSchema.safeParse(row.definition).success || row.contentHash !== nativeSha256(row.definition)) throw conflict("Target definition version is unavailable");
    return row;
  }
  function fixedIdentity(row: Target, definition: BusinessMetricTargetDefinition) {
    const desiredGoal = definition.scope.type === "goal" ? definition.scope.goalId : null;
    const desiredProject = definition.scope.type === "project" ? definition.scope.projectId : null;
    if (row.metricId !== definition.metricId || row.scopeType !== definition.scope.type || row.goalId !== desiredGoal || row.projectId !== desiredProject) throw conflict("A target revision cannot move its metric or native ownership scope; create a separate commitment");
  }
  async function audit(tx: Db, publications: Parameters<typeof logActivity>[2], companyId: string, actor: AuthorizationActor, action: string, id: string, details: Record<string, unknown>) {
    await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action, entityType: "business_metric_target", entityId: id, details }, publications);
  }
  async function current(tx: Db, companyId: string, actor: AuthorizationActor, row: Target) {
    if (row.status !== "approved" || !row.approvedVersionId) throw conflict("Target has no active approved commitment");
    const pin = await version(tx, companyId, row.id, row.approvedVersionId);
    const [approval] = await tx.select().from(businessMetricTargetApprovals).where(and(eq(businessMetricTargetApprovals.companyId, companyId), eq(businessMetricTargetApprovals.targetId, row.id), eq(businessMetricTargetApprovals.versionId, pin.id))).for("share");
    if (!approval) throw conflict("Target approval evidence is unavailable");
    fixedIdentity(row, pin.definition); await definitionAdmission(tx, companyId, actor, pin.definition);
    return pin;
  }
  return {
    /** Internal domain callers hold the analytical company transaction boundary. */
    async inspectApprovedCommitment(companyId: string, actor: AuthorizationActor, id: string, versionId: string) {
      await admit(db, companyId, actor);
      const row = await target(db, companyId, actor, id);
      const pin = await current(db, companyId, actor, row);
      if (pin.id !== versionId) throw conflict("Target commitment changed; review the current approval");
      return { target: row, version: pin };
    },
    async list(companyId: string, actor: AuthorizationActor, cursor?: string) {
      await admit(db, companyId, actor);
      const rows = await db.select().from(businessMetricTargets).where(and(eq(businessMetricTargets.companyId, companyId), cursor ? sql`${businessMetricTargets.id}>${cursor}::uuid` : undefined)).orderBy(asc(businessMetricTargets.id)).limit(101);
      const items: Target[] = [];
      for (const row of rows.slice(0, 100)) {
        try { await target(db, companyId, actor, row.id); items.push(row); }
        catch (error) { if (!error || typeof error !== "object" || !("status" in error) || ![403, 404].includes(Number(error.status))) throw error; }
      }
      return { items, nextCursor: rows.length > 100 ? rows[99].id : null };
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        await tx.execute(sql`set local statement_timeout = '5s'`);
        await admit(tx, companyId, actor); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await target(tx, companyId, actor, id);
        let reviewReason: string | null = null;
        if (row.status === "approved") {
          try { await current(tx, companyId, actor, row); }
          catch (error) { if (!error || typeof error !== "object" || !("status" in error) || Number(error.status) !== 409) throw error; reviewReason = "The approved metric or target owner requires a current review"; }
        }
        const versions = await tx.select().from(businessMetricTargetVersions).where(and(eq(businessMetricTargetVersions.companyId, companyId), eq(businessMetricTargetVersions.targetId, id))).orderBy(desc(businessMetricTargetVersions.revision)).limit(100);
        return { target: { ...row, status: reviewReason ? "needs_review" as const : row.status }, versions, reviewReason };
      });
    },
    async create(companyId: string, actor: AuthorizationActor, raw: CreateBusinessMetricTarget) {
      const input = createBusinessMetricTargetSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        await definitionAdmission(tx, companyId, actor, input.definition);
        const [existing] = await tx.select({ id: businessMetricTargets.id }).from(businessMetricTargets).where(and(eq(businessMetricTargets.companyId, companyId), eq(businessMetricTargets.key, input.key)));
        if (existing) throw conflict("Metric target key already exists");
        const [row] = await tx.insert(businessMetricTargets).values({ companyId, key: input.key, metricId: input.definition.metricId, scopeType: input.definition.scope.type, goalId: input.definition.scope.type === "goal" ? input.definition.scope.goalId : null, projectId: input.definition.scope.type === "project" ? input.definition.scope.projectId : null, createdBy: v7HumanActorId(actor) }).returning();
        const [created] = await tx.insert(businessMetricTargetVersions).values({ companyId, targetId: row.id, metricId: input.definition.metricId, metricVersionId: input.definition.metricVersionId, revision: 1, definition: input.definition, contentHash: nativeSha256(input.definition), createdBy: v7HumanActorId(actor) }).returning();
        await audit(tx, publications, companyId, actor, "business_metric_target.created", row.id, { versionId: created.id, contentHash: created.contentHash });
        return { target: row, version: created };
      });
    },
    async revise(companyId: string, actor: AuthorizationActor, id: string, raw: ReviseBusinessMetricTarget) {
      const input = reviseBusinessMetricTargetSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await target(tx, companyId, actor, id, true);
        if (row.revision !== input.expectedRevision || row.status === "retired") throw conflict("Target changed; refresh before revising");
        fixedIdentity(row, input.definition); await definitionAdmission(tx, companyId, actor, input.definition);
        const [created] = await tx.insert(businessMetricTargetVersions).values({ companyId, targetId: id, metricId: input.definition.metricId, metricVersionId: input.definition.metricVersionId, revision: row.revision + 1, definition: input.definition, contentHash: nativeSha256(input.definition), createdBy: v7HumanActorId(actor) }).returning();
        await tx.update(businessMetricTargets).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(businessMetricTargets.id, id));
        await audit(tx, publications, companyId, actor, "business_metric_target.version_created", id, { versionId: created.id, contentHash: created.contentHash });
        return created;
      });
    },
    async approve(companyId: string, actor: AuthorizationActor, id: string, raw: ApproveBusinessMetricTarget) {
      const input = approveBusinessMetricTargetSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await target(tx, companyId, actor, id, true);
        if (row.revision !== input.expectedRevision || row.status === "retired") throw conflict("Target changed; refresh before approval");
        const pin = await version(tx, companyId, id, input.versionId);
        fixedIdentity(row, pin.definition); await definitionAdmission(tx, companyId, actor, pin.definition);
        if (row.approvedVersionId === pin.id) throw conflict("This commitment is already approved");
        await tx.insert(businessMetricTargetApprovals).values({ companyId, targetId: id, versionId: pin.id, approvedBy: v7HumanActorId(actor), rationale: input.approvalRationale }).onConflictDoNothing();
        const [updated] = await tx.update(businessMetricTargets).set({ status: "approved", approvedVersionId: pin.id, revision: row.revision + 1, updatedAt: new Date() }).where(eq(businessMetricTargets.id, id)).returning();
        await audit(tx, publications, companyId, actor, "business_metric_target.approved", id, { versionId: pin.id, contentHash: pin.contentHash });
        return updated;
      });
    },
    async retire(companyId: string, actor: AuthorizationActor, id: string, raw: RetireBusinessMetricTarget) {
      const input = retireBusinessMetricTargetSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true, false); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await target(tx, companyId, actor, id, true);
        if (row.revision !== input.expectedRevision || row.status === "retired") throw conflict("Target changed; refresh before retirement");
        const [updated] = await tx.update(businessMetricTargets).set({ status: "retired", revision: row.revision + 1, updatedAt: new Date() }).where(eq(businessMetricTargets.id, id)).returning();
        await audit(tx, publications, companyId, actor, "business_metric_target.retired", id, { reason: input.reason });
        return updated;
      });
    },
    async compare(companyId: string, actor: AuthorizationActor, id: string): Promise<{ comparison: BusinessMetricTargetComparison; observation: BusinessMetricResult | null }> {
      const admitted = await db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        await tx.execute(sql`set local statement_timeout = '5s'`);
        await admit(tx, companyId, actor); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await target(tx, companyId, actor, id);
        return { row, pin: await current(tx, companyId, actor, row) };
      });
      const definition = admitted.pin.definition;
      // Observe through the existing metric owner. Its source ACL, purpose and
      // lineage checks remain authoritative; no stored snapshot is read blindly.
      const observation = await businessMetricService(db).query(companyId, actor, { metricId: definition.metricId, versionId: definition.metricVersionId, from: definition.periodStart, until: definition.periodEnd, dimensions: [], maxRows: 5000 });
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        await tx.execute(sql`set local statement_timeout = '5s'`);
        await admit(tx, companyId, actor); await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await target(tx, companyId, actor, id); await current(tx, companyId, actor, row);
        if (row.revision !== admitted.row.revision || row.approvedVersionId !== admitted.pin.id) throw conflict("Target changed while observing; refresh before comparing");
        await businessMetricService(tx).inspectCurrentObservation(companyId, actor, observation.id);
        const comparison = compareMetricTarget(id, admitted.pin.id, definition, observation, new Date());
        return { comparison, observation };
      });
    },
  };
}
