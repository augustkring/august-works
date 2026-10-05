import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { memoryDeletionMarkers, memoryEvidence, memoryJobs, memoryRecords, memoryRetentionPolicies,
  activityLog, issueThreadInteractions, toolAccessAuditEvents, toolActionRequests, toolCallEvents, toolInvocations,
  heartbeatRuns, heartbeatRunEvents, agentWakeupRequests, issues, issueComments, issueDocuments, documents, documentRevisions,
  nativeRunResults, workAssessments, statusDecisions, nativeRunFinalizations, completionContracts, issueWorkProducts, agentTaskSessions, agentRuntimeState,
  workflowRuns, workflowStepRuns, workflowWaits, workflowRunReviews, workflowOptimizerEvaluations, automationArtifacts, automationArtifactVersions, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
import { invalidateCognitiveRecords } from "./cognitive-privacy.js";

export function memoryDeletionKey(companyId: string, kind: "record" | "operation" | "source", value: unknown) {
  return createHash("sha256").update(JSON.stringify([companyId, kind, value])).digest("hex");
}

export async function lockMemoryPrivacy(db: Db, companyId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`memory:privacy:${companyId}`}, 0))`);
}

export function memoryPayloadVisible() {
  return and(isNull(memoryRecords.deletedAt), sql`not exists (select 1 from ${memoryDeletionMarkers}
    where ${memoryDeletionMarkers.companyId} = ${memoryRecords.companyId}
    and ${memoryDeletionMarkers.recordId} = ${memoryRecords.id})`);
}

export async function assertMemoryRecordsRetained(db: Db, companyId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: memoryRecords.id }).from(memoryRecords).where(and(
    eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, [...new Set(ids)]), memoryPayloadVisible()));
  if (rows.length !== new Set(ids).size) throw conflict("A workflow Memory source was erased or is unavailable", {
    code: "workflow_memory_source_deleted" });
}

/** Company-scoped database guard covers both bound and lost-response child executions. */
export function heartbeatMemoryPayloadVisible() {
  return sql`not aw_workflow_memory_erased(${heartbeatRuns.companyId}, ${heartbeatRuns.id}, null)`;
}
export async function heartbeatMemoryPayloadRetained(db: Db, companyId: string, runId: string) {
  const [row] = await db.select({ visible: heartbeatMemoryPayloadVisible() }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
  return row?.visible !== false;
}

function evidenceDeletionKeys(companyId: string, item: { sourceProvider: string; sourceRef: string }) {
  const keys = [memoryDeletionKey(companyId, "source", [item.sourceProvider, item.sourceRef])];
  if (["august_works_memory_agent_tool", "august_works_post_run_extraction"].includes(item.sourceProvider)) {
    const match = /^run:\/\/[a-f0-9-]{36}\/issue\/([a-f0-9-]{36})$/i.exec(item.sourceRef);
    if (match) keys.push(memoryDeletionKey(companyId, "source", ["august_works_issue", `issue://${match[1]}`]));
  }
  return keys;
}

export async function assertMemoryOperationRetained(db: Db, companyId: string, operationId: string) {
  const [marker] = await db.select().from(memoryDeletionMarkers).where(and(eq(memoryDeletionMarkers.companyId, companyId),
    eq(memoryDeletionMarkers.key, memoryDeletionKey(companyId, "operation", operationId))));
  if (marker) throw conflict("This Memory operation was deleted and cannot be replayed", { code: "memory_operation_deleted" });
}

export async function assertMemorySourcesRetained(db: Db, companyId: string,
  evidence: Array<{ sourceProvider: string; sourceRef: string }>) {
  await lockMemoryPrivacy(db, companyId);
  if (!evidence.length) return;
  const keys = evidence.flatMap((item) => evidenceDeletionKeys(companyId, item));
  const [marker] = await db.select().from(memoryDeletionMarkers).where(and(eq(memoryDeletionMarkers.companyId, companyId),
    inArray(memoryDeletionMarkers.key, keys))).limit(1);
  if (marker) throw conflict("A deleted source cannot be captured into Memory", { code: "memory_source_deleted" });
}

