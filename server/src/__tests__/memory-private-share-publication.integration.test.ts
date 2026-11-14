import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authSessions, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  activityLog, heartbeatRuns, issues, memoryPrivateSharePublications, memoryRecords } from "@paperclipai/db";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native exact-source private Memory publication", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string, ownerId: string, otherHumanId: string, producerAgentId: string, readerAgentId: string;
  let producerRunId: string, readerRunId: string;
  let ownerSessionId:string, ownerVerifiedDeadline:number;
  const service = () => memoryService(db);
  const producer = (): MemoryMutationActor => ({ principal: { type: "agent", agentId: producerAgentId, responsibleUserId: ownerId }, runId: producerRunId });
  const reader = (): MemoryMutationActor => ({ principal: { type: "agent", agentId: readerAgentId, responsibleUserId: ownerId }, runId: readerRunId });
  const owner = (): MemoryMutationActor => ({ principal: { type: "user", userId: ownerId }, authorizationActor:{
    type:"board",source:"session",userId:ownerId,sessionId:ownerSessionId,companyIds:[companyId],
    authenticatedCredentialExpiresAt:ownerVerifiedDeadline,
  }});
  const ownerWithoutCarrier = (): MemoryMutationActor => ({ principal:{type:"user",userId:ownerId} });
  const otherHuman = (): MemoryMutationActor => ({ principal: { type: "user", userId: otherHumanId } });

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-memory-private-publication-");
    db = createDb(database.connectionString, { maxConnections: 4 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    companyId=randomUUID(); ownerId=randomUUID(); otherHumanId=randomUUID(); producerAgentId=randomUUID(); readerAgentId=randomUUID();
    producerRunId=randomUUID(); readerRunId=randomUUID(); ownerSessionId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Exact Memory publication",issuePrefix:randomUUID()});
    await db.insert(authUsers).values([ownerId,otherHumanId].map(id=>({id,name:"Current Human",email:`${id}@example.test`,createdAt:new Date(),updatedAt:new Date()})));
    const sessionNow=new Date(); ownerVerifiedDeadline=sessionNow.getTime()+60000;
    await db.insert(authSessions).values({id:ownerSessionId,userId:ownerId,token:randomUUID(),createdAt:sessionNow,updatedAt:sessionNow,
      expiresAt:new Date(ownerVerifiedDeadline),authenticationMethod:"password",authenticatedAt:new Date(sessionNow.getTime()-1000),authenticatorVersion:0});
    await db.insert(companyMemberships).values([ownerId,otherHumanId].map(principalId=>({companyId,principalType:"user",principalId,status:"active",membershipRole:"admin"})));
    await db.insert(agents).values([producerAgentId,readerAgentId].map(id=>({id,companyId,name:"Native reader",role:"engineer",status:"idle",adapterType:"paperclip_runner"})));
    await db.insert(heartbeatRuns).values([
      {id:producerRunId,companyId,agentId:producerAgentId,responsibleUserId:ownerId,runtimeMode:"native",status:"running"},
      {id:readerRunId,companyId,agentId:readerAgentId,responsibleUserId:ownerId,runtimeMode:"native",status:"running"},
    ]);
  });

  function evidence(text:string) {
    return {sourceClass:"task" as const,sourceProvider:"native_private_share_fixture",sourceType:"reviewed_outcome",
      sourceRef:`outcome://${randomUUID()}`,sourceVersion:"1",sourceUpdatedAt:null,observedAt:new Date().toISOString(),
      excerptHash:createHash("sha256").update(text).digest("hex"),citation:{label:"Native test evidence"},trustLevel:"low" as const,relation:"supports" as const};
  }
  async function setupBinding(agentId=producerAgentId) {
    const binding=await service().createCompanyBinding(companyId,{key:randomUUID(),name:"Native shared Memory",providerKey:"local"},owner());
    await service().addBindingTarget(companyId,binding.id,{targetType:"company",targetId:companyId},owner());
    await service().addBindingTarget(companyId,binding.id,{targetType:"agent",targetId:agentId},owner());
    return binding;
  }
  async function createPrivate(agentId=producerAgentId,runId=producerRunId,accountId=ownerId,text=`PRIVATE claim ${randomUUID()}`,expiresAt:Date|null=null) {
    const binding=await setupBinding(agentId);
    return {binding,detail:await service().createPrivateMemory(companyId,agentId,{
      bindingId:binding.id,memoryType:"lesson",title:text,content:text,summary:`Reviewed: ${text}`,sensitivity:"internal",
      importance:50,confidenceScore:0.9,validFrom:null,validUntil:null,expiresAt:expiresAt?.toISOString()??null,observedAt:new Date().toISOString(),
      retentionPolicy:"standard",createdByOperationId:randomUUID(),evidence:[evidence(text)],
    },{principal:{type:"agent",agentId,responsibleUserId:accountId},runId})};
  }
  async function propose(sourceId:string,bindingId:string,actor=producer(),operationId=randomUUID()) {
    return service().sharePrivateMemory(companyId,sourceId,{targetBindingId:bindingId,targetScope:{type:"company",id:null},
      reason:"Publish this exact reviewed source to company scope",createdByOperationId:operationId},actor);
  }

  it("publishes only after the original Human accepts and permits other current company readers",async()=>{
    const {binding,detail:source}=await createPrivate();
    const operationId=randomUUID();
    const pending=await propose(source.record.id,binding.id,producer(),operationId);
    const [receipt]=await db.select().from(memoryPrivateSharePublications).where(and(eq(memoryPrivateSharePublications.companyId,companyId),
      eq(memoryPrivateSharePublications.sharedRecordId,pending.record.id)));
    expect(receipt).toMatchObject({state:"pending",sourceRecordId:source.record.id,sourceOwnerUserId:ownerId,
      targetScopeType:"company",targetScopeId:null});
    await expect(service().reviewCandidate(companyId,pending.record.id,{decision:"accept"},otherHuman())).rejects.toMatchObject({status:404});
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toBeNull();
    await expect(service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},ownerWithoutCarrier()))
      .rejects.toMatchObject({status:403});
    // A session-shaped User claim is not the original verified request carrier.
    for(const authorizationActor of [
      {type:"board" as const,source:"session" as const,userId:ownerId},
      {...owner().authorizationActor!,authenticatedCredentialExpiresAt:undefined},
      {type:"board" as const,source:"local_implicit" as const,userId:ownerId},
    ]) await expect(service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},
      {principal:{type:"user",userId:ownerId},authorizationActor})).rejects.toMatchObject({status:403});
    const [unpublished]=await db.select().from(memoryPrivateSharePublications).where(eq(memoryPrivateSharePublications.sharedRecordId,pending.record.id));
    expect(unpublished?.state).toBe("pending");

    const published=await service().reviewCandidate(companyId,pending.record.id,{decision:"accept",reason:"I reviewed the exact copy and company target",publishPrivateShare:true},owner());
    expect(published.privateShareReview).toMatchObject({state:"published",targetScopeType:"company",targetScopeId:null});
    const [acceptedReceipt]=await db.select().from(memoryPrivateSharePublications).where(eq(memoryPrivateSharePublications.sharedRecordId,pending.record.id));
    expect(acceptedReceipt).toMatchObject({state:"published",publishedByUserId:ownerId,sourceOwnerUserId:ownerId});
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toMatchObject({record:{id:pending.record.id,content:source.record.content}});
    await expect(service().getShared(companyId,pending.record.id,otherHuman())).resolves.toMatchObject({record:{id:pending.record.id,content:source.record.content}});
    const replay=await propose(source.record.id,binding.id,producer(),operationId);
    expect(replay.record.id).toBe(pending.record.id);
    expect(await db.select().from(memoryPrivateSharePublications).where(and(eq(memoryPrivateSharePublications.companyId,companyId),
      eq(memoryPrivateSharePublications.operationFingerprint,acceptedReceipt!.operationFingerprint)))).toHaveLength(1);
    await db.update(memoryRecords).set({sourceMemoryIds:[]}).where(eq(memoryRecords.id,pending.record.id));
    const [integrityGuardedCopy]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,pending.record.id));
    expect(integrityGuardedCopy?.sourceMemoryIds).toEqual([source.record.id]);
    await db.update(memoryPrivateSharePublications).set({sourceVersion:"stale-version"}).where(eq(memoryPrivateSharePublications.sharedRecordId,pending.record.id));
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toBeNull();
    await expect(service().get(companyId,pending.record.id,owner())).resolves.toBeNull();
    await expect(service().getShared(companyId,pending.record.id,otherHuman())).resolves.toBeNull();
  });

  it("rejects a stale pending proposal and leaves unrelated private roots unreadable",async()=>{
    const {binding,detail:source}=await createPrivate();
    const pending=await propose(source.record.id,binding.id);
    const correction=await service().correctPrivateMemory(companyId,source.record.id,{
      memoryType:"lesson",title:"Updated PRIVATE claim",content:"Updated PRIVATE claim",summary:"Updated summary",sensitivity:"internal",
      importance:50,confidenceScore:0.9,validFrom:null,validUntil:null,expiresAt:null,observedAt:new Date().toISOString(),
      retentionPolicy:"standard",createdByOperationId:randomUUID(),metadata:{},evidence:[evidence("Updated PRIVATE claim")],reason:"Source changed",
    },producer());
    expect(correction.record.supersedesRecordId).toBe(source.record.id);
    await expect(service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner())).rejects.toMatchObject({status:409});
    const [stillPending]=await db.select().from(memoryPrivateSharePublications).where(eq(memoryPrivateSharePublications.sharedRecordId,pending.record.id));
    expect(stillPending?.state).toBe("pending");

    const unrelated=await createPrivate(readerAgentId,readerRunId,ownerId,"PRIVATE unrelated Agent root");
    const companyCandidate=await service().createCandidate(companyId,{
      bindingId:unrelated.binding.id,memoryType:"lesson",scope:{type:"company",id:null},ownerAgentId:null,title:"Unrelated candidate",
      content:"Derivative containing an unrelated Agent root",summary:null,sensitivity:"internal",importance:40,confidenceScore:0.8,
      validFrom:null,validUntil:null,expiresAt:null,observedAt:new Date().toISOString(),retentionPolicy:"standard",
      createdByOperationId:randomUUID(),metadata:{},evidence:[evidence("Unrelated candidate")],
    },reader(),[unrelated.detail.record.id]);
    await expect(service().get(companyId,companyCandidate.record.id,producer())).resolves.toBeNull();
  });

  it("withdraws a published source on revocation and erasure",async()=>{
    const first=await createPrivate();
    const revoked=await propose(first.detail.record.id,first.binding.id);
    await service().reviewCandidate(companyId,revoked.record.id,{decision:"accept",publishPrivateShare:true},owner());
    await expect(service().get(companyId,revoked.record.id,reader())).resolves.toMatchObject({record:{id:revoked.record.id}});
    await service().revoke(companyId,first.detail.record.id,{reason:"Original source withdrawn"},owner()).catch(()=>undefined);
    const [revokedSource]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,first.detail.record.id));
    expect(revokedSource?.revokedAt).toBeInstanceOf(Date);
    await expect(service().get(companyId,revoked.record.id,reader())).resolves.toBeNull();
    await expect(service().get(companyId,revoked.record.id,owner())).resolves.toBeNull();

    const second=await createPrivate();
    const erased=await propose(second.detail.record.id,second.binding.id);
    await service().reviewCandidate(companyId,erased.record.id,{decision:"accept",publishPrivateShare:true},owner());
    await service().forget(companyId,second.detail.record.id,producer());
    await expect(service().get(companyId,erased.record.id,reader())).resolves.toBeNull();
    await expect(service().get(companyId,erased.record.id,owner())).resolves.toBeNull();
    expect(await db.select().from(memoryPrivateSharePublications).where(eq(memoryPrivateSharePublications.sharedRecordId,erased.record.id))).toHaveLength(0);
  });

  it("rolls back acceptance and publishes no activity when the transaction fails",async()=>{
    const {binding,detail:source}=await createPrivate();
    const pending=await propose(source.record.id,binding.id);
    await db.execute(sql`create function fail_private_share_acceptance() returns trigger language plpgsql as $$
      begin
        if new.action='memory.candidate_accepted' then
          raise exception 'test rollback after publication receipt update';
        end if;
        return new;
      end $$`);
    await db.execute(sql`create trigger fail_private_share_acceptance before insert on activity_log
      for each row execute function fail_private_share_acceptance()`);
    try {
      await expect(service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner())).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists fail_private_share_acceptance on activity_log`);
      await db.execute(sql`drop function if exists fail_private_share_acceptance()`);
    }
    const [candidate]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,pending.record.id));
    const [receipt]=await db.select().from(memoryPrivateSharePublications).where(eq(memoryPrivateSharePublications.sharedRecordId,pending.record.id));
    const event=await db.select({id:activityLog.id}).from(activityLog).where(and(eq(activityLog.companyId,companyId),
      eq(activityLog.action,"memory.candidate_accepted"),eq(activityLog.entityId,pending.record.id)));
    expect(candidate?.reviewState).toBe("pending"); expect(receipt?.state).toBe("pending"); expect(event).toHaveLength(0);
  });

  it("uses the original verified credential deadline even after the stored session is extended",async()=>{
    const {binding,detail:source}=await createPrivate();
    const pending=await propose(source.record.id,binding.id);
    await db.update(authSessions).set({expiresAt:new Date(Date.now()+60*60*1000)}).where(eq(authSessions.id,ownerSessionId));
    ownerVerifiedDeadline=Date.now()+1500;
    await db.execute(sql`create function delay_private_share_acceptance() returns trigger language plpgsql as $$
      begin
        if new.action='memory.candidate_accepted' then perform pg_sleep(2.5); end if;
        return new;
      end $$`);
    await db.execute(sql`create trigger delay_private_share_acceptance before insert on activity_log
      for each row execute function delay_private_share_acceptance()`);
    try {
      await expect(service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner()))
        .rejects.toMatchObject({status:403});
    } finally {
      await db.execute(sql`drop trigger if exists delay_private_share_acceptance on activity_log`);
      await db.execute(sql`drop function if exists delay_private_share_acceptance()`);
    }
    const [candidate]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,pending.record.id));
    const [receipt]=await db.select().from(memoryPrivateSharePublications).where(eq(memoryPrivateSharePublications.sharedRecordId,pending.record.id));
    expect(candidate?.reviewState).toBe("pending"); expect(receipt?.state).toBe("pending");
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toBeNull();
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("does not commit an ordinary review after its original verified session deadline",async()=>{
    const binding=await setupBinding();
    const candidate=await service().createCandidate(companyId,{bindingId:binding.id,memoryType:"lesson",scope:{type:"company",id:null},ownerAgentId:null,
      title:"Ordinary review deadline",content:"Current session must still be valid",summary:null,sensitivity:"internal",importance:40,confidenceScore:0.8,
      validFrom:null,validUntil:null,expiresAt:null,observedAt:new Date().toISOString(),retentionPolicy:"standard",createdByOperationId:randomUUID(),
      metadata:{},evidence:[evidence("ordinary review deadline")]},producer());
    ownerVerifiedDeadline=Date.now()+1500;
    await db.update(authSessions).set({expiresAt:new Date(ownerVerifiedDeadline)}).where(eq(authSessions.id,ownerSessionId));
    await db.update(authSessions).set({expiresAt:new Date(Date.now()+60*60*1000)}).where(eq(authSessions.id,ownerSessionId));
    await db.execute(sql`create function delay_ordinary_memory_review() returns trigger language plpgsql as $$
      begin
        if new.action='memory.candidate_accepted' then perform pg_sleep(2.5); end if;
        return new;
      end $$`);
    await db.execute(sql`create trigger delay_ordinary_memory_review before insert on activity_log
      for each row execute function delay_ordinary_memory_review()`);
    try {
      await expect(service().reviewCandidate(companyId,candidate.record.id,{decision:"accept"},owner())).rejects.toMatchObject({status:403});
    } finally {
      await db.execute(sql`drop trigger if exists delay_ordinary_memory_review on activity_log`);
      await db.execute(sql`drop function if exists delay_ordinary_memory_review()`);
    }
    const [record]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,candidate.record.id));
    const acceptedEvents=await db.select({id:activityLog.id}).from(activityLog).where(and(eq(activityLog.companyId,companyId),
      eq(activityLog.action,"memory.candidate_accepted"),eq(activityLog.entityId,candidate.record.id)));
    expect(record?.reviewState).toBe("pending"); expect(acceptedEvents).toHaveLength(0);
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("keeps original private Task ACLs after explicit company publication",async()=>{
    const taskAgentId=randomUUID(),taskRunId=randomUUID(),taskId=randomUUID();
    await db.insert(agents).values({id:taskAgentId,companyId,name:"Task-bound producer",role:"engineer",status:"idle",adapterType:"paperclip_runner"});
    await db.insert(issues).values({id:taskId,companyId,title:"Private Task source",visibility:"private",responsibleUserId:ownerId,
      assigneeAgentId:taskAgentId,createdByUserId:ownerId});
    await db.insert(heartbeatRuns).values({id:taskRunId,companyId,agentId:taskAgentId,responsibleUserId:ownerId,
      issueId:taskId,nativeIssueId:taskId,scopeKind:"issue",contextSnapshot:{issueId:taskId},runtimeMode:"native",status:"running"});
    const taskActor:MemoryMutationActor={principal:{type:"agent",agentId:taskAgentId,responsibleUserId:ownerId},runId:taskRunId};
    const {binding,detail:source}=await createPrivate(taskAgentId,taskRunId,ownerId,"PRIVATE Task-bound Memory");
    const pending=await propose(source.record.id,binding.id,taskActor);
    await service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner());
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toBeNull();
    await expect(service().getShared(companyId,pending.record.id,otherHuman())).resolves.toBeNull();
    await expect(service().getShared(companyId,pending.record.id,owner())).resolves.toMatchObject({record:{id:pending.record.id}});
  });

  it("does not let an allowed publication path mask the same private row as a sibling source",async()=>{
    const {binding,detail:source}=await createPrivate();
    const pending=await propose(source.record.id,binding.id);
    await service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner());
    const makeDerivative=(title:string)=>({bindingId:binding.id,memoryType:"lesson" as const,scope:{type:"company" as const,id:null},ownerAgentId:null,
      title,content:`${title}: derived copy`,summary:null,sensitivity:"internal" as const,importance:40,confidenceScore:0.8,
      validFrom:null,validUntil:null,expiresAt:null,observedAt:new Date().toISOString(),retentionPolicy:"standard",createdByOperationId:randomUUID(),
      metadata:{},evidence:[evidence(title)]});
    const transitive=await service().createCandidate(companyId,makeDerivative("Transitive published source"),producer(),[pending.record.id]);
    await expect(service().get(companyId,transitive.record.id,reader())).resolves.toMatchObject({record:{id:transitive.record.id}});
    await expect(service().getShared(companyId,transitive.record.id,otherHuman())).resolves.toMatchObject({record:{id:transitive.record.id}});

    const directSibling=await service().createCandidate(companyId,makeDerivative("Publication plus direct private sibling"),producer(),
      [pending.record.id,source.record.id]);
    await expect(service().get(companyId,directSibling.record.id,reader())).resolves.toBeNull();
    await expect(service().getShared(companyId,directSibling.record.id,otherHuman())).resolves.toBeNull();
  });

  it("withdraws the published edge when the actual source expires",async()=>{
    const expiresAt=new Date(Date.now()+3000),{binding,detail:source}=await createPrivate(producerAgentId,producerRunId,ownerId,"PRIVATE expiring source",expiresAt);
    const pending=await propose(source.record.id,binding.id);
    await service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner());
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toMatchObject({record:{id:pending.record.id}});
    await new Promise(resolve=>setTimeout(resolve,expiresAt.getTime()-Date.now()+150));
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toBeNull();
    await expect(service().get(companyId,pending.record.id,owner())).resolves.toBeNull();
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  it("withdraws the published copy for its original owner when the source is superseded",async()=>{
    const {binding,detail:source}=await createPrivate();
    const pending=await propose(source.record.id,binding.id);
    await service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner());
    await expect(service().get(companyId,pending.record.id,owner())).resolves.toMatchObject({record:{id:pending.record.id}});
    const correction=await service().correctPrivateMemory(companyId,source.record.id,{
      memoryType:"lesson",title:"Corrected PRIVATE source",content:"Corrected PRIVATE source",summary:"Corrected summary",sensitivity:"internal",
      importance:50,confidenceScore:0.9,validFrom:null,validUntil:null,expiresAt:null,observedAt:new Date().toISOString(),
      retentionPolicy:"standard",createdByOperationId:randomUUID(),metadata:{},evidence:[evidence("Corrected PRIVATE source")],reason:"Source superseded",
    },producer());
    expect(correction.record.supersedesRecordId).toBe(source.record.id);
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toBeNull();
    await expect(service().get(companyId,pending.record.id,owner())).resolves.toBeNull();
  });
  it("retains a private Task title copied as additional tool evidence",async()=>{
    const {binding,detail:source}=await createPrivate();
    const [task]=await db.insert(issues).values({companyId,title:"PRIVATE extra Task citation",visibility:"private",
      createdByUserId:ownerId,responsibleUserId:ownerId,assigneeAgentId:producerAgentId}).returning();
    const [shareRun]=await db.insert(heartbeatRuns).values({companyId,agentId:producerAgentId,responsibleUserId:ownerId,
      runtimeMode:"native",status:"running",nativeIssueId:task!.id,contextSnapshot:{issueId:task!.id}}).returning();
    const pending=await service().sharePrivateMemory(companyId,source.record.id,{targetBindingId:binding.id,
      targetScope:{type:"company",id:null},reason:"Review this exact Memory copy",createdByOperationId:randomUUID()},
      {principal:{type:"agent",agentId:producerAgentId,responsibleUserId:ownerId},runId:shareRun!.id},
      {additionalEvidence:[{sourceClass:"task",sourceProvider:"august_works_memory_agent_tool",sourceType:"agent_run_observation",
        sourceRef:`run://${shareRun!.id}/issue/${task!.id}`,sourceVersion:task!.updatedAt.toISOString(),
        sourceUpdatedAt:task!.updatedAt.toISOString(),observedAt:new Date().toISOString(),
        excerptHash:createHash("sha256").update(source.record.content).digest("hex"),
        citation:{label:task!.title},trustLevel:"low",relation:"supports"}]});
    expect(pending.record.sourceIssueIds).toContain(task!.id);
    await service().reviewCandidate(companyId,pending.record.id,{decision:"accept",publishPrivateShare:true},owner());
    await expect(service().get(companyId,pending.record.id,reader())).resolves.toBeNull();
    await expect(service().getShared(companyId,pending.record.id,otherHuman())).resolves.toBeNull();
    const retained=await service().getShared(companyId,pending.record.id,owner());
    expect(retained?.evidence.some(item=>item.citationJson.label===task!.title)).toBe(true);
  });

});
