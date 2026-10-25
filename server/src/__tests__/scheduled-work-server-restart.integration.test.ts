import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { agentWakeupRequests, companies, createDb, heartbeatRuns, issues, routineRuns, routineTriggers, type Db } from "@paperclipai/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedCurrentHumanSourceActor, createCanonicalHumanProject } from "./helpers/current-human-source-fixture.js";
import { agentService } from "../services/agents.js";
import { routineService } from "../services/routines.js";
import { instanceSettingsService } from "../services/instance-settings.js";

const support=await getEmbeddedPostgresTestSupport();
const serverRoot=fileURLToPath(new URL("../../",import.meta.url));
const entry=path.join(serverRoot,"dist-runtime","index.mjs");
async function bundleFingerprint(){
  const files=(await fs.readdir(path.dirname(entry))).filter(name=>name.endsWith(".mjs")).sort();
  const hashes:Record<string,string>={};
  for(const name of files)hashes[name]=createHash("sha256").update(await fs.readFile(path.join(path.dirname(entry),name))).digest("hex");
  return {files:hashes,sha256:createHash("sha256").update(JSON.stringify(hashes)).digest("hex")};
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function availablePort(){
  const socket=net.createServer();socket.listen(0,"127.0.0.1");await once(socket,"listening");
  const address=socket.address();if(!address || typeof address==="string")throw new Error("Test listener unavailable");
  await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));return address.port;
}

