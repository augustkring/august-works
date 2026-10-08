import { and, desc, eq, inArray } from "drizzle-orm";
import { agentExecutionManifests, analyticalContextRoots, completionContracts, contextManifestMemoryRoots, documentRevisions, documents, issueDocuments, issues, orchestrationPlans, orchestrationWorkers, orchestrationWorkerAttempts, orchestrationToolCharges, supervisionSignals, toolInvocations, verificationRuns, type Db } from "@paperclipai/db";
import { orchestrationCompletionSchema, verificationReviewSchema, trajectoryReviewSchema, type TrajectoryReviewInput, type VerificationPacket, type VerificationEvidenceRef, type VerificationReviewInput } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { assertDerivedManager } from "../memory/derived-memory.js";
import { memoryService } from "../memory/memory-service.js";
import { cognitiveMemoryActor } from "../memory/cognitive-memory.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { validateWorkflowOutput } from "../workflows/workflow-output-schema.js";
import { reconcileOrchestrationAttempts } from "../orchestration/orchestration-admission.js";
import { orchestrationService, assertOrchestrationSources } from "../orchestration/orchestration-service.js";
import { issueService, executeIssuePostCommitActions, type IssuePostCommitAction } from "../issues.js";
import { enqueueSupervisionStop, ensureSupervisionSession } from "./supervision-outbox.js";
import { conflict, notFound } from "../../errors.js";

