import {useState} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {decisionContextDefinitionSchema,governanceObligationSchema,type DecisionContextView,type DecisionOutcomeReviewState} from "@paperclipai/shared";
import type {Meta,StoryObj} from "@storybook/react-vite";
import type {Decision} from "@/api/decisions";
import {DecisionContextWorkspace} from "@/components/DecisionContextPanel";
import {outcomeFixture} from "./decision-outcome-review-fixtures";
import {forecastFixture} from "./business-forecast-fixtures";
import {scenarioFixture} from "./business-scenario-fixtures";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const companyId=id(1),decisionId=id(2),versionId=id(3),policyId=id(4),userId="reviewer",expiresAt="2099-01-01T00:00:00Z",createdAt="2026-10-07T00:00:00Z";
const definition=decisionContextDefinitionSchema.parse({question:"Should we extend the delivery review pilot?",objective:"Improve useful delivery while preserving human ownership",ownerUserId:userId,scope:{type:"company",id:null},
  timeHorizon:{from:"2026-10-07T00:00:00Z",until:"2027-01-01T00:00:00Z"},uncertaintySummary:"Recorded completion does not establish useful outcomes or causal effects",revisitAt:"2026-11-01T00:00:00Z",sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[policyId],retentionDays:30,
  evidence:[{key:"baseline",source:{type:"metric_observation",id:id(5),metricId:id(6),metricVersionId:id(7)},relationship:"metric_observation",optionId:null,criterionKey:null,rationale:"A pinned native observation informs the human delivery review"}],
  assumptions:[{key:"capacity",statement:"Current delivery capacity remains available during the pilot",type:"delivery",confidence:{kind:"human_judgment",level:"medium"},materiality:"high",status:"unverified"}],
  criteria:[{key:"delivery",name:"Useful delivery",description:"Review useful outcomes and observed evidence with the native owner",type:"qualitative",priority:"high",evidenceKey:null}],
  expectedOutcomes:[{kind:"metric",optionId:"extend",evidenceKey:"baseline",expectedRange:{lower:0.6,upper:0.8},expectedDirection:"increase",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"Human expected range; no calibrated forecast interval or causal estimate"}]});
const policy=governanceObligationSchema.parse({framework:"company_policy",authority:"Sample board",citation:"Approved advisory decision purpose",jurisdictionOrScope:"Native business objects",applicabilityFacts:"Prospective context for human native choices",applicabilityState:"applicable",effectiveFrom:createdAt,effectiveUntil:null,requiredControl:"Current native source authority",evidenceRequired:["Native evidence pins"],controlRefs:["Human preparation"],nextReviewAt:expiresAt,reviewTrigger:"Purpose or population change",sourceVersionOrDate:"storybook/v1",sourceUrl:"https://example.test/decision-purpose",
  analyticalPurpose:{status:"approved",purpose:"management_intelligence",capabilities:["metrics","decision"],populationUnits:"business_objects",peopleImpact:"none",decisionBoundary:"advisory_only",maxRetentionDays:30,permittedSensitivity:["internal"],prohibitedUses:["Employee ranking"],approvalRationale:"Presentation-only advisory fixture"}});
