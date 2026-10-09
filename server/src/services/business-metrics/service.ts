import {assertAnalyticalReader,analyticalPrincipalId,analyticalRequesterId} from "../analytical-reader.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, businessMetrics, businessMetricVersions, businessMetricPublications, businessMetricObservations, companyMemberships, issues, projects, type Db } from "@paperclipai/db";
import { businessMetricDefinitionSchema, createBusinessMetricSchema, createBusinessMetricVersionSchema, publishBusinessMetricSchema, transitionBusinessMetricSchema, queryBusinessMetricSchema, v8FeatureEnabled, v7FeatureEnabled, type BusinessMetricDefinition, type BusinessMetricQuery, type BusinessMetricResult } from "@paperclipai/shared";
import type { z } from "zod";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { accessService } from "../access.js";
import { instanceSettingsService } from "../instance-settings.js";
import { v7HumanActorId, assertV7Authorization } from "../v7-authorization.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockMemoryPrivacy,assertMemorySourcesRetained } from "../memory/memory-privacy.js";
import { lockBusinessEventCompany } from "../business-event-privacy.js";
import { calculateNativeMetric, NATIVE_METRIC_ENGINE_VERSION, type NativeMetricInput } from "./native-engine.js";
import { assertAnalyticalSourcesNotErased } from "../analytical-privacy.js";
import { currentMetricPurpose } from "./purpose.js";

