import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PROCESS_DATA_DIMENSIONS, governanceObligationSchema, processAnalysisDefinitionSchema, type ProcessAnalysisDefinitionDetail, type ProcessAnalysisRunView, type ProcessFindingView } from "@paperclipai/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProcessIntelligenceWorkspace } from "@/pages/ProcessIntelligence";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const companyId=id(1),userId="reviewer",definitionId=id(2),versionId=id(3),policyId=id(4),runId=id(5);
const createdAt="2026-01-03T00:00:00Z",nextReviewAt="2098-01-01T00:00:00Z",expiresAt="2099-01-01T00:00:00Z";
const baseDefinition=processAnalysisDefinitionSchema.parse({name:"Delivery evidence review",businessQuestion:"Which recorded Task paths reach their first completion, and where was work blocked?",
  ownerUserId:userId,reviewFrequencyDays:30,retentionDays:30,scope:"company",sensitivity:"internal",purpose:"process_intelligence",governanceObligationRefs:[policyId],
  requiredSourceProviders:["activity_log"],objectTypes:["issue"],requiredActivities:["issue.created","issue.updated"],minimumCoverageSeconds:3600,
  analysisFamilies:["event_volume","directly_follows","variants","cycle_time","blocked_time","rework"],requiresArrivalEvidence:false,maxLateArrivalRate:0});
const policy=governanceObligationSchema.parse({framework:"company_policy",authority:"Sample board",citation:"Approved advisory process purpose",jurisdictionOrScope:"Native business objects",
  applicabilityFacts:"Inspect recorded business-object paths",applicabilityState:"applicable",effectiveFrom:"2026-01-01T00:00:00Z",effectiveUntil:null,requiredControl:"Current native source authority",
  evidenceRequired:["Native version and source pins"],controlRefs:["Human review"],nextReviewAt:expiresAt,reviewTrigger:"Source or purpose change",sourceVersionOrDate:"storybook/v1",sourceUrl:"https://example.test/process-policy",
  analyticalPurpose:{status:"approved",purpose:"process_intelligence",capabilities:["process"],populationUnits:"business_objects",peopleImpact:"none",decisionBoundary:"advisory_only",
    maxRetentionDays:30,permittedSensitivity:["internal"],prohibitedUses:["Employee ranking"],approvalRationale:"Sample human-approved advisory process purpose"}});
