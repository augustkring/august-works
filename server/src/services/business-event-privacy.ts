import { and, eq, sql } from "drizzle-orm";
import { businessEvents, businessEventSuppressions, type Db } from "@paperclipai/db";

export type BusinessEventPrivacyTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Acquire before source or native object row locks. Bounded projection batches
 * release this lock after each source; erasure remains atomic with its owner. */
export async function lockBusinessEventCompany(tx: BusinessEventPrivacyTx, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`business-events:${companyId}`}, 0))`);
}

/** Projection writers and privacy operations serialize on the same source,
 * including sources no longer present in the authoritative activity log. */
export async function lockBusinessEventSource(tx: BusinessEventPrivacyTx, companyId: string, sourceRef: string) {
  await lockBusinessEventCompany(tx, companyId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:${sourceRef}`}, 0))`);
}

/** Called inside the native object's delete transaction, even with rollout off.
 * Include historical links and not-yet-projected source identities so a restore
 * cannot recreate the removed object's analytical history. No payload is kept. */
export async function suppressBusinessEventsForObject(
  tx: BusinessEventPrivacyTx, companyId: string, objectType: "issue" | "project", objectId: string,
) {
  await lockBusinessEventCompany(tx, companyId);
  await tx.execute(sql`
    insert into business_event_suppressions (company_id, source_ref, suppressed_at)
    select ${companyId}::uuid, source_ref, now() from (
      select a.id as source_ref from activity_log a
      where a.company_id = ${companyId}::uuid and (
        (a.entity_type = ${objectType} and a.entity_id = ${objectId})
        or (${objectType} = 'project' and a.entity_type = 'issue' and a.details->>'projectId' = ${objectId})
      )
      union
      select e.source_ref from business_events e
      join business_event_objects o on o.company_id = e.company_id and o.event_id = e.id
      where o.company_id = ${companyId}::uuid and o.object_type = ${objectType} and o.object_id = ${objectId}::uuid
    ) sources
    on conflict (company_id, source_ref) do nothing
  `);
  await tx.delete(businessEvents).where(and(
    eq(businessEvents.companyId, companyId),
    sql`exists (select 1 from business_event_suppressions s where s.company_id = ${businessEvents.companyId} and s.source_ref = ${businessEvents.sourceRef})`,
  ));
}

/** Internal privacy owner path. Deliberately independent of rollout flags and
 * actor admission; callers must authorize the deletion or authenticate its ledger. */
export async function suppressBusinessEventSource(tx: BusinessEventPrivacyTx, companyId: string, sourceRef: string, suppressedAt = new Date()) {
  await lockBusinessEventSource(tx, companyId, sourceRef);
  await tx.insert(businessEventSuppressions).values({ companyId, sourceRef, suppressedAt }).onConflictDoNothing();
  await tx.delete(businessEvents).where(and(eq(businessEvents.companyId, companyId), eq(businessEvents.sourceRef, sourceRef)));
}
