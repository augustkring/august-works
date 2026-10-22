import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, contextManifests, contextManifestMemoryRoots, createDb, heartbeatRuns, issues, issueComments, memoryBindings, memoryBindingTargets, memoryRecords, memoryModels, memoryModelVersions, memoryModelEvidence, memoryObservations, memoryObservationEvidence } from "@paperclipai/db";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { contextManifestService } from "../services/context/context-manifest.js";
import { canActorReadMemorySources, lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
import { initializeRunIdentity, reserveSteeredIdentity, acceptSteeredIdentity } from "../services/run-identity.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { memoryService } from "../services/memory/memory-service.js";

describe("Private ordinary payloads retain current source authority without analytical roots", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string, foreignCompanyId: string, ownerId: string, otherId: string;
  let agentId: string, issueId: string, runId: string, otherRunId: string;
  const human = (userId: string): AuthorizationActor => ({ type: "board", source: "session", userId });
  const worker = (userId: string, id: string): AuthorizationActor => ({
    type: "agent", source: "agent_jwt", companyId, agentId, runId: id, onBehalfOfUserId: userId,
  });
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("blentera-v10-private-payload-");
    db = createDb(database.connectionString);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    companyId = randomUUID(); foreignCompanyId = randomUUID(); ownerId = randomUUID(); otherId = randomUUID();
    agentId = randomUUID(); issueId = randomUUID(); runId = randomUUID(); otherRunId = randomUUID();
    await db.insert(companies).values([companyId, foreignCompanyId].map(id => ({ id, name: "Payload fixture", issuePrefix: randomUUID() })));
    await db.insert(authUsers).values([ownerId, otherId].map(id => ({
      id, name: "Payload reader", email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date(),
    })));
    await db.insert(companyMemberships).values([ownerId, otherId].map(principalId => ({
      companyId, principalType: "user", principalId, status: "active", membershipRole: "admin",
    })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Shared agent", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(issues).values({
      id: issueId, companyId, title: "PRIVATE ordinary source", visibility: "private",
      createdByUserId: ownerId, responsibleUserId: ownerId, assigneeAgentId: agentId,
    });
    const otherTaskId = randomUUID();
    await db.insert(issues).values({ id: otherTaskId, companyId, title: "Other work", responsibleUserId: otherId, assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values([
      { id: runId, companyId, agentId, responsibleUserId: ownerId, status: "running", runtimeMode: "native", nativeIssueId: issueId },
      { id: otherRunId, companyId, agentId, responsibleUserId: otherId, status: "running", runtimeMode: "native", nativeIssueId: otherTaskId },
    ]);
  });

  it("allows the current owner but withholds both task and run from another company administrator", async () => {
    for (const scope of [{ issueId }, { runId }]) {
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, human(ownerId), scope)).resolves.toBeUndefined();
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, human(otherId), scope)).rejects.toMatchObject({ status: 403 });
    }
  });
  it("does not transfer private history through the same agent serving another human", async () => {
    for (const scope of [{ issueId }, { runId }]) {
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, worker(ownerId, runId), scope)).resolves.toBeUndefined();
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, worker(otherId, otherRunId), scope)).rejects.toMatchObject({ status: 403 });
    }
  });
  it("rechecks membership after an earlier successful read", async () => {
    await assertAnalyticalContextPayloadAccess(db, companyId, human(ownerId), { runId });
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, ownerId),
    ));
    for (const scope of [{ issueId }, { runId }]) {
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, human(ownerId), scope)).rejects.toMatchObject({ status: 403 });
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, worker(ownerId, runId), scope)).rejects.toMatchObject({ status: 403 });
    }
  });
  it("withholds foreign, missing and unauthenticated source scopes", async () => {
    for (const scope of [{ issueId }, { runId }]) {
      await expect(assertAnalyticalContextPayloadAccess(db, foreignCompanyId, human(ownerId), scope)).rejects.toMatchObject({ status: 403 });
      await expect(assertAnalyticalContextPayloadAccess(db, companyId, undefined, scope)).rejects.toMatchObject({ status: 403 });
    }
    await expect(assertAnalyticalContextPayloadAccess(db, companyId, human(ownerId), { issueId: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await expect(assertAnalyticalContextPayloadAccess(db, companyId, human(ownerId), { runId: randomUUID() })).rejects.toMatchObject({ status: 403 });
  });
  it.each(["private", "open"] as const)("reauthorizes after waiting for the existing Context privacy transaction (%s)", async visibility => {
    if (visibility === "open") await db.update(issues).set({visibility}).where(eq(issues.id,issueId));
    let release!: () => void;
    let ready!: (pid: number) => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const readyPid = new Promise<number>(resolve => { ready = resolve; });
    const blocker = db.transaction(async tx => {
      await lockMemoryPrivacy(tx as unknown as typeof db, companyId);
      const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      ready(row!.pid);
      await held;
    });
    const pid = await readyPid;
    const pending = contextManifestService(db).create({
      companyId, agentId, issueId, runId, responsibleUserId: ownerId,
      query: "Private context", policySnapshot: {}, selected: [],
    }).then(value => ({ value }), error => ({ error }));
    try {
      const until = Date.now() + 8000;
      let waiting = false;
      while (Date.now() < until) {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(
          select 1 from pg_stat_activity where ${pid}::integer=any(pg_blocking_pids(pid))) as waiting`);
        if (row?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await db.update(companyMemberships).set({ status: "suspended" }).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, ownerId),
      ));
    } finally {
      release();
      await blocker;
    }
    expect(await pending).toMatchObject({ error: { status: 403 } });
    expect(await db.select().from(contextManifests).where(eq(contextManifests.companyId, companyId))).toHaveLength(0);
  });
  async function taskSelection(): Promise<{ decision: ContextAuthorityDecision }> {
    const [task] = await db.select().from(issues).where(eq(issues.id, issueId));
    return { decision: {
      authorityRank: 0, primaryForDomain: true, reason: "preferred_authority",
      evidence: {
        id: `task:${issueId}`, companyId, sourceClass: "task", sourceProvider: "august_works_tasks",
        sourceType: "issue", sourceRef: `issue://${issueId}`, title: task!.title, excerpt: "PRIVATE selected task",
        sourceVersion: task!.updatedAt.toISOString(), sourceUpdatedAt: task!.updatedAt.toISOString(),
        observedAt: new Date().toISOString(), validFrom: null, validUntil: null, authorityDomain: "task_state",
        trustLevel: "high", sensitivity: "internal", citation: { label: "Private task" }, metadata: {},
      },
    } };
  }
  it("checks selected source tasks independently of the readable destination run", async () => {
    const selected = [await taskSelection()];
    const ownerCopy = await contextManifestService(db).create({
      companyId, agentId, issueId, runId, responsibleUserId: ownerId,
      query: "Authorized source", policySnapshot: {}, selected,
    });
    expect(ownerCopy.items).toHaveLength(1);
    await expect(contextManifestService(db).create({
      companyId, agentId, runId: otherRunId, responsibleUserId: otherId,
      query: "Unauthorized copied source", policySnapshot: {}, selected,
    })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(contextManifests).where(eq(contextManifests.companyId, companyId))).toHaveLength(1);
  });
  it("refuses a task payload changed after retrieval without persisting a partial manifest", async () => {
    const selected = [await taskSelection()];
    await db.update(issues).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(issues.id, issueId));
    await expect(contextManifestService(db).create({
      companyId, agentId, issueId, runId, responsibleUserId: ownerId,
      query: "Stale source", policySnapshot: {}, selected,
    })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(contextManifests).where(eq(contextManifests.companyId, companyId))).toHaveLength(0);
  });
  it("rechecks source authority after waiting for the selected task row without a version change", async () => {
    const selected = [await taskSelection()];
    let release!: () => void;
    let ready!: (pid: number) => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const readyPid = new Promise<number>(resolve => { ready = resolve; });
    const blocker = db.transaction(async tx => {
      await tx.select({id:issues.id}).from(issues).where(eq(issues.id,issueId)).for("update");
      const [row] = await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
      ready(row!.pid);
      await held;
    });
    const pid = await readyPid;
    const pending = contextManifestService(db).create({
      companyId,agentId,issueId,runId,responsibleUserId:ownerId,
      query:"Selected row wait",policySnapshot:{},selected,
    }).then(value=>({value}),error=>({error}));
    try {
      const until = Date.now()+8000;
      let waiting = false;
      while(Date.now()<until){
        const [row]=await db.execute<{waiting:boolean}>(sql`select exists(
          select 1 from pg_stat_activity where ${pid}::integer=any(pg_blocking_pids(pid))) as waiting`);
        if(row?.waiting){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await db.update(companyMemberships).set({status:"suspended"}).where(and(
        eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,ownerId),
      ));
    }finally{release();await blocker;}
    expect(await pending).toMatchObject({error:{status:403}});
    expect(await db.select().from(contextManifests).where(eq(contextManifests.companyId,companyId))).toHaveLength(0);
  });
  const memoryActor = (userId:string,id:string) => ({
    principal:{type:"agent" as const,agentId,responsibleUserId:userId},runId:id,
  });
  async function privateMemoryBinding() {
    const [binding] = await db.insert(memoryBindings).values({companyId,key:randomUUID(),name:"Memory fixture",providerKey:"local"}).returning();
    await db.insert(memoryBindingTargets).values({companyId,bindingId:binding!.id,targetType:"agent",targetId:agentId});
    return binding!;
  }
  async function privateMemory(producerRunId=runId) {
    const binding = await privateMemoryBinding();
    return memoryService(db).createPrivateMemory(companyId,agentId,{
      bindingId:binding.id,memoryType:"lesson",title:"Private source lesson",content:"PRIVATE retained source",
      summary:null,sensitivity:"internal",validFrom:null,validUntil:null,expiresAt:null,
      observedAt:new Date().toISOString(),createdByOperationId:randomUUID(),
      // These strings are citation claims, never the actual producer binding.
      metadata:{sourceRunId:otherRunId,sourcePrivacyQualified:true},
      evidence:[{sourceClass:"task",sourceProvider:"caller_claim",sourceType:"issue",sourceRef:`issue://${randomUUID()}`,
        sourceVersion:null,sourceUpdatedAt:null,observedAt:new Date().toISOString(),
        excerptHash:createHash("sha256").update("PRIVATE retained source").digest("hex"),
        citation:{label:"Caller citation"},trustLevel:"low",relation:"supports"}],
    },memoryActor(ownerId,producerRunId));
  }
  it("withholds Memory captured by the same agent for another human, ignoring copied producer metadata", async () => {
    const created = await privateMemory();
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(ownerId,runId)))
      .resolves.toMatchObject({record:{content:"PRIVATE retained source"}});
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(otherId,otherRunId))).resolves.toBeNull();
    const eligible = await memoryService(db).listEligible(companyId,{scopeType:"agent",scopeId:agentId},memoryActor(otherId,otherRunId));
    expect(eligible.map(row=>row.id)).not.toContain(created.record.id);
    const exported = await memoryService(db).export(companyId,memoryActor(otherId,otherRunId));
    expect(JSON.stringify(exported)).not.toContain("PRIVATE retained source");
  });
  it("does not classify unqualified historical Memory as publicly readable", async () => {
    const binding = await privateMemoryBinding();
    const [historical] = await db.insert(memoryRecords).values({companyId,bindingId:binding.id,providerKey:"local",
      memoryType:"lesson",scopeType:"agent",scopeId:agentId,ownerAgentId:agentId,content:"PRIVATE unknown provenance",
      reviewState:"accepted",observedAt:new Date(),createdByActorType:"agent",createdByActorId:agentId}).returning();
    await expect(memoryService(db).get(companyId,historical!.id,memoryActor(ownerId,runId))).resolves.toBeNull();
  });
  it("withholds captured Memory after its source membership is suspended", async () => {
    const created = await privateMemory();
    await db.update(companyMemberships).set({status:"suspended"}).where(and(
      eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,ownerId),
    ));
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(ownerId,runId))).resolves.toBeNull();
  });
  it("denies cyclic Memory lineage while allowing a complete diamond", async () => {
    const binding = await privateMemoryBinding();
    const ids = Array.from({length:4},()=>randomUUID());
    await db.insert(memoryRecords).values(ids.map((id,index)=>({
      id,companyId,bindingId:binding.id,providerKey:"local",memoryType:"lesson" as const,
      scopeType:"company" as const,content:"Explicit source-free fixture",
      sourceProvenanceQualified:true,sourceMemoryIds:index===0?[ids[1]!,ids[2]!]:index===3?[]:[ids[3]!],
      observedAt:new Date(),createdByActorType:"user" as const,createdByActorId:ownerId,
    })));
    await expect(canActorReadMemorySources(db,companyId,human(ownerId),ids[0]!)).resolves.toBe(true);
    await db.update(memoryRecords).set({sourceMemoryIds:[ids[0]!]}).where(eq(memoryRecords.id,ids[3]!));
    await expect(canActorReadMemorySources(db,companyId,human(ownerId),ids[0]!)).resolves.toBe(false);
  });
  it("does not admit source-free Memory through a membership whose actual account was deleted", async () => {
    const binding=await privateMemoryBinding();
    const [record]=await db.insert(memoryRecords).values({companyId,bindingId:binding.id,providerKey:"local",
      memoryType:"lesson",scopeType:"company",content:"Explicit source-free fixture",sourceProvenanceQualified:true,
      observedAt:new Date(),createdByActorType:"user",createdByActorId:ownerId}).returning();
    await expect(canActorReadMemorySources(db,companyId,human(ownerId),record!.id)).resolves.toBe(true);
    await db.delete(authUsers).where(eq(authUsers.id,ownerId));
    await expect(canActorReadMemorySources(db,companyId,human(ownerId),record!.id)).resolves.toBe(false);
  });
  it("withholds Memory when its current reader agent is paused", async () => {
    const created=await privateMemory();
    await db.update(agents).set({status:"paused"}).where(eq(agents.id,agentId));
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(ownerId,runId))).resolves.toBeNull();
  });
  it("applies Memory source authority before both eligible and reviewable result limits", async () => {
    const binding=await privateMemoryBinding();
    const now=new Date();
    const [readable]=await db.insert(memoryRecords).values({companyId,bindingId:binding.id,providerKey:"local",
      memoryType:"lesson",scopeType:"company",content:"Readable last result",sourceProvenanceQualified:true,
      reviewState:"accepted",observedAt:now,updatedAt:now,createdByActorType:"user",createdByActorId:ownerId}).returning();
    await db.insert(memoryRecords).values(Array.from({length:3},(_,i)=>({companyId,bindingId:binding.id,providerKey:"local",
      memoryType:"lesson" as const,scopeType:"company" as const,content:"PRIVATE preceding result",sourceProvenanceQualified:true,
      sourceIssueIds:[issueId],reviewState:"accepted" as const,observedAt:new Date(now.getTime()+i+1),
      updatedAt:new Date(now.getTime()+i+1),createdByActorType:"user" as const,createdByActorId:ownerId})));
    const actor={principal:{type:"user" as const,userId:otherId}};
    expect((await memoryService(db).listEligible(companyId,{limit:1},actor)).map(row=>row.id)).toEqual([readable!.id]);
    expect((await memoryService(db).listReviewable(companyId,{limit:1},actor)).map(row=>row.id)).toEqual([readable!.id]);
  });

  it.each(["issue", "run"] as const)("retains ordinary private Memory Context authority on a public destination %s without analytical roots", async kind=>{
    const created=await privateMemory();
    const destinationId=randomUUID(),destinationRunId=randomUUID();
    await db.insert(issues).values({id:destinationId,companyId,title:"Public destination",
      responsibleUserId:ownerId,assigneeAgentId:agentId,createdByUserId:ownerId});
    await db.insert(heartbeatRuns).values({id:destinationRunId,companyId,agentId,responsibleUserId:ownerId,
      runtimeMode:"native",nativeIssueId:destinationId,status:"running"});
    const source=await taskSelection();
    source.decision.evidence={...source.decision.evidence,sourceClass:"private_memory",sourceProvider:"august_works_memory",
      sourceType:"record",sourceRef:`memory://record/${created.record.id}`,sourceVersion:created.record.updatedAt.toISOString(),
      metadata:{recordId:created.record.id},excerpt:"PRIVATE retained Memory Context"};
    await contextManifestService(db).create({companyId,agentId,runId:destinationRunId,responsibleUserId:ownerId,
      query:"Copied ordinary private source",policySnapshot:{},selected:[source]});
    const scope=kind==="issue"?{issueId:destinationId}:{runId:destinationRunId};
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,human(ownerId),scope)).resolves.toBeUndefined();
    await expect(assertAnalyticalContextPayloadAccess(db,companyId,human(otherId),scope)).rejects.toMatchObject({status:403});
  });
  it("retains a run-only manifest's actual task binding and refuses a different caller task", async()=>{
    const result=await contextManifestService(db).create({companyId,agentId,runId,responsibleUserId:ownerId,
      query:"Actual run binding",policySnapshot:{},selected:[]});
    expect(result.manifest.issueId).toBe(issueId);
    const [otherRun]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,otherRunId));
    await expect(contextManifestService(db).create({companyId,agentId,runId,issueId:otherRun!.issueId!,responsibleUserId:ownerId,
      query:"Caller substituted binding",policySnapshot:{},selected:[]})).rejects.toMatchObject({status:403});
  });

  it("takes the existing company lock before Memory when reading a retained copy", async()=>{
    const created=await privateMemory();
    let release!:()=>void,ready!:(pid:number)=>void,tryMemory!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const readyPid=new Promise<number>(resolve=>{ready=resolve;});
    const attempt=new Promise<void>(resolve=>{tryMemory=resolve;});
    let acquired=false;
    const blocker=db.transaction(async tx=>{
      await lockAnalyticalCompany(tx as unknown as typeof db,companyId);
      const [row]=await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
      ready(row!.pid);
      await attempt;
      const [result]=await tx.execute<{acquired:boolean}>(sql`select pg_try_advisory_xact_lock(hashtextextended(${`memory:privacy:${companyId}`},0)) as acquired`);
      acquired=result!.acquired;
      await held;
    });
    const pid=await readyPid;
    const pending=memoryService(db).get(companyId,created.record.id,memoryActor(ownerId,runId));
    try{
      let waiting=false;
      const until=Date.now()+8000;
      while(Date.now()<until){
        const [row]=await db.execute<{waiting:boolean}>(sql`select exists(select 1 from pg_stat_activity where ${pid}::integer=any(pg_blocking_pids(pid))) as waiting`);
        if(row?.waiting){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
    }finally{tryMemory();release();await blocker;}
    expect(acquired).toBe(true);
    await expect(pending).resolves.toMatchObject({record:{id:created.record.id}});
  });
  it.each(["eligible","reviewable"] as const)("rechecks %s Memory list admission after its native privacy lock wait",async kind=>{
    let release!:()=>void,ready!:(pid:number)=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const readyPid=new Promise<number>(resolve=>{ready=resolve;});
    const blocker=db.transaction(async tx=>{
      await lockMemoryPrivacy(tx as unknown as typeof db,companyId);
      const [row]=await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
      ready(row!.pid);await held;
    });
    const pid=await readyPid,actor={principal:{type:"user" as const,userId:ownerId}};
    const pending=(kind==="eligible"?memoryService(db).listEligible(companyId,{limit:1},actor):
      memoryService(db).listReviewable(companyId,{limit:1},actor)).then(value=>({value}),error=>({error}));
    try{
      let waiting=false;
      const until=Date.now()+8000;
      while(Date.now()<until){
        const [row]=await db.execute<{waiting:boolean}>(sql`select exists(select 1 from pg_stat_activity where ${pid}::integer=any(pg_blocking_pids(pid))) as waiting`);
        if(row?.waiting){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await db.update(companyMemberships).set({status:"suspended"}).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,ownerId)));
    }finally{release();await blocker;}
    expect(await pending).toMatchObject({error:{status:403}});
  });

  it("keeps private agent Memory bound to its Human even when its producer run has company scope",async()=>{
    const producerRunId=randomUUID();
    await db.insert(heartbeatRuns).values({id:producerRunId,companyId,agentId,responsibleUserId:ownerId,runtimeMode:"native",status:"running"});
    const created=await privateMemory(producerRunId);
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(ownerId,runId))).resolves.toMatchObject({record:{id:created.record.id}});
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(otherId,otherRunId))).resolves.toBeNull();
  });
  it("does not admit another agent's private Memory through the same Human's Context",async()=>{
    const producerRunId=randomUUID();
    await db.insert(heartbeatRuns).values({id:producerRunId,companyId,agentId,responsibleUserId:ownerId,runtimeMode:"native",status:"running"});
    const created=await privateMemory(producerRunId),readerAgentId=randomUUID(),readerTaskId=randomUUID(),readerRunId=randomUUID();
    await db.insert(agents).values({id:readerAgentId,companyId,name:"Other agent",role:"engineer",status:"idle",adapterType:"paperclip_runner"});
    await db.insert(issues).values({id:readerTaskId,companyId,title:"Other agent task",responsibleUserId:ownerId,assigneeAgentId:readerAgentId});
    await db.insert(heartbeatRuns).values({id:readerRunId,companyId,agentId:readerAgentId,responsibleUserId:ownerId,
      runtimeMode:"native",nativeIssueId:readerTaskId,status:"running"});
    const selected=await taskSelection();
    selected.decision.evidence={...selected.decision.evidence,sourceClass:"private_memory",sourceProvider:"august_works_memory",
      sourceType:"memory_record",sourceRef:`memory://record/${created.record.id}`,sourceVersion:created.record.updatedAt.toISOString(),
      metadata:{recordId:created.record.id},excerpt:"PRIVATE other agent source"};
    await expect(contextManifestService(db).create({companyId,agentId:readerAgentId,runId:readerRunId,responsibleUserId:ownerId,
      query:"Unauthorized private Memory scope",policySnapshot:{},selected:[selected]})).rejects.toMatchObject({status:403});
  });

  it("does not transfer previously captured private Memory when native steering changes the same run's Human",async()=>{
    const sourceTaskId=randomUUID(),producerRunId=randomUUID();
    await db.insert(issues).values({id:sourceTaskId,companyId,title:"Public producer task",responsibleUserId:ownerId,assigneeAgentId:agentId});
    await db.insert(heartbeatRuns).values({id:producerRunId,companyId,agentId,responsibleUserId:ownerId,
      runtimeMode:"native",nativeIssueId:sourceTaskId,status:"running",contextSnapshot:{issueId:sourceTaskId}});
    await initializeRunIdentity(db,{companyId,runId:producerRunId,responsibleUserId:ownerId,issueId:sourceTaskId,cause:"dispatch"});
    const created=await privateMemory(producerRunId);
    const [message]=await db.insert(issueComments).values({companyId,issueId:sourceTaskId,authorUserId:otherId,body:"New responsible Human instruction"}).returning();
    const steering=await reserveSteeredIdentity(db,{companyId,runId:producerRunId,issueId:sourceTaskId,messageId:message!.id});
    expect(steering?.status).toBe("pending");
    // Exercise the native acknowledgement effect owner. This software fixture
    // does not claim an actual provider transport acknowledgement.
    await db.transaction(async tx=>acceptSteeredIdentity(tx,steering!));
    const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,producerRunId));
    expect(run!.responsibleUserId).toBe(otherId);
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(otherId,otherRunId))).resolves.toBeNull();
    await expect(memoryService(db).get(companyId,created.record.id,memoryActor(ownerId,runId))).resolves.toMatchObject({record:{id:created.record.id}});
  });

  it("does not let the same agent erase another Human's private Memory",async()=>{
    const producerRunId=randomUUID();
    await db.insert(heartbeatRuns).values({id:producerRunId,companyId,agentId,responsibleUserId:ownerId,runtimeMode:"native",status:"running"});
    const created=await privateMemory(producerRunId);
    await expect(memoryService(db).forget(companyId,created.record.id,memoryActor(otherId,otherRunId))).rejects.toMatchObject({status:404});
    const [retained]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,created.record.id));
    expect(retained!.deletedAt).toBeNull();
    expect(retained!.content).toBe("PRIVATE retained source");
  });

  it("does not let claimed derived metadata discard a direct private Memory Context source",async()=>{
    const created=await privateMemory();
    const selected=await taskSelection();
    selected.decision.evidence={...selected.decision.evidence,sourceClass:"private_memory",sourceProvider:"august_works_memory",
      sourceType:"memory_record",sourceRef:`memory://record/${created.record.id}`,sourceVersion:created.record.updatedAt.toISOString(),
      metadata:{recordId:created.record.id,derived:true,sourceMemoryIds:[]},excerpt:"PRIVATE source hidden by claimed empty roots"};
    await expect(contextManifestService(db).create({companyId,agentId,runId:otherRunId,responsibleUserId:otherId,
      query:"Forged empty provenance",policySnapshot:{},selected:[selected]})).rejects.toMatchObject({status:403});
  });

  it.each(["memory_model","memory_observation"] as const)("retains complete native %s roots even when metadata names only the public root",async type=>{
    const privateSource=await privateMemory(),binding=await privateMemoryBinding();
    const roots=await db.insert(memoryRecords).values([true,false].map(isPrivate=>({companyId,bindingId:binding.id,providerKey:"local",
      memoryType:"observation" as const,scopeType:"company" as const,content:isPrivate?"PRIVATE shared derivative":"Public source",
      sourceProvenanceQualified:true,sourceMemoryIds:isPrivate?[privateSource.record.id]:[],reviewState:"accepted" as const,
      observedAt:new Date(),createdByActorType:"user" as const,createdByActorId:ownerId}))).returning();
    const privateRoot=roots[0]!,publicRoot=roots[1]!,derivedId=randomUUID();
    if(type==="memory_model"){
      await db.insert(memoryModels).values({id:derivedId,companyId,modelKey:derivedId,name:"Combined model",scopeType:"company",
        purpose:"general_work",sourceQuery:"Combined sources",content:"PRIVATE combined result",status:"active",confidence:1,
        sensitivity:"internal",sourceWatermark:"a".repeat(64)});
      await db.insert(memoryModelVersions).values({companyId,modelId:derivedId,version:1,content:"PRIVATE combined result",sourceWatermark:"a".repeat(64)});
      await db.insert(memoryModelEvidence).values(roots.map(row=>({companyId,modelId:derivedId,modelVersion:1,memoryRecordId:row.id,
        sourceVersion:row.updatedAt.toISOString(),relationship:"derived_from"})));
    }else{
      await db.insert(memoryObservations).values({id:derivedId,companyId,observationKey:derivedId,scopeType:"company",purpose:"general_work",
        content:"PRIVATE combined result",status:"accepted",confidence:1,sensitivity:"internal",supportCount:2,contradictionCount:0,independentSourceCount:2});
      await db.insert(memoryObservationEvidence).values(roots.map(row=>({companyId,observationId:derivedId,memoryRecordId:row.id,
        sourceVersion:row.updatedAt.toISOString(),relationship:"supports",rootFingerprint:createHash("sha256").update(row.id).digest("hex")})));
    }
    const selected=await taskSelection();
    selected.decision.evidence={...selected.decision.evidence,sourceClass:"accepted_memory",sourceProvider:"august_works_derived_memory",
      sourceType:type,sourceRef:`memory://${type}/${derivedId}`,sourceVersion:"1",excerpt:"PRIVATE combined result",
      metadata:{derived:true,sourceMemoryIds:[publicRoot.id],sourceMemoryVersions:{[publicRoot.id]:publicRoot.updatedAt.toISOString()}}};
    await expect(contextManifestService(db).create({companyId,agentId,runId:otherRunId,responsibleUserId:otherId,
      query:"Incomplete claimed lineage",policySnapshot:{},selected:[selected]})).rejects.toMatchObject({status:403});
    const allowed=await contextManifestService(db).create({companyId,agentId,runId,responsibleUserId:ownerId,
      query:"Complete actual native lineage",policySnapshot:{},selected:[selected]});
    const retained=await db.select().from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId,allowed.manifest.id));
    expect(retained.map(row=>row.memoryRecordId).sort()).toEqual([privateRoot.id,publicRoot.id].sort());
  });
  it("keeps the original private Memory Human and scope immutable, then clears personal provenance on erasure",async()=>{
    const created=await privateMemory();
    await db.update(memoryRecords).set({privateOwnerUserId:otherId}).where(eq(memoryRecords.id,created.record.id));
    let [record]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,created.record.id));
    expect(record!.privateOwnerUserId).toBe(ownerId);
    await expect(db.update(memoryRecords).set({scopeType:"company",scopeId:null,ownerAgentId:null})
      .where(eq(memoryRecords.id,created.record.id))).rejects.toMatchObject({cause:{message:"private Memory scope identity is immutable"}});
    await memoryService(db).forget(companyId,created.record.id,memoryActor(ownerId,runId));
    [record]=await db.select().from(memoryRecords).where(eq(memoryRecords.id,created.record.id));
    expect(record!.privateOwnerUserId).toBeNull();
    expect(record!.sourceProvenanceQualified).toBe(false);
    expect(record!.content).toBe("");
  });
  it("rejects a Context after native steering changes its actual Human during the Context insert run-row wait",async()=>{
    const taskId=randomUUID(),producerRunId=randomUUID();
    await db.insert(issues).values({id:taskId,companyId,title:"Public steered task",responsibleUserId:ownerId,assigneeAgentId:agentId});
    await db.insert(heartbeatRuns).values({id:producerRunId,companyId,agentId,responsibleUserId:ownerId,
      runtimeMode:"native",nativeIssueId:taskId,status:"running",contextSnapshot:{issueId:taskId}});
    await initializeRunIdentity(db,{companyId,runId:producerRunId,responsibleUserId:ownerId,issueId:taskId,cause:"dispatch"});
    const [message]=await db.insert(issueComments).values({companyId,issueId:taskId,authorUserId:otherId,body:"New Human instruction"}).returning();
    const steering=await reserveSteeredIdentity(db,{companyId,runId:producerRunId,issueId:taskId,messageId:message!.id});
    expect(steering?.status).toBe("pending");
    let release!:()=>void,ready!:(pid:number)=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const readyPid=new Promise<number>(resolve=>{ready=resolve;});
    const blocker=db.transaction(async tx=>{
      await tx.select().from(issues).where(eq(issues.id,taskId)).for("update");
      await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,producerRunId)).for("update");
      const [row]=await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
      ready(row!.pid);await held;
      await acceptSteeredIdentity(tx,steering!);
    });
    const pid=await readyPid;
    const pending=contextManifestService(db).create({companyId,agentId,runId:producerRunId,responsibleUserId:ownerId,
      query:"Context queued before steering",policySnapshot:{},selected:[]}).then(value=>({value}),error=>({error}));
    try{
      let waiting=false;const until=Date.now()+8000;
      while(Date.now()<until){
        const [row]=await db.execute<{waiting:boolean}>(sql`select exists(select 1 from pg_stat_activity where ${pid}::integer=any(pg_blocking_pids(pid))) as waiting`);
        if(row?.waiting){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
    }finally{release();await blocker;}
    expect(await pending).toMatchObject({error:{status:403}});
    const [run]=await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,producerRunId));
    expect(run!.responsibleUserId).toBe(otherId);
    expect(await db.select().from(contextManifests).where(eq(contextManifests.runId,producerRunId))).toHaveLength(0);
  });

});