function Fixture({state}:{state:"published"|"draft"|"needs_review"|"inconclusive"|"empty"|"conformance"}) {
  const [client]=useState(()=>{
    const definition=state==="conformance" ? processAnalysisDefinitionSchema.parse({...baseDefinition,analysisFamilies:[...baseDefinition.analysisFamilies,"conformance"],
      conformance:{kind:"explicit_definition",expectations:[{objectType:"issue",initialStates:["todo"],terminalStates:["done"],requiredStates:["in_review"],allowedTransitions:[{from:"todo",to:"in_review"},{from:"in_review",to:"done"}]}]}}) : baseDefinition;
    const query=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity}}});
    const root={id:definitionId,companyId,key:"delivery_review",revision:state==="draft" ? 1 :2,status:state==="needs_review" ? "needs_review" as const :state==="draft" ? "draft" as const :"published" as const,
      publishedVersionId:state==="draft" ? null :versionId,createdAt,updatedAt:createdAt};
    const pin={id:versionId,companyId,definitionId,revision:1,definition,contentHash:"a".repeat(64),createdAt,nextReviewAt,expiresAt};
    const detail:ProcessAnalysisDefinitionDetail={root,effectiveVersion:pin,latestVersion:pin,versions:[pin],hasMoreVersions:false,reviewReason:state==="needs_review" ? "The accountable owner changed; human review is required" :null};
    const run:ProcessAnalysisRunView={id:runId,companyId,definitionId,versionId,lineageManifestId:id(6),definitionHash:"a".repeat(64),eventSetHash:"b".repeat(64),from:"2026-01-01T00:00:00Z",until:"2026-01-02T23:59:59.999999Z",
      createdAt,expiresAt,authorizationCheckedAt:"2026-10-07T00:00:00Z",result:{engineVersion:"storybook_fixture_not_qualification",status:state==="inconclusive" ? "inconclusive" :"succeeded",
        errorCode:state==="inconclusive" ? "DATA_NOT_READY" :null,semantics:"observed_native_activity_paths_no_causal_or_person_effect",
        readiness:{companyId,engineVersion:"storybook_fixture_not_evidence",status:state==="inconclusive" ? "unknown" :"ready",admission:state==="inconclusive" ? "DATA_NOT_READY" :"DATA_READY",analysisKey:"published_native_process",
          requirementHash:"c".repeat(64),eventSetHash:"b".repeat(64),assessedAt:createdAt,expiresAt:"2026-01-03T00:05:00Z",authorizedEventCount:state==="inconclusive" ? 1 :3,
          coverage:state==="inconclusive" ? "bounded_incomplete_snapshot" :"current_native_activity_snapshot",findings:[],
          dimensions:PROCESS_DATA_DIMENSIONS.map(dimension=>({dimension,state:state==="inconclusive" && ["source_coverage","lifecycle_completeness"].includes(dimension) ? "unknown" :["actor_mapping_quality","late_arrival_rate","cross_system_entity_resolution"].includes(dimension) ? "not_applicable" :"satisfied",
            required:!["actor_mapping_quality","late_arrival_rate","cross_system_entity_resolution"].includes(dimension),reason:state==="inconclusive" && dimension==="source_coverage" ? "Required complete source coverage is unestablished; an authorized subset cannot qualify this run" :state==="inconclusive" && dimension==="lifecycle_completeness" ? "A recorded creation or terminal fact is missing" :"Presentation fixture; no source qualification is established by this story"}))},
        objectSummaries:state==="inconclusive" ? [] :[{objectType:"issue",objectCount:1,eventCount:3,closedCompletionCount:1,cancelledCount:0,censoredCount:0,medianCycleSeconds:60,p90CycleSeconds:60,knownBlockedSeconds:15,reopenCount:0,
          directlyFollows:[{from:"issue.created:todo",to:"issue.updated:blocked",count:1},{from:"issue.updated:blocked",to:"issue.updated:done",count:1}],
          variants:[{hash:"d".repeat(64),activities:["issue.created:todo","issue.updated:blocked","issue.updated:done"],objectCount:1}],
          conformance:state==="conformance" ? {target:"explicit_published_process_definition",targetVersionId:versionId,modelHash:"f".repeat(64),evaluatedObjectCount:1,conformingObjectCount:0,deviatingObjectCount:1,
            violationCounts:{initial_state_not_expected:0,terminal_state_not_expected:0,transition_not_expected:2,required_state_missing:1},coverage:"qualified_primary_object_lifecycle_in_observed_window"} : null}]}};
    const key=["process-definitions",companyId,userId];
    query.setQueryData(key,{pages:[{items:state==="empty" ? [] :[{...root,definition,nextReviewAt,expiresAt,reviewReason:detail.reviewReason}],nextCursor:null,coverage:"bounded_current_authorized_page"}],pageParams:[undefined]});
    query.setQueryData([...key,"detail",definitionId],detail);
    query.setQueryData([...key,"runs",definitionId],{pages:[{items:state==="published" || state==="inconclusive" || state==="conformance" ? [run] :[],nextCursor:null,coverage:"bounded_current_authorized_page"}],pageParams:[undefined]});
    query.setQueryData([...key,"run",definitionId,runId],run);
    const finding:ProcessFindingView={id:id(7),companyId,definitionId,analysisRunId:runId,findingType:state==="inconclusive" ? "missing_process_data" :"avoidable_wait",
      objectType:state==="inconclusive" ? null :"issue",variantHash:null,severity:"medium",interpretation:state==="inconclusive" ? "Investigate missing qualified source coverage before interpreting durations" :"Investigate whether recorded blocked intervals can be reduced",
      summary:state==="inconclusive" ? "The declared process analysis lacks qualified current data" :"Recorded object paths contain blocked intervals for human investigation",
      facts:{observed:state==="inconclusive" ? {source_coverage:"unknown"} :{knownBlockedSeconds:15},semantics:"human_process_interpretation_of_observed_facts",
        limitations:["Human interpretation is not a causal estimate","Presentation fixture does not qualify current source authority"]},definitionHash:run.definitionHash,eventSetHash:run.eventSetHash,contentHash:"e".repeat(64),
      status:"OPEN",version:1,createdAt,expiresAt,resolvedAt:null,resolutionRef:null,authorizationCheckedAt:run.authorizationCheckedAt};
    query.setQueryData([...key,"findings",definitionId,runId],{pages:[{items:[finding],nextCursor:null}],pageParams:[undefined]});
    query.setQueryData([...key,"findings",definitionId,runId,"detail",finding.id],{finding,transitions:[{version:1,fromStatus:null,toStatus:"OPEN",reason:finding.interpretation,recordedAt:createdAt}],hasMoreTransitions:false});
    query.setQueryData(["governance-obligations",companyId,userId],[{id:policyId,obligation:policy}]);return query;
  });
  return <QueryClientProvider client={client}><ProcessIntelligenceWorkspace companyId={companyId} userId={userId}/></QueryClientProvider>;
}
// Local query fixtures exercise presentation only. Browser QA blocks API calls;
// these stories cannot qualify source coverage, publication or provider authority.
const meta:Meta={title:"Business Intelligence/Process intelligence",parameters:{layout:"padded"}};
export default meta;
type Story=StoryObj;
export const Published:Story={render:()=> <Fixture state="published"/>};
export const Draft:Story={render:()=> <Fixture state="draft"/>};
export const NeedsReview:Story={render:()=> <Fixture state="needs_review"/>};
export const Inconclusive:Story={render:()=> <Fixture state="inconclusive"/>};
export const Operator:Story={render:()=> <Fixture state="empty"/>};
export const Conformance:Story={render:()=> <Fixture state="conformance"/>};
