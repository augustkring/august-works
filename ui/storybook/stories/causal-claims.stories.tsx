import {useState} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {Meta,StoryObj} from "@storybook/react-vite";
import {CausalClaimWorkspace} from "@/pages/CausalClaims";
import {CausalClaimResult} from "@/components/CausalClaimResult";
import {CausalClaimSafetyControls} from "@/components/CausalClaimSafetyControls";
import {causalFixture} from "./causal-claim-fixtures";
function Workspace({state="draft",stale=false}:{state?:Parameters<typeof causalFixture>[0];stale?:boolean}){
 const [client]=useState(()=>{const f=causalFixture(state,stale),q=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false},mutations:{retry:false}}}),key=["causal-claims",f.companyId,f.userId],source=["causal-definition-sources",f.companyId,f.userId],metrics=["experiment-definition-sources",f.companyId,f.userId];
 q.setQueryData(key,{pages:[{items:[{claim:f.claim,version:f.causalVersion,run:f.claim.latestRunId?f.run:null}],nextCursor:null,coverage:"bounded_current_authorized_page"}],pageParams:[undefined]});
 q.setQueryData([...key,"detail",f.claim.id],{claim:f.claim,versions:[{version:f.causalVersion,review:f.review,run:f.claim.latestRunId?f.run:null}],coverage:"bounded_recent_native_versions"});
 q.setQueryData([...source,"purpose"],[f.policy]);q.setQueryData([...source,"experiments"],{pages:[{items:[{experiment:f.experiment,version:f.version}],nextCursor:null}],pageParams:[undefined]});
 q.setQueryData([...source,"experiments","detail",f.experiment.id],{experiment:f.experiment,versions:[f.version],transitions:[],coverage:"bounded_recent_versions_and_transitions"});q.setQueryData([...source,"experiments","receipts",f.experiment.id,f.version.id],f.causalReceipts);
 q.setQueryData([...metrics,"metrics"],{pages:[{items:f.measurements.map(m=>m.metric),nextCursor:null}],pageParams:[undefined]});for(const m of f.measurements)q.setQueryData([...metrics,"metric",m.metric.id],{metric:m.metric,versions:[m.version]});
 q.setQueryData(["causal-revocation-controls",f.companyId,f.userId],{pages:[{items:[],nextCursor:null,coverage:"bounded_native_revocation_metadata"}],pageParams:[undefined]});return q;});const f=causalFixture(state,stale);
 return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><CausalClaimWorkspace companyId={f.companyId} userId={f.userId}/></div></QueryClientProvider>;
}
function Result({state="supported",stale=false}:{state?:"supported"|"refuted"|"inconclusive";stale?:boolean}){return <div className="mx-auto w-full max-w-3xl"><CausalClaimResult run={causalFixture(state,stale).run}/></div>;}
function Revocation(){const [client]=useState(()=>{const f=causalFixture(),q=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false},mutations:{retry:false}}});q.setQueryData(["causal-revocation-controls",f.companyId,f.userId],{pages:[{items:[{id:f.claim.id,companyId:f.companyId,revision:1,status:"hypothesis"}],nextCursor:null,coverage:"bounded_native_revocation_metadata"}],pageParams:[undefined]});return q;});const f=causalFixture();return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><CausalClaimSafetyControls companyId={f.companyId} userId={f.userId}/></div></QueryClientProvider>;}
// Synthetic cached presentation only; browser qualification aborts API access.
const meta:Meta={title:"Business Intelligence/Causal claims",parameters:{layout:"padded"}};export default meta;type Story=StoryObj;
export const Supported:Story={render:()=> <Result/>};
export const Refuted:Story={render:()=> <Result state="refuted"/>};
export const Inconclusive:Story={render:()=> <Result state="inconclusive"/>};
export const Stale:Story={render:()=> <Result stale/>};
export const Draft:Story={render:()=> <Workspace/>};
export const Reviewed:Story={render:()=> <Workspace state="reviewed"/>};
export const Retained:Story={render:()=> <Workspace state="supported" stale/>};
export const Revoked:Story={render:()=> <Workspace state="revoked"/>};
export const RevocationControls:Story={render:()=> <Revocation/>};
