import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, contextManifests, createDb, heartbeatRuns, issues, memoryBindings, memoryBindingTargets, memoryRecords } from "@paperclipai/db";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { contextManifestService } from "../services/context/context-manifest.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import type { ContextAuthorityDecision } from "@paperclipai/shared";
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
  async function privateMemory() {
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
    },memoryActor(ownerId,runId));
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
});
