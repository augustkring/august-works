import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExecutionContinuationEnvelope, AskUserQuestionsInteraction } from "@paperclipai/shared";

import { formatDurableQuestionResponseSummary } from "../question-response-delivery.js";
import { buildNativeCompletionContract } from "./completion-contracts.js";
import { renderPaperclipWakePrompt } from "@paperclipai/adapter-utils/server-utils";
import { buildNativeBootstrapSourceSet, buildNativeExecutionInput, captureNativeTaskWakeSource, exactNativeInitialTaskContinuation, exactNativeTaskContinuation } from "./native-execution-input.js";
import type { NativeInteractionResponseEnvelope } from "../../vendor/paperclip-runner/index.js";
import { nativeRuntimeContextFixture } from "./runtime-context.test-fixture.js";
import { captureNativeBootstrapContextWitness } from "../context/native-bootstrap-context-witness.js";
import { nativeStageContinuationOwnerMatches, nativeStageContinuationReaderMatches } from "../native-stage-wake-source.js";
import type { AuthorizationActor } from "../authorization.js";
import { nativeContinuationCommentProjection, nativeContinuationMessageHash, nativeCommentProjectionHash, nativeSha256 } from "./canonical.js";
import type { NativeTaskContinuationCapture } from "../execution-continuation.js";
import type { NativePayloadSourceInput } from "@paperclipai/shared";

