import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  memoryBindings, memoryBindingTargets, memoryEvidence, memoryJobs, memoryRecords } from "@paperclipai/db";
import { instanceSettingsService } from "../services/instance-settings.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native maintenance publishes only committed Memory effects",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
  beforeAll(async()=>{
    database=await startEmbeddedPostgresTestDatabase("v10-maintenance-publication-");
    db=createDb(database.connectionString,{maxConnections:3});
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async()=>{await database?.cleanup();},30000);
  async function seed(options:{dedupe?:boolean;bindBodySnapshot?:boolean}={}){
    const companyId=randomUUID(),userId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Maintenance publication",issuePrefix:randomUUID()});
    await db.insert(authUsers).values({id:userId,name:"Actual maintenance owner",email:`${userId}@example.test`,createdAt:new Date(),updatedAt:new Date()});
    await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,status:"active",membershipRole:"owner"});
    const [binding]=await db.insert(memoryBindings).values({companyId,key:randomUUID(),name:"Native shared binding",providerKey:"local"}).returning();
    await db.insert(memoryBindingTargets).values({companyId,bindingId:binding!.id,targetType:"company",targetId:companyId});
    let sources=await db.insert(memoryRecords).values([0,1].map(index=>({companyId,bindingId:binding!.id,providerKey:"local",memoryType:"observation",scopeType:"company",
      title:options.dedupe ? "Reviewed duplicate claim" : `Reviewed source ${index}`,
      content:options.dedupe ? `Reviewed duplicate claim. ${"Full native outcome detail. ".repeat(30)}` : `Reviewed source ${index}. ${"Full native outcome detail. ".repeat(30)}`,
      summary:options.dedupe ? "Reviewed duplicate summary" : `Reviewed summary ${index}`,
      sourceProvenanceQualified:true,observedAt:new Date(),reviewState:"accepted",verificationState:"human_verified",createdByActorType:"user",createdByActorId:userId,
      ...(options.bindBodySnapshot ? {payloadSourceProtocolVersion:1} : {})}))).returning();
    if(options.bindBodySnapshot) for(const row of sources){
      // Structural snapshot for the DB body-mutation guard only; this worker
      // fixture makes no claim about authenticated source capture.
      await db.execute(sql`update memory_records target set payload_source_snapshot=(
        select content || jsonb_build_object('digest',encode(sha256(convert_to(content::text,'UTF8')),'hex')) from (
          select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','memory_record','companyId',target.company_id,
            'id',target.id,'contentHash',public.aw_native_payload_body_hash('memory_record',to_jsonb(target))),
            'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
              'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as content
        ) body
      ) where target.company_id=${companyId}::uuid and target.id=${row.id}::uuid`);
    }
    if(options.bindBodySnapshot) sources=await db.select().from(memoryRecords).where(eq(memoryRecords.companyId,companyId));
    await instanceSettingsService(db).updateExperimental({enableCollectiveMemoryV1:true});
    return {companyId,userId,sources};
  }
  it("does not publish a candidate rolled back after the maintenance lease expires during INSERT",async()=>{
    const {companyId,userId,sources}=await seed();
    const service=memoryJobService(db,{ownerId:"maintenance-publication-worker",leaseMs:2000});
    const job=await service.enqueueMaintenance(companyId,{operationType:"compaction",recordIds:sources.map(row=>row.id)},{principal:{type:"user",userId}},randomUUID());
    await db.execute(sql`create sequence maintenance_insert_reached`);
    await db.execute(sql`create function delay_maintenance_insert() returns trigger language plpgsql as $$
      begin perform nextval('maintenance_insert_reached'); perform pg_sleep(2.2); return NEW; end $$`);
    await db.execute(sql`create trigger delay_maintenance_insert after insert on memory_records
      for each row execute function delay_maintenance_insert()`);
    const before=await db.select().from(activityLog).where(eq(activityLog.companyId,companyId)),events:unknown[]=[];
    const unsubscribe=subscribeCompanyLiveEvents(companyId,event=>events.push(event));
    try {
      const claimed=await service.claimNext();expect(claimed?.id).toBe(job.id);
      await service.executeClaimed(claimed!);
      const [reached]=await db.execute<{is_called:boolean}>(sql`select is_called from maintenance_insert_reached`);
      expect(reached?.is_called).toBe(true);
      const [settled]=await db.select().from(memoryJobs).where(eq(memoryJobs.id,job.id));
      expect(settled?.status).toBe("failed");
      const remaining=await db.select().from(memoryRecords).where(eq(memoryRecords.companyId,companyId));
      expect(remaining.map(row=>row.id).sort()).toEqual(sources.map(row=>row.id).sort());
      expect(await db.select().from(memoryEvidence).where(eq(memoryEvidence.companyId,companyId))).toEqual([]);
      expect(await db.select().from(activityLog).where(eq(activityLog.companyId,companyId))).toEqual(before);
      expect(events).toEqual([]);
    } finally {
      unsubscribe();
      await db.execute(sql`drop trigger delay_maintenance_insert on memory_records`);
      await db.execute(sql`drop function delay_maintenance_insert()`);
      await db.execute(sql`drop sequence maintenance_insert_reached`);
    }
  });
  it("publishes the committed candidate and completion with their usable native receipts",async()=>{
    const {companyId,userId,sources}=await seed();
    const service=memoryJobService(db,{ownerId:"successful-maintenance-worker"});
    const job=await service.enqueueMaintenance(companyId,{operationType:"compaction",recordIds:sources.map(row=>row.id)},{principal:{type:"user",userId}},randomUUID());
    const events:Array<{action:unknown;entityId:unknown}>=[];
    const committed:Array<Promise<{records:unknown[];jobs:Array<{status:string}>}>>=[];
    const unsubscribe=subscribeCompanyLiveEvents(companyId,event=>{
      events.push({action:event.payload.action,entityId:event.payload.entityId});
      if(event.payload.action==="memory.candidate_created"){
        const id=event.payload.entityId;
        if(typeof id!=="string")throw new Error("Candidate event lacks native identity");
        committed.push(Promise.all([
          db.select().from(memoryRecords).where(eq(memoryRecords.id,id)),
          db.select({status:memoryJobs.status}).from(memoryJobs).where(eq(memoryJobs.id,job.id)),
        ]).then(([records,jobs])=>({records,jobs})));
      }
    });
    try {
      const claimed=await service.claimNext();expect(claimed?.id).toBe(job.id);
      await service.executeClaimed(claimed!);
      expect(events.map(event=>event.action)).toEqual(["memory.candidate_created","memory.compaction_completed"]);
      expect(committed).toHaveLength(1);
      const [receipt]=await Promise.all(committed);
      expect(receipt!.records).toHaveLength(1);
      expect(receipt!.jobs).toEqual([{status:"succeeded"}]);
    } finally {unsubscribe();}
  });

  it("invalidates only the dedupe canonical capture while retaining the superseded duplicate body",async()=>{
    const {companyId,userId,sources}=await seed({dedupe:true,bindBodySnapshot:true});
    const service=memoryJobService(db,{ownerId:"memory-dedupe-worker"});
    const job=await service.enqueueMaintenance(companyId,{operationType:"dedupe",recordIds:sources.map(row=>row.id)},
      {principal:{type:"user",userId}},randomUUID());
    const claimed=await service.claimNext();expect(claimed?.id).toBe(job.id);
    await service.executeClaimed(claimed!);

    const [settled]=await db.select().from(memoryJobs).where(eq(memoryJobs.id,job.id));
    expect(settled).toMatchObject({status:"succeeded",resultJson:{scannedRecordCount:2,supersededCount:1,canonicalRecordCount:1}});
    const rows=await db.select().from(memoryRecords).where(eq(memoryRecords.companyId,companyId));
    const canonical=rows.find(row=>row.id===sources.slice().sort((left,right)=>left.createdAt.getTime()-right.createdAt.getTime()||left.id.localeCompare(right.id))[0]!.id)!;
    const duplicate=rows.find(row=>row.id!==canonical.id)!;
    expect(canonical.sourceMemoryIds).toContain(duplicate.id);
    expect(canonical.payloadSourceSnapshot).toBeNull();
    expect(canonical.payloadSourceSnapshotInvalidated).toBe(true);
    expect(sources.find(row=>row.id===duplicate.id)!.payloadSourceSnapshot).not.toBeNull();
    expect(duplicate).toMatchObject({content:sources.find(row=>row.id===duplicate.id)!.content,
      retentionState:"superseded",supersededByRecordId:canonical.id,payloadSourceSnapshot:sources.find(row=>row.id===duplicate.id)!.payloadSourceSnapshot,
      payloadSourceSnapshotInvalidated:false});
  });

});