/** Independent accountable human review; automated providers must qualify a separate read-only consumer. */
export function verificationService(db: Db) {
  async function packet(tx: Db, actor: AuthorizationActor, companyId: string, id: string, workerId: string | null): Promise<VerificationPacket> {
    await assertV7Authorization(tx,actor,companyId,"company_scope:read");
    const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId,companyId),eq(orchestrationPlans.id,id)));
    if (!plan || plan.erasedAt) throw notFound("Retained verification packet not found");
    await assertOrchestrationSources(tx, actor, companyId, plan);
    const workers = await tx.select().from(orchestrationWorkers).where(and(eq(orchestrationWorkers.companyId,companyId),eq(orchestrationWorkers.planId,id))).orderBy(orchestrationWorkers.workerKey);
    const worker = workerId ? workers.find(w => w.id === workerId) : null;
    if (workerId && !worker) throw notFound("Canonical worker not found");
    const issueId = worker?.issueId ?? plan.issueId;
    const [task] = await tx.select().from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,issueId))).for("share");
    if (!task) throw notFound("Task not found");
    await assertV7Authorization(tx,actor,companyId,"issue:read",{ type: "issue",companyId,issueId,projectId: task.projectId,parentIssueId: task.parentId,assigneeAgentId: task.assigneeAgentId,assigneeUserId: task.assigneeUserId,status: task.status });
    const contractId = worker?.completionContractId ?? plan.completionContractId;
    const [row] = await tx.select().from(completionContracts).where(and(eq(completionContracts.companyId,companyId),eq(completionContracts.issueId,issueId),eq(completionContracts.id,contractId)));
    const [latest] = await tx.select({ id: completionContracts.id }).from(completionContracts).where(and(eq(completionContracts.companyId,companyId),eq(completionContracts.issueId,issueId))).orderBy(desc(completionContracts.revision)).limit(1);
    if (!row || row.contractJson.payloadDeleted || latest?.id !== row.id) throw conflict("The completion contract is no longer current");
    const contract = orchestrationCompletionSchema.parse(row.contractJson.v7);
    const attempts = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId,companyId),eq(orchestrationWorkerAttempts.planId,id))).orderBy(desc(orchestrationWorkerAttempts.attempt),orchestrationWorkerAttempts.workerId);
    const subjectWorkers = worker ? [worker] : plan.mode === "planned_parallel" ? [] : workers;
    const subjectAttempts = attempts.filter(a => subjectWorkers.some(w => w.id === a.workerId));
    const liveAttempts = worker || plan.mode !== "planned_parallel" ? subjectAttempts.filter(a => a.status === "running").length : attempts.filter(a => a.status === "running").length;
    const failures: string[] = [], evidence: VerificationEvidenceRef[] = [];
    if (liveAttempts) failures.push("worker_attempt_still_running");
    for (const subject of subjectWorkers) if (subjectAttempts.find(a => a.workerId === subject.id)?.status !== "succeeded") failures.push(`worker_attempt_not_successful:${subject.workerKey}`);
    if (!worker && plan.mode === "planned_parallel" && workers.some(w => w.status !== "completed")) failures.push("worker_joins_incomplete");
    const outputRows = await tx.select({ key: issueDocuments.key, doc: documents }).from(issueDocuments).innerJoin(documents,and(eq(documents.companyId,issueDocuments.companyId),eq(documents.id,issueDocuments.documentId))).where(and(eq(issueDocuments.companyId,companyId),eq(issueDocuments.issueId,issueId))).for("share",{ of: documents });
    for (const required of contract.requiredOutputs) {
      const output = outputRows.find(o => o.key === required.key);
      if (!output?.doc.latestBody.trim() || !output.doc.latestRevisionId) { failures.push(`output_missing:${required.key}`); continue; }
      const [revision] = await tx.select().from(documentRevisions).where(and(eq(documentRevisions.companyId,companyId),eq(documentRevisions.documentId,output.doc.id),eq(documentRevisions.id,output.doc.latestRevisionId))).for("share");
      if (!revision || revision.body !== output.doc.latestBody || revision.revisionNumber !== output.doc.latestRevisionNumber) failures.push(`output_revision_mismatch:${required.key}`);
      if (required.jsonSchema) {
        try { if (Buffer.byteLength(output.doc.latestBody,"utf8")>256000) throw new Error("bounded_output_limit"); validateWorkflowOutput(required.jsonSchema,JSON.parse(output.doc.latestBody)); }
        catch { failures.push(`output_schema_mismatch:${required.key}`); }
      }
      evidence.push({ ref: `document:${output.doc.id}:${output.doc.latestRevisionId}`,type: "task_document",sourceId: output.doc.id,sourceVersion: output.doc.latestRevisionId,hash: nativeSha256(output.doc.latestBody) });
    }
    const receipts = await tx.select({ receipt: toolInvocations }).from(orchestrationToolCharges).innerJoin(toolInvocations,and(eq(toolInvocations.companyId,orchestrationToolCharges.companyId),eq(toolInvocations.id,orchestrationToolCharges.invocationId))).where(and(eq(orchestrationToolCharges.companyId,companyId),eq(orchestrationToolCharges.planId,id))).orderBy(desc(toolInvocations.createdAt)).limit(1000);
    for (const [index,condition] of contract.requiredPostconditions.entries()) {
      if (condition.kind === "task_state") {
        const [state] = await tx.select().from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,condition.issueId))).for("share");
        if (!state) { failures.push(`postcondition_missing:${index}`); continue; }
        await assertV7Authorization(tx,actor,companyId,"issue:read",{ type: "issue",companyId,issueId: state.id,projectId: state.projectId,parentIssueId: state.parentId,assigneeAgentId: state.assigneeAgentId,assigneeUserId: state.assigneeUserId,status: state.status });
        if (state.status !== condition.status) failures.push(`postcondition_unsatisfied:${index}`);
        evidence.push({ ref: `task:${state.id}:${state.updatedAt.toISOString()}`,type: "task_state",sourceId: state.id,sourceVersion: state.updatedAt.toISOString(),hash: nativeSha256({ status: state.status }) });
      } else {
        const receipt = receipts.find(r => r.receipt.toolName === condition.toolName && r.receipt.argumentsHash === condition.argumentsHash && r.receipt.status === "succeeded" && (!condition.requireApproval || r.receipt.approvalState === "approved") && (!worker || subjectAttempts.some(a => a.runId === r.receipt.runId || a.workflowRunId === r.receipt.workflowRunId)))?.receipt;
        if (!receipt) { failures.push(`postcondition_missing:${index}`); continue; }
        evidence.push({ ref: `tool:${receipt.id}`,type: "tool_receipt",sourceId: receipt.id,sourceVersion: receipt.updatedAt.toISOString(),hash: nativeSha256({ arguments: receipt.argumentsHash,result: receipt.resultHash,approval: receipt.approvalState }) });
      }
    }
    const manifests = subjectAttempts.flatMap(a => a.executionManifestId ? [a.executionManifestId] : []);
    if (manifests.length) {
      const pins = await tx.select({ contextId: agentExecutionManifests.contextManifestId }).from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId,companyId),inArray(agentExecutionManifests.id,manifests)));
      const roots = pins.length ? await tx.select().from(contextManifestMemoryRoots).where(and(eq(contextManifestMemoryRoots.companyId,companyId),inArray(contextManifestMemoryRoots.manifestId,pins.map(p => p.contextId)))).limit(257) : [];
      if (roots.length > 256) throw conflict("The complete verification source set exceeds its budget");
      const analytical = roots.length ? await tx.select({ id: analyticalContextRoots.memoryRecordId }).from(analyticalContextRoots).where(and(eq(analyticalContextRoots.companyId,companyId),inArray(analyticalContextRoots.memoryRecordId,roots.map(root => root.memoryRecordId)))) : [];
      const signalRoots = new Set(analytical.map(root => root.id));
      for (const root of roots) {
        // Source admission above covers supplemental Signals. They never certify an outcome.
        if (signalRoots.has(root.memoryRecordId)) continue;
        const detail = await memoryService(tx).get(companyId,root.memoryRecordId,cognitiveMemoryActor(actor));
        const record = detail?.record;
        if (!record || record.deletedAt || record.revokedAt || record.retentionState !== "active" || record.updatedAt.toISOString() !== root.sourceVersion || record.reviewState !== "accepted" || record.verificationState === "unverified" || record.supersededByRecordId || (record.validFrom && record.validFrom.getTime()>Date.now()) || (record.validUntil && record.validUntil.getTime()<=Date.now()) || (record.expiresAt && record.expiresAt.getTime() <= Date.now())) { failures.push(`source_no_longer_current:${root.memoryRecordId}`); continue; }
        if (!evidence.some(e => e.type === "memory" && e.sourceId === record.id)) evidence.push({ ref: `memory:${record.id}:${root.sourceVersion}`,type: "memory",sourceId: record.id,sourceVersion: root.sourceVersion,hash: nativeSha256(record.content) });
      }
    }
    failures.sort();
    evidence.sort((a,b) => a.ref.localeCompare(b.ref));
    const resultHash = nativeSha256({ companyId,planId: id,issueId,contractHash: row.canonicalSha256,evidence,failures,attempts: subjectAttempts.map(a => ({ id: a.id,status: a.status })),joins: !worker ? workers.map(w => ({ id: w.id,status: w.status })) : [] });
    return { planId: id,planVersion: plan.version,workerId,issueId,contractId,contractHash: row.canonicalSha256,contract,resultHash,evidence,deterministicFailures: failures,liveAttempts,riskClass: plan.riskClass,policy: { independentRequired: plan.verificationMode === "independent_required",humanRequired: plan.humanOversightMode === "required",workerSelfCertification: false } };
  }
  return {
    // Internal projections use their caller's privacy lock and snapshot without
    // reconciling attempts or publishing events before the outer commit.
    currentPacket: (actor: AuthorizationActor, companyId: string, id: string, workerId: string|null = null) => packet(db, actor, companyId, id, workerId),
    packet: async (actor: AuthorizationActor,companyId: string,id: string,workerId: string|null = null) => withV7ActivityTransaction(db, async tx => { await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId);
      const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId,companyId),eq(orchestrationPlans.id,id))).for("update");
      if (plan) await reconcileOrchestrationAttempts(tx,plan);
      return packet(tx,actor,companyId,id,workerId); }),
    list: async (actor: AuthorizationActor,companyId: string,id: string) => withV7ActivityTransaction(db, async tx => {
      await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId);
      const control = await orchestrationService(tx).get(actor,companyId,id,true);
      const rows = await tx.select().from(verificationRuns).where(and(eq(verificationRuns.companyId,companyId),eq(verificationRuns.planId,id))).orderBy(desc(verificationRuns.createdAt)).limit(100);
      return rows.map(row => ({ modelReservationId: row.modelReservationId,id: row.id,planId: row.planId,workerId: row.workerId,result: row.result,resultHash: row.resultHash,reviewerType: row.reviewerType,reviewerId: row.reviewerId,failedInvariants: control.completionContract ? row.failedInvariants : [],uncertainties: (control.completionContract ? row.uncertainties : []).map(() => "material_uncertainty"),createdAt: row.createdAt,erasedAt: row.erasedAt }));
    }),
    trajectory: async (actor: AuthorizationActor,companyId: string,id: string,raw: TrajectoryReviewInput) => {
      const input = trajectoryReviewSchema.parse(raw);
      await assertDerivedManager(db,actor,companyId); await assertV7Enabled(db,"supervision_v7");
      const reviewed = await withV7ActivityTransaction(db,async (tx,publications) => {
        await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId); await assertDerivedManager(tx,actor,companyId); await assertV7Enabled(tx,"supervision_v7");
        const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId,companyId),eq(orchestrationPlans.id,id))).for("update");
        if (!plan || plan.erasedAt) throw notFound("Plan not found");
        if (plan.version !== input.expectedPlanVersion || !["running","paused","verifying"].includes(plan.status)) throw conflict("Review requires the current nonterminal plan");
        const current = await packet(tx,actor,companyId,id,input.workerId);
        if (current.resultHash !== input.expectedResultHash || input.evidenceRefs.some(ref => !current.evidence.some(e => e.ref === ref))) throw conflict("Trajectory references changed or unauthorized observed output");
        const [subject] = await tx.select().from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,current.issueId))).for("share");
        await assertV7Authorization(tx,actor,companyId,"issue:mutate",{ type: "issue",companyId,issueId: subject!.id,projectId: subject!.projectId,parentIssueId: subject!.parentId,assigneeAgentId: subject!.assigneeAgentId,assigneeUserId: subject!.assigneeUserId,status: subject!.status });
        const session = await ensureSupervisionSession(tx,plan);
        const [signal] = await tx.insert(supervisionSignals).values({ companyId,planId: id,sessionId: session.id,signalType: input.verdict === "off_track" ? "off_track" : input.verdict === "possible_completion" ? "possible_completion" : input.verdict === "uncertain" ? "human_input_needed" : "progress",severity: input.verdict === "off_track" ? "warning" : "info",sourceType: "human_trajectory_review",sourceRef: v7HumanActorId(actor),facts: { verdict: input.verdict,reasonCode: input.reasonCode,evidenceRefs: input.evidenceRefs,resultHash: current.resultHash,workerId: input.workerId,completionCertified: false },snapshotHash: current.resultHash,dedupKey: nativeSha256({ plan: id,packet: current.resultHash,reviewer: v7HumanActorId(actor),verdict: input.verdict,reason: input.reasonCode }),expiresAt: new Date(Date.now()+120000) }).onConflictDoNothing().returning();
        if (!signal) return { signal: null,packet: current };
        if (input.verdict === "off_track") {
          const [fenced] = await tx.update(orchestrationPlans).set({ status: "paused",version: plan.version+1,updatedAt: new Date() }).where(eq(orchestrationPlans.id,id)).returning();
          const attempts = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId,companyId),eq(orchestrationWorkerAttempts.planId,id),eq(orchestrationWorkerAttempts.status,"running")));
          await enqueueSupervisionStop(tx,fenced!,{ actorType: "user",actorId: v7HumanActorId(actor),rationale: input.rationale,action: "PAUSE",recommendation: "STEER",reasonCode: "observable_trajectory_off_track",attemptIds: attempts.map(a => a.id),signalIds: [signal.id] });
        }
        await logActivity(tx,{ companyId,actorType: "user",actorId: v7HumanActorId(actor),action: "supervision.trajectory_reviewed",entityType: "orchestration_plan",entityId: id,details: { signalId: signal.id,verdict: input.verdict,reasonCode: input.reasonCode,resultHash: current.resultHash,completionCertified: false } },publications);
        return { signal,packet: current };
      });
      return reviewed;
    },
    review: async (actor: AuthorizationActor,companyId: string,id: string,raw: VerificationReviewInput) => {
      const input = verificationReviewSchema.parse(raw), postCommitActions: IssuePostCommitAction[] = [];
      await assertDerivedManager(db,actor,companyId); await assertV7Enabled(db,"verifier_v7");
      const result = await withV7ActivityTransaction(db,async (tx,publications) => {
        await lockAnalyticalCompany(tx,companyId); await lockMemoryPrivacy(tx,companyId); await assertDerivedManager(tx,actor,companyId); await assertV7Enabled(tx,"verifier_v7");
        const [plan] = await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId,companyId),eq(orchestrationPlans.id,id))).for("update");
        if (!plan || plan.erasedAt) throw notFound("Plan not found");
        if (plan.version !== input.expectedPlanVersion || !["running","paused","verifying"].includes(plan.status)) throw conflict("Review requires the current nonterminal plan version");
        await reconcileOrchestrationAttempts(tx,plan);
        const current = await packet(tx,actor,companyId,id,input.workerId);
        if (input.expectedResultHash !== current.resultHash) throw conflict("Saved outputs, evidence or run state changed; review the current packet");
        if (plan.riskClass === "C4") throw conflict("Safety-critical completion requires a qualified domain overlay");
        const evidenceRefs = new Set(current.evidence.map(e => e.ref)), failed = [...current.deterministicFailures];
        const inspect = (name: string,count: number,judgements: Array<{ index: number;satisfied: boolean;evidenceRefs: string[] }>) => {
          if (new Set(judgements.map(j => j.index)).size !== judgements.length || judgements.some(j => j.index >= count)) throw conflict("Review does not match the contract criterion indices");
          for (let index=0;index<count;index++) {
            const judgement = judgements.find(j => j.index === index);
            if (!judgement?.satisfied || !judgement.evidenceRefs.length) failed.push(`${name}:${index}`);
            if (judgement?.evidenceRefs.some(ref => !evidenceRefs.has(ref))) throw conflict("Review cites evidence outside this current authorized result packet");
          }
        };
        inspect("business_invariant",current.contract.businessInvariants.length,input.businessInvariants);
        inspect("evidence_requirement",current.contract.evidenceRequirements.length,input.evidenceRequirements);
        inspect("prohibited_outcome_absence",current.contract.prohibitedOutcomes.length,input.prohibitedOutcomes);
        if (!input.objectiveSatisfied) failed.push("objective_unsatisfied");
        if (input.uncertainties.length) failed.push("material_uncertainty");
        if (current.policy.humanRequired && !input.explicitHighImpactApproval) failed.push("explicit_high_impact_approval_missing");
        const verdict = input.result === "pass" && failed.length ? "fail" : input.result;
        const [subjectAttempt] = await tx.select().from(orchestrationWorkerAttempts).innerJoin(orchestrationWorkers,and(eq(orchestrationWorkers.companyId,orchestrationWorkerAttempts.companyId),eq(orchestrationWorkers.id,orchestrationWorkerAttempts.workerId))).where(and(eq(orchestrationWorkerAttempts.companyId,companyId),eq(orchestrationWorkerAttempts.planId,id),eq(orchestrationWorkers.issueId,current.issueId))).orderBy(desc(orchestrationWorkerAttempts.attempt)).limit(1);
        const [review] = await tx.insert(verificationRuns).values({ companyId,planId: id,workerId: input.workerId,workerAttemptId: subjectAttempt?.orchestration_worker_attempts.id ?? null,issueId: current.issueId,completionContractId: current.contractId,completionContractHash: current.contractHash,expectedPlanVersion: plan.version,resultHash: current.resultHash,inputArtifactRefs: current.evidence,evidenceRefs: [...new Set([...input.businessInvariants,...input.evidenceRequirements,...input.prohibitedOutcomes].flatMap(j => j.evidenceRefs))],reviewerType: "human",reviewerId: v7HumanActorId(actor),result: verdict,failedInvariants: failed,uncertainties: input.uncertainties,review: input,recommendation: verdict === "pass" ? "FINISH" : "ESCALATE_HUMAN" }).returning();
        const [task] = await tx.select().from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,current.issueId))).for("update");
        await assertV7Authorization(tx,actor,companyId,"issue:mutate",{ type: "issue",companyId,issueId: task!.id,projectId: task!.projectId,parentIssueId: task!.parentId,assigneeAgentId: task!.assigneeAgentId,assigneeUserId: task!.assigneeUserId,status: task!.status });
        if (verdict !== "pass") {
          const session = await ensureSupervisionSession(tx,plan);
          const [signal] = await tx.insert(supervisionSignals).values({ companyId,planId: id,sessionId: session.id,signalType: "verification_failed",severity: "warning",sourceType: "verification_run",sourceRef: review!.id,facts: { result: verdict,failedInvariants: failed,resultHash: current.resultHash },snapshotHash: current.resultHash,dedupKey: `verification:${review!.id}`,expiresAt: new Date(Date.now()+120000) }).returning();
          const [fenced] = await tx.update(orchestrationPlans).set({ status: "paused",version: plan.version+1,updatedAt: new Date() }).where(eq(orchestrationPlans.id,id)).returning();
          const live = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId,companyId),eq(orchestrationWorkerAttempts.planId,id),eq(orchestrationWorkerAttempts.status,"running")));
          await enqueueSupervisionStop(tx,fenced!,{ actorType: "user",actorId: v7HumanActorId(actor),rationale: input.rationale,action: "ESCALATE_HUMAN",reasonCode: "independent_verification_requires_resolution",attemptIds: live.map(a => a.id),signalIds: [signal!.id] });
        }
        if (verdict === "pass") {
          if (input.workerId) await tx.update(orchestrationWorkers).set({ status: "completed",updatedAt: new Date() }).where(and(eq(orchestrationWorkers.companyId,companyId),eq(orchestrationWorkers.id,input.workerId)));
          else {
            await tx.update(orchestrationWorkers).set({ status: "completed",updatedAt: new Date() }).where(and(eq(orchestrationWorkers.companyId,companyId),eq(orchestrationWorkers.planId,id)));
          }
          const terminal = !input.workerId || current.issueId === plan.issueId;
          await tx.update(orchestrationPlans).set({ status: terminal ? "completed" : plan.status,version: plan.version+1,completedAt: terminal ? new Date() : plan.completedAt,updatedAt: new Date() }).where(eq(orchestrationPlans.id,id));
          await issueService(tx).update(current.issueId,{ status: "done",actorUserId: v7HumanActorId(actor),companyGuard: companyId },tx,publications,postCommitActions);
        }
        await logActivity(tx,{ companyId,actorType: "user",actorId: v7HumanActorId(actor),action: "verification.reviewed",entityType: "orchestration_plan",entityId: id,details: { verificationRunId: review!.id,workerId: input.workerId,result: verdict,resultHash: current.resultHash,failedInvariantCount: failed.length } },publications);
        return review!;
      });
      await executeIssuePostCommitActions(db,postCommitActions);
      return result;
    },
  };
}
