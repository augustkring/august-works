import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { analyticalLineageManifests, type Db } from "@paperclipai/db";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { eraseAnalyticalContextSourcesUnderMemory } from "./analytical-context-privacy.js";

/** Internal native retention; expiry, company and Memory own admission. Disabled
 * features and paused companies cannot preserve expired analytical payloads. */
export async function eraseExpiredAnalyticalLineage(db: Db, now = new Date()) {
  const due = await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
    return tx.select({ companyId: analyticalLineageManifests.companyId }).from(analyticalLineageManifests)
      .where(lte(analyticalLineageManifests.expiresAt,now)).groupBy(analyticalLineageManifests.companyId)
      .orderBy(sql`min(${analyticalLineageManifests.expiresAt})`,asc(analyticalLineageManifests.companyId)).limit(21);
  });
  let erased = 0;
  for (const company of due.slice(0,20)) erased += await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
    await lockAnalyticalCompany(tx,company.companyId); await lockMemoryPrivacy(tx,company.companyId);
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
