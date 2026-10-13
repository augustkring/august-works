import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, workflowRevisions, workflowRuns, workflowWaits, workflows, type Db } from "@paperclipai/db";
import { v9FeatureEnabled, type ExperienceCard } from "@paperclipai/shared";
import { performance } from "node:perf_hooks";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertLearnedAssetAnalyticalSources } from "../learning/learning-analytical-sources.js";
import { assertLearnedWorkflowPayloadAccess } from "../analytical-context-authority.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

/** Navigation to Original run controls; never an implicit retry or wait resolution. */
export async function readWorkflowRecovery(db: Db, actor: AuthorizationActor, companyId: string, signal: AbortSignal): Promise<{
  needsYou: ExperienceCard[]; coverage?: { state: "partial"; reason: "more_items_available" };
}> {
  const principal = v5HumanActorId(actor);
  if (actor.source === "local_implicit") throw forbidden("An authenticated workflow reader is required");
  const current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false }, started = performance.now();
  const budget = () => {
    signal.throwIfAborted();
    if (performance.now() - started > 1500) throw conflict("Workflow recovery review expired");
  };
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`set local statement_timeout='1500ms'`);
    await tx.execute(sql`set local lock_timeout='250ms'`);
    await lockAnalyticalCompany(tx, companyId);
    await lockMemoryPrivacy(tx, companyId);
    async function access() {
      budget();
      const flags = await instanceSettingsService(tx).getExperimental();
      if (!flags.enableWorkflowsV1 || !v9FeatureEnabled(flags, "maintenance_autopilot_v9") ||
        !v9FeatureEnabled(flags, "progressive_shell_v9")) throw notFound("Workflow recovery projection is unavailable");
      await assertV5Authorization(tx, current, companyId, "workflows:read");
      const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
      const [membership] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, principal), eq(companyMemberships.status, "active"))).for("share");
      const [user] = await tx.select({ verified: authUsers.emailVerified }).from(authUsers).where(eq(authUsers.id, principal)).for("share");
      if (!company || company.status === "archived" || !membership || !user?.verified)
        throw forbidden("Current verified company membership is required");
      budget();
    }
    await access();
    const rows = await tx.select({ id: workflowRuns.id, workflowId: workflowRuns.workflowId,
      revisionId: workflowRuns.workflowRevisionId, status: workflowRuns.status, purpose: workflowRuns.source,
      runUpdatedAt: workflowRuns.updatedAt, workflowUpdatedAt: workflows.updatedAt,
      workflowStatus: workflows.status, publishedRevisionId: workflows.publishedRevisionId,
      draftRevisionId: workflows.draftRevisionId })
      .from(workflowRuns).innerJoin(workflows, and(eq(workflows.companyId, workflowRuns.companyId), eq(workflows.id, workflowRuns.workflowId)))
      .innerJoin(workflowRevisions, and(eq(workflowRevisions.companyId, workflowRuns.companyId),
        eq(workflowRevisions.workflowId, workflowRuns.workflowId), eq(workflowRevisions.id, workflowRuns.workflowRevisionId)))
      .where(and(eq(workflowRuns.companyId, companyId), isNull(workflows.archivedAt),
        sql`(${workflowRuns.status} in ('failed','recovering') or (${workflowRuns.status}='waiting' and exists (
          select 1 from workflow_waits w where w.company_id=${companyId}::uuid and w.workflow_run_id=${workflowRuns.id}
          and w.kind='human_interaction' and w.status='active')))`))
      .orderBy(desc(workflowRuns.updatedAt), desc(workflowRuns.id)).limit(6).for("share");
    // Use the same retained-revision and copied-payload owners as Original
    // operations, including the extra pagination row. Never infer permission
    // from content-free metadata or substitute an instance-admin grant.
    for (const row of rows) {
      budget();
      await assertLearnedAssetAnalyticalSources(tx, companyId, "workflow_revision", row.revisionId, current);
      await assertLearnedWorkflowPayloadAccess(tx, companyId, current, { workflowRunId: row.id });
      budget();
    }
    const observedAt = new Date().toISOString();
    const waits = new Map<string, { id: string; status: string; updatedAt: string }[]>();
    for (const row of rows) {
      const currentWaits = await tx.select({ id: workflowWaits.id, status: workflowWaits.status, updatedAt: workflowWaits.updatedAt })
        .from(workflowWaits).where(and(eq(workflowWaits.companyId, companyId), eq(workflowWaits.workflowRunId, row.id),
          eq(workflowWaits.kind, "human_interaction"))).orderBy(workflowWaits.id).limit(101).for("share");
      if (currentWaits.length > 100) throw conflict("Workflow recovery source exceeds its read budget");
      waits.set(row.id, currentWaits.map(wait => ({ ...wait, updatedAt: wait.updatedAt.toISOString() })));
      budget();
    }
    const cards: ExperienceCard[] = rows.slice(0, 5).map(row => {
      const source = { domain: "workflow" as const, companyId, resourceId: row.id,
        version: nativeSha256({ ...row, waits: waits.get(row.id), runUpdatedAt: row.runUpdatedAt.toISOString(), workflowUpdatedAt: row.workflowUpdatedAt.toISOString() }), observedAt };
      return { id: `workflow-recovery:${row.id}`, kind: "recovery", source, freshness: "fresh",
        title: "Review workflow recovery", whyYou: "You can review this company's workflows.",
        consequence: "Review the current run before choosing any retry or recovery in the existing workflow controls.",
        evidence: [row.purpose === "test" ? "workflow_test_run" : "workflow_live_run", `workflow_${row.status}`],
        actions: [{ id: "review-workflow-run", label: "Review workflow run", labelKey: "review", operation: "open",
          href: `/workflows/${row.workflowId}/runs/${row.id}`, criticality: "C4", source, requiresCurrentAuthorization: true }] };
    });
    await access();
    return { needsYou: cards, ...(rows.length > 5 ? { coverage: { state: "partial" as const, reason: "more_items_available" as const } } : {}) };
  });
}
