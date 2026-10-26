import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, documents, documentRevisions,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, learningCycles, learningDomainCandidates,
  learningEvaluations, learningEvidence, learningHypotheses, learningRetainedAssets, memoryJobs,
  memoryEvidence, memoryRecords, principalPermissionGrants, type Db } from "@paperclipai/db";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { withNativeAnalyticalReader } from "../services/analytical-reader.js";
import type { ActivityPublication } from "../services/activity-log.js";
import { authorizationService, type AuthorizationActor } from "../services/authorization.js";
import { contextManifestService } from "../services/context/context-manifest.js";
import { assertLearnedAssetAnalyticalSources } from "../services/learning/learning-analytical-sources.js";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { assertNativeMemoryCaptureSourcePrincipal, canActorReadMemorySources, lockMemoryPrivacy,
  withNativeMemoryCaptureSources, type NativeMemoryCaptureReceipt } from "../services/memory/memory-privacy.js";
import { nativePayloadSnapshotSql } from "../services/native-direct-input.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native capture source purpose stays inside its actual PostgreSQL transaction", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let companyId:string, userId:string, agentId:string, issueId:string, runId:string, jobId:string, ownerId:string;
  let source:Awaited<ReturnType<ReturnType<typeof memoryService>["createPrivateMemory"]>>;
  const actor=():AuthorizationActor=>({type:"agent",source:"agent_jwt",companyId,agentId,runId,onBehalfOfUserId:userId});
  const mutation=():MemoryMutationActor=>({principal:{type:"agent",agentId,responsibleUserId:userId},runId});
  beforeAll(async()=>{
    database=await startEmbeddedPostgresTestDatabase("v10-native-capture-purpose-");
    db=createDb(database.connectionString,{maxConnections:3});
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async()=>{await database?.cleanup();},30000);
  beforeEach(async()=>{
    companyId=randomUUID();userId=randomUUID();agentId=randomUUID();issueId=randomUUID();runId=randomUUID();jobId=randomUUID();ownerId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Native capture",issuePrefix:randomUUID()});
    await db.insert(authUsers).values({id:userId,name:"Actual Human",email:`${userId}@example.test`,emailVerified:true,createdAt:new Date(),updatedAt:new Date()});
    await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,status:"active",membershipRole:"admin"});
    await db.insert(principalPermissionGrants).values([
      {companyId,principalType:"user",principalId:userId,permissionKey:"foundation:read"},
      {companyId,principalType:"agent",principalId:agentId,permissionKey:"foundation:read"},
    ]);
    await db.insert(agents).values({id:agentId,companyId,name:"Native worker",role:"engineer",status:"idle",adapterType:"paperclip_runner"});
    await db.insert(companyMemberships).values({companyId,principalType:"agent",principalId:agentId,status:"active"});
    await db.insert(issues).values({id:issueId,companyId,title:"PRIVATE native Task",visibility:"private",responsibleUserId:userId,createdByUserId:userId,assigneeAgentId:agentId});
    await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,responsibleUserId:userId,nativeIssueId:issueId,contextSnapshot:{issueId},runtimeMode:"native",status:"running"});
    const service=memoryService(db),human={principal:{type:"user" as const,userId}};
    const binding=await service.createCompanyBinding(companyId,{key:randomUUID(),name:"Native capture binding",providerKey:"local"},human);
    await service.addBindingTarget(companyId,binding.id,{targetType:"agent",targetId:agentId},human);
    source=await service.createPrivateMemory(companyId,agentId,{bindingId:binding.id,memoryType:"lesson",title:"Private native source",content:"PRIVATE native source payload",summary:null,
      sensitivity:"internal",observedAt:new Date().toISOString(),validFrom:null,validUntil:null,expiresAt:null,createdByOperationId:randomUUID(),evidence:[evidence("source")]},mutation());
    const row=source.record,version=row.updatedAt.toISOString();
    const decision:ContextAuthorityDecision={authorityRank:0,primaryForDomain:true,reason:"preferred_authority",evidence:{
      id:`memory:${row.id}`,companyId,sourceClass:"private_memory",sourceProvider:"august_works_memory",sourceType:"memory_record",sourceRef:`memory://record/${row.id}`,
      sourceVersion:version,sourceUpdatedAt:version,title:row.title,excerpt:row.content,observedAt:row.observedAt.toISOString(),validFrom:null,validUntil:null,
      authorityDomain:null,trustLevel:"low",sensitivity:"internal",citation:{label:"Native source"},metadata:{}}};
    await contextManifestService(db).create({companyId,agentId,runId,issueId,responsibleUserId:userId,query:"Source capture",policySnapshot:{},selected:[{decision}]});
    await db.update(heartbeatRuns).set({status:"succeeded",finishedAt:new Date()}).where(eq(heartbeatRuns.id,runId));
    // A real persisted lease fixture. The production claim/settle integration is
    // qualified separately by the original native job owner, not by this seed.
    await db.insert(memoryJobs).values({id:jobId,companyId,operationType:"capture",status:"running",jobKey:randomUUID(),sourceHeartbeatRunId:runId,
      executionOwnerId:ownerId,leaseExpiresAt:new Date(Date.now()+300000)});
  });
  function evidence(label:string){return {sourceClass:"task" as const,sourceProvider:"native_capture_fixture",sourceType:"outcome",sourceRef:`outcome://${label}`,sourceVersion:"1",sourceUpdatedAt:null,
    observedAt:new Date().toISOString(),excerptHash:createHash("sha256").update(label).digest("hex"),citation:{label},trustLevel:"low" as const,relation:"supports" as const};}
  function selectedMemoryDecision(record:typeof source.record):ContextAuthorityDecision{return {authorityRank:0,primaryForDomain:true,reason:"preferred_authority",evidence:{
    id:`memory:${record.id}`,companyId,sourceClass:record.scopeType==="agent"?"private_memory":"accepted_memory",sourceProvider:"august_works_memory",sourceType:"memory_record",
    sourceRef:`memory://record/${record.id}`,sourceVersion:record.updatedAt.toISOString(),sourceUpdatedAt:record.updatedAt.toISOString(),
    title:record.title!,excerpt:record.content,observedAt:record.observedAt.toISOString(),validFrom:null,validUntil:null,authorityDomain:null,
    trustLevel:"low",sensitivity:"internal",citation:{label:"Native Memory source"},metadata:{}}};}
  async function seedBoundTarget(tx:Db,input:{title:string;content:string;observedAt:string;evidence:ReturnType<typeof evidence>}){
    // Human-created current record fixture with an original structural owner
    // snapshot. This fixture does not qualify an Agent producer or its inputs.
    const [inserted]=await tx.insert(memoryRecords).values({companyId,bindingId:source.record.bindingId,providerKey:"local",memoryType:"lesson",
      scopeType:"company",title:input.title,content:input.content,summary:null,reviewState:"accepted",verificationState:"human_verified",
      sensitivityLabel:"internal",observedAt:new Date(input.observedAt),sourceProvenanceQualified:true,createdByActorType:"user",createdByActorId:userId,
      payloadSourceProtocolVersion:1}).returning();
    await tx.insert(memoryEvidence).values({companyId,memoryRecordId:inserted!.id,sourceClass:input.evidence.sourceClass,
      sourceProvider:input.evidence.sourceProvider,sourceType:input.evidence.sourceType,sourceRef:input.evidence.sourceRef,
      sourceVersion:input.evidence.sourceVersion,sourceUpdatedAt:null,observedAt:new Date(input.evidence.observedAt),
      excerptHash:input.evidence.excerptHash,citationJson:input.evidence.citation,trustLevel:input.evidence.trustLevel,
      supportsOrContradicts:input.evidence.relation});
    const [sealed]=await tx.update(memoryRecords).set({payloadSourceSnapshot:nativePayloadSnapshotSql("memory_record",
      {issueIds:[],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]},[])}).where(eq(memoryRecords.id,inserted!.id)).returning();
    if(!sealed?.payloadSourceSnapshot)throw new Error("Native Memory source snapshot fixture was not sealed");
    return sealed;
  }
  async function pinned<T>(inspect:(tx:Db,receipt:NativeMemoryCaptureReceipt)=>Promise<T>){
    return db.transaction(async raw=>{
      const tx=raw as unknown as Db;await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
      await tx.select().from(memoryJobs).where(eq(memoryJobs.id,jobId)).for("update");
      const [physical]=await tx.execute<{pid:number;xid:string}>(sql`select pg_backend_pid() as pid,pg_current_xact_id()::text as xid`);
      return inspect(tx,{jobId,executionOwnerId:ownerId,backendPid:physical!.pid,transactionId:physical!.xid});
    });
  }
  it("retains backend and top-level xid through candidate and analytical child savepoints",async()=>{
    await pinned((tx,receipt)=>withNativeMemoryCaptureSources(tx,companyId,actor(),receipt,async()=>{
      const identities=[];
      for(const surface of [tx])identities.push((await surface.execute(sql`select pg_backend_pid() as pid,pg_current_xact_id()::text as xid`))[0]);
      await tx.transaction(async child=>{
        identities.push((await child.execute(sql`select pg_backend_pid() as pid,pg_current_xact_id()::text as xid`))[0]);
        await child.transaction(async nested=>{
          identities.push((await nested.execute(sql`select pg_backend_pid() as pid,pg_current_xact_id()::text as xid`))[0]);
          await assertNativeMemoryCaptureSourcePrincipal(nested as unknown as Db,companyId,actor());
          expect(await canActorReadMemorySources(nested as unknown as Db,companyId,actor(),source.record.id)).toBe(true);
        });
      });
      expect(identities).toEqual(Array(3).fill({pid:receipt.backendPid,xid:receipt.transactionId}));
      await expect(withNativeMemoryCaptureSources(tx,companyId,actor(),{...receipt,transactionId:"0"},async()=>true))
        .rejects.toMatchObject({status:403});
    }));
  });
  it("denies another pooled connection despite an inherited active callback purpose",async()=>{
    await pinned((tx,receipt)=>withNativeMemoryCaptureSources(tx,companyId,actor(),receipt,async()=>{
      const [other]=await db.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
      expect(other!.pid).not.toBe(receipt.backendPid);
      await expect(assertNativeMemoryCaptureSourcePrincipal(db,companyId,actor())).rejects.toMatchObject({status:403});
      expect(await canActorReadMemorySources(db,companyId,actor(),source.record.id)).toBe(false);
    }));
  });
  it("expires escaped callbacks and leaves completed-run get and analytical reads denied",async()=>{
    let release!:()=>void,escaped!:Promise<boolean>;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    await pinned(async(tx,receipt)=>{
      await withNativeMemoryCaptureSources(tx,companyId,actor(),receipt,async()=>{
        escaped=gate.then(()=>canActorReadMemorySources(tx,companyId,actor(),source.record.id));
        expect(await canActorReadMemorySources(tx,companyId,actor(),source.record.id)).toBe(true);
      });
      release();
      // Keep the same physical transaction alive: denial comes from the ended
      // purpose, not from a closed connection or a transaction error.
      await expect(escaped).resolves.toBe(false);
    });
    await expect(memoryService(db).get(companyId,source.record.id,mutation())).resolves.toBeNull();
    await expect(withNativeAnalyticalReader(db,companyId,actor(),async()=>true,"task")).rejects.toMatchObject({status:403});
  });
  it("rechecks live lease changes within the same physical transaction",async()=>{
    await expect(pinned((tx,receipt)=>withNativeMemoryCaptureSources(tx,companyId,actor(),receipt,async()=>{
      await tx.update(memoryJobs).set({leaseExpiresAt:new Date(Date.now()-1000)}).where(eq(memoryJobs.id,jobId));
      await assertNativeMemoryCaptureSourcePrincipal(tx,companyId,actor());
    }))).rejects.toMatchObject({status:403});
  });
  it("keeps actual account, Human membership and Agent pins after purpose exit until outer commit",async()=>{
    const probes=[
      sql`select id from ${authUsers} where id=${userId} for update nowait`,
      sql`select id from company_memberships where company_id=${companyId}::uuid and principal_type='user' and principal_id=${userId} for update nowait`,
      sql`select id from ${agents} where id=${agentId}::uuid for update nowait`,
    ];
    await pinned(async(tx,receipt)=>{
      await withNativeMemoryCaptureSources(tx,companyId,actor(),receipt,async()=>true);
      for(const probe of probes){
        const error=await db.transaction(other=>other.execute(probe)).then(()=>null,error=>error);
        expect(error).toBeTruthy();
        expect(error.code??error.cause?.code).toBe("55P03");
      }
    });
    // The same actual probes succeed after commit, proving both the lock's
    // lifetime and release, rather than relying on a mock invocation count.
    for(const probe of probes)await db.transaction(other=>other.execute(probe));
  });
  it("captures and replays a completed producer without returning private record data or losing semantic dedup",async()=>{
    const operationId=randomUUID(),fingerprint="a".repeat(64);
    const input={bindingId:source.record.bindingId,memoryType:"lesson",scope:{type:"company",id:null},title:"Distinct captured lesson",content:"A distinct native lesson",summary:null,
      sensitivity:"internal",observedAt:new Date().toISOString(),validFrom:null,validUntil:null,expiresAt:null,createdByOperationId:operationId,
      metadata:{postRunExtractionFingerprint:fingerprint},evidence:[evidence("new")]};
    await pinned(async(tx,receipt)=>{
      const publications:ActivityPublication[]=[];
      const service=memoryService(tx,{nativeCaptureReceipt:receipt,postCommitPublications:publications});
      expect(await service.captureCandidate(companyId,input,mutation())).toEqual({resolutionKind:"new",replayed:false});
      expect(await service.captureCandidate(companyId,input,mutation())).toEqual({resolutionKind:"duplicate",replayed:true});
      await expect(service.captureCandidate(companyId,{...input,metadata:{postRunExtractionFingerprint:"b".repeat(64)}},mutation()))
        .rejects.toMatchObject({status:409,details:{code:"memory_operation_conflict"}});
      const duplicate={...input,createdByOperationId:randomUUID()};
      expect(await service.captureCandidate(companyId,duplicate,mutation())).toEqual({resolutionKind:"duplicate",replayed:false});
      const [persisted]=await tx.select().from(memoryRecords).where(eq(memoryRecords.createdByOperationId,operationId));
      expect(persisted!.sourceMemoryIds).toContain(source.record.id);
      expect(publications.length).toBeGreaterThan(0);
    });
    const rows=await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),eq(memoryRecords.createdByOperationId,operationId)));
    expect(rows).toHaveLength(1);
    expect(await memoryService(db).get(companyId,rows[0]!.id,mutation())).toBeNull();
  });
  it("invalidates a duplicate target through receipt-backed capture without returning its body",async()=>{
    const operationId=randomUUID(),fingerprint="c".repeat(64);
    const matchingEvidence=evidence("expansion");
    const input={bindingId:source.record.bindingId,memoryType:"lesson",scope:{type:"company",id:null},title:"Captured expansion claim",
      content:"The same reviewed capture after selecting another Memory root",summary:null,sensitivity:"internal",observedAt:new Date().toISOString(),
      validFrom:null,validUntil:null,expiresAt:null,createdByOperationId:operationId,metadata:{postRunExtractionFingerprint:fingerprint},evidence:[matchingEvidence]};
    await pinned(async(tx,receipt)=>{
      const publications:ActivityPublication[]=[],service=memoryService(tx,{nativeCaptureReceipt:receipt,postCommitPublications:publications});
      const target=await seedBoundTarget(tx,{title:input.title,content:input.content,observedAt:input.observedAt,evidence:matchingEvidence});
      expect(target.payloadSourceSnapshot).not.toBeNull();
      expect(await service.captureCandidate(companyId,input,mutation())).toEqual({resolutionKind:"duplicate",replayed:false});
      const [after]=await tx.select().from(memoryRecords).where(eq(memoryRecords.id,target.id));
      expect(after!.sourceMemoryIds).toContain(source.record.id);
      expect(after!.payloadSourceSnapshot).toBeNull();
      expect(after!.payloadSourceSnapshotInvalidated).toBe(true);
      expect(await memoryService(tx).get(companyId,target.id,mutation())).toBeNull();
    });
  });
  it("rejects receipt-backed duplicate capture when the staged Context root would create a source cycle",async()=>{
    const operationId=randomUUID(),fingerprint="d".repeat(64);
    const matchingEvidence=evidence("cycle");
    const input={bindingId:source.record.bindingId,memoryType:"lesson",scope:{type:"company",id:null},title:"Cycle-controlled capture",
      content:"A current source graph must remain acyclic",summary:null,sensitivity:"internal",observedAt:new Date().toISOString(),
      validFrom:null,validUntil:null,expiresAt:null,createdByOperationId:operationId,metadata:{postRunExtractionFingerprint:fingerprint},evidence:[matchingEvidence]};
    await pinned(async(tx,receipt)=>{
      const service=memoryService(tx,{nativeCaptureReceipt:receipt,postCommitPublications:[]});
      const before=await seedBoundTarget(tx,{title:input.title,content:input.content,observedAt:input.observedAt,evidence:matchingEvidence});
      let cyclicRoot!:Awaited<ReturnType<ReturnType<typeof memoryService>["createPrivateMemory"]>>;
      await withNativeMemoryCaptureSources(tx,companyId,actor(),receipt,async()=>{
        await contextManifestService(tx).create({companyId,agentId,runId,issueId,responsibleUserId:userId,authorizationActor:actor(),
          query:"Create a retained Memory dependency on the target",policySnapshot:{},selected:[{decision:selectedMemoryDecision(before)}]});
        cyclicRoot=await memoryService(tx).createPrivateMemory(companyId,agentId,{bindingId:source.record.bindingId,memoryType:"lesson",
          title:"Source that depends on the target",content:"This root already depends on the target",summary:null,sensitivity:"internal",
          observedAt:new Date().toISOString(),validFrom:null,validUntil:null,expiresAt:null,createdByOperationId:randomUUID(),evidence:[evidence("cycle-root")]},mutation());
        await contextManifestService(tx).create({companyId,agentId,runId,issueId,responsibleUserId:userId,authorizationActor:actor(),
          query:"Select the dependent source",policySnapshot:{},selected:[{decision:selectedMemoryDecision(cyclicRoot.record)}]});
      });
      await expect(service.captureCandidate(companyId,input,mutation())).rejects.toMatchObject({
        status:409,details:{code:"memory_resolution_source_conflict"},
      });
      const [after]=await tx.select().from(memoryRecords).where(eq(memoryRecords.id,before.id));
      expect(after).toEqual(before);
      expect(after!.sourceMemoryIds).not.toContain(cyclicRoot.record.id);
      expect(after!.payloadSourceSnapshot).not.toBeNull();
      expect(after!.payloadSourceSnapshotInvalidated).toBe(false);
    });
  });
  async function learnedRevision(rootId:string){
    const [document]=await db.insert(documents).values({companyId,latestBody:"Learned Foundation"}).returning();
    const [revision]=await db.insert(documentRevisions).values({companyId,documentId:document!.id,revisionNumber:1,body:"Learned Foundation"}).returning();
    const [cycle]=await db.insert(learningCycles).values({companyId,scopeType:"company",purpose:"native_task_execution",trigger:"Verified outcome",maxHypotheses:2,maxEvaluations:2,outcomeVersions:{},createdBy:userId}).returning();
    const [root]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,rootId));
    await db.insert(learningEvidence).values({companyId,cycleId:cycle!.id,memoryRecordId:rootId,sourceVersion:root!.updatedAt.toISOString()});
    const [hypothesis]=await db.insert(learningHypotheses).values({companyId,cycleId:cycle!.id,claim:"Learned claim",predictedEffect:"Review",targetDomain:"skill",targetId:randomUUID(),riskClass:"low"}).returning();
    const [evaluation]=await db.insert(learningEvaluations).values({companyId,hypothesisId:hypothesis!.id,method:"manual_review",result:"inconclusive",cases:[],outcomeVersions:{},metrics:{},limitations:[],reviewedBy:userId}).returning();
    const [candidate]=await db.insert(learningDomainCandidates).values({companyId,hypothesisId:hypothesis!.id,evaluationId:evaluation!.id,targetDomain:"skill",targetId:hypothesis!.targetId,candidateId:randomUUID(),candidateHash:"fixture"}).returning();
    await db.insert(learningRetainedAssets).values({companyId,candidateLinkId:candidate!.id,assetType:"document_revision",assetId:revision!.id});
    return revision!.id;
  }
  it("keeps a completed-producer Foundation/Learning diamond readable and a real source cycle denied",async()=>{
    const revisionId=await learnedRevision(source.record.id);
    await pinned((tx,receipt)=>withNativeMemoryCaptureSources(tx,companyId,actor(),receipt,async()=>{
      expect((await authorizationService(tx).decide({actor:actor(),action:"foundation:read",resource:{type:"company",companyId},enforceResponsibleUserIntersection:true})).allowed).toBe(true);
      await expect(assertLearnedAssetAnalyticalSources(tx,companyId,"document_revision",revisionId,actor(),"task")).resolves.toMatchObject({cycles:[]});
      const topId=randomUUID();
      await tx.insert(memoryRecords).values({...source.record,id:topId,scopeType:"company",scopeId:null,ownerAgentId:null,
        sourceMemoryIds:[source.record.id],sourceFoundationRevisionIds:[revisionId],createdByOperationId:randomUUID()});
      expect(await canActorReadMemorySources(tx,companyId,actor(),topId)).toBe(true);
      // Actual persisted retained-edge cycle; no caller metadata supplies it.
      await tx.update(memoryRecords).set({sourceFoundationRevisionIds:[revisionId]}).where(eq(memoryRecords.id,source.record.id));
      expect(await canActorReadMemorySources(tx,companyId,actor(),source.record.id)).toBe(false);
    }));
  });
});
