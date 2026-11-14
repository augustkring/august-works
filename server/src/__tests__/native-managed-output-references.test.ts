import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectNativeManagedOutputReferences } from "./helpers/native-managed-output-references.js";
import type { NativeRunInputSourceReceipt } from "@paperclipai/shared";

function fixture(memory: boolean) {
  const companyId=randomUUID(),runId=randomUUID(),agentId=randomUUID(),invocationId=randomUUID(),outputId=randomUUID();
  const toolName=memory?"paperclip-self:remember":"create_task",callId="actual-call",hash="a".repeat(64),argumentsHash="b".repeat(64);
  const source={kind:"tool_result" as const,runId,callId,toolName,invocationId,contentHash:hash};
  const policy={issueIds:memory?[]:[outputId],memoryIds:memory?[outputId]:[],projectIds:[],runIds:[],foundationRevisionIds:[]};
  const additionalInputs:NativeRunInputSourceReceipt["additionalInputs"]=[{responsibleUserId:"fixture-human",policy,
    inputs:[source,memory?{kind:"memory",memoryId:outputId,sourceVersion:"1",contentHash:"c".repeat(64)}:
      {kind:"task",issueId:outputId,sourceVersion:"1",contentHash:"c".repeat(64)}]}];
  return {outputId,input:{binding:{companyId,runId,agentId},additionalInputs,
    captures:[{managedOpenCode:true,tool:memory?"self_remember":"create_task",callId,argumentsHash,resultDigest:hash,source,taskRef:memory?null:{issueId:outputId}}],
    invocations:[{id:invocationId,companyId,runId,agentId,idempotencyKey:`aw-native-tool:${runId}:${callId}`,toolName,status:"succeeded",argumentsHash,resultHash:hash,workflowResultJson:null}]}};
}
describe("Native output reference collection",()=>{
 it.each([false,true])("collects the sealed %s output when workflow JSON is absent",memory=>{
  const f=fixture(memory);expect(collectNativeManagedOutputReferences(f.input)).toEqual([expect.objectContaining({taskId:memory?null:f.outputId,memoryId:memory?f.outputId:null})]);
 });
 it.each(["hash","invocation","company","sealed_entry","ambiguous","task_ref"])("denies mismatched output refs: %s",kind=>{
  const f=fixture(false);
  if(kind==="hash")f.input.invocations[0]!.resultHash="d".repeat(64);
  if(kind==="invocation")f.input.invocations[0]!.id=randomUUID();
  if(kind==="company")f.input.invocations[0]!.companyId=randomUUID();
  if(kind==="sealed_entry")f.input.additionalInputs[0]!.inputs[0]={...f.input.captures[0]!.source,contentHash:"d".repeat(64)};
  if(kind==="ambiguous")f.input.additionalInputs.push(structuredClone(f.input.additionalInputs[0]!));
  if(kind==="task_ref")f.input.captures[0]!.taskRef={issueId:randomUUID()};
  expect(()=>collectNativeManagedOutputReferences(f.input)).toThrow(/^native_fixture_output_/);
 });
});