/** Scrub a record and its correction/share lineage in the caller's transaction. */
export async function purgeMemoryRecords(db: Db, companyId: string, rootIds: string[], now = new Date()) {
  await lockMemoryPrivacy(db, companyId);
  const ids = new Set(rootIds);
  let frontier = rootIds;
  while (frontier.length) {
    const lineage = await db.select({ id: memoryRecords.id }).from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
      or(inArray(memoryRecords.supersedesRecordId, frontier), inArray(memoryRecords.supersededByRecordId, frontier),
        sql`${memoryRecords.metadata} ->> 'promotedFromPrivateRecordId' in (${sql.join(frontier.map((id) => sql`${id}`), sql`, `)})`)));
    const evidence = await db.select({ id: memoryEvidence.memoryRecordId }).from(memoryEvidence).where(and(
      eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.sourceRef, frontier.flatMap((id) =>
        [`memory://private/${id}`, `memory://shared/${id}`, `memory://${id}`]))));
    frontier = [...lineage, ...evidence].map((row) => row.id).filter((id) => !ids.has(id));
    frontier.forEach((id) => ids.add(id));
  }
  if (!ids.size) return { deletedRecordIds: [] as string[], deletedRecordCount: 0 };
  const rows = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, [...ids]))).for("update");
  for (const row of rows) {
    const markers: Array<typeof memoryDeletionMarkers.$inferInsert> = [
      { companyId, kind: "record", recordId: row.id, key: memoryDeletionKey(companyId, "record", row.id), deletedAt: now },
      ...[`memory://private/${row.id}`, `memory://shared/${row.id}`, `memory://${row.id}`].map((ref) => ({
        companyId, kind: "source" as const, key: memoryDeletionKey(companyId, "source", ["august_works_memory", ref]), deletedAt: now,
      })),
    ];
    if (row.createdByOperationId) markers.push({ companyId, kind: "operation",
      key: memoryDeletionKey(companyId, "operation", row.createdByOperationId), deletedAt: now });
    await db.insert(memoryDeletionMarkers).values(markers).onConflictDoNothing();
  }
  await db.delete(memoryEvidence).where(and(eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.memoryRecordId, [...ids])));
  await db.update(memoryRecords).set({ content: "", title: null, summary: null, subjectType: null, subjectId: null,
    metadata: {}, deletedAt: now, updatedAt: now, retentionState: "expired", reviewState: "rejected",
    revokedAt: null, revokedByActorType: null, revokedByActorId: null, revocationReason: null,
  }).where(and(eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, [...ids])));
  await db.update(memoryJobs).set({ sourceRefJson: {}, resultJson: null, resultSummary: null, error: null,
    updatedAt: now }).where(and(eq(memoryJobs.companyId, companyId), or(inArray(memoryJobs.sourceMemoryRecordId, [...ids]),
      sql`${memoryJobs.sourceRefJson}->'recordIds' ?| ARRAY[${sql.join([...ids].map((id) => sql`${id}`), sql`, `)}]::text[]`)));
  await purgeDerivedWorkflowMemory(db, companyId, [...ids], now);
  await invalidateCognitiveRecords(db, companyId, [...ids]);
  return { deletedRecordIds: rows.map((row) => row.id), deletedRecordCount: rows.filter((row) => !row.deletedAt).length };
}

