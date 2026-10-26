import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issues, learningCycles, learningEvidence, memoryBindings, memoryRecords, memoryEvidence, memoryObservations, memoryObservationEvidence, memoryModels, memoryModelVersions, memoryModelEvidence, type Db } from "@paperclipai/db";
import { assertLearningAnalyticalSources } from "../services/learning/learning-analytical-sources.js";
import { observationLineage, modelLineage } from "../services/memory/derived-memory.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Learning keeps the identity of a physically deleted private Memory source",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
  beforeAll(async()=>{
    database=await startEmbeddedPostgresTestDatabase("v10-deleted-memory-source-");
    db=createDb(database.connectionString,{maxConnections:3});
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async()=>{await database?.cleanup();},30000);
  it("cannot become public when only the private member of two actual roots is deleted",async()=>{
    const companyId=randomUUID(),ownerId=randomUUID(),readerId=randomUUID(),issueId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Retained Memory sources",issuePrefix:randomUUID()});
    await db.insert(authUsers).values([ownerId,readerId].map(id=>({id,name:"Current Human",email:`${id}@example.test`,createdAt:new Date(),updatedAt:new Date()})));
    await db.insert(companyMemberships).values([ownerId,readerId].map(principalId=>({companyId,principalType:"user",principalId,status:"active",membershipRole:"admin"})));
    await db.insert(issues).values({id:issueId,companyId,title:"PRIVATE source",visibility:"private",createdByUserId:ownerId,responsibleUserId:ownerId});
    const [binding]=await db.insert(memoryBindings).values({companyId,key:randomUUID(),name:"Native source binding",providerKey:"local"}).returning();
    const roots=await db.insert(memoryRecords).values([true,false].map(privateSource=>({companyId,bindingId:binding!.id,providerKey:"local",memoryType:"outcome",scopeType:"company",
      content:privateSource?"PRIVATE source payload":"Independent public source",observedAt:new Date(),createdByActorType:"user",createdByActorId:ownerId,
      reviewState:"accepted",verificationState:"human_verified",sourceProvenanceQualified:true,sourceIssueIds:privateSource?[issueId]:[]}))).returning();
    const [sourceTask]=await db.select({updatedAt:issues.updatedAt,title:issues.title}).from(issues).where(and(eq(issues.companyId,companyId),eq(issues.id,issueId)));
    if(!sourceTask)throw new Error("The retained private Memory source Task is missing");
    await db.insert(memoryEvidence).values({companyId,memoryRecordId:roots[0]!.id,sourceClass:"task",sourceProvider:"august_works_tasks",
      sourceType:"issue",sourceRef:`issue://${issueId}`,sourceVersion:sourceTask!.updatedAt.toISOString(),sourceUpdatedAt:sourceTask!.updatedAt,
      observedAt:new Date(),excerptHash:"a".repeat(64),citationJson:{label:sourceTask!.title},trustLevel:"high",supportsOrContradicts:"supports"});
    const [cycle]=await db.insert(learningCycles).values({companyId,scopeType:"company",purpose:"native_task_execution",trigger:"Two actual source outcomes",maxHypotheses:2,maxEvaluations:2,outcomeVersions:{},createdBy:ownerId}).returning();
    await db.insert(learningEvidence).values(roots.map(root=>({companyId,cycleId:cycle!.id,memoryRecordId:root.id,sourceVersion:root.updatedAt.toISOString()})));
    const [observation]=await db.insert(memoryObservations).values({companyId,observationKey:randomUUID(),scopeType:"company",purpose:"native_task_execution",
      content:"PRIVATE derived observation",status:"accepted",confidence:0.8,sensitivity:"internal",supportCount:2,contradictionCount:0,independentSourceCount:2}).returning();
    await db.insert(memoryObservationEvidence).values(roots.map(root=>({companyId,observationId:observation!.id,memoryRecordId:root.id,sourceVersion:root.updatedAt.toISOString(),relationship:"supports",rootFingerprint:root.id})));
    const [model]=await db.insert(memoryModels).values({companyId,modelKey:randomUUID(),name:"PRIVATE derived model",scopeType:"company",purpose:"native_task_execution",sourceQuery:"Two native outcomes",
      content:"PRIVATE derived model payload",status:"active",confidence:0.8,sensitivity:"internal",sourceWatermark:"native-fixture"}).returning();
    await db.insert(memoryModelVersions).values({companyId,modelId:model!.id,version:1,content:model!.content,sourceWatermark:model!.sourceWatermark});
    await db.insert(memoryModelEvidence).values(roots.map(root=>({companyId,modelId:model!.id,modelVersion:1,memoryRecordId:root.id,sourceVersion:root.updatedAt.toISOString(),relationship:"derived_from"})));
    const owner={type:"board" as const,source:"session" as const,userId:ownerId},reader={...owner,userId:readerId};
    await expect(assertLearningAnalyticalSources(db,owner,cycle!)).resolves.toBeNull();
    await expect(assertLearningAnalyticalSources(db,reader,cycle!)).rejects.toMatchObject({status:403});
    await observationLineage(db,owner,observation!);
    await modelLineage(db,owner,model!);
    await expect(observationLineage(db,reader,observation!)).rejects.toMatchObject({status:403});
    await expect(modelLineage(db,reader,model!)).rejects.toMatchObject({status:403});
    await db.delete(memoryRecords).where(eq(memoryRecords.id,roots[0]!.id));
    expect(await db.select().from(memoryRecords).where(eq(memoryRecords.id,roots[0]!.id))).toEqual([]);
    const retained=await db.select().from(learningEvidence).where(and(eq(learningEvidence.companyId,companyId),eq(learningEvidence.cycleId,cycle!.id)));
    expect.soft(retained.map(root=>root.memoryRecordId).sort()).toEqual(roots.map(root=>root.id).sort());
    await expect.soft(assertLearningAnalyticalSources(db,reader,cycle!)).rejects.toMatchObject({status:403});
    for(const table of [memoryObservationEvidence,memoryModelEvidence]){
      const rows=await db.select().from(table).where(eq(table.companyId,companyId));
      expect.soft(rows.map(row=>row.memoryRecordId).sort()).toEqual(roots.map(root=>root.id).sort());
    }
    await expect.soft(observationLineage(db,reader,observation!)).rejects.toMatchObject({status:404});
    await expect.soft(modelLineage(db,reader,model!)).rejects.toMatchObject({status:404});
  });
  // These cases qualify referential existence/company integrity and physical
  // lock ordering only; they do not confer source read permission.
  async function referenceFixture(kind:"learning"|"observation"|"model"){
    const companyId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Native source integrity",issuePrefix:randomUUID()});
    const [binding]=await db.insert(memoryBindings).values({companyId,key:randomUUID(),name:"Source binding",providerKey:"local"}).returning();
    const [source]=await db.insert(memoryRecords).values({companyId,bindingId:binding!.id,providerKey:"local",memoryType:"outcome",scopeType:"company",
      content:"Reference integrity fixture",observedAt:new Date(),createdByActorType:"system",createdByActorId:"reference-fixture"}).returning();
    let insert:(tx:Db,id:string)=>Promise<unknown>,read:()=>Promise<Array<{memoryRecordId:string}>>;
    if(kind==="learning"){
      const [parent]=await db.insert(learningCycles).values({companyId,scopeType:"company",purpose:"native_task_execution",trigger:"Source reference",maxHypotheses:2,maxEvaluations:2,outcomeVersions:{},createdBy:randomUUID()}).returning();
      insert=async(tx,id)=>tx.insert(learningEvidence).values({companyId,cycleId:parent!.id,memoryRecordId:id,sourceVersion:source!.updatedAt.toISOString()});
      read=()=>db.select({memoryRecordId:learningEvidence.memoryRecordId}).from(learningEvidence).where(eq(learningEvidence.cycleId,parent!.id));
    }else if(kind==="observation"){
      const [parent]=await db.insert(memoryObservations).values({companyId,observationKey:randomUUID(),scopeType:"company",purpose:"native_task_execution",content:"Source reference",confidence:0.5,sensitivity:"internal",supportCount:1,contradictionCount:0,independentSourceCount:1}).returning();
      insert=async(tx,id)=>tx.insert(memoryObservationEvidence).values({companyId,observationId:parent!.id,memoryRecordId:id,sourceVersion:source!.updatedAt.toISOString(),relationship:"supports",rootFingerprint:id});
      read=()=>db.select({memoryRecordId:memoryObservationEvidence.memoryRecordId}).from(memoryObservationEvidence).where(eq(memoryObservationEvidence.observationId,parent!.id));
    }else{
      const [parent]=await db.insert(memoryModels).values({companyId,modelKey:randomUUID(),name:"Source reference",scopeType:"company",purpose:"native_task_execution",sourceQuery:"Native source",content:"Source reference",confidence:0.5,sensitivity:"internal",sourceWatermark:"fixture"}).returning();
      await db.insert(memoryModelVersions).values({companyId,modelId:parent!.id,version:1,content:parent!.content,sourceWatermark:parent!.sourceWatermark});
      insert=async(tx,id)=>tx.insert(memoryModelEvidence).values({companyId,modelId:parent!.id,modelVersion:1,memoryRecordId:id,sourceVersion:source!.updatedAt.toISOString(),relationship:"derived_from"});
      read=()=>db.select({memoryRecordId:memoryModelEvidence.memoryRecordId}).from(memoryModelEvidence).where(eq(memoryModelEvidence.modelId,parent!.id));
    }
    return {companyId,source:source!,insert,read};
  }
  const kinds=["learning","observation","model"] as const;
  const errorCode=(error:unknown):unknown=>{
    for(let depth=0;depth<4 && error && typeof error==="object";depth++){
      const value=error as {code?:unknown;cause?:unknown};if(value.code)return value.code;error=value.cause;
    }
  };
  async function blockedBy(pid:number){
    const deadline=performance.now()+5000;
    while(performance.now()<deadline){
      const [blocked]=await db.execute<{count:number}>(sql`select count(*)::int as count from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`);
      if(blocked?.count)return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error("Actual source-reference operation did not wait for its physical PostgreSQL blocker");
  }
  it.each(kinds)("keeps same-company and missing-source insertion integrity for %s",async kind=>{
    const local=await referenceFixture(kind),foreign=await referenceFixture(kind);
    for(const id of [randomUUID(),foreign.source.id]){
      const error=await local.insert(db,id).then(()=>null,error=>error);
      expect(errorCode(error)).toBe("23503");
    }
    await local.insert(db,local.source.id);
    expect(await local.read()).toEqual([{memoryRecordId:local.source.id}]);
  });
  it.each(kinds)("rejects %s insertion after a concurrent source deletion commits",async kind=>{
    const fixture=await referenceFixture(kind);
    let pending!:Promise<unknown>;
    await db.transaction(async holder=>{
      const [identity]=await holder.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
      await holder.delete(memoryRecords).where(eq(memoryRecords.id,fixture.source.id));
      pending=fixture.insert(db,fixture.source.id).then(()=>null,error=>error);
      await blockedBy(identity!.pid);
    });
    expect(errorCode(await pending)).toBe("23503");
    expect(await fixture.read()).toEqual([]);
  });
  it.each(kinds)("retains the %s UUID after insertion commits before concurrent source deletion",async kind=>{
    const fixture=await referenceFixture(kind);
    let pending!:Promise<unknown>;
    await db.transaction(async holder=>{
      const [identity]=await holder.execute<{pid:number}>(sql`select pg_backend_pid() as pid`);
      await fixture.insert(holder,fixture.source.id);
      pending=db.delete(memoryRecords).where(eq(memoryRecords.id,fixture.source.id)).then(()=>null,error=>error);
      await blockedBy(identity!.pid);
    });
    expect(await pending).toBeNull();
    expect(await fixture.read()).toEqual([{memoryRecordId:fixture.source.id}]);
    await db.delete(companies).where(eq(companies.id,fixture.companyId));
    expect(await fixture.read()).toEqual([]);
  });

});
