import {useEffect,useState} from "react";
import {useInfiniteQuery,useIsFetching,useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {v7FeatureEnabled,v8FeatureEnabled,type BusinessForecastDefinition,type BacktestBusinessForecast} from "@paperclipai/shared";
import {businessForecastingApi} from "@/api/business-forecasting";
import {instanceSettingsApi} from "@/api/instanceSettings";
import {useAccountIdentity} from "@/api/companies-query";
import {useCompany} from "@/context/CompanyContext";
import {useBreadcrumbs} from "@/context/BreadcrumbContext";
import {queryKeys} from "@/lib/queryKeys";
import {BusinessForecastDefinitionForm} from "@/components/BusinessForecastDefinitionForm";
import {BusinessForecastHistoryForm} from "@/components/BusinessForecastHistoryForm";
import {BusinessForecastResult} from "@/components/BusinessForecastResult";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Card,CardContent,CardHeader} from "@/components/ui/card";
import {Link} from "@/lib/router";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
export function BusinessForecasts() {
 const {selectedCompanyId}=useCompany(),{userId,settled,failed}=useAccountIdentity(),{setBreadcrumbs}=useBreadcrumbs();
 const verifying=useIsFetching({queryKey:queryKeys.auth.session})>0;
 const flags=useQuery({queryKey:[...queryKeys.instance.experimentalSettings,"business-forecasts",userId],queryFn:()=>instanceSettingsApi.getExperimental(),enabled:!!selectedCompanyId&&settled&&!failed&&!verifying,refetchOnWindowFocus:false,retry:false});
 useEffect(()=>{setBreadcrumbs([{label:"Business forecasts"}]);},[setBreadcrumbs]);
 if(failed) return <p role="alert">Your account could not be verified. Reload this page.</p>;
 if(!settled||verifying) return <p role="status">Verifying current account…</p>;
 if(!selectedCompanyId) return <p>Select a company to review its business forecasts.</p>;
 if(flags.isFetching) return <p role="status">Rechecking forecast availability…</p>;
 if(flags.isError) return <p role="alert">Forecast availability could not be verified.</p>;
 if(!flags.data||!v8FeatureEnabled(flags.data,"business_forecasting_v8")||!v7FeatureEnabled(flags.data,"governance_evidence_v7")) return <p>Governed business forecasting is not enabled.</p>;
 return <BusinessForecastWorkspace key={`${selectedCompanyId}:${userId??"local"}`} companyId={selectedCompanyId} userId={userId} statisticalEnabled={v8FeatureEnabled(flags.data,"forecast_provider_statsforecast_v8")}/>;
}
export function BusinessForecastWorkspace({companyId,userId,statisticalEnabled=false}:{companyId:string;userId:string|null;statisticalEnabled?:boolean}) {
 const cache=useQueryClient(),key=["business-forecasts",companyId,userId],account=userId??undefined;
 const [id,setId]=useState(""),[versionId,setVersionId]=useState(""),[backtestId,setBacktestId]=useState(""),[runId,setRunId]=useState("");
 const [editing,setEditing]=useState(false),[historyEditing,setHistoryEditing]=useState(false),[rationale,setRationale]=useState(""),[now,setNow]=useState(Date.now());
 const reviewing=editing||historyEditing||!!rationale,interval=reviewing?false:30000;
 const list=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>businessForecastingApi.list(companyId,pageParam,account),getNextPageParam:page=>page.nextCursor??undefined,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const detail=useQuery({queryKey:[...key,"detail",id],queryFn:()=>businessForecastingApi.detail(companyId,id,account),enabled:!!id,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const backtests=useInfiniteQuery({queryKey:[...key,"backtests",id],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>businessForecastingApi.artifacts(companyId,id,"backtest",pageParam,account),getNextPageParam:page=>page.nextCursor??undefined,enabled:!!id,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const runs=useInfiniteQuery({queryKey:[...key,"runs",id],initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>businessForecastingApi.artifacts(companyId,id,"run",pageParam,account),getNextPageParam:page=>page.nextCursor??undefined,enabled:!!id,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const selectedBacktest=useQuery({queryKey:[...key,"backtest",id,backtestId],queryFn:()=>businessForecastingApi.artifact(companyId,id,backtestId,"backtest",account),enabled:!!id&&!!backtestId,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const selectedRun=useQuery({queryKey:[...key,"run",id,runId],queryFn:()=>businessForecastingApi.artifact(companyId,id,runId,"run",account),enabled:!!id&&!!runId,refetchInterval:interval,refetchOnWindowFocus:!reviewing,retry:false});
 const retained=(expiry:string)=>Date.parse(expiry)>Math.max(now,Date.now());
 const root=!list.isFetching&&!list.isError&&!detail.isFetching&&!detail.isError&&detail.data?.spec.companyId===companyId?detail.data.spec:undefined;
 const pins=root?detail.data?.versions.filter(value=>value.companyId===companyId&&value.specId===root.id&&retained(value.expiresAt))??[]:[];
 const pin=pins.find(value=>value.id===(versionId||pins[0]?.id));
 const validArtifact=(value:typeof selectedBacktest.data)=>value&&value.companyId===companyId&&value.specId===id&&retained(value.expiresAt)?value:undefined;
 const backtest=!backtests.isFetching&&!backtests.isError&&!selectedBacktest.isFetching&&!selectedBacktest.isError?validArtifact(selectedBacktest.data):undefined;
 const run=!runs.isFetching&&!runs.isError&&!selectedRun.isFetching&&!selectedRun.isError?validArtifact(selectedRun.data):undefined;
 const refresh=()=>{setEditing(false);setHistoryEditing(false);setRationale("");void cache.invalidateQueries({queryKey:key});};
 const revoke=()=>{setEditing(false);setHistoryEditing(false);setRationale("");setBacktestId("");setRunId("");void cache.resetQueries({queryKey:key});void cache.resetQueries({queryKey:["forecast-history",companyId,userId]});void cache.resetQueries({queryKey:["forecast-definition-sources",companyId,userId]});};
 const save=useMutation({mutationFn:(input:{key:string;definition:BusinessForecastDefinition})=>root?businessForecastingApi.revise(companyId,root.id,{expectedRevision:root.revision,definition:input.definition},account):businessForecastingApi.create(companyId,input,account),onSuccess:value=>{setId(value.spec.id);setVersionId(value.version.id);setBacktestId("");setRunId("");refresh();},onError:revoke});
 const test=useMutation({mutationFn:(input:BacktestBusinessForecast)=>businessForecastingApi.backtest(companyId,root!.id,input,account),onSuccess:value=>{setBacktestId(value.id);refresh();},onError:revoke});
 const execute=useMutation({mutationFn:(input:BacktestBusinessForecast)=>businessForecastingApi.run(companyId,root!.id,input,account),onSuccess:value=>{setRunId(value.id);refresh();},onError:revoke});
 const publish=useMutation({mutationFn:()=>businessForecastingApi.publish(companyId,root!.id,{expectedRevision:root!.revision,versionId:pin!.id,backtestId:backtest!.id,rationale},account),onSuccess:refresh,onError:revoke});
 const retire=useMutation({mutationFn:()=>businessForecastingApi.retire(companyId,root!.id,{expectedRevision:root!.revision,rationale},account),onSuccess:refresh,onError:revoke});
 const busy=save.isPending||test.isPending||execute.isPending||publish.isPending||retire.isPending;
 const error=[list.error,detail.error,backtests.error,runs.error,selectedBacktest.error,selectedRun.error,save.error,test.error,execute.error,publish.error,retire.error].find(Boolean);
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);window.addEventListener("memory-access-changed",revoke);return()=>{window.clearInterval(timer);window.removeEventListener("memory-access-changed",revoke);};},[cache,companyId,userId]);
 const reasonValid=rationale.trim().length>=10&&rationale.trim().length<=2000,canBacktest=!!root&&!!pin&&root.status!=="retired"&&pin.revision===root.revision,canRun=!!root&&!!pin&&root.status==="published"&&root.publishedVersionId===pin.id&&!backtests.isFetching&&!backtests.isError&&!!backtests.data?.pages.some(page=>page.items.some(value=>value.versionId===pin.id&&value.currentQualification==="qualified"&&retained(value.expiresAt)));
 const rows=!list.isFetching&&!list.isError?list.data?.pages.flatMap(page=>page.items).filter(value=>value.companyId===companyId)??[]:[];
 return <div className="min-w-0 space-y-6"><header className="space-y-2"><h1 className="text-xl font-semibold">Business forecasts</h1><p className="text-muted-foreground">Review future values of a governed business metric using retained history and a separate human publication.</p></header>
  {error&&<div role="alert" className="space-y-2"><p>{error.message}</p><Button variant="outline" onClick={revoke}>Recheck forecast authority</Button></div>}
  {list.isFetching&&<p role="status">Rechecking current forecast authority…</p>}
  <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy||list.isFetching} onClick={()=>{setId("");setVersionId("");setBacktestId("");setRunId("");setHistoryEditing(false);setEditing(true);setRationale("");}}>Define a forecast</Button><Button variant="ghost" disabled={busy} onClick={refresh}>Refresh forecasts</Button></div>
  <label className="block space-y-2">Forecast specification<select aria-label="Forecast specification" className={selectStyle} value={id} disabled={busy} onChange={event=>{setId(event.target.value);setVersionId("");setBacktestId("");setRunId("");setEditing(false);setHistoryEditing(false);setRationale("");}}><option value="">Choose a forecast</option>{rows.map(value=><option key={value.id} value={value.id}>{value.key} · {value.status}</option>)}</select></label>
  {list.hasNextPage&&<Button variant="outline" disabled={list.isFetching||busy} onClick={()=>void list.fetchNextPage()}>Load more forecasts</Button>}
  {id&&detail.isFetching&&<p role="status">Rechecking retained forecast definition…</p>}
  {root&&pin&&<Card className="min-w-0"><CardHeader><h2 className="font-semibold">{pin.definition.name} · {root.status}</h2><p>{pin.definition.businessQuestion}</p></CardHeader><CardContent className="min-w-0 space-y-4"><p>{pin.definition.decisionUse}</p>
   <label className="block space-y-2">Forecast version<select aria-label="Forecast version" className={selectStyle} value={pin.id} disabled={busy||editing||historyEditing} onChange={event=>{setVersionId(event.target.value);setBacktestId("");setRunId("");setRationale("");}}>{pins.map(value=><option key={value.id} value={value.id}>Version {value.revision}{root.publishedVersionId===value.id?" · human-published":" · proposal"}</option>)}</select></label>
   <p className="text-sm">{pin.definition.frequency==="daily_utc"?"Daily UTC":"Weekly UTC"} · {pin.definition.horizon} future periods · {pin.definition.candidate.kind.replaceAll("_"," ")} · owner {pin.definition.ownerUserId}</p><p className="text-sm text-muted-foreground">Retained until {new Date(pin.expiresAt).toLocaleString()}. Showing at most five retained definition versions.</p>
   {!editing&&!historyEditing&&root.status!=="retired"&&<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={()=>setEditing(true)}>Propose a forecast revision</Button><Button variant="outline" disabled={busy||!canBacktest&&!canRun} onClick={()=>setHistoryEditing(true)}>Choose observation history</Button></div>}
   <details><summary className="cursor-pointer">Inspect definition and model policy</summary><div className="space-y-2 pt-3 text-sm"><p>History: {pin.definition.minimumHistory} periods · capture latency {pin.definition.captureLatencySeconds} seconds · {pin.definition.backtest.minimumOrigins} rolling origins · {pin.definition.backtest.gapPeriods} gap periods</p><p>Maximum MAE {pin.definition.backtest.maximumMAE} · required last-value improvement {pin.definition.backtest.minimumRelativeMAEImprovement}</p>{pin.definition.knownFailureModes.map(value=><p key={value}>{value}</p>)}<p className="break-all">Metric definition {pin.definition.metricVersionId}</p><p className="break-all">Specification hash {pin.contentHash}</p></div></details>
   {!backtests.isFetching&&!backtests.isError&&<label className="block space-y-2">Retained backtest<select aria-label="Retained backtest" className={selectStyle} value={backtestId} disabled={busy} onChange={event=>setBacktestId(event.target.value)}><option value="">Choose backtest evidence</option>{backtests.data?.pages.flatMap(page=>page.items).filter(value=>value.versionId===pin.id&&retained(value.expiresAt)).map(value=><option key={value.id} value={value.id}>{new Date(value.createdAt).toLocaleString()} · {value.currentQualification.replaceAll("_"," ")}</option>)}</select></label>}
   {backtests.isFetching&&<p role="status">Rechecking retained backtests…</p>}{backtests.hasNextPage&&<Button variant="outline" disabled={backtests.isFetching||busy} onClick={()=>void backtests.fetchNextPage()}>Load more backtests</Button>}
   {!runs.isFetching&&!runs.isError&&<label className="block space-y-2">Retained forecast run<select aria-label="Retained forecast run" className={selectStyle} value={runId} disabled={busy} onChange={event=>setRunId(event.target.value)}><option value="">Choose a forecast result</option>{runs.data?.pages.flatMap(page=>page.items).filter(value=>value.versionId===pin.id&&retained(value.expiresAt)).map(value=><option key={value.id} value={value.id}>{new Date(value.createdAt).toLocaleString()} · {value.currentQualification.replaceAll("_"," ")}</option>)}</select></label>}
   {runs.isFetching&&<p role="status">Rechecking retained forecast runs…</p>}{runs.hasNextPage&&<Button variant="outline" disabled={runs.isFetching||busy} onClick={()=>void runs.fetchNextPage()}>Load more forecast runs</Button>}
   {!editing&&!historyEditing&&root.status!=="retired"&&<section aria-label="Human forecast publication" className="space-y-3"><label className="block space-y-2">Human review rationale<Textarea aria-label="Human review rationale" value={rationale} onChange={event=>setRationale(event.target.value)} minLength={10} maxLength={2000}/></label><div className="flex flex-wrap gap-2"><Button disabled={busy||!reasonValid||!canBacktest||backtest?.versionId!==pin.id||backtest.currentQualification!=="qualified"} onClick={()=>publish.mutate()}>Publish this forecast version</Button><Button variant="outline" disabled={busy||!reasonValid} onClick={()=>retire.mutate()}>Retire forecast</Button></div><p className="text-sm text-muted-foreground">Publication requires the exact current qualified backtest. Corrections or newer history require a revised backtest and human review.</p></section>}
   {historyEditing&&<BusinessForecastHistoryForm key={`${pin.id}:${root.revision}`} companyId={companyId} userId={userId} version={pin} revision={root.revision} busy={busy} canBacktest={canBacktest} canRun={canRun} onBacktest={input=>test.mutate(input)} onRun={input=>execute.mutate(input)} onCancel={()=>setHistoryEditing(false)}/>}
  </CardContent></Card>}
  {editing&&(!id||root&&pin)&&<BusinessForecastDefinitionForm key={id?pin?.id:"new"} companyId={companyId} userId={userId} initial={id?pin?.definition:undefined} specKey={root?.key} busy={busy} statisticalEnabled={statisticalEnabled} onSave={input=>save.mutate(input)} onCancel={()=>setEditing(false)}/>}
  {root&&selectedBacktest.isFetching&&<p role="status">Rechecking selected backtest authority…</p>}{root&&backtest&&<BusinessForecastResult artifact={backtest}/>}
  {root&&selectedRun.isFetching&&<p role="status">Rechecking selected forecast authority…</p>}{root&&run&&<BusinessForecastResult artifact={run}/>}
  {!list.isFetching&&!rows.length&&!editing&&<p>No authorized forecast specifications were returned on this bounded page. Record a native metric and approved forecast purpose in <Link to="/ai-governance">AI Governance</Link> before proposing a forecast.</p>}
 </div>;
}
