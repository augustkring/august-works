// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {AutomationArtifacts} from "./AutomationArtifacts";

// Browser response contracts; original Source authority is separately exercised
// against actual PostgreSQL. The real shared account wrapper/client runs here.
const state=vi.hoisted(()=>({userId:"a",localImplicit:false,settled:true,failed:false,companyId:"company",lost:false,optimizer:false,breadcrumbs:vi.fn()}));
vi.mock("@/api/companies-query",()=>({useAccountIdentity:()=>state}));
vi.mock("@/context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:state.companyId})}));
vi.mock("@/context/BreadcrumbContext",()=>({useBreadcrumbs:()=>({setBreadcrumbs:state.breadcrumbs})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const artifact={id:"artifact",companyId:"company",name:"Private learned candidate",description:"Retained analytical description",status:"testing",archivedAt:null,kind:"transform",riskClass:"C0",sideEffectClass:"pure"};
const independent={...artifact,id:"independent",name:"Independent native automation",description:"Independent fixture"};
const detail={artifact,latestVersion:{id:"version",contentHash:"hash",sourceCode:"Retained private analytical source code",inputSchema:{},outputSchema:{},testSpec:{},validationReport:{status:"passed"},securityReport:{status:"passed"}}};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
let root:Root,container:HTMLDivElement,client:QueryClient;
let fetch:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 Object.assign(state,{userId:"a",localImplicit:false,settled:true,failed:false,companyId:"company",lost:false,optimizer:false});
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
 fetch=vi.fn(async(url:string)=>{
  const parsed=new URL(url,"http://localhost"),principal=parsed.searchParams.get("expectedActorId");
  if(parsed.pathname.endsWith("/experimental"))return response({enableAutomationArtifactsV1:true});
  if(parsed.pathname.endsWith("/capabilities"))return response({edit:true,publish:true});
  if(parsed.pathname.endsWith("/automation-artifacts"))return response(state.lost||principal==="user:b"?[independent]:[artifact,independent]);
  if(parsed.pathname.endsWith("/automation-artifacts/artifact"))return state.lost||principal==="user:b"?response({error:"Current source access lost",details:{code:"analytical_source_access_lost"}},403):response(state.optimizer?{...detail,artifact:{...artifact,createdByOptimizerSuggestionId:"suggestion",originWorkflowId:"workflow"}}:detail);
  throw new Error(`Unexpected fixture URL ${parsed.pathname}`);
 });vi.stubGlobal("fetch",fetch);
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();container.remove();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(<MemoryRouter initialEntries={["/automation-artifacts?artifactId=artifact"]}><QueryClientProvider client={client}><AutomationArtifacts/></QueryClientProvider></MemoryRouter>));
const ready=()=>act(async()=>{await vi.waitFor(()=>expect(container.textContent).toContain("Retained private analytical source code"));});
async function draft(){await act(async()=>{const field=container.querySelector<HTMLTextAreaElement>("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"Copied private analytical draft");field.dispatchEvent(new Event("input",{bubbles:true}));});}
it("clears retained code and draft after current Source denial while preserving independent catalogue entries",async()=>{
 await render();await ready();await draft();state.lost=true;
 await act(async()=>{await client.invalidateQueries({queryKey:["automation-artifact","company","user:a","artifact"]});});
 await act(async()=>{await vi.waitFor(()=>expect(container.textContent).toContain("Current source access lost"));});
 expect(container.textContent).not.toContain("Retained private analytical source code");
 expect(container.textContent).not.toContain("Retained analytical description");
 expect(container.querySelector("textarea")!.value).toBe("");
 await act(async()=>{await vi.waitFor(()=>expect(container.textContent).toContain("Independent native automation"));});
 expect(container.textContent).not.toContain("Private learned candidate");
 expect(container.textContent).not.toContain("Activate reviewed version");
 expect(fetch.mock.calls.filter(([url])=>String(url).includes("/automation-artifacts/artifact"))).toHaveLength(2);
});
it("remounts forms and keeps prior account code out of the next account's queries",async()=>{
 await render();await ready();await draft();fetch.mockClear();state.userId="b";await render();
 expect(container.textContent).not.toContain("Retained private analytical source code");
 expect(container.querySelector("textarea")?.value).not.toBe("Copied private analytical draft");
 await act(async()=>{await vi.waitFor(()=>expect(container.textContent).toContain("Current source access lost"));});
 expect(fetch.mock.calls.every(([url])=>new URL(String(url),"http://localhost").searchParams.get("expectedActorId")==="user:b")).toBe(true);
 expect(client.getQueryData(["automation-artifact","company","user:b","artifact"])).toBeUndefined();
});

it("keeps live optimizer promotion in its original workflow rather than offering generic activation",async()=>{
 state.optimizer=true;await render();await ready();
 expect(container.textContent).toContain("Optimizer candidates require replay, shadow review, approval and a canary");
 expect(container.textContent).not.toContain("Activate reviewed version");
 expect(container.querySelector('a[href$="/workflows/workflow"]')?.textContent).toBe("Open workflow review");
});