describe("native bootstrap rendered-source closure", () => {
  const companyId = randomUUID(), issueId = randomUUID(), runId = randomUUID(), agentId = randomUUID(), renderedMarkdown = "Task body rendered by the native task renderer.";
  const hash = "a".repeat(64);
  const policy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  const snapshot = (ownerCompanyId = companyId, ownerIssueId = issueId) => ({ version: 1 as const,
    owner: { kind: "issue" as const, companyId: ownerCompanyId, id: ownerIssueId, contentHash: hash }, policy, inputs: [], digest: hash });
  const input = (overrides: Partial<Parameters<typeof buildNativeBootstrapSourceSet>[0]> = {}) => {
    const taskInput = { kind: "task" as const, issueId, sourceVersion: "1", contentHash: hash };
    const references = [{ kind: "task" as const, id: issueId }];
    return buildNativeBootstrapSourceSet({ companyId, runId, agentId, issueId, renderedMarkdown,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown, "utf8").digest("hex"), references,
      candidates: [{ kind: "task", id: issueId, input: taskInput, payloadSourceSnapshot: snapshot() }],
      runtimeInputs: [], contextManifestIds: [], rolePackInputs: [], unsupportedInputPresent: false, ...overrides });
  };

  it("keeps the complete Stage thread under a distinct persisted-owner trigger", () => {
    const humanId = "stage-responsible-human", wakeId = randomUUID(), intentId = randomUUID();
    const human = nativeContinuationCommentProjection({ id: randomUUID(), authorType: "user", authorUserId: "another-readable-human",
      authorAgentId: null, createdByRunId: null, body: "Please review the entire draft.",
      createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"), deletedAt: null, sourceTrust: null });
    const agent = nativeContinuationCommentProjection({ id: randomUUID(), authorType: "agent", authorUserId: null,
      authorAgentId: randomUUID(), createdByRunId: randomUUID(), body: "The draft is ready for review.",
      createdAt: new Date("2026-10-01T00:01:00Z"), updatedAt: new Date("2026-10-01T00:01:00Z"), deletedAt: null, sourceTrust: null });
    const reason = "execution_review_requested" as const;
    const capture: NativeTaskContinuationCapture = { companyId,issueId,runId,agentId,responsibleUserId:humanId,wakeupRequestId:wakeId,
      wake: {requestedByActorType:"system",requestedByActorId:`native-status-wake-dispatch:${intentId}`,reason,originCommentIds:[]},
      envelope: { version:1, companyId,issueId,trigger:{reason,interactionId:null,sourceRunId:null},originCommentIds:[],
        objective:human.body,messages:[human,agent],humanResponses:[],interactionOutcomes:[],completedWork:null,
        recoveryOutcomes:[],unresolvedInteractionIds:[],completedActions:[],
        coverage:{kind:"full_task_history",throughCommentId:agent.id,summaryThroughCommentId:null} },
      commentSources:[human,agent].map(message=>({ input:{kind:"comment",issueId,commentId:message.id,
        sourceVersion:"1",contentHash:nativeContinuationMessageHash(message)},payloadSourceSnapshot:null })) };
    const stageTrigger: NonNullable<Parameters<typeof exactNativeTaskContinuation>[0]["stageTrigger"]> = {
      version:1,companyId,issueId,runId,agentId,responsibleUserId:humanId,wakeupRequestId:wakeId,intentId,
      effectId:randomUUID(),decisionId:randomUUID(),executorRunId:randomUUID(),executorAgentId:randomUUID(),
      reason,stageHash:"a".repeat(64),chainHash:"b".repeat(64),taskObjective:"Task fallback objective" };
    const historicalStageOwner={companyId,issueId,runId,agentId,responsibleUserId:humanId,stageSource:{runId,issueId}};
    const receiverIdentity={companyId,id:runId,agentId,responsibleUserId:humanId};
    const receiverReader:AuthorizationActor={type:"agent",source:"agent_jwt",companyId,agentId,runId,onBehalfOfUserId:humanId};
    const differentReader:AuthorizationActor={type:"agent",source:"agent_jwt",companyId,agentId:randomUUID(),
      runId:randomUUID(),onBehalfOfUserId:randomUUID()};
    expect(nativeStageContinuationReaderMatches({reader:receiverReader,receiver:receiverIdentity,historical:false})).toBe(true);
    expect(nativeStageContinuationReaderMatches({reader:differentReader,receiver:receiverIdentity,historical:false})).toBe(false);
    // Historical identity matching is deliberately broader; the caller must
    // still reselect actual finalized consumption and run/Task ACLs.
    expect(nativeStageContinuationReaderMatches({reader:differentReader,receiver:receiverIdentity,historical:true})).toBe(true);
    expect(nativeStageContinuationReaderMatches({reader:{...differentReader,companyId:randomUUID()},
      receiver:receiverIdentity,historical:true})).toBe(false);
    expect(nativeStageContinuationOwnerMatches({candidate:stageTrigger,expected:stageTrigger,historicalConsumption:historicalStageOwner})).toBe(true);
    expect(nativeStageContinuationOwnerMatches({candidate:{...stageTrigger,chainHash:"c".repeat(64)},expected:stageTrigger,
      historicalConsumption:historicalStageOwner})).toBe(false);
    expect(nativeStageContinuationOwnerMatches({candidate:stageTrigger,expected:stageTrigger,
      historicalConsumption:{...historicalStageOwner,runId:randomUUID()}})).toBe(false);
    // Historical reads are bound to the entire freshly rebuilt persisted Stage
    // owner, not merely a plausible Stage-entry shape or matching receiver ID.
    for (const forgedTrigger of [{...stageTrigger,effectId:randomUUID()}, {...stageTrigger,decisionId:randomUUID()},
      {...stageTrigger,executorRunId:randomUUID()}, {...stageTrigger,stageHash:"d".repeat(64)}])
      expect(nativeStageContinuationOwnerMatches({candidate:forgedTrigger,expected:stageTrigger,
        historicalConsumption:historicalStageOwner})).toBe(false);
    expect(nativeStageContinuationOwnerMatches({candidate:stageTrigger,expected:stageTrigger,
      historicalConsumption:{...historicalStageOwner,stageSource:{runId:randomUUID(),issueId}}})).toBe(false);
    const check = (value = capture, proof: typeof stageTrigger | undefined = stageTrigger) => exactNativeTaskContinuation({
      companyId,issueId,runId,agentId,responsibleUserId:humanId,wakeupRequestId:wakeId,wakeReason:reason,
      value:value.envelope,capture:value,...(proof ? {stageTrigger:proof}: {}) });
    expect(check()).toBe(capture);
    expect(exactNativeTaskContinuation({companyId,issueId,runId,agentId,responsibleUserId:humanId,wakeupRequestId:wakeId,
      wakeReason:reason,value:capture.envelope,capture})).toBeNull();
    for (const mutate of [
      (v:NativeTaskContinuationCapture)=>{v.wake.requestedByActorId=randomUUID();},
      (v:NativeTaskContinuationCapture)=>{v.wake.requestedByActorType="user";},
      (v:NativeTaskContinuationCapture)=>{v.envelope.originCommentIds=[human.id];},
      (v:NativeTaskContinuationCapture)=>{v.wake.originCommentIds=[human.id];},
      (v:NativeTaskContinuationCapture)=>{v.envelope.trigger.sourceRunId=stageTrigger.executorRunId;},
      (v:NativeTaskContinuationCapture)=>{v.envelope.objective=agent.body;},
      (v:NativeTaskContinuationCapture)=>{v.envelope.messages[0]!.body="Substituted body";},
      (v:NativeTaskContinuationCapture)=>{v.commentSources.pop();},
      (v:NativeTaskContinuationCapture)=>{Reflect.set(v.envelope.messages[0]!,"sourceTrust",{preset:"unknown"});},
    ]) { const changed=structuredClone(capture);mutate(changed);expect(check(changed)).toBeNull(); }
    for (const proof of [{...stageTrigger,runId:randomUUID()},{...stageTrigger,decisionId:"not-a-decision"},
      {...stageTrigger,stageHash:"not-a-hash"},{...stageTrigger,reason:"execution_approval_requested" as const}])
      expect(check(capture,proof)).toBeNull();
    const producerRunId=randomUUID(),producerAgentId=randomUUID(),producerResultId=randomUUID(),producerDecisionId=randomUUID();
    const producerTaskInput={kind:"task" as const,issueId,sourceVersion:"1",contentHash:hash};
    const producerStageRead:import("../native-stage-task-body-source.js").NativeFinalizedStageTaskBodyRead={
      kind:"stage_entry",companyId,issueId,runId:producerRunId,agentId:producerAgentId,receiptDigest:"c".repeat(64),
      executionInputDigest:"d".repeat(64),resultId:producerResultId,resultHash:"sha256:"+"e".repeat(64),decisionId:producerDecisionId,
      finalizationVersion:"2026-10-01T00:00:01.000Z",transitionIds:[randomUUID()],
      taskCapture:{input:producerTaskInput,payloadSourceSnapshot:snapshot()}};
    const stageWithSummary=structuredClone(capture);
    stageWithSummary.envelope.completedWork="Executor's accepted Stage summary.";
    stageWithSummary.finalizedSummary={companyId,issueId,agentId,receiverRunId:runId,sourceRunId:producerRunId,
      resultId:producerResultId,resultCanonicalSha256:producerStageRead.resultHash,resultCreatedAt:"2026-10-01T00:00:00.000Z",
      finalizationVersion:producerStageRead.finalizationVersion,assessmentId:randomUUID(),decisionId:producerDecisionId,
      decisionDigest:"f".repeat(64),decisionSnapshotHash:"9".repeat(64),
      parentReceipt:{version:1,binding:{companyId,issueId,agentId:producerAgentId,runId:producerRunId,responsibleUserId:humanId},
        bootstrap:{executionInputDigest:"d".repeat(64),policy,inputs:[producerTaskInput]},dispatches:[],additionalInputs:[],digest:"8".repeat(64)},
      body:stageWithSummary.envelope.completedWork,stageEntryRead:producerStageRead};
    const stageTriggerWithSummary={...stageTrigger,executorRunId:producerRunId,executorAgentId:producerAgentId};
    expect(check(stageWithSummary,stageTriggerWithSummary)).toBe(stageWithSummary);
    const brokenCanonical=structuredClone(stageWithSummary);
    brokenCanonical.finalizedSummary!.stageEntryRead!.resultHash="e".repeat(64);
    expect(check(brokenCanonical,stageTriggerWithSummary)).toBeNull();
    const agentOnly=structuredClone(capture);
    agentOnly.envelope.messages=[agent];agentOnly.commentSources=agentOnly.commentSources.slice(1);
    agentOnly.envelope.objective=stageTrigger.taskObjective;
    expect(check(agentOnly)).toBe(agentOnly);
    agentOnly.envelope.objective=human.body;
    expect(check(agentOnly)).toBeNull();
    const oversized=structuredClone(capture);oversized.envelope.messages[0]!.body="x".repeat(64_001);
    expect(check(oversized)).toBeNull();
  });

  it("keeps accepted-plan agent origins and a Task objective in the closed continuation", () => {
    const companyId = randomUUID(), issueId = randomUUID(), runId = randomUUID(), agentId = randomUUID();
    const sourceRunId = randomUUID(), interactionId = randomUUID(), commentId = randomUUID(), wakeupRequestId = randomUUID();
    const humanId = "human-auth-user:non-uuid-735", resolvedAt = "2026-11-03T00:00:00.000Z";
    const taskObjective = "Task description used when the accepted-plan wake has no Human comment.";
    const message = { id: commentId, authorType: "agent", authorId: agentId, createdByRunId: sourceRunId,
      body: "Please confirm the current plan.", createdAt: resolvedAt, updatedAt: resolvedAt, deleted: false, sourceTrust: null };
    const documentId = randomUUID(), revisionId = randomUUID(), bodyHash = "c".repeat(64);
    const planSourceInput = { kind: "document_revision" as const, issueId, documentId, revisionId, contentHash: bodyHash };
    const interactionResult = { outcome: "accepted", reason: null, commentId: null };
    const planReviewContext = { documentKey: "plan" as const, issueId, latestRevisionId: revisionId, latestRevisionNumber: 3,
      threads: [], interaction: { id: interactionId, kind: "request_confirmation", status: "accepted", continuationPolicy: "wake_assignee",
        sourceCommentId: commentId, sourceRunId, target: { issueId, documentId, key: "plan", revisionId, revisionNumber: 3 },
        acceptedTargetRevision: { issueId, documentId, key: "plan", revisionId, revisionNumber: 3 }, result: interactionResult, resolvedAt },
      totals: { openThreadCount: 0, includedThreadCount: 0, omittedThreadCount: 0, commentCount: 0, includedCommentCount: 0, omittedCommentCount: 0 },
      limits: { maxThreads: 20, maxComments: 80, maxBodyChars: 1200, maxTotalBodyChars: 12000, maxAnchorTextChars: 500 }, truncated: false };
    const capture: NativeTaskContinuationCapture = {
      companyId, issueId, agentId, runId, responsibleUserId: humanId, wakeupRequestId,
      envelope: { version: 1, companyId, issueId, trigger: { reason: "issue_commented", interactionId, sourceRunId },
        originCommentIds: [commentId], objective: taskObjective, messages: [message],
        humanResponses: [{ id: interactionId, kind: "request_confirmation", status: "accepted", resolvedByUserId: humanId, resolvedAt, result: interactionResult }],
        interactionOutcomes: [{ id: interactionId, kind: "request_confirmation", status: "accepted", result: interactionResult }],
        completedWork: null, recoveryOutcomes: [], unresolvedInteractionIds: [], completedActions: [],
        coverage: { kind: "full_task_history", throughCommentId: commentId, summaryThroughCommentId: null } },
      commentSources: [{ input: { kind: "comment", issueId, commentId, sourceVersion: "2.0", contentHash: nativeContinuationMessageHash(message) }, payloadSourceSnapshot: null }],
      wake: { requestedByActorType: "user", requestedByActorId: humanId, reason: "issue_commented", originCommentIds: [commentId],
        interaction: { interactionId, interactionKind: "request_confirmation", interactionStatus: "accepted", sourceRunId } },
      acceptedPlanReview: { version: 1, companyId, issueId, agentId, runId, interactionId, sourceRunId,
        resolvedByUserId: humanId, resolvedAt, originCommentIds: [commentId], taskObjective,
        interactionSource: { kind: "interaction", issueId, interactionId, sourceVersion: "2.0", contentHash: "a".repeat(64) },
        planSource: { input: planSourceInput, payloadSourceSnapshot: null },
        planRendition: { documentId, revisionId, revisionNumber: 3, bodyHash }, planReviewContext },
    };
    const check = (value: NativeTaskContinuationCapture) => exactNativeTaskContinuation({ value: value.envelope, companyId, issueId,
      runId, agentId, responsibleUserId: humanId, wakeupRequestId, wakeReason: "issue_commented", capture: value });
    expect(check(capture)).toBe(capture);
    const missingOrigins = structuredClone(capture); Reflect.deleteProperty(missingOrigins.acceptedPlanReview!, "originCommentIds");
    expect(check(missingOrigins)).toBeNull();
    const missingObjective = structuredClone(capture); Reflect.deleteProperty(missingObjective.acceptedPlanReview!, "taskObjective");
    expect(check(missingObjective)).toBeNull();
    const changedOrigin = structuredClone(capture); changedOrigin.acceptedPlanReview!.originCommentIds = [];
    expect(check(changedOrigin)).toBeNull();
  });

  it("keeps later readable Human history distinct from the admitted trigger author", () => {
    const responsibleUserId = "trigger-human";
    const otherUserId = "other-readable-human";
    const triggerCommentId = randomUUID(), historyCommentId = randomUUID(), wakeupRequestId = randomUUID();
    const at = new Date("2026-10-01T00:00:00.000Z");
    const trigger = nativeContinuationCommentProjection({ id: triggerCommentId, authorType: "user", authorUserId: responsibleUserId,
      authorAgentId: null, createdByRunId: null, body: "The current Human request.", createdAt: at,
      updatedAt: at, deletedAt: null, sourceTrust: null });
    const history = nativeContinuationCommentProjection({ id: historyCommentId, authorType: "user", authorUserId: otherUserId,
      authorAgentId: null, createdByRunId: null, body: "Later readable history, not the admitted trigger.",
      createdAt: new Date(at.getTime()+1000), updatedAt: new Date(at.getTime()+1000), deletedAt: null, sourceTrust: null });
    const capture: NativeTaskContinuationCapture = { companyId, issueId, agentId, runId, responsibleUserId, wakeupRequestId,
      wake: { requestedByActorType: "user", requestedByActorId: responsibleUserId, reason: "issue_commented",
        originCommentIds: [triggerCommentId] },
      envelope: { version: 1, companyId, issueId, trigger: { reason: "issue_commented", interactionId: null, sourceRunId: null },
        originCommentIds: [triggerCommentId], objective: history.body, messages: [trigger, history], humanResponses: [],
        interactionOutcomes: [], completedWork: null, recoveryOutcomes: [], unresolvedInteractionIds: [], completedActions: [],
        coverage: { kind: "full_task_history", throughCommentId: historyCommentId, summaryThroughCommentId: null } },
      commentSources: [history, trigger].map(message => ({ input: { kind: "comment" as const, issueId,
        commentId: message.id, sourceVersion: "1", contentHash: nativeContinuationMessageHash(message) }, payloadSourceSnapshot: null })) };
    const check = (value: NativeTaskContinuationCapture) => exactNativeTaskContinuation({ value: value.envelope, companyId, issueId,
      runId, agentId, responsibleUserId, wakeupRequestId, wakeReason: "issue_commented", capture: value });
    expect(check(capture)).toBe(capture);
    const wrongTrigger = structuredClone(capture);
    wrongTrigger.envelope.objective = trigger.body;
    expect(check(wrongTrigger)).toBeNull();
    const wrongRequester = structuredClone(capture);
    wrongRequester.wake.requestedByActorId = otherUserId;
    expect(check(wrongRequester)).toBeNull();
  });

  it("binds completed Stage actions to their distinct producer and exact retained rendition", () => {
    const humanId="current-readable-human",wakeId=randomUUID(),parentRunId=randomUUID(),parentAgentId=randomUUID();
    const message=nativeContinuationCommentProjection({id:randomUUID(),authorType:"user",authorUserId:humanId,
      authorAgentId:null,createdByRunId:null,body:"Continue after the recorded review.",createdAt:new Date("2026-10-01T00:00:00Z"),
      updatedAt:new Date("2026-10-01T00:00:00Z"),deletedAt:null,sourceTrust:null});
    const stageDecisionId=randomUUID(),stageId=randomUUID();
    const fromState:import("../native-stage-wake-source.js").NativeFinalizedStageConsumption["fromState"]={
      status:"pending",currentStageId:stageId,currentStageIndex:0,currentStageType:"review",
      currentParticipant:{type:"agent",agentId:parentAgentId,userId:null},returnAssignee:null,reviewRequest:null,
      completedStageIds:[],lastDecisionId:null,lastDecisionOutcome:null,monitor:null,changesRequestedCount:0};
    const toState={...fromState,status:"completed" as const,lastDecisionId:stageDecisionId,lastDecisionOutcome:"approved" as const};
    const action={runId:parentRunId,receiptId:"b".repeat(64),operationId:"POST /api/issues/{id}/comments",
      result:{ok:true,status:201,data:{id:randomUUID(),companyId,issueId,authorType:"agent",authorAgentId:parentAgentId,authorUserId:null,createdByRunId:parentRunId,body:"Approved."}}};
    const owner:import("../native-stage-wake-source.js").NativeFinalizedStageConsumption={
      companyId,issueId,runId:parentRunId,agentId:parentAgentId,responsibleUserId:humanId,
      originHash:"a".repeat(64),receiptDigest:"a".repeat(64),executionInputDigest:"a".repeat(64),stageSource:{kind:"native_task_wake",runId:parentRunId,issueId,sourceVersion:"1",contentHash:"a".repeat(64)},
      apiReceiptId:action.receiptId,apiReceiptHash:"c".repeat(64),callId:"actual-acknowledged-call",dispatchId:randomUUID(),reservationId:randomUUID(),
      fromState,toState,stageDecisionId,stageDecisionHash:"d".repeat(64),resultId:randomUUID(),resultHash:"e".repeat(64),assessmentId:randomUUID(),
      finalizerDecisionId:randomUUID(),finalizerDecisionHash:"f".repeat(64),finalizationVersion:"2026-10-01T00:01:00Z",action};
    const capture:NativeTaskContinuationCapture={companyId,issueId,runId,agentId,responsibleUserId:humanId,wakeupRequestId:wakeId,
      wake:{requestedByActorType:"user",requestedByActorId:humanId,reason:"issue_commented",originCommentIds:[message.id]},
      envelope:{version:1,companyId,issueId,trigger:{reason:"issue_commented",interactionId:null,sourceRunId:null},originCommentIds:[message.id],
        objective:message.body,messages:[message],humanResponses:[],interactionOutcomes:[],completedWork:null,recoveryOutcomes:[],
        unresolvedInteractionIds:[],completedActions:[structuredClone(action)],coverage:{kind:"full_task_history",throughCommentId:message.id,summaryThroughCommentId:null}},
      commentSources:[{input:{kind:"comment",issueId,commentId:message.id,sourceVersion:"1",contentHash:nativeContinuationMessageHash(message)},payloadSourceSnapshot:null}],
      stageActions:[owner]};
    const check=(value=capture)=>exactNativeTaskContinuation({companyId,issueId,runId,agentId,responsibleUserId:humanId,wakeupRequestId:wakeId,
      wakeReason:"issue_commented",capture:value,value:value.envelope});
    expect(check()).toBe(capture);
    for(const change of [
      (v:NativeTaskContinuationCapture)=>{delete v.stageActions;},
      (v:NativeTaskContinuationCapture)=>{v.stageActions!.push(structuredClone(v.stageActions![0]!));},
      (v:NativeTaskContinuationCapture)=>{v.stageActions![0]!.agentId=agentId;},
      (v:NativeTaskContinuationCapture)=>{v.stageActions![0]!.stageDecisionId=randomUUID();},
      (v:NativeTaskContinuationCapture)=>{v.stageActions![0]!.stageSource.contentHash="not-a-hash";},
      (v:NativeTaskContinuationCapture)=>{v.stageActions![0]!.receiptDigest="not-a-receipt";},
      (v:NativeTaskContinuationCapture)=>{v.envelope.completedActions![0]!.operationId="POST /api/unknown";},
      (v:NativeTaskContinuationCapture)=>{v.envelope.completedActions![0]!.result={ok:true,status:200,data:{id:randomUUID()}};},
      (v:NativeTaskContinuationCapture)=>{v.stageActions![0]!.runId=runId;},
    ]){const changed=structuredClone(capture);change(changed);expect(check(changed)).toBeNull();}
  });

  it("requires a nonempty Task root and exact company, renderer identity and candidate input binding", () => {
    expect(input()?.inputs).toEqual([{ kind: "task", issueId, sourceVersion: "1", contentHash: hash }]);
    expect(input({ references: [] })).toBeNull();
    expect(input({ candidates: [{ kind: "task", id: issueId, input: { kind: "task", issueId, sourceVersion: "1", contentHash: hash }, payloadSourceSnapshot: snapshot(randomUUID()) }] })).toBeNull();
    expect(input({ candidates: [{ kind: "task", id: issueId, input: { kind: "project", projectId: issueId, sourceVersion: "1", contentHash: hash }, payloadSourceSnapshot: snapshot() }] })).toBeNull();
    expect(input({ candidates: [{ kind: "task", id: issueId, input: { kind: "task", issueId: randomUUID(), sourceVersion: "1", contentHash: hash }, payloadSourceSnapshot: snapshot() }] })).toBeNull();
  });

  it("retains only exact Role Pack version inputs and fails closed on missing or foreign-family role inputs", () => {
    const rolePack = { kind: "role_pack_version" as const, rolePackId: randomUUID(), versionId: randomUUID(), contentHash: hash };
    expect(input({ rolePackInputs: [rolePack] })?.inputs).toContainEqual(rolePack);
    expect(input({ rolePackInputs: null })).toBeNull();
    expect(input({ rolePackInputs: [{ kind: "task", issueId, sourceVersion: "1", contentHash: hash }] })).toBeNull();
    expect(input({ rolePackInputs: [{ kind: "unknown" } as unknown as NativePayloadSourceInput] })).toBeNull();
  });

  it("admits only the exact rendered attachment owner after byte verification", () => {
    const attachmentId = randomUUID(), commentId = randomUUID(), assetId = randomUUID();
    const taskInput = { kind: "task" as const, issueId, sourceVersion: "1", contentHash: hash };
    const attachmentInput = { kind: "attachment" as const, issueId, attachmentId, commentId, assetId,
      sha256: hash, byteSize: 42, disposition: "delivered" as const };
    const attachmentSnapshot = { version: 1 as const,
      owner: { kind: "attachment" as const, companyId, id: attachmentId, contentHash: hash },
      policy, inputs: [], digest: hash };
    const base = { companyId, runId, agentId, issueId, renderedMarkdown,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown, "utf8").digest("hex"),
      references: [{ kind: "task" as const, id: issueId }, { kind: "attachment" as const, id: attachmentId,
        commentId, filename: "brief.pdf", contentType: "application/pdf", byteSize: 42 }],
      candidates: [{ kind: "task" as const, id: issueId, input: taskInput, payloadSourceSnapshot: snapshot() },
        { kind: "attachment" as const, id: attachmentId, input: attachmentInput, payloadSourceSnapshot: attachmentSnapshot }],
      runtimeInputs: [], contextManifestIds: [], rolePackInputs: [], unsupportedInputPresent: false };
    expect(buildNativeBootstrapSourceSet(base)?.inputs).toContainEqual(attachmentInput);
    expect(buildNativeBootstrapSourceSet({ ...base, candidates: [...base.candidates.slice(0, 1), {
      kind: "attachment" as const, id: attachmentId,
      input: { ...attachmentInput, disposition: "attachment_staging_failed" as const }, payloadSourceSnapshot: attachmentSnapshot,
    }] })).toBeNull();
    expect(buildNativeBootstrapSourceSet({ ...base, references: [...base.references.slice(0, 1), {
      ...base.references[1]!, commentId: randomUUID(),
    }] })).toBeNull();
  });

  it("includes only interaction envelopes matched to unique exact current captures", () => {
    const interactionId = randomUUID();
    const response = { interactionId, kind: "ask_user_questions", response: { status: "pending", result: null } } satisfies NativeInteractionResponseEnvelope;
    const source = { kind: "interaction" as const, issueId, interactionId, sourceVersion: "1",
      contentHash: nativeSha256(response) };
    expect(input({ interactionResponses: [response], interactionSources: [source] })?.inputs).toContainEqual(source);
    expect(input({ interactionResponses: [response], interactionSources: [] })).toBeNull();
    expect(input({ interactionResponses: [], interactionSources: [source] })).toBeNull();
    expect(input({ interactionResponses: [response], interactionSources: [{ ...source, contentHash: hash }] })).toBeNull();
    expect(input({ interactionResponses: [response, response], interactionSources: [source] })).toBeNull();
  });

  it("closes a Task-only wake or comments whose exact rendered bodies have owner captures", () => {
    const task = { id: issueId, identifier: "NATIVE-1", title: "Draft", description: "Internal draft",
      status: "todo", priority: "medium", workMode: "standard" };
    const payload = {
      reason: "on_demand", executionContinuation: null, attachmentOmissions: [], externalChatProvider: null,
      recovery: null, issue: { id: task.id, identifier: task.identifier, title: task.title, description: task.description,
        descriptionTruncated: false, status: task.status, priority: task.priority, workMode: task.workMode },
      agentMessage: null, childIssueSummaries: [], childIssueSummaryTruncated: false, dispositionRepair: null,
      livenessContinuation: null, interactionKind: null, interactionStatus: null, interactionId: null, sourceRunId: null,
      externalChatQuestionResponse: null, externalInteractionContinuation: false, checkboxSelection: null,
      checkedOutByHarness: false, externalChatExecutionBound: false, simplifiedEnglishInteractions: false,
      dependencyBlockedInteraction: false, treeHoldInteraction: false, activeTreeHold: {}, unresolvedBlockerIssueIds: [],
      unresolvedBlockerSummaries: [], executionStage: null, taskWatchdog: null, skillTest: null, continuationSummary: null,
      commentIds: [], latestCommentId: null, comments: [], annotationDeltas: [], planReviewContext: null,
      documentReviewContext: null, commentWindow: { requestedCount: 0, includedCount: 0, missingCount: 0 },
      truncated: false, fallbackFetchNeeded: false,
    };
    const emptyContinuation = { version: 1, companyId, issueId, trigger: { reason: "on_demand", interactionId: null, sourceRunId: null },
      originCommentIds: [], objective: task.description, messages: [], humanResponses: [], interactionOutcomes: [],
      completedWork: null, recoveryOutcomes: [], unresolvedInteractionIds: [],
      coverage: { kind: "full_task_history", throughCommentId: null, summaryThroughCommentId: null } };
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand", task,
      payload: { ...payload, connectorSkillInstructions: "" } })).toMatchObject({
      kind: "native_task_wake", runId, issueId, sourceVersion: "1", contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const wake = captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand", task, payload });
    expect(wake).toMatchObject({ kind: "native_task_wake" });
    const reorderedPayload = Object.fromEntries(Object.entries(payload).reverse());
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      task, payload: reorderedPayload })?.contentHash).toBe(wake?.contentHash);
    const commentId = randomUUID();
    const commentSource = { kind: "comment" as const, issueId, commentId, sourceVersion: "2",
      contentHash: nativeCommentProjectionHash({ body: "Please finish this task.", presentation: null, metadata: null }) };
    const comment = { id: commentId, issueId, authorType: "user", body: "Please finish this task.", bodyTruncated: false,
      presentation: null, metadata: null, deletedAt: null };
    const commentWake = { ...payload, commentIds: [commentId], latestCommentId: commentId, comments: [comment],
      commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 } };
    const humanId = "actual-selected-human", wakeId = randomUUID();
    const message = nativeContinuationCommentProjection({ id: commentId, authorType: "user", authorUserId: humanId,
      authorAgentId: null, createdByRunId: null, body: comment.body, createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"), deletedAt: null, sourceTrust: null });
    const initialCapture: NativeTaskContinuationCapture = { companyId, issueId, agentId, runId, responsibleUserId: humanId,
      wakeupRequestId: wakeId, envelope: { ...emptyContinuation, version: 1, objective: message.body,
        originCommentIds: [commentId], messages: [message],
        coverage: { kind: "full_task_history", throughCommentId: commentId, summaryThroughCommentId: null } },
      commentSources: [{ input: { ...commentSource, contentHash: nativeContinuationMessageHash(message) },
        payloadSourceSnapshot: null }],
      wake: { requestedByActorType: "user", requestedByActorId: humanId, reason: "on_demand", originCommentIds: [commentId] } };
    const captureInitial = (capture = initialCapture) => captureNativeTaskWakeSource({ companyId, runId, issueId, agentId,
      responsibleUserId: humanId, wakeupRequestId: wakeId, sourceVersion: "1", persistedWakeReason: "on_demand", task,
      payload: { ...commentWake, executionContinuation: capture.envelope }, commentSources: [commentSource], continuationCapture: capture });
    expect(captureInitial()).toMatchObject({ kind: "native_task_wake", runId, issueId });
    const jsonbOrdered = structuredClone(initialCapture);
    Object.assign(jsonbOrdered.envelope, { messages: [Object.fromEntries(Object.entries(message).reverse())] });
    expect(captureInitial(jsonbOrdered)).toMatchObject({ kind: "native_task_wake", runId, issueId });
    const trustedCapture = structuredClone(initialCapture);
    trustedCapture.envelope.messages[0]!.sourceTrust = { preset: "standard", disposition: "promoted",
      promotedFrom: { artifactKind: "comment", artifactId: commentId, issueId } };
    trustedCapture.commentSources[0]!.input.contentHash = nativeContinuationMessageHash(trustedCapture.envelope.messages[0]!);
    const trustMessage = trustedCapture.envelope.messages[0]!;
    Object.assign(trustMessage, { sourceTrust: { promotedFrom: { issueId, artifactId: commentId, artifactKind: "comment" },
      disposition: "promoted", preset: "standard" } });
    expect(captureInitial(trustedCapture)).toMatchObject({ kind: "native_task_wake", runId, issueId });
    const otherHumanHistory = structuredClone(initialCapture);
    const priorMessage = { ...message, id: randomUUID(), authorId: "another-legitimate-human", body: "Earlier readable history.",
      createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z" };
    otherHumanHistory.envelope.messages.unshift(priorMessage);
    otherHumanHistory.commentSources.unshift({ input: { ...commentSource, commentId: priorMessage.id,
      contentHash: nativeContinuationMessageHash(priorMessage) }, payloadSourceSnapshot: null });
    expect(captureInitial(otherHumanHistory)).toMatchObject({ kind: "native_task_wake" });
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const value of [undefined, cyclic, BigInt(1)]) expect(exactNativeInitialTaskContinuation({ value, companyId, issueId, runId,
      agentId, responsibleUserId: humanId, wakeupRequestId: wakeId, wakeReason: "on_demand", capture: initialCapture })).toBeNull();
    for (const change of [
      (c: NativeTaskContinuationCapture) => { c.companyId = randomUUID(); },
      (c: NativeTaskContinuationCapture) => { c.runId = randomUUID(); },
      (c: NativeTaskContinuationCapture) => { c.wakeupRequestId = randomUUID(); },
      (c: NativeTaskContinuationCapture) => { c.envelope.objective = "Unowned prose"; },
      (c: NativeTaskContinuationCapture) => { c.envelope.originCommentIds = [randomUUID()]; },
      (c: NativeTaskContinuationCapture) => { c.envelope.messages[0]!.body = "Uncaptured message"; },
      (c: NativeTaskContinuationCapture) => { c.commentSources[0]!.input.contentHash = "f".repeat(64); },
      (c: NativeTaskContinuationCapture) => { c.envelope.messages[0]!.sourceTrust = { preset: "invented", disposition: "promoted" }; },
      (c: NativeTaskContinuationCapture) => { c.wake.requestedByActorType = "agent"; },
      (c: NativeTaskContinuationCapture) => { c.wake.requestedByActorId = "wrong-trigger-human"; },
      (c: NativeTaskContinuationCapture) => { c.envelope.messages[0]!.body = "x".repeat(64_001); },
      (c: NativeTaskContinuationCapture) => { c.envelope.messages.push(c.envelope.messages[0]!); },
      (c: NativeTaskContinuationCapture) => { Object.assign(c.envelope, { unknownField: "opaque" }); },
    ]) { const changed = structuredClone(initialCapture); change(changed); expect(captureInitial(changed)).toBeNull(); }
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      task, payload: commentWake, commentSources: [commentSource] })).toMatchObject({ kind: "native_task_wake", runId, issueId });
    const unrelatedRendition = { ...commentSource,
      contentHash: nativeCommentProjectionHash({ body: "redacted alternate rendition", presentation: null, metadata: null }) };
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      task, payload: commentWake, commentSources: [unrelatedRendition, commentSource] })).toMatchObject({ kind: "native_task_wake" });
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      task, payload: commentWake, commentSources: [commentSource, { ...commentSource, sourceVersion: "3" }] })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      task, payload: commentWake })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      task, payload: { ...commentWake, comments: [{ ...comment, body: "changed" }] }, commentSources: [commentSource] })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      checkoutRunId: runId, task, payload: { ...payload, checkedOutByHarness: true } })).toMatchObject({ kind: "native_task_wake" });
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand",
      checkoutRunId: randomUUID(), task, payload: { ...payload, checkedOutByHarness: true } })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand", task,
      payload: { ...payload, executionContinuation: emptyContinuation } })).toMatchObject({ kind: "native_task_wake" });
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: null, task,
      payload: { ...payload, reason: null, executionContinuation: { ...emptyContinuation,
        trigger: { reason: "task_execution", interactionId: null, sourceRunId: null } } } })).toMatchObject({ kind: "native_task_wake" });
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand", task, payload: {
      ...payload, connectorSkillInstructions: "untracked connector instructions",
    } })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand", task, payload: {
      ...payload, comments: [{ id: randomUUID(), body: "unaccounted" }],
    } })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand", task, payload: {
      ...payload, futureField: "unknown input",
    } })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "on_demand", task,
      payload: { ...payload, executionContinuation: { ...emptyContinuation, completedActions: [{ runId, receiptId: "x" }] } } })).toBeNull();
    expect(captureNativeTaskWakeSource({ companyId, runId, issueId, sourceVersion: "1", persistedWakeReason: "different_reason", task,
      payload: { ...payload, executionContinuation: emptyContinuation } })).toBeNull();
  });

  it("closes distinct governed Native/Human renditions and preserves pending references, summary and actual retained history", () => {
    // Pure owner-capture inputs only. These descriptors are not DB/SDK or
    // authorization proof; the independent bridge/source-reader tests own that.
    const responsibleUserId = "current-task-human", resolver = "authorized-different-human", wakeupRequestId = randomUUID();
    const interactionId = randomUUID(), sourceRunId = randomUUID(), commentId = randomUUID();
    const message = nativeContinuationCommentProjection({ id: commentId, authorType: "user", authorUserId: responsibleUserId,
      authorAgentId: null, createdByRunId: null, body: "Keep the review truthful.", createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"), deletedAt: null, sourceTrust: null });
    const base: NativeTaskContinuationCapture = { companyId, issueId, agentId, runId, responsibleUserId, wakeupRequestId,
      envelope: { version: 1, companyId, issueId, trigger: { reason: "issue_commented", interactionId: null, sourceRunId: null },
        originCommentIds: [commentId], objective: message.body, messages: [message], humanResponses: [], interactionOutcomes: [],
        completedWork: null, completedActions: [], recoveryOutcomes: [], unresolvedInteractionIds: [],
        coverage: { kind: "full_task_history", throughCommentId: commentId, summaryThroughCommentId: null } },
      commentSources: [{ input: { kind: "comment", issueId, commentId, sourceVersion: "1", contentHash: nativeContinuationMessageHash(message) }, payloadSourceSnapshot: null }],
      wake: { requestedByActorType: "user", requestedByActorId: responsibleUserId, reason: "issue_commented", originCommentIds: [commentId] } };
    const check = (capture: NativeTaskContinuationCapture) => exactNativeTaskContinuation({ value: capture.envelope,
      companyId, issueId, agentId, runId, responsibleUserId, wakeupRequestId, wakeReason: capture.wake.reason, capture });
    for (const status of ["executed", "failed", "rejected"] as const) {
      const c = structuredClone(base), interactionStatus = status === "rejected" ? "rejected" : "accepted";
      const result = status === "rejected" ? { version: 1, outcome: interactionStatus } :
        { version: 1, outcome: interactionStatus, toolAction: { version: 1, status, updatedAt: "2026-10-01T00:00:00.000Z" } };
      const humanResponse = { id: interactionId, kind: "request_confirmation", status: interactionStatus,
        resolvedByUserId: resolver, resolvedAt: "2026-10-01T00:00:00.000Z", result: { outcome: interactionStatus, reason: undefined } };
      const nativeResponse: NativeInteractionResponseEnvelope = { interactionId, kind: "request_confirmation",
        response: { status: interactionStatus, result } };
      const nativeSource = { kind: "interaction" as const, issueId, interactionId, sourceVersion: "2", contentHash: nativeSha256(nativeResponse) };
      const projection: import("./native-interaction-bridge.js").NativeGovernedInteractionContinuationCapture["projection"] = {
        version: 1, companyId, issueId, interactionId, sourceVersion: "2", nativeResponseDigest: nativeSource.contentHash,
        owner: { sourceRunId, sourceCommentId: commentId, originCommentIds: [commentId], continuationPolicy: "wake_assignee",
          resolvedByUserId: resolver, resolvedAt: humanResponse.resolvedAt, actionRequestId: randomUUID(), invocationId: randomUUID(),
          argumentsHash: "a".repeat(64), requestStatus: status,
          invocationStatus: status === "executed" ? "succeeded" : status === "rejected" ? "denied" : "failed" },
        humanResponse, interactionOutcome: { id: interactionId, kind: "request_confirmation", status: interactionStatus, result },
      };
      c.governedInteractions = [{ companyId, issueId, runId, agentId, nativeSource, nativeResponse, projection,
        continuationSource: { ...nativeSource, contentHash: nativeSha256({ rendition: "native_governed_continuation_v1", projection }) } }];
      c.envelope.trigger = { reason: "issue_commented", interactionId, sourceRunId };
      c.wake = { requestedByActorType: "user", requestedByActorId: resolver, reason: "issue_commented",
        originCommentIds: [], interaction: { interactionId, interactionKind: "request_confirmation", interactionStatus, sourceRunId } };
      c.envelope.humanResponses = [humanResponse]; c.envelope.interactionOutcomes = [projection.interactionOutcome];
      const delivery: NonNullable<NativeTaskContinuationCapture["delivery"]>["projection"] = {
        version: 1, companyId, issueId, agentId, runId, wakeupRequestId,
        idempotencyKey: `tool-action-response:${projection.owner.actionRequestId}`, sourceRunId, interactionId,
        sourceVersion: "2", interactionKind: "request_confirmation", interactionStatus,
        actionRequestIds: [projection.owner.actionRequestId], cutoff: { createdAt: "2026-10-01 00:00:01+00", actionRequestId: projection.owner.actionRequestId },
        agentMessage: { text: "Actual fixed owner delivery rendition.", source: "tool_action_review", pluginKey: null, sessionId: interactionId,
          untrustedToolResults: [{ actionRequestId: projection.owner.actionRequestId, toolName: "railway_update_variable",
            resultSummary: "Recorded outcome", error: null, declineReason: null }] },
      };
      c.delivery = { companyId, issueId, agentId, runId, wakeupRequestId, projection: delivery,
        source: { kind: "interaction", issueId, interactionId, sourceVersion: "2",
          contentHash: nativeSha256({ rendition: "native_tool_action_delivery_v1", projection: delivery }) } };

      expect(check(c)).toBe(c);
      // A new genuine Human comment is a separate trigger from recorded
      // historical review outcomes. Never borrow the historical resolver.
      const ordinary = structuredClone(c), laterCommentId = randomUUID();
      const laterMessage = {...message,id:laterCommentId,body:"A new Human question after the recorded review."};
      ordinary.envelope.messages.push(laterMessage);
      ordinary.commentSources.push({input:{kind:"comment",issueId,commentId:laterCommentId,sourceVersion:"3",
        contentHash:nativeContinuationMessageHash(laterMessage)},payloadSourceSnapshot:null});
      ordinary.envelope.trigger={reason:"issue_commented",interactionId:null,sourceRunId:null};
      ordinary.envelope.originCommentIds=[laterCommentId];ordinary.envelope.objective=laterMessage.body;
      ordinary.envelope.coverage.throughCommentId=laterCommentId;
      ordinary.wake={requestedByActorType:"user",requestedByActorId:responsibleUserId,reason:"issue_commented",originCommentIds:[laterCommentId]};
      delete ordinary.delivery;
      expect(check(ordinary)).toBe(ordinary);
      const retainedOrdinary=structuredClone(ordinary);
      retainedOrdinary.retainedSource={kind:"retained_run",runId:sourceRunId,inputDigest:"d".repeat(64),dispatchDigest:"e".repeat(64)};
      retainedOrdinary.previousContext={runId:sourceRunId,messages:[message]};
      retainedOrdinary.envelope.resumeDelta={baseRunId:sourceRunId,messages:[laterMessage]};
      expect(check(retainedOrdinary)).toBe(retainedOrdinary);
      const missingHistory=structuredClone(ordinary);delete missingHistory.governedInteractions;
      expect(check(missingHistory)).toBeNull();
      const resolverSubstitution=structuredClone(ordinary);resolverSubstitution.wake.requestedByActorId=resolver;
      expect(check(resolverSubstitution)).toBeNull();
      const graftedDelivery=structuredClone(ordinary);graftedDelivery.delivery=c.delivery;
      expect(check(graftedDelivery)).toBeNull();
      const forgedTrigger=structuredClone(ordinary);forgedTrigger.envelope.trigger.sourceRunId=sourceRunId;
      expect(check(forgedTrigger)).toBeNull();
      const wrongOrigins=structuredClone(ordinary);wrongOrigins.wake.originCommentIds=[commentId];
      expect(check(wrongOrigins)).toBeNull();
      const changedHistory=structuredClone(ordinary);changedHistory.envelope.interactionOutcomes[0]!.result={outcome:"changed"};
      expect(check(changedHistory)).toBeNull();
      const changedPrior=structuredClone(retainedOrdinary);changedPrior.envelope.resumeDelta!.baseRunId=randomUUID();
      expect(check(changedPrior)).toBeNull();
      const mixed = structuredClone(c), siblingId = randomUUID();
      const sibling: import("./native-interaction-bridge.js").NativeGovernedPendingInteractionCapture["projection"] = {
        version:1,companyId,issueId,interactionId:siblingId,sourceVersion:"2",kind:"request_confirmation",status:"pending",
        sourceRunId,sourceCommentId:commentId,originCommentIds:[commentId],actionRequestId:randomUUID(),invocationId:randomUUID(),
        argumentsHash:"b".repeat(64),requestStatus:"pending",invocationStatus:"awaiting_approval",expiresAt:new Date(Date.now()+60_000).toISOString() };
      mixed.envelope.unresolvedInteractionIds=[siblingId];
      mixed.pendingInteractions=[{companyId,issueId,agentId,runId,projection:sibling,
        source:{kind:"interaction",issueId,interactionId:siblingId,sourceVersion:"2",
          contentHash:nativeSha256({rendition:"native_governed_pending_reference_v1",projection:sibling})}}];
      expect(check(mixed)).toBe(mixed);
      const ordinaryMixed=structuredClone(ordinary);ordinaryMixed.envelope.unresolvedInteractionIds=[siblingId];
      ordinaryMixed.pendingInteractions=structuredClone(mixed.pendingInteractions);
      expect(check(ordinaryMixed)).toBe(ordinaryMixed);
      const missingSibling=structuredClone(mixed);delete missingSibling.pendingInteractions;
      expect(check(missingSibling)).toBeNull();
      const jsonbPersisted = structuredClone(c); jsonbPersisted.envelope = JSON.parse(JSON.stringify(c.envelope));
      expect(check(jsonbPersisted)).toBe(jsonbPersisted);
      expect(c.governedInteractions[0]!.nativeSource.contentHash).not.toBe(c.governedInteractions[0]!.continuationSource.contentHash);
      const finalized = structuredClone(c);
      finalized.finalizedSummary = { companyId, issueId, agentId, receiverRunId: runId, sourceRunId,
        resultId: randomUUID(), resultCanonicalSha256: "sha256:" + "f".repeat(64), resultCreatedAt: "2026-10-01T00:00:00.000Z",
        finalizationVersion: "2026-10-01T00:00:01.000Z", assessmentId: randomUUID(), decisionId: randomUUID(), decisionDigest: "a".repeat(64), decisionSnapshotHash: "d".repeat(64),
        parentReceipt: { version: 1, binding: { companyId, issueId, agentId, runId: sourceRunId, responsibleUserId },
          bootstrap: { executionInputDigest: "b".repeat(64), policy, inputs: [{ kind: "task", issueId, sourceVersion: "1", contentHash: hash }] },
          dispatches: [], additionalInputs: [], digest: "c".repeat(64) }, body: "Prior finalized low-trust summary." };
      finalized.envelope.completedWork = finalized.finalizedSummary.body;
      expect(check(finalized)).toBe(finalized);
      const changedSummary = structuredClone(finalized); changedSummary.finalizedSummary!.body = "Replaced summary bytes.";
      expect(check(changedSummary)).toBeNull();
      const changedSourceOwner = structuredClone(finalized); changedSourceOwner.finalizedSummary!.sourceRunId = randomUUID();
      expect(check(changedSourceOwner)).toBeNull();

      for (const mutate of [
        (v: NativeTaskContinuationCapture) => { v.governedInteractions![0]!.projection.owner.argumentsHash = "b".repeat(64); },
        (v: NativeTaskContinuationCapture) => { v.governedInteractions![0]!.projection.owner.requestStatus = "pending"; },
        (v: NativeTaskContinuationCapture) => { v.governedInteractions![0]!.projection.owner.resolvedByUserId = "forged-human"; },
        (v: NativeTaskContinuationCapture) => { v.envelope.humanResponses![0]!.result = result; },
        (v: NativeTaskContinuationCapture) => { v.envelope.interactionOutcomes[0]!.result = { outcome: "unowned" }; },
        (v: NativeTaskContinuationCapture) => { v.wake.interaction!.sourceRunId = randomUUID(); },
        (v: NativeTaskContinuationCapture) => { v.governedInteractions![0]!.continuationSource = v.governedInteractions![0]!.nativeSource; },
        (v: NativeTaskContinuationCapture) => { v.delivery!.projection.agentMessage!.untrustedToolResults![0]!.resultSummary = "Forged recorded result"; },
        (v: NativeTaskContinuationCapture) => { v.delivery!.projection.cutoff.actionRequestId = randomUUID(); },
        (v: NativeTaskContinuationCapture) => { delete v.delivery; },
      ]) { const changed = structuredClone(c); mutate(changed); expect(check(changed)).toBeNull(); }
    }
    const pending = structuredClone(base);
    const projection: import("./native-interaction-bridge.js").NativeGovernedPendingInteractionCapture["projection"] = {
      version: 1, companyId, issueId, interactionId, sourceVersion: "2", kind: "request_confirmation", status: "pending",
      sourceRunId, sourceCommentId: commentId, originCommentIds: [commentId], actionRequestId: randomUUID(), invocationId: randomUUID(),
      argumentsHash: "a".repeat(64), requestStatus: "pending", invocationStatus: "awaiting_approval", expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    pending.envelope.unresolvedInteractionIds = [interactionId];
    pending.pendingInteractions = [{ companyId, issueId, agentId, runId, projection,
      source: { kind: "interaction", issueId, interactionId, sourceVersion: "2",
        contentHash: nativeSha256({ rendition: "native_governed_pending_reference_v1", projection }) } }];
    expect(check(pending)).toBe(pending);
    const expired = structuredClone(pending); expired.pendingInteractions![0]!.projection.expiresAt = "2020-01-01T00:00:00.000Z";
    expired.pendingInteractions![0]!.source.contentHash = nativeSha256({ rendition: "native_governed_pending_reference_v1", projection: expired.pendingInteractions![0]!.projection });
    expect(check(expired)).toBeNull();
    // Pure rendition-only clock control. The DB reader must independently
    // authenticate this exact old capture through its parent/terminal owner.
    const historical = () => exactNativeTaskContinuation({ value: expired.envelope, companyId, issueId, agentId, runId,
      responsibleUserId, wakeupRequestId, wakeReason: expired.wake.reason, capture: expired,
      historicalPendingSources: [expired.pendingInteractions![0]!] });
    expect(historical()).toBe(expired);
    expect(check(expired)).toBeNull();
    expect(check(expired)).toBeNull();
    expect(historical()).toBe(expired);
    const differentOriginal = structuredClone(expired.pendingInteractions![0]!);
    differentOriginal.projection.actionRequestId = randomUUID();
    expect(exactNativeTaskContinuation({ value: expired.envelope, companyId, issueId, agentId, runId,
      responsibleUserId, wakeupRequestId, wakeReason: expired.wake.reason, capture: expired,
      historicalPendingSources: [differentOriginal] })).toBeNull();
    const missing = structuredClone(pending); delete missing.pendingInteractions; expect(check(missing)).toBeNull();
    const summary = structuredClone(pending);
    summary.summary = { rawTrustHash: nativeSha256(null), source: { input: { kind: "document_revision", issueId, documentId: randomUUID(), revisionId: randomUUID(), contentHash: "c".repeat(64) }, payloadSourceSnapshot: null },
      rendition: { key: "continuation-summary", title: "Continuation Summary", body: "Previous truthful low-trust result.", sourceTrust: null, updatedAt: "2026-10-01T00:00:00.000Z" } };
    summary.envelope.completedWork = summary.summary.rendition.body;
    summary.retainedSource = { kind: "retained_run", runId: sourceRunId, inputDigest: "d".repeat(64), dispatchDigest: "e".repeat(64) };
    summary.previousContext = { runId: sourceRunId, messages: [message] };
    summary.envelope.resumeDelta = { baseRunId: sourceRunId, messages: [message] };
    expect(check(summary)).toBe(summary);
    const forgedHistory = structuredClone(summary); forgedHistory.envelope.resumeDelta!.baseRunId = randomUUID(); expect(check(forgedHistory)).toBeNull();
    const droppedHistory = structuredClone(summary); droppedHistory.envelope.resumeDelta!.messages = []; expect(check(droppedHistory)).toBeNull();
  });

  it("adds only an exact server-minted approved Context closure bound to the native run and rendered markdown", () => {
    const foundationDocumentId = randomUUID(), foundationRevisionId = randomUUID();
    const contextMarkdown = "## August Works governed context\n### Approved Foundation\nStable guidance.";
    const taskInput = { kind: "task" as const, issueId, sourceVersion: "1", contentHash: hash };
    const sourceActor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId, runId, onBehalfOfUserId: "user-1" };
    const witness = captureNativeBootstrapContextWitness({ companyId, runId, agentId, issueId, actor: sourceActor, renderedMarkdown: contextMarkdown,
      manifest: { id: randomUUID(), companyId, runId, agentId, issueId, projectId: null, queryHash: hash,
        policySnapshotHash: "b".repeat(64), createdAt: new Date() },
      items: [
        { id: randomUUID(), manifestId: randomUUID(), companyId, rank: 0, sourceProvider: "august_works_tasks",
          sourceRef: `issue://${issueId}`, sourceVersion: new Date().toISOString(), contentHash: hash, payloadSourceSnapshot: snapshot() },
        { id: randomUUID(), manifestId: "manifest-placeholder", companyId, rank: 1, sourceProvider: "august_works_foundation",
          sourceRef: `foundation://${foundationDocumentId}/${foundationRevisionId}/1`, sourceVersion: foundationRevisionId,
          contentHash: "c".repeat(64), payloadSourceSnapshot: null },
      ], roots: [] });
    // The helper above rejects mismatched item/manifest IDs. Build the same
    // source from exact IDs to prove both the positive and substitution gates.
    const manifestId = randomUUID();
    const manifest = { id: manifestId, companyId, runId, agentId, issueId, projectId: null, queryHash: hash,
      policySnapshotHash: "b".repeat(64), createdAt: new Date() };
    const contextItems = [
      { id: randomUUID(), manifestId, companyId, rank: 0, sourceProvider: "august_works_tasks", sourceRef: `issue://${issueId}`,
        sourceVersion: new Date().toISOString(), contentHash: hash, payloadSourceSnapshot: snapshot() },
      { id: randomUUID(), manifestId, companyId, rank: 1, sourceProvider: "august_works_foundation",
        sourceRef: `foundation://${foundationDocumentId}/${foundationRevisionId}/1`, sourceVersion: foundationRevisionId,
        contentHash: "c".repeat(64), payloadSourceSnapshot: null },
    ];
    const exactWitness = captureNativeBootstrapContextWitness({ companyId, runId, agentId, issueId, actor: sourceActor, renderedMarkdown: contextMarkdown,
      manifest, items: contextItems, roots: [] });
    expect(witness).toBeNull();
    const sourceSet = buildNativeBootstrapSourceSet({ companyId, runId, agentId, issueId, renderedMarkdown,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown, "utf8").digest("hex"),
      references: [{ kind: "task", id: issueId }],
      candidates: [{ kind: "task", id: issueId, input: taskInput, payloadSourceSnapshot: snapshot() }], runtimeInputs: [],
      contextManifestIds: [{ companyId, contextManifestId: manifestId }], governedContextMarkdown: contextMarkdown,
      contextWitness: exactWitness, rolePackInputs: [], unsupportedInputPresent: false });
    expect(sourceSet?.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "context", manifestId }),
      expect.objectContaining({ kind: "task", issueId }),
    ]));
    const contextOwnerFingerprint = createHash("sha256").update(JSON.stringify({
      manifest: { id: manifest.id, companyId: manifest.companyId, runId: manifest.runId, agentId: manifest.agentId,
        issueId: manifest.issueId, projectId: manifest.projectId, queryHash: manifest.queryHash,
        policySnapshotHash: manifest.policySnapshotHash, createdAt: manifest.createdAt.toISOString() },
      items: contextItems.map(item => ({ id: item.id, provider: item.sourceProvider, ref: item.sourceRef,
        version: item.sourceVersion, contentHash: item.contentHash, snapshot: item.payloadSourceSnapshot })), roots: [],
    }), "utf8").digest("hex");
    const contextSource = sourceSet?.inputs.find(value => value.kind === "context" && value.manifestId === manifestId);
    if (!contextSource || contextSource.kind !== "context") throw new Error("expected exact context source");
    expect(contextSource.contentHash).toBe(contextOwnerFingerprint);
    expect(sourceSet?.policy.foundationRevisionIds).toEqual([foundationRevisionId]);
    const combinedFabricContext = `## Pinned execution inventory\nPolicies: budget_hard_stop\n\n${contextMarkdown}`;
    const combinedContextSourceSet = buildNativeBootstrapSourceSet({ companyId, runId, agentId, issueId, renderedMarkdown,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown, "utf8").digest("hex"),
      references: [{ kind: "task", id: issueId }],
      candidates: [{ kind: "task", id: issueId, input: taskInput, payloadSourceSnapshot: snapshot() }], runtimeInputs: [],
      contextManifestIds: [{ companyId, contextManifestId: manifestId }], governedContextMarkdown: combinedFabricContext,
      contextWitnessMarkdown: contextMarkdown, contextWitness: exactWitness, rolePackInputs: [], unsupportedInputPresent: false });
    expect(combinedContextSourceSet?.inputs).toContainEqual(expect.objectContaining({ kind: "context", manifestId }));
    expect(buildNativeBootstrapSourceSet({ companyId, runId, agentId, issueId, renderedMarkdown,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown, "utf8").digest("hex"),
      references: [{ kind: "task", id: issueId }], candidates: [{ kind: "task", id: issueId, input: taskInput,
        payloadSourceSnapshot: snapshot() }], runtimeInputs: [], contextManifestIds: [{ companyId, contextManifestId: manifestId }],
      governedContextMarkdown: combinedFabricContext, contextWitnessMarkdown: `${contextMarkdown} changed`,
      contextWitness: exactWitness, rolePackInputs: [], unsupportedInputPresent: false })).toBeNull();
    expect(buildNativeBootstrapSourceSet({ companyId, runId, agentId, issueId, renderedMarkdown,
      renderedMarkdownDigest: createHash("sha256").update(renderedMarkdown, "utf8").digest("hex"),
      references: [{ kind: "task", id: issueId }], candidates: [{ kind: "task", id: issueId, input: taskInput,
        payloadSourceSnapshot: snapshot() }], runtimeInputs: [], contextManifestIds: [{ companyId, contextManifestId: manifestId }],
      governedContextMarkdown: `${contextMarkdown} changed`, contextWitness: exactWitness, rolePackInputs: [], unsupportedInputPresent: false })).toBeNull();
  });
});