export async function purgeDerivedWorkflowMemory(db: Db, companyId: string, recordIds: string[], now = new Date()) {
  if (!recordIds.length) return;
  const evaluations = await db.select({ id: workflowOptimizerEvaluations.id, artifactId: workflowOptimizerEvaluations.artifactId }).from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId),
    sql`${workflowOptimizerEvaluations.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`));
  if (evaluations.length) {
    const artifactIds = evaluations.map((row) => row.artifactId);
    await db.update(workflowOptimizerEvaluations).set({ status: "retired", compilerResult: null, invariants: [], updatedAt: now })
      .where(and(eq(workflowOptimizerEvaluations.companyId, companyId), inArray(workflowOptimizerEvaluations.id, evaluations.map((row) => row.id))));
    await db.update(automationArtifacts).set({ status: "deprecated", archivedAt: now, name: "Erased optimizer candidate", description: null, updatedAt: now })
      .where(and(eq(automationArtifacts.companyId, companyId), inArray(automationArtifacts.id, artifactIds)));
    // Content erasure is the explicit privacy exception to immutable artifact payloads.
    // The original content hash remains as provenance; cleared gates prevent reuse.
    await db.update(automationArtifactVersions).set({ sourceCode: "", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {}, validationReport: null, securityReport: null })
      .where(and(eq(automationArtifactVersions.companyId, companyId), inArray(automationArtifactVersions.artifactId, artifactIds)));
  }
  await db.update(workflowRunReviews).set({ correctedOutputs: {}, reason: "Source payload erased" }).where(and(eq(workflowRunReviews.companyId, companyId),
    sql`${workflowRunReviews.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`));

  const affected = await db.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, companyId),
    sql`${workflowStepRuns.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`));
  if (!affected.length) return;
  const children = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), sql`not (${heartbeatMemoryPayloadVisible()})`));
  const childIds = children.map((child) => child.id);
  if (childIds.length) {
    for (const child of children) {
      if (child.logRef && child.logStore === "local_file") {
        // Transactional outbox: content-free identities only, independent of
        // feature flags and retained after source-job payloads are erased.
        const jobKey = `run-log-erasure:v1:${child.id}`;
        await db.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey,
          sourceRefJson: { kind: "run_log_erasure", runId: child.id, agentId: child.agentId, logRef: child.logRef } }).onConflictDoNothing();
        await db.update(memoryJobs).set({ status: "queued", finishedAt: null, resultJson: null, resultSummary: null, error: null, errorCode: null,
          sourceRefJson: { kind: "run_log_erasure", runId: child.id, agentId: child.agentId, logRef: child.logRef }, updatedAt: now })
          .where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, jobKey), eq(memoryJobs.attemptNumber, 1),
            inArray(memoryJobs.status, ["succeeded", "failed", "cancelled"])));
      }
    }
    await db.update(heartbeatRuns).set({ contextSnapshot: {}, resultJson: null, runnerProfileJson: {}, stdoutExcerpt: null,
      stderrExcerpt: null, error: null, logRef: null, logStore: null, logBytes: null, logSha256: null, updatedAt: now })
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.id, childIds)));
    await db.update(nativeRunResults).set({ resultJson: { payloadDeleted: true } }).where(and(eq(nativeRunResults.companyId, companyId), inArray(nativeRunResults.runId, childIds)));
    await db.update(workAssessments).set({ assessmentJson: { payloadDeleted: true } }).where(and(eq(workAssessments.companyId, companyId), inArray(workAssessments.runId, childIds)));
    await db.update(statusDecisions).set({ decisionJson: { payloadDeleted: true } }).where(and(eq(statusDecisions.companyId, companyId), inArray(statusDecisions.runId, childIds)));
    await db.update(nativeRunFinalizations).set({ failureDetail: null, recoveryHistory: [] }).where(and(eq(nativeRunFinalizations.companyId, companyId), inArray(nativeRunFinalizations.runId, childIds)));
    await db.update(agentTaskSessions).set({ sessionParamsJson: null, sessionDisplayId: null, lastError: null, goalJson: null, goalCapabilityJson: null, updatedAt: now })
      .where(and(eq(agentTaskSessions.companyId, companyId), inArray(agentTaskSessions.lastRunId, childIds)));
    await db.update(agentRuntimeState).set({ stateJson: {}, sessionId: null, lastError: null, updatedAt: now })
      .where(and(eq(agentRuntimeState.companyId, companyId), inArray(agentRuntimeState.lastRunId, childIds)));
    await db.update(heartbeatRunEvents).set({ message: null, payload: null })
      .where(and(eq(heartbeatRunEvents.companyId, companyId), inArray(heartbeatRunEvents.runId, childIds)));
    const wakeIds = children.flatMap((child) => child.wakeupRequestId ? [child.wakeupRequestId] : []);
    if (wakeIds.length) await db.update(agentWakeupRequests).set({ payload: {}, error: null, updatedAt: now })
      .where(and(eq(agentWakeupRequests.companyId, companyId), inArray(agentWakeupRequests.id, wakeIds)));
    await db.update(activityLog).set({ details: { payloadDeleted: true } })
      .where(and(eq(activityLog.companyId, companyId), inArray(activityLog.runId, childIds)));
  }
  const childWaits = await db.select({ issueId: workflowWaits.referenceId }).from(workflowWaits).where(and(
    eq(workflowWaits.companyId, companyId), eq(workflowWaits.referenceType, "issue"),
    or(...affected.map((step) => and(eq(workflowWaits.workflowRunId, step.workflowRunId), eq(workflowWaits.nodeId, step.nodeId))))));
  const issueIds = childWaits.flatMap((wait) => wait.issueId ? [wait.issueId] : []);
  if (issueIds.length) {
    await db.update(issues).set({ title: "Erased workflow task", description: null, updatedAt: now })
      .where(and(eq(issues.companyId, companyId), inArray(issues.id, issueIds)));
    await db.update(completionContracts).set({ contractJson: { payloadDeleted: true } }).where(and(eq(completionContracts.companyId, companyId), inArray(completionContracts.issueId, issueIds)));
    await db.update(issueWorkProducts).set({ title: "Erased workflow output", url: null, externalId: null, summary: null, metadata: {}, sourceTrust: null, updatedAt: now })
      .where(and(eq(issueWorkProducts.companyId, companyId), inArray(issueWorkProducts.issueId, issueIds)));
    await db.update(issueComments).set({ body: "Source payload erased", updatedAt: now })
      .where(and(eq(issueComments.companyId, companyId), inArray(issueComments.issueId, issueIds)));
    const linkedDocs = await db.select({ id: issueDocuments.documentId }).from(issueDocuments).where(and(
      eq(issueDocuments.companyId, companyId), inArray(issueDocuments.issueId, issueIds)));
    if (linkedDocs.length) {
      const ids = linkedDocs.map((doc) => doc.id);
      await db.update(documents).set({ title: "Erased workflow document", latestBody: "", updatedAt: now })
        .where(and(eq(documents.companyId, companyId), inArray(documents.id, ids)));
      await db.update(documentRevisions).set({ title: null, body: "", changeSummary: null })
        .where(and(eq(documentRevisions.companyId, companyId), inArray(documentRevisions.documentId, ids)));
    }
  }
  await db.update(workflowStepRuns).set({ inputJson: null, outputJson: null, taskResultJson: null, errorMessage: null, updatedAt: now })
    .where(and(eq(workflowStepRuns.companyId, companyId), inArray(workflowStepRuns.id, affected.map((row) => row.id))));
  await db.update(workflowRuns).set({ triggerPayload: {}, updatedAt: now }).where(and(eq(workflowRuns.companyId, companyId),
    sql`${workflowRuns.memoryRecordIds} ?| ARRAY[${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}]::text[]`));
  await db.update(workflowWaits).set({ resolutionJson: null, updatedAt: now }).where(and(eq(workflowWaits.companyId, companyId),
    or(...affected.map((row) => and(eq(workflowWaits.workflowRunId, row.workflowRunId), eq(workflowWaits.nodeId, row.nodeId))))));
  const receiptIds = await db.select({ id: toolInvocations.id }).from(toolInvocations).where(and(eq(toolInvocations.companyId, companyId),
    or(...affected.map((row) => and(eq(toolInvocations.workflowRunId, row.workflowRunId), eq(toolInvocations.workflowNodeId, row.nodeId))))));
  if (receiptIds.length) {
    const ids = receiptIds.map((row) => row.id);
    const reviews = await db.select({ interactionId: toolActionRequests.interactionId }).from(toolActionRequests).where(and(
      eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids)));
    await db.update(toolInvocations).set({ workflowResultJson: null, argumentsSummary: null, resultSummary: null,
      errorMessage: null, updatedAt: now }).where(and(eq(toolInvocations.companyId, companyId), inArray(toolInvocations.id, ids)));
    await db.update(toolActionRequests).set({ signedArguments: null, canonicalArgumentsSummary: { summary: "Erased source payload", sizeBytes: 0 },
      previewMarkdown: null, updatedAt: now }).where(and(eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids)));
    await db.update(toolActionRequests).set({ status: "cancelled", resolvedAt: now, updatedAt: now }).where(and(
      eq(toolActionRequests.companyId, companyId), inArray(toolActionRequests.invocationId, ids), inArray(toolActionRequests.status, ["pending", "approved"])));
    await db.update(toolCallEvents).set({ argumentsSummary: null, requestSummary: null, resultSummary: null,
      metadata: { payloadDeleted: true }, errorMessage: null }).where(and(eq(toolCallEvents.companyId, companyId), inArray(toolCallEvents.invocationId, ids)));
    const invocationPredicate = sql`(${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
    await db.update(toolAccessAuditEvents).set({ details: { payloadDeleted: true } }).where(and(eq(toolAccessAuditEvents.companyId, companyId),
      sql`${toolAccessAuditEvents.details} ->> 'invocationId' in ${invocationPredicate}`));
    await db.update(activityLog).set({ details: { payloadDeleted: true } }).where(and(eq(activityLog.companyId, companyId),
      sql`${activityLog.details} ->> 'invocationId' in ${invocationPredicate}`));
    const interactionIds = reviews.flatMap((review) => review.interactionId ? [review.interactionId] : []);
    if (interactionIds.length) await db.update(issueThreadInteractions).set({
      payload: sql`jsonb_set(jsonb_set(jsonb_set(${issueThreadInteractions.payload}, '{toolAction,argumentsSummaryJson}', '"Erased source payload"'),
        '{toolAction,previewMarkdown}', '"Source payload erased"'), '{detailsMarkdown}', '""')`,
      result: sql`case when ${issueThreadInteractions.result} is null then null else
        jsonb_set(jsonb_set(${issueThreadInteractions.result}, '{toolAction,resultSummary}', 'null'), '{toolAction,errorMessage}', 'null') end`,
      updatedAt: now,
    }).where(and(eq(issueThreadInteractions.companyId, companyId), inArray(issueThreadInteractions.id, interactionIds)));
  }
  await db.update(workflowRuns).set({ status: "cancelling", executionOwnerId: null, leaseExpiresAt: null, ownerHeartbeatAt: null,
    updatedAt: now }).where(and(eq(workflowRuns.companyId, companyId), inArray(workflowRuns.id, [...new Set(affected.map((row) => row.workflowRunId))]),
      inArray(workflowRuns.status, ["queued", "running", "waiting", "recovering"])));
}

/** Called in the source Task deletion transaction, even when Memory is off. */
export async function forgetMemoryForDeletedIssue(db: Db, companyId: string, issueId: string) {
  await lockMemoryPrivacy(db, companyId);
  await db.insert(memoryDeletionMarkers).values({ companyId, kind: "source",
    key: memoryDeletionKey(companyId, "source", ["august_works_issue", `issue://${issueId}`]) }).onConflictDoNothing();
  const roots = await db.select({ id: memoryEvidence.memoryRecordId }).from(memoryEvidence).where(and(
    eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.sourceProvider, ["august_works_memory_agent_tool", "august_works_post_run_extraction"]),
    sql`${memoryEvidence.sourceRef} like ${`run://%/issue/${issueId}`}`));
  return purgeMemoryRecords(db, companyId, [...new Set(roots.map((row) => row.id))]);
}

