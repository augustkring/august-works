import { assertCompanyManagedOpenCodeRuntimeDataErased, enqueueCompanyRuntimeAssetErasure } from "../native-runtime/runtime-asset-retention.js";
import { enqueueSkillVersionFileErasure } from "../learning/skill-file-erasure.js";
import { and, eq, inArray, is, sql, type SQL } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@paperclipai/db";
import { customerFeedback, customerFeedbackExperienceMeasures, supportCases, projectRoadmapProposals, causalClaims, businessScenarios, forecastSpecs, businessMetrics, businessMetricTargets, strategyExecutionLinks, processAnalysisDefinitions, decisionContexts, automationArtifacts, automationArtifactVersions, companySkills, companySkillVersions, rolePacks, rolePackVersions, companies, companyDeletionOperations, orchestrationCompanyPurposeBudgets, orchestrationCompanyPurposeReservations, agentExecutionManifests, heartbeatRuns, issues, memoryDeletionMarkers, memoryRecords, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../memory/memory-privacy.js";

// Minimal ownership/billing/erasure receipts survive content deletion. Never physically drop the company tombstone.
const retained = new Set([
  "companies",
  "feedback_image_deletions",
  "feedback_retention_erasures",
  "customer_feedback_deletion_markers",
  "support_case_deletion_markers",
  "company_deletion_operations",
  "billing_account_companies",
  "billing_subscriptions",
  "billing_entitlement_overrides",
  "entitlement_snapshots",
  "usage_events",
  "usage_aggregates",
  "runtime_cells",
  "runtime_operations",
  "runtime_operation_attempts",
  "runtime_host_commands",
  "runtime_backups",
  "platform_admin_audit",
  "support_sessions",
]);
// The immutable V5 execution manifest and its immutable authorization/item
// rows are deleted by the original Run's ON DELETE CASCADE. Direct child
// deletion would encounter their owner-presence guards before the Run cascade.
const cascadeOnly = new Set([
  "agent_execution_manifests",
  "agent_execution_manifest_items",
  "agent_execution_authorizations",
]);
export async function purgeCompanyContent(
  db: Db,
  companyId: string,
  options: { restoreQuarantine?: boolean; operationId?: string } = {},
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout='8s'`);
    await lockAnalyticalCompany(tx,companyId);
    await lockMemoryPrivacy(tx as unknown as Db,companyId);
    await assertCompanyManagedOpenCodeRuntimeDataErased(tx as unknown as Db, companyId, options.operationId);
    let platformModelFunding: Record<string, string> | undefined;
    let nativeConversationModelFunding: Record<string, string> | undefined;
    const [hasFunding] = await tx.select({ id: orchestrationCompanyPurposeBudgets.id })
      .from(orchestrationCompanyPurposeBudgets)
      .where(eq(orchestrationCompanyPurposeBudgets.companyId, companyId)).limit(1);
    if (hasFunding) {
      if (!options.operationId || options.restoreQuarantine) {
        throw conflict("Platform funding receipts require the canonical company offboarding operation");
      }
      const [operation] = await tx.select({ id: companyDeletionOperations.id, stage: companyDeletionOperations.stage,
        status: companyDeletionOperations.status })
        .from(companyDeletionOperations).where(and(
          eq(companyDeletionOperations.id, options.operationId),
          eq(companyDeletionOperations.companyId, companyId),
        )).for("update");
      if (!operation || operation.stage !== "purge" || operation.status !== "processing") {
        throw conflict("The canonical company offboarding purge operation is required");
      }
      // Once company archival has fenced new calls, reserved-but-undispatched
      // holds can be cancelled safely. Dispatched and unknown outcomes remain
      // financial obligations and block erasure until reconciled.
      await tx.update(orchestrationCompanyPurposeReservations)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(and(
          eq(orchestrationCompanyPurposeReservations.companyId, companyId),
          eq(orchestrationCompanyPurposeReservations.status, "reserved"),
        ));
      const [unresolved] = await tx.select({ id: orchestrationCompanyPurposeReservations.id })
        .from(orchestrationCompanyPurposeReservations).where(and(
          eq(orchestrationCompanyPurposeReservations.companyId, companyId),
          inArray(orchestrationCompanyPurposeReservations.status, ["dispatched", "unknown"]),
        )).limit(1);
      if (unresolved) throw conflict("Company offboarding is blocked while platform-funded model outcomes are unresolved");
      const [receipt] = await tx.execute<{ budget_count: string; reserved_minor: string; reserved_calls: string;
        completed_count: string; failed_count: string; cancelled_count: string; input_tokens: string; output_tokens: string }>(sql`
        select
          (select count(*)::text from ${orchestrationCompanyPurposeBudgets} where company_id=${companyId}::uuid) as budget_count,
          (select coalesce(sum(reserved_minor),0)::text from ${orchestrationCompanyPurposeBudgets} where company_id=${companyId}::uuid) as reserved_minor,
          (select coalesce(sum(reserved_calls),0)::text from ${orchestrationCompanyPurposeBudgets} where company_id=${companyId}::uuid) as reserved_calls,
          (select count(*)::text from ${orchestrationCompanyPurposeReservations} where company_id=${companyId}::uuid and status='completed') as completed_count,
          (select count(*)::text from ${orchestrationCompanyPurposeReservations} where company_id=${companyId}::uuid and status='failed') as failed_count,
          (select count(*)::text from ${orchestrationCompanyPurposeReservations} where company_id=${companyId}::uuid and status='cancelled') as cancelled_count,
          (select coalesce(sum((usage->>'inputTokens')::bigint),0)::text from ${orchestrationCompanyPurposeReservations} where company_id=${companyId}::uuid) as input_tokens,
          (select coalesce(sum((usage->>'outputTokens')::bigint),0)::text from ${orchestrationCompanyPurposeReservations} where company_id=${companyId}::uuid) as output_tokens`);
      platformModelFunding = {
        budgets: receipt?.budget_count ?? "0",
        maximumReservedMinorExposure: receipt?.reserved_minor ?? "0",
        invocationCount: receipt?.reserved_calls ?? "0",
        completed: receipt?.completed_count ?? "0",
        failed: receipt?.failed_count ?? "0",
        cancelled: receipt?.cancelled_count ?? "0",
        settledInputTokens: receipt?.input_tokens ?? "0",
        settledOutputTokens: receipt?.output_tokens ?? "0",
      };
      await tx.update(companyDeletionOperations).set({
        evidence: sql`coalesce(${companyDeletionOperations.evidence}, '{}'::jsonb) || jsonb_build_object('platformModelFunding', ${JSON.stringify(platformModelFunding)}::jsonb)`,
      }).where(eq(companyDeletionOperations.id, operation.id));
    }
    const [hasConversationFunding] = await tx.execute<{ id: string }>(sql`
      select id from orchestration_model_reservations
      where company_id=${companyId}::uuid and purpose='conversation_model' limit 1`);
    if (hasConversationFunding) {
      if (!options.operationId || options.restoreQuarantine)
        throw conflict("Native conversation model receipts require the canonical company offboarding operation");
      const [operation] = await tx.select({ id: companyDeletionOperations.id, stage: companyDeletionOperations.stage,
        status: companyDeletionOperations.status }).from(companyDeletionOperations).where(and(
          eq(companyDeletionOperations.id, options.operationId), eq(companyDeletionOperations.companyId, companyId),
        )).for("update");
      if (!operation || operation.stage !== "purge" || operation.status !== "processing")
        throw conflict("The canonical company offboarding purge operation is required");
      await tx.execute(sql`update orchestration_model_reservations set status='cancelled',completed_at=clock_timestamp()
        where company_id=${companyId}::uuid and purpose='conversation_model' and status='reserved'`);
      const [unresolved] = await tx.execute<{ id: string }>(sql`
        select id from orchestration_model_reservations where company_id=${companyId}::uuid
          and purpose='conversation_model' and status in ('dispatched','unknown') limit 1`);
      if (unresolved) throw conflict("Company offboarding is blocked while Native conversation model outcomes are unresolved");
      const [receipt] = await tx.execute<{ reservation_count: string; maximum_reserved_minor: string;
        completed_count: string; failed_count: string; cancelled_count: string; input_tokens: string; output_tokens: string }>(sql`
        select
          count(*)::text as reservation_count,
          coalesce(sum(maximum_minor),0)::text as maximum_reserved_minor,
          count(*) filter (where status='completed')::text as completed_count,
          count(*) filter (where status='failed')::text as failed_count,
          count(*) filter (where status='cancelled')::text as cancelled_count,
          coalesce(sum((usage->>'inputTokens')::bigint),0)::text as input_tokens,
          coalesce(sum((usage->>'outputTokens')::bigint),0)::text as output_tokens
        from orchestration_model_reservations where company_id=${companyId}::uuid and purpose='conversation_model'`);
      const [settledCosts] = await tx.execute<{ cost_event_count: string; cost_minor: string }>(sql`
        select count(*)::text as cost_event_count,coalesce(sum(c.cost_cents),0)::text as cost_minor
        from cost_events c inner join orchestration_model_reservations r
          on r.company_id=c.company_id and c.billing_code='native-conversation-model:' || r.id::text
        where r.company_id=${companyId}::uuid and r.purpose='conversation_model'`);
      nativeConversationModelFunding = {
        reservations: receipt?.reservation_count ?? "0",
        maximumReservedMinorExposure: receipt?.maximum_reserved_minor ?? "0",
        completed: receipt?.completed_count ?? "0",
        failed: receipt?.failed_count ?? "0",
        cancelled: receipt?.cancelled_count ?? "0",
        settledInputTokens: receipt?.input_tokens ?? "0",
        settledOutputTokens: receipt?.output_tokens ?? "0",
        settledCostEvents: settledCosts?.cost_event_count ?? "0",
        settledCostMinor: settledCosts?.cost_minor ?? "0",
      };
    }
    if (!options.restoreQuarantine) {
      const alive = await tx.execute<{ present: boolean }>(
        sql`select exists(select 1 from runtime_cells where company_id=${companyId}::uuid and deleted_at is null) as present`,
      );
      if (alive[0]?.present)
        throw conflict(
          "Physical runtime erasure must be confirmed before content purge",
        );
    }
    // Publish the minimal tombstone inside this same transaction. Any failed
    // purge rolls it back; normal archival never grants evidence deletion.
    const deleted: string[] = [];
    await tx.execute(sql`update ${companies} set status='archived',pause_reason='company_deleted',content_erasure_transaction_id=pg_current_xact_id()::text,updated_at=now() where id=${companyId}::uuid`);
    if (nativeConversationModelFunding && options.operationId) {
      await tx.update(companyDeletionOperations).set({
        evidence: sql`coalesce(${companyDeletionOperations.evidence}, '{}'::jsonb) || jsonb_build_object('nativeConversationModelFunding', ${JSON.stringify(nativeConversationModelFunding)}::jsonb)`,
      }).where(and(eq(companyDeletionOperations.id, options.operationId), eq(companyDeletionOperations.companyId, companyId)));
      const removed = await tx.execute(sql`delete from orchestration_model_reservations
        where company_id=${companyId}::uuid and purpose='conversation_model' returning id`);
      if (removed.length) deleted.push("orchestration_model_reservations");
    }
    await enqueueSkillVersionFileErasure(tx as unknown as Db, companyId);
    await enqueueCompanyRuntimeAssetErasure(tx as unknown as Db, companyId);
    // Retire the source Task before its Run-owned immutable manifest is removed
    // by the FK cascade below. The retirement marker is the canonical proof
    // consumed by aw_workflow_memory_erased; clearing only the identity tuple
    // would erase the predicate's original conversation owner.
    const conversationRetiredAt = new Date();
    await tx.update(issues).set({ conversationAgentId: null, conversationUserId: null, conversationState: null,
      conversationRetiredAt, status: "cancelled", cancelledAt: conversationRetiredAt, hiddenAt: conversationRetiredAt,
      assigneeAgentId: null, assigneeUserId: null, executionRunId: null, checkoutRunId: null, updatedAt: conversationRetiredAt,
    }).where(and(eq(issues.companyId, companyId), sql`${issues.conversationAgentId} is not null`));
    // Persist the canonical Run source-erasure receipt while the original
    // Native Task and its binding still exist. The immutable manifest's
    // Context may be an earlier general Context with no conversation Task;
    // relying on that Context FK after deleting the issue loses the source
    // proof. The existing erasure owner performs the full descendant scrub
    // and writes only its content-free run marker in this transaction.
    const retiredConversationRuns = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).innerJoin(issues,
      and(eq(issues.companyId, heartbeatRuns.companyId), eq(issues.id, heartbeatRuns.nativeIssueId))).where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.runtimeMode, "native"),
      eq(issues.conversationRetiredAt, conversationRetiredAt)));
    if (retiredConversationRuns.length) {
      await purgeDerivedWorkflowMemory(tx as unknown as Db, companyId, [], conversationRetiredAt, {
        workflowRevisionIds: [], artifactVersionIds: [], runIds: retiredConversationRuns.map(row => row.id),
        companyPurgeOperationId: options.operationId,
      });
    }
    // Source/profile retirement can enqueue new runtime legacy references in
    // the SQL trigger. Refuse the content delete in this transaction until the
    // original Run-owned outbox has physically erased and acknowledged them.
    await assertCompanyManagedOpenCodeRuntimeDataErased(tx as unknown as Db, companyId, options.operationId);
    // These purpose-ledger rows have a native DELETE guard and a retained
    // aggregate finance receipt above. Delete them through their owner in
    // child-before-parent order before generic company-content cleanup.
    const supportReservations = await tx.delete(orchestrationCompanyPurposeReservations)
      .where(eq(orchestrationCompanyPurposeReservations.companyId, companyId))
      .returning({ id: orchestrationCompanyPurposeReservations.id });
    const supportBudgets = await tx.delete(orchestrationCompanyPurposeBudgets)
      .where(eq(orchestrationCompanyPurposeBudgets.companyId, companyId))
      .returning({ id: orchestrationCompanyPurposeBudgets.id });
    if (supportReservations.length) deleted.push("orchestration_company_purpose_reservations");
    if (supportBudgets.length) deleted.push("orchestration_company_purpose_budgets");
    // A planning source link is part of frozen canonical proposal material.
    // Erase the owned proposal; generic nullable-FK unlinking cannot rewrite it.
    const planning = await tx.execute(sql`delete from ${projectRoadmapProposals} where company_id=${companyId}::uuid and planning_manifest_id is not null returning id`);
    if (planning.length) deleted.push("project_roadmap_proposals");
    // Published analytical roots own immutable versions and generated source
    // pins. Delete through those native cascade owners before the generic FK
    // planner, which cannot unlink generated columns or mutate frozen snapshots.
    for(const table of [causalClaims,businessScenarios,forecastSpecs,decisionContexts,strategyExecutionLinks,businessMetricTargets,processAnalysisDefinitions,businessMetrics]) {
      const config=getTableConfig(table);
      const [found]=await tx.execute<{present:boolean}>(sql`select exists(select 1 from ${table} where company_id=${companyId}::uuid) as present`);
      if(!found?.present) continue;
      if(table===businessMetrics) await tx.update(businessMetrics).set({status:"revoked",publishedVersionId:null}).where(eq(businessMetrics.companyId,companyId));
      await tx.execute(sql`delete from ${table} where company_id=${companyId}::uuid`);
      deleted.push(config.name);
    }
    // Support erasure runs through its root before generic child-first cleanup.
    // Active legal holds refuse completion; content-free markers survive.
    const supportRows = await tx.delete(supportCases).where(eq(supportCases.companyId, companyId)).returning({ id: supportCases.id });
    if (supportRows.length) deleted.push("support_cases");
    // Original feedback roots must run their hold and allocation-erasure
    // triggers before the generic child-first FK planner. Private descendants
    // cascade; minimal physical-erasure receipts remain in their native owner.
    // The separate optional rating payload has a stricter erasure boundary
    // than the complaint root and is physically removed in the same purge.
    await tx.delete(customerFeedbackExperienceMeasures).where(eq(customerFeedbackExperienceMeasures.companyId, companyId));
    const feedbackRows = await tx.delete(customerFeedback).where(eq(customerFeedback.companyId, companyId)).returning({ id: customerFeedback.id });
    if (feedbackRows.length) deleted.push("customer_feedback");
    const tables = [
      ...new Set(
        (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
          is(value, PgTable),
        ),
      ),
    ];
    const scopes = new Map<PgTable, SQL>();
    for (const table of tables) {
      const config = getTableConfig(table);
      const column = config.columns.find((v) => v.name === "company_id");
      if (column && !retained.has(config.name) && !cascadeOnly.has(config.name))
        scopes.set(table, config.name==="memory_jobs"
          ? sql`${column}=${companyId}::uuid and not (operation_type='retention' and coalesce(source_ref_json->>'kind','') in ('provider_trace_erasure','run_log_erasure','learning_analytical_erasure','skill_version_file_erasure','runtime_asset_erasure','runtime_skill_source_erasure','runtime_playbook_source_erasure','artifact_workspace_erasure','workflow_artifact_source_erasure'))`
          : sql`${column} = ${companyId}::uuid`);
    }
    // Child records without a company column inherit only an already-owned parent's exact FK scope.
    let changed = true;
    while (changed) {
      changed = false;
      for (const table of tables) {
        if (
          scopes.has(table) ||
          retained.has(getTableConfig(table).name) ||
          getTableConfig(table).columns.some((c) => c.name === "company_id")
        )
          continue;
        const parents = getTableConfig(table)
          .foreignKeys.map((fk) => fk.reference())
          .filter((ref) => scopes.has(ref.foreignTable));
        if (!parents.length) continue;
        scopes.set(
          table,
          sql.join(
            parents.map(
              (ref) =>
                sql`exists (select 1 from ${ref.foreignTable} where ${scopes.get(ref.foreignTable)!} and ${sql.join(
                  ref.columns.map(
                    (column, index) =>
                      sql`${column} = ${ref.foreignColumns[index]!}`,
                  ),
                  sql` and `,
                )})`,
            ),
            sql` or `,
          ),
        );
        changed = true;
      }
    }
    // Retained runtime receipts must not keep customer agents/provider profiles or credential references alive.
    await tx.execute(
      sql`update runtime_cells set dedicated_agent_id=null,provider_binding_id=null,gateway_secret_ref=null,state_storage_ref=null,model_secret_ref=null,model_secret_version=null,model_provider=null,model_id=null where company_id=${companyId}::uuid ${options.restoreQuarantine ? sql`` : sql`and deleted_at is not null`}`,
    );
    await tx.execute(
      sql`update runtime_backups set encryption_key_ref='erased',manifest=null where company_id=${companyId}::uuid ${options.restoreQuarantine ? sql`` : sql`and deleted_at is not null`}`,
    );
    await tx.execute(
      sql`update billing_entitlement_overrides set revoked_at=coalesce(revoked_at,now()),reason='Erased company override' where company_id=${companyId}::uuid`,
    );
    await tx.execute(
      sql`delete from entitlement_snapshots where company_id=${companyId}::uuid`,
    );
    await tx.execute(
      sql`update support_sessions set reason='Erased company support session',revoked_at=coalesce(revoked_at,now()) where company_id=${companyId}::uuid`,
    );
    for (const [table, scope] of scopes) {
      const found = await tx.execute<{ present: boolean }>(
        sql`select exists(select 1 from ${table} where ${scope}) as present`,
      );
      if (!found[0]?.present) scopes.delete(table);
    }
    const pending = new Set(scopes.keys());
    const [cascadeManifestRows] = await tx.execute<{ present: boolean }>(sql`
      select exists(select 1 from ${agentExecutionManifests} e where e.company_id=${companyId}::uuid) as present`);
    const edges = new Map<PgTable, Set<PgTable>>();
    for (const table of pending) {
      const parents = new Set<PgTable>();
      for (const fk of getTableConfig(table).foreignKeys) {
        const ref = fk.reference();
        // A scoped child that normally points at the cascade-only manifest
        // must be removed before its owning Run. Model that omitted node as
        // the actual company-scoped Run owner, while retaining all its other
        // FK dependencies (notably runtime-policy evidence).
        if (ref.foreignTable === agentExecutionManifests && cascadeManifestRows?.present &&
            pending.has(heartbeatRuns)) {
          parents.add(heartbeatRuns);
          continue;
        }
        if (!pending.has(ref.foreignTable) || ref.foreignTable === table)
          continue;
        // Private Memory's owner is part of its checked scope tuple. Keep the
        // FK until the record is deleted before its agent; nulling only the
        // owner would invalidate private records during a company purge.
        if(table===memoryRecords&&ref.columns.some(column=>column.name==="owner_agent_id")) {
          parents.add(ref.foreignTable);
          continue;
        }
        // Unlink nullable references only when the parent is retained/out of
        // scope. Scoped parents are removed after this child, so mutating a
        // live child reference would violate its native lifecycle guard.
        if (
          ref.columns.some((column) => !column.notNull) &&
          !scopes.has(ref.foreignTable) &&
          getTableConfig(table).columns.some(
            (column) => column.name === "company_id",
          )
        ) {
          await tx.execute(
            sql`update ${table} set ${sql.join(
              ref.columns
                .filter((column) => !column.notNull)
                .map((column) => sql`${sql.identifier(column.name)} = null`),
              sql`, `,
            )} where ${scopes.get(table)!}`,
          );
          continue;
        }
        parents.add(ref.foreignTable);
      }
      // The immutable execution manifest is deliberately excluded from the
      // direct company-delete graph: its original Run owns deletion through
      // the composite ON DELETE CASCADE. Keep the manifest's restricted
      // Context and Agent parents alive until that Run is removed so its
      // nested cascade can satisfy the immutable source-erasure gate.
      if (table === heartbeatRuns && cascadeManifestRows?.present) {
        for (const fk of getTableConfig(agentExecutionManifests).foreignKeys) {
          const parent = fk.reference().foreignTable;
          if (pending.has(parent) && parent !== heartbeatRuns) parents.add(parent);
        }
      }
      // The canonical erasure marker is required while the original Run
      // cascade removes immutable manifests. It is itself content-free and
      // can be deleted only after that exact marked Run has cascaded.
      if (table === heartbeatRuns && pending.has(memoryDeletionMarkers)) {
        const marker = await tx.execute<{ present: boolean }>(sql`
          select exists(select 1 from ${heartbeatRuns}
            where ${scopes.get(heartbeatRuns)!} and exists(select 1 from ${memoryDeletionMarkers} m
              where m.company_id=${heartbeatRuns.companyId} and m.kind='source'
                and m.key='memory-run-source-erasure:v1:'||${heartbeatRuns.id}::text)) as present
        `);
        if (marker[0]?.present) parents.add(memoryDeletionMarkers);
      }
      edges.set(table, parents);
    }
    while (pending.size) {
      const leaves = [...pending].filter(
        (table) =>
          ![...pending].some(
            (child) => child !== table && edges.get(child)?.has(table),
          ),
      );
      if (!leaves.length) {
        // A Role Pack's published-version pointer points into the version
        // table, while each version is owned by its Role Pack. Break only
        // that isolated two-row cycle inside the exact canonical purge; the
        // 0552 DELETE guard still protects published versions/items from all
        // ordinary callers, and the planner then removes versions before roots.
        const exactRolePackCycle = pending.has(rolePacks) && pending.has(rolePackVersions) &&
          ![...pending].some((table) => table !== rolePacks && table !== rolePackVersions &&
            (edges.get(table)?.has(rolePacks) || edges.get(table)?.has(rolePackVersions)));
        if (exactRolePackCycle) {
          if (options.restoreQuarantine || !options.operationId)
            throw conflict("Published Role Pack erasure requires the canonical company purge operation");
          const [operation] = await tx.select({ stage: companyDeletionOperations.stage,
            status: companyDeletionOperations.status }).from(companyDeletionOperations).where(and(
            eq(companyDeletionOperations.id, options.operationId), eq(companyDeletionOperations.companyId, companyId),
          )).for("update");
          if (!operation || operation.stage !== "purge" || operation.status !== "processing")
            throw conflict("Published Role Pack erasure requires the current processing company purge");
          await tx.update(rolePacks).set({ publishedVersionId: null, updatedAt: new Date() })
            .where(eq(rolePacks.companyId, companyId));
          edges.get(rolePacks)?.delete(rolePackVersions);
          continue;
        }
        // An Artifact root and its immutable versions intentionally reference
        // each other: the root pins its latest version, while each version is
        // owned by the root. Let the native root cascade own this exact pair
        // after every other in-scope child has been removed. Version DELETE
        // guards and workspace cleanup triggers still run.
        const exactArtifactCycle = pending.size === 2 &&
          pending.has(automationArtifacts) && pending.has(automationArtifactVersions);
        if (exactArtifactCycle) {
          const scope = scopes.get(automationArtifacts)!;
          const roots = await tx.execute<{ id: string }>(sql`delete from ${automationArtifacts} where ${scope} returning id`);
          if (roots.length) {
            deleted.push(getTableConfig(automationArtifacts).name, getTableConfig(automationArtifactVersions).name);
          }
          pending.delete(automationArtifacts);
          pending.delete(automationArtifactVersions);
          continue;
        }
        // A Skill owns immutable version rows, and its current-version pointer
        // points back into that same set. Use the Skill root's normal cascade
        // only after every other scoped child has been removed; the file
        // erasure outbox was already recorded above, so version guards and
        // asynchronous filesystem cleanup remain in force.
        const exactSkillCycle = pending.has(companySkills) && pending.has(companySkillVersions) &&
          ![...pending].some((table) => table !== companySkills && table !== companySkillVersions &&
            (edges.get(table)?.has(companySkills) || edges.get(table)?.has(companySkillVersions)));
        if (exactSkillCycle) {
          const scope = scopes.get(companySkills)!;
          const roots = await tx.execute<{ id: string }>(sql`delete from ${companySkills} where ${scope} returning id`);
          if (roots.length) deleted.push(getTableConfig(companySkills).name, getTableConfig(companySkillVersions).name);
          pending.delete(companySkills);
          pending.delete(companySkillVersions);
          continue;
        }
        throw conflict(
          "Company content has a non-null reference cycle; scoped migration required",
        );
      }
      for (const table of leaves) {
        await tx.execute(sql`delete from ${table} where ${scopes.get(table)!}`);
        pending.delete(table);
        deleted.push(getTableConfig(table).name);
      }
    }
    await tx.execute(
      sql`update agent_identities set name='Deleted agent',description=null,base_profile='{}'::jsonb,appearance=null,provider_preference=null,created_by_user_id=null,status='archived',updated_at=now() where home_company_id=${companyId}::uuid and not exists(select 1 from agents where agents.agent_identity_id=agent_identities.id)`,
    );
    await tx.execute(
      sql`update ${companies} set name='Deleted company',description=null,default_responsible_user_id=null,interaction_resolver_governance='{}'::jsonb,feedback_data_sharing_enabled=false,feedback_data_sharing_consent_at=null,feedback_data_sharing_consent_by_user_id=null,feedback_data_sharing_terms_version=null,status='archived',pause_reason='company_deleted',updated_at=now() where id=${companyId}::uuid`,
    );
    return { tables: [...new Set(deleted)].sort(), companyTombstoneRetained: true,
      ...(platformModelFunding ? { platformModelFunding } : {}),
      ...(nativeConversationModelFunding ? { nativeConversationModelFunding } : {}) };
  });
}
