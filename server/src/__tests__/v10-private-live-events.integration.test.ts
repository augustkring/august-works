import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { agentApiKeys, agents, authSessions, authUsers, companies, companyMemberships, contextManifests, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, projectAccessMembers, projects } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { analyticalLiveEventForReader } from "../services/analytical-live-events.js";
import { publishLiveEvent } from "../services/live-events.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";
import { canActorReadMemoryJob, memoryJobService } from "../services/memory/memory-jobs.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Private source identities at native live delivery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string, ownerId: string, readerId: string, privateIssueId: string, runId: string, projectId: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("blentera-private-live-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => database?.cleanup());
  beforeEach(async () => {
    companyId=randomUUID();ownerId=randomUUID();readerId=randomUUID();privateIssueId=randomUUID();runId=randomUUID();projectId=randomUUID();
    const now=new Date(),agentId=randomUUID(),publicIssueId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Native live fixture",issuePrefix:randomUUID()});
    await db.insert(authUsers).values([ownerId,readerId].map(id=>({id,name:"Current live reader",email:`${id}@example.test`,createdAt:now,updatedAt:now})));
    await db.insert(companyMemberships).values([ownerId,readerId].map(principalId=>({companyId,principalType:"user",principalId,status:"active",membershipRole:"admin"})));
    await db.insert(agents).values({id:agentId,companyId,name:"Native live worker",role:"engineer",status:"idle"});
    await db.insert(issues).values([
      {id:privateIssueId,companyId,title:"PRIVATE original task",visibility:"private",createdByUserId:ownerId,responsibleUserId:ownerId},
      {id:publicIssueId,companyId,title:"Independent public task",responsibleUserId:ownerId},
    ]);
    await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,nativeIssueId:publicIssueId,runtimeMode:"native",status:"running",responsibleUserId:ownerId});
    // Explicit source-free software prerequisite, not historical qualification.
    await db.insert(projects).values({id:projectId,companyId,name:"PRIVATE original project",visibility:"private",privacyOwnerUserId:ownerId,sourceProvenanceQualified:true});
    await db.insert(projectAccessMembers).values({companyId,projectId,subjectType:"user",subjectId:ownerId});
  });
  const actor=(userId:string)=>({type:"board" as const,source:"session" as const,userId});
  const event=(payload:Record<string,unknown>,type:LiveEvent["type"]="activity.logged"):LiveEvent=>({id:1,companyId,type,createdAt:new Date().toISOString(),payload});
  it("withholds an inaccessible task event including its identity and loss placeholder",async()=>{
    const value=event({issueId:privateIssueId,body:"PRIVATE original bytes"});
    expect(await analyticalLiveEventForReader(db,value,actor(ownerId))).toEqual(value);
    expect(await analyticalLiveEventForReader(db,value,actor(readerId))).toBeNull();
  });
  it("checks both explicit task and persisted run sources instead of replacing one with the other",async()=>{
    expect(await analyticalLiveEventForReader(db,event({runId,issueId:privateIssueId,chunk:"PRIVATE borrowed bytes"},"heartbeat.run.log"),actor(readerId))).toBeNull();
  });
  it.each(["projectId","entityId"])("checks the actual private project named by %s",async key=>{
    const value=event({[key]:projectId,...(key==="entityId"?{entityType:"project"}:{}),name:"PRIVATE project bytes"});
    expect(await analyticalLiveEventForReader(db,value,actor(ownerId))).toEqual(value);
    expect(await analyticalLiveEventForReader(db,value,actor(readerId))).toBeNull();
  });
  it("does not turn a malformed explicit source into an unscoped public event",async()=>{
    expect(await analyticalLiveEventForReader(db,event({issueId:"invalid",body:"Unqualified source bytes"}),actor(readerId))).toBeNull();
  });
  it("drops private messages on the actual socket while delivering the next authorized event",async()=>{
    const sessionId=randomUUID(),now=new Date();
    await db.insert(authSessions).values({id:sessionId,userId:readerId,token:randomUUID(),createdAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+60000)});
    const http=createServer(),wss=setupLiveEventsWebSocketServer(http,db,{deploymentMode:"authenticated",resolveSessionFromHeaders:async()=>({session:{id:sessionId,userId:readerId},user:{id:readerId,email:null,name:null}})});
    http.listen(0,"127.0.0.1");await once(http,"listening");
    const address=http.address();if(!address||typeof address==="string")throw new Error("Missing native listener");
    const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`),received:LiveEvent[]=[];
    socket.on("message",data=>received.push(JSON.parse(data.toString())));
    try{
      await once(socket,"open");
      const next=once(socket,"message");
      publishLiveEvent({companyId,type:"activity.logged",payload:{issueId:privateIssueId,body:"PRIVATE source bytes"}});
      publishLiveEvent({companyId,type:"agent.status",payload:{status:"idle",marker:"authorized barrier"}});
      await next;
      expect(received).toHaveLength(1);
      expect(received[0]!.payload.marker).toBe("authorized barrier");
      expect(JSON.stringify(received)).not.toContain(privateIssueId);
      expect(JSON.stringify(received)).not.toContain("PRIVATE");
    }finally{
      const closed=once(socket,"close");socket.terminate();await closed;
      await new Promise<void>(resolve=>wss.close(resolve));
      await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));
    }
  });
  it.each(["deleted","expired","replaced"] as const)("ends the original socket when its actual session is %s, even with the same cached Human",async change=>{
    const sessionId=randomUUID(),now=new Date();let resolvedSessionId=sessionId;
    const sessionRow={id:sessionId,userId:readerId,token:randomUUID(),createdAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+60000)};
    await db.insert(authSessions).values(sessionRow);
    const http=createServer(),wss=setupLiveEventsWebSocketServer(http,db,{deploymentMode:"authenticated",deploymentProfile:"saas",
      resolveSessionFromHeaders:async()=>({session:{id:resolvedSessionId,userId:readerId},user:{id:readerId,email:null,name:null}})});
    http.listen(0,"127.0.0.1");await once(http,"listening");
    const address=http.address();if(!address||typeof address==="string")throw new Error("Missing native listener");
    const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`);
    try{
      await once(socket,"open");
      const baseline=once(socket,"message");
      publishLiveEvent({companyId,type:"agent.status",payload:{marker:"valid original session"}});
      expect(JSON.parse((await baseline)[0].toString()).payload.marker).toBe("valid original session");
      if(change==="deleted")await db.delete(authSessions).where(eq(authSessions.id,sessionId));
      else if(change==="expired")await db.update(authSessions).set({expiresAt:new Date(Date.now()-1000)}).where(eq(authSessions.id,sessionId));
      else{
        resolvedSessionId=randomUUID();
        await db.insert(authSessions).values({...sessionRow,id:resolvedSessionId,token:randomUUID()});
      }
      const outcome=Promise.race([
        once(socket,"close").then(([code])=>({kind:"closed",code})),
        once(socket,"message").then(()=>({kind:"message"})),
      ]);
      publishLiveEvent({companyId,type:"agent.status",payload:{marker:"withdrawn original session"}});
      expect(await outcome).toEqual({kind:"closed",code:1008});
    }finally{
      if(socket.readyState!==WebSocket.CLOSED){const closed=once(socket,"close");socket.terminate();await closed;}
      await new Promise<void>(resolve=>wss.close(resolve));
      await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));
    }
  });
  it.each(["deleted", "expired", "replaced"] as const)("ends a session %s during an actual native source-lock wait before sending", async change => {
    const sessionId = randomUUID(), now = new Date(); let resolvedSessionId = sessionId;
    const sessionRow = { id: sessionId, userId: readerId, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60000) };
    await db.insert(authSessions).values(sessionRow);
    const [run] = await db.update(heartbeatRuns).set({ status: "succeeded",
      resultJson: { acceptedResult: { schema: "paperclip.run_result.v1", memoryCandidates: [{}] } } }).where(eq(heartbeatRuns.id, runId)).returning();
    // The original admission owner queues or records disabled capture. This
    // fixture qualifies its actual source read, not accepted extraction output.
    const job = await memoryJobService(db).enqueuePostRunCapture(run!);
    expect(job).not.toBeNull();
    expect(await canActorReadMemoryJob(db, companyId, actor(readerId), job!.id)).toBe(true);
    const http = createServer(), wss = setupLiveEventsWebSocketServer(http, db, { deploymentMode: "authenticated", deploymentProfile: "saas",
      resolveSessionFromHeaders: async () => ({ session: { id: resolvedSessionId, userId: readerId }, user: { id: readerId, email: null, name: null } }) });
    http.listen(0, "127.0.0.1"); await once(http, "listening");
    const address = http.address(); if (!address || typeof address === "string") throw new Error("Missing native listener");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`);
    try {
      await once(socket, "open");
      const baseline = once(socket, "message");
      publishLiveEvent({ companyId, type: "activity.logged", payload: { entityType: "memory_job", entityId: job!.id, marker: "current source positive" } });
      expect(JSON.parse((await baseline)[0].toString()).payload.marker).toBe("current source positive");
      const outcome = Promise.race([
        once(socket, "close").then(([code]) => ({ kind: "closed", code })),
        once(socket, "message").then(() => ({ kind: "message" })),
      ]);
      await db.transaction(async holder => {
        await lockMemoryPrivacy(holder, companyId);
        const [identity] = await holder.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        publishLiveEvent({ companyId, type: "activity.logged", payload: { entityType: "memory_job", entityId: job!.id, marker: "withdrawn while reviewing source" } });
        let observed = false;
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const [row] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity where ${identity!.pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`);
          if (row?.count) { observed = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(observed).toBe(true);
        if (change === "deleted") await db.delete(authSessions).where(eq(authSessions.id, sessionId));
        else if (change === "expired") await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authSessions.id, sessionId));
        else {
          resolvedSessionId = randomUUID();
          await db.insert(authSessions).values({ ...sessionRow, id: resolvedSessionId, token: randomUUID() });
        }
      });
      expect(await outcome).toEqual({ kind: "closed", code: 1008 });
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) { const closed = once(socket, "close"); socket.terminate(); await closed; }
      await new Promise<void>(resolve => wss.close(resolve));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
  });
  it("delivers for the same current cloud membership set despite native row ordering", async () => {
    const otherCompanyId = randomUUID();
    await db.insert(companies).values({ id: otherCompanyId, name: "Other current membership", issuePrefix: randomUUID() });
    await db.insert(companyMemberships).values({ companyId: otherCompanyId, principalType: "user", principalId: readerId, status: "active", membershipRole: "member" });
    let reads = 0;
    const http = createServer(), wss = setupLiveEventsWebSocketServer(http, db, { deploymentMode: "authenticated",
      resolveCloudActor: async () => {
        const rows = await db.select({ companyId: companyMemberships.companyId }).from(companyMemberships)
          .where(and(eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, readerId), eq(companyMemberships.status, "active")))
          .orderBy(++reads % 2 ? asc(companyMemberships.companyId) : desc(companyMemberships.companyId));
        expect(new Set(rows.map(row => row.companyId))).toEqual(new Set([companyId, otherCompanyId]));
        return { userId: readerId, companyIds: rows.map(row => row.companyId) };
      } });
    http.listen(0, "127.0.0.1"); await once(http, "listening");
    const address = http.address(); if (!address || typeof address === "string") throw new Error("Missing native listener");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`);
    try {
      await once(socket, "open");
      const outcome = Promise.race([
        once(socket, "close").then(([code]) => ({ kind: "closed", code })),
        once(socket, "message").then(([data]) => ({ kind: "message", marker: JSON.parse(data.toString()).payload.marker })),
      ]);
      publishLiveEvent({ companyId, type: "agent.status", payload: { marker: "same authorized cloud scope" } });
      expect(await outcome).toEqual({ kind: "message", marker: "same authorized cloud scope" });
      expect(reads).toBeGreaterThanOrEqual(3);
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) { const closed = once(socket, "close"); socket.terminate(); await closed; }
      await new Promise<void>(resolve => wss.close(resolve));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
  });
  it.each(["revoked", "deleted", "accountable Human changed"] as const)("ends a key %s while its final credential write waits", async change => {
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    const taskId = run!.nativeIssueId!, agentId = run!.agentId, token = randomUUID();
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    const [key] = await db.insert(agentApiKeys).values({ companyId, agentId, name: "Current native key", responsibleUserId: ownerId,
      scopeConfig: { kind: "standard" }, keyHash: createHash("sha256").update(token).digest("hex") }).returning();
    // A source-free Context makes the original payload owner take its real
    // Memory lock; no descriptor is used as a current permission grant.
    await db.insert(contextManifests).values({ companyId, runId, agentId, issueId: taskId, queryHash: "c".repeat(64), policySnapshotHash: "d".repeat(64) });
    const http = createServer(), wss = setupLiveEventsWebSocketServer(http, db, { deploymentMode: "authenticated", deploymentProfile: "saas" });
    http.listen(0, "127.0.0.1"); await once(http, "listening");
    const address = http.address(); if (!address || typeof address === "string") throw new Error("Missing native listener");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`, { headers: { Authorization: `Bearer ${token}` } });
    async function blockedBy(pid: number) {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const [row] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`);
        if (row?.count) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Native delivery did not reach its actual PostgreSQL blocker");
    }
    try {
      await once(socket, "open");
      const baseline = once(socket, "message");
      publishLiveEvent({ companyId, type: "activity.logged", payload: { issueId: taskId, marker: "current key and source positive" } });
      expect(JSON.parse((await baseline)[0].toString()).payload.marker).toBe("current key and source positive");
      const outcome = Promise.race([
        once(socket, "close").then(([code]) => ({ kind: "closed", code })),
        once(socket, "message").then(() => ({ kind: "message" })),
      ]);
      await db.transaction(async keyHolder => {
        const [keyIdentity] = await keyHolder.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        await db.transaction(async memoryHolder => {
          await lockMemoryPrivacy(memoryHolder, companyId);
          const [memoryIdentity] = await memoryHolder.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          publishLiveEvent({ companyId, type: "activity.logged", payload: { issueId: taskId, marker: "credential withdrawn during final write" } });
          await blockedBy(memoryIdentity!.pid);
          if (change === "deleted") await keyHolder.delete(agentApiKeys).where(eq(agentApiKeys.id, key!.id));
          else await keyHolder.update(agentApiKeys).set(change === "revoked" ? { revokedAt: new Date() } : { responsibleUserId: readerId }).where(eq(agentApiKeys.id, key!.id));
        });
        // Source review has passed, but final credential UPDATE is now waiting
        // on the exact uncommitted key mutation, not a timer or a mocked gate.
        await blockedBy(keyIdentity!.pid);
      });
      expect(await outcome).toEqual({ kind: "closed", code: 1008 });
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) { const closed = once(socket, "close"); socket.terminate(); await closed; }
      await new Promise<void>(resolve => wss.close(resolve));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
  });
});
