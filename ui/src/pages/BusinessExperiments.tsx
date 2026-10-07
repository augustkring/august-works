import { useState,useEffect,useCallback } from "react";
import { useInfiniteQuery,useIsFetching,useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import { v7FeatureEnabled,v8FeatureEnabled,type BusinessExperimentDefinition } from "@paperclipai/shared";
import { businessExperimentsApi } from "@/api/business-experiments";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card,CardHeader,CardContent } from "@/components/ui/card";
import { BusinessExperimentDefinitionForm } from "@/components/BusinessExperimentDefinitionForm";
import { BusinessExperimentRecordingControls } from "@/components/BusinessExperimentRecordingControls";
import { BusinessExperimentSafetyControls } from "@/components/BusinessExperimentSafetyControls";
import { BusinessExperimentResult } from "@/components/BusinessExperimentResult";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
export function BusinessExperiments(){
 const {selectedCompanyId}=useCompany(),{userId,settled,failed}=useAccountIdentity(),{setBreadcrumbs}=useBreadcrumbs();
 const verifying=useIsFetching({queryKey:queryKeys.auth.session})>0;
 const flags=useQuery({queryKey:[...queryKeys.instance.experimentalSettings,"business-experiments",userId],queryFn:()=>instanceSettingsApi.getExperimental(),enabled:!!selectedCompanyId&&settled&&!failed&&!verifying,refetchOnWindowFocus:false,retry:false});
 useEffect(()=>setBreadcrumbs([{label:"Business experiments"}]),[setBreadcrumbs]);
 if(failed)return <p role="alert">Your account could not be verified. Reload this page.</p>;
 if(!settled||verifying)return <p role="status">Verifying current account…</p>;
 if(!selectedCompanyId)return <p>Select a company to review business experiments.</p>;
 if(flags.isFetching)return <p role="status">Rechecking experiment availability…</p>;
 if(flags.isError||!flags.data||!v8FeatureEnabled(flags.data,"business_experiments_v8")||!v7FeatureEnabled(flags.data,"governance_evidence_v7"))return <div className="space-y-6"><p role={flags.isError?"alert":"status"}>{flags.isError?"Experiment availability could not be established.":"Governed business experiment recording is not enabled."}</p><BusinessExperimentSafetyControls key={`${selectedCompanyId}:${userId}`} companyId={selectedCompanyId} userId={userId}/></div>;
 return <BusinessExperimentWorkspace key={`${selectedCompanyId}:${userId}`} companyId={selectedCompanyId} userId={userId}/>;
}
export function BusinessExperimentWorkspace({companyId,userId}:{companyId:string;userId:string|null}){
 const cache=useQueryClient(),key=["business-experiments",companyId,userId],account=userId??undefined;
 const [id,setId]=useState(""),[versionId,setVersionId]=useState(""),[editing,setEditing]=useState(false),[recordingReviewing,setRecordingReviewing]=useState(false),[now,setNow]=useState(Date.now());
 const reviewing=editing||recordingReviewing,interval=reviewing?false:30000;
 const list=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>businessExperimentsApi.list(companyId,pageParam,account),getNextPageParam:p=>p.nextCursor??undefined,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const detail=useQuery({queryKey:[...key,"detail",id],queryFn:()=>businessExperimentsApi.detail(companyId,id,account),enabled:!!id,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const chosenVersionId=versionId||detail.data?.experiment.currentVersionId||"";
 const receiptQuery=useQuery({queryKey:[...key,"receipts",id,chosenVersionId],queryFn:()=>businessExperimentsApi.receipts(companyId,id,chosenVersionId,account),enabled:!!id&&!!chosenVersionId&&!detail.isError,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const retained=(expiry:string)=>Date.parse(expiry)>Math.max(now,Date.now());
 const root=!list.isFetching&&!list.isError&&!detail.isFetching&&!detail.isError&&detail.data?.experiment.companyId===companyId&&detail.data.experiment.id===id?detail.data.experiment:undefined;
 const pins=root?detail.data?.versions.filter(v=>v.companyId===companyId&&v.experimentId===id&&retained(v.expiresAt))??[]:[],pin=pins.find(p=>p.id===chosenVersionId);
 const receiptData=receiptQuery.data;
 const receipts=root&&pin&&!receiptQuery.isFetching&&!receiptQuery.isError&&receiptData?.versionId===pin.id&&receiptData.assignments.every(a=>a.companyId===companyId&&a.experimentId===id&&a.versionId===pin.id)&&receiptData.exposures.every(e=>e.companyId===companyId&&e.experimentId===id&&e.versionId===pin.id)&&(!receiptData.analysis||receiptData.analysis.companyId===companyId&&receiptData.analysis.experimentId===id&&receiptData.analysis.versionId===pin.id)?receiptData:undefined;
 const receiptIdentityMismatch=!!root&&!!pin&&!receiptQuery.isFetching&&!receiptQuery.isError&&!!receiptData&&!receipts;
 const hideSensitive=useCallback(()=>{setEditing(false);setId("");setVersionId("");setRecordingReviewing(false);cache.removeQueries({queryKey:["experiment-definition-sources",companyId,userId]});cache.removeQueries({queryKey:["experiment-unit-sources",companyId,userId]});},[cache,companyId,userId]);
 const revoke=useCallback(()=>{hideSensitive();void cache.resetQueries({queryKey:["business-experiments",companyId,userId]});},[hideSensitive,cache,companyId,userId]);
 const refresh=()=>{setEditing(false);setRecordingReviewing(false);void cache.invalidateQueries({queryKey:key});void cache.invalidateQueries({queryKey:["experiment-unit-sources",companyId,userId]});};
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);window.addEventListener("memory-access-changed",revoke);return()=>{window.clearInterval(timer);window.removeEventListener("memory-access-changed",revoke);};},[revoke]);
 useEffect(()=>{if(list.isError||detail.isError||receiptQuery.isError)hideSensitive();},[list.isError,detail.isError,receiptQuery.isError,hideSensitive]);
 const save=useMutation({mutationFn:(input:{key:string;definition:BusinessExperimentDefinition;reason:string})=>root?businessExperimentsApi.amend(companyId,root.id,{expectedRevision:root.revision,definition:input.definition,reason:input.reason},account):businessExperimentsApi.create(companyId,{key:input.key,definition:input.definition},account),onSuccess:v=>{setId(v.experiment.id);setVersionId(v.version.id);refresh();},onError:revoke});
 const rows=!list.isFetching&&!list.isError?list.data?.pages.flatMap(p=>p.items).filter(r=>r.experiment.companyId===companyId&&r.version.companyId===companyId&&retained(r.version.expiresAt))??[]:[];
 const error=list.error||detail.error||receiptQuery.error||save.error,canAmend=root&&pin&&root.currentVersionId===pin.id&&["draft","in_review","ready"].includes(root.state);
 return <div className="min-w-0 space-y-6"><header className="space-y-2"><h1 className="text-xl font-semibold">Business experiments</h1><p className="text-muted-foreground">Preregister a process question and safety limits, record exact native allocations and human exposure reports, then interpret one final result.</p></header>
 {error&&<div role="alert" className="space-y-2"><p>Current experiment authority or revision could not be established. Sensitive drafts and dependent results have been withheld.</p><Button variant="outline" onClick={revoke}>Recheck experiment authority</Button></div>}
 {receiptIdentityMismatch&&<p role="alert">Exact receipt identity could not be established. The dependent protocol and result are withheld; refresh current authority.</p>}
 {list.isFetching&&<p role="status">Rechecking current experiment authority…</p>}
 <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={save.isPending||list.isFetching} onClick={()=>{setId("");setVersionId("");setEditing(true);}}>Preregister an experiment</Button><Button variant="ghost" disabled={save.isPending} onClick={refresh}>Refresh experiments</Button></div>
 <label className="block space-y-2">Experiment<select aria-label="Experiment" className={selectStyle} value={id} disabled={save.isPending||editing} onChange={e=>{setId(e.target.value);setVersionId("");setEditing(false);setRecordingReviewing(false);}}><option value="">Choose an authorized protocol</option>{rows.map(r=><option key={r.experiment.id} value={r.experiment.id}>{r.version.definition.name} · {r.experiment.state.replaceAll("_"," ")}</option>)}</select></label>
 {list.hasNextPage&&<Button variant="outline" disabled={list.isFetching||save.isPending} onClick={()=>void list.fetchNextPage()}>Load more experiments</Button>}
 {id&&(detail.isFetching||receiptQuery.isFetching)&&<p role="status">Rechecking retained protocol and receipt authority…</p>}
 {root&&pin&&receipts&&<Card className="min-w-0"><CardHeader><h2 className="font-semibold">{pin.definition.name}</h2><p>Current lifecycle: {root.state.replaceAll("_"," ")}{root.currentVersionId!==pin.id?" · historical protocol selected":""}</p></CardHeader><CardContent className="min-w-0 space-y-4">
  <section aria-label="Registered hypothesis and primary safety policy" className="space-y-3"><h3 className="font-medium">Hypothesis</h3><p>{pin.definition.hypothesis}</p><p>{pin.definition.decisionQuestion}</p><h3 className="font-medium">Primary metric</h3><p>{pin.definition.primaryMetric.name} · meaningful {pin.definition.primaryMetric.beneficialDirection}: {pin.definition.primaryMetric.minimumMeaningfulEffect*100} percentage points.</p><h3 className="font-medium">Guardrails</h3><ul className="list-disc space-y-2 pl-5">{pin.definition.guardrailMetrics.map(m=><li key={m.key}>{m.name} · acceptable {m.harmfulDirection} harm at most {m.maximumAcceptableHarm*100} percentage points.</li>)}</ul><h3 className="font-medium">What is assigned and exposed</h3><p>{pin.definition.population.randomizationUnit} · {pin.definition.population.eligibility}</p><p>Treatment: {pin.definition.treatment}</p><p>Control: {pin.definition.control}</p><p>Exposure provenance: human attestation. {receipts.assignments.length} assigned units · {receipts.exposures.length} exposure reports. Allocating labels dispatches no work.</p></section>
  <label className="block space-y-2">Protocol version<select aria-label="Protocol version" className={selectStyle} value={pin.id} disabled={save.isPending||editing||recordingReviewing} onChange={e=>setVersionId(e.target.value)}>{pins.map(v=><option key={v.id} value={v.id}>Version {v.revision}{root.currentVersionId===v.id?" · current protocol":" · retained proposal"} · {v.currentQualification.replaceAll("_"," ")}</option>)}</select></label>
  <p>Registered UTC period: {pin.definition.sampleOrDurationPlan.from} to {pin.definition.sampleOrDurationPlan.until}. Final capture deadline: {pin.definition.analysisPlan.finalCaptureMaxDelaySeconds} seconds after horizon.</p>
  {pin.currentQualification==="needs_revalidation"&&<p role="status">Current source definitions changed. The original protocol is retained; new reliance requires explicit revalidation.</p>}
  {canAmend&&!editing&&<Button variant="outline" disabled={save.isPending} onClick={()=>setEditing(true)}>Amend unstarted protocol</Button>}
  {!editing&&root.currentVersionId===pin.id&&["draft","in_review","ready","running","paused","completed"].includes(root.state)&&<BusinessExperimentRecordingControls key={`${pin.id}:${root.revision}`} companyId={companyId} userId={userId} root={root} version={pin} receipts={receipts} now={now} onChanged={refresh} onAuthorityLost={revoke} onReviewingChange={setRecordingReviewing}/>}
  <details><summary className="cursor-pointer">Inspect registered assumptions and review history</summary><div className="space-y-3 pt-3 text-sm"><p>{pin.definition.population.externalValidityLimits}</p><p>{pin.definition.sampleOrDurationPlan.powerRationale}</p><p>{pin.definition.diagnostics.concurrentExperimentAndInterferencePlan}</p><p>{pin.definition.diagnostics.telemetryAndJoinPlan}</p><p>{pin.definition.analysisPlan.noveltySeasonalityCarryoverLimits}</p><p>Owner {pin.definition.ownerUserId} · source retention until {new Date(pin.expiresAt).toLocaleString()}.</p><p>At most five retained versions and 100 transitions are shown.</p>{detail.data?.transitions.filter(t=>t.versionId===pin.id).map(t=><p key={t.id}>{t.fromState.replaceAll("_"," ")} → {t.toState.replaceAll("_"," ")} · {new Date(t.createdAt).toLocaleString()} · {t.rationale}</p>)}<p className="break-all">Definition {pin.contentHash}</p></div></details>
 </CardContent></Card>}
 {editing&&(!id||root&&pin&&receipts)&&<BusinessExperimentDefinitionForm key={id?pin?.id:"new"} companyId={companyId} userId={userId} initial={id?pin?.definition:undefined} initialPins={id?pin?.metricPins:undefined} experimentKey={root?.key} busy={save.isPending} onSave={input=>save.mutate(input)} onCancel={()=>setEditing(false)} onAuthorityLost={revoke}/>}
 {root&&pin&&receipts?.analysis&&<BusinessExperimentResult analysis={receipts.analysis} definition={pin.definition} interpretation={receipts.interpretation}/>}
 {!editing&&root&&pin&&receipts?.analysis&&root.currentVersionId===pin.id&&root.state==="analyzing"&&<Card><CardContent className="pt-6"><BusinessExperimentRecordingControls key={`${pin.id}:${root.revision}`} companyId={companyId} userId={userId} root={root} version={pin} receipts={receipts} now={now} onChanged={refresh} onAuthorityLost={revoke} onReviewingChange={setRecordingReviewing}/></CardContent></Card>}
 {!list.isFetching&&!list.isError&&!rows.length&&!editing&&<p>No authorized experiments were returned on this bounded page. Review an approved experiment purpose in <Link to="/ai-governance">AI Governance</Link> before preregistering.</p>}
 <details><summary className="cursor-pointer">Active recording stop controls</summary><div className="pt-4"><BusinessExperimentSafetyControls companyId={companyId} userId={userId}/></div></details>
 </div>;
}
