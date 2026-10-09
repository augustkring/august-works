import { disableV8Rollout } from "./helpers/v8-rollout.js";
import { nativeManagementSdkFixture } from "./helpers/native-management-sdk-fixture.js";
import express from "express";
import request from "supertest";
import {decisionIntelligenceRoutes} from "../routes/decision-intelligence.js";
import {errorHandler} from "../middleware/index.js";
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {and,eq,sql} from "drizzle-orm";
import {agents,authUsers,companies,companyMemberships,createDb,decisions,heartbeatRuns,issues,projects,issueComments,
  decisionContexts,decisionContextVersions,decisionContextBindings,decisionContextPreparations,decisionCriteria,decisionAssumptions,decisionExpectedOutcomes,
  decisionEvidenceLinks,analyticalLineageManifests,analyticalLineageEdges} from "@paperclipai/db";
import {decisionContextDefinitionSchema,type DecisionContextDefinition} from "@paperclipai/shared";
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
suite("Native prospective decision context on migrated PostgreSQL",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
  let companyId:string,foreignId:string,originId:string,targetId:string,projectId:string,agentId:string,runId:string,policyId:string;
  beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-decision-context-");db=createDb(database.connectionString);
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
  async function observation() {
    const metrics=businessMetricService(db),created=await metrics.create(companyId,actor,{key:"baseline",definition:metricDefinition(policyId)});
    await metrics.publish(companyId,actor,created.metric.id,{expectedRevision:1,versionId:created.version.id});
    return metrics.query(companyId,actor,{metricId:created.metric.id,versionId:created.version.id,from:"2026-01-01T00:00:00Z",until:"2026-01-02T00:00:00Z",dimensions:[],maxRows:100});
  }
  it("keeps bounded native scope menus independent of management rollout and current-account/tenant/private-source admission",async()=>{
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({management_reviews_v8:false});await db.insert(projects).values({companyId:foreignId,name:"Foreign private project"});
    const choices=await service().scopeOptions(companyId,actor,"project");expect(choices.items.map(item=>item.title)).toEqual(["Controlled native project"]);expect(choices.coverage).toBe("bounded_authorized_native_choices");
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,targetId));const tasks=await service().scopeOptions(companyId,actor,"issue");expect(tasks.items.map(item=>item.title)).toEqual(["Task · Private origin title"]);
    const app=express();app.use((req,_res,next)=>{req.actor={...actor,userId:"operator"};next();});app.use(decisionIntelligenceRoutes(db));app.use(errorHandler);const path=`/companies/${companyId}/decision-context-source-options`;
    const good=await request(app).get(`${path}?kind=project&expectedUserId=operator`);expect(good.status,JSON.stringify(good.body)).toBe(200);expect(good.headers["cache-control"]).toBe("no-store");const changed=await request(app).get(`${path}?kind=project&expectedUserId=other`);expect(changed.status).toBe(409);expect(JSON.stringify(changed.body)).not.toContain("Controlled native project");expect((await request(app).get(`${path}?kind=project&facts=1`)).status).toBe(400);expect((await request(app).get(`${path}?kind=all`)).status).toBe(400);
    await expect(service().scopeOptions(companyId,{type:"agent",agentId,companyId,source:"agent_jwt"},"project")).rejects.toMatchObject({status:403});await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({decision_intelligence_v8:false});await expect(service().scopeOptions(companyId,actor,"project")).rejects.toMatchObject({status:404});
  });
  it("separates immutable proposal versions and explicit preparation, with native CAS and tenant constraints",async()=>{
    const d=await create(),proposal=await service().propose(companyId,actor,d.id,{expectedRevision:0,definition:definition()});
    expect(proposal).toMatchObject({revision:1,preparedVersionId:null,binding:null,versions:[{state:"draft"}]});
    expect((await native().get(d.id))!.status).toBe("open");expect(await db.select().from(issueComments).where(eq(issueComments.companyId,companyId))).toHaveLength(0);
    const versions=await Promise.allSettled([service().propose(companyId,actor,d.id,{expectedRevision:1,definition:definition()}),service().propose(companyId,actor,d.id,{expectedRevision:1,definition:definition()})]);
    expect(versions.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    await expect(service().prepare(companyId,actor,d.id,{expectedRevision:2,versionId:proposal.versions[0].id,rationale:"Attempt to prepare a superseded prospective version"})).rejects.toMatchObject({status:409});
    await expect(db.update(decisionContextVersions).set({contentHash:"f".repeat(64)}).where(eq(decisionContextVersions.decisionId,d.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db.update(decisionCriteria).set({key:"altered"}).where(eq(decisionCriteria.decisionId,d.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db.delete(decisionAssumptions).where(eq(decisionAssumptions.decisionId,d.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db.insert(decisionContexts).values({companyId:foreignId,decisionId:d.id})).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(service().detail(foreignId,actor,d.id)).rejects.toMatchObject({status:404});
  });
  it("freezes the prepared context atomically with the existing choice and preserves native durable effects and replay",async()=>{
    const d=await create(),prepared=await prepare(d.id),pin=prepared.versions[0];
    expect(prepared).toMatchObject({revision:2,preparedVersionId:pin.id,binding:null});
    const chosen=await choose(d.id);expect(chosen).toMatchObject({status:"decided",executionStatus:"succeeded",chosenOptionId:"proceed"});
    const retained=await service().detail(companyId,actor,d.id);
    expect(retained).toMatchObject({binding:{versionId:pin.id,optionId:"proceed",contextHash:pin.contentHash,frozenAt:chosen.decidedAt!.toISOString()},versions:[{state:"frozen_for_decision"}]});
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId,targetId))).toHaveLength(1);
    await choose(d.id);expect(await db.select().from(issueComments).where(eq(issueComments.issueId,targetId))).toHaveLength(1);
    await expect(service().propose(companyId,actor,d.id,{expectedRevision:2,definition:definition()})).rejects.toMatchObject({status:409});
    await expect(db.update(decisionContextBindings).set({contextHash:"f".repeat(64)}).where(eq(decisionContextBindings.decisionId,d.id))).rejects.toMatchObject({cause:{code:"23514"}});
    await expect(db.update(decisions).set({chosenOptionId:"defer"}).where(eq(decisions.id,d.id))).rejects.toMatchObject({cause:{code:"23514"}});
  });
  it("retains captured native baseline facts when later observations change, without accepting caller-owned copies",async()=>{
    const d=await create(),baseline=await observation(),input=definition();
    input.evidence=[{key:"baseline",source:{type:"metric_observation",id:baseline.id,metricId:baseline.metricId,metricVersionId:baseline.versionId},relationship:"metric_observation",optionId:null,criterionKey:null,rationale:"Pinned native measurement supporting human consideration"}];
    const prepared=await prepare(d.id,input);expect(prepared.versions[0].evidence[0].facts.value).toBe(0.5);
    expect(JSON.stringify(prepared)).not.toMatch(/Private origin title|Private target title/);
    await choose(d.id);await db.update(issues).set({status:"done",updatedAt:new Date()}).where(eq(issues.id,targetId));
    const latest=await businessMetricService(db).query(companyId,actor,{metricId:baseline.metricId,versionId:baseline.versionId,from:baseline.from,until:baseline.until,dimensions:[],maxRows:100});
    expect(latest.value).toBe(1);const historical=await service().detail(companyId,actor,d.id);
    expect(historical.versions[0].evidence[0].facts.value).toBe(0.5);expect(historical.versions[0].contentHash).toBe(prepared.versions[0].contentHash);
  });
  it("reads an exact prepared Decision through the actual SDK without choosing and erases only its dependent answer",async()=>{
    const d=await create(),baseline=await observation(),input=definition();
    input.evidence=[{key:"baseline",source:{type:"metric_observation",id:baseline.id,metricId:baseline.metricId,metricVersionId:baseline.versionId},relationship:"metric_observation",optionId:null,criterionKey:null,rationale:"Human pins the exact native baseline for separate consideration"}];
    const prepared=await prepare(d.id,input),versionId=prepared.versions[0]!.id,sdk=await nativeManagementSdkFixture(db,companyId),before=await native().get(d.id);
    const result=await sdk.read("get_decision_context",{decisionId:d.id,versionId});
    expect(result).toMatchObject({tool:"get_decision_context",citations:[{kind:"decision_context",decisionId:d.id,versionId}],result:{decisionId:d.id,binding:null,version:{id:versionId}},executionAuthority:"read_only_or_advisory"});
    expect(await native().get(d.id)).toEqual(before);expect(await db.select().from(issueComments).where(eq(issueComments.companyId,companyId))).toHaveLength(0);
    await sdk.retainCopy(result);expect(await sdk.retained()).toBe(true);
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,targetId));
    await expect(sdk.read("get_decision_context",{decisionId:d.id,versionId})).rejects.toMatchObject({status:404});
    await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,targetId));
    await disableV8Rollout(db);await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));
    await db.transaction(async raw=>{const tx=raw as unknown as typeof db;await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[targetId]);});
    expect(await sdk.retained()).toBe(false);expect(await native().get(d.id)).toEqual(before);
    expect(await db.select({id:issues.id,status:issues.status}).from(issues).where(eq(issues.id,targetId))).toEqual([{id:targetId,status:"todo"}]);
  });
  it("blocks choice when current source visibility changes and leaves canonical work and binding untouched",async()=>{
    const d=await create();await prepare(d.id);
    await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,targetId));
    await expect(choose(d.id)).rejects.toMatchObject({status:404});
    expect((await native().get(d.id))!.status).toBe("open");expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.companyId,companyId))).toHaveLength(0);
    expect(await db.select().from(issueComments).where(eq(issueComments.companyId,companyId))).toHaveLength(0);
  });
  it("requires decision-specific purpose and can explicitly withdraw before making a canonical choice",async()=>{
    const d=await create(),metricsOnly=analyticalPurpose();metricsOnly.citation="Metrics alone do not grant decision context";
    const policy=await aiGovernanceService(db).obligation(actor,companyId,metricsOnly);
    await expect(service().propose(companyId,actor,d.id,{expectedRevision:0,definition:{...definition(),governanceObligationRefs:[policy.id]}})).rejects.toMatchObject({status:409});
    const prepared=await prepare(d.id),suspended=analyticalPurpose();suspended.analyticalPurpose!.capabilities=["metrics","decision"];suspended.analyticalPurpose!.status="suspended";
    await aiGovernanceService(db).obligation(actor,companyId,suspended);
    await expect(choose(d.id)).rejects.toMatchObject({status:409});expect((await native().get(d.id))!.status).toBe("open");
    await service().withdraw(companyId,actor,d.id,{expectedRevision:prepared.revision,rationale:"Withdraw the prepared analytical context after policy suspension"});
    await choose(d.id);expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.companyId,companyId))).toHaveLength(0);
  });
  it("does not infer a binding from a newer proposal or from a disabled analytical feature",async()=>{
    const d=await create(),prepared=await prepare(d.id);
    const newer=await service().propose(companyId,actor,d.id,{expectedRevision:prepared.revision,definition:{...definition(),question:"Should we reconsider this exact native option?"}});
    expect(newer.preparedVersionId).toBeNull();await choose(d.id);expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.decisionId,d.id))).toHaveLength(0);
    const other=await create();await prepare(other.id);await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({decision_intelligence_v8:false});await choose(other.id);
    expect(await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.decisionId,other.id))).toHaveLength(0);
  });
  it("serializes concurrent native choices to a single frozen binding and one effect",async()=>{
    const d=await create();await prepare(d.id);
    const results=await Promise.allSettled([choose(d.id),choose(d.id,"defer")]);expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const [binding]=await db.select().from(decisionContextBindings).where(eq(decisionContextBindings.decisionId,d.id));
    expect(binding.optionId).toBe((await native().get(d.id))!.chosenOptionId);
    expect((await db.select().from(issueComments).where(eq(issueComments.issueId,targetId))).length).toBe(binding.optionId==="proceed"?1:0);
  });
  it("erases every context descendant through native source erasure with flags off, while retaining the original decision",async()=>{
    const d=await create(),prepared=await prepare(d.id);await choose(d.id);
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({decision_intelligence_v8:false,business_metrics_v8:false});
    await db.transaction(async rawTx=>{const tx=rawTx as unknown as typeof db;await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await eraseAnalyticalSourcesUnderMemory(tx,companyId,"issue",[targetId]);});
    for(const table of [decisionContextVersions,decisionContextBindings,decisionContextPreparations,decisionCriteria,decisionAssumptions,decisionExpectedOutcomes,decisionEvidenceLinks])
      expect(await db.select().from(table).where(eq(table.decisionId,d.id))).toHaveLength(0);
    expect((await native().get(d.id))!.chosenOptionId).toBe("proceed");
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental(flags);
    await expect(service().detail(companyId,actor,d.id)).rejects.toMatchObject({status:409});
    expect(prepared.versions[0].id).toBeTruthy();
  });
  it("expires context copies in a paused company with flags off and purges owned roots before immutable descendants",async()=>{
    const d=await create();await prepare(d.id,{...definition(),retentionDays:1});await choose(d.id);
    await db.update(companies).set({status:"paused"}).where(eq(companies.id,companyId));await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({decision_intelligence_v8:false});
    await eraseExpiredAnalyticalLineage(db,new Date(Date.now()+2*86400000));
    expect(await db.select().from(decisionContextVersions).where(eq(decisionContextVersions.decisionId,d.id))).toHaveLength(0);
    expect((await native().get(d.id))!.status).toBe("decided");
    const result=await purgeCompanyContent(db,companyId);expect(result).toBeTruthy();
    expect(await db.select().from(decisionContexts).where(eq(decisionContexts.companyId,companyId))).toHaveLength(0);
    expect(await db.select().from(companies).where(eq(companies.id,foreignId))).toHaveLength(1);
  });
  it("rejects a binding without its matching native choice at transaction commit",async()=>{
    const d=await create(),prepared=await prepare(d.id),pin=prepared.versions[0];
    await expect(db.transaction(async tx=>{await tx.insert(decisionContextBindings).values({companyId,decisionId:d.id,versionId:pin.id,optionId:"proceed",contextHash:pin.contentHash,decisionSpecHash:pin.decisionSpecHash,frozenBy:"local-board",frozenAt:new Date()});})).rejects.toMatchObject({code:"23514"});
    expect((await native().get(d.id))!.status).toBe("open");
  });
});
