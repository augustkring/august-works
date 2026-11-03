import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { heartbeatRuns, issues, issueComments, issueExecutionDecisions, type Db } from "@paperclipai/db";
import { nativeRunInputSourceReceiptSchema, type NativePayloadSourceInput } from "@paperclipai/shared";
import type { NativePayloadSourceSet } from "./native-runtime/native-execution-input.js";
import { nativeSha256, nativeCallApiResultEnvelope } from "./native-runtime/canonical.js";
import type { NativeModelOutputCapture } from "./native-runtime/native-execution-input.js";
import type { AuthorizationActor } from "./authorization.js";
import { captureNativeStageContinuationOwner, captureNativeStageOrigin } from "./native-stage-wake-source.js";
import { parseIssueExecutionState, isApprovalReviewComment, applyIssueExecutionPolicyTransition, normalizeIssueExecutionPolicy } from "./issue-execution-policy.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const NATIVE_STAGE_COMMENT_OPERATION = "POST /api/issues/{id}/comments";
export const nativeStageCommentApiCallSchema = z.object({
  operationId: z.literal(NATIVE_STAGE_COMMENT_OPERATION),
  pathParams: z.object({ id: z.string().uuid() }).strict(),
  body: z.object({ body: z.string().min(1).max(16_000) }).strict(),
}).strict();
export function nativeStageCommentApiJsonSchema(issueId: string) {
  const schema = z.toJSONSchema(nativeStageCommentApiCallSchema) as Record<string, unknown>;
  delete schema.$schema;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const paths = properties.pathParams.properties as Record<string, unknown>;
  paths.id = { type: "string", const: issueId };
  return schema;
}

/** Ordinary tools retain their original object and exact catalog bytes. */
export function nativeStageCommentApiToolDefinition(tool:Record<string,unknown>,issueId:string|null):Record<string,unknown> {
  return issueId===null ? tool : {...tool,
    description:`${tool.description} This declared Stage Reviewer may approve the current Task by posting a body-only comment beginning with ## Review: APPROVED. Ordinary comments are unavailable through this decision profile.`,
    inputSchema:{type:"object",oneOf:[tool.inputSchema,nativeStageCommentApiJsonSchema(issueId)]}};
}

/** Discovery is advisory: its prepared source set predates the immutable Run
 * receipt. Calls and HTTP effects independently require the real receipt. */
export async function nativeStageCommentApiEligible(db: Db | Transaction, input: {
  companyId: string; issueId: string; runId: string; agentId: string;
  preparedSourceSet?: NativePayloadSourceSet;
}): Promise<boolean> {
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,input.issueId))).limit(1);
  const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),
    eq(heartbeatRuns.id,input.runId),eq(heartbeatRuns.agentId,input.agentId),eq(heartbeatRuns.nativeIssueId,input.issueId),
    eq(heartbeatRuns.runtimeMode,"native"),eq(heartbeatRuns.status,"running"))).limit(1);
  if (!task || !run?.responsibleUserId || task.hiddenAt || task.status !== "in_review" || task.assigneeAgentId !== input.agentId || task.executionRunId !== run.id) return false;
  const context = object(run.contextSnapshot);
  const actor:AuthorizationActor={type:"agent",source:"agent_jwt",companyId:run.companyId,agentId:run.agentId,
    runId:run.id,onBehalfOfUserId:run.responsibleUserId};
  // This current owner predates the input receipt and does not render or copy
  // continuation messages. Operational coalesced wakeReason is not authority.
  const owner=await captureNativeStageContinuationOwner(db,{companyId:input.companyId,issueId:input.issueId,receiver:run,reader:actor});
  if(!owner || owner.trigger.runId!==run.id || owner.trigger.agentId!==run.agentId ||
    owner.trigger.responsibleUserId!==run.responsibleUserId || object(context.paperclipWake).reason!==owner.trigger.reason)return false;
  const receipt = nativeRunInputSourceReceiptSchema.safeParse(object(run.runnerProfileJson).nativeInputSourceReceipt);
  if (!input.preparedSourceSet && (!receipt.success || receipt.data.binding.companyId !== input.companyId ||
      receipt.data.binding.issueId !== input.issueId || receipt.data.binding.runId !== run.id ||
      receipt.data.binding.agentId !== run.agentId || receipt.data.binding.responsibleUserId !== run.responsibleUserId)) return false;
  if (!input.preparedSourceSet && receipt.success) {
    const [checked]=await db.execute<{valid:boolean}>(sql`select ${JSON.stringify(receipt.data)}::jsonb->>'digest' =
      encode(sha256(convert_to((${JSON.stringify(receipt.data)}::jsonb-'digest')::text,'UTF8')),'hex') as valid`);
    if(checked?.valid!==true)return false;
  }
  const sources = input.preparedSourceSet ?? (receipt.success ? receipt.data.bootstrap : null);
  const stages = sources?.inputs.filter((source):source is Extract<NativePayloadSourceInput,{kind:"native_task_wake"}>=>source.kind==="native_task_wake" && source.runId===run.id && source.issueId===task.id) ?? [];
  if (stages.length !== 1 || stages[0]!.contentHash !== nativeSha256(context.paperclipWake)) return false;
  const tasks=sources?.inputs.filter((source):source is Extract<NativePayloadSourceInput,{kind:"task"}>=>
    source.kind==="task" && source.issueId===task.id) ?? [];
  const captured=object(object(run.runnerProfileJson).nativeBootstrapTaskSource);
  if(tasks.length!==1 || !isDeepStrictEqual(captured.input,tasks[0]) ||
    !isDeepStrictEqual(captured.payloadSourceSnapshot,task.payloadSourceSnapshot) || task.payloadSourceSnapshotInvalidated)return false;
  const [literal]=await db.execute<{hash:string}>(sql`select public.aw_native_payload_body_hash('issue',to_jsonb(${issues})) as hash
    from ${issues} where ${issues.companyId}=${input.companyId} and ${issues.id}=${input.issueId}`);
  if(literal?.hash!==tasks[0]!.contentHash)return false;
  const {authorizationService,canActorReadIssuePrivacy}=await import("./authorization.js");
  for(const actor of [{type:"board",source:"session",userId:run.responsibleUserId},
    {type:"agent",source:"agent_jwt",companyId:run.companyId,agentId:run.agentId,runId:run.id,onBehalfOfUserId:run.responsibleUserId}] as AuthorizationActor[]) {
    const decision=await authorizationService(db).decide({actor,action:"issue:read",resource:{type:"issue",companyId:task.companyId,issueId:task.id,projectId:task.projectId},enforceResponsibleUserIntersection:true});
    if(!decision.allowed || !await canActorReadIssuePrivacy(db,actor,task))return false;
  }
  return true;
}

