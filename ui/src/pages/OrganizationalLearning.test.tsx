// @vitest-environment jsdom
import {act} from "react";
import {MemoryRouter} from "react-router-dom";
import {createRoot,type Root} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {ApiError} from "@/api/client";
import {OrganizationalLearning} from "./OrganizationalLearning";

// UI response contracts; native source authority is tested on PostgreSQL.
const state=vi.hoisted(()=>({companyId:"company",search:"",planning:{outcome:vi.fn(),startOutcomeLearning:vi.fn()},reviews:{detail:vi.fn(),startLearning:vi.fn()},setBreadcrumbs:vi.fn(),learning:{list:vi.fn(),get:vi.fn(),create:vi.fn(),prepare:vi.fn(),hypothesis:vi.fn(),evaluate:vi.fn(),propose:vi.fn(),finish:vi.fn()},memory:{listRecords:vi.fn()},foundation:{list:vi.fn()},issues:{list:vi.fn()}}));
const source={type:"metric_observation" as const,id:"00000000-0000-4000-8000-000000004001",metricId:"00000000-0000-4000-8000-000000004002",metricVersionId:"00000000-0000-4000-8000-000000004003"};
vi.mock("@/api/adaptive-planning",()=>({adaptivePlanningApi:state.planning}));
vi.mock("@/api/decision-outcome-reviews",()=>({decisionOutcomeReviewsApi:state.reviews}));
vi.mock("@/context/V7AccountScope",()=>({withV7AccountScope:(Page:unknown)=>Page,useV7AccountScope:()=>({principalId:"user:current-human",learningApi:state.learning,memoryApi:state.memory,foundationApi:state.foundation,issuesApi:state.issues})}));
vi.mock("@/context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:state.companyId})}));
vi.mock("@/context/BreadcrumbContext",()=>({useBreadcrumbs:()=>({setBreadcrumbs:state.setBreadcrumbs})}));
vi.mock("@/components/CognitivePurposeSelector",()=>({CognitivePurposeSelector:()=>null}));
vi.mock("@/components/LearningPolicyReview",()=>({LearningPolicyReview:()=>null}));
vi.mock("@/lib/router",()=>({Link:({children,to}:{children:React.ReactNode;to:string})=><a href={to}>{children}</a>}));
vi.mock("@/components/ManagementReviewSourcePicker",()=>({ManagementReviewSourcePicker:({onChange,onValidity,allowedKinds}:{onChange:(value:unknown)=>void;onValidity:(value:boolean)=>void;allowedKinds:string[]})=><button type="button" onClick={()=>{expect(allowedKinds).toEqual(["analytical","decision_outcome"]);onChange({kind:"analytical",reference:source});onValidity(true);}}>Choose current signal</button>}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement,client:QueryClient;
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});};
const button=(name:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===name)!;
const click=async(name:string)=>{await act(async()=>button(name).click());await flush();};
const cycle={id:"cycle",companyId:"company",version:1,scopeType:"company",scopeId:null,purpose:"native_task_execution",trigger:"Reviewed work outcomes",status:"evaluating",maxHypotheses:5,maxEvaluations:10,createdAt:"2026-10-07T00:00:00.000Z"};
beforeEach(()=>{vi.clearAllMocks();state.companyId="company";state.search="";state.reviews.detail.mockResolvedValue(null);state.reviews.startLearning.mockResolvedValue({cycleId:"cycle"});state.learning.list.mockResolvedValue([]);state.learning.get.mockResolvedValue({...cycle,hypotheses:[],evaluations:[],candidates:[]});state.learning.create.mockResolvedValue(cycle);state.memory.listRecords.mockResolvedValue([{id:"verified-memory",scopeType:"company",retentionState:"active",verificationState:"human_verified",title:"Verified native outcome",content:"Synthetic reviewed outcome"}]);state.foundation.list.mockResolvedValue([]);state.issues.list.mockResolvedValue([]);});
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();container?.remove();});
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});container=document.createElement("div");document.body.append(container);root=createRoot(container);await render();await flush();}
async function render(){await act(async()=>root.render(<MemoryRouter initialEntries={[`/memory/learning${state.search}`]}><QueryClientProvider client={client}><OrganizationalLearning/></QueryClientProvider></MemoryRouter>));}
it("rechecks the exact native planning outcome and keeps verified Memory required",async()=>{
 const projectId="00000000-0000-4000-8000-000000007001",proposalId="00000000-0000-4000-8000-000000007002",manifestId="00000000-0000-4000-8000-000000007003";
 state.search=`?planningCompanyId=company&planningProjectId=${projectId}&planningProposalId=${proposalId}&planningManifestId=${manifestId}`;
 state.planning.outcome.mockResolvedValue({manifestId,outcome:{companyId:"company",projectId,proposalId,rationale:"Software descriptive completion signal",expiresAt:new Date(Date.now()+60000).toISOString()}});
 state.planning.startOutcomeLearning.mockResolvedValue({cycleId:"cycle"});
 await mount();expect(container.textContent).toContain("Software descriptive completion signal");expect(button("Start bounded cycle").disabled).toBe(true);
 await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 const input=container.querySelector<HTMLInputElement>('input[minlength="10"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Test capacity review against independently verified outcomes");input.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Start bounded cycle");
 expect(state.planning.startOutcomeLearning).toHaveBeenCalledWith("company",projectId,proposalId,{manifestId,purpose:"native_task_execution",trigger:"Test capacity review against independently verified outcomes",memoryRecordIds:["verified-memory"]},"current-human");
 expect(state.learning.create).not.toHaveBeenCalled();
});
it("withholds retained planning feedback when current access is denied",async()=>{
 const projectId="00000000-0000-4000-8000-000000007001",proposalId="00000000-0000-4000-8000-000000007002",manifestId="00000000-0000-4000-8000-000000007003";
 state.search=`?planningCompanyId=company&planningProjectId=${projectId}&planningProposalId=${proposalId}&planningManifestId=${manifestId}`;
 state.planning.outcome.mockResolvedValue({manifestId,outcome:{companyId:"company",projectId,proposalId,rationale:"Private completion review",expiresAt:new Date(Date.now()+60000).toISOString()}});
 await mount();expect(container.textContent).toContain("Private completion review");
 state.planning.outcome.mockRejectedValue(new ApiError("Source access denied",403,null));
 await act(async()=>window.dispatchEvent(new Event("memory-access-changed")));await flush();
 expect(container.textContent).not.toContain("Private completion review");expect(button("Start bounded cycle").disabled).toBe(true);
});
it("keeps verified outcomes required and sends only the selected native signal pin",async()=>{
 await mount();await click("Add analytical signal");expect(button("Start bounded cycle").disabled).toBe(true);
 await click("Choose current signal");expect(button("Start bounded cycle").disabled).toBe(true);
 await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 const input=container.querySelector<HTMLInputElement>('input[minlength="10"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Synthetic current source informed this problem");input.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(button("Start bounded cycle").disabled).toBe(false);
 await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));await flush();
 expect(state.learning.create).toHaveBeenCalledWith("company",{scope:{type:"company",id:null},purpose:"native_task_execution",trigger:"Synthetic current source informed this problem",memoryRecordIds:["verified-memory"],analyticalSources:[{kind:"analytical_evidence",source}]});
});
it.each([new ApiError("Source access lost",403,{details:{code:"analytical_source_access_lost"}}),new ApiError("Learning cycle not found",404,null)])("hides cached Learning claims without retrying permanent native source loss: $message",async(error)=>{
 state.learning.list.mockResolvedValue([cycle]);await mount();
 client.setQueryData(["learning-cycle","company","user:current-human","cycle"],{...cycle,hypotheses:[{id:"hypothesis",claim:"Synthetic retained private analytical claim",predictedEffect:"Synthetic retained private prediction",status:"candidate",targetDomain:"foundation",riskClass:"material",version:1,evaluationContract:{protectedInvariants:["Human review stays mandatory"]}}],evaluations:[],candidates:[]});
 const select=[...container.querySelectorAll<HTMLSelectElement>("select")].find(item=>item.querySelector('option[value="cycle"]'))!;
 await act(async()=>{select.value="cycle";select.dispatchEvent(new Event("change",{bubbles:true}));});await flush();
 expect(container.textContent).toContain("Synthetic retained private analytical claim");
 state.learning.get.mockRejectedValue(error);
 await act(async()=>{await client.invalidateQueries({queryKey:["learning-cycle","company","user:current-human","cycle"]});});await flush();
 expect(container.textContent).not.toContain("Synthetic retained private analytical claim");expect(container.textContent).not.toContain("Synthetic retained private prediction");expect(container.textContent).toContain(error.message);
 expect(state.learning.get).toHaveBeenCalledTimes(1);
});
it("drops selected signal references when the company changes",async()=>{
 await mount();await click("Add analytical signal");await click("Choose current signal");state.companyId="other-company";await render();await flush();
 expect(container.textContent).not.toContain("Choose current signal");expect(state.learning.create).not.toHaveBeenCalled();
});