const decision:Decision={id:decisionId,companyId,bundleId:null,originAgentId:id(8),originIssueId:id(9),originRunId:id(10),ruleKey:null,title:"Extend delivery review?",body:"The native decision retains its options and effect authority",options:[{id:"extend",label:"Extend the pilot",effects:[]},{id:"defer",label:"Defer and review",effects:[]}],inputs:null,status:"open",executionStatus:null,chosenOptionId:null,inputValues:null,decidedByUserId:null,decidedAt:null,expiresAt,idempotencyKey:null,targetSnapshots:{},continuationPolicy:"none",metadata:{},createdAt,updatedAt:createdAt};
function Fixture({state,reviewState,historicalCalculation=false}:{state:"empty"|"proposal"|"prepared"|"frozen"|"expired";reviewState?:DecisionOutcomeReviewState;historicalCalculation?:boolean}) {
  const [client]=useState(()=>{
    const query=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
    const context:DecisionContextView={companyId,decisionId,revision:state==="empty"?0:state==="proposal"?1:2,preparedVersionId:["prepared","frozen"].includes(state)?versionId:null,
      binding:state==="frozen"?{versionId,optionId:"extend",contextHash:"a".repeat(64),decisionSpecHash:"b".repeat(64),frozenAt:"2026-10-07T01:00:00Z"}:null,
      versions:state==="empty"?[]:[{id:versionId,companyId,decisionId,revision:1,definition,evidence:[{key:"baseline",source:definition.evidence[0].source,sourceHash:"c".repeat(64),capturedAt:createdAt,expiresAt,
        facts:{value:0.5,status:"observed",unit:"ratio",from:"2026-09-01T00:00:00Z",until:"2026-10-01T00:00:00Z",asOf:createdAt},limitations:["Observed native completion is not a useful outcome or a causal estimate","Local fixture demonstrates presentation only; it does not qualify source access"]}],
        contentHash:"a".repeat(64),decisionSpecHash:"b".repeat(64),createdAt,expiresAt:state==="expired"?"2000-01-01T00:00:00Z":expiresAt,state:state==="frozen"?"frozen_for_decision":"draft"}],hasMoreVersions:false,authorizationCheckedAt:createdAt};
    if(historicalCalculation) {
      const s=scenarioFixture(true),source={type:"scenario_run" as const,id:s.run.id,scenarioId:s.scenario.id,versionId:s.version.id,caseKey:"option",outputKey:"capacity"};
      context.versions[0].definition={...definition,evidence:[...definition.evidence,{key:"conditional_capacity",source,relationship:"supports_option",optionId:"extend",criterionKey:null,rationale:"Synthetic conditional scenario evidence for a human review"}]};
      context.versions[0].evidence.push({key:"conditional_capacity",source,sourceHash:"d".repeat(64),capturedAt:createdAt,expiresAt,facts:{nominal:3,differenceFromBase:1,status:"calculated",uncertaintyMethod:"deterministic",uncertaintyQualification:"not_assessed",p10:null,p90:null},limitations:["Conditional human assumptions; no observed actual, calibration, causal effect or commitment is asserted."]});
      context.versions[0].revalidationRequiredEvidenceKeys=["conditional_capacity"];
    }
    query.setQueryData(["decision-context",companyId,userId,decisionId],context);
    query.setQueryData(["decision-outcome-review",companyId,userId,decisionId],reviewState?outcomeFixture(reviewState,definition):null);
    query.setQueryData(["decision-review-observations",companyId,userId,id(6)],{items:[],nextCursor:null,coverage:"bounded_current_authorized_page"});
    query.setQueryData(["governance-obligations",companyId,userId],[{id:policyId,obligation:policy}]);
    query.setQueryData(["decision-evidence",companyId,userId,"metrics"],{items:[{id:id(6),companyId,key:"native_completion",status:"published"}],nextCursor:null});
    query.setQueryData(["decision-evidence",companyId,userId,"observations",id(6)],{items:[{id:id(5),companyId,metricId:id(6),versionId:id(7),from:"2026-09-01T00:00:00Z",until:"2026-10-01T00:00:00Z",status:"observed",expiresAt}],nextCursor:null});
    const f=forecastFixture(true),s=scenarioFixture(true);
    query.setQueryData(["decision-evidence",companyId,userId,"forecasts"],{items:[f.spec],nextCursor:null});
    query.setQueryData(["decision-evidence",companyId,userId,"forecast-runs",f.spec.id],{items:[f.run],nextCursor:null});
    query.setQueryData(["decision-evidence",companyId,userId,"scenarios"],{items:[{scenario:s.scenario,version:s.version}],nextCursor:null});
    query.setQueryData(["decision-evidence",companyId,userId,"scenario-runs",s.scenario.id],{items:[s.run],nextCursor:null});
    return query;
  });
  const native=state==="frozen"?{...decision,status:"decided" as const,chosenOptionId:"extend",decidedAt:"2026-10-07T01:00:00Z"}:decision;
  return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><DecisionContextWorkspace decision={native} userId={userId}/></div></QueryClientProvider>;
}
// These cached fixtures exercise presentation; they are not evidence of live
// source authority, native choice integration or any rollout qualification.
const meta:Meta={title:"Business Intelligence/Decision intelligence",parameters:{layout:"padded"}};export default meta;type Story=StoryObj;
export const Empty:Story={render:()=> <Fixture state="empty"/>};
export const Proposal:Story={render:()=> <Fixture state="proposal"/>};
export const Prepared:Story={render:()=> <Fixture state="prepared"/>};
export const Frozen:Story={render:()=> <Fixture state="frozen"/>};
export const Expired:Story={render:()=> <Fixture state="expired"/>};
export const ReviewScheduled:Story={render:()=> <Fixture state="frozen" reviewState="scheduled"/>};
export const ReviewDue:Story={render:()=> <Fixture state="frozen" reviewState="due"/>};
export const ReviewInProgress:Story={render:()=> <Fixture state="frozen" reviewState="in_review"/>};
export const ReviewCompleted:Story={render:()=> <Fixture state="frozen" reviewState="completed"/>};
export const ReviewInconclusive:Story={render:()=> <Fixture state="frozen" reviewState="inconclusive"/>};
export const ReviewCancelled:Story={render:()=> <Fixture state="frozen" reviewState="cancelled"/>};
export const HistoricalCalculation:Story={render:()=> <Fixture state="frozen" historicalCalculation/>};