/** Reuse the actual comment route parser and policy projector. A body that
 * would merely create an ordinary comment must cause zero HTTP dispatches. */
export async function nativeStageCommentApiDecisionCurrent(db:Db|Transaction,input:{companyId:string;issueId:string;runId:string;agentId:string;
  arguments:unknown}):Promise<boolean>{
  const parsed=nativeStageCommentApiCallSchema.safeParse(input.arguments);
  if(!parsed.success || parsed.data.pathParams.id!==input.issueId || !isApprovalReviewComment(parsed.data.body.body) ||
    !await nativeStageCommentApiEligible(db,input))return false;
  const [task]=await db.select().from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,input.issueId))).limit(1);
  if(!task)return false;
  try {
    const policy=normalizeIssueExecutionPolicy(task.executionPolicy ?? null);
    const transition=applyIssueExecutionPolicyTransition({issue:task,policy,requestedStatus:"done",requestedAssigneePatch:{},
      actor:{agentId:input.agentId,userId:null},commentBody:parsed.data.body.body});
    return transition.decision?.outcome==="approved";
  }catch{return false;}
}

export type NativeManagedStageCommentCapture = {
  operationId: typeof NATIVE_STAGE_COMMENT_OPERATION;
  callId: string; argumentsHash: string; resultDigest: string; commentId: string;
  transitionHash: string; apiReceiptHash: string; outputCapture: NativeModelOutputCapture;
};

/** Select the actual committed route acknowledgement; this is not a fresh
 * Stage grant after the approval changed the Task source. */