it("starts Learning from the exact currently admitted review while still requiring verified outcomes",async()=>{
 const decisionId="00000000-0000-4000-8000-000000006001";
 state.search=`?reviewCompanyId=company&reviewDecisionId=${decisionId}&reviewRevision=3`;
 state.reviews.detail.mockResolvedValue({id:"review",companyId:"company",decisionId,revision:3,status:"inconclusive",receipts:[{expiresAt:"2099-01-01T00:00:00Z",assessment:{lessonSummary:"Synthetic reviewed human lesson"}}]});
 await mount();expect(container.textContent).toContain("Synthetic reviewed human lesson");expect(container.textContent).not.toContain("Optional analytical signals");expect(button("Start bounded cycle").disabled).toBe(true);
 await act(async()=>container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 const input=container.querySelector<HTMLInputElement>('input[required][minlength="10"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Test the reviewed lesson against independently verified work");input.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Start bounded cycle");
 expect(state.reviews.startLearning).toHaveBeenCalledWith("company",decisionId,{expectedRevision:3,purpose:"native_task_execution",trigger:"Test the reviewed lesson against independently verified work",memoryRecordIds:["verified-memory"]},"current-human");expect(state.learning.create).not.toHaveBeenCalled();
});
it("blocks a seeded review after source loss or a company switch and clears retained source prose",async()=>{
 const decisionId="00000000-0000-4000-8000-000000006001";
 state.search=`?reviewCompanyId=company&reviewDecisionId=${decisionId}&reviewRevision=3`;
 state.reviews.detail.mockResolvedValue({id:"review",companyId:"company",decisionId,revision:3,status:"inconclusive",receipts:[{expiresAt:"2099-01-01T00:00:00Z",assessment:{lessonSummary:"Synthetic private reviewed lesson"}}]});
 await mount();expect(container.textContent).toContain("Synthetic private reviewed lesson");
 state.reviews.detail.mockRejectedValue(new ApiError("Review source unavailable",403,null));
 await act(async()=>{await client.invalidateQueries({queryKey:["learning-review-source","company","user:current-human"]});});await flush();
 expect(container.textContent).not.toContain("Synthetic private reviewed lesson");expect(button("Start bounded cycle").disabled).toBe(true);
 state.companyId="other-company";await render();await flush();expect(container.textContent).toContain("original company");expect(state.reviews.startLearning).not.toHaveBeenCalled();
});
