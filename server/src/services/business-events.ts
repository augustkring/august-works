import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { activityLog, businessEvents, businessEventObjects, businessEventSuppressions, businessEventBackfillRuns, issues, projects, type Db } from "@paperclipai/db";
import { BUSINESS_EVENT_PROJECTOR_VERSION, businessEventAttributesSchema, businessEventBackfillSchema, businessEventListSchema, businessEventObjectSchema, v8FeatureEnabled, type BusinessEvent, type BusinessEventAttributes, type BusinessEventBackfill, type BusinessEventList, type BusinessEventObject } from "@paperclipai/shared";
import { forbidden, notFound } from "../errors.js";
import { accessService } from "./access.js";
import type { AuthorizationActor } from "./authorization.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
import { instanceSettingsService } from "./instance-settings.js";
import { lockBusinessEventSource, suppressBusinessEventSource } from "./business-event-privacy.js";
import { assertAnalyticalSourcesNotErased } from "./analytical-privacy.js";

type ActivitySource = typeof activityLog.$inferSelect;
const ACTIONS = new Set(["issue.created", "issue.updated", "issue.checked_out", "issue.released", "project.created", "project.updated"]);

/** Only observed, typed facts enter the projection. No message, identity,
 * credential or current-state enrichment becomes historical evidence. */
export function projectBusinessEvent(source: ActivitySource) {
  if (!ACTIONS.has(source.action) || !source.action.startsWith(`${source.entityType}.`)) return null;
  const primary = businessEventObjectSchema.safeParse({ objectType: source.entityType, objectId: source.entityId, qualifier: "primary" });
  if (!primary.success) return null;
  const attributes: BusinessEventAttributes = {};
  for (const key of ["status", "previousStatus", "priority"] as const) {
    const field = businessEventAttributesSchema.shape[key].safeParse(source.details?.[key]);
    if (field.success && field.data !== undefined) Object.assign(attributes, { [key]: field.data });
  }
  const objects: BusinessEventObject[] = [primary.data];
  // This relation is included only when recorded in the source event, never
  // inferred from the issue's current project assignment.
  if (source.entityType === "issue") {
    const related = businessEventObjectSchema.safeParse({ objectType: "project", objectId: source.details?.projectId, qualifier: "related" });
    if (related.success) objects.push(related.data);
  }
  const lifecycle = source.action.slice(source.action.indexOf(".") + 1);
  const content = { eventType: source.action, activity: source.action, lifecycle, occurredAt: source.createdAt.toISOString(), objects, attributes, version: BUSINESS_EVENT_PROJECTOR_VERSION };
  const sourceHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return { ...content, sourceHash };
}

