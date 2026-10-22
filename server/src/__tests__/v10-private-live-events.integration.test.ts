import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { agents, authSessions, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, projectAccessMembers, projects } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { analyticalLiveEventForReader } from "../services/analytical-live-events.js";
import { publishLiveEvent } from "../services/live-events.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";
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
});
