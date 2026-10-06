import { and, eq, inArray, or, sql } from "drizzle-orm";
import { analyticalSourceSuppressions, strategyExecutionLinks, strategyExecutionLinkVersions, type Db } from "@paperclipai/db";

export type StrategyErasureType = "issue" | "project" | "goal" | "document" | "document_revision";
/** Caller holds the company Memory privacy boundary, or the analytical boundary
 * followed by Memory. Never invert that order from a Learning erasure callback. */
export async function eraseStrategySource(tx: Db, companyId: string, type: StrategyErasureType, refs: string[], at = new Date()) {
  if (!refs.length) return;
  await tx.insert(analyticalSourceSuppressions).values([...new Set(refs)].map(inputRef => ({ companyId, inputType: type, inputRef, suppressedAt: at }))).onConflictDoNothing();
  if (type === "document_revision") {
    const versions = await tx.select({ linkId: strategyExecutionLinkVersions.linkId }).from(strategyExecutionLinkVersions).where(and(eq(strategyExecutionLinkVersions.companyId, companyId), or(inArray(strategyExecutionLinkVersions.fromFoundationRevisionId, refs), inArray(strategyExecutionLinkVersions.toFoundationRevisionId, refs))));
    if (versions.length) await tx.delete(strategyExecutionLinks).where(and(eq(strategyExecutionLinks.companyId, companyId), inArray(strategyExecutionLinks.id, versions.map(v => v.linkId))));
  } else if (type === "document") {
    await tx.delete(strategyExecutionLinks).where(and(eq(strategyExecutionLinks.companyId, companyId), sql`exists (select 1 from foundation_documents f where f.company_id=${companyId}::uuid and f.document_id in (${sql.join(refs.map(r => sql`${r}::uuid`), sql`,`)}) and (f.id=${strategyExecutionLinks.fromFoundationId} or f.id=${strategyExecutionLinks.toFoundationId}))`));
  } else {
    // Project membership may be implicit through a task, milestone, decision or
    // measurement pin. Remove the whole link, including all historical rationale.
    await tx.delete(strategyExecutionLinks).where(and(eq(strategyExecutionLinks.companyId, companyId), sql`aw_strategy_source_erased(${companyId}::uuid,${strategyExecutionLinks.id})`));
  }
}
