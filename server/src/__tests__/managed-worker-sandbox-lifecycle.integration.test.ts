import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, orchestrationModelReservations, orchestrationWorkerAttempts } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { configureManagedConversationSandboxHost } from "./helpers/managed-native-conversation-sandbox-host.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture, type ManagedWorkerSandboxHost } from "./helpers/managed-native-opencode-e2e-fixture.js";

describe("actual Worker Sandbox relay family", () => {
 let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
 let db: ReturnType<typeof createDb>; let root=""; let preserveFailure=false;const instanceId=`worker-sandbox-${randomUUID()}`;
 beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),"worker-sandbox-"));await chmod(root,0o700);
  vi.stubEnv("PAPERCLIP_HOME",root);vi.stubEnv("PAPERCLIP_INSTANCE_ID",instanceId);
  vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET",`worker-sandbox-${randomUUID()}-${randomUUID()}`);
  database=await startEmbeddedPostgresTestDatabase("worker-sandbox-",{preserveDataOnFailure:()=>preserveFailure});db=createDb(database.connectionString);
 },30000);
 afterEach(context=>{if(context.task.result?.state==="fail")preserveFailure=true;});
 afterAll(async()=>{
  await database?.cleanup();vi.unstubAllEnvs();
  if(root&&preserveFailure){await writeFile(join(root,"native-worker-preserved-state.json"),JSON.stringify({dataDir:database.dataDir,root,instanceId},null,2),{mode:0o600});console.info("native_worker_failure_state_preserved",JSON.stringify({dataDir:database.dataDir,root}));}
  else if(root){await makeFixtureTreeWritable(root);await rm(root,{recursive:true,force:true});}
 },30000);
 it("uses the actual Worker issuer, reservation and Host provider bridge for one bounded tool journey",async()=>{
  let workerIssuances=0;let conversationIssuances=0;let reservedProviderCalls=0;
  let configuredHost: ManagedWorkerSandboxHost | null = null;
  const fixtureDeadlineAt=new Date(Date.now()+300_000);
  const result=await runManagedNativeOpenCodeFixture({db,connectionString:database.connectionString,root,instanceId,
   fixtureDeadlineAt,conversationRoot:true,sandboxRelay:true,
   steps:[{tool:"create_task",id:"worker-sandbox-child",input:{idempotencyKey:randomUUID(),title:"Sandbox worker draft",description:"One bounded worker tool",status:"backlog"}},{tool:"write_document",id:"worker-sandbox-document",input:{idempotencyKey:randomUUID(),key:"worker-sandbox-proof",title:"Worker Sandbox lifecycle proof",body:"This document is the required output of the bounded Worker Sandbox journey.",baseRevisionId:null}},{tool:"paperclip_finish",id:"worker-sandbox-finish"}],
   configureSandboxHost:async context=>{
    const issueWorker=context.gateway.issueForRun.bind(context.gateway);const issueConversation=context.gateway.issueForConversationRun.bind(context.gateway);
    context.gateway.issueForRun=async input=>{workerIssuances++;return issueWorker(input);};
    context.gateway.issueForConversationRun=async input=>{conversationIssuances++;return issueConversation(input);};
    // The separately composed R38.4 helper supplies the production Host engine
    // and a dynamic attached-provider bridge. Old direct-spawn R3 cannot pass.
    const host=await configureManagedConversationSandboxHost(context);
    if (!("modelRequest" in host) || typeof host.modelRequest!=="function") throw Error("worker_sandbox_production_host_bridge_required");
    configuredHost=host as ManagedWorkerSandboxHost;
    return host as ManagedWorkerSandboxHost;
   },
   beforeProviderResponse:async context=>{
    expect(workerIssuances).toBeGreaterThan(0);expect(conversationIssuances).toBe(0);
    const [attempt]=await db.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId,context.companyId),eq(orchestrationWorkerAttempts.runId,context.runId)));
    expect(attempt?.status).toBe("running");
    const reservations=await db.select().from(orchestrationModelReservations).where(and(eq(orchestrationModelReservations.companyId,context.companyId),eq(orchestrationModelReservations.workerAttemptId,attempt!.id)));
    expect(reservations.some(row=>row.purpose==="worker_model"&&row.status==="dispatched")).toBe(true);reservedProviderCalls++;
   },
  });
  expect(result.sandbox?.brokerTokenSubstitutionCount).toBe(0);
  expect(result.sandbox?.facts.relayAuthenticated).toBe(true);
  const sessionReceipts=result.sandbox?.facts.modelBrokerSessionReceipts as Array<{
   phase:string;sessionKey:string;capabilityHash:string;expiresAt:string;sessionDeadlineAt:string
  }>;
  expect(sessionReceipts.map(receipt=>receipt.phase)).toEqual(expect.arrayContaining(["start","refresh","stop"]));
  expect(new Set(sessionReceipts.map(receipt=>receipt.sessionKey)).size).toBe(1);
  expect(new Set(sessionReceipts.map(receipt=>receipt.sessionDeadlineAt)).size).toBe(1);
  expect(sessionReceipts.every(receipt=>Date.parse(receipt.expiresAt)<=Date.parse(receipt.sessionDeadlineAt))).toBe(true);
  expect(sessionReceipts[0]?.capabilityHash).toMatch(/^[a-f0-9]{64}$/);
  expect(sessionReceipts.at(-1)?.phase).toBe("stop");
  const stopExecs=result.sandbox?.facts.execFacts as Array<{modelBrokerSessionPhase:string|null;modelCredentialPresent:boolean;credentialEnvironmentAbsent:boolean;hostSessionErrorCode:string|null;exitCode:number|null}>;
  expect(stopExecs.some(fact=>fact.modelBrokerSessionPhase==="stop"&&fact.modelCredentialPresent===false&&
    fact.credentialEnvironmentAbsent===true&&fact.hostSessionErrorCode===null&&fact.exitCode!==126)).toBe(true);
  expect(result.sandbox?.facts.attachedModelBrokerProviderCount).toBe(0);
  expect(configuredHost).not.toBeNull();
  await expect(configuredHost!.modelRequest({},new AbortController().signal)).rejects.toThrow("sandbox_session_provider_not_running");
  expect(result.modelCalls).toBeGreaterThanOrEqual(3);expect(reservedProviderCalls).toBe(result.modelCalls);
  expect(result.childTasks).toHaveLength(1);
  if (!result.planId) throw new Error("worker_sandbox_plan_result_missing");
  const reservations=await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId,result.planId));
  expect(reservations.length).toBeGreaterThanOrEqual(3);
  expect(reservations.every(row=>row.purpose==="worker_model"&&row.status==="completed")).toBe(true);
 },300000);
});
