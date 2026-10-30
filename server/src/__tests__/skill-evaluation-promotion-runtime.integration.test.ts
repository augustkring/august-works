import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { and, eq } from "drizzle-orm";
import { agentExecutionManifests, companySkills, companySkillVersions, companySkillEvalRuns,
  companySkillEvalScores, createDb, heartbeatRuns, pluginConfig, plugins, type Db } from "@paperclipai/db";
import { PROVIDER_CAPABILITY_FEATURES, skillCandidateInputSchema } from "@paperclipai/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { synchronizeCompanyAgentRuntimeOwners } from "../services/agent-runtime-owner-assignments.js";
import { pluginAgentRuntimeState } from "../services/plugin-agent-runtime-state.js";
import { companySkillService } from "../services/company-skills.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { skillEvaluationService } from "../services/skill-evaluations.js";
import { preparePlatformSkillAdmission } from "../services/platform-skill-admission.js";
import { blenteraPlatformContractHashes } from "../services/tool-gateway.js";
import { skillResolverService } from "../services/skill-resolver.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { costService } from "../services/costs.js";
import { agentService } from "../services/agents.js";

const support=await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("UP04 evaluated Skill promotion and immutable runtime consumer",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:Db,root:string;
  const oldHome=process.env.PAPERCLIP_HOME,oldInstance=process.env.PAPERCLIP_INSTANCE_ID;
  beforeAll(async()=>{
    database=await startEmbeddedPostgresTestDatabase("aw-up04-skill-evaluation-");db=createDb(database.connectionString);
    root=await fs.mkdtemp(path.join(os.tmpdir(),"aw-up04-skills-"));
    process.env.PAPERCLIP_HOME=root;process.env.PAPERCLIP_INSTANCE_ID="default";
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({enableBetaSkills:true});
  },120000);
  afterAll(async()=>{
    await database?.cleanup();if(root)await fs.rm(root,{recursive:true,force:true});
    if(oldHome===undefined)delete process.env.PAPERCLIP_HOME;else process.env.PAPERCLIP_HOME=oldHome;
    if(oldInstance===undefined)delete process.env.PAPERCLIP_INSTANCE_ID;else process.env.PAPERCLIP_INSTANCE_ID=oldInstance;
  });
  it("earns both promotions from pinned evaluations and preserves only currently authorized immutable assignments",async()=>{
    const f=await seedV5Presences(db),actor=await seedCurrentHumanSourceActor(db,[f.home],f.userId),agentId=f.presence.id;
    const lifecycle=skillLifecycleService(db),evaluations=skillEvaluationService(db),skills=companySkillService(db),fabric=agentRuntimeFabricService(db);
    const draft=await lifecycle.createDraft(actor,f.home,{slug:"zephyr-receipts",name:"Zephyr receipts",description:"Review a zephyr receipt",
      markdown:"# Zephyr receipts\n\nReview the receipt and report its discrepancies.",triggerTerms:["zephyr"],excludeTerms:[],sharing:"company_proposed"});
    const suite=await evaluations.createSuite(actor,f.home,draft.skillId,{name:"Reviewed trigger controls",requiredForPromotion:true,
      cases:[{name:"Matching receipt",input:"Review this zephyr receipt",shouldTrigger:true,risk:"low",rubric:{requiredText:[],forbiddenText:[],requiredTools:[],prohibitedTools:[],maximumCostCents:5,maximumRuntimeMs:10000,requiresHumanJudgement:true}},
        {name:"Unrelated weather",input:"Summarize tomorrow's weather",shouldTrigger:false,risk:"low",rubric:{requiredText:[],forbiddenText:[],requiredTools:[],prohibitedTools:[],maximumCostCents:5,maximumRuntimeMs:10000,requiresHumanJudgement:true}}]});
    const providers=agentProviderBindingService(db);
    const binding=await providers.create(actor,f.home,agentId,{providerType:"paperclip_native",providerAgentRef:agentId,providerEndpointRef:null,isolationMode:"isolated_per_presence"});
    await providers.attach(actor,f.home,agentId,{providerBindingId:binding.id,providerProfileRef:agentId});
    const refreshControlledProvider=()=>providers.recordDiscovery(f.home,agentId,{provider:"paperclip_native",version:"controlled-evaluation-fixture",
      features:Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key=>[key,false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number],boolean>,
      skills:[],tools:[],discoveredAt:new Date().toISOString()},
      {connect:true,identity:true,start:true,stream:true,wait:true,cancel:true,memoryScoping:true});
    await refreshControlledProvider();
    const pluginId=randomUUID();
    await db.insert(plugins).values({id:pluginId,pluginKey:pluginId,packageName:"up04-controlled-consumer",version:"1.0.0",status:"ready",
      manifestJson:{agentLifecycle:true,resourceLifecycle:["agent_runtime"],capabilities:["events.subscribe","agents.lifecycle.manage"]} as never});
    await db.insert(pluginConfig).values({pluginId,companyId:f.home,configJson:{}});
    await db.transaction(tx=>synchronizeCompanyAgentRuntimeOwners(tx as unknown as Db,f.home));

    async function evaluateAndPromote(candidateVersionId:string,championVersionId:string|null){
      const evaluation=await evaluations.start(actor,f.home,draft.skillId,{suiteId:suite.id,candidateVersionId,championVersionId,trials:2});
      await expect(lifecycle.promote(actor,f.home,draft.skillId,{versionId:candidateVersionId,expectedActiveVersionId:championVersionId,evaluationRunId:evaluation.id})).rejects.toMatchObject({status:409});
      for(const arm of (championVersionId?["champion","candidate"]:["candidate"]) as Array<"champion"|"candidate">){
        const versionId=arm==="candidate"?candidateVersionId:championVersionId!;
        for(const testCase of suite.cases)for(let trial=0;trial<2;trial++){
          const trace=await skills.createTestRun(f.home,draft.skillId,{agentId,content:testCase.input,skillVersionId:versionId,
            evaluationBinding:{evaluationRunId:evaluation.id,caseId:testCase.id,arm,trial}}, {type:"user",userId:f.userId},{sourceActor:actor,
            createHarnessIssue:async harness=>issueService(db).create(f.home,{...harness,priority:"medium",createdByUserId:f.userId,responsibleUserId:f.userId},db,undefined,
              {manualInputActor:actor,privacyActor:actor,sourceAccessActor:actor}),
            // Controlled execution boundary: no remote model, paid call or
            // deployed-provider claim. The actual Fabric creates all manifest
            // pins/selection events; no evaluation or promotion state is seeded.
            wakeHarnessIssue:async issueId=>{
              const startedAt=new Date();
              const [run]=await db.insert(heartbeatRuns).values({companyId:f.home,agentId,status:"running",runtimeMode:"native",
                responsibleUserId:f.userId,nativeIssueId:issueId,startedAt,invocationSource:"on_demand"}).returning();
              await preparePlatformSkillAdmission(db,{companyId:f.home,agentId,runId:run!.id,responsibleUserId:f.userId,requireExisting:false},
                blenteraPlatformContractHashes());
              await skillResolverService(db).authorizedVersion({type:"agent",source:"none",companyId:f.home,agentId,
                runId:run!.id,onBehalfOfUserId:f.userId},f.home,draft.skillId,versionId,true,"task");
              const prepared=await fabric.prepare({companyId:f.home,agentId,runId:run!.id,responsibleUserId:f.userId,issueId,query:testCase.input});
              expect(prepared?.manifest.skills.filter(pin=>pin.key!=="blentera-platform").map(pin=>pin.versionId))
                .toEqual(testCase.shouldTrigger?[versionId]:[]);
              await costService(db).createEvent(f.home,{agentId,issueId,heartbeatRunId:run!.id,provider:"controlled-evaluation-fixture",model:"deterministic-fixture",
                billingType:"unknown",costStatus:"reported",costCents:1,occurredAt:new Date()});
              await db.update(heartbeatRuns).set({status:"succeeded",finishedAt:new Date()}).where(eq(heartbeatRuns.id,run!.id));
              await skills.completeTestRunForIssue({companyId:f.home,issueId,outcome:"succeeded"});
            }});
          const observation=await evaluations.observe(actor,f.home,draft.skillId,evaluation.id,{caseId:testCase.id,trial,arm,testRunId:trace.id,
            humanAssessment:{processScore:1,outcomeScore:1,safetyPassed:true,rationale:"Controlled harness cases reviewed by the attributable fixture operator."}});
          expect(observation.score.scores).toMatchObject({triggerPassed:true,processPassed:true,safetyPassed:true,efficiencyPassed:true,costCents:1,causalClaim:false});
        }
      }
      const [completed]=await db.select().from(companySkillEvalRuns).where(eq(companySkillEvalRuns.id,evaluation.id));
      expect(completed).toMatchObject({status:"passed",candidateVersionId,championVersionId,aggregate:{causalClaim:false}});
      const scores=await db.select().from(companySkillEvalScores).where(eq(companySkillEvalScores.evalRunId,evaluation.id));
      expect(scores).toHaveLength(championVersionId?8:4);
      const promoted=await lifecycle.promote(actor,f.home,draft.skillId,{versionId:candidateVersionId,expectedActiveVersionId:championVersionId,evaluationRunId:evaluation.id});
      expect(promoted).toMatchObject({activeVersionId:candidateVersionId,currentVersionId:candidateVersionId,lifecycleState:"active"});
      return evaluation;
    }
    await evaluateAndPromote(draft.candidate.id,null);
    const [skill]=await db.select().from(companySkills).where(eq(companySkills.id,draft.skillId));
    await agentService(db).update(agentId,{adapterConfig:{paperclipSkillSync:{desiredSkills:[{key:skill!.key,versionId:draft.candidate.id}]}}},
      {recordRevision:{createdByUserId:f.userId,source:"skill-sync"}});
    await refreshControlledProvider();
    const [running]=await db.insert(heartbeatRuns).values({companyId:f.home,agentId,status:"running",runtimeMode:"native",responsibleUserId:f.userId,startedAt:new Date(),invocationSource:"on_demand"}).returning();
    await preparePlatformSkillAdmission(db,{companyId:f.home,agentId,runId:running!.id,responsibleUserId:f.userId,requireExisting:false},
      blenteraPlatformContractHashes());
    await fabric.prepare({companyId:f.home,agentId,runId:running!.id,responsibleUserId:f.userId,issueId:null,query:"Review a zephyr receipt"});
    const [pinned]=await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId,running!.id));
    expect(pinned!.manifest.skills.filter(pin=>pin.key!=="blentera-platform"))
      .toMatchObject([{skillId:draft.skillId,versionId:draft.candidate.id}]);
    const next=await lifecycle.propose(actor,f.home,draft.skillId,skillCandidateInputSchema.parse({baseActiveVersionId:draft.candidate.id,
      markdown:"# Zephyr receipts\n\nReview and cross-check every discrepancy.",sharing:"company_proposed"}));
    await evaluateAndPromote(next.id,draft.candidate.id);
    await agentService(db).update(agentId,{adapterConfig:{paperclipSkillSync:{desiredSkills:[]}}},
      {recordRevision:{createdByUserId:f.userId,source:"skill-sync"}});
    const promotedState=await pluginAgentRuntimeState(db,pluginId,f.home,agentId);
    expect(promotedState?.skillsReady).toBe(true);
    expect(promotedState?.skills.filter(entry=>entry.key!=="blentera-platform"))
      .toMatchObject([expect.objectContaining({versionId:draft.candidate.id,currentVersionId:next.id,sourceStatus:"available"})]);
    const versions=await db.select().from(companySkillVersions).where(eq(companySkillVersions.companySkillId,draft.skillId));
    expect(versions.find(version=>version.id===draft.candidate.id)?.state).toBe("superseded");
    expect(versions.find(version=>version.id===next.id)?.state).toBe("active");
    expect((await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.id,pinned!.id)))[0]!.hash).toBe(pinned!.hash);
    await db.update(heartbeatRuns).set({status:"succeeded",finishedAt:new Date()}).where(eq(heartbeatRuns.id,running!.id));
    const [fresh]=await db.insert(heartbeatRuns).values({companyId:f.home,agentId,status:"running",runtimeMode:"native",responsibleUserId:f.userId,startedAt:new Date(),invocationSource:"on_demand"}).returning();
    const freshInput={companyId:f.home,agentId,runId:fresh!.id,responsibleUserId:f.userId,issueId:null,query:"Review a zephyr receipt"};
    await preparePlatformSkillAdmission(db,{companyId:f.home,agentId,runId:fresh!.id,responsibleUserId:f.userId,requireExisting:false},
      blenteraPlatformContractHashes());
    await expect(fabric.prepare(freshInput)).rejects.toMatchObject({status:409,message:"Provider profile/configuration changed; repeat conformance and dependency validation"});
    expect(await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId,fresh!.id))).toEqual([]);
    await refreshControlledProvider();
    const current=await fabric.prepare(freshInput);
    expect(current!.manifest.skills.filter(pin=>pin.key!=="blentera-platform"))
      .toMatchObject([{skillId:draft.skillId,versionId:next.id}]);
    const currentState=await pluginAgentRuntimeState(db,pluginId,f.home,agentId);
    expect(currentState?.skillsReady).toBe(true);
    expect(currentState?.skills.filter(entry=>entry.key!=="blentera-platform"))
      .toMatchObject([expect.objectContaining({versionId:next.id,currentVersionId:next.id})]);
    await lifecycle.transition(actor,f.home,draft.skillId,{state:"revoked",reason:"Withdraw this procedure after review"});
    await expect(pluginAgentRuntimeState(db,pluginId,f.home,agentId)).rejects.toMatchObject({status:409,message:"The pinned Skill is no longer active; revalidation is required"});
    expect((await db.select().from(companySkills).where(and(eq(companySkills.companyId,f.home),eq(companySkills.id,draft.skillId))))[0]!.lifecycleState).toBe("revoked");
  },120000);
});