describe("LCA-05 explicit native work mode", () => {
  it.each(["standard", "planning", "ask"])("title and description cannot override %s mode", (workMode) => {
    for (const text of ["Inspect files", "Making a plan", "Create a report", "Research proposal", "Implement now; no plan needed"]) {
      const input = buildNativeExecutionInput({
        companyId: "10000000-0000-4000-8000-000000000001",
        runId: "50000000-0000-4000-8000-000000000005",
        agentId: "30000000-0000-4000-8000-000000000003",
        issue: { id: "20000000-0000-4000-8000-000000000002", identifier: "MODE-1", title: text, description: text, workMode },
        taskPrompt: text,
        workspace: { id: "50000000-0000-4000-8000-000000000005", cwd: "/workspace", repoUrl: null, repoRef: null, branchName: null },
        normalizedSessionId: null,
        planningContext: workMode === "planning" ? { documentId: null, baseRevisionId: null, baseRevisionNumber: 0, markdown: "", sha256: "a".repeat(64), reviewContext: {} } : null,
        completionContract: { id: "70000000-0000-4000-8000-000000000007", sha256: `sha256:${"a".repeat(64)}`, schemaVersion: "paperclip.run-result.v1", contract: { revision: "1", objective: "Deliver the requested work", criteria: [{ id: "output", requirement: "Deliver the requested work" }] } },
        runtimeContext: nativeRuntimeContextFixture(),
      });
      expect(input.task.workMode).toBe(workMode);
      expect(input.executionMode).toBe(workMode === "planning" ? "plan" : "default");
      expect(input.task.title).toBe(text);
    }
  });

  it("places governed context between runtime controls and the current task", () => {
    const governedContext = [
      "## August Works governed context",
      "### Approved Foundation",
      "- **Strategy** [source=foundation; provider=august_works_foundation; trust=high; sensitivity=internal]",
      "  - Focus on durable customer value.",
    ].join("\n");
    const currentTask = "Prepare the launch recommendation.";

    const input = buildNativeExecutionInput({
      companyId: "10000000-0000-4000-8000-000000000001",
      runId: "50000000-0000-4000-8000-000000000005",
      agentId: "30000000-0000-4000-8000-000000000003",
      issue: {
        id: "20000000-0000-4000-8000-000000000002",
        identifier: "CTX-1",
        title: "Launch recommendation",
        description: null,
        workMode: "standard",
      },
      taskPrompt: currentTask,
      governedContextMarkdown: governedContext,
      workspace: {
        id: "40000000-0000-4000-8000-000000000004",
        cwd: "/workspace",
        repoUrl: null,
        repoRef: null,
        branchName: null,
      },
      normalizedSessionId: null,
      provider: "codex",
      completionContract: {
        id: "70000000-0000-4000-8000-000000000007",
        sha256: `sha256:${"a".repeat(64)}`,
        schemaVersion: "paperclip.run-result.v1",
        contract: {
          revision: "1",
          objective: currentTask,
          criteria: [{ id: "output", requirement: "Return the recommendation." }],
        },
      },
      runtimeContext: nativeRuntimeContextFixture(),
    });

    expect(input.task.prompt).toContain(governedContext);
    expect(input.task.prompt.indexOf(governedContext)).toBeLessThan(
      input.task.prompt.indexOf(currentTask),
    );
    expect(input.task.prompt).toContain(
      "Use Paperclip's request_human_input for durable task questions.",
    );
    expect(
      input.task.prompt.indexOf(
        "Use Paperclip's request_human_input for durable task questions.",
      ),
    ).toBeLessThan(input.task.prompt.indexOf(governedContext));
  });

});

