import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createDb, companies, agents, heartbeatRuns, toolPolicies, environmentLeases, environments, toolApplications, toolConnections, toolCatalogEntries, connectionGrants } from "@paperclipai/db";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { callCogneeCloud } from "../services/cognee-connection.js";
import { runnerApiRestriction } from "../services/native-runtime/runner-api-policy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("tool internal inference admission actual entries", () => {
 let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
 let db: ReturnType<typeof createDb>;
 beforeAll(async () => { temp=await startEmbeddedPostgresTestDatabase("tool-inference-admission-"); db=createDb(temp.connectionString); },30000);
 afterAll(async () => { await temp?.cleanup(); });
 async function fixture(runtimeMode: string) {
  const [company]=await db.insert(companies).values({name:randomUUID(), issuePrefix:"T"+randomUUID().slice(0,6)}).returning();
  const [agent]=await db.insert(agents).values({companyId:company!.id,name:"Fixture",role:"engineer",adapterType:"process"}).returning();
  const [run]=await db.insert(heartbeatRuns).values({companyId:company!.id,agentId:agent!.id,status:"running",runtimeMode}).returning();
  const invoke=vi.fn(async () => ({pluginId:"fixture",toolName:"read_status",result:{content:"ok",data:{ok:true}}}));
  const remote=vi.fn(async()=>{throw Error("external MCP contacted");});
  const gateway=createToolGatewayService(db,{ remoteHttpRequest:remote, toolActionSigningSecret:"test-signing-secret",pluginToolDispatcher:{
   initialize:async()=>{},teardown:()=>{},listToolsForAgent:()=>[{name:"fixture:read_status",displayName:"Status",description:"Opaque plugin",parametersSchema:{type:"object"},pluginId:"fixture"}],
   getTool:()=>null,executeTool:invoke,registerPluginTools:()=>{},unregisterPluginTools:()=>{},toolCount:()=>1,getRegistry:()=>{throw Error("unused");},
  }});
  await db.insert(toolPolicies).values({companyId:company!.id,name:"allow",policyType:"allow",selectors:{toolName:"fixture:read_status"}});
  return {company:company!,agent:agent!,run:run!,invoke,gateway,remote};
 }
 for(const entry of ["plugin_route","session"] as const) it(`denies Native ${entry} before opaque worker even when plugin claims read status`,async()=>{
  const {company,agent,run,invoke,gateway}=await fixture("native");
  const call=entry==="plugin_route" ? gateway.executePluginTool({actor:{type:"agent",companyId:company.id,agentId:agent.id,runId:run.id},tool:"fixture:read_status",parameters:{},runContext:{companyId:company.id,agentId:agent.id,runId:run.id}})
   : gateway.createSession({companyId:company.id,agentId:agent.id,runId:run.id}).then(session=>gateway.executeTool({sessionToken:session.token,tool:"fixture:read_status",parameters:{}}));
  await expect(call).rejects.toMatchObject({status:409,message:"This tool is not available for managed work. Choose an available tool or contact your company administrator.",reasonCode:"tool_model_effect_unqualified",details:{code:"configuration_incomplete",configurationIncomplete:{owner:"Managed model gateway owner",actionUrl:"/apps"}}});
  expect(invoke).not.toHaveBeenCalled();
 });
 it("denies legacy run with realized Sandbox lease despite absence of Native/profile metadata",async()=>{
  const {company,agent,run,invoke,gateway}=await fixture("legacy");
  const [environment]=await db.insert(environments).values({name:"Sandbox"+randomUUID(),driver:"sandbox"}).returning();
  await db.insert(environmentLeases).values({companyId:company.id,heartbeatRunId:run.id,environmentId:environment!.id,provider:"arbitrary-sandbox-provider",status:"active"});
  await expect(gateway.executePluginTool({actor:{type:"agent",companyId:company.id,agentId:agent.id,runId:run.id},tool:"fixture:read_status",parameters:{},runContext:{companyId:company.id,agentId:agent.id,runId:run.id}})).rejects.toMatchObject({reasonCode:"tool_model_effect_unqualified"});
  expect(invoke).not.toHaveBeenCalled();
 });
 it("rejects Cognee recall at gateway before resolving required missing credentials in ordinary legacy session",async()=>{
  const {company,agent,run,gateway}=await fixture("legacy");
  const [app]=await db.insert(toolApplications).values({companyId:company.id,applicationKey:"cognee",name:"Cognee",type:"mcp_stdio",status:"active"}).returning();
  const [connection]=await db.insert(toolConnections).values({companyId:company.id,applicationId:app!.id,name:"Cognee",uid:randomUUID(),transport:"local_stdio",status:"active",enabled:true,healthStatus:"ok",credentialPolicy:"shared",config:{templateId:"paperclip.cognee-cloud"},transportConfig:{templateId:"paperclip.cognee-cloud"},credentialSecretRefs:[]}).returning();
  await db.insert(connectionGrants).values({companyId:company.id,connectionId:connection!.id,kind:"organization",status:"active",isDefault:true,credentialSecretRefs:[]});
  await db.insert(toolCatalogEntries).values({companyId:company.id,applicationId:app!.id,connectionId:connection!.id,entryKind:"tool",versionHash:randomUUID(),name:"recall",toolName:"recall",inputSchema:{type:"object"},annotations:{readOnlyHint:true},riskLevel:"read",isReadOnly:true,status:"active"});
  await db.insert(toolPolicies).values({companyId:company.id,name:"allow all",policyType:"allow",selectors:{}});
  const session=await gateway.createSession({companyId:company.id,agentId:agent.id,runId:run.id});
  const tool=(await gateway.listToolsForSession(session.token)).find(t=>t.connectionId===connection!.id)!;
  expect(tool).toBeDefined();
  await expect(gateway.executeTool({sessionToken:session.token,tool:tool.name,parameters:{query:"synthetic"}})).rejects.toMatchObject({reasonCode:"tool_model_effect_unqualified",details:{code:"configuration_incomplete"}});
 });
 it("denies platform initiated legacy plugin entry without whole invocation contract",async()=>{
  const {company,agent,run,invoke,gateway}=await fixture("legacy");
  await expect(gateway.executePluginTool({actor:{type:"agent",companyId:company.id,agentId:agent.id,runId:run.id},tool:"fixture:read_status",parameters:{},runContext:{companyId:company.id,agentId:agent.id,runId:run.id}})).rejects.toMatchObject({reasonCode:"tool_model_effect_unqualified"});
  expect(invoke).not.toHaveBeenCalled();
 });
 for(const managed of ["native","sandbox"] as const) it(`denies ${managed} external MCP before credential selection or network initialization`,async()=>{
  const {company,agent,run,gateway,remote}=await fixture(managed==="native"?"native":"legacy");
  if(managed==="sandbox") {
   const [env]=await db.insert(environments).values({name:randomUUID(),driver:"sandbox"}).returning();
   await db.insert(environmentLeases).values({companyId:company.id,heartbeatRunId:run.id,environmentId:env!.id,provider:"fixture-provider",status:"active"});
  }
  const [app]=await db.insert(toolApplications).values({companyId:company.id,applicationKey:"remote",name:"Remote",type:"mcp_http",status:"active"}).returning();
  const [connection]=await db.insert(toolConnections).values({companyId:company.id,applicationId:app!.id,name:"Remote",uid:randomUUID(),transport:"mcp_remote",status:"active",enabled:true,healthStatus:"ok",credentialPolicy:"shared",config:{url:"https://8.8.8.8/mcp"},credentialSecretRefs:[]}).returning();
  await db.insert(connectionGrants).values({companyId:company.id,connectionId:connection!.id,kind:"organization",status:"active",isDefault:true,credentialSecretRefs:[]});
  await db.insert(toolCatalogEntries).values({companyId:company.id,applicationId:app!.id,connectionId:connection!.id,entryKind:"tool",versionHash:randomUUID(),name:"read_status",toolName:"read_status",inputSchema:{type:"object"},annotations:{readOnlyHint:true},riskLevel:"read",isReadOnly:true,status:"active"});
  await db.insert(toolPolicies).values({companyId:company.id,name:"allow all",policyType:"allow",selectors:{}});
  const session=await gateway.createSession({companyId:company.id,agentId:agent.id,runId:run.id});
  const tool=(await gateway.listToolsForSession(session.token)).find(t=>t.connectionId===connection!.id)!;
  expect(tool).toBeDefined();
  await expect(gateway.executeTool({sessionToken:session.token,tool:tool.name,parameters:{}})).rejects.toMatchObject({reasonCode:"tool_model_effect_unqualified",details:{code:"configuration_incomplete"}});
  expect(remote).not.toHaveBeenCalled();
 });
 for(const tool of ["remember","recall"]) it(`rejects taskless Cognee ${tool} before reading credentials or making HTTP`,async()=>{
  const request=vi.fn(); const credentials=vi.fn(()=>{ throw Error("credential accessed"); });
  const input={tool,parameters:{query:"model prompt",custom_prompt:"model prompt"},request,signal:AbortSignal.timeout(1000),get apiKey():string{return credentials();},get baseUrl():string{return credentials();}};
  await expect(callCogneeCloud(input)).rejects.toMatchObject({code:"configuration_incomplete",provider:"cognee_model_operation"});
  expect(credentials).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 });
 it("retains explicit Cognee forget without model invocation",async()=>{
  const request=vi.fn(async(_url: URL,_init: RequestInit)=>({ok:true}));
  await callCogneeCloud({tool:"forget",parameters:{dataset:"fixture"},request,signal:AbortSignal.timeout(1000),apiKey:"fixture",baseUrl:"https://fixture.aws.cognee.ai"});
  expect(request).toHaveBeenCalledOnce();expect(request.mock.calls[0]?.[0].pathname).toBe("/api/v1/forget");
 });
 it("rejects Native generic API plugin escape while preserving canonical metadata and Stop routes",()=>{
  expect(runnerApiRestriction("POST","/api/plugins/tools/execute")).toContain("configuration_incomplete");
  expect(runnerApiRestriction("GET","/api/plugins/tools")).toBeNull();
  expect(runnerApiRestriction("GET","/api/issues/{issueId}")).toBeNull();
  expect(runnerApiRestriction("POST","/api/plugins/{pluginId}/stop")).toBeNull();
 });
});
