import { and, eq, inArray, or, sql } from "drizzle-orm";
import { analyticalLineageManifests, analyticalSourceSuppressions, businessMetricTargets, type Db } from "@paperclipai/db";
import { conflict } from "../errors.js";
type PrivacyTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Preserve the existing company serialization key: native owner erasure,
 * event projection and analytical publication use one ordering boundary. */
export async function lockAnalyticalCompany(tx: Pick<Db, "execute">, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`business-events:${companyId}`}, 0))`);
}
/** Native privacy/verified restore callers own admission. Rollout never gates
 * this operation. A minimal guard prevents late or restored payload publication. */
export async function suppressAnalyticalSource(tx: PrivacyTx, companyId: string, inputType: "issue" | "project" | "goal", inputRef: string, suppressedAt = new Date()) {
  await lockAnalyticalCompany(tx, companyId);
  await tx.insert(analyticalSourceSuppressions).values({ companyId, inputType, inputRef, suppressedAt }).onConflictDoNothing();
  if (inputType === "goal" || inputType === "project") await tx.delete(businessMetricTargets).where(and(eq(businessMetricTargets.companyId, companyId),
    inputType === "goal" ? eq(businessMetricTargets.goalId, inputRef) : eq(businessMetricTargets.projectId, inputRef)));
  await tx.delete(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId),
    sql`exists (select 1 from analytical_lineage_edges e where e.company_id = ${analyticalLineageManifests.companyId}
      and e.manifest_id = ${analyticalLineageManifests.id} and e.input_type = ${inputType} and e.input_ref = ${inputRef}::uuid)`));
}
export async function assertAnalyticalSourcesNotErased(tx: Db, companyId: string, issueRefs: string[], projectRefs: string[]) {
  if (!issueRefs.length && !projectRefs.length) return;
  const markers = await tx.select({ inputRef: analyticalSourceSuppressions.inputRef }).from(analyticalSourceSuppressions).where(and(
    eq(analyticalSourceSuppressions.companyId, companyId), or(
      issueRefs.length ? and(eq(analyticalSourceSuppressions.inputType, "issue"), inArray(analyticalSourceSuppressions.inputRef, [...new Set(issueRefs)])) : undefined,
      projectRefs.length ? and(eq(analyticalSourceSuppressions.inputType, "project"), inArray(analyticalSourceSuppressions.inputRef, [...new Set(projectRefs)])) : undefined,
    ),
  )).limit(1);
  if (markers.length) throw conflict("An analytical source was erased; reconcile native sources before observing this population");
}
