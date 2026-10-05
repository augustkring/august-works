import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agentIdentities, agents, authUsers, billingSubscriptions, companyMemberships, createDb, runtimeBackupPolicies, runtimeBackups, runtimeCapacityProfiles, runtimeCells, runtimeOperations, runtimeVersionCatalog } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { runtimeBackupSchedule } from "../services/runtime/backup-schedule.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import { secretService } from "../services/secrets.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

const support=await getEmbeddedPostgresTestSupport();
(support.supported?describe:describe.skip)("V6 scheduled encrypted runtime backups",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,companyId:string,accountId:string;
  const now=new Date(),digest="fixture.invalid/openclaw@sha256:"+"f".repeat(64);
  const config={runtime:{backupRetentionDays:30,relayPort:3102},backups:{bucket:"fixture-backups"}} as SaasPlatformConfig;
  beforeAll(async()=>{
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY","a".repeat(64));
    database=await startEmbeddedPostgresTestDatabase("aw-v6-backup-schedule-");db=createDb(database.connectionString);
    await db.insert(authUsers).values({id:"schedule-owner",email:"schedule@example.test",name:"Owner",emailVerified:true,createdAt:now,updatedAt:now});
    const company=await saasOnboardingService(db).create("schedule-owner",{name:"Schedule fixture",idempotencyKey:"schedule-company-001"});companyId=company.companyId;accountId=company.billingAccountId;
    await db.insert(runtimeCapacityProfiles).values({key:"fixture",cpuMillis:1000,memoryBytes:1000000000n,diskBytes:10000000000n,pidsLimit:128});
    await db.insert(runtimeVersionCatalog).values({imageDigest:digest,providerVersion:"fixture-only",stateFormat:"fixture",hostAgentMinimumVersion:"6.0.0",status:"approved",conformance:{fixtureOnly:true}});
    await db.insert(billingSubscriptions).values({billingAccountId:accountId,providerSubscriptionId:"sub_schedule",status:"active",productKeys:["platform","runtime_standard"],currentPeriodEnd:new Date(now.getTime()+86400000),providerUpdatedAt:now,sourceHash:"fixture"});
  },60000);
  afterAll(async()=>{await database?.cleanup();vi.unstubAllEnvs();},30000);
  async function fixture(status="HEALTHY"){
    const gateway=await secretService(db).create(companyId,{name:"Fixture Gateway "+randomUUID(),provider:"local_encrypted",value:"c".repeat(64)},{userId:"schedule-owner"});
    const [cell]=await db.insert(runtimeCells).values({companyId,billingAccountId:accountId,isolationMode:"company_cell",capacityProfile:"fixture",desiredImageDigest:digest,activeImageDigest:digest,status,gatewaySecretRef:gateway.id}).returning();
    const service=runtimeBackupSchedule(db,config);
    await service.configure(companyId,cell!.id,"schedule-owner",{enabled:true,allowBriefPause:true,intervalHours:24,expectedVersion:0},now);
    await db.update(runtimeBackupPolicies).set({nextDueAt:now,notBefore:now}).where(eq(runtimeBackupPolicies.runtimeCellId,cell!.id));return {cell:cell!,service};
  }
  async function advance(cellId:string,operationType:string,time:Date){
    const [operation]= (await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId,cellId))).filter(row=>row.operationType===operationType);
    await db.update(runtimeOperations).set({status:"SUCCEEDED",completedAt:time}).where(eq(runtimeOperations.id,operation!.id));
    await db.update(runtimeCells).set({status:operationType==="start"?"HEALTHY":"STOPPED"}).where(eq(runtimeCells.id,cellId));return operation!;
  }
  it("deduplicates a stop/backup/verification/resume cycle and preserves agent budget pauses",async()=>{
    const {cell,service}=await fixture();
    const [identity]=await db.insert(agentIdentities).values({name:"Budget fixture",homeCompanyId:companyId}).returning();
    const [agent]=await db.insert(agents).values({companyId,agentIdentityId:identity!.id,name:"Paused agent",adapterType:"openclaw_gateway",status:"paused",pauseReason:"budget"}).returning();
    await Promise.all([service.tick(now),service.tick(now)]);
    expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId,cell.id))).map(row=>row.operationType)).toEqual(["stop"]);
    const next=new Date(now.getTime()+20000);await advance(cell.id,"stop",next);await service.tick(next);
    const snapshotTime=new Date(next.getTime()+20000),operation=await advance(cell.id,"backup",snapshotTime);
    const backupId=String(operation.desiredState.backupId);
    await db.update(runtimeBackups).set({status:"AVAILABLE"}).where(eq(runtimeBackups.id,backupId));await service.tick(snapshotTime);
    expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId,cell.id)))).toHaveLength(2);
    const verifiedTime=new Date(snapshotTime.getTime()+20000);await db.update(runtimeBackups).set({status:"VERIFIED",verifiedAt:verifiedTime}).where(eq(runtimeBackups.id,backupId));await service.tick(verifiedTime);
    const finalTime=new Date(verifiedTime.getTime()+20000);await advance(cell.id,"start",finalTime);await service.tick(finalTime);
    expect(await service.get(companyId,cell.id)).toMatchObject({phase:"idle",lastSuccessAt:finalTime,errorCode:null});
    expect((await db.select().from(agents).where(eq(agents.id,agent!.id)))[0]).toMatchObject({status:"paused",pauseReason:"budget"});
    expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId,cell.id))).every(row=>row.requestedByType==="system"&&row.requestedById==="backup-scheduler")).toBe(true);
  });
  it("does not resume a manually stopped runtime or interrupt grace without permission to resume",async()=>{
    const {cell,service}=await fixture("STOPPED");await service.tick(now);
    const next=new Date(now.getTime()+20000),operation=await advance(cell.id,"backup",next);
    await db.update(runtimeBackups).set({status:"VERIFIED",verifiedAt:next}).where(eq(runtimeBackups.id,String(operation.desiredState.backupId)));await service.tick(next);
    expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId,cell.id)))).toHaveLength(1);
    const healthy=await fixture();await db.update(billingSubscriptions).set({status:"past_due",graceUntil:new Date(now.getTime()+86400000)});
    await healthy.service.tick(now);expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId,healthy.cell.id)))).toHaveLength(0);
    await db.update(runtimeBackupPolicies).set({enabled:false}).where(eq(runtimeBackupPolicies.runtimeCellId,healthy.cell.id));await db.update(billingSubscriptions).set({status:"active"});
  });
  it("requires explicit pause consent, rejects stale configuration and closes a revoked schedule",async()=>{
    const {cell,service}=await fixture();
    await service.configure(companyId,cell.id,"schedule-owner",{enabled:true,allowBriefPause:false,intervalHours:24,expectedVersion:1},now);
    await expect(service.configure(companyId,cell.id,"schedule-owner",{enabled:false,allowBriefPause:false,intervalHours:24,expectedVersion:1},now)).rejects.toMatchObject({status:409});
    await service.tick(now);expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId,cell.id)))).toHaveLength(0);
    expect(await service.get(companyId,cell.id)).toMatchObject({errorCode:"backup_window_required"});
    await db.update(runtimeBackupPolicies).set({notBefore:now}).where(eq(runtimeBackupPolicies.runtimeCellId,cell.id));
    await db.update(companyMemberships).set({status:"inactive"}).where(eq(companyMemberships.companyId,companyId));
    await service.tick(now);expect(await service.get(companyId,cell.id)).toMatchObject({enabled:false,errorCode:"backup_schedule_authority_unavailable"});
  });
});