export function businessEventService(db: Db) {
  const access = accessService(db);
  async function admit(companyId: string, actor: AuthorizationActor, write = false) {
    if (!(await access.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true })).allowed)
      throw forbidden("Business events are outside this actor's authorization boundary");
    if (write && (actor.type !== "board" || !(await access.decide({ actor, action: "audit:view_agent_actions", resource: { type: "company", companyId } })).allowed))
      throw forbidden("Business event projection requires board audit authority");
    if (!v8FeatureEnabled(await instanceSettingsService(db).getExperimental(), "business_events_v8"))
      throw notFound("Business events are not enabled");
  }
  async function readable(companyId: string, actor: AuthorizationActor, objects: BusinessEventObject[]) {
    if (!objects.length) return false;
    try {
      await assertAnalyticalSourcesNotErased(db, companyId, objects.filter(o => o.objectType === "issue").map(o => o.objectId), objects.filter(o => o.objectType === "project").map(o => o.objectId));
    } catch (error) {
      if (!error || typeof error !== "object" || !("status" in error) || error.status !== 409) throw error;
      return false;
    }
    for (const object of objects) {
      if (object.objectType === "issue") {
        const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, object.objectId)));
        if (!issue || !(await access.decide({ actor, action: "issue:read", enforceResponsibleUserIntersection: true, resource: {
          type: "issue", companyId, issueId: issue.id, projectId: issue.projectId, parentIssueId: issue.parentId,
          assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId, status: issue.status, originKind: issue.originKind, originId: issue.originId,
        } })).allowed) return false;
      } else {
        const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, object.objectId)));
        if (!project || !(await access.decide({ actor, action: "project:read", enforceResponsibleUserIntersection: true, resource: { type: "project", companyId, projectId: project.id } })).allowed) return false;
      }
    }
    return true;
  }
  function auditActor(actor: AuthorizationActor) {
    return actor.type === "agent" ? { actorType: "agent" as const, actorId: actor.agentId!, agentId: actor.agentId }
      : { actorType: "user" as const, actorId: actor.userId ?? "local-board" };
  }
  return {
    async backfill(companyId: string, actor: AuthorizationActor, input: BusinessEventBackfill) {
      await admit(companyId, actor, true);
      const query = businessEventBackfillSchema.parse(input);
      const cursor = query.cursor;
      const rows = await db.select({ id: activityLog.id,
        // PostgreSQL source timestamps may have microseconds. A JS Date would
        // truncate the cursor and replay the same row at a page boundary.
        cursorAt: sql<string>`to_char(${activityLog.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      }).from(activityLog).where(and(
        eq(activityLog.companyId, companyId), sql`${activityLog.createdAt} >= ${query.from}::timestamptz`, sql`${activityLog.createdAt} <= ${query.until}::timestamptz`,
        cursor ? sql`(${activityLog.createdAt}, ${activityLog.id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
      )).orderBy(asc(activityLog.createdAt), asc(activityLog.id)).limit(query.limit);
      let projected = 0;
      let unchanged = 0;
      for (const row of rows) {
        const publications: ActivityPublication[] = [];
        const result = await db.transaction(async (tx) => {
          await lockBusinessEventSource(tx, companyId, row.id);
          const [suppressed] = await tx.select().from(businessEventSuppressions).where(and(eq(businessEventSuppressions.companyId, companyId), eq(businessEventSuppressions.sourceRef, row.id)));
          if (suppressed) return "ignored";
          const [source] = await tx.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.id, row.id))).for("share");
          if (!source) return "ignored";
          const event = projectBusinessEvent(source);
          if (!event || !await readable(companyId, actor, event.objects)) return "ignored";
          const [previous] = await tx.select().from(businessEvents).where(and(eq(businessEvents.companyId, companyId), eq(businessEvents.sourceRef, source.id))).orderBy(desc(businessEvents.revision)).limit(1);
          if (previous?.sourceHash === event.sourceHash) return "unchanged";
          const now = new Date();
          const [created] = await tx.insert(businessEvents).values({
            ...(previous ? {} : { id: source.id }), companyId,
            eventType: event.eventType, activity: event.activity, lifecycle: event.lifecycle,
            occurredAt: source.createdAt, observedAt: now, sourceClass: "aw_native", sourceProvider: "activity_log",
            sourceRef: source.id, sourceVersion: BUSINESS_EVENT_PROJECTOR_VERSION, sourceHash: event.sourceHash,
            revision: (previous?.revision ?? 0) + 1, attributes: event.attributes,
            purpose: "process_intelligence", sensitivity: "internal", trustLevel: "observed", supersedesEventId: previous?.id ?? null,
          }).returning();
          await tx.insert(businessEventObjects).values(event.objects.map((object) => ({ ...object, companyId, eventId: created.id })));
          if (previous) await tx.update(businessEvents).set({ tombstonedAt: now }).where(and(eq(businessEvents.companyId, companyId), eq(businessEvents.id, previous.id)));
          await logActivity(tx as unknown as Db, { companyId, ...auditActor(actor), action: "business_event.projected", entityType: "business_event", entityId: created.id, details: { projector: BUSINESS_EVENT_PROJECTOR_VERSION, revision: created.revision } }, publications);
          return "projected";
        });
        publications.forEach(publishActivity);
        if (result === "projected") projected++;
        if (result === "unchanged") unchanged++;
      }
      const last = rows.at(-1);
      const lastSourceCursor = last ? { at: last.cursorAt, id: last.id } : null;
      const publications: ActivityPublication[] = [];
      const run = await db.transaction(async (tx) => {
        const [record] = await tx.insert(businessEventBackfillRuns).values({ companyId, projectorVersion: BUSINESS_EVENT_PROJECTOR_VERSION,
          windowFrom: new Date(query.from), windowUntil: new Date(query.until), startCursor: query.cursor ?? null, lastSourceCursor,
          batchLimit: query.limit, projected, unchanged, status: rows.length === query.limit ? "batch_limit_reached" : "window_scan_exhausted" }).returning({ id: businessEventBackfillRuns.id });
        await logActivity(tx as unknown as Db, { companyId, ...auditActor(actor), action: "business_event.backfill_recorded", entityType: "business_event_backfill", entityId: record.id, details: { projector: BUSINESS_EVENT_PROJECTOR_VERSION, projected, unchanged } }, publications);
        return record;
      });
      publications.forEach(publishActivity);
      return { runId: run.id, projectorVersion: BUSINESS_EVENT_PROJECTOR_VERSION, from: query.from, until: query.until, projected, unchanged,
        nextCursor: rows.length === query.limit ? lastSourceCursor : null,
        coverage: "bounded_source_window" as const };
    },
    async list(companyId: string, actor: AuthorizationActor, input: BusinessEventList) {
      await admit(companyId, actor);
      const query = businessEventListSchema.parse(input);
      const rows = await db.select().from(businessEvents).where(and(eq(businessEvents.companyId, companyId), isNull(businessEvents.tombstonedAt),
        sql`not exists (select 1 from ${businessEventSuppressions} where ${businessEventSuppressions.companyId} = ${businessEvents.companyId} and ${businessEventSuppressions.sourceRef} = ${businessEvents.sourceRef})`,
        sql`${businessEvents.occurredAt} >= ${query.from}::timestamptz`, sql`${businessEvents.occurredAt} <= ${query.until}::timestamptz`,
        query.cursor ? sql`(${businessEvents.occurredAt}, ${businessEvents.id}) > (${query.cursor.at}::timestamptz, ${query.cursor.id}::uuid)` : undefined,
      )).orderBy(asc(businessEvents.occurredAt), asc(businessEvents.id)).limit(query.limit);
      const items: BusinessEvent[] = [];
      for (const row of rows) {
        const [source] = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.id, row.sourceRef)));
        if (!source || projectBusinessEvent(source)?.sourceHash !== row.sourceHash) continue;
        const objects = await db.select({ objectType: businessEventObjects.objectType, objectId: businessEventObjects.objectId, qualifier: businessEventObjects.qualifier })
          .from(businessEventObjects).where(and(eq(businessEventObjects.companyId, companyId), eq(businessEventObjects.eventId, row.id))).orderBy(asc(businessEventObjects.qualifier), asc(businessEventObjects.objectType), asc(businessEventObjects.objectId));
        if (!await readable(companyId, actor, objects)) continue;
        items.push({ id: row.id, companyId, eventType: row.eventType, activity: row.activity, lifecycle: row.lifecycle,
          occurredAt: row.occurredAt.toISOString(), observedAt: row.observedAt.toISOString(), sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null, receivedAt: row.receivedAt?.toISOString() ?? null,
          source: { class: "aw_native", provider: "activity_log", ref: row.sourceRef, version: row.sourceVersion, contentHash: row.sourceHash },
          revision: row.revision, objects, attributes: businessEventAttributesSchema.parse(row.attributes), purpose: "process_intelligence", sensitivity: "internal", trustLevel: "observed", supersedesEventId: row.supersedesEventId, tombstonedAt: null });
      }
      // The source scan position is operational pagination, never a denominator
      // or assertion that this page covers the actor's entire event population.
      const last = rows.at(-1);
      return { items, nextCursor: rows.length === query.limit && last ? { at: last.occurredAt.toISOString(), id: last.id } : null };
    },
    async suppressSource(companyId: string, actor: AuthorizationActor, sourceRef: string) {
      await admit(companyId, actor, true);
      const publications: ActivityPublication[] = [];
      await db.transaction(async (tx) => {
        await suppressBusinessEventSource(tx, companyId, sourceRef);
        await logActivity(tx as unknown as Db, { companyId, ...auditActor(actor), action: "business_event.source_suppressed", entityType: "business_event_source", entityId: sourceRef, details: { projector: BUSINESS_EVENT_PROJECTOR_VERSION } }, publications);
      });
      publications.forEach(publishActivity);
      return { suppressed: true as const };
    },
  };
}