export async function expireMemoryPayloads(db: Db, companyId: string, now: Date) {
  return db.transaction(async (tx) => {
    const scopedDb = tx as unknown as Db;
    await lockMemoryPrivacy(scopedDb, companyId);
    const [policy] = await scopedDb.select().from(memoryRetentionPolicies).where(eq(memoryRetentionPolicies.companyId, companyId));
    const due = await scopedDb.select({ id: memoryRecords.id }).from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
      isNull(memoryRecords.deletedAt), or(lte(memoryRecords.expiresAt, now),
        policy?.maxAgeDays ? lte(memoryRecords.observedAt, new Date(now.getTime() - policy.maxAgeDays * 86_400_000)) : undefined)));
    return purgeMemoryRecords(scopedDb, companyId, due.map((row) => row.id), now);
  });
}

export async function reapplyMemoryDeletionMarkers(db: Db, companyId: string) {
  return db.transaction(async (tx) => {
    const scopedDb = tx as unknown as Db;
    await lockMemoryPrivacy(scopedDb, companyId);
    const markers = await scopedDb.select().from(memoryDeletionMarkers).where(eq(memoryDeletionMarkers.companyId, companyId));
    const keys = new Set(markers.map((row) => row.key));
    const records = await scopedDb.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), isNull(memoryRecords.deletedAt)));
    const roots = records.filter((row) => keys.has(memoryDeletionKey(companyId, "record", row.id)) ||
      (row.createdByOperationId && keys.has(memoryDeletionKey(companyId, "operation", row.createdByOperationId)))).map((row) => row.id);
    const evidence = await scopedDb.select().from(memoryEvidence).where(eq(memoryEvidence.companyId, companyId));
    for (const item of evidence) {
      if (evidenceDeletionKeys(companyId, item).some((key) => keys.has(key))) roots.push(item.memoryRecordId);
    }
    const result = await purgeMemoryRecords(scopedDb, companyId, roots);
    await purgeDerivedWorkflowMemory(scopedDb, companyId, markers.flatMap((row) => row.recordId ? [row.recordId] : []));
    await invalidateCognitiveRecords(scopedDb, companyId, markers.flatMap((row) => row.recordId ? [row.recordId] : []));
    return result;
  });
}
