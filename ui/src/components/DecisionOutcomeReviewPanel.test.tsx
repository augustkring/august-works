// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {decisionContextDefinitionSchema,type DecisionContextVersionView,type DecisionOutcomeReviewView} from "@paperclipai/shared";
import {DecisionOutcomeReviewPanel} from "./DecisionOutcomeReviewPanel";
import {decisionOutcomeReviewsApi} from "@/api/decision-outcome-reviews";
vi.mock("@/api/decision-outcome-reviews",()=>({decisionOutcomeReviewsApi:{detail:vi.fn(),schedule:vi.fn(),transition:vi.fn(),finish:vi.fn()}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const version=():DecisionContextVersionView=>({id:id(3),companyId:id(1),decisionId:id(2),revision:1,evidence:[],contentHash:"a".repeat(64),decisionSpecHash:"b".repeat(64),createdAt:"2026-10-07T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z",state:"frozen_for_decision",
  definition:decisionContextDefinitionSchema.parse({question:"Should we extend the delivery review?",objective:"Review useful outcomes using a human-owned choice",ownerUserId:"account-one",scope:{type:"company",id:null},timeHorizon:{from:"2026-10-07T00:00:00Z",until:"2027-01-01T00:00:00Z"},uncertaintySummary:"Delivery conditions and outcomes remain uncertain",revisitAt:null,sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[id(4)],retentionDays:30,evidence:[],
    assumptions:[{key:"capacity",statement:"Delivery capacity remains available throughout the horizon",type:"delivery",confidence:{kind:"human_judgment",level:"medium"},materiality:"high",status:"unverified"}],criteria:[{key:"delivery",name:"Delivery",description:"Capacity to deliver useful business outcomes",type:"qualitative",priority:"high",evidenceKey:null}],expectedOutcomes:[{kind:"qualitative",optionId:"proceed",statement:"Observe useful delivery within the declared horizon",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"Human expectation without a calibrated prediction interval"}]})});
const review=(status:DecisionOutcomeReviewView["status"]="scheduled"):DecisionOutcomeReviewView=>({id:id(5),companyId:id(1),decisionId:id(2),contextVersionId:id(3),contextHash:"a".repeat(64),optionId:"proceed",revision:status==="in_review"?2:1,status,reviewDueAt:"2027-01-02T00:00:00Z",reviewedAt:null,reviewedByUserId:null,causalClaimRef:null,learningCycleId:null,authorizationCheckedAt:new Date().toISOString(),
  receipts:[{revision:status==="in_review"?2:1,action:status==="in_review"?"begin":"schedule",fromState:status==="in_review"?"scheduled":null,toState:status==="in_review"?"in_review":"scheduled",rationale:"Private retained human review rationale",recordedBy:"account-one",recordedAt:"2026-10-07T01:00:00Z",contextHash:"a".repeat(64),contentHash:"c".repeat(64),assessment:null,actualEvidence:[],comparisons:[],nativeExecution:null,expiresAt:"2099-01-01T00:00:00Z"}]});
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
async function mount(userId="account-one") {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}),container=document.createElement("div");document.body.append(container);const root=createRoot(container),onEditing=vi.fn();
  const render=async(account=userId)=>{await act(async()=>root.render(<QueryClientProvider client={client}><DecisionOutcomeReviewPanel key={account} companyId={id(1)} userId={account} decisionId={id(2)} version={version()} optionId="proceed" chosenAt="2026-10-07T01:00:00Z" onEditingChange={onEditing}/></QueryClientProvider>));await flush();await flush();};await render();
  return {container,client,render,onEditing,cleanup:async()=>{await act(async()=>root.unmount());client.clear();container.remove();}};
}
const button=(container:HTMLElement,name:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===name)!;
async function click(container:HTMLElement,name:string) {await act(async()=>button(container,name).click());await flush();}
async function fill(field:HTMLTextAreaElement,value:string) {await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));});await flush();}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(decisionOutcomeReviewsApi.detail).mockResolvedValue(null);});
describe("Human native outcome review",()=>{
  it("requires a rationale and pins scheduling to the exact frozen native context",async()=>{
    vi.mocked(decisionOutcomeReviewsApi.schedule).mockResolvedValue(review());const view=await mount();expect(decisionOutcomeReviewsApi.detail).toHaveBeenCalledWith(id(1),id(2),"account-one");expect(button(view.container,"Schedule outcome review").disabled).toBe(true);
    await fill(view.container.querySelector("textarea")!,"The human schedules a separate assessment of the chosen outcome");await click(view.container,"Schedule outcome review");
    expect(decisionOutcomeReviewsApi.schedule).toHaveBeenCalledWith(id(1),id(2),{contextVersionId:id(3),rationale:"The human schedules a separate assessment of the chosen outcome"},"account-one");expect(decisionOutcomeReviewsApi.finish).not.toHaveBeenCalled();await view.cleanup();
  });
  it("begins the existing review with its exact revision and does not invent final assessments",async()=>{
    vi.mocked(decisionOutcomeReviewsApi.detail).mockResolvedValue(review());vi.mocked(decisionOutcomeReviewsApi.transition).mockResolvedValue(review("in_review"));const view=await mount();await fill(view.container.querySelector("textarea")!,"The human begins the outcome assessment using the current baseline");await click(view.container,"Begin outcome review");
    expect(decisionOutcomeReviewsApi.transition).toHaveBeenCalledWith(id(1),id(2),{expectedRevision:1,action:"begin",rationale:"The human begins the outcome assessment using the current baseline"},"account-one");expect(decisionOutcomeReviewsApi.finish).not.toHaveBeenCalled();await view.cleanup();
  });
  it("requires six explanations and frozen assumption validation before recording an explicitly inconclusive result",async()=>{
    vi.mocked(decisionOutcomeReviewsApi.detail).mockResolvedValue(review("in_review"));vi.mocked(decisionOutcomeReviewsApi.finish).mockResolvedValue({...review("in_review"),status:"inconclusive",revision:3});const view=await mount();await click(view.container,"Assess decision outcomes");expect(view.onEditing).toHaveBeenLastCalledWith(true);expect(button(view.container,"Record outcome review").disabled).toBe(true);
    const form=view.container.querySelector('form[aria-label="Decision outcome assessment"]')!;
    for(const field of form.querySelectorAll<HTMLTextAreaElement>("textarea")) await fill(field,"Human judgment: this evidence remains incomplete and requires review");
    expect(button(view.container,"Record outcome review").disabled).toBe(false);await click(view.container,"Record outcome review");
    expect(decisionOutcomeReviewsApi.finish).toHaveBeenCalledWith(id(1),id(2),expect.objectContaining({expectedRevision:2,result:"inconclusive",actualMetrics:[],assumptionOutcomes:[expect.objectContaining({key:"capacity",assessment:"inconclusive",kind:"human_judgment"})],assessments:expect.objectContaining({decisionProcessQuality:expect.objectContaining({kind:"human_judgment"}),causalConfidence:expect.objectContaining({assessment:"not_assessed"})})}),"account-one");await view.cleanup();
  });
  it("hides retained rationale while reauthorizing and after later source denial",async()=>{
    vi.mocked(decisionOutcomeReviewsApi.detail).mockResolvedValue(review());const view=await mount();expect(view.container.textContent).toContain("Private retained human review rationale");let reject!:(error:Error)=>void;vi.mocked(decisionOutcomeReviewsApi.detail).mockImplementation(()=>new Promise((_resolve,deny)=>{reject=deny;}));
    await act(async()=>{void view.client.invalidateQueries({queryKey:["decision-outcome-review",id(1),"account-one",id(2)]});});await flush();expect(view.container.textContent).not.toContain("Private retained human review rationale");await act(async()=>reject(new Error("Later native source is unavailable")));await flush();expect(view.container.textContent).not.toContain("Private retained human review rationale");expect(view.container.textContent).toContain("Later native source is unavailable");await view.cleanup();
  });
  it("clears an unsaved assessment on privacy/account changes and never exposes expired receipts",async()=>{
    vi.mocked(decisionOutcomeReviewsApi.detail).mockResolvedValue(review("in_review"));const view=await mount();await click(view.container,"Assess decision outcomes");expect(view.container.querySelector("form")).not.toBeNull();vi.mocked(decisionOutcomeReviewsApi.detail).mockRejectedValue(new Error("Review authority withdrawn"));await act(async()=>window.dispatchEvent(new Event("memory-access-changed")));await flush();expect(view.container.querySelector("form")).toBeNull();expect(view.container.textContent).not.toContain("Private retained human review rationale");await view.render("account-two");expect(decisionOutcomeReviewsApi.detail).toHaveBeenCalledWith(id(1),id(2),"account-two");await view.cleanup();
    const expired=review();expired.receipts[0].expiresAt="2000-01-01T00:00:00Z";vi.mocked(decisionOutcomeReviewsApi.detail).mockResolvedValue(expired);const stale=await mount();expect(stale.container.textContent).not.toContain("Private retained human review rationale");expect(stale.container.textContent).toContain("Retained review evidence is unavailable");await stale.cleanup();
  });
});
