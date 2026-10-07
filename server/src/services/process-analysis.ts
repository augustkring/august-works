import {assertAnalyticalReader,analyticalPrincipalId,analyticalRequesterId} from "./analytical-reader.js";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { analyticalLineageManifests, companyMemberships, processAnalysisDefinitions, processAnalysisPublications,
  processAnalysisRuns, processAnalysisVersions, type Db } from "@paperclipai/db";
import { createProcessAnalysisDefinitionSchema, processAnalysisDefinitionSchema, publishProcessAnalysisDefinitionSchema, retireProcessAnalysisDefinitionSchema,
  reviseProcessAnalysisDefinitionSchema, runProcessAnalysisSchema, v7FeatureEnabled, v8FeatureEnabled,
  type CreateProcessAnalysisDefinition, type ProcessAnalysisDefinition, type ProcessAnalysisDefinitionDetail, type ProcessAnalysisDefinitionView,
  type ProcessAnalysisRunView, type PublishProcessAnalysisDefinition, type RetireProcessAnalysisDefinition, type ReviseProcessAnalysisDefinition, type RunProcessAnalysis } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV7Authorization, v7HumanActorId } from "./v7-authorization.js";
import { instanceSettingsService } from "./instance-settings.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "./analytical-purpose.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "./v7-mutations.js";
import { inspectNativeEventLineage, retainNativeEventLineage } from "./business-event-lineage.js";
import { captureNativeProcessSnapshot } from "./process-data-readiness.js";
import { calculateNativeProcess, nativeProcessRequirements, NATIVE_PROCESS_ENGINE_VERSION } from "./process-analysis-engine.js";

