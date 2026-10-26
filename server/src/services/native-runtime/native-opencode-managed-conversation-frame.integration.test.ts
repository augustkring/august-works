import {and,eq} from "drizzle-orm";
import {heartbeatRunEvents,nativeRunFinalizations,nativeRunResults} from "@paperclipai/db";
import type {BusinessMetricQuery} from "@paperclipai/shared";
import {instanceSettingsService} from "../instance-settings.js";
import {businessMetricService} from "../business-metrics/service.js";
import {aiGovernanceService} from "../ai-governance/governance-service.js";
import {issueService} from "../issues.js";
import {analyticalPurpose,metricDefinition} from "../../__tests__/helpers/business-metric-fixture.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { makeConversationFixtureTreeWritable, runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { configureManagedConversationSandboxHost } from "../../__tests__/helpers/managed-native-conversation-sandbox-host.js";

function qualifiedOpenCodeBinary(): string | null {
  if (process.platform !== "linux") return null;
  const configured = process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim();
  if (configured) return configured;
  try { return execFileSync("which", ["opencode"], { encoding: "utf8" }).trim() || null; }
  catch { return null; }
}

describe.skipIf(!qualifiedOpenCodeBinary())("managed Native conversation OpenCode frame", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-native-conversation-frame-"));
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", `conversation-frame-${Date.now()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-native-conversation-frame-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await database?.cleanup();
    vi.unstubAllEnvs();
    if (root) { await makeConversationFixtureTreeWritable(root); await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it("uses the authenticated chat route and actual heartbeat to dispatch a pinned OpenCode turn under a conversation issuer token, without worker-plan rows", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
    let liveBoundary: { runId: string; issueId: string; manifestId: string; reservationId: string;
      requestHash: string; wireBodyHash: string; sourceReceiptHash: string; inputTokens: number; outputTokens: number } | null = null;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      beforeProviderResponse: async facts => {
        expect(facts.run.status).toBe("running");
        expect(facts.run.nativeIssueId).toBe(facts.issueId);
        expect(facts.reservation).toMatchObject({ purpose: "conversation_model", status: "dispatched",
          conversationRunId: facts.run.id, conversationIssueId: facts.issueId,
          executionManifestId: facts.manifest.id, executionManifestHash: expect.any(String) });
        expect(facts.sourceReceipt).toMatchObject({ version: 1, binding: { runId: facts.run.id,
          issueId: facts.issueId, responsibleUserId: facts.run.responsibleUserId } });
        expect(facts.tariffSnapshot).toEqual(expect.any(Object));
        expect(facts.quote).toEqual(expect.any(Object));
        expect(facts.budget.companyMonthlyCents).toBeGreaterThan(0);
        expect(facts.budget.agentMonthlyCents).toBeGreaterThan(0);
        expect(facts.profileBinding).toMatchObject({ model: "fixture-managed-conversation-v1",
          providerBindingId: expect.any(String), providerSnapshotHash: expect.any(String),
          qualifiedConfigurationHash: expect.any(String) });
        liveBoundary = { runId: facts.run.id, issueId: facts.issueId, manifestId: facts.manifest.id,
          reservationId: facts.reservation.id, requestHash: facts.request.bodySha256,
          wireBodyHash: facts.request.wireBodySha256, sourceReceiptHash: JSON.stringify(facts.sourceReceipt),
          inputTokens: facts.usage.inputTokens, outputTokens: facts.usage.outputTokens };
      } });
    expect(result.success, JSON.stringify({ runStatus: result.runStatus, runError: result.run?.error,
      errorCode: result.run?.errorCode, stdoutExcerpt: result.run?.stdoutExcerpt,
      stderrExcerpt: result.run?.stderrExcerpt, providerCallCount: result.providerCallCount,
      providerHookInvoked: result.providerHookInvoked, providerHookFailure: result.providerHookFailure,
      providerStubFailure: result.providerStubFailure, providerToolNames: result.providerToolNames,
      issuerFacts: result.issuerFacts, liveBoundary, brokerRequestFacts: result.brokerRequestFacts })).toBe(true);
    expect(result.providerCallCount).toBeGreaterThan(0);
    expect(result.providerKeyMatched).toBe(true);
    expect(liveBoundary).toMatchObject({ runId: result.run?.id, issueId: result.issueId,
      manifestId: result.manifest?.id, reservationId: result.reservation?.id, inputTokens: 100, outputTokens: 32 });
    expect(result.issuerFacts).toHaveLength(1);
    const issuer = result.issuerFacts[0];
    if (!issuer) throw new Error("conversation_frame_issuer_fact_missing");
    expect(issuer).toMatchObject({ scope: "conversation_model", runId: result.run?.id,
      issueId: result.issueId, generation: 0, manifestId: result.manifest?.id });
    expect(issuer.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.run).toMatchObject({ runtimeMode: "native", scopeKind: "issue", nativeIssueId: result.issueId,
      responsibleUserId: expect.any(String), status: "succeeded" });
    expect(result.manifest).toMatchObject({ runId: result.run?.id, agentId: result.run?.agentId });
    expect(result.agentReply).toMatchObject({ authorAgentId: result.run?.agentId, createdByRunId: result.run?.id,
      body: "I’ve received your message and am ready to continue." });
    expect(result.conversationIssue).toMatchObject({ status: "in_review", conversationState: "waiting",
      executionRunId: result.run?.id });
    expect([403, 404]).toContain(result.foreignWriteStatus);
    expect(result.foreignWriteDidNotMutate).toBe(true);
    expect(result.reservation).toMatchObject({ purpose: "conversation_model", conversationRunId: result.run?.id,
      conversationIssueId: result.issueId, status: "completed" });
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    const sourceReceipt = result.nativeInputSourceReceipt as Record<string, unknown> | null;
    expect(sourceReceipt).toMatchObject({ version: 1, binding: { runId: result.run?.id,
      issueId: result.issueId, responsibleUserId: result.run?.responsibleUserId } });
  }, 240_000);

  it("runs the route-created conversation through RuntimeControl and its signed qualified sandbox relay", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      configureHeartbeat: context => configureManagedConversationSandboxHost({ ...context, root }),
      beforeProviderResponse: async facts => {
        expect(facts.run.status).toBe("running");
        expect(facts.run.nativeIssueId).toBe(facts.issueId);
        expect(facts.reservation).toMatchObject({ purpose: "conversation_model", status: "dispatched",
          conversationRunId: facts.run.id, conversationIssueId: facts.issueId, executionManifestId: facts.manifest.id });
      } });
    expect(result.success, JSON.stringify({ runStatus: result.runStatus, runError: result.run?.error,
      run: result.run ? { id: result.run.id, status: result.run.status, startedAt: result.run.startedAt,
        runtimeMode: result.run.runtimeMode, scopeKind: result.run.scopeKind, nativeIssueId: result.run.nativeIssueId,
        runtimeModeReason: result.run.runtimeModeReason, runtimeModeResolvedAt: result.run.runtimeModeResolvedAt,
        responsibleUserId: result.run.responsibleUserId, agentId: result.run.agentId,
        executionCancellation: result.run.resultJson?.executionCancellation } : null,
      errorCode: result.run?.errorCode, providerCallCount: result.providerCallCount,
      providerHookInvoked: result.providerHookInvoked, providerHookFailure: result.providerHookFailure,
      providerStubFailure: result.providerStubFailure, brokerRequestFacts: result.brokerRequestFacts,
      sandboxRuntimeFacts: result.sandboxRuntimeFacts })).toBe(true);
    expect(result.providerHookInvoked).toBe(true);
    expect(result.providerKeyMatched).toBe(true);
    expect(result.run).toMatchObject({ runtimeMode: "native", scopeKind: "issue", nativeIssueId: result.issueId,
      responsibleUserId: expect.any(String), status: "succeeded" });
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.agentReply).toMatchObject({ authorAgentId: result.run?.agentId, createdByRunId: result.run?.id,
      body: "I’ve received your message and am ready to continue." });
    expect(result.conversationIssue).toMatchObject({ status: "in_review", conversationState: "waiting",
      executionRunId: result.run?.id });
    expect(result.sandboxRuntimeFacts).toMatchObject({ mode: "controlled_signed_host_relay", relayAuthenticated: true });
    const runtimeFacts = result.sandboxRuntimeFacts as Record<string, unknown> | null;
    expect(typeof runtimeFacts?.providerAttestedLeaseExpiresAt).toBe("string");
    expect(Date.parse(String(runtimeFacts?.providerAttestedLeaseExpiresAt))).toBeGreaterThan(Date.now());
    expect(runtimeFacts?.execCount).toEqual(expect.any(Number));
    expect(Number(runtimeFacts?.execCount)).toBeGreaterThan(0);
    expect(Number(runtimeFacts?.exactPrivateCwdCount)).toBeGreaterThan(0);
    expect(Number(runtimeFacts?.managedModelCredentialCount)).toBeGreaterThan(0);
    expect(runtimeFacts?.negativeControls).toEqual({ wrongRunDenied: true, wrongLeaseDenied: true,
      wrongCwdDenied: true, wrongPolicyDenied: true });
    const sandboxExecutionChecks = Array.isArray(runtimeFacts?.sandboxExecutionChecks)
      ? runtimeFacts.sandboxExecutionChecks as Array<Record<string, unknown>>
      : [];
    expect(sandboxExecutionChecks.length).toBeGreaterThan(0);
    expect(sandboxExecutionChecks.every(check => check.managedGitContextProbe !== true)).toBe(true);
    expect(sandboxExecutionChecks.some(check => check.runtimeMode === "native" &&
      check.runStatusRunning === true && check.nativeIssueIdPresent === true &&
      check.contextIssueExecutionRunMatches === true && check.managedGitContextProbe !== true)).toBe(true);
  }, 300_000);
  it("continues the real conversation after a metric tool result with its original immutable source receipt",async()=>{
    const binary=qualifiedOpenCodeBinary();
    if(!binary)throw new Error("qualified_opencode_binary_unavailable");
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS","1");
    vi.stubEnv("PAPERCLIP_MANAGED_OPENCODE_E2E_DIAGNOSTICS","1");
    let query:BusinessMetricQuery|null=null,receivedMetricResult=false;
    let startupFacts:unknown=null;
    const result=await runManagedNativeConversationFrame({db,root,opencodeBinary:binary,
      configureHeartbeat:async context=>{
        await instanceSettingsService(db).updateExperimental({analytical_lineage_v8:true,business_metrics_v8:true,
          management_reviews_v8:true,management_chat_tools_v8:true,ai_use_cases_v7:true,governance_evidence_v7:true});
        if(!context.actor.userId)throw new Error("metric_fixture_current_human_missing");
        const policy=await aiGovernanceService(db).obligation(context.actor,context.companyId,analyticalPurpose());
        const owner=businessMetricService(db),created=await owner.create(context.companyId,context.actor,{
          key:"conversation-source-receipt",definition:{...metricDefinition(policy.id),ownerUserId:context.actor.userId}});
        await owner.publish(context.companyId,context.actor,created.metric.id,{expectedRevision:1,versionId:created.version.id});
        await issueService(db).create(context.companyId,{title:"Human metric population",status:"todo",
          createdByUserId:context.actor.userId,responsibleUserId:context.actor.userId,assigneeAgentId:context.agentId},db,undefined,
          {manualInputActor:context.actor,privacyActor:context.actor});
        query={metricId:created.metric.id,versionId:created.version.id,from:new Date(Date.now()-86400000).toISOString(),
          until:new Date(Date.now()+3600000).toISOString(),dimensions:[],maxRows:100};
        return {};
      },
      afterRunSettledBeforeTeardown:async facts=>{
        if(!facts.run||facts.run.status==="succeeded")return;
        const [finalization]=await db.select({phase:nativeRunFinalizations.phase,code:nativeRunFinalizations.failureCode,
          detail:nativeRunFinalizations.failureDetail}).from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId,facts.run.id));
        const events=await db.select({type:heartbeatRunEvents.eventType,payload:heartbeatRunEvents.payload})
          .from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId,facts.companyId),eq(heartbeatRunEvents.runId,facts.run.id)))
          .orderBy(heartbeatRunEvents.seq).limit(100);
        const results=await db.select({status:nativeRunResults.schemaStatus,code:nativeRunResults.rejectionCode,
          result:nativeRunResults.resultJson}).from(nativeRunResults).where(eq(nativeRunResults.runId,facts.run.id));
        const closedFacts=(value:unknown,depth=0):unknown=>{
          if(depth>3)return undefined;
          if(typeof value==="boolean"||typeof value==="number")return value;
          if(typeof value==="string")return /^[A-Za-z][A-Za-z0-9_.:-]{0,100}$/.test(value)?value:undefined;
          if(Array.isArray(value))return value.slice(0,10).map(part=>closedFacts(part,depth+1));
          if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).slice(0,30)
            .map(([key,part])=>[key,/id|hash|digest|text|body|token|secret|key|prompt|content|path|arg/i.test(key)?undefined:closedFacts(part,depth+1)]));
          return undefined;
        };
        startupFacts={finalization:closedFacts(finalization),events:events.map(event=>({type:event.type,payload:closedFacts(event.payload)})),
          results:results.map(value=>({status:value.status,code:value.code,result:closedFacts(value.result)}))};
      },
      providerReply:({body,callIndex})=>{
        if(!query)throw new Error("metric_fixture_query_missing");
        if(callIndex===1){
          const tools=Array.isArray(body.tools)?body.tools as Array<Record<string,unknown>>:[];
          const tool=tools.find(value=>typeof value.name==="string"&&value.name.endsWith("query_business_metric"));
          if(!tool)throw new Error("metric_fixture_original_tool_not_advertised");
          return {stop_reason:"tool_use",content:[{type:"tool_use",id:"toolu_native_metric",name:tool.name,input:query}]};
        }
        if(callIndex!==2)throw new Error("metric_fixture_unexpected_provider_retry");
        const messages=Array.isArray(body.messages)?body.messages as Array<Record<string,unknown>>:[];
        const blocks=messages.flatMap(message=>Array.isArray(message.content)?message.content as Array<Record<string,unknown>>:[]);
        const metric=blocks.find(block=>block.type==="tool_result"&&block.tool_use_id==="toolu_native_metric");
        if(!metric||metric.is_error===true)throw new Error("metric_fixture_original_result_missing");
        const content=typeof metric.content==="string"?metric.content:Array.isArray(metric.content)
          ?(metric.content as Array<Record<string,unknown>>).map(part=>typeof part.text==="string"?part.text:"").join(""):"";
        const value=JSON.parse(content);
        expect(value).toMatchObject({tool:"query_business_metric",result:{grade:"native_observation",
          observation:{metricId:query.metricId,versionId:query.versionId}}});
        receivedMetricResult=true;
        return undefined;
      }});
    expect(result.success,JSON.stringify({status:result.runStatus,errorCode:result.run?.errorCode,
      calls:result.providerCallCount,broker:result.brokerRequestFacts,stub:result.providerStubFailure,startupFacts,
      issuerCount:result.issuerFacts.length,executionStage:result.run?.executionStage,
      sourceProtocol:result.run?.nativeInputSourceProtocolVersion,nativeSessionPresent:Boolean(result.run?.nativeSessionId),
      processPidPresent:Boolean(result.run?.processPid),providerTools:result.providerToolNames,
      stderr:result.run?.stderrExcerpt?.slice(0,1600),stdout:result.run?.stdoutExcerpt?.slice(0,1000)})).toBe(true);
    expect(result.providerCallCount).toBe(2);
    expect(receivedMetricResult).toBe(true);
    expect(result.workerPlan).toBeNull();
    expect(result.workerAttempts).toHaveLength(0);
    expect(result.agentReply).toMatchObject({authorAgentId:result.run?.agentId,createdByRunId:result.run?.id});
    expect(result.nativeInputSourceReceipt).toMatchObject({additionalInputs:expect.arrayContaining([
      expect.objectContaining({inputs:expect.arrayContaining([
        expect.objectContaining({kind:"tool_result",toolName:"query_business_metric",invocationId:null}),
        expect.objectContaining({kind:"context"})])})])});
  },240_000);

});