describe.skipIf(!support.supported)("UP13 assembled built server scheduled restart",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:Db,tempRoot:string;
  let child:ChildProcess|null=null,logs="",port:number,configPath:string,childEnv:NodeJS.ProcessEnv;
  const startedPids:number[]=[],closedPids:number[]=[];
  let originalBundle:Awaited<ReturnType<typeof bundleFingerprint>>;
  const sourceHashes:Record<string,string>={};
  beforeAll(async()=>{
    // Build preparation uses the repository's original server build and
    // scripts/bundle-runtime.mjs, outside this test under the shared PG lock.
    // Never substitute the isolated worker or a fixture scheduler for index.ts.
    await fs.access(entry);
    originalBundle=await bundleFingerprint();
    for(const relative of ["index.ts","services/scheduled-work.ts","services/routines.ts","services/delivery-work-coordinator.ts"])
      sourceHashes[relative]=createHash("sha256").update(await fs.readFile(path.join(serverRoot,"src",relative))).digest("hex");
    database=await startEmbeddedPostgresTestDatabase("aw-up13-full-server-");db=createDb(database.connectionString,{maxConnections:3});
    const settings=instanceSettingsService(db);
    await settings.getExperimental(); // Ensure the canonical singleton exists before the shared helper updates it.
    await enableV5ForTest(db);
    expect(await settings.getExperimental()).toMatchObject({agent_identities_v5:true,agent_multi_company_presence_v5:true,enableFoundationV1:true,enableContextEngineV1:true});
    tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),"aw-up13-full-server-"));port=await availablePort();
    configPath=path.join(tempRoot,"config.json");
    await fs.writeFile(configPath,JSON.stringify({$meta:{version:1,updatedAt:new Date().toISOString(),source:"doctor"},
      database:{mode:"postgres",connectionString:database.connectionString,embeddedPostgresDataDir:path.join(tempRoot,"unused-embedded"),embeddedPostgresPort:54329,
        backup:{enabled:false,intervalMinutes:60,retentionDays:30,dir:path.join(tempRoot,"backups")}},
      logging:{mode:"file",logDir:path.join(tempRoot,"logs")},
      server:{deploymentMode:"local_trusted",exposure:"private",host:"127.0.0.1",port,allowedHostnames:[],serveUi:false},
      auth:{baseUrlMode:"auto",disableSignUp:false},telemetry:{enabled:false},
      storage:{provider:"local_disk",localDisk:{baseDir:path.join(tempRoot,"storage")},s3:{bucket:"fixture",region:"us-east-1",prefix:"",forcePathStyle:false}},
      secrets:{provider:"local_encrypted",strictMode:false,localEncrypted:{keyFilePath:path.join(tempRoot,"secrets","master.key")}}}),{mode:0o600});
    childEnv={...process.env};for(const key of Object.keys(childEnv))if(key.startsWith("PAPERCLIP_"))delete childEnv[key];
    Object.assign(childEnv,{PAPERCLIP_CONFIG:configPath,PAPERCLIP_HOME:path.join(tempRoot,"home"),PAPERCLIP_INSTANCE_ID:"up13-built-restart",
      PAPERCLIP_CONTEXT:path.join(tempRoot,"context.json"),PAPERCLIP_AUTH_STORE:path.join(tempRoot,"auth.json"),
      DATABASE_URL:database.connectionString,HOST:"127.0.0.1",PORT:String(port),SERVE_UI:"false",
      HEARTBEAT_SCHEDULER_ENABLED:"true",HEARTBEAT_SCHEDULER_INTERVAL_MS:"10000",PAPERCLIP_DB_BACKUP_ENABLED:"false",
      PAPERCLIP_MIGRATION_AUTO_APPLY:"false",PAPERCLIP_MIGRATION_PROMPT:"never",PAPERCLIP_UI_DEV_MIDDLEWARE:"false",
      PAPERCLIP_DECISION_SIGNING_SECRET:"up13-isolated-server-fixture-signing-secret",PAPERCLIP_IN_WORKTREE:"false",
      AW_DEPLOYMENT_PROFILE:"local",DATABASE_POOL_MAX:"8",OTEL_SDK_DISABLED:"true",SENTRY_DSN:"",NODE_OPTIONS:"--max-old-space-size=2048"});
  },120000);
  async function stopServer(){
    const active=child;if(!active)return;
    if(!active.pid){child=null;throw new Error("Built server process was not spawned");}
    if(active.exitCode!==null || active.signalCode!==null){child=null;throw new Error(`Built server exited unexpectedly: ${active.exitCode}/${active.signalCode}\n${logs}`);}
    const exited=once(active,"exit");active.kill("SIGTERM");
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const result=await Promise.race([exited,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error("Built server graceful shutdown timed out")),30000);})]);
      expect(result).toEqual([0,null]);closedPids.push(active.pid!);child=null;
    } finally {if(timer)clearTimeout(timer);}
    await expect(fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).rejects.toThrow();
  }
  afterAll(async()=>{
    if(child){try {await stopServer();}catch {
      const active=child;if(active?.pid && active.exitCode===null && active.signalCode===null){
        const exited=once(active,"exit");try{process.kill(-active.pid,"SIGKILL");}catch{active.kill("SIGKILL");}
        await exited;
      }
      child=null;
    }}
    await database?.cleanup();if(tempRoot)await fs.rm(tempRoot,{recursive:true,force:true});
  });
  async function startServer(){
    logs="";child=spawn(process.execPath,[entry],{cwd:serverRoot,env:childEnv,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
    const active=child;
    let spawnError:Error|null=null;active.once("error",error=>{spawnError=error;});
    const append=(chunk:Buffer)=>{logs=(logs+chunk.toString()).slice(-262144);};active.stdout?.on("data",append);active.stderr?.on("data",append);
    await vi.waitFor(async()=>{
      if(spawnError)throw spawnError;
      if(active.exitCode!==null || active.signalCode!==null)throw new Error(`Built server failed to start: ${active.exitCode}/${active.signalCode}\n${logs}`);
      const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)});
      expect(response.ok).toBe(true);expect((await response.json()).startupRecovery?.phase).toBe("ready");
    },{timeout:45000,interval:100});
    startedPids.push(active.pid!);
  }
  async function canonicalEffect(routineId:string){
    const occurrences=await db.select().from(routineRuns).where(eq(routineRuns.routineId,routineId));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({source:"schedule",status:"issue_created",linkedIssueId:expect.any(String)});
    const tasks=await db.select().from(issues).where(eq(issues.originRunId,occurrences[0]!.id));
    expect(tasks).toHaveLength(1);expect(tasks[0]).toMatchObject({id:occurrences[0]!.linkedIssueId,originKind:"routine_execution",originId:routineId});
    const wakeups=await db.select().from(agentWakeupRequests).where(and(
      eq(agentWakeupRequests.companyId,occurrences[0]!.companyId),
      sql`${agentWakeupRequests.payload}->>'issueId' = ${tasks[0]!.id}`,
      sql`${agentWakeupRequests.payload}->'executionWait'->>'requestedIdempotencyKey' = ${`routine-assignment:${occurrences[0]!.id}`}`));
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]).toMatchObject({agentId:tasks[0]!.assigneeAgentId,source:"assignment",status:"skipped",
      reason:"heartbeat.wakeOnDemand.disabled",idempotencyKey:expect.stringMatching(/^execution-wait:[0-9a-f]{64}$/),
      payload:{issueId:tasks[0]!.id,executionWait:{wakeOnDemand:false,requestedIdempotencyKey:`routine-assignment:${occurrences[0]!.id}`}}});
    return {runId:occurrences[0]!.id,taskId:tasks[0]!.id};
  }
  it("recovers a deadline saved while stopped and never duplicates its canonical occurrence on another full restart",async()=>{
    const f=await seedV5Presences(db),actor=await seedCurrentHumanSourceActor(db,[f.home],f.userId);
    await db.update(companies).set({defaultResponsibleUserId:f.userId}).where(eq(companies.id,f.home));
    // Dispatch to the original Task owner is the effect under test. Its
    // independent Agent wake policy remains off, preventing any model/provider
    // invocation while the real assembled scheduler and lifecycle stay enabled.
    await agentService(db).update(f.presence.id,{adapterType:"process",adapterConfig:{command:process.execPath,args:["-e","process.stdout.write('offline fixture')"]},
      runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:false}}});
    const project=await createCanonicalHumanProject(db,f.home,actor,"Full server restart schedule");
    const routines=routineService(db,{sourceActor:actor,deploymentMode:"local_trusted"});
    const routine=await routines.create(f.home,{projectId:project.id,goalId:null,parentIssueId:null,title:"Persisted restart occurrence",
      description:"Create the saved offline Task once",assigneeAgentId:f.presence.id,priority:"medium",status:"active",
      concurrencyPolicy:"coalesce_if_active",catchUpPolicy:"skip_missed"},{userId:f.userId});
    expect(routine).toMatchObject({status:"active",executionTargetKind:"agent_task",responsibleUserId:f.userId,latestRevisionId:expect.any(String)});
    const {trigger}=await routines.createTrigger(routine.id,{kind:"schedule",cronExpression:"0 0 1 1 *",timezone:"UTC"},{userId:f.userId});
    expect(trigger).toMatchObject({enabled:true,archived:false,setupPending:false,nextRunAt:expect.any(Date)});
    await startServer();
    expect(await db.select().from(routineRuns).where(eq(routineRuns.routineId,routine.id))).toEqual([]);
    await stopServer();

    const due=new Date(Date.now()-1000);
    await db.update(routineTriggers).set({nextRunAt:due}).where(eq(routineTriggers.id,trigger.id));
    await sleep(100);
    expect(await db.select().from(routineRuns).where(eq(routineRuns.routineId,routine.id))).toEqual([]);
    await startServer();
    await vi.waitFor(()=>canonicalEffect(routine.id),{timeout:15000,interval:100});
    const original=await canonicalEffect(routine.id);await stopServer();

    // The original claim has advanced its durable deadline. A third actual
    // index.ts process must retain that state rather than replaying the firing.
    const [consumed]=await db.select().from(routineTriggers).where(eq(routineTriggers.id,trigger.id));
    expect(consumed!.nextRunAt!.getTime()).toBeGreaterThan(due.getTime());
    await startServer();
    const [saved]=await db.select().from(routineTriggers).where(eq(routineTriggers.id,trigger.id));
    expect(saved!.nextRunAt!.getTime()).toBe(consumed!.nextRunAt!.getTime());
    expect(await canonicalEffect(routine.id)).toEqual(original);await stopServer();
    expect(await canonicalEffect(routine.id)).toEqual(original);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId,f.presence.id))).toEqual([]);
    expect(await bundleFingerprint()).toEqual(originalBundle);
    for(const [relative,digest] of Object.entries(sourceHashes))
      expect(createHash("sha256").update(await fs.readFile(path.join(serverRoot,"src",relative))).digest("hex")).toBe(digest);
    expect(startedPids).toHaveLength(3);expect(closedPids).toEqual(startedPids);
    console.info(JSON.stringify({schema:"aw.up13-built-server-restart.v1",entry,bundleSha256:originalBundle.sha256,bundleFiles:originalBundle.files,sourceHashes,
      startedPids,gracefullyClosedPids:closedPids,original,duplicateOccurrences:0,providerInvocations:0}));
  },180000);
});
