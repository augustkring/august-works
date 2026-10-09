import { useState,useEffect,useCallback } from "react";
import { useInfiniteQuery,useMutation,useQueryClient } from "@tanstack/react-query";
import { businessExperimentsApi } from "@/api/business-experiments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
/** Human stopping is independently available without source disclosure or a
 * rollout flag. It does not admit starting, exposing or analyzing a trial. */
export function BusinessExperimentSafetyControls({companyId,userId}:{companyId:string;userId:string|null}){
 const cache=useQueryClient(),key=["experiment-safety-controls",companyId,userId],account=userId??undefined;
 const [id,setId]=useState(""),[rationale,setRationale]=useState("");
 const controls=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>businessExperimentsApi.safetyControls(companyId,pageParam,account),getNextPageParam:p=>p.nextCursor??undefined,refetchInterval:rationale?false:30000,refetchOnWindowFocus:!rationale,retry:false});
 const rows=!controls.isFetching&&!controls.isError?controls.data?.pages.flatMap(p=>p.items).filter(r=>r.companyId===companyId&&["running","paused"].includes(r.state))??[]:[],row=rows.find(r=>r.id===id);
 const clear=useCallback(()=>{setId("");setRationale("");void cache.resetQueries({queryKey:key});},[cache,companyId,userId]);
 const stop=useMutation({mutationFn:()=>businessExperimentsApi.stop(companyId,row!.id,{expectedRevision:row!.revision,versionId:row!.versionId!,state:"cancelled",rationale,completion:null},account),onSuccess:clear,onError:clear});
 useEffect(()=>{window.addEventListener("memory-access-changed",clear);return()=>window.removeEventListener("memory-access-changed",clear);},[clear]);
 return <section aria-label="Active experiment stopping controls" className="min-w-0 space-y-3"><h2 className="font-semibold">Stop an active recording</h2><p>Human administrators can cancel an active recording while the feature is disabled. Source access is required to review a protocol or result. Only exact control identities are shown here.</p>
 {controls.isFetching&&<p role="status">Rechecking stopping authority…</p>}{controls.isError&&<p role="alert">Stopping authority could not be established.</p>}{stop.isError&&<p role="alert">The recording changed or could not be stopped. Reload its current state.</p>}
 <label className="block space-y-2">Active recording<select aria-label="Active recording" className={selectStyle} value={id} disabled={stop.isPending||controls.isFetching} onChange={e=>{setId(e.target.value);setRationale("");}}><option value="">Choose exact active control reference</option>{rows.map((r,i)=><option key={r.id} value={r.id}>Recording {i+1} · {r.state} · {r.id}</option>)}</select></label>
 {row&&<><label className="block space-y-2">Stopping rationale<Textarea aria-label="Stopping rationale" value={rationale} onChange={e=>setRationale(e.target.value)} minLength={10} maxLength={2000}/></label><Button variant="outline" disabled={stop.isPending||!row.versionId||rationale.trim().length<10||rationale.trim().length>2000} onClick={()=>stop.mutate()}>Cancel this active recording</Button></>}
 {controls.hasNextPage&&<Button variant="outline" disabled={controls.isFetching||stop.isPending} onClick={()=>void controls.fetchNextPage()}>Load more active recording controls</Button>}
 {!controls.isFetching&&!controls.isError&&!rows.length&&<p>No active recording controls were returned on this bounded page.</p>}
 <Button variant="ghost" disabled={stop.isPending} onClick={clear}>Refresh stopping authority</Button>
 </section>;
}
