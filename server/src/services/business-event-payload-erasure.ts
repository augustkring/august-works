import { and, eq, sql } from "drizzle-orm";
import { analyticalLineageManifests, businessEvents, type Db } from "@paperclipai/db";

/** Native source erasure callers hold Memory; projection takes analytical then
 * Memory. This payload-only step intentionally acquires no advisory lock. */
export async function eraseBusinessEventObjectUnderMemory(tx: Db, companyId: string, objectType: "issue" | "project", objectId: string) {
  await tx.execute(sql`
    insert into business_event_suppressions (company_id, source_ref, suppressed_at)
    select ${companyId}::uuid, source_ref, now() from (
      select a.id as source_ref from activity_log a
      where a.company_id=${companyId}::uuid and ((a.entity_type=${objectType} and a.entity_id=${objectId})
        or (${objectType}='project' and a.entity_type='issue' and a.details->>'projectId'=${objectId}))
      union select e.source_ref from business_events e join business_event_objects o on o.company_id=e.company_id and o.event_id=e.id
      where o.company_id=${companyId}::uuid and o.object_type=${objectType} and o.object_id=${objectId}::uuid
    ) sources on conflict (company_id,source_ref) do nothing
  `);
  await tx.delete(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), sql`exists (
    select 1 from analytical_lineage_edges e join business_event_suppressions s on s.company_id=e.company_id and s.source_ref=e.input_ref
    where e.company_id=${analyticalLineageManifests.companyId} and e.manifest_id=${analyticalLineageManifests.id} and e.input_type='business_event_source')`));
  await tx.delete(businessEvents).where(and(eq(businessEvents.companyId, companyId), sql`exists (select 1 from business_event_suppressions s where s.company_id=${businessEvents.companyId} and s.source_ref=${businessEvents.sourceRef})`));
}
