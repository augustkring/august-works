import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { analyticalLineageManifests, learningCycles, type Db } from "@paperclipai/db";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { eraseAnalyticalContextSourcesUnderMemory } from "./analytical-context-privacy.js";

/** Internal native retention; expiry, company and Memory own admission. Disabled
 * features and paused companies cannot preserve expired analytical payloads. */
export async function eraseExpiredAnalyticalLineage(db: Db, now = new Date()) {
  const due = await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
    return tx.execute<{companyId:string}>(sql`select company_id as "companyId" from (
      select company_id,expires_at as due_at from analytical_lineage_manifests where expires_at<=${now.toISOString()}::timestamptz
      union all select company_id,analytical_source_expires_at as due_at from learning_cycles
        where erased_at is null and analytical_source_count>0 and analytical_source_expires_at<=${now.toISOString()}::timestamptz
    ) due group by company_id order by min(due_at),company_id limit 21`);
  });
  let erased = 0;
  for (const company of due.slice(0,20)) erased += await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
    await lockAnalyticalCompany(tx,company.companyId); await lockMemoryPrivacy(tx,company.companyId);
    // ponytail: ten cycles per company/tick; increase only after measuring backlog.
    const expiredCycles=await tx.select({id:learningCycles.id}).from(learningCycles).where(and(eq(learningCycles.companyId,company.companyId),sql`${learningCycles.erasedAt} is null`,sql`${learningCycles.analyticalSourceCount}>0`,lte(learningCycles.analyticalSourceExpiresAt,now))).orderBy(asc(learningCycles.analyticalSourceExpiresAt),asc(learningCycles.id)).limit(10);
    if(expiredCycles.length){const {invalidateLearningCycles}=await import("./learning/learning-privacy.js");await invalidateLearningCycles(tx,company.companyId,expiredCycles.map(row=>row.id),true);}
    const expired = await tx.select({ id: analyticalLineageManifests.id }).from(analyticalLineageManifests)
      .where(and(eq(analyticalLineageManifests.companyId,company.companyId),lte(analyticalLineageManifests.expiresAt,now)))
      .orderBy(asc(analyticalLineageManifests.expiresAt),asc(analyticalLineageManifests.id)).limit(100);
    if (!expired.length) return 0;
    await eraseAnalyticalContextSourcesUnderMemory(tx,company.companyId,expired.map(row=>row.id),now);
    return (await tx.delete(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,company.companyId),
      inArray(analyticalLineageManifests.id,expired.map(row => row.id)))).returning({ id: analyticalLineageManifests.id })).length;
  });
  return { checkedCompanies: Math.min(due.length,20), erasedManifests: erased, hasMoreCompanies: due.length>20 };
}
