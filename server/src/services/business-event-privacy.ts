import { and, eq, sql } from "drizzle-orm";
import { analyticalLineageManifests, businessEvents, businessEventSuppressions, type Db } from "@paperclipai/db";

export type BusinessEventPrivacyTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

import { lockAnalyticalCompany as lockBusinessEventCompany, suppressAnalyticalSource } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { eraseBusinessEventObjectUnderMemory } from "./business-event-payload-erasure.js";
export { lockAnalyticalCompany as lockBusinessEventCompany } from "./analytical-privacy.js";

/** Projection writers and privacy operations serialize on the same source,
 * including sources no longer present in the authoritative activity log. */
export async function lockBusinessEventSource(tx: BusinessEventPrivacyTx, companyId: string, sourceRef: string) {
  await lockBusinessEventCompany(tx, companyId);
  await lockMemoryPrivacy(tx as unknown as Db, companyId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:${sourceRef}`}, 0))`);
}

/** Called inside the native object's delete transaction, even with rollout off.
 * Include historical links and not-yet-projected source identities so a restore
 * cannot recreate the removed object's analytical history. No payload is kept. */
export async function suppressBusinessEventsForObject(
  tx: BusinessEventPrivacyTx, companyId: string, objectType: "issue" | "project", objectId: string,
) {
  await lockBusinessEventCompany(tx, companyId);
  await lockMemoryPrivacy(tx as unknown as Db, companyId);
  await eraseBusinessEventObjectUnderMemory(tx as unknown as Db, companyId, objectType, objectId);
  await suppressAnalyticalSource(tx, companyId, objectType, objectId);
}

/** Internal privacy owner path. Deliberately independent of rollout flags and
 * actor admission; callers must authorize the deletion or authenticate its ledger. */
export async function suppressBusinessEventSource(tx: BusinessEventPrivacyTx, companyId: string, sourceRef: string, suppressedAt = new Date()) {
  await lockBusinessEventSource(tx, companyId, sourceRef);
  await tx.insert(businessEventSuppressions).values({ companyId, sourceRef, suppressedAt }).onConflictDoNothing();
  await tx.delete(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId),
    sql`exists (select 1 from analytical_lineage_edges e where e.company_id=${analyticalLineageManifests.companyId} and e.manifest_id=${analyticalLineageManifests.id} and e.input_type='business_event_source' and e.input_ref=${sourceRef}::uuid)`));
  await tx.delete(businessEvents).where(and(eq(businessEvents.companyId, companyId), eq(businessEvents.sourceRef, sourceRef)));
}
