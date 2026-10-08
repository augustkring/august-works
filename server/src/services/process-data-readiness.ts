import { assertAnalyticalReader } from "./analytical-reader.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { activityLog, type Db } from "@paperclipai/db";
import { NATIVE_PROCESS_ACTIVITIES, assessProcessDataSchema, v7FeatureEnabled, v8FeatureEnabled, type AssessProcessData, type BusinessEvent } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { assertV7Authorization } from "./v7-authorization.js";
import type { AuthorizationActor } from "./authorization.js";
import { instanceSettingsService } from "./instance-settings.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "./analytical-purpose.js";
import { businessEventService, projectBusinessEvent } from "./business-events.js";
import { assessNativeProcessData } from "./process-data-readiness-engine.js";

/** Current native data inspection, independent of V7 agent/action readiness.
 * This read-only preview grants no execution permission or process-analysis claim. */
export async function captureNativeProcessSnapshot(tx: Db, companyId: string, actor: AuthorizationActor, raw: AssessProcessData) {
  const input = assessProcessDataSchema.parse(raw); await assertAnalyticalReader(tx,companyId,actor);
  const deadline=performance.now()+30_000;
  await tx.execute(sql`set local statement_timeout='8s'`);
  await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId);
  await assertV7Authorization(tx,actor,companyId,"company_scope:read");
  const flags=await instanceSettingsService(tx).getExperimental();
  if (!v8FeatureEnabled(flags,"process_intelligence_v8") || !v7FeatureEnabled(flags,"governance_evidence_v7")) throw notFound("Governed process-data readiness is not enabled");
  const purpose={ governanceObligationRefs: input.governanceObligationRefs, retentionDays: input.retentionDays,
    purpose: "process_intelligence" as const, sensitivity: "internal" as const };
  await currentAnalyticalPurpose(tx,companyId,purpose,"process");
  const sources=await tx.select({ id: activityLog.id, action: activityLog.action,entityType: activityLog.entityType,entityId: activityLog.entityId,
    createdAt: activityLog.createdAt, exactTime: sql<string>`to_char(${activityLog.createdAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    // Typed source facts only: no activity body, identity or arbitrary JSON.
    details: sql<Record<string,unknown>>`jsonb_strip_nulls(jsonb_build_object('status',${activityLog.details}->'status','previousStatus',${activityLog.details}->'previousStatus','priority',${activityLog.details}->'priority','projectId',${activityLog.details}->'projectId'))`,
  }).from(activityLog).where(and(eq(activityLog.companyId,companyId),inArray(activityLog.action,[...NATIVE_PROCESS_ACTIVITIES]),
    sql`${activityLog.createdAt}>=${input.from}::timestamptz`,sql`${activityLog.createdAt}<=${input.until}::timestamptz`))
    .orderBy(asc(activityLog.createdAt),asc(activityLog.id)).limit(2001).for("share");
  const expectedNativeSources=sources.slice(0,2000).flatMap(source => {
    const event=projectBusinessEvent(source,source.exactTime);
    return event ? [{ ref: source.id,hash: event.sourceHash }] : [];
  });
  const events: BusinessEvent[]=[]; let cursor: { at: string; id: string } | undefined;
  let eventScanExhausted=false;
  for (let page=0;page<11;page++) {
    if (performance.now()>=deadline) throw conflict("Process-data inspection exceeded its bounded budget; reduce the requested period");
    const result=await businessEventService(tx).list(companyId,actor,{ from: input.from,until: input.until,limit: 200,cursor });
    events.push(...result.items);
    if (events.length>2000) { events.length=2000; break; }
    if (!result.nextCursor) { eventScanExhausted=true; break; }
    cursor=result.nextCursor;
  }
  // Existing rows are shared, but READ COMMITTED can still see a concurrent
  // backdated insert. Reinspect identities before binding a complete snapshot.
  const finalSources=await tx.select({id:activityLog.id}).from(activityLog).where(and(eq(activityLog.companyId,companyId),
    inArray(activityLog.action,[...NATIVE_PROCESS_ACTIVITIES]),sql`${activityLog.createdAt}>=${input.from}::timestamptz`,sql`${activityLog.createdAt}<=${input.until}::timestamptz`))
    .orderBy(asc(activityLog.createdAt),asc(activityLog.id)).limit(2001);
  const sourceIdentitiesStable=finalSources.length===sources.length && finalSources.every((row,index)=>row.id===sources[index].id);
  await assertAnalyticalReader(tx,companyId,actor);
  const now=new Date(); await currentAnalyticalPurpose(tx,companyId,purpose,"process",now);
  const readiness=assessNativeProcessData(companyId,input,events,{ sourceScanExhausted: sources.length<=2000 && sourceIdentitiesStable, eventScanExhausted,
    expectedNativeSources,nativeSourceLifecycleVerified: sources.every(source => projectBusinessEvent(source,source.exactTime)!==null) },now);
  return {readiness,events};
}
export function processDataReadinessService(db: Db) {
  return {
    async assess(companyId: string, actor: AuthorizationActor, raw: AssessProcessData) {
      return db.transaction(async rawTx => (await captureNativeProcessSnapshot(rawTx as unknown as Db,companyId,actor,raw)).readiness);
    },
  };
}
