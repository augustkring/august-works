import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { activityLog,analyticalLineageManifests,businessMetrics,businessMetricVersions,businessMetricTargets,businessMetricTargetVersions,businessMetricTargetApprovals,
  companies,createDb,goals,issues,projects,processAnalysisDefinitions,processAnalysisPublications,processAnalysisRuns,processAnalysisVersions,
  strategyExecutionLinks,strategyExecutionLinkVersions,strategyExecutionLinkApprovals,aiUseCases,aiUseCaseVersions,aiUseCaseAssessments,aiUseCaseChangeEvents,aiUseCaseDeployments,governanceStopActions,governanceObligations,agents,heartbeatRuns,processFindings,processFindingTransitions } from "@paperclipai/db";
import { businessMetricTargetDefinitionSchema,processAnalysisDefinitionSchema,strategyExecutionLinkDefinitionSchema } from "@paperclipai/shared";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { businessMetricTargetService } from "../services/business-metrics/targets.js";
import { strategyExecutionService } from "../services/strategy-execution/service.js";
import { businessEventService } from "../services/business-events.js";
import { processAnalysisService } from "../services/process-analysis.js";
import { processFindingService } from "../services/process-findings.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { analyticalPurpose,metricDefinition } from "./helpers/business-metric-fixture.js";
import { purpose,oversight,reviews } from "./helpers/governance-fixture.js";
import { getEmbeddedPostgresTestSupport,startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support=await getEmbeddedPostgresTestSupport(),suite=support.supported ? describe :describe.skip;
const actor={type:"board" as const,source:"local_implicit" as const};
suite("V8 native analytical ownership during company content purge",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
  beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v8-purge-");db=createDb(database.connectionString);
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({ai_use_cases_v7:true,governance_evidence_v7:true,enableFoundationV1:true,
      analytical_lineage_v8:true,business_metrics_v8:true,strategy_execution_v8:true,business_events_v8:true,process_intelligence_v8:true});});
  afterAll(async()=>{await database?.cleanup();});
  async function populated() {
    const companyId=randomUUID(),goalId=randomUUID(),projectId=randomUUID(),issueId=randomUUID();
    await db.insert(companies).values({id:companyId,name:"Private analytical company",issuePrefix:randomUUID()});
    await db.insert(goals).values({id:goalId,companyId,title:"Private objective"});await db.insert(projects).values({id:projectId,companyId,name:"Private initiative"});
    await db.insert(issues).values({id:issueId,companyId,projectId,title:"Private task",status:"done",createdAt:new Date("2026-01-01T12:00:00Z")});
    const managementPolicy=analyticalPurpose();managementPolicy.analyticalPurpose!.capabilities=["metrics","strategy"];
    const policyId=(await aiGovernanceService(db).obligation(actor,companyId,managementPolicy)).id;
    const metric=await businessMetricService(db).create(companyId,actor,{key:"completion",definition:metricDefinition(policyId)});
    await businessMetricService(db).publish(companyId,actor,metric.metric.id,{expectedRevision:1,versionId:metric.version.id});
    const target=await businessMetricTargetService(db).create(companyId,actor,{key:"commitment",definition:businessMetricTargetDefinitionSchema.parse({metricId:metric.metric.id,metricVersionId:metric.version.id,
      scope:{type:"goal",goalId},periodStart:"2026-01-01T00:00:00Z",periodEnd:"2026-01-02T00:00:00Z",criterion:{kind:"at_least",value:.8},rationale:"Explicit native review commitment",assumptions:["Recorded status is not business outcome"],ownerUserId:"local-board"})});
    await businessMetricTargetService(db).approve(companyId,actor,target.target.id,{expectedRevision:1,versionId:target.version.id,approvalRationale:"Human approval of exact current native commitment"});
    const strategy=await strategyExecutionService(db).create(companyId,actor,{definition:strategyExecutionLinkDefinitionSchema.parse({from:{type:"metric",id:metric.metric.id,versionId:metric.version.id},to:{type:"goal",id:goalId},
      relationship:"measures",rationale:"Explicit reviewed measurement link",contribution:null,ownerUserId:"local-board",reviewFrequencyDays:30,retentionDays:30,sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[policyId]})});
    await strategyExecutionService(db).approve(companyId,actor,strategy.link.id,{expectedRevision:1,versionId:strategy.version.id,rationale:"Human reviewed existing objective and measurement"});
    const processPolicy=analyticalPurpose();processPolicy.citation="Native process purpose";processPolicy.analyticalPurpose!.purpose="process_intelligence";processPolicy.analyticalPurpose!.capabilities=["process"];
    const processPolicyId=(await aiGovernanceService(db).obligation(actor,companyId,processPolicy)).id;
    await db.insert(activityLog).values([{companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:issueId,action:"issue.created",createdAt:new Date("2026-01-01T12:00:00Z"),details:{status:"todo",projectId}},
      {companyId,actorType:"user",actorId:"private-person",entityType:"issue",entityId:issueId,action:"issue.updated",createdAt:new Date("2026-01-01T12:01:00Z"),details:{status:"done",projectId}}]);
    const period={from:"2026-01-01T00:00:00Z",until:"2026-01-02T00:00:00Z"};
    await businessEventService(db).backfill(companyId,actor,{...period,limit:100,retentionDays:30,governanceObligationRefs:[processPolicyId]});
    const process=await processAnalysisService(db).create(companyId,actor,{key:"process",definition:processAnalysisDefinitionSchema.parse({name:"Private task flow",businessQuestion:"How long did recorded native work take?",ownerUserId:"local-board",reviewFrequencyDays:30,retentionDays:30,
      scope:"company",sensitivity:"internal",purpose:"process_intelligence",governanceObligationRefs:[processPolicyId],requiredSourceProviders:["activity_log"],objectTypes:["issue"],requiredActivities:["issue.created","issue.updated"],minimumCoverageSeconds:3600,
      analysisFamilies:["event_volume","cycle_time"],requiresArrivalEvidence:false,maxLateArrivalRate:0})});
    await processAnalysisService(db).publish(companyId,actor,process.root.id,{expectedRevision:1,versionId:process.version.id,rationale:"Human review of native process and approved purpose"});
    const run=await processAnalysisService(db).run(companyId,actor,process.root.id,{versionId:process.version.id,...period});expect(run.result.status).toBe("succeeded");
    const missing=await processAnalysisService(db).create(companyId,actor,{key:"missing_arrival",definition:{...process.version.definition,requiresArrivalEvidence:true}});
    await processAnalysisService(db).publish(companyId,actor,missing.root.id,{expectedRevision:1,versionId:missing.version.id,rationale:"Review explicit source-arrival requirement before collecting transport evidence"});
    const missingRun=await processAnalysisService(db).run(companyId,actor,missing.root.id,{versionId:missing.version.id,...period});
    await processFindingService(db).create(companyId,actor,missing.root.id,missingRun.id,{findingType:"missing_process_data",objectType:null,variantHash:null,severity:"medium",interpretation:"Investigate unqualified native source arrival evidence"});
    const governance=aiGovernanceService(db),profile=await governance.oversight(actor,companyId,oversight);
    const useCase=await governance.create(actor,companyId,{key:"native-advisory",purpose:{...purpose(),riskClass:"C0",oversightProfileId:profile.id}});
    await governance.assess(actor,companyId,useCase.id,{...reviews()[0]!,expectedVersion:useCase.version});
    const [agent]=await db.insert(agents).values({companyId,name:"Private governed agent"}).returning();
    const [deployment]=await db.insert(aiUseCaseDeployments).values({companyId,useCaseId:useCase.id,purposeVersion:1,issueId,agentId:agent!.id,purposeHash:useCase.purposeHash,
      authorityHash:"fixture-fenced",status:"review_required",createdByUserId:"local-board"}).returning();
    const [execution]=await db.insert(heartbeatRuns).values({companyId,agentId:agent!.id,nativeIssueId:issueId,status:"succeeded",invocationSource:"on_demand"}).returning();
    await db.insert(governanceStopActions).values({companyId,deploymentId:deployment!.id,runId:execution!.id});
    await governance.update(actor,companyId,useCase.id,{expectedVersion:useCase.version+1,purpose:{...useCase.purpose,intendedPurpose:"Review recorded native company process evidence"},changeReason:"Human changes the documented intended advisory purpose"});
    return {companyId,metric,target,strategy,process,run,policyId};
  }
  it("erases published roots, immutable versions, generated source pins and run lineage while preserving another company's native history",async()=>{
    const erased=await populated(),retained=await populated();
    await expect(db.delete(governanceObligations).where(eq(governanceObligations.id,retained.policyId))).rejects.toThrow();
    // Ordinary archival and an invented GUC do not grant scoped erasure.
    await expect(db.transaction(async tx=>{
      await tx.execute(sql`select set_config('august_works.company_content_erasure',${retained.companyId},true)`);
      await tx.update(companies).set({status:"archived",pauseReason:"company_deleted"}).where(eq(companies.id,retained.companyId));
      await tx.delete(governanceObligations).where(eq(governanceObligations.id,retained.policyId));
    })).rejects.toThrow();
    // Even the erasure transaction cannot rewrite frozen purpose evidence.
    await expect(db.transaction(async tx=>{
      await tx.execute(sql`update companies set status='archived',pause_reason='company_deleted',content_erasure_transaction_id=pg_current_xact_id()::text where id=${retained.companyId}::uuid`);
      await tx.update(governanceObligations).set({obligationHash:"rewritten"}).where(eq(governanceObligations.id,retained.policyId));
    })).rejects.toThrow();
    await expect(db.transaction(async tx=>{
      await tx.execute(sql`update companies set status='archived',pause_reason='company_deleted',content_erasure_transaction_id=pg_current_xact_id()::text where id=${erased.companyId}::uuid`);
      await tx.delete(governanceObligations).where(eq(governanceObligations.id,retained.policyId));
    })).rejects.toThrow();
    await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({strategy_execution_v8:false,process_intelligence_v8:false,business_metrics_v8:false,business_events_v8:false});
    const result=await purgeCompanyContent(db,erased.companyId);expect(result.companyTombstoneRetained).toBe(true);
    for(const table of [businessMetrics,businessMetricVersions,businessMetricTargets,businessMetricTargetVersions,businessMetricTargetApprovals,strategyExecutionLinks,strategyExecutionLinkVersions,strategyExecutionLinkApprovals,
      processAnalysisDefinitions,processAnalysisVersions,processAnalysisPublications,processAnalysisRuns,analyticalLineageManifests,
      aiUseCases,aiUseCaseVersions,aiUseCaseAssessments,aiUseCaseChangeEvents,aiUseCaseDeployments,governanceStopActions,governanceObligations,processFindings,processFindingTransitions]) {
      expect(await db.select({companyId:table.companyId}).from(table).where(eq(table.companyId,erased.companyId))).toHaveLength(0);
      expect((await db.select({companyId:table.companyId}).from(table).where(eq(table.companyId,retained.companyId))).length).toBeGreaterThan(0);
    }
    expect((await db.select().from(companies).where(eq(companies.id,erased.companyId)))[0]).toMatchObject({name:"Deleted company",status:"archived",pauseReason:"company_deleted"});
    const [receipt]=await db.execute<{current:boolean}>(sql`select aw_company_content_erasure_current(${erased.companyId}::uuid) as current`);
    expect(receipt!.current).toBe(false);
  });
});
