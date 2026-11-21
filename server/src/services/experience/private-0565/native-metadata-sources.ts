/** PRIVATE Resource 0565 metadata-only source pages. These queries deliberately
 * return only native key + version time. Per-domain authorization and effective
 * responsibility are resolved later by the owning service under the real actor. */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  agents, aiUseCases, approvals, billingAccountCompanies, billingAccounts, companies,
  businessExperiments, businessMetrics, companyAgentPackageInstallations,
  companySkillPolicies, decisions, routines, supportCases, toolConnections,
  toolPolicies, workflowRuns, workflows, type Db,
} from "@paperclipai/db";
import { nativeSha256 } from "../../native-runtime/canonical.js";
import type { NativeResponsibilityMetadataSource, ResponsibilityPage, ResponsibilityScanKind } from "./responsibility-scan.js";

const PAGE_SIZE = 40;
type NativeKeyVersion = { id: string; updatedAt: Date };
export function responsibilitySourceVersion(kind: ResponsibilityScanKind, id: string, updatedAt: Date) {
  return nativeSha256([kind, id, updatedAt.toISOString()]);
}
function makePage(kind: ResponsibilityScanKind, rows: NativeKeyVersion[], requestedLimit: number): ResponsibilityPage {
  if (requestedLimit !== PAGE_SIZE) throw new Error("responsibility_scan_page_limit_invalid");
  const complete = rows.length <= PAGE_SIZE;
  const accepted = rows.slice(0, PAGE_SIZE);
  return { pointers: accepted.map(row => ({ kind, id: row.id, sourceVersion: responsibilitySourceVersion(kind, row.id, row.updatedAt) })),
    nextCursor: complete ? null : accepted.at(-1)?.id ?? null, complete };
}
function afterId(column: AnyPgColumn, cursor: string | null) {
  return cursor ? sql`${column} > ${cursor}::uuid` : undefined;
}
function withDb(db: Db, kind: ResponsibilityScanKind, query: (tx: Db, companyId: string, after: string | null) => Promise<NativeKeyVersion[]>): NativeResponsibilityMetadataSource {
  return { kind, async readPage(companyId, after, limit) {
    if (limit !== PAGE_SIZE) throw new Error("responsibility_scan_page_limit_invalid");
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      await tx.execute(sql`set local statement_timeout='1000ms'`);
      await tx.execute(sql`set local lock_timeout='200ms'`);
      return makePage(kind, await query(tx, companyId, after), limit);
    });
  } };
}

/** One native table owner per kind. These scans are trusted server metadata
 * pages only: never use their pointers, page size, or progress in a user-facing
 * count, result, failure, card kind, source hash, or overflow signal. */
