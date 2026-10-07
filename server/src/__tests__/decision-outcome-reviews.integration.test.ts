import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {and,eq,sql} from "drizzle-orm";
import {agents,authUsers,companies,companyMemberships,createDb,decisions,heartbeatRuns,issues,projects,issueComments,
  decisionContexts,decisionContextVersions,decisionContextBindings,decisionContextPreparations,decisionCriteria,decisionAssumptions,decisionExpectedOutcomes,
  decisionEvidenceLinks,analyticalLineageManifests,analyticalLineageEdges,decisionOutcomeReviews,decisionOutcomeReviewReceipts} from "@paperclipai/db";
import {decisionContextDefinitionSchema,type DecisionContextDefinition,type FinishDecisionOutcomeReview} from "@paperclipai/shared";
import {decisionOutcomeReviewService} from "../services/decision-outcome-reviews.js";
import {decisionIntelligenceService} from "../services/decision-intelligence.js";
import {decisionService} from "../services/decisions.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {aiGovernanceService} from "../services/ai-governance/governance-service.js";
import {instanceSettingsService} from "../services/instance-settings.js";
import {lockMemoryPrivacy} from "../services/memory/memory-privacy.js";
import {lockAnalyticalCompany} from "../services/analytical-privacy.js";
import {eraseAnalyticalSourcesUnderMemory} from "../services/analytical-source-erasure.js";
import {eraseExpiredAnalyticalLineage} from "../services/analytical-retention.js";
import {purgeCompanyContent} from "../services/saas/company-purge.js";
import {analyticalPurpose,metricDefinition} from "./helpers/business-metric-fixture.js";
import {getEmbeddedPostgresTestSupport,startEmbeddedPostgresTestDatabase} from "./helpers/embedded-postgres.js";
const support=await getEmbeddedPostgresTestSupport(),suite=support.supported?describe:describe.skip;
const actor={type:"board" as const,source:"local_implicit" as const};
const flags={analytical_lineage_v8:true,business_metrics_v8:true,decision_intelligence_v8:true,enableDecisions:true,ai_use_cases_v7:true,governance_evidence_v7:true};
suite("Native decision outcome reviews on migrated PostgreSQL",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
  let companyId:string,foreignId:string,originId:string,targetId:string,projectId:string,agentId:string,runId:string,policyId:string;
  beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-outcome-review-");db=createDb(database.connectionString);
    process.env.PAPERCLIP_DECISION_SIGNING_SECRET="0123456789abcdef0123456789abcdef";
    await db.insert(authUsers).values({id:"local-board",name:"Local native board",email:"local-board-context@example.test",createdAt:new Date(),updatedAt:new Date()});});
  afterAll(async()=>database?.cleanup());
  beforeEach(async()=>{
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental(flags);
    companyId=randomUUID();foreignId=randomUUID();originId=randomUUID();targetId=randomUUID();projectId=randomUUID();agentId=randomUUID();runId=randomUUID();
    await db.insert(companies).values([{id:companyId,name:"Native decision context",issuePrefix:randomUUID()},{id:foreignId,name:"Other context tenant",issuePrefix:randomUUID()}]);
    await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:"local-board",membershipRole:"member",status:"active"});
    await db.insert(projects).values({id:projectId,companyId,name:"Controlled native project"});
    await db.insert(agents).values({id:agentId,companyId,name:"Proposer",role:"engineer",status:"active",adapterType:"codex_local"});
    await db.insert(issues).values([{id:originId,companyId,projectId,title:"Private origin title",status:"done",responsibleUserId:"local-board",createdAt:new Date("2026-01-01T12:00:00Z")},
      {id:targetId,companyId,projectId,title:"Private target title",status:"todo",responsibleUserId:"local-board",createdAt:new Date("2026-01-01T12:00:00Z")}]);
    await db.insert(heartbeatRuns).values({id:runId,companyId,agentId,status:"running",responsibleUserId:"local-board",contextSnapshot:{issueId:originId}});
    const policy=analyticalPurpose();policy.analyticalPurpose!.capabilities=["metrics","decision"];
    policyId=(await aiGovernanceService(db).obligation(actor,companyId,policy)).id;
  });
  const native=()=>decisionService(db,{wakeOriginAgent:async()=>{}}),service=()=>decisionIntelligenceService(db);
  const create=()=>native().create({companyId,actor,agentId,runId,title:"Proceed with the option?",body:"Native choice remains authoritative",options:[
    {id:"proceed",label:"Proceed",effects:[{type:"comment_on_issue",targetIssueId:targetId,staleness:"lenient",bodyMarkdown:"Native chosen effect"}]},
    {id:"defer",label:"Defer",effects:[]}]});
  const definition=():DecisionContextDefinition=>decisionContextDefinitionSchema.parse({question:"Should we proceed with this option?",objective:"Deliver useful business outcomes",ownerUserId:"local-board",scope:{type:"project",id:projectId},
    timeHorizon:{from:"2026-10-07T00:00:00Z",until:"2027-01-01T00:00:00Z"},uncertaintySummary:"External conditions and delivery capacity may change",revisitAt:null,
    purpose:"management_intelligence",sensitivity:"internal",governanceObligationRefs:[policyId],retentionDays:30,evidence:[],
    assumptions:[{key:"capacity",statement:"Current capacity remains available during delivery",type:"delivery",confidence:{kind:"human_judgment",level:"medium"},materiality:"high",status:"unverified"}],
    criteria:[{key:"delivery",name:"Delivery capacity",description:"Human qualitative delivery assessment",type:"qualitative",priority:"high",evidenceKey:null}],
    expectedOutcomes:[{kind:"qualitative",optionId:"proceed",statement:"Observe useful delivery within the horizon",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"A judgment without a calibrated prediction interval"}]});
  async function prepare(id:string,input=definition()) {
    const proposed=await service().propose(companyId,actor,id,{expectedRevision:0,definition:input});
    return service().prepare(companyId,actor,id,{expectedRevision:proposed.revision,versionId:proposed.versions[0].id,rationale:"Explicit human review of this exact native context"});
  }
  const choose=(id:string,optionId="proceed")=>native().decide({id,optionId,decidedByUserId:"local-board",userActor:actor});
  const reviews=()=>decisionOutcomeReviewService(db);
  async function observation() {
    const metrics=businessMetricService(db),created=await metrics.create(companyId,actor,{key:"baseline",definition:metricDefinition(policyId)});
    await metrics.publish(companyId,actor,created.metric.id,{expectedRevision:1,versionId:created.version.id});
    return metrics.query(companyId,actor,{metricId:created.metric.id,versionId:created.version.id,from:"2026-01-01T00:00:00Z",until:"2026-01-02T00:00:00Z",dimensions:[],maxRows:100});
  }
  async function scheduled(input=definition()) {
    const d=await create(),context=await prepare(d.id,input);await choose(d.id);
    const review=await reviews().schedule(companyId,actor,d.id,{contextVersionId:context.versions[0].id,rationale:"Explicit human review of the declared outcome horizon"});
    return {d,context,review};
  }
  const final=(expectedRevision=2):FinishDecisionOutcomeReview=>{
    const judgment={kind:"human_judgment" as const,assessment:"unknown" as const,explanation:"Human assessment with explicitly incomplete evidence",evidenceKeys:[]};
    return {expectedRevision,result:"inconclusive",lessonSummary:"The observed outcome does not determine decision quality",
      assessments:{decisionProcessQuality:{...judgment,assessment:"supported",explanation:"The human considered evidence and uncertainty before choosing"},assumptionAccuracy:judgment,executionFidelity:{...judgment,evidenceKeys:["native_execution"]},externalChange:judgment,observedOutcome:judgment,causalConfidence:{assessment:"not_assessed",explanation:"No identified and qualified native causal estimate exists"}},
      actualMetrics:[],metricOutcomes:[],qualitativeOutcomes:[{expectationIndex:0,kind:"human_judgment",assessment:"inconclusive",explanation:"The prospective delivery horizon remains incomplete",evidenceKeys:[]}],
      assumptionOutcomes:[{key:"capacity",kind:"human_judgment",assessment:"inconclusive",explanation:"Delivery capacity has not been independently validated",evidenceKeys:[]}]};
  };
  const begin=(id:string)=>reviews().transition(companyId,actor,id,{expectedRevision:1,action:"begin",rationale:"A human begins the separate outcome assessment"});
  it("requires an actual surviving prospective binding and schedules only the chosen declared horizon",async()=>{
    const bare=await create();await choose(bare.id);
    await expect(reviews().schedule(companyId,actor,bare.id,{contextVersionId:randomUUID(),rationale:"Attempt to invent a retrospective decision baseline"})).rejects.toMatchObject({status:404});
    const {d,context,review}=await scheduled();
    expect(review).toMatchObject({revision:1,status:"scheduled",reviewDueAt:new Date(context.versions[0].definition.expectedOutcomes[0].reviewAt).toISOString(),causalClaimRef:null,learningCycleId:null,receipts:[{action:"schedule",assessment:null}]});
    await expect(reviews().schedule(companyId,actor,d.id,{contextVersionId:context.versions[0].id,rationale:"Another duplicate human outcome review attempt"})).rejects.toMatchObject({status:409});
    await expect(reviews().detail(foreignId,actor,d.id)).rejects.toMatchObject({status:404});
    expect((await native().get(d.id))!.status).toBe("decided");
  });
  it("records six independent judgments without treating a bad outcome as a bad choice or causing canonical changes",async()=>{
    const {d,context}=await scheduled();await begin(d.id);
    const before=await native().get(d.id),result=await reviews().finish(companyId,actor,d.id,final());
    expect(result).toMatchObject({revision:3,status:"inconclusive",reviewedByUserId:"local-board"});
    expect(result.receipts[0]).toMatchObject({action:"finish",assessment:{assessments:{decisionProcessQuality:{assessment:"supported"},observedOutcome:{assessment:"unknown"},causalConfidence:{assessment:"not_assessed"}}},nativeExecution:{status:"succeeded"}});
    expect((await service().detail(companyId,actor,d.id)).versions[0].contentHash).toBe(context.versions[0].contentHash);
    expect((await native().get(d.id))!.chosenOptionId).toBe(before!.chosenOptionId);
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId,targetId))).toHaveLength(1);
    await expect(reviews().finish(companyId,actor,d.id,final(3))).rejects.toMatchObject({status:409});
  });
  it("uses CAS and immutable human receipts; direct status updates without a receipt roll back",async()=>{
    const {d,review}=await scheduled();
    const started=await Promise.allSettled([begin(d.id),begin(d.id)]);expect(started.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    await expect(db.update(decisionOutcomeReviews).set({status:"cancelled",revision:3,updatedAt:new Date()}).where(eq(decisionOutcomeReviews.id,review.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db.update(decisionOutcomeReviewReceipts).set({revision:99}).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db.delete(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).rejects.toMatchObject({cause:{code:"23514"}});
    expect((await reviews().detail(companyId,actor,d.id))!.status).toBe("in_review");
    const cancelled=await reviews().transition(companyId,actor,d.id,{expectedRevision:2,action:"cancel",rationale:"The human explicitly cancels this outcome review"});expect(cancelled.status).toBe("cancelled");
  });
  it("requires all frozen assumptions and chosen-option expectations; early outcomes cannot be completed",async()=>{
    const {d}=await scheduled();await begin(d.id);
    await expect(reviews().finish(companyId,actor,d.id,{...final(),assumptionOutcomes:[]})).rejects.toMatchObject({status:409});
    await expect(reviews().finish(companyId,actor,d.id,{...final(),qualitativeOutcomes:[{...final().qualitativeOutcomes[0],expectationIndex:1}]})).rejects.toMatchObject({status:409});
    await expect(reviews().finish(companyId,actor,d.id,{...final(),result:"completed",qualitativeOutcomes:[{...final().qualitativeOutcomes[0],assessment:"met"}]})).rejects.toMatchObject({status:409});
    await expect(reviews().finish(companyId,actor,d.id,{...final(),assessments:{...final().assessments,observedOutcome:{...final().assessments.observedOutcome,evidenceKeys:["actual:invented"]}}})).rejects.toMatchObject({status:409});
    expect((await reviews().detail(companyId,actor,d.id))!.revision).toBe(2);
  });
  it("computes native expected-versus-actual comparisons while preserving the frozen baseline and human process judgment",async()=>{
    const baseline=await observation(),input=definition();
    input.timeHorizon={from:"2026-01-01T00:00:00Z",until:new Date(Date.now()+3000).toISOString()};
    input.evidence=[{key:"baseline",source:{type:"metric_observation",id:baseline.id,metricId:baseline.metricId,metricVersionId:baseline.versionId},relationship:"metric_observation",optionId:null,criterionKey:null,rationale:"Prospective baseline from the exact native measurement owner"}];
    input.expectedOutcomes=[{kind:"metric",optionId:"proceed",evidenceKey:"baseline",expectedRange:{lower:0.6,upper:0.8},expectedDirection:"increase",reviewAt:input.timeHorizon.until,uncertaintySummary:"The expected range is human judgment without causal attribution"}];
    const {d,context,review}=await scheduled(input);
    await db.update(issues).set({status:"done",updatedAt:new Date()}).where(eq(issues.id,targetId));
    // A real short horizon establishes genuine post-choice chronology, without
    // editing an immutable binding or synthesizing an observation timestamp.
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(input.timeHorizon.until)-Date.now()+30)));
    expect((await reviews().detail(companyId,actor,d.id))!.status).toBe("due");
    expect((await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id)))[0]).toMatchObject({status:"scheduled",revision:1});
    await begin(d.id);
    const actual=await businessMetricService(db).query(companyId,actor,{metricId:baseline.metricId,versionId:baseline.versionId,from:input.timeHorizon.from,until:input.timeHorizon.until,dimensions:[],maxRows:100});
    const completed=await reviews().finish(companyId,actor,d.id,{...final(),result:"completed",actualMetrics:[{key:"actual",source:{type:"metric_observation",id:actual.id,metricId:actual.metricId,metricVersionId:actual.versionId}}],metricOutcomes:[{expectationIndex:0,actualEvidenceKey:"actual"}],qualitativeOutcomes:[]});
    expect(completed.receipts[0].comparisons).toMatchObject([{baselineValue:0.5,actualValue:1,expectedRange:{lower:0.6,upper:0.8},rangePosition:"above",observedDirection:"increase"}]);
    expect(completed.receipts[0].assessment!.assessments.decisionProcessQuality.assessment).toBe("supported");
    expect(completed.causalClaimRef).toBeNull();expect(completed.receipts[0].comparisons[0].limitations.join(" ")).toContain("does not identify");
    expect((await service().detail(companyId,actor,d.id)).versions[0].contentHash).toBe(context.versions[0].contentHash);
    expect((await service().detail(companyId,actor,d.id)).versions[0].evidence[0].facts.value).toBe(0.5);
  });
  it("denies old observations as later outcomes and rechecks hidden sources on reads and writes",async()=>{
    const baseline=await observation(),{d}=await scheduled();await begin(d.id);
    await expect(reviews().finish(companyId,actor,d.id,{...final(),actualMetrics:[{key:"old",source:{type:"metric_observation",id:baseline.id,metricId:baseline.metricId,metricVersionId:baseline.versionId}}]})).rejects.toMatchObject({status:409});
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,targetId));
    await expect(reviews().detail(companyId,actor,d.id)).rejects.toMatchObject({status:404});
    await expect(reviews().finish(companyId,actor,d.id,final())).rejects.toMatchObject({status:404});
    expect((await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.decisionId,d.id)))[0].revision).toBe(2);
  });
  it("erases review prose and descendants with native sources even after rollout rollback",async()=>{
    const {d,review}=await scheduled();await begin(d.id);await reviews().finish(companyId,actor,d.id,final());
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[targetId]);});
    expect(await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id))).toHaveLength(0);
    expect(await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).toHaveLength(0);
    expect(await db.select().from(decisions).where(eq(decisions.id,d.id))).toHaveLength(1);
  });
  it("runs retention while paused and flags off and preserves another company on purge",async()=>{
    const {d,review}=await scheduled();await begin(d.id);await reviews().finish(companyId,actor,d.id,final());
    const otherCompany=companyId;companyId=foreignId;
    await db.insert(companyMemberships).values({companyId,principalType:"user",principalId:"local-board",membershipRole:"member",status:"active"});
    await db.insert(projects).values({id:randomUUID(),companyId,name:"Unrelated surviving project"});
    companyId=otherCompany;await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});
    await eraseExpiredAnalyticalLineage(db,new Date(Date.now()+31*86400000));
    expect(await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id))).toHaveLength(0);
    await purgeCompanyContent(db,companyId,{restoreQuarantine:true});
    expect(await db.select().from(decisions).where(eq(decisions.id,d.id))).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.companyId,foreignId))).toHaveLength(1);
  });
  it("erases an entire reviewed aggregate when a later-only measurement source is forgotten, without erasing the prospective choice",async()=>{
    const baseline=await observation(),{d,context,review}=await scheduled();await begin(d.id);
    const laterId=randomUUID();await db.insert(issues).values({id:laterId,companyId,title:"Later source with private details",status:"done",responsibleUserId:"local-board"});
    const actual=await businessMetricService(db).query(companyId,actor,{metricId:baseline.metricId,versionId:baseline.versionId,from:"2026-01-01T00:00:00Z",until:new Date(Date.now()+1000).toISOString(),dimensions:[],maxRows:100});
    const input=final();input.actualMetrics=[{key:"later",source:{type:"metric_observation",id:actual.id,metricId:actual.metricId,metricVersionId:actual.versionId}}];input.assessments.observedOutcome.evidenceKeys=["actual:later"];
    await reviews().finish(companyId,actor,d.id,input);await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[laterId]);});
    expect(await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id))).toHaveLength(0);
    expect(await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).toHaveLength(0);
    expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.id,context.versions[0].id))).toHaveLength(1);
    expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.decisionId,d.id))).toHaveLength(1);
  });
  it("purges a live frozen review with flags off while preserving another company's content",async()=>{
    const {d,review}=await scheduled();await begin(d.id);await reviews().finish(companyId,actor,d.id,final());
    await db.insert(projects).values({companyId:foreignId,name:"Other company remains intact"});await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({});
    await purgeCompanyContent(db,companyId,{restoreQuarantine:true});
    expect(await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id))).toHaveLength(0);
    expect(await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.companyId,foreignId))).toHaveLength(1);
  });
});
