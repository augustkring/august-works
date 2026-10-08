import { nativeManagementSdkFixture } from "./helpers/native-management-sdk-fixture.js";
import {disableV8Rollout} from "./helpers/v8-rollout.js";
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {and,eq,sql} from "drizzle-orm";
import {agents,authUsers,companies,companyMemberships,createDb,decisions,heartbeatRuns,issues,projects,issueComments,
  decisionContexts,decisionContextVersions,decisionContextBindings,decisionContextPreparations,decisionCriteria,decisionAssumptions,decisionExpectedOutcomes,
  decisionEvidenceLinks,analyticalLineageManifests,analyticalLineageEdges,decisionOutcomeReviews,decisionOutcomeReviewReceipts,managementReviewSnapshots,memoryBindings,memoryRecords,memoryEvidence,learningCycles,learningAnalyticalDependencies,learningEvidence,learningHypotheses,learningDomainCandidates,activityLog} from "@paperclipai/db";
import {decisionContextDefinitionSchema,type DecisionContextDefinition,type FinishDecisionOutcomeReview} from "@paperclipai/shared";
import {learningService} from "../services/learning/learning-service.js";
import {memoryJobService} from "../services/memory/memory-jobs.js";
import {decisionOutcomeReviewService} from "../services/decision-outcome-reviews.js";
import {decisionIntelligenceService} from "../services/decision-intelligence.js";
import {decisionService} from "../services/decisions.js";
import {managementReviewService} from "../services/management-reviews/service.js";
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
  async function verifiedLearningRoot(tenant=companyId) {
    await instanceSettingsService(db).updateExperimental({enableFoundationV1:true,enableCollectiveMemoryV1:true,enableContextEngineV1:true,agent_identities_v5:true,agent_provider_bindings_v5:true,agent_runtime_fabric_v5:true,role_packs_v5:true,cognitive_memory_v7:true,memory_observations_v7:true,skill_lifecycle_v5:true,playbooks_v5:true,learning_engine_v7:true});
    const [task]=await db.insert(issues).values({companyId:tenant,title:"Independent verified outcome",status:"done",completedAt:new Date()}).returning();
    const [binding]=await db.insert(memoryBindings).values({companyId:tenant,key:randomUUID(),name:"Independent verified outcomes",providerKey:"local"}).returning();
    const [record]=await db.insert(memoryRecords).values({companyId:tenant,bindingId:binding!.id,providerKey:"local",memoryType:"outcome",scopeType:"company",content:"An independently reviewed completed Task outcome",reviewState:"accepted",verificationState:"human_verified",observedAt:new Date(),createdByActorType:"system",createdByActorId:"fixture"}).returning();
    await db.insert(memoryEvidence).values({companyId:tenant,memoryRecordId:record!.id,sourceClass:"task",sourceProvider:"august_works_tasks",sourceType:"issue",sourceRef:`issue://${task!.id}`,sourceVersion:"1",observedAt:new Date(),excerptHash:"a".repeat(64),citationJson:{label:"Actual reviewed outcome"},trustLevel:"high",supportsOrContradicts:"supports"});
    return record!;
  }
  const startInput=(memoryRecordIds:string[],expectedRevision=3)=>({expectedRevision,purpose:"native_task_execution",trigger:"A human tests a reviewed lesson against independent verified outcomes",memoryRecordIds});
  it("reads an exact independently finished outcome review through the actual SDK without recording new judgments",async()=>{
    const {d,review}=await scheduled();await begin(d.id);const completed=await reviews().finish(companyId,actor,d.id,final());
    const sdk=await nativeManagementSdkFixture(db,companyId),before=await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id));
    const output=await sdk.read("review_decision_outcome",{decisionId:d.id,revision:completed.revision});
    expect(output).toMatchObject({tool:"review_decision_outcome",citations:[{kind:"outcome_review",decisionId:d.id,revision:3}],result:{grade:"native_outcome_review",review:{id:review.id,revision:3,status:"inconclusive"}},executionAuthority:"read_only_or_advisory"});
    expect(JSON.stringify(output)).toContain("not_assessed");expect(await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).toEqual(before);
    await expect(sdk.read("review_decision_outcome",{decisionId:d.id,revision:2})).rejects.toMatchObject({status:409});
    await sdk.retainCopy(output);expect(await sdk.retained()).toBe(true);
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,targetId));await expect(sdk.read("review_decision_outcome",{decisionId:d.id,revision:3})).rejects.toMatchObject({status:404});
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,targetId));const canonical=await db.select().from(decisions).where(eq(decisions.id,d.id)),comments=await db.select().from(issueComments).where(eq(issueComments.issueId,targetId));
    await disableV8Rollout(db);await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[targetId]);});
    expect(await sdk.retained()).toBe(false);expect(await db.select().from(decisions).where(eq(decisions.id,d.id))).toEqual(canonical);expect(await db.select().from(issueComments).where(eq(issueComments.issueId,targetId))).toEqual(comments);
  });
  it("atomically links one native Learning cycle under concurrent human review conversion without promoting authority",async()=>{
    const {d,review}=await scheduled();await begin(d.id);await reviews().finish(companyId,actor,d.id,final());
    const root=await verifiedLearningRoot(),input=startInput([root.id]);
    const before=await native().get(d.id),results=await Promise.all(Array.from({length:6},()=>reviews().startLearning(companyId,actor,d.id,input)));
    expect(new Set(results.map(result=>result.cycleId)).size).toBe(1);
    expect(results[0]!.review).toMatchObject({id:review.id,revision:3,status:"inconclusive",learningCycleId:results[0]!.cycleId});
    const cycles=await db.select().from(learningCycles).where(eq(learningCycles.companyId,companyId));expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({scopeType:"company",scopeId:null,status:"hypothesizing",createdBy:"local-board",analyticalSourcePins:[{kind:"outcome_review",decisionId:d.id,revision:3}]});
    const receipts=await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id));
    expect((await db.select().from(learningAnalyticalDependencies).where(eq(learningAnalyticalDependencies.cycleId,cycles[0]!.id))).map(edge=>edge.sourceManifestId).sort()).toEqual(receipts.map(receipt=>receipt.lineageManifestId).sort());
    expect(await db.select().from(learningEvidence).where(eq(learningEvidence.cycleId,cycles[0]!.id))).toHaveLength(1);
    expect(await db.select().from(learningHypotheses).where(eq(learningHypotheses.companyId,companyId))).toHaveLength(0);
    expect(await db.select().from(learningDomainCandidates).where(eq(learningDomainCandidates.companyId,companyId))).toHaveLength(0);
    for(const action of ["learning.cycle_created","decision.outcome_review_learning_started"])expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId,companyId),eq(activityLog.action,action)))).toHaveLength(1);
    expect((await native().get(d.id))!.chosenOptionId).toBe(before!.chosenOptionId);
    await expect(reviews().startLearning(companyId,actor,d.id,{...input,trigger:"A different human request cannot silently reuse the previous conversion"})).rejects.toMatchObject({status:409});
    await expect(db.update(decisionOutcomeReviews).set({learningCycleId:null}).where(eq(decisionOutcomeReviews.id,review.id))).rejects.toBeDefined();
    await expect(db.update(decisionOutcomeReviews).set({reviewedByUserId:"other"}).where(eq(decisionOutcomeReviews.id,review.id))).rejects.toBeDefined();
    expect((await learningService(db).get(actor,companyId,cycles[0]!.id)).analyticalSourcePins).toHaveLength(1);
    await instanceSettingsService(db).updateExperimental({learning_engine_v7:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await db.delete(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id));
    expect((await db.select().from(learningCycles).where(eq(learningCycles.id,cycles[0]!.id)))[0]!.erasedAt).not.toBeNull();
    await memoryJobService(db).tick({limit:10});
    expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,root.id)))[0]).toMatchObject({deletedAt:null,content:"An independently reviewed completed Task outcome"});
  });
  it("rejects premature, unverified, foreign and stale review conversions without leaving a partial cycle",async()=>{
    const {d,review}=await scheduled(),root=await verifiedLearningRoot(),input=startInput([root.id]);
    await expect(reviews().startLearning(companyId,actor,d.id,input)).rejects.toMatchObject({status:409});
    await begin(d.id);await reviews().finish(companyId,actor,d.id,final());
    await db.update(memoryRecords).set({verificationState:"unverified"}).where(eq(memoryRecords.id,root.id));
    await expect(reviews().startLearning(companyId,actor,d.id,input)).rejects.toMatchObject({status:409});
    const foreign=await verifiedLearningRoot(foreignId);
    await expect(reviews().startLearning(companyId,actor,d.id,startInput([foreign.id]))).rejects.toMatchObject({status:404});
    await expect(reviews().startLearning(companyId,actor,d.id,startInput([root.id],2))).rejects.toMatchObject({status:409});
    await expect(reviews().startLearning(companyId,{type:"agent",source:"agent_jwt",companyId,agentId,runId},d.id,input)).rejects.toMatchObject({status:403});
    expect(await db.select().from(learningCycles).where(eq(learningCycles.companyId,companyId))).toHaveLength(0);
    expect((await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id)))[0]!.learningCycleId).toBeNull();
    const foreignCycle=await learningService(db).create(actor,foreignId,{scope:{type:"company",id:null},purpose:input.purpose,trigger:input.trigger,memoryRecordIds:[foreign.id]});
    await expect(db.update(decisionOutcomeReviews).set({learningCycleId:foreignCycle.id}).where(eq(decisionOutcomeReviews.id,review.id))).rejects.toBeDefined();
    await db.update(memoryRecords).set({verificationState:"human_verified"}).where(eq(memoryRecords.id,root.id));
    const plainCycle=await learningService(db).create(actor,companyId,{scope:{type:"company",id:null},purpose:input.purpose,trigger:input.trigger,memoryRecordIds:[root.id]});
    await expect(db.update(decisionOutcomeReviews).set({learningCycleId:plainCycle.id}).where(eq(decisionOutcomeReviews.id,review.id))).rejects.toBeDefined();
    expect((await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id)))[0]!.learningCycleId).toBeNull();

  });
  it("retains a signed management packet after an authorized outcome revision changes and requires a fresh exact pin for publication",async()=>{
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({management_reviews_v8:true});const purpose=analyticalPurpose();purpose.citation+=" retained outcome review";purpose.analyticalPurpose!.capabilities=["reviews"];const destination=(await aiGovernanceService(db).obligation(actor,companyId,purpose)).id;
    const {d,review}=await scheduled(),management=managementReviewService(db),now=new Date(),definition={name:"Original scheduled native outcome review",reviewType:"ad_hoc" as const,period:{from:new Date(now.getTime()-86400000).toISOString(),until:now.toISOString()},purpose:"management_intelligence" as const,sensitivity:"internal" as const,retentionDays:1,governanceObligationRefs:[destination],sources:[{key:"outcome",source:{kind:"decision_outcome" as const,decisionId:d.id,reviewId:review.id,revision:review.revision}}],agenda:[{key:"inspect",category:"INVESTIGATE" as const,ownerUserId:"local-board",dueAt:new Date(now.getTime()+86400000).toISOString(),sourceKeys:["outcome"],nextAction:"Human inspects the exact originally scheduled review before publication",hypothesis:null}]};
    const created=await management.create(companyId,actor,definition),original=await management.detail(companyId,actor,created.id);await begin(d.id);await reviews().finish(companyId,actor,d.id,final());const retained=await management.detail(companyId,actor,created.id);
    expect(retained.currentQualification).toBe("needs_revalidation");expect(retained.sources).toEqual(original.sources);expect(retained.packet).toEqual(original.packet);expect(retained.sources[0].facts.reviewStatus).toBe("scheduled");
    await expect(management.publish(companyId,actor,created.id,{expectedContentHash:created.contentHash,rationale:"Attempt to rely on the old scheduled outcome after a newer human review",evidenceAndUncertaintyAcknowledged:true,supersedesId:null})).rejects.toMatchObject({status:409});await expect(management.create(companyId,actor,definition)).rejects.toMatchObject({status:409});
  });
  it("inherits all six original outcome judgments and receipt erasure into a separately published native management review",async()=>{
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({management_reviews_v8:true}); const purpose=analyticalPurpose();purpose.citation+=" management review";purpose.analyticalPurpose!.capabilities=["reviews"];
    const destination=(await aiGovernanceService(db).obligation(actor,companyId,purpose)).id;
    const {d}=await scheduled();await begin(d.id);const original=await reviews().finish(companyId,actor,d.id,final()),chosen=await native().get(d.id);
    const management=managementReviewService(db),now=new Date(),created=await management.create(companyId,actor,{name:"Cited independent native outcome judgments",reviewType:"weekly_leadership",period:{from:new Date(now.getTime()-86400000).toISOString(),until:now.toISOString()},purpose:"management_intelligence",sensitivity:"internal",retentionDays:1,governanceObligationRefs:[destination],sources:[{key:"outcome",source:{kind:"decision_outcome",decisionId:d.id,reviewId:original.id,revision:original.revision}}],agenda:[{key:"inspect",category:"INVESTIGATE",ownerUserId:"local-board",dueAt:new Date(now.getTime()+86400000).toISOString(),sourceKeys:["outcome"],nextAction:"Human reviews original independent judgments before proposing another decision",hypothesis:null}]});
    const view=await management.detail(companyId,actor,created.id),facts=view.packet.claims[0].facts;
    expect(facts).toMatchObject({decisionProcessQuality:"supported",assumptionAccuracy:"unknown",executionFidelity:"unknown",externalChange:"unknown",observedOutcome:"unknown",causalConfidence:"not_assessed",lessonSummary:final().lessonSummary});
    const {authorizationCheckedAt,...retained}=original;expect(view.sources[0].outcome).toEqual(retained);expect(view.currentQualification).toBe("current");
    await management.publish(companyId,actor,created.id,{expectedContentHash:created.contentHash,rationale:"Human acknowledges every retained independent outcome judgment",evidenceAndUncertaintyAcknowledged:true,supersedesId:null});
    expect((await native().get(d.id))!.chosenOptionId).toBe(chosen!.chosenOptionId);expect(await db.select().from(issueComments).where(eq(issueComments.issueId,targetId))).toHaveLength(1);
    const [receipt]=await db.select().from(decisionOutcomeReviewReceipts).where(and(eq(decisionOutcomeReviewReceipts.reviewId,original.id),eq(decisionOutcomeReviewReceipts.revision,1)));
    await disableV8Rollout(db);await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,receipt.lineageManifestId));
    expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.id,created.id))).toHaveLength(0);expect((await native().get(d.id))!.chosenOptionId).toBe(chosen!.chosenOptionId);
  });
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
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({management_reviews_v8:true}); const purpose=analyticalPurpose();purpose.citation+=" completed outcome review";purpose.analyticalPurpose!.capabilities=["reviews"]; const destination=(await aiGovernanceService(db).obligation(actor,companyId,purpose)).id;
    const management=managementReviewService(db),now=new Date(),copied=await management.create(companyId,actor,{name:"Cited native baseline and post-choice actual",reviewType:"monthly_business",period:{from:new Date(now.getTime()-86400000).toISOString(),until:now.toISOString()},purpose:"management_intelligence",sensitivity:"internal",retentionDays:1,governanceObligationRefs:[destination],sources:[{key:"outcome",source:{kind:"decision_outcome",decisionId:d.id,reviewId:completed.id,revision:completed.revision}}],agenda:[{key:"inspect",category:"INVESTIGATE",ownerUserId:"local-board",dueAt:new Date(now.getTime()+86400000).toISOString(),sourceKeys:["outcome"],nextAction:"Human reviews the complete original baseline and actual measurement",hypothesis:null}]});
    const retained=await management.detail(companyId,actor,copied.id);expect(retained.sources[0].outcome!.receipts[0].comparisons).toEqual(completed.receipts[0].comparisons);expect(retained.sources[0].outcome!.receipts[0].actualEvidence).toEqual(completed.receipts[0].actualEvidence);expect(retained.currentQualification).toBe("current");
    await management.publish(companyId,actor,copied.id,{expectedContentHash:copied.contentHash,rationale:"Human acknowledges original actuals without causal attribution",evidenceAndUncertaintyAcknowledged:true,supersedesId:null});
    await disableV8Rollout(db);await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id,actual.lineageManifestId));expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.id,copied.id))).toHaveLength(0);expect((await native().get(d.id))!.chosenOptionId).toBe("proceed");
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
    await disableV8Rollout(db);
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
    companyId=otherCompany;await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await disableV8Rollout(db);
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
    await reviews().finish(companyId,actor,d.id,input);await disableV8Rollout(db);
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[laterId]);});
    expect(await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id))).toHaveLength(0);
    expect(await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).toHaveLength(0);
    expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.id,context.versions[0].id))).toHaveLength(1);
    expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.decisionId,d.id))).toHaveLength(1);
  });
  it("purges a live frozen review with flags off while preserving another company's content",async()=>{
    const {d,review}=await scheduled();await begin(d.id);await reviews().finish(companyId,actor,d.id,final());
    const verified=await verifiedLearningRoot();await reviews().startLearning(companyId,actor,d.id,startInput([verified.id]));
    await db.insert(projects).values({companyId:foreignId,name:"Other company remains intact"});await disableV8Rollout(db);
    await purgeCompanyContent(db,companyId,{restoreQuarantine:true});
    expect(await db.select().from(decisionOutcomeReviews).where(eq(decisionOutcomeReviews.id,review.id))).toHaveLength(0);
    expect(await db.select().from(decisionOutcomeReviewReceipts).where(eq(decisionOutcomeReviewReceipts.reviewId,review.id))).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.companyId,foreignId))).toHaveLength(1);
  });
});
