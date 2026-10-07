import {useEffect,useRef,useState} from "react";
import {useIsFetching,useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {v7FeatureEnabled,v8FeatureEnabled,type DecisionContextVersionView} from "@paperclipai/shared";
import {useCompany} from "@/context/CompanyContext";
import {useAccountIdentity} from "@/api/companies-query";
import {instanceSettingsApi} from "@/api/instanceSettings";
import {decisionIntelligenceApi} from "@/api/decision-intelligence";
import type {Decision} from "@/api/decisions";
import {DecisionContextForm} from "./DecisionContextForm";
import {DecisionOutcomeReviewPanel} from "./DecisionOutcomeReviewPanel";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Card,CardContent,CardHeader} from "@/components/ui/card";
import {queryKeys} from "@/lib/queryKeys";

export function DecisionContextPanel({decision}:{decision:Decision}) {
  const {selectedCompanyId}=useCompany();
  // Do not mount account/evidence readers for a stale native Decision container.
  if(selectedCompanyId!==decision.companyId) return null;
  return <AccountGate key={`${selectedCompanyId}:${decision.id}`} decision={decision}/>;
}
function AccountGate({decision}:{decision:Decision}) {
  const {userId,settled,failed}=useAccountIdentity();
  const verifying=useIsFetching({queryKey:queryKeys.auth.session})>0;
  const flags=useQuery({queryKey:[...queryKeys.instance.experimentalSettings,"decision-context",userId],queryFn:()=>instanceSettingsApi.getExperimental(),enabled:settled&&!failed&&!verifying,refetchOnWindowFocus:false});
  if(!settled||failed||verifying||flags.isFetching||flags.isError||!flags.data||!v8FeatureEnabled(flags.data,"decision_intelligence_v8")||!v7FeatureEnabled(flags.data,"governance_evidence_v7")) return null;
  return <DecisionContextWorkspace key={`${decision.companyId}:${userId??"local"}:${decision.id}`} decision={decision} userId={userId}/>;
}
function VersionDetails({pin,decision}:{pin:DecisionContextVersionView;decision:Decision}) {
  const label=(id:string)=>decision.options.find(option=>option.id===id)?.label??"Previously declared option";
  const factLabel=(name:string)=>(({asOf:"Observed at",from:"Window start (inclusive)",until:"Window end (exclusive)"} as Record<string,string>)[name]??name.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," "));
  const factValue=(name:string,value:string|number|null)=>["asOf","from","until"].includes(name)&&typeof value==="string"&&!Number.isNaN(Date.parse(value))?`${new Date(value).toLocaleString(undefined,{timeZone:"UTC"})} UTC`:value??"Not established";
  const definition=pin.definition;
  return <div className="min-w-0 space-y-4">
    <p className="font-medium">{definition.question}</p><p>{definition.objective}</p>
    <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Time horizon</dt><dd>{definition.timeHorizon.from.slice(0,10)} to {definition.timeHorizon.until.slice(0,10)} · UTC</dd></div><div><dt className="text-muted-foreground">Scope</dt><dd>{definition.scope.type}</dd></div></dl>
    <p className="text-sm">Uncertainty: {definition.uncertaintySummary}</p>
    <section aria-label="Captured decision evidence" className="space-y-3"><h4 className="font-medium">Captured evidence</h4>
      {!pin.evidence.length&&<p className="text-sm text-muted-foreground">No quantitative evidence was declared. This context records qualitative human judgment.</p>}
      {pin.evidence.map(item=><div key={item.key} className="space-y-2 rounded-md border border-border p-3"><p className="font-medium">{item.key.replaceAll("_"," ")}</p><p className="text-sm text-muted-foreground">Captured {new Date(item.capturedAt).toLocaleString()} · {item.source.type.replaceAll("_"," ")}</p>
        <dl className="space-y-2 text-sm">{Object.entries(item.facts).filter(([name])=>!/(?:Id|Hash)$/.test(name)).map(([name,value])=><div key={name} className="min-w-0"><dt className="text-muted-foreground">{factLabel(name)}</dt><dd className="break-words">{factValue(name,value)}</dd></div>)}</dl>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{item.limitations.map(item=><li key={item}>{item}</li>)}</ul>
        <details><summary className="cursor-pointer text-sm">Inspect evidence provenance</summary><div className="space-y-2 pt-3 text-sm"><p className="break-all">Native source {item.source.id}</p><p className="break-all">Source hash {item.sourceHash}</p>{Object.entries(item.facts).filter(([name])=>/(?:Id|Hash)$/.test(name)).map(([name,value])=><p key={name} className="break-all">{factLabel(name)}: {value}</p>)}</div></details>
      </div>)}
    </section>
    <section aria-label="Recorded decision assumptions" className="space-y-2"><h4 className="font-medium">Assumptions at proposal</h4>{!definition.assumptions.length&&<p className="text-sm text-muted-foreground">No explicit assumptions were declared.</p>}{definition.assumptions.map(item=><div key={item.key} className="space-y-1"><p>{item.statement}</p><p className="text-sm text-muted-foreground">Human confidence {item.confidence.level} · materiality {item.materiality} · unverified at proposal</p></div>)}</section>
    <section aria-label="Recorded decision criteria" className="space-y-2"><h4 className="font-medium">Criteria</h4>{definition.criteria.map(item=><div key={item.key}><p className="font-medium">{item.name} · {item.priority} priority</p><p className="text-sm">{item.description}</p></div>)}</section>
    <section aria-label="Recorded expected outcomes" className="space-y-3"><h4 className="font-medium">Expected outcomes</h4>{definition.expectedOutcomes.map((item,index)=><div key={index} className="space-y-1"><p className="font-medium">{label(item.optionId)}</p><p>{item.kind==="qualitative"?item.statement:`Human expected range: ${item.expectedRange.lower} to ${item.expectedRange.upper}${item.expectedDirection?` · ${item.expectedDirection}`:""}`}</p><p className="text-sm text-muted-foreground">Review {item.reviewAt.slice(0,10)} · {item.uncertaintySummary}</p></div>)}</section>
    <details><summary className="cursor-pointer">Inspect context provenance</summary><div className="space-y-2 pt-3 text-sm"><p>Version {pin.revision} · created {new Date(pin.createdAt).toLocaleString()} · retained until {new Date(pin.expiresAt).toLocaleString()}</p><p className="break-all">Context hash {pin.contentHash}</p><p className="break-all">Native decision specification {pin.decisionSpecHash}</p></div></details>
  </div>;
}
export function DecisionContextWorkspace({decision,userId}:{decision:Decision;userId:string|null}) {
  const cache=useQueryClient(),key=["decision-context",decision.companyId,userId,decision.id],account=userId??undefined;
  const [editing,setEditing]=useState(false),[rationale,setRationale]=useState(""),[now,setNow]=useState(Date.now());
  const [reviewEditing,setReviewEditing]=useState(false);
  // Background read refresh must not unmount a human's unsaved proposal. Every
  // write still rechecks current authority, and account/privacy events reset it.
  const detail=useQuery({queryKey:key,queryFn:()=>decisionIntelligenceApi.detail(decision.companyId,decision.id,account),refetchInterval:editing||reviewEditing?false:30000,refetchOnWindowFocus:!editing&&!reviewEditing,retry:false});
  const refresh=()=>{void cache.invalidateQueries({queryKey:key});};
  const reauthorize=()=>{setEditing(false);void cache.resetQueries({queryKey:key});};
  const save=useMutation({mutationFn:(definition:DecisionContextVersionView["definition"])=>decisionIntelligenceApi.propose(decision.companyId,decision.id,{expectedRevision:detail.data!.revision,definition},account),onError:reauthorize,onSuccess:()=>{setEditing(false);setRationale("");refresh();}});
  const prepare=useMutation({mutationFn:(versionId:string)=>decisionIntelligenceApi.prepare(decision.companyId,decision.id,{expectedRevision:detail.data!.revision,versionId,rationale},account),onError:reauthorize,onSuccess:()=>{setRationale("");refresh();}});
  const withdraw=useMutation({mutationFn:()=>decisionIntelligenceApi.withdraw(decision.companyId,decision.id,{expectedRevision:detail.data!.revision,rationale},account),onError:reauthorize,onSuccess:()=>{setRationale("");refresh();}});
  const previousChoice=useRef(`${decision.status}:${decision.chosenOptionId}`);
  useEffect(()=>{const choice=`${decision.status}:${decision.chosenOptionId}`;if(choice!==previousChoice.current) {previousChoice.current=choice;refresh();}},[decision.status,decision.chosenOptionId]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);const revoked=()=>{setEditing(false);setRationale("");void cache.resetQueries({queryKey:key});};window.addEventListener("memory-access-changed",revoked);return()=>{window.clearInterval(timer);window.removeEventListener("memory-access-changed",revoked);};},[cache,decision.companyId,decision.id,userId]);
  const mutating=save.isPending||prepare.isPending||withdraw.isPending,error=detail.error??save.error??prepare.error??withdraw.error;
  const data=!detail.isFetching&&!detail.isError?detail.data:undefined;
  const valid=data&&data.companyId===decision.companyId&&data.decisionId===decision.id?data:undefined;
  const retained=valid?.versions.filter(pin=>Date.parse(pin.expiresAt)>Math.max(now,Date.now()))??[];
  const pin=valid?.binding?retained.find(pin=>pin.id===valid.binding!.versionId):retained[0];
  const open=decision.status==="open"&&Date.parse(decision.expiresAt)>Math.max(now,Date.now());
  const reasonValid=rationale.trim().length>=10&&rationale.trim().length<=2000;
  return <Card role="region" aria-label="Decision context" className="min-w-0"><CardHeader><h3 className="font-semibold">Decision context</h3><p className="text-sm text-muted-foreground">What was known, assumed and expected when considering this choice.</p></CardHeader><CardContent className="min-w-0 space-y-5">
    {detail.isFetching&&<p role="status">Rechecking current context authority…</p>}{error&&<div role="alert" className="space-y-2"><p>{error.message}</p><Button variant="outline" onClick={()=>void detail.refetch()}>Recheck context</Button></div>}
    {valid&&<>
      {valid.binding&&pin?<p role="status" className="font-medium">Frozen at the native decision · {new Date(valid.binding.frozenAt).toLocaleString()}</p>:pin?<p className="font-medium">{valid.preparedVersionId===pin.id?"Prepared for the next native choice":"Prospective proposal"}</p>:<p>No retained context is available for this decision.</p>}
      {pin&&<VersionDetails pin={pin} decision={decision}/>}
      {pin?.state==="frozen_for_decision"&&<p className="text-sm text-muted-foreground">Captured facts remain as recorded before the choice. Later observations belong in a separate outcome review.</p>}
      {pin?.state==="frozen_for_decision"&&valid.binding&&<DecisionOutcomeReviewPanel key={`${pin.id}:${userId}`} companyId={decision.companyId} userId={userId} decisionId={decision.id} version={pin} optionId={valid.binding.optionId} chosenAt={valid.binding.frozenAt} onEditingChange={setReviewEditing}/>}
      {valid.hasMoreVersions&&<p className="text-sm text-muted-foreground">Showing bounded recent versions and the frozen binding; this is not a complete-history listing.</p>}
      {retained.length>1&&<details><summary className="cursor-pointer">Earlier context proposals ({retained.length-1})</summary><div className="space-y-5 pt-4">{retained.filter(item=>item.id!==pin?.id).map(item=><section key={item.id} className="space-y-3 border-t border-border pt-4"><h4 className="font-medium">Version {item.revision} · {item.state.replaceAll("_"," ")}</h4><VersionDetails pin={item} decision={decision}/></section>)}</div></details>}
      {open&&<>
        {editing?<DecisionContextForm key={pin?.id??"new"} companyId={decision.companyId} userId={userId} options={decision.options} initial={pin?.definition} busy={mutating} onSave={value=>save.mutate(value)} onCancel={()=>setEditing(false)}/>:<Button variant="outline" disabled={mutating} onClick={()=>setEditing(true)}>{pin?"Propose a context revision":"Propose decision context"}</Button>}
        {!editing&&(pin||valid.preparedVersionId)&&<section aria-label="Human context preparation" className="space-y-3"><h4 className="font-medium">Human context review</h4><label className="block space-y-2">Review rationale<Textarea value={rationale} onChange={event=>setRationale(event.target.value)} minLength={10} maxLength={2000} disabled={mutating}/></label><div className="flex flex-wrap gap-2">
          {pin&&!valid.preparedVersionId&&<Button disabled={!reasonValid||mutating} onClick={()=>prepare.mutate(pin.id)}>Prepare this context</Button>}
          {valid.preparedVersionId&&<Button variant="outline" disabled={!reasonValid||mutating} onClick={()=>withdraw.mutate()}>Withdraw prepared context</Button>}
        </div><p className="text-sm text-muted-foreground">Preparation records human review. The existing decision controls choose the option and execute its native effects.</p></section>}
      </>}
    </>}
  </CardContent></Card>;
}