export function nativeResponsibilityMetadataSources(db: Db): NativeResponsibilityMetadataSource[] {
  const rows = <T extends NativeKeyVersion>(items: T[]) => items;
  return [
    withDb(db, "agent", async (tx, companyId, after) => rows(await tx.select({ id: agents.id, updatedAt: agents.updatedAt }).from(agents)
      .where(and(eq(agents.companyId, companyId), sql`${agents.status} not in ('terminated','archived','deleted')`, afterId(agents.id, after))).orderBy(asc(agents.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "deployment", async (tx, companyId, after) => rows(await tx.select({ id: companyAgentPackageInstallations.id, updatedAt: companyAgentPackageInstallations.updatedAt }).from(companyAgentPackageInstallations)
      .where(and(eq(companyAgentPackageInstallations.companyId, companyId), inArray(companyAgentPackageInstallations.status, ["active","readiness_blocked","degraded","needs_update"]), afterId(companyAgentPackageInstallations.id, after))).orderBy(asc(companyAgentPackageInstallations.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "workflow", async (tx, companyId, after) => rows(await tx.select({ id: workflows.id, updatedAt: workflows.updatedAt }).from(workflows)
      .where(and(eq(workflows.companyId, companyId), isNull(workflows.archivedAt), sql`${workflows.status} <> 'archived'`, afterId(workflows.id, after))).orderBy(asc(workflows.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "workflow_run", async (tx, companyId, after) => rows(await tx.select({ id: workflowRuns.id, updatedAt: workflowRuns.updatedAt }).from(workflowRuns)
      .where(and(eq(workflowRuns.companyId, companyId), inArray(workflowRuns.status, ["queued","running","waiting","recovering","cancelling"]), afterId(workflowRuns.id, after))).orderBy(asc(workflowRuns.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "routine", async (tx, companyId, after) => rows(await tx.select({ id: routines.id, updatedAt: routines.updatedAt }).from(routines)
      .where(and(eq(routines.companyId, companyId), inArray(routines.status, ["active","paused"]), afterId(routines.id, after))).orderBy(asc(routines.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "connector", async (tx, companyId, after) => rows(await tx.select({ id: toolConnections.id, updatedAt: toolConnections.updatedAt }).from(toolConnections)
      .where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.status, "active"), eq(toolConnections.enabled, true), afterId(toolConnections.id, after))).orderBy(asc(toolConnections.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "metric", async (tx, companyId, after) => rows(await tx.select({ id: businessMetrics.id, updatedAt: businessMetrics.updatedAt }).from(businessMetrics)
      .where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.status, "published"), afterId(businessMetrics.id, after))).orderBy(asc(businessMetrics.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "experiment", async (tx, companyId, after) => rows(await tx.select({ id: businessExperiments.id, updatedAt: businessExperiments.updatedAt }).from(businessExperiments)
      .where(and(eq(businessExperiments.companyId, companyId), inArray(businessExperiments.state, ["in_review","ready","running","paused","analyzing"]), afterId(businessExperiments.id, after))).orderBy(asc(businessExperiments.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "decision", async (tx, companyId, after) => rows(await tx.select({ id: decisions.id, updatedAt: decisions.updatedAt }).from(decisions)
      .where(and(eq(decisions.companyId, companyId), eq(decisions.status, "open"), sql`${decisions.expiresAt} > now()`, afterId(decisions.id, after))).orderBy(asc(decisions.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "approval", async (tx, companyId, after) => rows(await tx.select({ id: approvals.id, updatedAt: approvals.updatedAt }).from(approvals)
      .where(and(eq(approvals.companyId, companyId), inArray(approvals.status, ["pending","revision_requested"]), afterId(approvals.id, after))).orderBy(asc(approvals.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "ai_use_case", async (tx, companyId, after) => rows(await tx.select({ id: aiUseCases.id, updatedAt: aiUseCases.updatedAt }).from(aiUseCases)
      .where(and(eq(aiUseCases.companyId, companyId), sql`${aiUseCases.status} <> 'retired'`, afterId(aiUseCases.id, after))).orderBy(asc(aiUseCases.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "tool_policy", async (tx, companyId, after) => rows(await tx.select({ id: toolPolicies.id, updatedAt: toolPolicies.updatedAt }).from(toolPolicies)
      .where(and(eq(toolPolicies.companyId, companyId), eq(toolPolicies.enabled, true), afterId(toolPolicies.id, after))).orderBy(asc(toolPolicies.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "skill_policy", async (tx, companyId, after) => rows(await tx.select({ id: companySkillPolicies.companyId, updatedAt: companySkillPolicies.updatedAt }).from(companySkillPolicies)
      .where(and(eq(companySkillPolicies.companyId, companyId), afterId(companySkillPolicies.companyId, after))).orderBy(asc(companySkillPolicies.companyId)).limit(PAGE_SIZE + 1))),
    withDb(db, "billing", async (tx, companyId, after) => rows(await tx.select({ id: billingAccounts.id, updatedAt: billingAccounts.updatedAt }).from(billingAccountCompanies)
      .innerJoin(billingAccounts, and(eq(billingAccounts.id, billingAccountCompanies.billingAccountId), eq(billingAccounts.status, "active"), isNull(billingAccounts.closedAt)))
      .where(and(eq(billingAccountCompanies.companyId, companyId), eq(billingAccountCompanies.status, "active"), afterId(billingAccounts.id, after))).orderBy(asc(billingAccounts.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "security_contact", async (tx, companyId, after) => rows(await tx.select({ id: companies.id, updatedAt: companies.updatedAt }).from(companies)
      .where(and(eq(companies.id, companyId), afterId(companies.id, after))).orderBy(asc(companies.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "support_incident_contact", async (tx, companyId, after) => rows(await tx.select({ id: companies.id, updatedAt: companies.updatedAt }).from(companies)
      .where(and(eq(companies.id, companyId), afterId(companies.id, after))).orderBy(asc(companies.id)).limit(PAGE_SIZE + 1))),
    withDb(db, "support_case", async (tx, companyId, after) => rows(await tx.select({ id: supportCases.id, updatedAt: supportCases.updatedAt }).from(supportCases)
      .where(and(eq(supportCases.companyId, companyId), inArray(supportCases.customerStatus, ["RECEIVED","INVESTIGATING","WORKING_ON_IT","WAITING_FOR_YOU"]), afterId(supportCases.id, after))).orderBy(asc(supportCases.id)).limit(PAGE_SIZE + 1))),
  ];
}
