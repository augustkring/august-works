// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROCESS_DATA_DIMENSIONS, processAnalysisDefinitionSchema, type ProcessAnalysisDefinitionDetail, type ProcessAnalysisRunView } from "@paperclipai/shared";
import { ProcessIntelligence } from "./ProcessIntelligence";
import { processAnalysisApi } from "@/api/process-analysis";
const fixture=vi.hoisted(()=>({companyId:"00000000-0000-4000-8000-000000000001",userId:"account-one",settled:true,failed:false,breadcrumbs:vi.fn()}));
vi.mock("@/context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:fixture.companyId})}));
vi.mock("@/context/BreadcrumbContext",()=>({useBreadcrumbs:()=>({setBreadcrumbs:fixture.breadcrumbs})}));
vi.mock("@/api/companies-query",()=>({useAccountIdentity:()=>fixture}));
vi.mock("@/lib/router",()=>({Link:({to,children}:{to:string;children:React.ReactNode})=><a href={to}>{children}</a>}));
vi.mock("@/api/process-analysis",()=>({processAnalysisApi:{list:vi.fn(),detail:vi.fn(),create:vi.fn(),revise:vi.fn(),publish:vi.fn(),retire:vi.fn(),run:vi.fn(),getRun:vi.fn(),listRuns:vi.fn()}}));
vi.mock("@/api/ai-governance",()=>({aiGovernanceApi:{obligations:vi.fn(async()=>[{id:"00000000-0000-4000-8000-000000000004",obligation:{framework:"company_policy",citation:"Reviewed process purpose",analyticalPurpose:{status:"approved",purpose:"process_intelligence",capabilities:["process"]}}}])}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
// jsdom has no layout observer; real checkbox layout is checked in Chromium.
vi.stubGlobal("ResizeObserver",class {observe() {} unobserve() {} disconnect() {}});
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function detail(status:"draft"|"published"="published",expiresAt="2099-01-01T00:00:00Z"):ProcessAnalysisDefinitionDetail {
  const definition=processAnalysisDefinitionSchema.parse({name:"Recorded native task flow",businessQuestion:"Private reviewed process question for the current account",ownerUserId:fixture.userId,
    reviewFrequencyDays:30,retentionDays:30,scope:"company",sensitivity:"internal",purpose:"process_intelligence",governanceObligationRefs:[id(4)],
    requiredSourceProviders:["activity_log"],objectTypes:["issue"],requiredActivities:["issue.created","issue.updated"],minimumCoverageSeconds:3600,
    analysisFamilies:["event_volume","cycle_time"],requiresArrivalEvidence:false,maxLateArrivalRate:0});
  const pin={id:id(3),companyId:fixture.companyId,definitionId:id(2),revision:1,definition,contentHash:"a".repeat(64),createdAt:"2026-01-01T00:00:00Z",nextReviewAt:"2098-01-01T00:00:00Z",expiresAt};
  return {root:{id:id(2),companyId:fixture.companyId,key:"task_flow",revision:status==="draft" ? 1 : 2,status,publishedVersionId:status==="draft" ? null :pin.id,createdAt:pin.createdAt,updatedAt:pin.createdAt},
    effectiveVersion:pin,latestVersion:pin,versions:[pin],hasMoreVersions:false,reviewReason:null};
}
function page(value:ProcessAnalysisDefinitionDetail|null) {return {items:value ? [{...value.root,definition:value.effectiveVersion.definition,nextReviewAt:value.effectiveVersion.nextReviewAt,expiresAt:value.effectiveVersion.expiresAt,reviewReason:null}] : [],nextCursor:null,coverage:"bounded_current_authorized_page" as const};}
function run(expiresAt="2099-01-01T00:00:00Z"):ProcessAnalysisRunView {
  return {id:id(5),companyId:fixture.companyId,definitionId:id(2),versionId:id(3),lineageManifestId:id(6),definitionHash:"a".repeat(64),eventSetHash:"b".repeat(64),
    from:"2026-01-01T00:00:00Z",until:"2026-01-02T00:00:00Z",createdAt:"2026-01-03T00:00:00Z",authorizationCheckedAt:new Date().toISOString(),expiresAt,
    result:{engineVersion:"aw-native-object-process-v1",status:"succeeded",errorCode:null,semantics:"observed_native_activity_paths_no_causal_or_person_effect",
      readiness:{companyId:fixture.companyId,engineVersion:"aw-native-process-data-readiness-v1",status:"ready",admission:"DATA_READY",analysisKey:"published_native_process",requirementHash:"c".repeat(64),eventSetHash:"b".repeat(64),
        assessedAt:"2026-01-03T00:00:00Z",expiresAt:"2026-01-03T00:05:00Z",authorizedEventCount:2,coverage:"current_native_activity_snapshot",findings:[],
        dimensions:PROCESS_DATA_DIMENSIONS.map(dimension=>({dimension,state:"satisfied",required:true,reason:"Sample source evidence for presentation"}))},
      objectSummaries:[{objectType:"issue",objectCount:1,eventCount:2,closedCompletionCount:1,cancelledCount:0,censoredCount:0,medianCycleSeconds:60,p90CycleSeconds:60,knownBlockedSeconds:null,reopenCount:null,directlyFollows:[],variants:[]}]}};
}
const flush=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
async function mount() {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}),container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const render=async()=>{await act(async()=>root.render(<QueryClientProvider client={client}><ProcessIntelligence /></QueryClientProvider>));await flush();};await render();
  return {container,render,cleanup:async()=>{await act(async()=>root.unmount());client.clear();container.remove();}};
}
async function click(container:HTMLElement,label:string) {await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===label)!.click());await flush();}
async function select(container:HTMLElement,label:string,value:string) {await act(async()=>{const element=container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;element.value=value;element.dispatchEvent(new Event("change",{bubbles:true}));});await flush();}
async function text(element:HTMLTextAreaElement|HTMLInputElement,value:string) {await act(async()=>{const prototype=element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});await flush();}
beforeEach(()=>{
  vi.clearAllMocks();fixture.companyId=id(1);fixture.userId="account-one";fixture.settled=true;fixture.failed=false;
  vi.mocked(processAnalysisApi.list).mockResolvedValue(page(null));vi.mocked(processAnalysisApi.detail).mockResolvedValue(detail());
  vi.mocked(processAnalysisApi.listRuns).mockResolvedValue({items:[],nextCursor:null,coverage:"bounded_current_authorized_page"});vi.mocked(processAnalysisApi.getRun).mockResolvedValue(run());
});
describe("native process operator authority",()=>{
  it("saves a proposal without publication or execution, then requires a separate current human review",async()=>{
    const proposed=detail("draft");vi.mocked(processAnalysisApi.create).mockImplementation(async(_company,input)=>{
      proposed.effectiveVersion.definition=input.definition;vi.mocked(processAnalysisApi.list).mockResolvedValue(page(proposed));vi.mocked(processAnalysisApi.detail).mockResolvedValue(proposed);
      return {root:proposed.root,version:proposed.effectiveVersion};
    });vi.mocked(processAnalysisApi.publish).mockResolvedValue({...proposed.root,status:"published",revision:2,publishedVersionId:id(3)});
    const app=await mount();try {
      await click(app.container,"Propose a process");const form=app.container.querySelector('form[aria-label="Process definition proposal"]')!;
      await text(form.querySelector("input")!,"Recorded native delivery flow");await text(form.querySelector("textarea")!,"Which native task paths are observed in the defined period?");
      await select(app.container,"Approved process purpose",id(4));await click(app.container,"Save process proposal");
      expect(processAnalysisApi.create).toHaveBeenCalledWith(id(1),{key:expect.stringMatching(/^flow_/),definition:expect.objectContaining({ownerUserId:"account-one",governanceObligationRefs:[id(4)],requiredSourceProviders:["activity_log"]})},"account-one");
      expect(processAnalysisApi.publish).not.toHaveBeenCalled();expect(processAnalysisApi.run).not.toHaveBeenCalled();
      const publish=[...app.container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="Publish selected version")!;expect(publish.disabled).toBe(true);
      await text(app.container.querySelector('[aria-label="Human process review rationale"]')!,"Human reviewed the exact definition and approved purpose");await click(app.container,"Publish selected version");
      expect(processAnalysisApi.publish).toHaveBeenCalledWith(id(1),id(2),{expectedRevision:1,versionId:id(3),rationale:"Human reviewed the exact definition and approved purpose"},"account-one");
    } finally {await app.cleanup();}
  });
  it("binds execution to the published version and UTC day bounds without accepting supplied readiness",async()=>{
    const value=detail();vi.mocked(processAnalysisApi.list).mockResolvedValue(page(value));vi.mocked(processAnalysisApi.run).mockResolvedValue(run());const app=await mount();
    try {await click(app.container,"Inspect process");const form=app.container.querySelector('form[aria-label="Run published process"]')!;const inputs=form.querySelectorAll<HTMLInputElement>('input[type="date"]');
      await text(inputs[0],"2026-01-01");await text(inputs[1],"2026-01-02");await click(app.container,"Analyze observed period");
      expect(processAnalysisApi.run).toHaveBeenCalledWith(id(1),id(2),{versionId:id(3),from:"2026-01-01T00:00:00Z",until:"2026-01-02T23:59:59.999999Z"},"account-one");
      expect(app.container.textContent).toContain("Task perspective");expect(app.container.textContent).not.toContain("Observed blocked time");
    } finally {await app.cleanup();}
  });
  it("masks late detail from the previous company/account and waits for current account verification",async()=>{
    const previous=detail();vi.mocked(processAnalysisApi.list).mockImplementation(async company=>page(company===id(1) ? previous : null));
    let resolve!:(value:ProcessAnalysisDefinitionDetail)=>void;vi.mocked(processAnalysisApi.detail).mockImplementation(()=>new Promise(r=>{resolve=r;}));const app=await mount();
    try {await click(app.container,"Inspect process");fixture.companyId=id(8);fixture.userId="account-two";await app.render();await act(async()=>resolve(previous));await flush();
      expect(app.container.textContent).not.toContain(previous.effectiveVersion.definition.businessQuestion);expect(app.container.querySelector('[aria-label="Inspect process definition"]')).toBeNull();
      fixture.failed=true;fixture.settled=false;await app.render();expect(app.container.textContent).toContain("account could not be verified");
    } finally {await app.cleanup();}
  });
  it("hides cached result statistics when a current retained-source read is denied",async()=>{
    const value=detail(),retained=run();vi.mocked(processAnalysisApi.list).mockResolvedValue(page(value));vi.mocked(processAnalysisApi.listRuns).mockResolvedValue({items:[retained],nextCursor:null,coverage:"bounded_current_authorized_page"});const app=await mount();
    try {await click(app.container,"Inspect process");await select(app.container,"Retained process run",retained.id);expect(app.container.textContent).toContain("Task perspective");
      vi.mocked(processAnalysisApi.getRun).mockRejectedValue(new Error("Current source access was withdrawn"));await click(app.container,"Refresh current evidence");
      expect(app.container.textContent).not.toContain("Task perspective");expect(app.container.querySelector('[role="alert"]')?.textContent).toContain("source access was withdrawn");
    } finally {await app.cleanup();}
  });
  it("removes a retained result as its expiry passes while keeping historical readiness time distinct",async()=>{
    const value=detail(),retained=run(new Date(Date.now()+900).toISOString());vi.mocked(processAnalysisApi.list).mockResolvedValue(page(value));vi.mocked(processAnalysisApi.listRuns).mockResolvedValue({items:[retained],nextCursor:null,coverage:"bounded_current_authorized_page"});vi.mocked(processAnalysisApi.getRun).mockResolvedValue(retained);const app=await mount();
    try {await click(app.container,"Inspect process");await select(app.container,"Retained process run",retained.id);expect(app.container.textContent).toContain("Task perspective");
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,950));});expect(app.container.textContent).not.toContain("Task perspective");expect(app.container.textContent).toContain("run's retention expired");
    } finally {await app.cleanup();}
  });
});
