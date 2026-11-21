import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq,sql } from "drizzle-orm";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { agents,companies,createDb,environmentLeases,environments,heartbeatRunEvents,heartbeatRuns } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { appendHeartbeatRunEvent } from "../services/heartbeat-run-events.js";
import { NATIVE_REMOTE_WORKLOAD_STOPPED,recordNativeRemoteWorkloadStopped,readNativeRemoteWorkloadIntent,remoteExecutionHasStopped,remoteTerminationReceipt } from "../services/remote-execution-termination.js";

describe("original remote workload process/resource projection (actual PostgreSQL)",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;let counter=0;
 beforeAll(async()=>{
  database=await startEmbeddedPostgresTestDatabase("remote-stop-projection-");db=createDb(database.connectionString);
  for (const migration of ["0569_native_remote_workload_stop_projection.sql", "0574_native_in_process_backend_lifecycle.sql"]) {
   const forward=readFileSync(new URL(`../../../packages/db/src/migrations/${migration}`,import.meta.url),"utf8");
   for(const statement of forward.split("--> statement-breakpoint"))if(statement.trim())await db.execute(sql.raw(statement));
  }
 },45000);
 afterAll(async()=>{await database?.cleanup();},30000);
 async function seed(){
  const companyId=randomUUID(),agentId=randomUUID(),runId=randomUUID();await db.insert(companies).values({id:companyId,name:"Remote projection",issuePrefix:`RSP${++counter}`});
  await db.insert(agents).values({id:agentId,companyId,name:"Historical owner",adapterType:"paperclip_runner",status:"running"});
  await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,runtimeMode:"native",status:"succeeded",finishedAt:new Date(),nativePhase:"committed",processPid:123456789,processGroupId:123456788});
  return {companyId,agentId,runId};
 }
 const state=async(f:Awaited<ReturnType<typeof seed>>)=>(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,f.runId)))[0]!;
 const occupancy=async(companyId:string)=>{const [row]=await db.execute<{count:string}>(sql`select public.aw_v10_resource_durable_occupancy(${companyId}::uuid)::text as count`);return Number(row!.count);};
 const event=(f:Awaited<ReturnType<typeof seed>>,eventType:string,payload:Record<string,unknown>={fixture:"SQL projection only; signed API positive belongs to original Sandbox fixture"})=>appendHeartbeatRunEvent(db,{...f,eventType,stream:"system",payload});
 it("projects an original server event through the existing guard without erasing historical PID/group",async()=>{
  const f=await seed();await event(f,"native.process_start_requested");expect(await occupancy(f.companyId)).toBe(1);
  await event(f,NATIVE_REMOTE_WORKLOAD_STOPPED);expect((await state(f)).nativeProcessCleanupPending).toBe(false);expect(await occupancy(f.companyId)).toBe(0);
  expect(await state(f)).toMatchObject({processPid:123456789,processGroupId:123456788});
 });
 it.each(["native.process_start_requested","native.process_identity_recorded"])("re-fences after later original %s",async eventType=>{
  const f=await seed();await event(f,NATIVE_REMOTE_WORKLOAD_STOPPED);expect(await occupancy(f.companyId)).toBe(0);
  await event(f,eventType);expect((await state(f)).nativeProcessCleanupPending).toBe(true);expect(await occupancy(f.companyId)).toBe(1);
 });
 it("retains original local-stop behavior",async()=>{
  const f=await seed();await event(f,"native.process_start_requested");await event(f,"native.local_process_stopped");expect((await state(f)).nativeProcessCleanupPending).toBe(false);expect(await occupancy(f.companyId)).toBe(0);
 });
 it("requires the exact in-process admission and never closes a live process from its settled event",async()=>{
  const f=await seed();const admission=await event(f,"native.in_process_backend_admitted");
  expect((await state(f)).nativeProcessCleanupPending).toBe(true);
  await event(f,"native.process_start_requested");expect((await state(f)).nativeProcessCleanupPending).toBe(true);
  await event(f,"native.in_process_backend_settled",{admissionEventSeq:admission.row.seq});
  expect((await state(f)).nativeProcessCleanupPending).toBe(true);expect(await occupancy(f.companyId)).toBe(1);
  await expect(event(f,"native.in_process_backend_settled",{admissionEventSeq:999999})).rejects.toMatchObject({cause:{code:"23514"}});
  expect((await state(f)).nativeProcessCleanupPending).toBe(true);expect(await occupancy(f.companyId)).toBe(1);
 });
 it("ignores imported/copy source events and keeps direct projection writes fenced",async()=>{
  const f=await seed();await event(f,"native.process_start_requested");
  await appendHeartbeatRunEvent(db,{...f,eventType:NATIVE_REMOTE_WORKLOAD_STOPPED,nativeSource:{sourceInstanceId:randomUUID(),sourceEventId:randomUUID(),sourceSeq:1,protocolSchemaVersion:1,canonicalPayload:{copied:true}}});
  expect((await state(f)).nativeProcessCleanupPending).toBe(true);expect(await occupancy(f.companyId)).toBe(1);
  await expect(db.update(heartbeatRuns).set({nativeProcessCleanupPending:false}).where(eq(heartbeatRuns.id,f.runId))).rejects.toMatchObject({cause:{code:"23514"}});
 });
 it("does not let an older stop sequence or foreign-Agent event overwrite a current original launch",async()=>{
  const f=await seed();await event(f,"native.process_start_requested");const owner=randomUUID();await db.insert(agents).values({id:owner,companyId:f.companyId,name:"Different owner",adapterType:"paperclip_runner"});
  await db.insert(heartbeatRunEvents).values({...f,seq:0,eventType:NATIVE_REMOTE_WORKLOAD_STOPPED});
  await db.insert(heartbeatRunEvents).values({...f,agentId:owner,seq:2,eventType:NATIVE_REMOTE_WORKLOAD_STOPPED});
  expect((await state(f)).nativeProcessCleanupPending).toBe(true);expect(await occupancy(f.companyId)).toBe(1);
 });
 it("rejects direct flags without any original event, including initial insert",async()=>{
  const f=await seed();await expect(db.update(heartbeatRuns).set({nativeProcessCleanupPending:false}).where(eq(heartbeatRuns.id,f.runId))).rejects.toMatchObject({cause:{code:"23514"}});
  await expect(db.insert(heartbeatRuns).values({companyId:f.companyId,agentId:f.agentId,runtimeMode:"native",nativeProcessCleanupPending:false})).rejects.toMatchObject({cause:{code:"23514"}});
 });
 it("reads only exact original intent as closed string refs without writing",async()=>{
  const f=await seed();expect(await readNativeRemoteWorkloadIntent(db,f)).toBeNull();
  await appendHeartbeatRunEvent(db,{...f,eventType:"native.process_start_requested",nativeSource:{sourceInstanceId:randomUUID(),sourceEventId:randomUUID(),sourceSeq:1,protocolSchemaVersion:1,canonicalPayload:{imported:true}}});
  expect(await readNativeRemoteWorkloadIntent(db,f)).toBeNull();
  const original=await event(f,"native.process_start_requested");const before=await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,f.runId));
  expect(await readNativeRemoteWorkloadIntent(db,f)).toEqual({eventId:String(original.row.id),seq:String(original.row.seq),createdAt:original.row.createdAt.toISOString()});
  expect(await readNativeRemoteWorkloadIntent(db,{...f,agentId:randomUUID()})).toBeNull();
  expect(await readNativeRemoteWorkloadIntent(db,{...f,companyId:randomUUID()})).toBeNull();
  expect(await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,f.runId))).toHaveLength(before.length);
  expect((await state(f)).nativeProcessCleanupPending).toBe(true);
 });
 it("does not manufacture an event from missing locator or generic provider receipts",async()=>{
  const f=await seed();await event(f,"native.process_start_requested");expect(await recordNativeRemoteWorkloadStopped(db,f)).toBe(false);
  const environmentId=randomUUID(),leaseId=randomUUID();await db.insert(environments).values({id:environmentId,name:"Unknown remote "+leaseId,driver:"fixture_remote"});
  const lease={id:leaseId,companyId:f.companyId,heartbeatRunId:f.runId,provider:"fixture_remote",providerLeaseId:"remote-"+leaseId};
  await db.insert(environmentLeases).values({...lease,environmentId,status:"released",cleanupStatus:"success",releasedAt:new Date(),metadata:{remoteExecutionTermination:remoteTerminationReceipt(lease,{providerLeaseId:lease.providerLeaseId,state:"stopped"})}});
  expect(await remoteExecutionHasStopped(db,f.companyId,f.runId)).toBe(true);expect(await recordNativeRemoteWorkloadStopped(db,f)).toBe(false);
  await db.update(heartbeatRuns).set({runnerProfileJson:{nativeRemoteRuntimeAssetLocator:{unknown:true}}}).where(eq(heartbeatRuns.id,f.runId));
  expect(await recordNativeRemoteWorkloadStopped(db,f)).toBe(false);expect(await occupancy(f.companyId)).toBe(1);
  const rows=await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId,f.runId));expect(rows.filter(row=>row.eventType===NATIVE_REMOTE_WORKLOAD_STOPPED)).toHaveLength(0);
 });
});
