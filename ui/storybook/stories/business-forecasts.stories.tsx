import {useState} from "react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {Meta,StoryObj} from "@storybook/react-vite";
import {BusinessForecastWorkspace} from "@/pages/BusinessForecasts";
import {BusinessForecastResult} from "@/components/BusinessForecastResult";
import {forecastFixture} from "./business-forecast-fixtures";
function Workspace({published=false}:{published?:boolean}) {
 const [client]=useState(()=>{const f=forecastFixture(published),query=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false},mutations:{retry:false}}}),key=["business-forecasts",f.companyId,f.userId];
  query.setQueryData(key,{pages:[{items:[f.spec],nextCursor:null,coverage:"bounded_current_authorized_page"}],pageParams:[undefined]});
  query.setQueryData([...key,"detail",f.spec.id],{spec:f.spec,versions:[f.version]});
  for(const kind of ["backtest","run"] as const) {const value=kind==="backtest"?f.backtest:f.run;query.setQueryData([...key,kind==="backtest"?"backtests":"runs",f.spec.id],{pages:[{items:kind==="backtest"||published?[value]:[],nextCursor:null,coverage:"bounded_current_authorized_page"}],pageParams:[undefined]});query.setQueryData([...key,kind,f.spec.id,value.id],value);}
  const source=["forecast-definition-sources",f.companyId,f.userId];
  query.setQueryData([...source,"metrics"],{items:[f.metric],nextCursor:null});query.setQueryData([...source,"metric",f.metric.id],{metric:f.metric,versions:[f.metricVersion]});query.setQueryData([...source,"purpose"],[f.policy]);
  query.setQueryData(["forecast-history",f.companyId,f.userId,f.metric.id,f.metricVersion.id],{pages:[{items:f.observations,nextCursor:null,coverage:"bounded_current_authorized_page"}],pageParams:[undefined]});return query;
 });
 const f=forecastFixture();return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><BusinessForecastWorkspace companyId={f.companyId} userId={f.userId}/></div></QueryClientProvider>;
}
function Result({state}:{state:"qualified"|"stale"|"not_qualified"|"data_not_ready"|"expired"}) {
 const {backtest}=forecastFixture();
 const artifact=state==="stale"?{...backtest,currentQualification:"needs_revalidation" as const,reviewReason:"Measurement history changed after capture; review a new native backtest before publication."}:state==="expired"?{...backtest,expiresAt:"2000-01-01T00:00:00Z"}:state==="not_qualified"||state==="data_not_ready"?{...backtest,currentQualification:"inconclusive" as const,result:{...backtest.result,status:state,points:[],selectedReason:null,...(state==="data_not_ready"?{comparisons:[],backtests:[]}:{}),reasons:[state==="not_qualified"?"declared_loss_limit_not_met":"unsafe_or_late_measurement_capture"]}}:backtest;
 return <div className="mx-auto w-full max-w-3xl"><BusinessForecastResult artifact={artifact}/></div>;
}
// Synthetic cached presentation fixtures never establish current source access,
// provider execution or operational history. Browser QA blocks every API call.
const meta:Meta={title:"Business Intelligence/Business forecasts",parameters:{layout:"padded"}};export default meta;type Story=StoryObj;
export const Qualified:Story={render:()=> <Result state="qualified"/>};
export const Stale:Story={render:()=> <Result state="stale"/>};
export const NotQualified:Story={render:()=> <Result state="not_qualified"/>};
export const DataNotReady:Story={render:()=> <Result state="data_not_ready"/>};
export const Expired:Story={render:()=> <Result state="expired"/>};
export const Draft:Story={render:()=> <Workspace/>};
export const Published:Story={render:()=> <Workspace published/>};
