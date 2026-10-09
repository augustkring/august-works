import { useEffect } from "react";
import { useInfiniteQuery,useQuery } from "@tanstack/react-query";
import { ISSUE_STATUSES,PROJECT_STATUSES,type BusinessExperimentDefinition } from "@paperclipai/shared";
import { businessMetricsApi } from "@/api/business-metrics";
import { Button } from "@/components/ui/button";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
/** Selecting a current native definition pins its version. Retained initial
 * versions are never silently rebound when the published definition changes. */
export function BusinessExperimentMetricPicker({companyId,userId,label,value,population,scope,onChange,onValidity,onAuthorityLost,disabled=false}:{
 companyId:string;userId:string|null;label:string;value:{metricId:string;metricVersionId:string};population:"issue"|"project";scope:BusinessExperimentDefinition["scope"];
 onChange:(pin:{metricId:string;metricVersionId:string;name?:string})=>void;onValidity:(valid:boolean)=>void;disabled?:boolean;onAuthorityLost?:()=>void;
}){
 const account=userId??undefined,key=["experiment-definition-sources",companyId,userId];
 const list=useInfiniteQuery({queryKey:[...key,"metrics"],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>businessMetricsApi.list(companyId,pageParam,account),getNextPageParam:page=>page.nextCursor??undefined,refetchInterval:30000,retry:false});
 const detail=useQuery({queryKey:[...key,"metric",value.metricId],queryFn:()=>businessMetricsApi.detail(companyId,value.metricId,account),enabled:!!value.metricId,refetchInterval:30000,retry:false});
 useEffect(()=>{if(list.isError||detail.isError)onAuthorityLost?.();},[list.isError,detail.isError,onAuthorityLost]);
 const unavailable=list.isFetching||list.isError||list.isPending||!!value.metricId&&(detail.isFetching||detail.isError||detail.isPending);
 const source=!unavailable&&detail.data?.metric.companyId===companyId&&detail.data.metric.id===value.metricId&&detail.data.metric.status==="published"?detail.data:undefined;
 const pin=source?.versions.find(v=>v.id===source.metric.publishedVersionId&&v.companyId===companyId&&v.metricId===value.metricId),definition=pin?.definition;
 const calculation=definition?.calculation,statuses=population==="issue"?ISSUE_STATUSES:PROJECT_STATUSES;
 const eligible=!!pin&&definition?.authorityMode==="aw_native"&&definition.grain===population&&calculation?.kind==="native_ratio"&&calculation.denominator.statuses.length===statuses.length&&statuses.every(s=>(calculation.denominator.statuses as readonly string[]).includes(s))&&(population==="project"?scope.type==="company":calculation.denominator.entity==="issue"&&calculation.denominator.projectId===(scope.type==="project"?scope.id:null));
 const valid=!unavailable&&eligible&&value.metricVersionId===pin?.id;
 useEffect(()=>{if(eligible&&pin&&!value.metricVersionId)onChange({metricId:value.metricId,metricVersionId:pin.id,name:pin.definition.name});onValidity(valid);},[eligible,pin,value.metricId,value.metricVersionId,valid,onChange,onValidity]);
 const rows=!unavailable?list.data?.pages.flatMap(p=>p.items).filter(m=>m.companyId===companyId&&m.status==="published")??[]:[];
 return <div className="min-w-0 space-y-2"><label className="block space-y-2">{label}<select aria-label={label} className={selectStyle} value={value.metricId} disabled={disabled||unavailable} onChange={e=>onChange({metricId:e.target.value,metricVersionId:""})} required><option value="">Choose a published native metric</option>{rows.map(m=><option key={m.id} value={m.id}>{m.key}</option>)}</select></label>
 {list.hasNextPage&&<Button type="button" variant="outline" disabled={disabled||list.isFetching} onClick={()=>void list.fetchNextPage()}>Load more metrics for {label.toLowerCase()}</Button>}
 {unavailable&&<p role="status">Rechecking current measurement authority…</p>}
 {source&&definition&&<p className="text-sm">{definition.name} · {definition.grain} · published version {pin?.revision}.</p>}
 {!unavailable&&value.metricId&&!eligible&&<p role="alert">This measure must use a native binary ratio with every registered status in the denominator and the same population scope.</p>}
 {!unavailable&&eligible&&value.metricVersionId&&value.metricVersionId!==pin?.id&&<p role="alert">The published definition changed. Select the reviewed measure again to explicitly pin its current version.</p>}
 {(list.isError||detail.isError)&&<p role="alert">Current measurement authority could not be established.</p>}
 </div>;
}
