import { and, eq, sql } from "drizzle-orm";
import { analyticalLineageManifests, managementReviewSnapshots, managementReviewSourceLinks, type Db } from "@paperclipai/db";
import type { StrategyErasureType } from "../strategy-execution/privacy.js";
/** Internal owner erasure under the existing Memory boundary. Never acquire the
 * analytical lock from this callback; rollout/paused state cannot gate erasure. */
export async function eraseManagementSourceUnderMemory(tx: Db, companyId: string, type: StrategyErasureType | "learning_cycle", refs: string[]) {
  if (!refs.length) return;
  await tx.delete(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), sql`exists (select 1 from ${managementReviewSnapshots} r inner join ${managementReviewSourceLinks} s on s.company_id=r.company_id and s.review_id=r.id where r.company_id=${analyticalLineageManifests.companyId} and r.lineage_manifest_id=${analyticalLineageManifests.id} and s.source_type=${type} and s.source_ref in (${sql.join([...new Set(refs)].map(id => sql`${id}::uuid`), sql`,`)}))`));
}