export async function readNativeManagedStageCommentCapture(db: Db | Transaction,input:{companyId:string;issueId:string;runId:string;
  agentId:string;callId:string;argumentsHash:string;result:unknown;outputCapture:NativeModelOutputCapture;reader?:AuthorizationActor;
}):Promise<NativeManagedStageCommentCapture> {
  const [task]=await db.select().from(issues).where(and(eq(issues.companyId,input.companyId),eq(issues.id,input.issueId))).limit(1).for("share");
  if(!task || task.hiddenAt)throw new Error("native_stage_comment_task_unavailable");
  const [run]=await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,input.companyId),eq(heartbeatRuns.id,input.runId),
    eq(heartbeatRuns.agentId,input.agentId),eq(heartbeatRuns.nativeIssueId,input.issueId),eq(heartbeatRuns.runtimeMode,"native"))).limit(1).for("share");
  const key=createHash("sha256").update(input.callId).digest("hex"),api=object(object(object(run?.resultJson).apiToolReceipts)[key]);
  const transition=object(object(object(run?.resultJson).nativeStagePolicyTransitions)[key]),effect=object(transition.effect);
  const response=object(input.result),data=object(response.data),capture=input.outputCapture,use=capture.managedOpenCodeToolUse;
  const digest=nativeSha256(nativeCallApiResultEnvelope(input.callId,input.result));
  const {operationId:_operationId,...publicResult}=object(api.result);
  if(!run?.responsibleUserId || capture.dispatch.kind!=="worker_model_dispatch" || capture.runId!==run.id || use?.toolName!=="call_api" || use.callId!==input.callId || use.argumentsHash!==input.argumentsHash ||
    api.operationId!==NATIVE_STAGE_COMMENT_OPERATION || api.state!=="completed" || api.method!=="POST" || api.pathAndQuery!==`/api/issues/${input.issueId}/comments` ||
    api.callId!==input.callId || api.argumentsHash!==input.argumentsHash || api.providerResultDigest!==digest ||
    !isDeepStrictEqual({...publicResult,apiOperationId:NATIVE_STAGE_COMMENT_OPERATION},input.result) ||
    response.ok!==true || response.status!==201 || response.apiOperationId!==NATIVE_STAGE_COMMENT_OPERATION ||
    typeof data.id!=="string" || data.companyId!==input.companyId || data.issueId!==input.issueId || data.createdByRunId!==run.id ||
    transition.commentId!==data.id || transition.runId!==run.id || transition.agentId!==run.agentId || transition.responsibleUserId!==run.responsibleUserId ||
    effect.callId!==api.callId || effect.operationId!==api.operationId || effect.apiReceiptDigest!==api.digest || effect.bodyHash!==api.bodyHash ||
    !["turnId","dispatchId","eventSeq","attempt","method","pathAndQuery"].every(field=>effect[field]===api[field]))throw new Error("native_stage_comment_result_unavailable");
  const {nativeRunInputSourceReceiptPrefixMatches}=await import("./native-stage-task-body-source.js");
  if(!await nativeRunInputSourceReceiptPrefixMatches(db,{receipt:object(run.runnerProfileJson).nativeInputSourceReceipt,
    originalDigest:transition.originalReceiptDigest,dispatchCount:transition.originalDispatchCount,
    additionalInputCount:transition.originalAdditionalInputCount}))throw new Error("native_stage_comment_original_receipt_changed");
  const origin=await captureNativeStageOrigin(db,run);
  const from=parseIssueExecutionState(transition.fromState),to=parseIssueExecutionState(transition.toState);
  if(!origin || !isDeepStrictEqual(transition.origin,origin) || !from || from.status!=="pending" || from.currentParticipant?.type!=="agent" ||
    from.currentParticipant.agentId!==run.agentId || !to || to.lastDecisionId!==transition.stageDecisionId ||
    !["approved","changes_requested"].includes(to.lastDecisionOutcome ?? ""))throw new Error("native_stage_comment_origin_changed");
  const [comment]=await db.select().from(issueComments).where(and(eq(issueComments.companyId,input.companyId),eq(issueComments.issueId,input.issueId),eq(issueComments.id,data.id),
    eq(issueComments.createdByRunId,run.id),eq(issueComments.authorAgentId,run.agentId))).limit(1).for("share");
  const [decision]=await db.select().from(issueExecutionDecisions).where(and(eq(issueExecutionDecisions.companyId,input.companyId),eq(issueExecutionDecisions.issueId,input.issueId),
    eq(issueExecutionDecisions.id,String(transition.stageDecisionId)),eq(issueExecutionDecisions.createdByRunId,run.id),eq(issueExecutionDecisions.actorAgentId,run.agentId))).limit(1).for("share");
  if(!comment || comment.deletedAt || comment.authorType!=="agent" || comment.authorUserId!==null || !decision || decision.actorUserId!==null || decision.stageId!==from.currentStageId || decision.stageType!==from.currentStageType || decision.outcome!==to.lastDecisionOutcome ||
    transition.commentHash!==nativeSha256({...comment,createdAt:comment.createdAt.toISOString(),updatedAt:comment.updatedAt.toISOString()}) ||
    transition.stageDecisionHash!==nativeSha256({...decision,createdAt:decision.createdAt.toISOString(),updatedAt:decision.updatedAt.toISOString()}))throw new Error("native_stage_comment_owner_changed");
  const {authorizationService,canActorReadIssuePrivacy}=await import("./authorization.js");
  const actor:AuthorizationActor=input.reader ?? {type:"agent",source:"agent_jwt",companyId:run.companyId,agentId:run.agentId,runId:run.id,onBehalfOfUserId:run.responsibleUserId};
  const access=await authorizationService(db).decide({actor,action:"issue:read",resource:{type:"issue",companyId:task.companyId,issueId:task.id,projectId:task.projectId},enforceResponsibleUserIntersection:true});
  if(!access.allowed || !await canActorReadIssuePrivacy(db,actor,task))throw new Error("native_stage_comment_reader_changed");
  return {operationId:NATIVE_STAGE_COMMENT_OPERATION,callId:input.callId,argumentsHash:input.argumentsHash,resultDigest:digest,commentId:comment.id,
    transitionHash:nativeSha256(transition),apiReceiptHash:nativeSha256(api),outputCapture:capture};
}
