import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import type {DecisionEvidenceReference} from "@paperclipai/shared";
import {businessMetricsApi} from "@/api/business-metrics";
import {processAnalysisApi} from "@/api/process-analysis";
import {Button} from "@/components/ui/button";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
export function DecisionEvidencePicker({companyId,userId,value,onChange}:{companyId:string;userId:string|null;value:DecisionEvidenceReference|null;onChange:(value:DecisionEvidenceReference|null)=>void}) {
  const [kind,setKind]=useState<DecisionEvidenceReference["type"]>(value?.type??"metric_observation");
  const [ownerId,setOwnerId]=useState(value?.type==="metric_observation"?value.metricId:value?.definitionId??"");
  const [runId,setRunId]=useState(value?.type==="process_finding"?value.runId:"");
  const key=["decision-evidence",companyId,userId],account=userId??undefined;
  const metrics=useQuery({queryKey:[...key,"metrics"],queryFn:()=>businessMetricsApi.list(companyId,undefined,account),enabled:kind==="metric_observation",refetchInterval:30000});
  const definitions=useQuery({queryKey:[...key,"process-definitions"],queryFn:()=>processAnalysisApi.list(companyId,undefined,account),enabled:kind==="process_finding",refetchInterval:30000});
  const observations=useQuery({queryKey:[...key,"observations",ownerId],queryFn:()=>businessMetricsApi.observations(companyId,ownerId,undefined,account),enabled:kind==="metric_observation"&&!!ownerId,refetchInterval:30000});
  const runs=useQuery({queryKey:[...key,"runs",ownerId],queryFn:()=>processAnalysisApi.listRuns(companyId,ownerId,undefined,account),enabled:kind==="process_finding"&&!!ownerId,refetchInterval:30000});
  const findings=useQuery({queryKey:[...key,"findings",ownerId,runId],queryFn:()=>processAnalysisApi.listFindings(companyId,ownerId,runId,undefined,account),enabled:kind==="process_finding"&&!!ownerId&&!!runId,refetchInterval:30000});
  const queries=kind==="metric_observation"?[metrics,...(ownerId?[observations]:[])]:[definitions,...(ownerId?[runs]:[]),...(runId?[findings]:[])];
  const unavailable=queries.some(query=>query.isFetching||query.isError),error=queries.find(query=>query.isError)?.error;
  const options:{ref:DecisionEvidenceReference;label:string}[]=[];
  if(!unavailable && kind==="metric_observation") for(const row of observations.data?.items??[]) if(Date.parse(row.expiresAt)>Date.now()) options.push({ref:{type:kind,id:row.id,metricId:row.metricId,metricVersionId:row.versionId},label:`${row.from.slice(0,10)} to ${row.until.slice(0,10)} · ${row.status}`});
  if(!unavailable && kind==="process_finding") for(const row of findings.data?.items??[]) if(Date.parse(row.expiresAt)>Date.now()) options.push({ref:{type:kind,id:row.id,definitionId:row.definitionId,runId:row.analysisRunId},label:row.summary});
  return <fieldset className="min-w-0 space-y-3"><legend className="font-medium">Native decision evidence</legend>
    <label className="block space-y-2">Evidence kind<select aria-label="Evidence kind" className={selectStyle} value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setOwnerId("");setRunId("");onChange(null);}}><option value="metric_observation">Metric observation</option><option value="process_finding">Process finding</option></select></label>
    <label className="block space-y-2">{kind==="metric_observation"?"Published metric":"Published process definition"}<select aria-label={kind==="metric_observation"?"Published metric":"Published process definition"} className={selectStyle} value={ownerId} onChange={event=>{setOwnerId(event.target.value);setRunId("");onChange(null);}}><option value="">Choose a native definition</option>{!unavailable && (kind==="metric_observation"?metrics.data?.items.filter(row=>row.status==="published").map(row=><option key={row.id} value={row.id}>{row.key}</option>):definitions.data?.items.filter(row=>row.status==="published").map(row=><option key={row.id} value={row.id}>{row.definition.name}</option>))}</select></label>
    {kind==="process_finding"&&ownerId&&<label className="block space-y-2">Observed process run<select aria-label="Observed process run" className={selectStyle} value={runId} onChange={event=>{setRunId(event.target.value);onChange(null);}}><option value="">Choose an authorized run</option>{!unavailable&&runs.data?.items.filter(row=>Date.parse(row.expiresAt)>Date.now()).map(row=><option key={row.id} value={row.id}>{row.from.slice(0,10)} to {row.until.slice(0,10)} · {row.result.status}</option>)}</select></label>}
    <label className="block space-y-2">Pinned evidence<select aria-label="Pinned evidence" className={selectStyle} value={value?JSON.stringify(value):""} onChange={event=>onChange(options.find(option=>JSON.stringify(option.ref)===event.target.value)?.ref??null)}><option value="">Choose current native evidence</option>{value&&!options.some(option=>JSON.stringify(option.ref)===JSON.stringify(value))&&<option value={JSON.stringify(value)}>Previously pinned evidence · review current source</option>}{options.map(option=><option key={JSON.stringify(option.ref)} value={JSON.stringify(option.ref)}>{option.label}</option>)}</select></label>
    {queries.some(query=>query.isFetching)&&<p role="status">Rechecking current native sources…</p>}{error&&<p role="alert">{error.message}</p>}
    <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" onClick={()=>queries.forEach(query=>void query.refetch())}>Refresh evidence</Button><p className="text-sm text-muted-foreground">Bounded authorized choices. An empty page does not establish missing evidence.</p></div>
  </fieldset>;
}
