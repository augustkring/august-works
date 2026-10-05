// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaasRuntimesPage } from "./SaasRuntimes";

const fixture=vi.hoisted(()=>({userId:"owner-a",companyId:"company-a",runtime:true,runtimes:vi.fn(),options:vi.fn(),create:vi.fn(),operation:vi.fn(),bind:vi.fn()}));
vi.mock("@/api/companies-query",()=>({useAccountIdentity:()=>({userId:fixture.userId})}));
vi.mock("@/context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:fixture.companyId})}));
vi.mock("@/hooks/useSaasCapabilities",()=>({useSaasCapabilities:()=>({data:{runtime:fixture.runtime},isPending:false})}));
vi.mock("@/api/client",()=>({api:{get:async()=>[]}}));
vi.mock("@/api/saas",()=>({saasApi:{runtimes:fixture.runtimes,runtimeOptions:fixture.options,createRuntime:fixture.create,runtimeOperation:fixture.operation,bindRuntime:fixture.bind}}));
vi.mock("@/lib/router",()=>({Link:({children,to}:{children:React.ReactNode;to:string})=><a href={to}>{children}</a>}));
vi.mock("@/components/SaasRuntimeRecovery",()=>({SaasRuntimeRecovery:()=>null}));
vi.mock("@/components/SaasRuntimeBackupSchedule",()=>({SaasRuntimeBackupSchedule:()=>null}));
vi.mock("@/components/SaasModelProviderForm",()=>({SaasModelProviderForm:()=>null}));

describe("SaaS runtime account and retry boundaries",()=>{
  let container:HTMLDivElement,root:Root,client:QueryClient;
  beforeEach(()=>{
    fixture.userId="owner-a";fixture.companyId="company-a";fixture.runtime=true;
    vi.clearAllMocks();fixture.runtimes.mockImplementation(async(company:string)=>[{id:company+"-cell",companyId:company,status:"STOPPED",capacityProfile:company+"-profile",isolationMode:"company_cell",generation:"1",deletedAt:null}]);
    fixture.options.mockResolvedValue({profiles:[{key:"standard"}],versions:[{imageDigest:"fixture-digest",providerVersion:"fixture-version"}],dedicatedGateway:false,dedicatedVm:false});
    fixture.create.mockResolvedValue({});fixture.operation.mockResolvedValue({});fixture.bind.mockResolvedValue({});
    container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
  });
  afterEach(async()=>{await act(async()=>root.unmount());client.clear();container.remove();});
  async function render(){await act(async()=>{root.render(<QueryClientProvider client={client}><SaasRuntimesPage/></QueryClientProvider>);});await flush();}
  async function flush(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}
  async function choose(label:string,value:string){const select=Array.from(container.querySelectorAll("label")).find(item=>item.textContent?.includes(label))!.querySelector("select")!;await act(async()=>{select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});}
  async function click(label:string){const button=Array.from(container.querySelectorAll("button")).find(item=>item.textContent===label)!;expect(button).toBeTruthy();await act(async()=>button.click());await flush();}
  it("does not apply an old creation result to a different account or company",async()=>{
    let resolve!: (value:unknown)=>void;fixture.create.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    await render();await choose("Capacity","standard");await choose("Version","fixture-digest");await click("Create runtime");
    expect(fixture.create.mock.calls[0]!.slice(0,2)).toEqual(["company-a","owner-a"]);
    fixture.userId="owner-b";fixture.companyId="company-b";await render();
    expect(container.textContent).toContain("company-b-profile");expect(container.textContent).not.toContain("company-a-profile");
    const reads=fixture.runtimes.mock.calls.filter(call=>call[0]==="company-b").length;
    await act(async()=>resolve({}));await flush();
    expect(fixture.runtimes.mock.calls.filter(call=>call[0]==="company-b")).toHaveLength(reads);
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("");
  });
  it("retries an ambiguous runtime operation with the original request identifier",async()=>{
    fixture.operation.mockRejectedValueOnce(Error("Lost operation acknowledgement"));
    await render();await click("Start");expect(container.textContent).toContain("Lost operation acknowledgement");await click("Start");
    expect(fixture.operation.mock.calls).toHaveLength(2);
    expect(fixture.operation.mock.calls[1]![3]).toEqual(fixture.operation.mock.calls[0]![3]);
  });
  it("does not load runtime data while rollout is closed",async()=>{
    fixture.runtime=false;await render();expect(fixture.runtimes).not.toHaveBeenCalled();expect(fixture.options).not.toHaveBeenCalled();expect(container.textContent).toContain("not available yet");
  });
});
