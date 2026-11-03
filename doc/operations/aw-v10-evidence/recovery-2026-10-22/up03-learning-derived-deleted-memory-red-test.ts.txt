import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issues, learningCycles, learningEvidence, memoryBindings, memoryRecords, memoryObservations, memoryObservationEvidence, memoryModels, memoryModelVersions, memoryModelEvidence } from "@paperclipai/db";
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
});
