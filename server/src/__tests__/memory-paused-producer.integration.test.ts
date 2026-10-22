import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, memoryBindings, memoryEvidence, memoryRecords } from "@paperclipai/db";
import { authorizationService } from "../services/authorization.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { memoryService } from "../services/memory/memory-service.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Original private Memory producer checks current authority before effects",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
  beforeAll(async()=>{
    database=await startEmbeddedPostgresTestDatabase("v10-paused-memory-producer-");
    db=createDb(database.connectionString,{maxConnections:3});
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async()=>{await database?.cleanup();},30000);

  it.each([false,true])("rejects a paused Agent without Memory, evidence, audit or events (after actual binding wait=%s)",async afterBindingWait=>{
    const companyId=randomUUID(),userId=randomUUID(),agentId=randomUUID(),issueId=randomUUID(),runId=randomUUID(),operationId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Paused producer",issuePrefix:randomUUID()});
    await db.insert(authUsers).values({id:userId,name:"Current Human",email:`${userId}@example.test`,emailVerified:true,createdAt:new Date(),updatedAt:new Date()});
    await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,status:"active",membershipRole:"admin"});
    await db.insert(agents).values({id:agentId,companyId,name:"Native worker",role:"engineer",status:"idle",adapterType:"paperclip_runner"});
    await db.insert(issues).values({id:issueId,companyId,title:"Open current Task",visibility:"open",responsibleUserId:userId,assigneeAgentId:agentId});
    await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,responsibleUserId:userId,nativeIssueId:issueId,contextSnapshot:{issueId},runtimeMode:"native",status:"running"});
    const service=memoryService(db),human={principal:{type:"user" as const,userId}};
    const binding=await service.createCompanyBinding(companyId,{key:randomUUID(),name:"Native binding",providerKey:"local"},human);
    await service.addBindingTarget(companyId,binding.id,{targetType:"agent",targetId:agentId},human);
    // An open Task and no Context roots isolate intrinsic producer admission;
    // no private source ACL can accidentally make this regression pass.
    const [currentAgent]=await db.select({status:agents.status}).from(agents).where(eq(agents.id,agentId));
    const [currentRun]=await db.select({status:heartbeatRuns.status,human:heartbeatRuns.responsibleUserId}).from(heartbeatRuns).where(eq(heartbeatRuns.id,runId));
    expect(currentAgent!.status).toBe("idle");
    expect(currentRun).toEqual({status:"running",human:userId});
    expect((await authorizationService(db).decide({actor:{type:"agent",source:"agent_jwt",companyId,agentId,runId,onBehalfOfUserId:userId},
      action:"company_scope:read",resource:{type:"company",companyId},enforceResponsibleUserIntersection:true})).allowed).toBe(true);
    let releaseHolder:(()=>void)|undefined,holder:Promise<unknown>|undefined,holderPid:number|undefined;
    if(afterBindingWait){
      let holderReady!:()=>void;
      const ready=new Promise<void>(resolve=>{holderReady=resolve;}),gate=new Promise<void>(resolve=>{releaseHolder=resolve;});
      holder=db.transaction(async tx=>{
        await tx.select({id:memoryBindings.id}).from(memoryBindings).where(eq(memoryBindings.id,binding.id)).for("update");
        const [physical]=await tx.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
        holderPid=physical!.pid;holderReady();await gate;
      });
      await ready;
    }else await db.update(agents).set({status:"paused"}).where(eq(agents.id,agentId));
    const events:unknown[]=[],unsubscribe=subscribeCompanyLiveEvents(companyId,event=>events.push(event));
    try {
      const operation=service.createPrivateMemory(companyId,agentId,{
        bindingId:binding.id,memoryType:"lesson",title:"Attempted private lesson",content:"Own fresh input",summary:null,sensitivity:"internal",
        observedAt:new Date().toISOString(),validFrom:null,validUntil:null,expiresAt:null,createdByOperationId:operationId,
        evidence:[{sourceClass:"task",sourceProvider:"native_fixture",sourceType:"outcome",sourceRef:`issue://${issueId}`,sourceVersion:"1",sourceUpdatedAt:null,
          observedAt:new Date().toISOString(),excerptHash:createHash("sha256").update("Own fresh input").digest("hex"),citation:{label:"Current input"},trustLevel:"low",relation:"supports"}],
      },{principal:{type:"agent",agentId,responsibleUserId:userId},runId}).then(value=>({value}),error=>({error}));
      if(afterBindingWait){
        let waiterPid:number|undefined,waiterQuery:string|undefined;
        const deadline=Date.now()+10000;
        while(Date.now()<deadline){
          const [waiting]=await db.execute<{pid:number;query:string}>(sql`select pid,query from pg_stat_activity
            where datname=current_database() and ${holderPid!}=any(pg_blocking_pids(pid)) limit 1`);
          if(waiting){waiterPid=waiting.pid;waiterQuery=waiting.query;break;}
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        expect(waiterPid).toBeDefined();
        expect(waiterQuery).toMatch(/insert into "memory_records"/i);
        console.info("Actual native Memory INSERT binding blocker",{holderPid,waiterPid});
        await db.update(agents).set({status:"paused"}).where(eq(agents.id,agentId));
        releaseHolder!();await holder;
      }
      const outcome=await operation;
      expect.soft(outcome).toMatchObject({error:{status:403}});
      expect.soft(await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId,companyId),eq(memoryRecords.createdByOperationId,operationId)))).toEqual([]);
      expect.soft(await db.select().from(memoryEvidence).where(eq(memoryEvidence.companyId,companyId))).toEqual([]);
      expect.soft(await db.select().from(activityLog).where(and(eq(activityLog.companyId,companyId),eq(activityLog.action,"memory.private_created")))).toEqual([]);
      expect(events).toEqual([]);
    } finally {releaseHolder?.();await holder;unsubscribe();}
  });
});
