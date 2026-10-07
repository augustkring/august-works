// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {decisionContextDefinitionSchema,type DecisionContextView} from "@paperclipai/shared";
import type {Decision} from "@/api/decisions";
import {DecisionContextPanel} from "./DecisionContextPanel";
import {decisionIntelligenceApi} from "@/api/decision-intelligence";
const state=vi.hoisted(()=>({companyId:"00000000-0000-4000-8000-000000000001",userId:"account-one",settled:true,failed:false,enabled:true}));
vi.mock("@/context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:state.companyId})}));
vi.mock("@/api/companies-query",()=>({useAccountIdentity:()=>state}));
vi.mock("@/api/instanceSettings",()=>({instanceSettingsApi:{getExperimental:vi.fn(async()=>({analytical_lineage_v8:true,business_metrics_v8:true,enableDecisions:true,ai_use_cases_v7:true,governance_evidence_v7:true,decision_intelligence_v8:state.enabled}))}}));
vi.mock("@/api/decision-intelligence",()=>({decisionIntelligenceApi:{detail:vi.fn(),propose:vi.fn(),prepare:vi.fn(),withdraw:vi.fn()}}));
vi.mock("@/api/decision-outcome-reviews",()=>({decisionOutcomeReviewsApi:{detail:vi.fn(async()=>null),schedule:vi.fn(),transition:vi.fn(),finish:vi.fn()}}));
vi.mock("@/api/ai-governance",()=>({aiGovernanceApi:{obligations:vi.fn(async()=>[{id:"00000000-0000-4000-8000-000000000004",obligation:{framework:"company_policy",citation:"Reviewed decision purpose",analyticalPurpose:{status:"approved",purpose:"management_intelligence",capabilities:["decision"]}}}])}}));
vi.mock("@/api/projects",()=>({projectsApi:{list:vi.fn(async()=>[])}}));
vi.mock("@/api/issues",()=>({issuesApi:{list:vi.fn(async()=>[])}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const decision=():Decision=>({id:id(2),companyId:state.companyId,bundleId:null,originAgentId:id(6),originIssueId:id(7),originRunId:id(8),ruleKey:null,title:"Native decision",body:"Choose through the native controls",options:[{id:"proceed",label:"Proceed",effects:[]},{id:"defer",label:"Defer",effects:[]}],inputs:null,status:"open",executionStatus:null,chosenOptionId:null,inputValues:null,decidedByUserId:null,decidedAt:null,expiresAt:"2099-01-01T00:00:00Z",idempotencyKey:null,targetSnapshots:{},continuationPolicy:"none",metadata:{},createdAt:"2026-10-07T00:00:00Z",updatedAt:"2026-10-07T00:00:00Z"});
function context(expiry="2099-01-01T00:00:00Z"):DecisionContextView {
  const definition=decisionContextDefinitionSchema.parse({question:"Private prospective question for this account",objective:"Review useful business outcomes",ownerUserId:state.userId,scope:{type:"company",id:null},timeHorizon:{from:"2026-10-07T00:00:00Z",until:"2027-01-01T00:00:00Z"},uncertaintySummary:"Conditions may change during delivery",revisitAt:null,
    sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[id(4)],retentionDays:30,evidence:[],assumptions:[],criteria:[{key:"delivery",name:"Delivery",description:"Capacity to deliver useful outcomes",type:"qualitative",priority:"high",evidenceKey:null}],expectedOutcomes:[{kind:"qualitative",optionId:"proceed",statement:"Observe useful delivery within this horizon",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"Human expectation without a calibrated interval"}]});
  return {companyId:state.companyId,decisionId:id(2),revision:1,preparedVersionId:null,binding:null,versions:[{id:id(3),companyId:state.companyId,decisionId:id(2),revision:1,definition,evidence:[],contentHash:"a".repeat(64),decisionSpecHash:"b".repeat(64),createdAt:"2026-10-07T00:00:00Z",expiresAt:expiry,state:"draft"}],hasMoreVersions:false,authorizationCheckedAt:new Date().toISOString()};
}
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
async function mount(nativeDecision=decision()) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}),container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const render=async(value=nativeDecision)=>{await act(async()=>root.render(<QueryClientProvider client={client}><DecisionContextPanel decision={value}/></QueryClientProvider>));await flush();await flush();};await render();
  return {container,client,render,cleanup:async()=>{await act(async()=>root.unmount());client.clear();container.remove();}};
}
const button=(container:HTMLElement,name:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===name)!;
async function click(container:HTMLElement,name:string) {await act(async()=>button(container,name).click());await flush();}
async function reason(container:HTMLElement,value:string) {await act(async()=>{const field=container.querySelector<HTMLTextAreaElement>("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));});await flush();}
beforeEach(()=>{vi.clearAllMocks();state.companyId=id(1);state.userId="account-one";state.settled=true;state.failed=false;state.enabled=true;vi.mocked(decisionIntelligenceApi.detail).mockResolvedValue(context());});
describe("Human native Decision context",()=>{
  it("reads only after current account/company/feature admission and uses the account-scoped endpoint",async()=>{
    state.settled=false;const view=await mount();expect(decisionIntelligenceApi.detail).not.toHaveBeenCalled();state.settled=true;state.enabled=false;await view.render();expect(decisionIntelligenceApi.detail).not.toHaveBeenCalled();await view.cleanup();
    state.enabled=true;const enabled=await mount();expect(decisionIntelligenceApi.detail).toHaveBeenCalledWith(id(1),id(2),"account-one");expect(enabled.container.textContent).toContain("Private prospective question");await enabled.cleanup();
  });
  it("requires a human rationale for preparation and keeps proposal saving separate from choice/preparation",async()=>{
    const prepared={...context(),revision:2,preparedVersionId:id(3)};vi.mocked(decisionIntelligenceApi.prepare).mockResolvedValue(prepared);
    const view=await mount();expect(button(view.container,"Prepare this context").disabled).toBe(true);
    await reason(view.container,"Explicit human review of the exact prospective context");await click(view.container,"Prepare this context");
    expect(decisionIntelligenceApi.prepare).toHaveBeenCalledWith(id(1),id(2),{expectedRevision:1,versionId:id(3),rationale:"Explicit human review of the exact prospective context"},"account-one");await view.cleanup();
    vi.mocked(decisionIntelligenceApi.propose).mockResolvedValue(context());const proposal=await mount();await click(proposal.container,"Propose a context revision");await click(proposal.container,"Save context proposal");expect(decisionIntelligenceApi.propose).toHaveBeenCalledWith(id(1),id(2),{expectedRevision:1,definition:context().versions[0].definition},"account-one");expect(decisionIntelligenceApi.prepare).toHaveBeenCalledTimes(1);await proposal.cleanup();
  });
  it("hides retained facts while reauthorizing and after native source access fails",async()=>{
    const view=await mount();let deny!:(reason:Error)=>void;vi.mocked(decisionIntelligenceApi.detail).mockImplementation(()=>new Promise((_resolve,reject)=>{deny=reject;}));
    await act(async()=>{void view.client.invalidateQueries({queryKey:["decision-context",id(1),state.userId,id(2)]});});await flush();expect(view.container.textContent).not.toContain("Private prospective question");
    await act(async()=>deny(new Error("Current source access denied")));await flush();expect(view.container.textContent).not.toContain("Private prospective question");expect(view.container.textContent).toContain("Current source access denied");await view.cleanup();
  });
  it("discards visible context on account/company switches, permission events and expiry",async()=>{
    const view=await mount();state.companyId=id(9);await view.render();expect(view.container.textContent).not.toContain("Private prospective question");state.companyId=id(1);state.userId="account-two";vi.mocked(decisionIntelligenceApi.detail).mockRejectedValue(new Error("Second account has no source access"));await view.render();expect(view.container.textContent).not.toContain("Private prospective question");expect(decisionIntelligenceApi.detail).toHaveBeenCalledWith(id(1),id(2),"account-two");await view.cleanup();
    state.userId="account-one";vi.mocked(decisionIntelligenceApi.detail).mockResolvedValue(context("2000-01-01T00:00:00Z"));const expired=await mount();expect(expired.container.textContent).not.toContain("Private prospective question");await expired.cleanup();
    vi.mocked(decisionIntelligenceApi.detail).mockResolvedValue(context());const revoked=await mount();vi.mocked(decisionIntelligenceApi.detail).mockRejectedValue(new Error("Memory source authority withdrawn"));await act(async()=>window.dispatchEvent(new Event("memory-access-changed")));await flush();expect(revoked.container.textContent).not.toContain("Private prospective question");await revoked.cleanup();
  });
  it("renders the captured epistemic state as read-only after the native choice",async()=>{
    const frozen=context();frozen.binding={versionId:id(3),optionId:"proceed",contextHash:"a".repeat(64),decisionSpecHash:"b".repeat(64),frozenAt:"2026-10-07T01:00:00Z"};frozen.versions[0].state="frozen_for_decision";vi.mocked(decisionIntelligenceApi.detail).mockResolvedValue(frozen);
    const view=await mount({...decision(),status:"decided",chosenOptionId:"proceed",decidedAt:frozen.binding.frozenAt});expect(view.container.textContent).toContain("Frozen at the native decision");expect(view.container.textContent).toContain("Later observations belong in a separate outcome review");expect(button(view.container,"Prepare this context")).toBeUndefined();expect(button(view.container,"Propose a context revision")).toBeUndefined();await view.cleanup();
  });
});
