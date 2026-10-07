import { useEffect } from "react";
import { useInfiniteQuery,useQuery } from "@tanstack/react-query";
import type { Project,BusinessExperimentDefinition,BusinessExperimentAssignmentView } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
export function BusinessExperimentUnitPicker({companyId,userId,versionId,definition,assignments,mode,value,onChange,onValidity,onAuthorityLost,disabled=false}:{companyId:string;userId:string|null;versionId:string;definition:BusinessExperimentDefinition;assignments:BusinessExperimentAssignmentView[];mode:"assign"|"exposure";value:string;onChange:(id:string)=>void;onValidity:(v:boolean)=>void;onAuthorityLost:()=>void;disabled?:boolean}){
 const entity=definition.population.randomizationUnit,key=["experiment-unit-sources",companyId,userId,versionId],plan=definition.sampleOrDurationPlan;
 const issues=useInfiniteQuery({queryKey:[...key,"issues",definition.scope],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>issuesApi.list(companyId,{limit:100,sortField:"id",sortDir:"asc",afterId:pageParam,...(definition.scope.type==="project"?{projectId:definition.scope.id}:{})},{cache:"no-store"}),getNextPageParam:page=>page.length===100?page[page.length-1].id:undefined,enabled:entity==="issue",refetchInterval:30000,retry:false});
 const projects=useQuery({queryKey:[...key,"projects"],queryFn:()=>api.get<Project[]>(`/companies/${encodeURIComponent(companyId)}/projects`,{cache:"no-store"}),enabled:entity==="project",refetchInterval:30000,retry:false});
 const pending=entity==="issue"?issues.isFetching||issues.isPending:projects.isFetching||projects.isPending,error=entity==="issue"?issues.isError:projects.isError;
 const eligible=(unit:{id:string;companyId:string;createdAt:string|Date})=>unit.companyId===companyId&&(unit.createdAt instanceof Date?unit.createdAt.getTime():Date.parse(unit.createdAt))>=Date.parse(plan.from)&&(unit.createdAt instanceof Date?unit.createdAt.getTime():Date.parse(unit.createdAt))<Date.parse(plan.until)&&(mode==="assign"?!assignments.some(a=>a.unitId===unit.id):assignments.some(a=>a.unitId===unit.id));
 const rows=!pending&&!error?(entity==="issue"?issues.data?.pages.flatMap(p=>p).filter(i=>!i.hiddenAt&&eligible(i)).map(i=>({id:i.id,label:`${i.identifier??"Issue"} · ${i.title}`}))??[]:projects.data?.filter(p=>!p.archivedAt&&eligible(p)).map(p=>({id:p.id,label:p.name}))??[]):[];
 const valid=!!value&&rows.some(r=>r.id===value)&&!pending&&!error;
 useEffect(()=>onValidity(valid),[valid,onValidity]);useEffect(()=>{if(error)onAuthorityLost();},[error,onAuthorityLost]);
 const label=mode==="assign"?"Eligible native unit":"Assigned native unit";
 return <div className="min-w-0 space-y-2"><label className="block space-y-2">{label}<select aria-label={label} className={selectStyle} value={value} disabled={disabled||pending||error} onChange={e=>onChange(e.target.value)}><option value="">Choose an authorized {entity}</option>{rows.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
 {pending&&<p role="status">Rechecking native unit access…</p>}{error&&<p role="alert">Native unit access could not be established.</p>}
 {entity==="issue"&&issues.hasNextPage&&<Button type="button" variant="outline" disabled={disabled||issues.isFetching} onClick={()=>void issues.fetchNextPage()}>Load more native units</Button>}
 {!pending&&!error&&rows.length===0&&<p className="text-sm text-muted-foreground">No matching units were returned on this bounded source view. Eligibility and registered population limits still require human review.</p>}
 </div>;
}
