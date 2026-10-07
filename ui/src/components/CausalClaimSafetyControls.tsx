import {useState,useEffect,useCallback} from "react";
import {useInfiniteQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {causalClaimsApi} from "@/api/causal-claims";
import {Button} from "./ui/button";
import {Textarea} from "./ui/textarea";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
export function CausalClaimSafetyControls({companyId,userId}:{companyId:string;userId:string|null}){
 const cache=useQueryClient(),key=["causal-revocation-controls",companyId,userId],account=userId??undefined;
 const [id,setId]=useState(""),[rationale,setRationale]=useState("");
 const controls=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,queryFn:({pageParam})=>causalClaimsApi.controls(companyId,pageParam,account),getNextPageParam:p=>p.nextCursor??undefined,refetchInterval:rationale?false:30000,refetchOnWindowFocus:!rationale,retry:false});
 const rows=!controls.isFetching&&!controls.isError?controls.data?.pages.flatMap(p=>p.items).filter(r=>r.companyId===companyId&&r.status!=="revoked")??[]:[],row=rows.find(r=>r.id===id);
 const clear=useCallback(()=>{setId("");setRationale("");void cache.resetQueries({queryKey:key});void cache.invalidateQueries({queryKey:["causal-claims",companyId,userId]});},[cache,companyId,userId]);
 const revoke=useMutation({mutationFn:()=>causalClaimsApi.revoke(companyId,row!.id,{expectedRevision:row!.revision,rationale},account),onSuccess:clear,onError:clear});
 useEffect(()=>{window.addEventListener("memory-access-changed",clear);return()=>window.removeEventListener("memory-access-changed",clear);},[clear]);
 return <section aria-label="Independent causal revocation controls" className="min-w-0 space-y-3"><h2 className="font-semibold">Revoke a causal claim</h2><p>Human administrators can revoke a claim while the feature is disabled or source disclosure is unavailable. This control shows only native identity, revision and status.</p>
 {controls.isFetching&&<p role="status">Rechecking revocation authority…</p>}{controls.isError&&<p role="alert">Revocation authority could not be established.</p>}{revoke.isError&&<p role="alert">The claim changed or could not be revoked. Reload current controls.</p>}
 <label className="block space-y-2">Claim control reference<select aria-label="Claim control reference" className={selectStyle} value={id} disabled={revoke.isPending||controls.isFetching} onChange={e=>{setId(e.target.value);setRationale("");}}><option value="">Choose exact native claim reference</option>{rows.map((r,i)=><option key={r.id} value={r.id}>Claim {i+1} · {r.status} · {r.id}</option>)}</select></label>
 {row&&<><label className="block space-y-2">Revocation rationale<Textarea aria-label="Revocation rationale" value={rationale} minLength={10} maxLength={2000} onChange={e=>setRationale(e.target.value)}/></label><Button variant="outline" disabled={revoke.isPending||rationale.trim().length<10||rationale.trim().length>2000} onClick={()=>revoke.mutate()}>Revoke this causal claim</Button></>}
 {controls.hasNextPage&&<Button variant="outline" disabled={controls.isFetching||revoke.isPending} onClick={()=>void controls.fetchNextPage()}>Load more claim controls</Button>}
 {!controls.isFetching&&!controls.isError&&!rows.length&&<p>No active claim controls were returned on this bounded page.</p>}<Button variant="ghost" disabled={revoke.isPending} onClick={clear}>Refresh revocation authority</Button></section>;
}
