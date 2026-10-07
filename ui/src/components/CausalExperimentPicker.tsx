import {useState,useEffect} from "react";
import {useInfiniteQuery,useQuery} from "@tanstack/react-query";
import type {CausalExperimentReference,BusinessExperimentDefinition} from "@paperclipai/shared";
import {businessExperimentsApi} from "@/api/business-experiments";
import {Button} from "./ui/button";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
export function CausalExperimentPicker({companyId,userId,value,onChange,onValidity,onAuthorityLost}:{companyId:string;userId:string|null;value:CausalExperimentReference|null;onChange:(ref:CausalExperimentReference|null,definition?:BusinessExperimentDefinition)=>void;onValidity:(valid:boolean)=>void;onAuthorityLost:()=>void}){
 const [id,setId]=useState(value?.experimentId??""),[versionId,setVersionId]=useState(value?.versionId??"");
 const key=["causal-definition-sources",companyId,userId,"experiments"],account=userId??undefined;
 const list=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>businessExperimentsApi.list(companyId,pageParam,account),getNextPageParam:p=>p.nextCursor??undefined,refetchInterval:30000,retry:false});
 const detail=useQuery({queryKey:[...key,"detail",id],queryFn:()=>businessExperimentsApi.detail(companyId,id,account),enabled:!!id,refetchInterval:30000,retry:false});
 const selectedVersionId=versionId||detail.data?.experiment.currentVersionId||"";
 const receipts=useQuery({queryKey:[...key,"receipts",id,selectedVersionId],queryFn:()=>businessExperimentsApi.receipts(companyId,id,selectedVersionId,account),enabled:!!id&&!!selectedVersionId&&!detail.isError,refetchInterval:30000,retry:false});
 const unavailable=list.isFetching||list.isPending||list.isError||!!id&&(detail.isFetching||detail.isPending||detail.isError||receipts.isFetching||receipts.isPending||receipts.isError);
 const root=!unavailable&&detail.data?.experiment.companyId===companyId&&detail.data.experiment.id===id?detail.data.experiment:undefined;
 const pins=root?detail.data?.versions.filter(v=>v.companyId===companyId&&v.experimentId===id&&v.currentQualification==="current"&&Date.parse(v.expiresAt)>Date.now())??[]:[];
 const pin=pins.find(p=>p.id===selectedVersionId),source=receipts.data,analysis=source?.analysis,interpretation=source?.interpretation;
 const admitted=!!root&&!!pin&&source?.currentQualification==="current"&&source.versionId===pin.id&&analysis?.companyId===companyId&&analysis.experimentId===id&&analysis.versionId===pin.id&&analysis.currentQualification==="current"&&!!interpretation&&interpretation.analysisId===analysis.id;
 const valid=!value?!id&&!unavailable:admitted&&value.experimentId===id&&value.versionId===pin?.id&&value.id===analysis?.id&&value.interpretationId===interpretation?.id;
 useEffect(()=>onValidity(valid),[valid,onValidity]);
 useEffect(()=>{if(list.isError||detail.isError||receipts.isError)onAuthorityLost();},[list.isError,detail.isError,receipts.isError,onAuthorityLost]);
 const rows=!unavailable?list.data?.pages.flatMap(p=>p.items).filter(r=>r.experiment.companyId===companyId&&r.version.companyId===companyId&&Date.parse(r.version.expiresAt)>Date.now())??[]:[];
 return <section aria-label="Exact interpreted experiment source" className="space-y-3"><h3 className="font-medium">Interpreted experiment source</h3><p>Choose an exact human-interpreted result. Pinning it copies the registered primary endpoint, population, period and meaningful-effect threshold.</p><label className="block space-y-2">Source experiment<select aria-label="Source experiment" className={selectStyle} value={id} disabled={unavailable} onChange={e=>{setId(e.target.value);setVersionId("");if(!e.target.value)onChange(null);}}><option value="">Question without an experiment result</option>{rows.map(r=><option key={r.experiment.id} value={r.experiment.id}>{r.version.definition.name}</option>)}</select></label>
 {list.hasNextPage&&<Button type="button" variant="outline" disabled={unavailable} onClick={()=>void list.fetchNextPage()}>Load more source experiments</Button>}
 {root&&<label className="block space-y-2">Source protocol version<select aria-label="Source protocol version" className={selectStyle} value={selectedVersionId} disabled={unavailable} onChange={e=>setVersionId(e.target.value)}>{pins.map(v=><option key={v.id} value={v.id}>Registered version {v.revision}</option>)}</select></label>}
 {unavailable&&<p role="status">Rechecking exact experiment source authority…</p>}
 {!unavailable&&id&&!admitted&&<p role="status">This version has no current, exact human-interpreted analysis. No causal estimate can be admitted from it.</p>}
 {admitted&&pin&&analysis&&interpretation&&<><p>Registered primary: {pin.definition.primaryMetric.name} · {analysis.result.status}. Human interpretation: {interpretation.conclusion.replaceAll("_"," ")}. Exposure is human-attested; the outcome is a native process proxy.</p><Button type="button" variant="outline" onClick={()=>onChange({type:"experiment_analysis",id:analysis.id,experimentId:id,versionId:pin.id,interpretationId:interpretation.id},pin.definition)}>Pin exact interpreted analysis</Button></>}
 {value&&valid&&<p role="status">Exact interpreted analysis is pinned. Source conditions still determine whether estimation is admitted.</p>}
 {!id&&<p>The question may be recorded and reviewed without experiment evidence. Its native analysis will abstain.</p>}
 </section>;
}