describe("native execution input external-chat framing", () => {
  it.each([false, true])(
    "projects the authoritative selected answer into an attested native chat prompt (resumed: %s)",
    (resumedSession) => {
      const interactionId = "80000000-0000-4000-8000-000000000008";
      const sourceRunId = "90000000-0000-4000-8000-000000000009";
      const wakePayload = {
        reason: "issue_commented",
        externalChatProvider: "telegram",
        externalChatExecutionBound: true,
        interactionId,
        sourceRunId,
        interactionKind: "ask_user_questions",
        interactionStatus: "answered",
        externalInteractionContinuation: true,
        issue: {
          id: "20000000-0000-4000-8000-000000000002",
          workMode: "standard",
          status: "in_review",
        },
        externalChatQuestionResponse: {
          schema: "paperclip.external_chat_question_response.v1",
          interactionId,
          sourceRunId,
          responseDeliveryId: "10000000-0000-4000-8000-000000000011",
          sourceCommentId: "10000000-0000-4000-8000-000000000012",
          endpointId: "10000000-0000-4000-8000-000000000013",
          conversationId: "10000000-0000-4000-8000-000000000014",
          bindingSha256: "a".repeat(64),
        },
        commentIds: ["10000000-0000-4000-8000-000000000012"],
        latestCommentId: "10000000-0000-4000-8000-000000000012",
        comments: [
          {
            id: "10000000-0000-4000-8000-000000000012",
            body: "Ask for a color, then tell me the selected color.",
          },
        ],
        commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
        fallbackFetchNeeded: false,
      };
      const args: Parameters<typeof buildNativeExecutionInput>[0] = {
        companyId: "10000000-0000-4000-8000-000000000001",
        runId: "50000000-0000-4000-8000-000000000005",
        agentId: "30000000-0000-4000-8000-000000000003",
        issue: {
          id: "20000000-0000-4000-8000-000000000002",
          identifier: "CHAT-5",
          title: "Old exact-output request",
          description: null,
          workMode: "standard",
        },
        taskPrompt:
          "Continue the user's original request with their selected answer.",
        initialCommunicationGuidance: "Initial Slack communication preferences.",
        wakePayload,
        resumedSession,
        workspace: {
          id: "50000000-0000-4000-8000-000000000005",
          cwd: "/workspace",
          repoUrl: null,
          repoRef: null,
          branchName: null,
        },
        normalizedSessionId: "60000000-0000-4000-8000-000000000006",
        provider: "codex",
        completionContract: {
          id: "70000000-0000-4000-8000-000000000007",
          sha256: `sha256:${"a".repeat(64)}`,
          schemaVersion: "paperclip.run-result.v1",
          contract: {
            revision: "1",
            objective: "Answer the user's selected choice",
            criteria: [
              { id: "answer", requirement: "Return the actual color." },
            ],
          },
        },
        runtimeContext: nativeRuntimeContextFixture(),
        interactionResponses: [
          {
            interactionId,
            kind: "ask_user_questions",
            response: {
              status: "answered",
              result: {
                version: 1,
                answers: [{ questionId: "color", optionIds: ["amber"] }],
                summaryMarkdown:
                  "Resolved questions and answers:\n- Choose a color: Amber",
              },
            },
          },
        ],
      };
      const input = buildNativeExecutionInput(args);
      expect(input.initialCommunicationGuidance).toBe("Initial Slack communication preferences.");
      // The runtime adds this only after deciding whether provider recovery succeeded.
      expect(input.task.prompt).not.toContain("Initial Slack communication preferences.");
      expect(input.task.title).toBe("External chat follow-up");
      expect(input.task.prompt).toContain("Amber");
      expect(input.task.prompt).not.toContain("## Questions that need a user response");
      expect(input.task.prompt).toContain(
        "semantic completion summary is the user-visible final answer",
      );
      expect(input.task.prompt).not.toContain(
        "including marking the task done",
      );
      expect(input.task.prompt.indexOf("Choose a color: Amber")).toBeLessThan(
        input.task.prompt.indexOf(
          "Ask for a color, then tell me the selected color.",
        ),
      );
      expect(wakePayload).not.toHaveProperty("questionResponse");

      const mixedModalSummary = formatDurableQuestionResponseSummary({
        id: interactionId,
        kind: "ask_user_questions",
        status: "answered",
        sourceRunId,
        payload: {
          version: 1,
          questions: [
            {
              id: "environment",
              prompt: "Choose an environment",
              selectionMode: "single",
              options: [
                { id: "maple", label: "Maple" },
                { id: "cedar", label: "Cedar" },
              ],
            },
            {
              id: "label",
              prompt: "Enter the verification label",
              selectionMode: "single",
              options: [
                {
                  id: "custom",
                  label: "Custom label",
                  freeText: true,
                },
              ],
            },
          ],
        },
        result: {
          version: 1,
          answers: [
            { questionId: "environment", optionIds: ["maple"] },
            {
              questionId: "label",
              optionIds: [],
              otherText: "amber compass 93",
            },
          ],
          summaryMarkdown: null,
        },
      } as unknown as AskUserQuestionsInteraction);
      const mixedModal = buildNativeExecutionInput({
        ...args,
        wakePayload: {
          ...wakePayload,
          comments: [
            {
              ...wakePayload.comments[0],
              body: "Ask a NEW environment and verification-label question.",
            },
          ],
        },
        interactionResponses: [
          {
            interactionId,
            kind: "ask_user_questions",
            response: {
              status: "answered",
              result: {
                version: 1,
                answers: [
                  { questionId: "environment", optionIds: ["maple"] },
                  {
                    questionId: "label",
                    optionIds: [],
                    otherText: "amber compass 93",
                  },
                ],
                summaryMarkdown: mixedModalSummary,
              },
            },
          },
        ],
      });
      expect(mixedModalSummary).toContain("Maple");
      expect(mixedModalSummary).toContain("amber compass 93");
      expect(mixedModal.task.prompt.indexOf("Maple")).toBeLessThan(
        mixedModal.task.prompt.indexOf("Ask a NEW environment"),
      );
      expect(mixedModal.task.prompt.indexOf("amber compass 93")).toBeLessThan(
        mixedModal.task.prompt.indexOf("Ask a NEW environment"),
      );
      expect(mixedModal.task.prompt).toContain(
        "only the answered questions listed above are resolved",
      );
      const unbound = buildNativeExecutionInput({
        ...args,
        interactionResponses: [
          {
            ...args.interactionResponses![0]!,
            interactionId: "10000000-0000-4000-8000-000000000019",
          },
        ],
      });
      expect(unbound.task.title).toBe("Old exact-output request");
      expect(unbound.task.prompt).not.toContain(
        "Native external-chat questions",
      );
      const earlierInteractionId = "10000000-0000-4000-8000-000000000020";
      const sequential = buildNativeExecutionInput({
        ...args,
        interactionResponses: [
          {
            interactionId: earlierInteractionId,
            kind: "ask_user_questions",
            response: {
              status: "answered",
              result: {
                version: 1,
                answers: [{ questionId: "shape", optionIds: ["circle"] }],
                summaryMarkdown: "Choose a shape: Circle",
              },
            },
          },
          ...args.interactionResponses!,
        ],
      });
      expect(sequential.task.title).toBe("External chat follow-up");
      expect(sequential.task.prompt).toContain("Circle");
      expect(sequential.task.prompt).toContain("Amber");
      expect(sequential.task.prompt).not.toContain("## Questions that need a user response");
      expect(
        sequential.task.prompt.indexOf("Choose a shape: Circle"),
      ).toBeLessThan(sequential.task.prompt.indexOf("Choose a color: Amber"));
      expect(
        sequential.interactionResponses.map(
          (response) => response.interactionId,
        ),
      ).toEqual([earlierInteractionId, interactionId]);
      expect(wakePayload).not.toHaveProperty("questionResponse");
    },
  );
  it.each([false, true])(
    "uses neutral framing and real question tools for authenticated overflow chat (resumed: %s)",
    (resumedSession) => {
      const staleRootTitle = "Reply with exactly STALE-OVERFLOW-MARKER";
      const input = buildNativeExecutionInput({
        companyId: "10000000-0000-4000-8000-000000000001",
        runId: "50000000-0000-4000-8000-000000000005",
        issue: {
          id: "20000000-0000-4000-8000-000000000002",
          identifier: "CHAT-5",
          title: staleRootTitle,
          description: "Started from Discord.",
          workMode: "standard",
        },
        taskPrompt: `Paperclip task context:\n- Title: ${JSON.stringify(staleRootTitle)}`,
        resumedSession,
        wakePayload: {
          reason: "External chat message received",
          externalChatProvider: "discord",
          checkedOutByHarness: true,
          issue: {
            id: "20000000-0000-4000-8000-000000000002",
            identifier: "CHAT-5",
            title: staleRootTitle,
            description: "Started from Discord.",
            descriptionTruncated: false,
            status: "in_progress",
            workMode: "standard",
          },
          commentWindow: {
            requestedCount: 2,
            includedCount: 1,
            missingCount: 1,
          },
          commentIds: ["comment-overflow-1", "comment-overflow-2"],
          latestCommentId: "comment-overflow-2",
          comments: [
            {
              id: "comment-overflow-2",
              issueId: "20000000-0000-4000-8000-000000000002",
              body: "Answer both queued messages.",
              bodyTruncated: false,
              authorType: "user",
            },
          ],
          fallbackFetchNeeded: true,
        },
        agentId: "30000000-0000-4000-8000-000000000003",
        workspace: {
          id: "50000000-0000-4000-8000-000000000005",
          cwd: "/workspace",
          repoUrl: null,
          repoRef: null,
          branchName: null,
        },
        normalizedSessionId: "60000000-0000-4000-8000-000000000006",
        provider: "codex",
        completionContract: {
          id: "70000000-0000-4000-8000-000000000007",
          sha256: `sha256:${"a".repeat(64)}`,
          schemaVersion: "paperclip.run-result.v1",
          contract: {
            revision: "1",
            objective: "Respond to all pending comments in order",
            criteria: [
              {
                id: "objective",
                requirement: "Read every current wake comment.",
              },
            ],
          },
        },
        runtimeContext: nativeRuntimeContextFixture(),
      });

      expect(input.task.title).toBe("External chat follow-up");
      expect(input.task.description).toBeNull();
      expect(input.task.prompt).toContain("read_current_wake_comments");
      expect(input.task.prompt).toContain(staleRootTitle);
    },
  );

  it.each([false, true])(
    "keeps GitHub's task-only files and service-owned recovery navigation in the closed native input (resumed: %s)",
    (resumedSession) => {
      const args: Parameters<typeof buildNativeExecutionInput>[0] = {
        companyId: "10000000-0000-4000-8000-000000000001",
        runId: "50000000-0000-4000-8000-000000000005",
        issue: {
          id: "20000000-0000-4000-8000-000000000002",
          identifier: "CHAT-5",
          title: "Send a file",
          description: null,
          workMode: "standard",
        },
        taskPrompt: "Answer the current line review.",
        wakePayload: {
          reason: "External chat message received",
          externalChatProvider: "github",
          checkedOutByHarness: true,
          issue: {
            id: "20000000-0000-4000-8000-000000000002",
            workMode: "standard",
          },
          comments: [
            {
              id: "review-comment",
              body: "Make a text file and attach it here.",
            },
          ],
          commentIds: ["review-comment"],
          latestCommentId: "review-comment",
          commentWindow: {
            requestedCount: 1,
            includedCount: 1,
            missingCount: 0,
          },
          fallbackFetchNeeded: false,
        },
        resumedSession,
        agentId: "30000000-0000-4000-8000-000000000003",
        workspace: {
          id: "50000000-0000-4000-8000-000000000005",
          cwd: "/workspace",
          repoUrl: null,
          repoRef: null,
          branchName: null,
        },
        normalizedSessionId: "60000000-0000-4000-8000-000000000006",
        provider: "codex",
        completionContract: {
          id: "70000000-0000-4000-8000-000000000007",
          sha256: `sha256:${"a".repeat(64)}`,
          schemaVersion: "paperclip.run-result.v1",
          contract: {
            revision: "1",
            objective: "Prepare a file",
            criteria: [
              { id: "objective", requirement: "Describe actual delivery." },
            ],
          },
        },
        runtimeContext: nativeRuntimeContextFixture(),
      };
      const input = buildNativeExecutionInput(args);
      expect(input.task.prompt).toContain(
        "This GitHub App connection cannot upload file bytes into comments or review threads",
      );
      expect(input.task.prompt).toContain(
        "do not say it is attached, displayed, downloadable, or available to open in this provider conversation",
      );
      expect(input.task.prompt).toContain(
        "Preparation does not confirm provider delivery",
      );
      expect(input.task.prompt).toContain(
        "Paperclip owns recovery navigation for unavailable GitHub attachments",
      );
      expect(input.task.prompt).toContain(
        "after an accepted response, only when the current source remains authorized and a safe configured Board URL is available",
      );
      expect(input.task.prompt).toContain(
        "A task URL missing from your prompt or tool results is not evidence that no task link can be provided",
      );
      expect(input.task.prompt).toContain(
        "Do not invent a URL or promise that a link will appear",
      );
      expect(input.task.prompt).toContain(
        "Briefly explain the unavailable input and ask the user to attach it directly to this Paperclip task or paste the needed text",
      );
      expect(input.task.prompt).toContain(
        "Never infer the file's contents or substitute an older file",
      );

      const wake = args.wakePayload as Record<string, unknown>;
      for (const patch of [
        { externalChatProvider: "slack" },
        { externalChatProvider: "discord" },
        { externalChatProvider: "telegram" },
        { externalChatProvider: "microsoft-teams" },
        { externalChatProvider: null },
        { externalChatProvider: "GitHub" },
        { checkedOutByHarness: false },
      ]) {
        const unrelated = buildNativeExecutionInput({
          ...args,
          wakePayload: { ...wake, ...patch },
        });
        expect(unrelated.task.prompt).not.toContain(
          "Paperclip owns recovery navigation for unavailable GitHub attachments",
        );
      }
    },
  );
  it.each([
    { provider: "codex", resumedSession: false },
    { provider: "codex", resumedSession: true },
    { provider: "acpx", resumedSession: false },
    { provider: "acpx", resumedSession: true },
    { provider: "opencode", resumedSession: false },
    { provider: "opencode", resumedSession: true },
  ] as const)("keeps question documentation in the tool on $provider (resumed: $resumedSession)", ({ provider, resumedSession }) => {
    const input = buildNativeExecutionInput({
      companyId: "10000000-0000-4000-8000-000000000001",
      runId: "50000000-0000-4000-8000-000000000005",
      agentId: "30000000-0000-4000-8000-000000000003",
      issue: { id: "20000000-0000-4000-8000-000000000002", identifier: "QA-1", title: "Welcome", description: null, workMode: "standard" },
      taskPrompt: "Ask whether the welcome should sound warm or formal before writing it.",
      workspace: { id: "40000000-0000-4000-8000-000000000004", cwd: "/workspace", repoUrl: null, repoRef: null, branchName: null },
      normalizedSessionId: resumedSession ? "60000000-0000-4000-8000-000000000006" : null,
      provider, resumedSession,
      acpxAgent: "claude",
      model: provider === "acpx" ? "claude-sonnet-5" : provider === "opencode" ? "openai/gpt-5.5" : "gpt-5.6-sol",
      completionContract: {
        id: "70000000-0000-4000-8000-000000000007", sha256: `sha256:${"a".repeat(64)}`, schemaVersion: "paperclip.run-result.v1",
        contract: { revision: "1", objective: "Write a welcome after the user's answer", criteria: [{ id: "objective", requirement: "Use the selected tone" }] },
      },
      runtimeContext: nativeRuntimeContextFixture(),
    });
    expect(input.provider).toMatchObject(provider === "acpx"
      ? { kind: "acpx", permissionMode: "approve-all" }
      : provider === "opencode" ? { kind: "opencode", permissionMode: "allow" }
      : { kind: "codex", approvalPolicy: "never" });
    expect(input.task.prompt).not.toContain("## Questions that need a user response");
    expect(input.task.prompt).toContain("Use Paperclip's request_human_input for durable task questions.");
    expect(input.task.prompt).not.toContain("payload.questionSet");
  });

});


