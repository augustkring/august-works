import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createDb, companies, agents, heartbeatRuns, toolPolicies, environmentLeases, environments, toolApplications, toolConnections, toolCatalogEntries, connectionGrants } from "@paperclipai/db";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { callCogneeCloud } from "../services/cognee-connection.js";
import { runnerApiRestriction } from "../services/native-runtime/runner-api-policy.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("opaque MCP company purpose actual entries", () => {
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

 for (const transport of ["mcp_remote", "local_stdio"] as const) for (const entry of ["manual", "legacy_run"] as const)
 it(`denies ${entry} ${transport} unknown model effects before secrets or invocation while discovery remains available`, async () => {
  const { company, agent, run, gateway, remote } = await fixture("legacy");
  const [app] = await db.insert(toolApplications).values({companyId:company.id,applicationKey:randomUUID(),name:"Opaque connector",type:transport==="mcp_remote"?"mcp_http":"mcp_stdio",status:"active"}).returning();
  const credentialSecretRefs=[{secretId:randomUUID(),configPath:"headers.Authorization",versionSelector:"latest" as const,required:true}];
  const [connection]=await db.insert(toolConnections).values({companyId:company.id,applicationId:app!.id,name:"Opaque connector",uid:randomUUID(),transport,status:"active",enabled:true,healthStatus:"ok",credentialPolicy:"shared",config:transport==="mcp_remote"?{url:"https://8.8.8.8/mcp"}:{templateId:"paperclip.google-sheets"},transportConfig:transport==="local_stdio"?{templateId:"paperclip.google-sheets"}:{},credentialSecretRefs}).returning();
  await db.insert(connectionGrants).values({companyId:company.id,connectionId:connection!.id,kind:"organization",status:"active",isDefault:true,credentialSecretRefs});
  await db.insert(toolCatalogEntries).values({companyId:company.id,applicationId:app!.id,connectionId:connection!.id,entryKind:"tool",versionHash:randomUUID(),name:"read_status",toolName:"read_status",inputSchema:{type:"object",additionalProperties:true},annotations:{readOnlyHint:true},riskLevel:"read",isReadOnly:true,status:"active"});
  await db.insert(toolPolicies).values({companyId:company.id,name:"allow all",policyType:"allow",selectors:{}});
  const parameters={url:"https://api.openai.com/v1/responses",method:"POST",body:{model:"unqualified-model",input:"paid work"}};
  let call: Promise<unknown>;
  if(entry==="manual") call=gateway.executeTestCall({companyId:company.id,agentId:agent.id,userId:"board-user",connectionId:connection!.id,toolName:"read_status",parameters});
  else {
   const session=await gateway.createSession({companyId:company.id,agentId:agent.id,runId:run.id});
   const tools=await gateway.listToolsForSession(session.token);
   const tool=tools.find(t=>t.connectionId===connection!.id)!;
   expect(tool).toBeDefined(); // catalogue/discovery is retained, not invocation qualification
   call=gateway.executeTool({sessionToken:session.token,tool:tool.name,parameters});
  }
  await expect(call).rejects.toMatchObject({status:409,reasonCode:"tool_model_effect_unqualified",details:{code:"configuration_incomplete",configurationIncomplete:{actionUrl:"/apps"}}});
  // Missing mandatory secret would throw credential-resolution failure if reached.
  // The actual gateway returns the model-effect denial instead, before any transport.
  expect(remote).not.toHaveBeenCalled();
 });
});
