import { and, eq, inArray, sql } from "drizzle-orm";
import { analyticalLineageManifests, businessMetricTargets, type Db } from "@paperclipai/db";
import { eraseManagementSourceUnderMemory } from "./management-reviews/privacy.js";
import { eraseAnalyticalContextSourcesUnderMemory } from "./analytical-context-privacy.js";
import { eraseStrategySource, type StrategyErasureType } from "./strategy-execution/privacy.js";

/** The caller already holds Memory privacy. Analytical publishers acquire their
 * company boundary then Memory before source reads. Never seek the analytical
 * boundary from a Memory erasure callback. Flags cannot disable this path. */
export async function eraseAnalyticalSourcesUnderMemory(tx: Db, companyId: string, type: StrategyErasureType, refs: string[], at = new Date()) {
  if (!refs.length) return;
  const ids = [...new Set(refs)];
  const contextSources = await tx.select({id:analyticalLineageManifests.id}).from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),sql`exists (select 1 from analytical_lineage_edges e where e.company_id=${analyticalLineageManifests.companyId} and e.manifest_id=${analyticalLineageManifests.id} and e.input_type=${type} and e.input_ref in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}))`));
  await eraseAnalyticalContextSourcesUnderMemory(tx,companyId,contextSources.map(row=>row.id),at);
  await eraseManagementSourceUnderMemory(tx, companyId, type, ids);
  await eraseStrategySource(tx, companyId, type, ids, at);
  if (type === "goal" || type === "project") await tx.delete(businessMetricTargets).where(and(eq(businessMetricTargets.companyId, companyId), type === "goal" ? inArray(businessMetricTargets.goalId, ids) : inArray(businessMetricTargets.projectId, ids)));
  await tx.delete(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), sql`exists (select 1 from analytical_lineage_edges e where e.company_id=${analyticalLineageManifests.companyId} and e.manifest_id=${analyticalLineageManifests.id} and e.input_type=${type} and e.input_ref in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)}))`));
}
