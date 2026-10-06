import { and, eq, sql } from "drizzle-orm";
import { businessEvents, businessEventSuppressions, type Db } from "@paperclipai/db";

export type BusinessEventPrivacyTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Projection writers and privacy operations serialize on the same source,
 * including sources no longer present in the authoritative activity log. */
export async function lockBusinessEventSource(tx: BusinessEventPrivacyTx, companyId: string, sourceRef: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:${sourceRef}`}, 0))`);
}

/** Internal privacy owner path. Deliberately independent of rollout flags and
 * actor admission; callers must authorize the deletion or authenticate its ledger. */
export async function suppressBusinessEventSource(tx: BusinessEventPrivacyTx, companyId: string, sourceRef: string, suppressedAt = new Date()) {
  await lockBusinessEventSource(tx, companyId, sourceRef);
  await tx.insert(businessEventSuppressions).values({ companyId, sourceRef, suppressedAt }).onConflictDoNothing();
  await tx.delete(businessEvents).where(and(eq(businessEvents.companyId, companyId), eq(businessEvents.sourceRef, sourceRef)));
}