describe("follow-up context size", () => {
  it("keeps old messages out of resume deltas while retaining scoped human answers", () => {
    const message = (id: string, body: string) => ({
      id, body, authorType: "user", authorId: "board", createdAt: "2026-09-17T00:00:00Z",
      updatedAt: "2026-09-17T00:00:00Z", deleted: false, sourceTrust: null,
    });
    const oldBody = "PREVIOUS_TASK_TEXT ".repeat(1000);
    const newBody = "Actually, save the plan first.";
    const answerText = "No budget. Wait for my approval.";
    const continuation: ExecutionContinuationEnvelope = {
      version: 1, companyId: "company", issueId: "issue", objective: "Welcome",
      trigger: { reason: "issue_commented", interactionId: "answer-id", sourceRunId: null },
      originCommentIds: ["new"], messages: [message("old", oldBody), message("new", newBody)],
      resumeDelta: { baseRunId: "previous-run", messages: [message("new", newBody)] },
      humanResponses: [{ id: "answer-id", kind: "ask_user_questions", status: "answered",
        resolvedByUserId: "board", resolvedAt: "2026-09-17T00:01:00Z",
        result: { answers: [{ questionId: "scope", optionIds: [], otherText: answerText }] } }],
      interactionOutcomes: [], completedWork: null, unresolvedInteractionIds: [],
      coverage: { kind: "full_task_history", throughCommentId: "new", summaryThroughCommentId: null },
    };
    const wake = { executionContinuation: continuation };
    const fresh = renderPaperclipWakePrompt(wake);
    const resumed = renderPaperclipWakePrompt(wake, { resumedSession: true });
    const contract = buildNativeCompletionContract({ title: "Welcome", description: oldBody }, {
      immediateRequest: newBody, humanResponseId: "answer-id",
    });
    expect(fresh).toContain(oldBody);
    expect(resumed).not.toContain("PREVIOUS_TASK_TEXT");
    expect(resumed.split(newBody)).toHaveLength(2);
    expect(resumed.split(answerText)).toHaveLength(2);
    expect(resumed).toContain("earlier history remains in this session");
    expect(JSON.stringify(contract)).not.toContain(oldBody);
    expect(JSON.stringify(contract)).not.toContain(answerText);
    expect(resumed.length + JSON.stringify(contract).length).toBeLessThan(fresh.length);
  });
});
