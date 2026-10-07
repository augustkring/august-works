import {useState,useEffect,useCallback} from "react";
import {useInfiniteQuery,useIsFetching,useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {v7FeatureEnabled,v8FeatureEnabled,type CausalClaimDefinition,type CausalClaimView} from "@paperclipai/shared";
import {causalClaimsApi,type CausalDetail} from "@/api/causal-claims";
import {instanceSettingsApi} from "@/api/instanceSettings";
import {useAccountIdentity} from "@/api/companies-query";
import {useCompany} from "@/context/CompanyContext";
import {useBreadcrumbs} from "@/context/BreadcrumbContext";
import {queryKeys} from "@/lib/queryKeys";
import {Button} from "@/components/ui/button";
import {Card,CardHeader,CardContent} from "@/components/ui/card";
import {Textarea} from "@/components/ui/textarea";
import {CausalClaimDefinitionForm} from "@/components/CausalClaimDefinitionForm";
import {CausalClaimResult} from "@/components/CausalClaimResult";
import {CausalClaimSafetyControls} from "@/components/CausalClaimSafetyControls";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
function CausalModelCard({root,pin,pins,busy,editing,current,setVersionId,onEdit}:{root:CausalClaimView;pin:CausalDetail["versions"][number];pins:CausalDetail["versions"];busy:boolean;editing:boolean;current:boolean;setVersionId:(id:string)=>void;onEdit:()=>void}){
 const d=pin.version.definition;
 return <Card className="min-w-0"><CardHeader><h2 className="font-semibold">{d.name}</h2><p>Current claim status: {root.status}{current?" · current human model":" · retained historical model selected"}</p></CardHeader><CardContent className="min-w-0 space-y-4"><section aria-label="Causal question and registered estimand" className="space-y-3"><h3 className="font-medium">Question and hypothesis</h3><p>{d.question}</p><p>{d.humanHypothesis}</p><p>Assignment intention-to-treat native binary outcome · meaningful {d.estimand.beneficialDirection}: {d.estimand.minimumMeaningfulEffect*100} percentage points.</p><p>Registered UTC horizon: {d.horizon.from} to {d.horizon.until}. Population: native {d.population.unit} · {d.population.scope.type}.</p><p>{d.population.eligibilityStatement}</p><p>{d.population.externalValidityLimits}</p><p>{d.experimentEvidence?"Exact human-interpreted experiment analysis is pinned.":"No experiment analysis is pinned; estimation will be withheld."}</p></section>
 <label className="block space-y-2">Human model version<select aria-label="Human model version" className={selectStyle} value={pin.version.id} disabled={busy||editing} onChange={e=>setVersionId(e.target.value)}>{pins.map(p=><option key={p.version.id} value={p.version.id}>Version {p.version.revision}{root.currentVersionId===p.version.id?" · current":" · retained"} · {p.version.currentQualification.replaceAll("_"," ")}</option>)}</select></label>
 {pin.version.currentQualification!=="current"&&<p role="status">Current source definitions changed. The original model is retained; new reliance requires explicit revalidation.</p>}
 <section aria-label="Declared human graph and assumptions" className="space-y-3"><h3 className="font-medium">Human graph and assumptions</h3><p>Declared identification: {d.identificationStrategy.replaceAll("_"," ")}.</p><ul className="list-disc space-y-2 pl-5">{d.graph.nodes.map(n=><li key={n.key}>{n.label} · {n.role.replaceAll("_"," ")}</li>)}</ul><ol className="list-decimal space-y-3 pl-5">{d.graph.edges.map((e,i)=><li key={i}>{d.graph.nodes.find(n=>n.key===e.from)?.label} → {d.graph.nodes.find(n=>n.key===e.to)?.label} · human assumption. {e.rationale}</li>)}</ol><dl className="space-y-3">{Object.entries(d.assumptions).map(([k,a])=><div key={k}><dt>{{noInterference:"No interference between units",stableOutcomeMeasurement:"Stable outcome measurement",registeredPopulationValidity:"Registered population validity"}[k as keyof typeof d.assumptions]} · {a.status==="assumed"?"human assumed":a.status}</dt><dd>{a.rationale}</dd></div>)}</dl></section>
 {pin.review&&<section aria-label="Recorded human model review" className="space-y-2"><h3 className="font-medium">Human model review</h3><p>{pin.review.rationale}</p><p>Reviewed by {pin.review.reviewedBy} · {new Date(pin.review.reviewedAt).toLocaleString()}.</p></section>}
 {current&&root.status!=="revoked"&&!editing&&<Button variant="outline" disabled={busy} onClick={onEdit}>Revise human model and reset review</Button>}
 <details><summary className="cursor-pointer">Inspect model provenance and retention</summary><div className="space-y-2 pt-3 text-sm"><p>Owner {d.ownerUserId} · source retention until {new Date(pin.version.expiresAt).toLocaleString()}. At most five retained native versions are shown.</p><p className="break-all">Definition {pin.version.contentHash}</p>{d.experimentEvidence&&<p className="break-all">Registered analysis {d.experimentEvidence.id} · human interpretation {d.experimentEvidence.interpretationId}</p>}</div></details></CardContent></Card>;
}
export function CausalClaims(){
 const {selectedCompanyId}=useCompany(),{userId,settled,failed}=useAccountIdentity(),{setBreadcrumbs}=useBreadcrumbs();
 const verifying=useIsFetching({queryKey:queryKeys.auth.session})>0;
 const flags=useQuery({queryKey:[...queryKeys.instance.experimentalSettings,"causal-claims",userId],queryFn:()=>instanceSettingsApi.getExperimental(),enabled:!!selectedCompanyId&&settled&&!failed&&!verifying,refetchOnWindowFocus:false,retry:false});
 useEffect(()=>setBreadcrumbs([{label:"Causal claims"}]),[setBreadcrumbs]);
 if(failed)return <p role="alert">Your account could not be verified. Reload this page.</p>;
 if(!settled||verifying)return <p role="status">Verifying current account…</p>;
 if(!selectedCompanyId)return <p>Select a company to review causal claims.</p>;
 if(flags.isFetching)return <p role="status">Rechecking causal availability…</p>;
 if(flags.isError||!flags.data||!v8FeatureEnabled(flags.data,"causal_claims_v8")||!v7FeatureEnabled(flags.data,"governance_evidence_v7"))return <div className="space-y-6"><p role={flags.isError?"alert":"status"}>{flags.isError?"Causal availability could not be established.":"Governed causal analysis is not enabled."}</p><CausalClaimSafetyControls key={`${selectedCompanyId}:${userId}`} companyId={selectedCompanyId} userId={userId}/></div>;
 return <CausalClaimWorkspace key={`${selectedCompanyId}:${userId}`} companyId={selectedCompanyId} userId={userId}/>;
}
export function CausalClaimWorkspace({companyId,userId}:{companyId:string;userId:string|null}){
 const cache=useQueryClient(),key=["causal-claims",companyId,userId],account=userId??undefined;
 const [authorityLost,setAuthorityLost]=useState(false),[id,setId]=useState(""),[versionId,setVersionId]=useState(""),[editing,setEditing]=useState(false),[rationale,setRationale]=useState(""),[ack,setAck]=useState(false),[now,setNow]=useState(Date.now());
 const reviewing=editing||!!rationale||ack,interval=reviewing?false:30000;
 const list=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>causalClaimsApi.list(companyId,pageParam,account),getNextPageParam:p=>p.nextCursor??undefined,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const detail=useQuery({queryKey:[...key,"detail",id],queryFn:()=>causalClaimsApi.detail(companyId,id,account),enabled:!!id,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const retained=(expiry:string)=>Date.parse(expiry)>Math.max(now,Date.now());
 const root=!list.isFetching&&!list.isError&&!detail.isFetching&&!detail.isError&&detail.data?.claim.companyId===companyId&&detail.data.claim.id===id?detail.data.claim:undefined;
 const pins=root?detail.data?.versions.filter(p=>p.version.companyId===companyId&&p.version.claimId===id&&retained(p.version.expiresAt)&&(!p.review||p.review.versionId===p.version.id)&&(!p.run||p.run.companyId===companyId&&p.run.claimId===id&&p.run.versionId===p.version.id))??[]:[];
 const selected=versionId||root?.currentVersionId,pin=pins.find(p=>p.version.id===selected),current=!!root&&!!pin&&root.currentVersionId===pin.version.id;
 const hide=useCallback(()=>{setEditing(false);setId("");setVersionId("");setRationale("");setAck(false);cache.removeQueries({queryKey:["causal-definition-sources",companyId,userId]});cache.removeQueries({queryKey:["experiment-definition-sources",companyId,userId]});},[cache,companyId,userId]);
 const lost=useCallback(()=>{setAuthorityLost(true);hide();void cache.resetQueries({queryKey:key});},[hide,cache,companyId,userId]);
 const refresh=()=>{setAuthorityLost(false);setEditing(false);setRationale("");setAck(false);void cache.invalidateQueries({queryKey:key});};
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);window.addEventListener("memory-access-changed",lost);return()=>{window.clearInterval(timer);window.removeEventListener("memory-access-changed",lost);};},[lost]);
 useEffect(()=>{if(list.isError||detail.isError){setAuthorityLost(true);hide();}},[list.isError,detail.isError,hide]);
 const save=useMutation({mutationFn:(input:{key:string;definition:CausalClaimDefinition;rationale:string})=>root?causalClaimsApi.revise(companyId,root.id,{expectedRevision:root.revision,definition:input.definition,rationale:input.rationale},account):causalClaimsApi.create(companyId,{key:input.key,definition:input.definition},account),onSuccess:v=>{setId(v.claim.id);setVersionId(v.version.id);refresh();},onError:lost});
 const review=useMutation({mutationFn:()=>causalClaimsApi.review(companyId,root!.id,{expectedRevision:root!.revision,versionId:pin!.version.id,rationale,graphAndAssumptionsAcknowledged:true},account),onSuccess:refresh,onError:lost});
 const analyze=useMutation({mutationFn:()=>causalClaimsApi.analyze(companyId,root!.id,{expectedRevision:root!.revision,versionId:pin!.version.id},account),onSuccess:refresh,onError:lost});
 const busy=save.isPending||review.isPending||analyze.isPending,rows=!list.isFetching&&!list.isError?list.data?.pages.flatMap(p=>p.items).filter(r=>r.claim.companyId===companyId&&r.version.companyId===companyId&&retained(r.version.expiresAt))??[]:[];
 return <div className="min-w-0 space-y-6"><header className="space-y-2"><h1 className="text-xl font-semibold">Causal claims</h1><p className="text-muted-foreground">Ask a causal question, declare the human model and review identification conditions before one conditional interpretation or abstention.</p></header>
 {(authorityLost||list.error||detail.error||save.error||review.error||analyze.error)&&<div role="alert"><p>Current causal source authority or revision could not be established. Sensitive models and dependent results have been withheld.</p><Button variant="outline" onClick={lost}>Recheck causal authority</Button></div>}
 {list.isFetching&&<p role="status">Rechecking current causal authority…</p>}
 <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy||list.isFetching} onClick={()=>{setId("");setVersionId("");setRationale("");setAck(false);setEditing(true);}}>Record a causal question</Button><Button variant="ghost" disabled={busy} onClick={refresh}>Refresh causal claims</Button></div>
 <label className="block space-y-2">Causal claim<select aria-label="Causal claim" className={selectStyle} value={id} disabled={busy||editing} onChange={e=>{setId(e.target.value);setVersionId("");setRationale("");setAck(false);}}><option value="">Choose an authorized human model</option>{rows.map(r=><option key={r.claim.id} value={r.claim.id}>{r.version.definition.name} · {r.claim.status}</option>)}</select></label>
 {list.hasNextPage&&<Button variant="outline" disabled={list.isFetching||busy} onClick={()=>void list.fetchNextPage()}>Load more causal claims</Button>}
 {id&&detail.isFetching&&<p role="status">Rechecking exact retained model authority…</p>}
 {root&&pin&&<CausalModelCard root={root} pin={pin} pins={pins} busy={busy} editing={editing} current={current} setVersionId={v=>{setVersionId(v);setRationale("");setAck(false);}} onEdit={()=>setEditing(true)}/>}
 {root&&pin&&current&&!editing&&root.status==="hypothesis"&&pin.version.currentQualification==="current"&&!root.reviewedVersionId&&<Card><CardContent className="space-y-3 pt-6"><h2 className="font-semibold">Separate human model review</h2><label className="block space-y-2">Human review rationale<Textarea aria-label="Human review rationale" value={rationale} minLength={10} maxLength={2000} onChange={e=>setRationale(e.target.value)}/></label><label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I reviewed this exact graph, assumptions, source and conditional interpretation boundary.</label><Button disabled={busy||!ack||rationale.trim().length<10||rationale.trim().length>2000} onClick={()=>review.mutate()}>Record human model review</Button></CardContent></Card>}
 {root&&pin&&current&&!editing&&root.status==="hypothesis"&&pin.version.currentQualification==="current"&&root.reviewedVersionId===pin.version.id&&pin.review&&!pin.run&&<Button disabled={busy} onClick={()=>analyze.mutate()}>Interpret registered evidence once</Button>}
 {editing&&(!id||root&&pin)&&<CausalClaimDefinitionForm key={id?pin?.version.id:"new"} companyId={companyId} userId={userId} initial={id?pin?.version.definition:undefined} claimKey={root?.key} busy={busy} onSave={v=>save.mutate(v)} onCancel={()=>setEditing(false)} onAuthorityLost={lost}/>}
 {!editing&&root?.status!=="revoked"&&pin?.run&&<CausalClaimResult run={pin.run}/>}
 {root?.status==="revoked"&&<p role="status">This claim is revoked. Retained model history grants no current causal reliance.</p>}
 {!list.isFetching&&!list.isError&&!rows.length&&!editing&&<p>No authorized causal claims were returned on this bounded page. Review a causal analytical purpose in AI Governance before recording a model.</p>}
 <details><summary className="cursor-pointer">Independent claim revocation</summary><div className="pt-4"><CausalClaimSafetyControls companyId={companyId} userId={userId}/></div></details></div>;
}
