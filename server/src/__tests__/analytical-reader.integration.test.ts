import {randomUUID} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {agents,authUsers,companies,companyMemberships,heartbeatRuns,issues,businessMetricObservations,createDb} from "@paperclipai/db";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {assertAnalyticalReader,analyticalRequesterId,withNativeAnalyticalReader} from "../services/analytical-reader.js";
import {instanceSettingsService} from "../services/instance-settings.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {aiGovernanceService} from "../services/ai-governance/governance-service.js";
import {analyticalPurpose,metricDefinition} from "./helpers/business-metric-fixture.js";
import {getEmbeddedPostgresTestSupport,startEmbeddedPostgresTestDatabase} from "./helpers/embedded-postgres.js";
const support=await getEmbeddedPostgresTestSupport(),board={type:"board" as const,source:"local_implicit" as const};
describe.skipIf(!support.supported)("Current native analytical conversation identity on PostgreSQL",()=>{
 let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>,companyId:string,userId:string,agentId:string,issueId:string,runId:string;
 beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-analytical-reader-");db=createDb(database.connectionString);});afterAll(async()=>database?.cleanup());
 beforeEach(async()=>{
  await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({analytical_lineage_v8:true,business_metrics_v8:true,management_reviews_v8:true,management_chat_tools_v8:true,enableContextEngineV1:true,ai_use_cases_v7:true,governance_evidence_v7:true});companyId=randomUUID();userId=randomUUID();agentId=randomUUID();issueId=randomUUID();runId=randomUUID();
  await db.insert(companies).values({id:companyId,name:"Synthetic private native analytical conversation",issuePrefix:randomUUID()});await db.insert(authUsers).values({id:userId,name:"Current human",email:`${userId}@example.test`,createdAt:new Date(),updatedAt:new Date()});await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:userId,membershipRole:"admin",status:"active"});await db.insert(agents).values({id:agentId,companyId,name:"Native analytical reader",role:"engineer",status:"active",adapterType:"paperclip_runner"});
  await db.insert(issues).values({id:issueId,companyId,title:"Private native conversation",assigneeAgentId:agentId,conversationAgentId:agentId,conversationUserId:userId,conversationState:"active",responsibleUserId:userId});await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,nativeIssueId:issueId,runtimeMode:"native",status:"running",responsibleUserId:userId,contextSnapshot:{issueId}});await db.update(issues).set({executionRunId:runId}).where(eq(issues.id,issueId));
 });
 const actor=()=>({type:"agent" as const,source:"agent_jwt" as const,companyId,agentId,runId,onBehalfOfUserId:userId});
 const nativeRead=<T>(read:()=>Promise<T>)=>withNativeAnalyticalReader(db,companyId,actor(),read);
 it("revokes the internal permit for a detached callback after its retained read has returned",async()=>{
  let release!:()=>void;const delay=new Promise<void>(resolve=>{release=resolve;});let detached!:Promise<void>;
  await nativeRead(async()=>{detached=delay.then(()=>assertAnalyticalReader(db,companyId,actor()));});
  release();await expect(detached).rejects.toMatchObject({status:403});
 });
 it("admits only a persisted running native private conversation without producing a board identity",async()=>{await expect(nativeRead(()=>assertAnalyticalReader(db,companyId,actor()))).resolves.toBeUndefined();expect(analyticalRequesterId(actor())).toBe(`agent:${agentId}`);for(const changed of [{source:"agent_key" as const},{runId:randomUUID()},{runId:"malformed"},{onBehalfOfUserId:randomUUID()},{companyId:randomUUID()},{agentId:randomUUID()}])await expect(nativeRead(()=>assertAnalyticalReader(db,companyId,{...actor(),...changed}))).rejects.toMatchObject({status:403});});
 it.each(["run","conversation_owner","assignment","human","agent","hidden"])("withdraws native read authority after current %s changes",async(kind)=>{
  if(kind==="run")await db.update(heartbeatRuns).set({status:"succeeded"}).where(eq(heartbeatRuns.id,runId));if(kind==="conversation_owner")await db.update(issues).set({conversationUserId:randomUUID()}).where(eq(issues.id,issueId));if(kind==="assignment")await db.update(issues).set({executionRunId:null}).where(eq(issues.id,issueId));if(kind==="human")await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));if(kind==="agent")await db.update(agents).set({status:"paused"}).where(eq(agents.id,agentId));if(kind==="hidden")await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,issueId));await expect(nativeRead(()=>assertAnalyticalReader(db,companyId,actor()))).rejects.toMatchObject({status:403});
 });
 it("refuses ordinary agent reads without the private retained boundary and releases the permit after return",async()=>{await expect(assertAnalyticalReader(db,companyId,actor())).rejects.toMatchObject({status:403});await nativeRead(()=>assertAnalyticalReader(db,companyId,actor()));await expect(businessMetricService(db).list(companyId,actor())).rejects.toMatchObject({status:403});await expect(assertAnalyticalReader(db,companyId,actor())).rejects.toMatchObject({status:403});});
 it("requires explicit native rollout and preserves human-only metric publication",async()=>{await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({management_chat_tools_v8:false});await expect(nativeRead(()=>assertAnalyticalReader(db,companyId,actor()))).rejects.toMatchObject({status:404});await expect(assertAnalyticalReader(db,companyId,board)).resolves.toBeUndefined();await expect(businessMetricService(db).create(companyId,actor(),{key:"forbidden",definition:metricDefinition(randomUUID())})).rejects.toMatchObject({status:403});});
 async function ordinaryTask(){await db.update(issues).set({conversationAgentId:null,conversationUserId:null,conversationState:null}).where(eq(issues.id,issueId));}
 const taskRead=<T>(read:()=>Promise<T>)=>withNativeAnalyticalReader(db,companyId,actor(),read,"task");
 it("admits an actual ordinary Task only at the explicit in-process boundary and preserves the private tool gate",async()=>{
  await ordinaryTask();await expect(nativeRead(()=>assertAnalyticalReader(db,companyId,actor()))).rejects.toMatchObject({status:403});
  await expect(taskRead(()=>assertAnalyticalReader(db,companyId,actor()))).resolves.toBeUndefined();
  await expect(assertAnalyticalReader(db,companyId,actor())).rejects.toMatchObject({status:403});
  await expect(taskRead(()=>withNativeAnalyticalReader(db,companyId,actor(),()=>assertAnalyticalReader(db,companyId,actor())))).resolves.toBeUndefined();
 });
 it("uses only persisted Task ownership before native runtime selection and refuses resolved legacy execution",async()=>{
  await ordinaryTask();await db.update(heartbeatRuns).set({nativeIssueId:null,runtimeMode:"legacy",runtimeModeResolvedAt:null}).where(eq(heartbeatRuns.id,runId));
  await expect(taskRead(()=>assertAnalyticalReader(db,companyId,actor()))).resolves.toBeUndefined();
  await db.update(heartbeatRuns).set({runtimeModeResolvedAt:new Date()}).where(eq(heartbeatRuns.id,runId));await expect(taskRead(()=>assertAnalyticalReader(db,companyId,actor()))).rejects.toMatchObject({status:403});
 });
 it("does not inherit an expired Task permit in a detached new source read",async()=>{
  await ordinaryTask();let release!:()=>void;const delay=new Promise<void>(resolve=>{release=resolve;});let detached!:Promise<void>;
  await taskRead(async()=>{detached=delay.then(()=>withNativeAnalyticalReader(db,companyId,actor(),()=>assertAnalyticalReader(db,companyId,actor())));});
  release();await expect(detached).rejects.toMatchObject({status:403});
 });
 it.each(["task_owner","assignment","human","hidden","run","agent","retired","forged_task"])("withdraws the ordinary Task permit after current %s changes",async(kind)=>{
  await ordinaryTask();
  if(kind==="task_owner")await db.update(issues).set({responsibleUserId:randomUUID()}).where(eq(issues.id,issueId));
  if(kind==="assignment")await db.update(issues).set({executionRunId:null}).where(eq(issues.id,issueId));
  if(kind==="human")await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));
  if(kind==="hidden")await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,issueId));
  if(kind==="run")await db.update(heartbeatRuns).set({status:"succeeded"}).where(eq(heartbeatRuns.id,runId));
  if(kind==="agent")await db.update(agents).set({status:"paused"}).where(eq(agents.id,agentId));
  if(kind==="retired")await db.update(issues).set({conversationRetiredAt:new Date(),status:"cancelled",hiddenAt:new Date(),assigneeAgentId:null,assigneeUserId:null,executionRunId:null,checkoutRunId:null}).where(eq(issues.id,issueId));
  if(kind==="forged_task")await db.update(heartbeatRuns).set({nativeIssueId:null,contextSnapshot:{issueId:randomUUID()}}).where(eq(heartbeatRuns.id,runId));
  await expect(taskRead(()=>assertAnalyticalReader(db,companyId,actor()))).rejects.toMatchObject({status:403});
 });
 it("lists only currently admitted published metrics and keeps later human draft definitions out of agent reads",async()=>{
  const policy=(await aiGovernanceService(db).obligation(board,companyId,analyticalPurpose())).id,owner=businessMetricService(db),definition={...metricDefinition(policy),ownerUserId:userId},published=await owner.create(companyId,board,{key:"published",definition});await owner.publish(companyId,board,published.metric.id,{expectedRevision:1,versionId:published.version.id});await owner.create(companyId,board,{key:"private_unpublished",definition});const pending=await owner.createVersion(companyId,board,published.metric.id,{expectedRevision:2,definition:{...definition,name:"Private proposed definition awaiting human publication"}});const list=await nativeRead(()=>owner.list(companyId,actor()));expect(list.items.map(item=>item.key)).toEqual(["published"]);const detail=await nativeRead(()=>owner.detail(companyId,actor(),published.metric.id));expect(detail.versions.map(version=>version.id)).toEqual([published.version.id]);expect(JSON.stringify(detail)).not.toContain(pending.id);expect(JSON.stringify(detail)).not.toContain("Private proposed definition");
 });
 it("withholds a complete native population when another contributing task is hidden and leaves no measurement behind",async()=>{
  const policy=(await aiGovernanceService(db).obligation(board,companyId,analyticalPurpose())).id,owner=businessMetricService(db),created=await owner.create(companyId,board,{key:"hidden_population",definition:{...metricDefinition(policy),ownerUserId:userId}});await owner.publish(companyId,board,created.metric.id,{expectedRevision:1,versionId:created.version.id});await db.insert(issues).values({companyId,title:"Hidden contributing native task",status:"done",hiddenAt:new Date(),responsibleUserId:userId});const now=new Date();await expect(nativeRead(()=>owner.query(companyId,actor(),{metricId:created.metric.id,versionId:created.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:now.toISOString(),dimensions:[],maxRows:100}))).rejects.toMatchObject({status:403});expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId,companyId))).toHaveLength(0);
 });
 it("uses both current principals for a native measurement and records the actual agent requester",async()=>{
  const policy=(await aiGovernanceService(db).obligation(board,companyId,analyticalPurpose())).id,owner=businessMetricService(db),definition={...metricDefinition(policy),ownerUserId:userId},created=await owner.create(companyId,board,{key:"native",definition});await owner.publish(companyId,board,created.metric.id,{expectedRevision:1,versionId:created.version.id});const now=new Date(),result=await nativeRead(()=>owner.query(companyId,actor(),{metricId:created.metric.id,versionId:created.version.id,from:new Date(now.getTime()-86400000).toISOString(),until:now.toISOString(),dimensions:[],maxRows:100}));expect((await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.id,result.id)))[0]!.requestedBy).toBe(`agent:${agentId}`);await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalId,userId)));await expect(nativeRead(()=>owner.inspectCurrentObservation(companyId,actor(),result.id))).rejects.toMatchObject({status:403});
 });
});
