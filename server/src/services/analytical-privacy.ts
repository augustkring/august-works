import { and, eq, inArray, or, sql } from "drizzle-orm";
import { analyticalSourceSuppressions, type Db } from "@paperclipai/db";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import type { StrategyErasureType } from "./strategy-execution/privacy.js";
import { eraseAnalyticalSourcesUnderMemory } from "./analytical-source-erasure.js";
import { conflict } from "../errors.js";
type PrivacyTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Preserve the existing company serialization key: native owner erasure,
 * event projection and analytical publication use one ordering boundary. */
export async function lockAnalyticalCompany(tx: Pick<Db, "execute">, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`business-events:${companyId}`}, 0))`);
}
/** Native privacy/verified restore callers own admission. Rollout never gates
 * this operation. A minimal guard prevents late or restored payload publication. */
export async function suppressAnalyticalSource(tx: PrivacyTx, companyId: string, inputType: StrategyErasureType, inputRef: string, suppressedAt = new Date()) {
  await lockAnalyticalCompany(tx, companyId);
  await lockMemoryPrivacy(tx as unknown as Db, companyId);
  await eraseAnalyticalSourcesUnderMemory(tx as unknown as Db, companyId, inputType, [inputRef], suppressedAt);
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