type Root = typeof processAnalysisDefinitions.$inferSelect;
type Version = typeof processAnalysisVersions.$inferSelect;
const DAY = 86_400_000;
const rootView = (row: Root, status: ProcessAnalysisDefinitionView["status"] = row.status): ProcessAnalysisDefinitionView => ({
  id: row.id, companyId: row.companyId, key: row.key, revision: row.revision, status, publishedVersionId: row.publishedVersionId,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const versionView = (row: Version) => ({ id: row.id, companyId: row.companyId, definitionId: row.definitionId, revision: row.revision,
  definition: row.definition, contentHash: row.contentHash, createdAt: row.createdAt.toISOString(), nextReviewAt: row.nextReviewAt.toISOString(), expiresAt: row.expiresAt.toISOString() });
function statusError(error: unknown, codes: number[]) {
  return !!error && typeof error === "object" && "status" in error && codes.includes(Number(error.status));
}

/** Native synchronous and bounded analysis. Publication is a human operation;
 * a readiness preview or retained result never grants execution authority. */
export function processAnalysisService(db: Db) {
  async function boundary(tx: Db, companyId: string, actor: AuthorizationActor, write = false, flagsRequired = true) {
    if(write)v7HumanActorId(actor);else await assertAnalyticalReader(tx,companyId,actor); await tx.execute(sql`set local statement_timeout='8s'`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
    const flags = await instanceSettingsService(tx).getExperimental();
    if (flagsRequired && (!v8FeatureEnabled(flags, "process_intelligence_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7"))) throw notFound("Governed process analysis is not enabled");
  }
  async function root(tx: Db, companyId: string, id: string, write = false) {
    const query = tx.select().from(processAnalysisDefinitions).where(and(eq(processAnalysisDefinitions.companyId, companyId), eq(processAnalysisDefinitions.id, id)));
    const [row] = await (write ? query.for("update") : query.for("share"));
    if (!row) throw notFound("Process definition not found");
    return row;
  }
  async function version(tx: Db, companyId: string, definitionId: string, id: string) {
    const [row] = await tx.select().from(processAnalysisVersions).where(and(eq(processAnalysisVersions.companyId, companyId), eq(processAnalysisVersions.definitionId, definitionId), eq(processAnalysisVersions.id, id))).for("share");
    if (!row || !processAnalysisDefinitionSchema.safeParse(row.definition).success || nativeSha256(row.definition) !== row.contentHash) throw conflict("Process version integrity is unavailable");
    if (row.expiresAt <= new Date()) throw notFound("Process version retention expired");
    return row;
  }
  async function owner(tx: Db, companyId: string, actor: AuthorizationActor, definition: ProcessAnalysisDefinition) {
    if (definition.ownerUserId === analyticalPrincipalId(actor)) return;
    const [current] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, definition.ownerUserId), eq(companyMemberships.status, "active"))).for("share");
    if (!current) throw conflict("Process owner must be a current company human");
  }
  async function current(tx: Db, companyId: string, actor: AuthorizationActor, pin: Version) {
    if (pin.nextReviewAt <= new Date()) throw conflict("Process definition requires its scheduled human review");
    await owner(tx, companyId, actor, pin.definition);
    return currentAnalyticalPurpose(tx, companyId, pin.definition, "process");
  }
  async function publication(tx: Db, companyId: string, definitionId: string, versionId: string) {
    const [receipt] = await tx.select().from(processAnalysisPublications).where(and(eq(processAnalysisPublications.companyId, companyId),
      eq(processAnalysisPublications.definitionId, definitionId), eq(processAnalysisPublications.versionId, versionId))).for("share");
    if (!receipt) throw conflict("Native process publication receipt is unavailable");
  }
  async function addVersion(tx: Db, companyId: string, actor: AuthorizationActor, definitionId: string, revision: number, definition: ProcessAnalysisDefinition) {
    await owner(tx, companyId, actor, definition); await currentAnalyticalPurpose(tx, companyId, definition, "process");
    const now = new Date();
    const [row] = await tx.insert(processAnalysisVersions).values({ companyId, definitionId, revision, definition, contentHash: nativeSha256(definition),
      createdBy: v7HumanActorId(actor), createdAt: now, nextReviewAt: new Date(now.getTime() + definition.reviewFrequencyDays * DAY), expiresAt: new Date(now.getTime() + definition.retentionDays * DAY) }).returning();
    return row;
  }
  async function inspect(tx: Db, companyId: string, actor: AuthorizationActor, row: Root, history = true): Promise<ProcessAnalysisDefinitionDetail> {
    const rows = await tx.select().from(processAnalysisVersions).where(and(eq(processAnalysisVersions.companyId, companyId), eq(processAnalysisVersions.definitionId, row.id)))
      .orderBy(desc(processAnalysisVersions.revision)).limit(history ? 101 : 1);
    if (!rows[0]) throw conflict("Process definition has no retained version");
    const latest = await version(tx, companyId, row.id, rows[0].id);
    const effective = row.publishedVersionId ? await version(tx, companyId, row.id, row.publishedVersionId) : latest;
    if (row.publishedVersionId) await publication(tx, companyId, row.id, row.publishedVersionId);
    const retained = rows.slice(0, 100).filter(pin => pin.expiresAt > new Date());
    // Current evidence covers historical sensitivity/retention. Old immutable
    // policy references remain provenance, rather than a continuing grant.
    await currentAnalyticalPurpose(tx, companyId, { ...effective.definition,
      retentionDays: Math.max(effective.definition.retentionDays, latest.definition.retentionDays, ...retained.map(pin => pin.definition.retentionDays)) }, "process");
    for (const pin of retained) await version(tx, companyId, row.id, pin.id);
    let reviewReason: string | null = null;
    try { await current(tx, companyId, actor, effective); } catch (error) {
      if (!statusError(error, [409])) throw error;
      reviewReason = "The native owner or review interval requires a new human review";
    }
    return { root: rootView(row, reviewReason && row.status === "published" ? "needs_review" : row.status), effectiveVersion: versionView(effective),
      latestVersion: versionView(latest), versions: retained.map(versionView), hasMoreVersions: rows.length > 100, reviewReason };
  }
  async function audit(tx: Db, publications: Parameters<typeof logActivity>[2], companyId: string, actor: AuthorizationActor, action: string, id: string, details: Record<string, unknown>) {
    await logActivity(tx, { companyId, actorType: actor.type === "agent" ? "agent" : "user", actorId: actor.type === "agent" ? actor.agentId! : v7HumanActorId(actor), action, entityType: "process_analysis_definition", entityId: id, details }, publications);
  }
  return {
    async create(companyId: string, actor: AuthorizationActor, raw: CreateProcessAnalysisDefinition) {
      const input = createProcessAnalysisDefinitionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true);
        await currentAnalyticalPurpose(tx, companyId, input.definition, "process");
        const [row] = await tx.insert(processAnalysisDefinitions).values({ companyId, key: input.key, createdBy: v7HumanActorId(actor) }).returning();
        const pin = await addVersion(tx, companyId, actor, row.id, 1, input.definition);
        await audit(tx, publications, companyId, actor, "process_definition.created", row.id, { versionId: pin.id, contentHash: pin.contentHash });
        return { root: rootView(row), version: versionView(pin) };
      });
    },
    async revise(companyId: string, actor: AuthorizationActor, id: string, raw: ReviseProcessAnalysisDefinition) {
      const input = reviseProcessAnalysisDefinitionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true); const row = await root(tx, companyId, id, true);
        if (row.status === "retired" || row.revision !== input.expectedRevision) throw conflict("Process definition changed; refresh before revising");
        const pin = await addVersion(tx, companyId, actor, id, row.revision + 1, input.definition);
        await tx.update(processAnalysisDefinitions).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(processAnalysisDefinitions.id, id));
        await audit(tx, publications, companyId, actor, "process_definition.revised", id, { versionId: pin.id, contentHash: pin.contentHash });
        return versionView(pin);
      });
    },
    async publish(companyId: string, actor: AuthorizationActor, id: string, raw: PublishProcessAnalysisDefinition) {
      const input = publishProcessAnalysisDefinitionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true); const row = await root(tx, companyId, id, true);
        if (row.status === "retired" || row.revision !== input.expectedRevision || row.publishedVersionId === input.versionId) throw conflict("Process definition changed or already published");
        const pin = await version(tx, companyId, id, input.versionId);
        if (pin.revision !== row.revision) throw conflict("Only the latest proposed process version can be published");
        await current(tx, companyId, actor, pin);
        await tx.insert(processAnalysisPublications).values({ companyId, definitionId: id, versionId: pin.id, publishedBy: v7HumanActorId(actor), rationale: input.rationale });
        const [updated] = await tx.update(processAnalysisDefinitions).set({ revision: row.revision + 1, status: "published", publishedVersionId: pin.id, updatedAt: new Date() }).where(eq(processAnalysisDefinitions.id, id)).returning();
        await audit(tx, publications, companyId, actor, "process_definition.published", id, { versionId: pin.id, contentHash: pin.contentHash });
        return rootView(updated);
      });
    },
    async retire(companyId: string, actor: AuthorizationActor, id: string, raw: RetireProcessAnalysisDefinition) {
      const input = retireProcessAnalysisDefinitionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true, false); const row = await root(tx, companyId, id, true);
        if (row.status === "retired" || row.revision !== input.expectedRevision) throw conflict("Process definition changed; refresh before retiring");
        const [updated] = await tx.update(processAnalysisDefinitions).set({ status: "retired", revision: row.revision + 1, updatedAt: new Date() }).where(eq(processAnalysisDefinitions.id, id)).returning();
        await audit(tx, publications, companyId, actor, "process_definition.retired", id, { rationaleHash: nativeSha256(input.rationale) }); return rootView(updated);
      });
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async rawTx => { const tx = rawTx as unknown as Db; await boundary(tx, companyId, actor); return inspect(tx, companyId, actor, await root(tx, companyId, id)); });
    },
    async list(companyId: string, actor: AuthorizationActor, cursor?: string) {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await boundary(tx, companyId, actor); const deadline = performance.now() + 30_000;
        const rows = await tx.select().from(processAnalysisDefinitions).where(and(eq(processAnalysisDefinitions.companyId, companyId), cursor ? sql`${processAnalysisDefinitions.id}>${cursor}::uuid` : undefined)).orderBy(asc(processAnalysisDefinitions.id)).limit(101);
        const items = [];
        for (const row of rows.slice(0, 100)) {
          if (performance.now() >= deadline) throw conflict("Process definition inspection exceeded its bounded budget");
          try { const detail = await inspect(tx, companyId, actor, row, false); items.push({ ...detail.root, definition: detail.effectiveVersion.definition,
            nextReviewAt: detail.effectiveVersion.nextReviewAt, expiresAt: detail.effectiveVersion.expiresAt, reviewReason: detail.reviewReason }); }
          catch (error) { if (!statusError(error, [403, 404, 409])) throw error; }
        }
        return { items, nextCursor: rows.length > 100 ? rows[99].id : null, coverage: "bounded_current_authorized_page" as const };
      });
    },
    async run(companyId: string, actor: AuthorizationActor, id: string, raw: RunProcessAnalysis): Promise<ProcessAnalysisRunView> {
      const input = runProcessAnalysisSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor); const row = await root(tx, companyId, id);
        if (row.status !== "published" || row.publishedVersionId !== input.versionId) throw conflict("Execution requires the current human-published process version");
        const pin = await version(tx, companyId, id, input.versionId); await publication(tx, companyId, id, input.versionId);
        await current(tx, companyId, actor, pin);
        const snapshot = await captureNativeProcessSnapshot(tx, companyId, actor, nativeProcessRequirements(pin.definition, input));
        const now = new Date(); const result = calculateNativeProcess(companyId, pin.definition, input, snapshot.events, snapshot.readiness, now);
        const policies = await current(tx, companyId, actor, pin);
        const expiresAt = new Date(Math.min(pin.expiresAt.getTime(), now.getTime() + pin.definition.retentionDays * DAY, ...snapshot.events.map(event => Date.parse(event.expiresAt))));
        if (expiresAt <= now) throw conflict("An input expired during process calculation");
        const runId = randomUUID(), lineageManifestId = randomUUID();
        await tx.insert(analyticalLineageManifests).values({ id: lineageManifestId, companyId, analysisType: "process_analysis", analysisRef: runId,
          engineVersion: NATIVE_PROCESS_ENGINE_VERSION, inputHash: snapshot.readiness.eventSetHash, definitionHash: pin.contentHash, requestedBy: analyticalRequesterId(actor),
          sourceWatermark: snapshot.events.at(-1)?.occurredAt ?? "empty_authorized_snapshot", sourceCount: snapshot.events.length, parameters: input, createdAt: now, expiresAt });
        await retainNativeEventLineage(tx, companyId, lineageManifestId, snapshot.events, policies);
        await tx.insert(processAnalysisRuns).values({ id: runId, companyId, definitionId: id, versionId: pin.id, lineageManifestId, definitionHash: pin.contentHash,
          eventSetHash: snapshot.readiness.eventSetHash, from: sql`${input.from}::timestamptz`, until: sql`${input.until}::timestamptz`, result, createdBy: analyticalRequesterId(actor), createdAt: now, expiresAt });
        await audit(tx, publications, companyId, actor, "process_analysis.completed", id, { runId, lineageManifestId, status: result.status, errorCode: result.errorCode });
        return { id: runId, companyId, definitionId: id, versionId: pin.id, lineageManifestId, definitionHash: pin.contentHash, eventSetHash: snapshot.readiness.eventSetHash,
          from: input.from, until: input.until, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), authorizationCheckedAt: now.toISOString(), result };
      });
    },
    async getRun(companyId: string, actor: AuthorizationActor, id: string, runId: string): Promise<ProcessAnalysisRunView> {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await boundary(tx, companyId, actor); const row = await root(tx, companyId, id);
        const [run] = await tx.select({ row: processAnalysisRuns,
          exactFrom: sql<string>`to_char(${processAnalysisRuns.from} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          exactUntil: sql<string>`to_char(${processAnalysisRuns.until} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }).from(processAnalysisRuns)
          .where(and(eq(processAnalysisRuns.companyId, companyId), eq(processAnalysisRuns.definitionId, id), eq(processAnalysisRuns.id, runId))).for("share");
        if (!run || run.row.expiresAt <= new Date()) throw notFound("Process run is unavailable or expired");
        const pin = await version(tx, companyId, id, run.row.versionId); await publication(tx, companyId, id, pin.id);
        const effective = row.publishedVersionId ? await version(tx, companyId, id, row.publishedVersionId) : pin;
        await current(tx, companyId, actor, effective);
        await currentAnalyticalPurpose(tx, companyId, { ...effective.definition, retentionDays: Math.max(pin.definition.retentionDays, effective.definition.retentionDays) }, "process");
        const snapshot = await captureNativeProcessSnapshot(tx, companyId, actor, nativeProcessRequirements({ ...pin.definition,
          governanceObligationRefs: effective.definition.governanceObligationRefs }, { versionId: pin.id, from: run.exactFrom, until: run.exactUntil }));
        if (snapshot.readiness.eventSetHash !== run.row.eventSetHash || pin.contentHash !== run.row.definitionHash
          || (run.row.result.status === "succeeded" && snapshot.readiness.admission !== "DATA_READY")) throw conflict("Current source access or snapshot changed; the retained process result requires review");
        const [manifest] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), eq(analyticalLineageManifests.id, run.row.lineageManifestId))).for("share");
        if (!manifest || manifest.expiresAt <= new Date() || manifest.inputHash !== run.row.eventSetHash || manifest.definitionHash !== pin.contentHash || manifest.analysisType !== "process_analysis" || manifest.analysisRef !== runId) throw conflict("Process lineage integrity is unavailable");
        await inspectNativeEventLineage(tx,companyId,actor,manifest.id,snapshot.events,pin.definition.governanceObligationRefs);
        const { createdBy: _createdBy, from: _from, until: _until, ...retained } = run.row;
        return { ...retained, from: run.exactFrom, until: run.exactUntil, createdAt: run.row.createdAt.toISOString(), expiresAt: run.row.expiresAt.toISOString(), authorizationCheckedAt: snapshot.readiness.assessedAt };
      });
    },
    async listRuns(companyId: string, actor: AuthorizationActor, id: string, cursor?: string) {
      return db.transaction(async rawTx=>{
        const tx=rawTx as unknown as Db;await boundary(tx,companyId,actor);
        await inspect(tx,companyId,actor,await root(tx,companyId,id),false);
        const deadline=performance.now()+30_000;
        const rows=await tx.select({id:processAnalysisRuns.id}).from(processAnalysisRuns).where(and(eq(processAnalysisRuns.companyId,companyId),
          eq(processAnalysisRuns.definitionId,id),cursor ? sql`${processAnalysisRuns.id}>${cursor}::uuid` : undefined)).orderBy(asc(processAnalysisRuns.id)).limit(6);
        const items:ProcessAnalysisRunView[]=[];
        for(const row of rows.slice(0,5)) {
          if(performance.now()>=deadline) throw conflict("Retained process inspection exceeded its bounded budget; inspect individual runs");
          try {items.push(await processAnalysisService(tx).getRun(companyId,actor,id,row.id));}
          catch(error) {if(!statusError(error,[403,404,409])) throw error;}
        }
        return {items,nextCursor:rows.length>5 ? rows[4].id : null,coverage:"bounded_current_authorized_page" as const};
      });
    },
    async sweepExpired(now = new Date()) {
      const due = await db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
        return tx.select({ companyId: processAnalysisVersions.companyId }).from(processAnalysisVersions).where(lte(processAnalysisVersions.expiresAt, now))
          .groupBy(processAnalysisVersions.companyId).orderBy(sql`min(${processAnalysisVersions.expiresAt})`, asc(processAnalysisVersions.companyId)).limit(21);
      });
      let erasedDefinitions = 0;
      for (const company of due.slice(0, 20)) erasedDefinitions += await db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
        await lockAnalyticalCompany(tx, company.companyId); await lockMemoryPrivacy(tx, company.companyId);
        const rows = await tx.select({ definitionId: processAnalysisVersions.definitionId }).from(processAnalysisVersions)
          .where(and(eq(processAnalysisVersions.companyId, company.companyId), lte(processAnalysisVersions.expiresAt, now))).orderBy(asc(processAnalysisVersions.expiresAt), asc(processAnalysisVersions.id)).limit(100);
        if (!rows.length) return 0;
        const ids = [...new Set(rows.map(row => row.definitionId))];
        // Delete lineage first so no result metadata survives the version owner.
        await tx.delete(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, company.companyId),
          inArray(analyticalLineageManifests.id, tx.select({ id: processAnalysisRuns.lineageManifestId }).from(processAnalysisRuns)
            .where(and(eq(processAnalysisRuns.companyId, company.companyId), inArray(processAnalysisRuns.definitionId, ids))))));
        return (await tx.delete(processAnalysisDefinitions).where(and(eq(processAnalysisDefinitions.companyId, company.companyId), inArray(processAnalysisDefinitions.id, ids))).returning({ id: processAnalysisDefinitions.id })).length;
      });
      return { checkedCompanies: Math.min(due.length, 20), erasedDefinitions, hasMoreCompanies: due.length > 20 };
    },
  };
}
