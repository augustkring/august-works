// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROCESS_DATA_DIMENSIONS, type ProcessAnalysisRunView, type ProcessFindingView } from "@paperclipai/shared";
import { ProcessFindings } from "./ProcessFindings";
import { processAnalysisApi } from "@/api/process-analysis";
vi.mock("@/api/process-analysis", () => ({ processAnalysisApi: { listFindings: vi.fn(), findingDetail: vi.fn(), createFinding: vi.fn(), transitionFinding: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const run: ProcessAnalysisRunView = { id:id(3),companyId:id(1),definitionId:id(2),versionId:id(4),lineageManifestId:id(5),definitionHash:"a".repeat(64),eventSetHash:"b".repeat(64),
  from:"2026-01-01T00:00:00Z",until:"2026-01-02T00:00:00Z",createdAt:"2026-01-03T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z",authorizationCheckedAt:new Date().toISOString(),
  result:{engineVersion:"test-fixture",status:"succeeded",errorCode:null,semantics:"observed_native_activity_paths_no_causal_or_person_effect",
    readiness:{companyId:id(1),engineVersion:"test-fixture",status:"ready",admission:"DATA_READY",analysisKey:"qualified_flow",requirementHash:"c".repeat(64),eventSetHash:"b".repeat(64),assessedAt:"2026-01-03T00:00:00Z",expiresAt:"2026-01-03T00:05:00Z",authorizedEventCount:3,coverage:"current_native_activity_snapshot",findings:[],
      dimensions:PROCESS_DATA_DIMENSIONS.map(dimension=>({dimension,state:"satisfied",required:true,reason:"Test evidence"}))},
    objectSummaries:[{objectType:"issue",objectCount:1,eventCount:3,closedCompletionCount:1,cancelledCount:0,censoredCount:0,medianCycleSeconds:60,p90CycleSeconds:60,knownBlockedSeconds:15,reopenCount:0,directlyFollows:[],variants:[]}]}};
const finding: ProcessFindingView = { id:id(6),companyId:run.companyId,definitionId:run.definitionId,analysisRunId:run.id,findingType:"avoidable_wait",objectType:"issue",variantHash:null,
  severity:"medium",interpretation:"Private human process interpretation",summary:"Recorded object paths contain blocked intervals for human investigation",
  facts:{observed:{knownBlockedSeconds:15},semantics:"human_process_interpretation_of_observed_facts",limitations:["Human interpretation, not an established effect"]},definitionHash:run.definitionHash,eventSetHash:run.eventSetHash,contentHash:"d".repeat(64),
  status:"OPEN",version:1,createdAt:run.createdAt,expiresAt:run.expiresAt,resolvedAt:null,resolutionRef:null,authorizationCheckedAt:run.authorizationCheckedAt };
const flush = async () => { await act(async()=>{ await new Promise(resolve=>setTimeout(resolve,30)); }); };
async function mount(value=run) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}),container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  await act(async()=>root.render(<QueryClientProvider client={client}><ProcessFindings run={value} userId="reviewer" /></QueryClientProvider>));await flush();
  return {container,cleanup:async()=>{await act(async()=>root.unmount());client.clear();container.remove();}};
}
async function click(container:HTMLElement,label:string) { await act(async()=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===label)!.click());await flush(); }
async function write(container:HTMLElement,label:string,value:string) { await act(async()=>{const element=container.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});await flush(); }
beforeEach(()=>{
  vi.clearAllMocks();vi.mocked(processAnalysisApi.listFindings).mockResolvedValue({items:[finding],nextCursor:null});
  vi.mocked(processAnalysisApi.findingDetail).mockResolvedValue({finding,transitions:[{version:1,fromStatus:null,toStatus:"OPEN",reason:finding.interpretation,recordedAt:finding.createdAt}],hasMoreTransitions:false});
});
describe("human process finding evidence",()=>{
  it("offers published-model deviation review only when qualified comparison contains observed deviations",async()=>{
    const comparison={target:"explicit_published_process_definition" as const,targetVersionId:run.versionId,modelHash:"e".repeat(64),evaluatedObjectCount:1,conformingObjectCount:0,deviatingObjectCount:1,
      violationCounts:{initial_state_not_expected:0,terminal_state_not_expected:0,transition_not_expected:1,required_state_missing:1},coverage:"qualified_primary_object_lifecycle_in_observed_window" as const};
    const value={...run,result:{...run.result,objectSummaries:[{...run.result.objectSummaries[0],knownBlockedSeconds:null,conformance:comparison}]}};
    vi.mocked(processAnalysisApi.createFinding).mockResolvedValue({...finding,findingType:"conformance_deviation"});
    const app=await mount(value);try {
      expect(app.container.querySelector('[aria-label="Finding observed facts"]')!.textContent).toContain("published-model deviation");
      await write(app.container,"Finding human interpretation","Investigate the exact published model deviation with the owner");await click(app.container,"Record finding");
      expect(processAnalysisApi.createFinding).toHaveBeenCalledWith(run.companyId,run.definitionId,run.id,expect.objectContaining({findingType:"conformance_deviation",objectType:"issue",variantHash:null}),"reviewer");
    }finally{await app.cleanup();}
    const matching=await mount({...value,result:{...value.result,objectSummaries:[{...value.result.objectSummaries[0],conformance:{...comparison,deviatingObjectCount:0,conformingObjectCount:1}}]}});
    try{expect(matching.container.querySelector('form[aria-label="Record process finding"]')).toBeNull();}finally{await matching.cleanup();}
  });
  it("requires a reason and current expected version before acknowledging; resolution cannot skip investigation",async()=>{
    vi.mocked(processAnalysisApi.transitionFinding).mockResolvedValue({...finding,status:"ACKNOWLEDGED",version:2});const app=await mount();try{
      await click(app.container,"Inspect finding");expect([...app.container.querySelectorAll("button")].some(button=>button.textContent==="Resolve finding")).toBe(false);
      expect([...app.container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent==="Acknowledge finding")!.disabled).toBe(true);
      await write(app.container,"Finding review reason","Human acknowledges the observed process facts");await click(app.container,"Acknowledge finding");
      expect(processAnalysisApi.transitionFinding).toHaveBeenCalledWith(run.companyId,run.definitionId,run.id,finding.id,{expectedVersion:1,status:"ACKNOWLEDGED",reason:"Human acknowledges the observed process facts"},"reviewer");
    }finally{await app.cleanup();}
  });
  it("records only admitted aggregate choices and a frozen human interpretation without publishing a causal effect",async()=>{
    vi.mocked(processAnalysisApi.createFinding).mockResolvedValue(finding);const app=await mount();try{
      expect(app.container.textContent).toContain("Blocked time does not prove avoidability");expect(app.container.textContent).not.toContain("Observed reopening");
      await write(app.container,"Finding human interpretation","Investigate whether the observed blocked interval can be reduced");await click(app.container,"Record finding");
      expect(processAnalysisApi.createFinding).toHaveBeenCalledWith(run.companyId,run.definitionId,run.id,{findingType:"avoidable_wait",objectType:"issue",variantHash:null,severity:"medium",interpretation:"Investigate whether the observed blocked interval can be reduced"},"reviewer");
    }finally{await app.cleanup();}
  });
  it("hides previously listed interpretation and actions after the current source check fails",async()=>{
    vi.mocked(processAnalysisApi.findingDetail).mockRejectedValue(Error("Current source access changed"));const app=await mount();try{
      expect(app.container.textContent).toContain(finding.interpretation);await click(app.container,"Inspect finding");
      expect(app.container.textContent).not.toContain(finding.interpretation);expect(app.container.querySelector('form[aria-label="Record process finding"]')).toBeNull();
      expect(app.container.querySelector('[role="alert"]')!.textContent).toContain("Current source access changed");
    }finally{await app.cleanup();}
  });
  it("offers a run-level missing-data finding for inconclusive input without an object statistic",async()=>{
    const unknown:ProcessAnalysisRunView={...run,result:{...run.result,status:"inconclusive",errorCode:"DATA_NOT_READY",objectSummaries:[]}};
    const app=await mount(unknown);try{expect(app.container.querySelector('[aria-label="Finding observed facts"]')!.textContent).toBe("Missing qualified data");}finally{await app.cleanup();}
  });
});
