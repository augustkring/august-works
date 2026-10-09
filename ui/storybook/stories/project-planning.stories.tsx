import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { instanceExperimentalSettingsSchema } from "@paperclipai/shared";
import { ProjectPlanningWorkspace } from "@/components/ProjectAdaptivePlanning";
import { ProjectPlanningResult } from "@/components/ProjectPlanningResult";
import { queryKeys } from "@/lib/queryKeys";
import { planningFixture } from "./project-planning-fixtures";
function Workspace({stale=false,disabled=false,accepted=false}:{stale?:boolean;disabled?:boolean;accepted?:boolean}){
 const f=planningFixture(stale),[client]=useState(()=>{const q=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false},mutations:{retry:false}}}),key=["project-adaptive-planning",f.companyId,f.projectId,f.userId];
 q.setQueryData([...queryKeys.instance.experimentalSettings,"project-planning",f.userId],disabled?instanceExperimentalSettingsSchema.parse({}):f.flags);
 q.setQueryData([...key,"source"],f.roadmap);q.setQueryData([...key,"detail",f.id],accepted?{...f.detail,status:"accepted",currentQualification:"needs_revalidation"}:f.detail);q.setQueryData(["project-planning-controls",f.companyId,f.projectId,f.userId],{pages:[{proposals:[{id:f.id,status:accepted?"accepted":"pending"}],hasMore:false,nextCursor:null}],pageParams:[undefined]});q.setQueryData(["planning-definition-sources",f.companyId,f.userId,"purpose"],[f.policy]);return q;});
 return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><ProjectPlanningWorkspace companyId={f.companyId} projectId={f.projectId} userId={f.userId}/></div></QueryClientProvider>;
}
function Result({state}:{state:"inconclusive"|"infeasible"}){const f=planningFixture();f.result.status=state;f.result.schedule=[];f.result.criticalPath=null;f.result.diagnostics=[{code:state==="inconclusive"?"unknown_duration":"existing_capacity_overcommit",taskKeys:[f.taskId],poolKeys:[]}];return <div className="mx-auto w-full max-w-3xl"><ProjectPlanningResult result={f.result} horizonStart={f.profile.horizon.start} taskLabels={{[f.taskId]:f.roadmap.tasks[0].title}}/></div>;}
// Synthetic cached presentation; browser qualification aborts every API request.
const meta:Meta={title:"Business Intelligence/Project planning",parameters:{layout:"padded"}};export default meta;type Story=StoryObj;
export const Current:Story={render:()=> <Workspace/>};
export const Accepted:Story={render:()=> <Workspace accepted/>};
export const Retained:Story={render:()=> <Workspace stale/>};
export const Disabled:Story={render:()=> <Workspace disabled/>};
export const Inconclusive:Story={render:()=> <Result state="inconclusive"/>};
export const Infeasible:Story={render:()=> <Result state="infeasible"/>};