export function businessMetricService(db: Db) {
  function queryTimeBudget(deadline: number) {
    if (performance.now() > deadline) throw unprocessable("Metric query time budget exceeded; select a smaller population", { code: "metric_query_time_budget_exceeded" });
  }
  async function inspectSourcePopulation<T>(rows: readonly T[], deadline: number, inspect: (row: T) => Promise<void>) {
    // Pipeline bounded transport on this transaction's single connection. Every
    // Source still enters the original current agent × Human ACL independently.
    // Drain a failed batch before leaving the transaction; no pending admission
    // may outlive rollback or the company → Memory privacy locks.
    for (let offset = 0; offset < rows.length; offset += 32) {
      queryTimeBudget(deadline);
      const results = await Promise.allSettled(rows.slice(offset, offset + 32).map(async row => {
        queryTimeBudget(deadline);
        await inspect(row);
        queryTimeBudget(deadline);
      }));
      for (const result of results) if (result.status === "rejected") throw result.reason;
    }
    queryTimeBudget(deadline);
  }
  async function admit(tx: Db, companyId: string, actor: AuthorizationActor, write = false, checkFlags = true) {
    if(write)v7HumanActorId(actor);else await assertAnalyticalReader(tx,companyId,actor);
    await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
    const flags = await instanceSettingsService(tx).getExperimental();
    if (checkFlags && (!v8FeatureEnabled(flags, "business_metrics_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7"))) throw notFound("Governed business metrics are not enabled");
  }
  async function metric(tx: Db, companyId: string, id: string, lock = false) {
    const query = tx.select().from(businessMetrics).where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.id, id)));
    const [row] = await (lock ? query.for("update") : query.for("share"));
    if (!row) throw notFound("Metric not found"); return row;
  }
  async function definitionAdmission(tx: Db, companyId: string, actor: AuthorizationActor, definition: BusinessMetricDefinition) {
    if (definition.ownerUserId !== analyticalPrincipalId(actor)) {
      const [membership] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, definition.ownerUserId), eq(companyMemberships.status, "active"),
      )).for("share");
      if (!membership) throw conflict("Metric owner must be a current company human principal");
    }
    return currentMetricPurpose(tx, companyId, definition);
  }
  async function version(tx: Db, companyId: string, metricId: string, id: string) {
    const [row] = await tx.select().from(businessMetricVersions).where(and(eq(businessMetricVersions.companyId, companyId), eq(businessMetricVersions.metricId, metricId), eq(businessMetricVersions.id, id))).for("share");
    if (!row || !businessMetricDefinitionSchema.safeParse(row.definition).success || nativeSha256(row.definition) !== row.contentHash) throw conflict("Metric definition version is unavailable");
    await assertMemorySourcesRetained(tx,companyId,[{sourceProvider:"august_works_analytical_input",sourceRef:`metric_version://${id}`}]);
    if (row.createdAt.getTime() + row.definition.reviewFrequencyDays * 86_400_000 <= Date.now()) throw conflict("Metric definition review is overdue; publish a current review version");
    return row;
  }
  async function audit(tx: Db, publications: Parameters<typeof logActivity>[2], companyId: string, actor: AuthorizationActor, action: string, id: string, details: Record<string, unknown>) {
    await logActivity(tx, { companyId, actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.type === "agent" ? actor.agentId! : v7HumanActorId(actor), action, entityType: "business_metric", entityId: id, details }, publications);
  }
  const issueAuthorityColumns={id:issues.id,projectId:issues.projectId,parentId:issues.parentId,assigneeAgentId:issues.assigneeAgentId,assigneeUserId:issues.assigneeUserId,status:issues.status,originKind:issues.originKind,originId:issues.originId};
  type IssueAuthority=Pick<typeof issues.$inferSelect,keyof typeof issueAuthorityColumns>;
  async function permitted(tx: Db, companyId: string, actor: AuthorizationActor, entity: "issue" | "project", id: string,currentIssue?:IssueAuthority|null) {
    const access = accessService(tx);
    if (entity === "project") {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, id))).for("share");
      return !!project && (await access.decide({ actor, action: "project:read", enforceResponsibleUserIntersection: true, resource: { type: "project", companyId, projectId: id } })).allowed;
    }
    const [issue] = currentIssue===undefined ? await tx.select(issueAuthorityColumns).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, id), isNull(issues.hiddenAt))).for("share") : [currentIssue];
    return !!issue && (await access.decide({ actor, action: "issue:read", enforceResponsibleUserIntersection: true, resource: {
      type: "issue", companyId, issueId: id, projectId: issue.projectId, parentIssueId: issue.parentId, assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId, status: issue.status, originKind: issue.originKind, originId: issue.originId,
    } })).allowed;
  }
  async function inputs(tx: Db, companyId: string, actor: AuthorizationActor, definition: BusinessMetricDefinition, query: BusinessMetricQuery, deadline: number) {
    const calculation = definition.calculation;
    if (calculation.kind === "external_metric") throw unprocessable("This metric requires its pinned, qualified external authority", { code: "external_metric_provider_unqualified" });
    const population = calculation.kind === "native_count" ? calculation.population : calculation.denominator;
    if (population.entity === "issue" && population.projectId && !await permitted(tx, companyId, actor, "project", population.projectId)) throw forbidden("Metric population is outside the current authorization boundary");
    const table = population.entity === "issue" ? issues : projects;
    // One bounded PostgreSQL statement supplies both its snapshot inputs and
    // read time, including the empty population. Commit time is not source time.
    const selected = await tx.execute<{ observed_at: Date; sources: NativeMetricInput[] }>(sql`
      with candidates as (
        select ${table.id} as id, ${table.status} as status, ${table.createdAt} as created_at, ${table.updatedAt} as updated_at,
          ${population.entity === "issue" ? issues.projectId : sql`null::uuid`} as project_id
        from ${table} where ${and(eq(table.companyId, companyId), inArray(table.status, population.statuses),
          sql`${table.createdAt} >= ${query.from}::timestamptz`, sql`${table.createdAt} < ${query.until}::timestamptz`,
          population.entity === "issue" && population.projectId ? eq(issues.projectId, population.projectId) : undefined)}
        order by ${table.id} limit ${query.maxRows + 1} for share
      )
      select statement_timestamp() as observed_at,
        coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'entity', ${population.entity}::text, 'status', c.status, 'projectId', c.project_id,
          'createdAt', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedAt', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by c.id), '[]'::jsonb) as sources
      from candidates c
    `);
    const rows = selected[0].sources;
    const currentIssues=new Map(population.entity==="issue"&&rows.length ? (await tx.select(issueAuthorityColumns).from(issues).where(and(eq(issues.companyId,companyId),inArray(issues.id,rows.map(row=>row.id)),isNull(issues.hiddenAt))).for("share")).map(row=>[row.id,row] as const) : []);
    // Never aggregate an actor-filtered subset while calling it the defined
    // population. Every contributing object's current authority is required.
    await inspectSourcePopulation(rows, deadline, async row => {
      if (!await permitted(tx, companyId, actor, population.entity, row.id,population.entity==="issue"?currentIssues.get(row.id)??null:undefined)
        || (row.projectId && !await permitted(tx, companyId, actor, "project", row.projectId))) throw forbidden("Metric population is outside the current authorization boundary");
    });
    queryTimeBudget(deadline);
    await assertAnalyticalSourcesNotErased(tx, companyId,
      population.entity === "issue" ? rows.map(row => row.id) : [],
      population.entity === "project" ? rows.map(row => row.id) : [...rows.map(row => row.projectId).filter((id): id is string => id !== null), ...(population.projectId ? [population.projectId] : [])]);
    if (rows.length > query.maxRows) throw unprocessable("Metric population exceeds the bounded query budget", { code: "metric_population_budget_exceeded" });
    return { sources: rows, observedAt: new Date(selected[0].observed_at) };
  }
  return {
    async listCurrentObservations(companyId: string, actor: AuthorizationActor, metricId: string, cursor?: string) {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        await admit(tx, companyId, actor); await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        await tx.execute(sql`set local statement_timeout='8s'`);
        const row = await metric(tx, companyId, metricId);
        if (!row.publishedVersionId || row.status !== "published") throw conflict("Metric is not currently published");
        await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, metricId, row.publishedVersionId);
        const rows = await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId, companyId), eq(businessMetricObservations.metricId, metricId), eq(businessMetricObservations.versionId, row.publishedVersionId), sql`${businessMetricObservations.expiresAt}>now()`, cursor ? sql`${businessMetricObservations.id}>${cursor}::uuid` : undefined)).orderBy(asc(businessMetricObservations.id)).limit(21);
        const items: BusinessMetricResult[] = []; const deadline = performance.now()+30_000;
        for (const observation of rows.slice(0,20)) {
          queryTimeBudget(deadline);
          try { items.push(await businessMetricService(tx).inspectCurrentObservation(companyId, actor, observation.id)); }
          catch (error) { if (!error || typeof error !== "object" || !("status" in error) || ![403,404,409].includes(Number(error.status))) throw error; }
        }
        return { items, nextCursor: rows.length>20 ? rows[19].id : null, coverage: "bounded_current_authorized_page" as const };
      });
    },
    /** Pinned consumers recheck stored evidence against current source authority.
     * Invoke inside their company-serialized transaction before returning data. */
    async inspectCurrentObservation(companyId: string, actor: AuthorizationActor, observationId: string) {
      await admit(db, companyId, actor);
      const [observation] = await db.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId, companyId), eq(businessMetricObservations.id, observationId))).for("share");
      if (!observation || observation.expiresAt.getTime() <= Date.now()) throw conflict("Metric observation is no longer current");
      await assertMemorySourcesRetained(db,companyId,[{sourceProvider:"august_works_analytical",sourceRef:`manifest://${observation.lineageManifestId}`}]);
      const row = await metric(db, companyId, observation.metricId);
      if (row.status !== "published") throw conflict("Metric is not currently published");
      const revision = await version(db, companyId, row.id, observation.versionId);
      await definitionAdmission(db, companyId, actor, revision.definition);
      const [manifest] = await db.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), eq(analyticalLineageManifests.id, observation.lineageManifestId))).for("share");
      const edges = await db.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), eq(analyticalLineageEdges.manifestId, observation.lineageManifestId))).limit(20066);
      const calculation = revision.definition.calculation;
      const population = calculation.kind === "native_count" ? calculation.population : calculation.kind === "native_ratio" ? calculation.denominator : null;
      if (!manifest || manifest.expiresAt.getTime() <= Date.now() || manifest.inputHash !== observation.inputHash || manifest.definitionHash !== revision.contentHash
        || edges.length > 20065 || !edges.some(edge => edge.inputType === "metric_version" && edge.inputRef === revision.id && edge.inputHash === revision.contentHash)
        || !population || edges.filter(edge => edge.inputType === population.entity).length !== manifest.sourceCount) throw conflict("Metric observation lineage is unavailable");
      if (population.entity === "issue" && population.projectId && (!edges.some(edge => edge.inputType === "project" && edge.inputRef === population.projectId)
        || !await permitted(db, companyId, actor, "project", population.projectId))) throw forbidden("Metric population scope is outside the current authorization boundary");
      const deadline = performance.now() + 30_000;
      // Batch only current row acquisition in this transaction. Every Source
      // still enters the original agent × Human ACL decision independently.
      const issueIds=edges.filter(edge=>edge.inputType==="issue").map(edge=>edge.inputRef);
      const currentIssues=new Map(issueIds.length ? (await db.select(issueAuthorityColumns).from(issues).where(and(eq(issues.companyId,companyId),inArray(issues.id,issueIds),isNull(issues.hiddenAt))).for("share")).map(row=>[row.id,row] as const) : []);
      await inspectSourcePopulation(edges, deadline, async edge => {
        if ((edge.inputType === "issue" || edge.inputType === "project") && !await permitted(db, companyId, actor, edge.inputType, edge.inputRef,edge.inputType==="issue"?currentIssues.get(edge.inputRef)??null:undefined)) throw forbidden("Metric observation source is outside the current authorization boundary");
        if (edge.inputType === "issue") {
          const issue=currentIssues.get(edge.inputRef);
          if (issue?.projectId && !await permitted(db, companyId, actor, "project", issue.projectId)) throw forbidden("Metric observation source project is outside the current authorization boundary");
        }
      });
      await assertAnalyticalSourcesNotErased(db, companyId, edges.filter(e => e.inputType === "issue").map(e => e.inputRef), edges.filter(e => e.inputType === "project").map(e => e.inputRef));
      return observation.result;
    },
    /** Reusable admission for pinned consumers. Call inside their native
     * company-serialized transaction; this does not observe or change a metric. */
    async inspectPublishedDefinition(companyId: string, actor: AuthorizationActor, metricId: string, versionId: string) {
      await admit(db, companyId, actor);
      const row = await metric(db, companyId, metricId);
      if (row.status !== "published") throw conflict("Metric is not currently published");
      const revision = await version(db, companyId, metricId, versionId);
      const published = await db.select().from(businessMetricPublications).where(and(eq(businessMetricPublications.companyId, companyId), eq(businessMetricPublications.metricId, metricId), eq(businessMetricPublications.versionId, versionId)));
      if (!published.length) throw conflict("Requested definition version has never been published");
      await definitionAdmission(db, companyId, actor, revision.definition);
      const calculation = revision.definition.calculation;
      const population = calculation.kind === "native_count" ? calculation.population : calculation.kind === "native_ratio" ? calculation.denominator : null;
      if (population?.entity === "issue" && population.projectId && !await permitted(db, companyId, actor, "project", population.projectId)) throw forbidden("Metric population is outside the current authorization boundary");
      return { metric: row, version: revision };
    },
    async list(companyId: string, actor: AuthorizationActor, cursor?: string) {
      if(actor.type==="agent")return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);await lockBusinessEventCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await tx.execute(sql`set local statement_timeout='8s'`);const rows=await tx.select().from(businessMetrics).where(and(eq(businessMetrics.companyId,companyId),eq(businessMetrics.status,"published"),cursor?sql`${businessMetrics.id}>${cursor}::uuid`:undefined)).orderBy(asc(businessMetrics.id)).limit(21),items:typeof rows=[];for(const row of rows.slice(0,20)){if(!row.publishedVersionId)continue;try{await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,row.id,row.publishedVersionId);items.push(row);}catch(error){if(!(error&&typeof error==="object"&&"status"in error&&[403,404,409].includes(Number(error.status))))throw error;}}return{items,nextCursor:rows.length>20?rows[19]!.id:null};});
      await admit(db, companyId, actor);
      const rows = await db.select().from(businessMetrics).where(and(eq(businessMetrics.companyId, companyId), cursor ? sql`${businessMetrics.id}>${cursor}::uuid` : undefined)).orderBy(asc(businessMetrics.id)).limit(101);
      return { items: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null };
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      if(actor.type==="agent")return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);await lockBusinessEventCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);const row=await metric(tx,companyId,id);if(!row.publishedVersionId)throw notFound("Current published metric is unavailable");const current=await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,id,row.publishedVersionId);return{metric:row,versions:[current.version]};});
      await admit(db, companyId, actor); const row = await metric(db, companyId, id);
      const versions = await db.select().from(businessMetricVersions).where(and(eq(businessMetricVersions.companyId, companyId), eq(businessMetricVersions.metricId, id))).orderBy(desc(businessMetricVersions.revision)).limit(100);
      return { metric: row, versions };
    },
    async create(companyId: string, actor: AuthorizationActor, raw: z.infer<typeof createBusinessMetricSchema>) {
      const input = createBusinessMetricSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        await definitionAdmission(tx, companyId, actor, input.definition);
        if ((await tx.select({ id: businessMetrics.id }).from(businessMetrics).where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.key, input.key)))).length) throw conflict("Metric key already exists");
        const [row] = await tx.insert(businessMetrics).values({ companyId, key: input.key, createdBy: v7HumanActorId(actor) }).returning();
        const [revision] = await tx.insert(businessMetricVersions).values({ companyId, metricId: row.id, revision: 1, definition: input.definition, contentHash: nativeSha256(input.definition), createdBy: v7HumanActorId(actor) }).returning();
        await audit(tx, publications, companyId, actor, "business_metric.created", row.id, { versionId: revision.id, definitionHash: revision.contentHash });
        return { metric: row, version: revision };
      });
    },
    async createVersion(companyId: string, actor: AuthorizationActor, id: string, raw: z.infer<typeof createBusinessMetricVersionSchema>) {
      const input = createBusinessMetricVersionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await metric(tx, companyId, id, true);
        if (row.revision !== input.expectedRevision || row.status === "revoked") throw conflict("Metric changed; refresh before editing");
        await definitionAdmission(tx, companyId, actor, input.definition);
        const [created] = await tx.insert(businessMetricVersions).values({ companyId, metricId: id, revision: row.revision + 1, definition: input.definition, contentHash: nativeSha256(input.definition), createdBy: v7HumanActorId(actor) }).returning();
        await tx.update(businessMetrics).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(businessMetrics.id, id));
        await audit(tx, publications, companyId, actor, "business_metric.version_created", id, { versionId: created.id, definitionHash: created.contentHash });
        return created;
      });
    },
    async publish(companyId: string, actor: AuthorizationActor, id: string, raw: z.infer<typeof publishBusinessMetricSchema>) {
      const input = publishBusinessMetricSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await metric(tx, companyId, id, true);
        if (row.revision !== input.expectedRevision || row.status === "revoked") throw conflict("Metric changed; refresh before publication");
        const revision = await version(tx, companyId, id, input.versionId);
        await definitionAdmission(tx, companyId, actor, revision.definition);
        await tx.insert(businessMetricPublications).values({ companyId, metricId: id, versionId: revision.id, publishedBy: v7HumanActorId(actor) }).onConflictDoNothing();
        const [updated] = await tx.update(businessMetrics).set({ status: "published", publishedVersionId: revision.id, revision: row.revision + 1, updatedAt: new Date() }).where(eq(businessMetrics.id, id)).returning();
        await audit(tx, publications, companyId, actor, "business_metric.published", id, { versionId: revision.id, definitionHash: revision.contentHash });
        return updated;
      });
    },
    async transition(companyId: string, actor: AuthorizationActor, id: string, raw: z.infer<typeof transitionBusinessMetricSchema>) {
      const input = transitionBusinessMetricSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        // Revocation remains available after a rollout rollback.
        await admit(tx, companyId, actor, true, false); await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await metric(tx, companyId, id, true);
        if (row.revision !== input.expectedRevision || row.status === "revoked") throw conflict("Metric changed; refresh before changing its lifecycle");
        const [updated] = await tx.update(businessMetrics).set({ status: input.status, revision: row.revision + 1, updatedAt: new Date() }).where(eq(businessMetrics.id, id)).returning();
        await audit(tx, publications, companyId, actor, `business_metric.${input.status}`, id, { reason: input.reason, revision: updated.revision });
        return updated;
      });
    },
    async query(companyId: string, actor: AuthorizationActor, raw: BusinessMetricQuery, retainedPublications?: Parameters<typeof logActivity>[2]) {
      const query = queryBusinessMetricSchema.parse(raw);
      const observe = async (tx: Db, publications: Parameters<typeof logActivity>[2]) => {
        const deadline = performance.now() + 30_000;
        await tx.execute(sql`set local statement_timeout = '5s'`);
        await admit(tx, companyId, actor); await lockBusinessEventCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const row = await metric(tx, companyId, query.metricId);
        if (row.status !== "published") throw conflict("Metric is not currently published");
        const revision = await version(tx, companyId, row.id, query.versionId);
        const published = await tx.select().from(businessMetricPublications).where(and(eq(businessMetricPublications.companyId, companyId), eq(businessMetricPublications.metricId, row.id), eq(businessMetricPublications.versionId, revision.id)));
        if (!published.length) throw conflict("Requested definition version has never been published");
        if (query.dimensions.some(d => !revision.definition.dimensions.includes(d))) throw badRequest("Query dimensions must be declared by the metric");
        const policies = await definitionAdmission(tx, companyId, actor, revision.definition);
        const { sources, observedAt: now } = await inputs(tx, companyId, actor, revision.definition, query, deadline);
        const calculated = calculateNativeMetric(revision.definition, query, sources);
        const id = randomUUID(); const manifestId = randomUUID();
        const expiresAt = new Date(Math.min(now.getTime() + revision.definition.freshnessSeconds * 1000,
          revision.createdAt.getTime() + revision.definition.reviewFrequencyDays * 86_400_000,
          ...policies.map(p => Math.min(p.nextReviewAt.getTime(), Date.parse(p.obligation.nextReviewAt), p.obligation.effectiveUntil ? Date.parse(p.obligation.effectiveUntil) : Infinity))));
        const result: BusinessMetricResult = { id, companyId, metricId: row.id, versionId: revision.id, from: query.from, until: query.until, asOf: now.toISOString(), expiresAt: expiresAt.toISOString(), ...calculated, engineVersion: NATIVE_METRIC_ENGINE_VERSION, lineageManifestId: manifestId };
        await tx.insert(analyticalLineageManifests).values({ id: manifestId, companyId, analysisType: "business_metric", analysisRef: id, engineVersion: NATIVE_METRIC_ENGINE_VERSION, inputHash: calculated.inputHash, definitionHash: calculated.definitionHash, requestedBy: analyticalRequesterId(actor), sourceWatermark: calculated.sourceWatermark, sourceCount: sources.length, parameters: query, createdAt: now, expiresAt: new Date(now.getTime() + revision.definition.retentionDays * 86_400_000) });
        const population = revision.definition.calculation.kind === "native_count" ? revision.definition.calculation.population
          : revision.definition.calculation.kind === "native_ratio" ? revision.definition.calculation.denominator : null;
        const scopedProjectId = population?.entity === "issue" ? population.projectId : null;
        const projectIds = [...new Set([...sources.map(s => s.projectId), scopedProjectId].filter((id): id is string => id !== null))];
        const edges = [
          ...sources.map(source => ({ companyId, manifestId, inputType: source.entity, inputRef: source.id, inputHash: nativeSha256(source), relationship: "source" as const })),
          ...projectIds.map(projectId => ({ companyId, manifestId, inputType: "project" as const, inputRef: projectId, inputHash: nativeSha256({ projectId }), relationship: "source" as const })),
          { companyId, manifestId, inputType: "metric_version" as const, inputRef: revision.id, inputHash: revision.contentHash, relationship: "definition" as const },
          ...policies.map(policy => ({ companyId, manifestId, inputType: "governance_obligation" as const, inputRef: policy.id, inputHash: policy.obligationHash, relationship: "policy" as const })),
        ];
        for (let start = 0; start < edges.length; start += 500) {
          queryTimeBudget(deadline);
          await tx.insert(analyticalLineageEdges).values(edges.slice(start, start + 500));
        }
        await admit(tx, companyId, actor); await definitionAdmission(tx, companyId, actor, revision.definition);
        queryTimeBudget(deadline);
        await tx.insert(businessMetricObservations).values({ id, companyId, metricId: row.id, versionId: revision.id, result, definitionHash: calculated.definitionHash, inputHash: calculated.inputHash, lineageManifestId: manifestId, requestedBy: analyticalRequesterId(actor), observedAt: now, expiresAt });
        await audit(tx, publications, companyId, actor, "business_metric.observed", row.id, { observationId: id, versionId: revision.id, lineageManifestId: manifestId, inputHash: calculated.inputHash });
        return result;
      };
      return retainedPublications ? observe(db, retainedPublications) : withV7ActivityTransaction(db, observe);
    },
  };
}
