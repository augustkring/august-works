// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {ApiError} from "@/api/client";
import {OrganizationalLearning} from "./OrganizationalLearning";

// UI response contracts; native source authority is tested on PostgreSQL.
const state=vi.hoisted(()=>({companyId:"company",setBreadcrumbs:vi.fn(),learning:{list:vi.fn(),get:vi.fn(),create:vi.fn(),prepare:vi.fn(),hypothesis:vi.fn(),evaluate:vi.fn(),propose:vi.fn(),finish:vi.fn()},memory:{listRecords:vi.fn()},foundation:{list:vi.fn()},issues:{list:vi.fn()}}));
const source={type:"metric_observation" as const,id:"00000000-0000-4000-8000-000000004001",metricId:"00000000-0000-4000-8000-000000004002",metricVersionId:"00000000-0000-4000-8000-000000004003"};
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
beforeEach(()=>{vi.clearAllMocks();state.companyId="company";state.learning.list.mockResolvedValue([]);state.learning.get.mockResolvedValue({...cycle,hypotheses:[],evaluations:[],candidates:[]});state.learning.create.mockResolvedValue(cycle);state.memory.listRecords.mockResolvedValue([{id:"verified-memory",scopeType:"company",retentionState:"active",title:"Verified native outcome",content:"Synthetic reviewed outcome"}]);state.foundation.list.mockResolvedValue([]);state.issues.list.mockResolvedValue([]);});
afterEach(async()=>{await act(async()=>root?.unmount());client?.clear();container?.remove();});
async function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});container=document.createElement("div");document.body.append(container);root=createRoot(container);await render();await flush();}
async function render(){await act(async()=>root.render(<QueryClientProvider client={client}><OrganizationalLearning/></QueryClientProvider>));}
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
it("hides previously cached Learning claims immediately when a current source read is denied",async()=>{
 state.learning.list.mockResolvedValue([cycle]);await mount();
 client.setQueryData(["learning-cycle","company","user:current-human","cycle"],{...cycle,hypotheses:[{id:"hypothesis",claim:"Synthetic retained private analytical claim",predictedEffect:"Synthetic retained private prediction",status:"candidate",targetDomain:"foundation",riskClass:"material",version:1,evaluationContract:{protectedInvariants:["Human review stays mandatory"]}}],evaluations:[],candidates:[]});
 const select=[...container.querySelectorAll<HTMLSelectElement>("select")].find(item=>item.querySelector('option[value="cycle"]'))!;
 await act(async()=>{select.value="cycle";select.dispatchEvent(new Event("change",{bubbles:true}));});await flush();
 expect(container.textContent).toContain("Synthetic retained private analytical claim");
 state.learning.get.mockRejectedValue(new ApiError("Source access lost",403,{details:{code:"analytical_source_access_lost"}}));
 await act(async()=>{await client.invalidateQueries({queryKey:["learning-cycle","company","user:current-human","cycle"]});});await flush();
 expect(container.textContent).not.toContain("Synthetic retained private analytical claim");expect(container.textContent).not.toContain("Synthetic retained private prediction");expect(container.textContent).toContain("Source access lost");
 expect(state.learning.get).toHaveBeenCalledTimes(1);
});
it("drops selected signal references when the company changes",async()=>{
 await mount();await click("Add analytical signal");await click("Choose current signal");state.companyId="other-company";await render();await flush();
 expect(container.textContent).not.toContain("Choose current signal");expect(state.learning.create).not.toHaveBeenCalled();
});
