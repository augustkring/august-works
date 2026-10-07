import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {expect,test} from "@playwright/test";
import {eq} from "../../server/node_modules/drizzle-orm/index.js";
import {createDb,authUsers,companyMemberships,issues,heartbeatRuns,memoryBindings,memoryRecords,memoryEvidence,learningCycles,learningHypotheses,learningDomainCandidates,decisionOutcomeReviews} from "../../packages/db/src/index.ts";
import {decisionService} from "../../server/src/services/decisions.ts";
import {analyticalPurpose} from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import {json} from "./agent-chat.shared";

test.setTimeout(120000);
// Actual native API/database/browser flow. The canonical worker and verified
// Task evidence are explicit historical fixtures; no provider/trial is claimed.
test("a current human carries a reviewed Decision into one governed Learning cycle",async({page,request},testInfo)=>{
 const original=await json(await request.get("/api/instance/settings/experimental"));
 await json(await request.patch("/api/instance/settings/experimental",{data:{enableDecisions:true,enableFoundationV1:true,enableCollectiveMemoryV1:true,enableContextEngineV1:true,agent_identities_v5:true,agent_provider_bindings_v5:true,agent_runtime_fabric_v5:true,role_packs_v5:true,cognitive_memory_v7:true,memory_observations_v7:true,skill_lifecycle_v5:true,playbooks_v5:true,learning_engine_v7:true,ai_use_cases_v7:true,governance_evidence_v7:true,analytical_lineage_v8:true,business_metrics_v8:true,decision_intelligence_v8:true}}));
 const config=JSON.parse(await readFile(process.env.PAPERCLIP_E2E_SERVER_CONFIG!,"utf8")),pid=await readFile(path.join(config.database.embeddedPostgresDataDir,"postmaster.pid"),"utf8");
 const db=createDb(`postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`);
 try{
  const company=await json(await request.post("/api/companies",{data:{name:"Native Decision Learning browser fixture"}}));
  const other=await json(await request.post("/api/companies",{data:{name:"Independent Learning company"}}));
  const agent=await json(await request.post(`/api/companies/${company.id}/agents`,{data:{name:"Historical decision worker",adapterType:"process",adapterConfig:{command:"/usr/bin/true"},runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:false}}}}));
  await db.insert(authUsers).values({id:"local-board",name:"Native local operator",email:"decision-learning@example.test",createdAt:new Date(),updatedAt:new Date()}).onConflictDoNothing();
  await db.insert(companyMemberships).values({companyId:company.id,principalType:"user",principalId:"local-board",membershipRole:"member",status:"active"}).onConflictDoNothing();
  const [origin]=await db.insert(issues).values({companyId:company.id,title:"Historical canonical origin",status:"done",completedAt:new Date(),responsibleUserId:"local-board"}).returning();
  const [run]=await db.insert(heartbeatRuns).values({companyId:company.id,agentId:agent.id,status:"running",responsibleUserId:"local-board",contextSnapshot:{issueId:origin!.id}}).returning();
  const [binding]=await db.insert(memoryBindings).values({companyId:company.id,key:randomUUID(),name:"Historical verified outcome",providerKey:"local"}).returning();
  const [record]=await db.insert(memoryRecords).values({companyId:company.id,bindingId:binding!.id,providerKey:"local",memoryType:"outcome",scopeType:"company",title:"Independent verified Task outcome",content:"Synthetic independently verified historical Task evidence",reviewState:"accepted",verificationState:"human_verified",observedAt:new Date(),createdByActorType:"system",createdByActorId:"fixture"}).returning();
  await db.insert(memoryEvidence).values({companyId:company.id,memoryRecordId:record!.id,sourceClass:"task",sourceProvider:"august_works_tasks",sourceType:"issue",sourceRef:`issue://${origin!.id}`,sourceVersion:"1",observedAt:new Date(),excerptHash:"a".repeat(64),citationJson:{label:"Historical canonical outcome"},trustLevel:"high",supportsOrContradicts:"supports"});
  const native=decisionService(db,{wakeOriginAgent:async()=>{}}),actor={type:"board" as const,source:"local_implicit" as const};
  const decision=await native.create({companyId:company.id,actor,agentId:agent.id,runId:run!.id,title:"Investigate delivery uncertainty?",body:"Historical software fixture; native human choice remains authoritative",options:[{id:"investigate",label:"Investigate",effects:[]},{id:"wait",label:"Wait",effects:[]}]});
  const policy=analyticalPurpose();policy.analyticalPurpose!.capabilities=["decision"];
  const obligation=await json(await request.post(`/api/companies/${company.id}/governance-obligations`,{data:policy}));
  const base=`/api/companies/${company.id}/decisions/${decision.id}/context`;
  const definition={question:"Should we investigate the delivery uncertainty?",objective:"Test useful delivery assumptions without automatic changes",ownerUserId:"local-board",scope:{type:"company",id:null},timeHorizon:{from:"2026-10-07T00:00:00Z",until:"2027-01-01T00:00:00Z"},uncertaintySummary:"A historical fixture provides no external outcome or causal claim",revisitAt:null,purpose:"management_intelligence",sensitivity:"internal",governanceObligationRefs:[obligation.id],retentionDays:30,evidence:[],assumptions:[{key:"capacity",statement:"Current delivery capacity remains available",type:"delivery",confidence:{kind:"human_judgment",level:"medium"},materiality:"high",status:"unverified"}],criteria:[{key:"delivery",name:"Delivery",description:"Human qualitative delivery judgment",type:"qualitative",priority:"high",evidenceKey:null}],expectedOutcomes:[{kind:"qualitative",optionId:"investigate",statement:"Observe useful delivery within the horizon",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"A human expectation without a calibrated prediction interval"}]};
  const proposed=await json(await request.post(`${base}/versions`,{data:{expectedRevision:0,definition}}));
  await json(await request.post(`${base}/prepare`,{data:{expectedRevision:proposed.revision,versionId:proposed.versions[0].id,rationale:"Human explicitly reviews this exact historical prospective context"}}));
  await native.decide({id:decision.id,optionId:"investigate",decidedByUserId:"local-board",userActor:actor});
  await json(await request.post(`${base}/outcome-review`,{data:{contextVersionId:proposed.versions[0].id,rationale:"Human schedules a separate review of the frozen expectations"}}));
  await json(await request.post(`${base}/outcome-review/transition`,{data:{expectedRevision:1,action:"begin",rationale:"Human begins an explicit independent outcome assessment"}}));
  const judgment={kind:"human_judgment",assessment:"unknown",explanation:"The historical fixture retains incomplete evidence",evidenceKeys:[]};
  const reviewed=await json(await request.post(`${base}/outcome-review/finish`,{data:{expectedRevision:2,result:"inconclusive",lessonSummary:"Reviewed delivery lesson from a native historical fixture",assessments:{decisionProcessQuality:judgment,assumptionAccuracy:judgment,executionFidelity:judgment,externalChange:judgment,observedOutcome:judgment,causalConfidence:{assessment:"not_assessed",explanation:"No qualified native causal estimate is claimed"}},actualMetrics:[],metricOutcomes:[],qualitativeOutcomes:[{expectationIndex:0,kind:"human_judgment",assessment:"inconclusive",explanation:"The declared future delivery horizon is incomplete",evidenceKeys:[]}],assumptionOutcomes:[{key:"capacity",kind:"human_judgment",assessment:"inconclusive",explanation:"Capacity has not been independently assessed",evidenceKeys:[]}]}}));
  const seed=new URLSearchParams({reviewDecisionId:decision.id,reviewRevision:String(reviewed.revision),reviewCompanyId:company.id});
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/${company.issuePrefix}/memory/learning?${seed}`);
  await expect(page.getByText("Reviewed delivery lesson from a native historical fixture",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Start bounded cycle",exact:true})).toBeDisabled();
  await page.screenshot({path:testInfo.outputPath("decision-learning-review-mobile.png"),fullPage:true});
  await page.goto(`/${other.issuePrefix}/memory/learning?${seed}`);
  await expect(page.getByText("Open this review in its original company before starting Learning.",{exact:true})).toBeVisible();
  await expect(page.getByText("Reviewed delivery lesson from a native historical fixture",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Start bounded cycle",exact:true})).toBeDisabled();
  await page.goto(`/${company.issuePrefix}/memory/learning?${seed}`);
  await expect(page.getByText("Reviewed delivery lesson from a native historical fixture",{exact:true})).toBeVisible();
  await page.getByLabel("Independent verified Task outcome",{exact:false}).check();
  await page.getByLabel("Observed problem",{exact:true}).fill("Investigate the reviewed lesson against independently verified outcomes");
  const resultPromise=page.waitForResponse(response=>response.url().includes(`${base}/outcome-review/learning`)&&response.request().method()==="POST");
  await page.getByRole("button",{name:"Start bounded cycle",exact:true}).click();
  const result=await json(await resultPromise);
  await expect(page.getByText("Hypothesis budget: 0/5 · Evaluation budget: 0/10",{exact:true})).toBeVisible();
  expect((await db.select().from(learningCycles).where(eq(learningCycles.companyId,company.id)))).toHaveLength(1);
  expect(await db.select().from(learningHypotheses).where(eq(learningHypotheses.companyId,company.id))).toHaveLength(0);
  expect(await db.select().from(learningDomainCandidates).where(eq(learningDomainCandidates.companyId,company.id))).toHaveLength(0);
  expect(result.review.learningCycleId).toBe(result.cycleId);
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:testInfo.outputPath("decision-learning-native-cycle-desktop.png"),fullPage:true});
  await db.delete(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,reviewed.id));
  await page.reload();
  await expect(page.getByText("Learning cycle not found",{exact:true})).toBeVisible();
  await expect(page.getByText("Hypothesis budget: 0/5 · Evaluation budget: 0/10",{exact:true})).toHaveCount(0);
  expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,record!.id)))[0]!.deletedAt).toBeNull();
 }finally{
  await json(await request.patch("/api/instance/settings/experimental",{data:original}));
  await db.$client.end({timeout:2});
 }
});
