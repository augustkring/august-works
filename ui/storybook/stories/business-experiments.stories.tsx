import { useState } from "react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import type { Meta,StoryObj } from "@storybook/react-vite";
import { BusinessExperimentWorkspace } from "@/pages/BusinessExperiments";
import { BusinessExperimentResult } from "@/components/BusinessExperimentResult";
import { BusinessExperimentSafetyControls } from "@/components/BusinessExperimentSafetyControls";
import { experimentFixture } from "./business-experiment-fixtures";
function Workspace({state="draft"}:{state?:"draft"|"ready"|"running"|"completed"|"analyzing"}){
 const [client]=useState(()=>{const f=experimentFixture(state),q=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false},mutations:{retry:false}}}),key=["business-experiments",f.companyId,f.userId],source=["experiment-definition-sources",f.companyId,f.userId];
  q.setQueryData(key,{pages:[{items:[{experiment:f.experiment,version:f.version}],nextCursor:null,coverage:"bounded_current_authorized_page"}],pageParams:[undefined]});
  q.setQueryData([...key,"detail",f.experiment.id],{experiment:f.experiment,versions:[f.version],transitions:[],coverage:"bounded_recent_versions_and_transitions"});q.setQueryData([...key,"receipts",f.experiment.id,f.version.id],f.receipts);
  q.setQueryData([...source,"purpose"],[f.policy]);q.setQueryData([...source,"metrics"],{pages:[{items:f.measurements.map(m=>m.metric),nextCursor:null}],pageParams:[undefined]});
  for(const m of f.measurements)q.setQueryData([...source,"metric",m.metric.id],{metric:m.metric,versions:[m.version]});
  q.setQueryData(["experiment-unit-sources",f.companyId,f.userId,f.version.id,"issues",f.version.definition.scope],{pages:[[]],pageParams:[undefined]});
  q.setQueryData(["experiment-safety-controls",f.companyId,f.userId],{pages:[{items:[],nextCursor:null,coverage:"bounded_active_recording_control_metadata"}],pageParams:[undefined]});return q;
 });const f=experimentFixture(state);
 return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><BusinessExperimentWorkspace companyId={f.companyId} userId={f.userId}/></div></QueryClientProvider>;
}
function Result({status="inconclusive",stale=false,safety=false}:{status?:"pass"|"fail"|"inconclusive"|"invalid";stale?:boolean;safety?:boolean}){
 const f=experimentFixture("analyzing",status),analysis=stale?{...f.analysis,currentQualification:"needs_revalidation" as const,causalAuthority:"withheld" as const}:safety?{...f.analysis,causalAuthority:"withheld" as const,qualityGates:{...f.analysis.qualityGates,finalOutcomeCapture:"not_required_nonconfirmatory_stop" as const},result:{...f.analysis.result,numericallyQualified:false,metrics:[],reasons:["experiment_safety_stop_or_cancellation_withholds_confirmatory_inference"]}}:f.analysis;
 return <div className="mx-auto w-full max-w-3xl"><BusinessExperimentResult analysis={analysis} definition={f.version.definition}/></div>;
}
function Stopping(){const [client]=useState(()=>{const f=experimentFixture("running"),q=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false},mutations:{retry:false}}});q.setQueryData(["experiment-safety-controls",f.companyId,f.userId],{pages:[{items:[{id:f.experiment.id,companyId:f.companyId,versionId:f.version.id,revision:4,state:"running"}],nextCursor:null,coverage:"bounded_active_recording_control_metadata"}],pageParams:[undefined]});return q;});const f=experimentFixture("running");return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><BusinessExperimentSafetyControls companyId={f.companyId} userId={f.userId}/></div></QueryClientProvider>;}
// Cached synthetic presentation only. Browser QA blocks API access; these
// stories qualify display, accessibility and control boundaries, never trials.
const meta:Meta={title:"Business Intelligence/Business experiments",parameters:{layout:"padded"}};export default meta;type Story=StoryObj;
export const Passed:Story={render:()=> <Result status="pass"/>};
export const Failed:Story={render:()=> <Result status="fail"/>};
export const Inconclusive:Story={render:()=> <Result/>};
export const Invalid:Story={render:()=> <Result status="invalid"/>};
export const Stale:Story={render:()=> <Result status="pass" stale/>};
export const SafetyStop:Story={render:()=> <Result safety/>};
export const Draft:Story={render:()=> <Workspace/>};
export const Ready:Story={render:()=> <Workspace state="ready"/>};
export const Running:Story={render:()=> <Workspace state="running"/>};
export const Completed:Story={render:()=> <Workspace state="completed"/>};
export const Analyzing:Story={render:()=> <Workspace state="analyzing"/>};
export const StoppingControls:Story={render:()=> <Stopping/>};
