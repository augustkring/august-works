import { and, eq, sql } from "drizzle-orm";
import { businessEvents, type Db } from "@paperclipai/db";

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
  await tx.delete(businessEvents).where(and(eq(businessEvents.companyId, companyId), sql`exists (select 1 from business_event_suppressions s where s.company_id=${businessEvents.companyId} and s.source_ref=${businessEvents.sourceRef})`));
}
