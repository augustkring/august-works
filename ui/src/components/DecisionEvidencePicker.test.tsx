// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { DecisionEvidencePicker } from "./DecisionEvidencePicker";
import { businessForecastingApi } from "@/api/business-forecasting";
import { causalClaimsApi } from "@/api/causal-claims";
import { causalFixture } from "../../storybook/stories/causal-claim-fixtures";
import { businessExperimentsApi } from "@/api/business-experiments";
import { experimentFixture } from "../../storybook/stories/business-experiment-fixtures";
import { businessScenariosApi } from "@/api/business-scenarios";
import { forecastFixture } from "../../storybook/stories/business-forecast-fixtures";
import { scenarioFixture } from "../../storybook/stories/business-scenario-fixtures";
import type { DecisionEvidenceReference } from "@paperclipai/shared";
vi.mock("@/api/causal-claims", () => ({ causalClaimsApi: { list: vi.fn(), detail: vi.fn() } }));
vi.mock("@/api/business-forecasting", () => ({ businessForecastingApi: { list: vi.fn(), artifacts: vi.fn() } }));
vi.mock("@/api/business-experiments", () => ({ businessExperimentsApi: { list: vi.fn(), receipts: vi.fn() } }));
vi.mock("@/api/business-scenarios", () => ({ businessScenariosApi: { list: vi.fn(), runs: vi.fn() } }));
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
async function mount(value: DecisionEvidenceReference, companyId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container), onChange = vi.fn();
  await act(async () => root.render(<QueryClientProvider client={client}><DecisionEvidencePicker companyId={companyId} userId="current-account" value={value} onChange={onChange}/></QueryClientProvider>));
  await flush();
  const pin = () => container.querySelector<HTMLSelectElement>('[aria-label="Pinned evidence"]')!;
  return { client, container, pin, onChange, cleanup: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); } };
}
describe("Native calculation evidence selection", () => {
  it("binds only exact current causal analysis and human graph review identities without copied confidence or effects",async()=>{
    const f=causalFixture("supported"),ref:DecisionEvidenceReference={type:"causal_analysis",id:f.run.id,claimId:f.claim.id,versionId:f.causalVersion.id,reviewId:f.review!.id};
    vi.mocked(causalClaimsApi.list).mockResolvedValue({items:[{claim:f.claim,version:f.causalVersion,run:f.run}],nextCursor:null,coverage:"bounded_current_authorized_page"});vi.mocked(causalClaimsApi.detail).mockResolvedValue({claim:f.claim,versions:[{version:f.causalVersion,review:f.review,run:f.run}],coverage:"bounded_recent_native_versions"});const view=await mount(ref,f.companyId);
    try{expect(causalClaimsApi.list).toHaveBeenCalledWith(f.companyId,undefined,"current-account");expect(causalClaimsApi.detail).toHaveBeenCalledWith(f.companyId,f.claim.id,"current-account");expect([...view.pin().options].some(o=>o.value===JSON.stringify(ref)&&o.textContent?.includes("conditional advisory evidence"))).toBe(true);await act(async()=>{view.pin().value=JSON.stringify(ref);view.pin().dispatchEvent(new Event("change",{bubbles:true}));});expect(view.onChange).toHaveBeenLastCalledWith(ref);expect(view.onChange.mock.lastCall![0]).not.toHaveProperty("effect");expect(view.onChange.mock.lastCall![0]).not.toHaveProperty("confidence");}finally{await view.cleanup();}
  });
  it("withholds causal choices for mismatched tenant/run identities, stale qualification and revoked control state",async()=>{
    const f=causalFixture("supported"),ref:DecisionEvidenceReference={type:"causal_analysis",id:f.run.id,claimId:f.claim.id,versionId:f.causalVersion.id,reviewId:f.review!.id};vi.mocked(causalClaimsApi.list).mockResolvedValue({items:[{claim:f.claim,version:f.causalVersion,run:f.run}],nextCursor:null,coverage:"bounded_current_authorized_page"});
    for(const invalid of [{claim:{...f.claim,status:"revoked" as const},version:f.causalVersion,run:f.run},{claim:f.claim,version:{...f.causalVersion,currentQualification:"needs_revalidation" as const},run:f.run},{claim:f.claim,version:f.causalVersion,run:{...f.run,companyId:"another-company"}},{claim:{...f.claim,latestRunId:f.causalVersion.id},version:f.causalVersion,run:f.run}]){vi.mocked(causalClaimsApi.detail).mockResolvedValue({claim:invalid.claim,versions:[{version:invalid.version,review:f.review,run:invalid.run}],coverage:"bounded_recent_native_versions"});const view=await mount(ref,f.companyId);try{expect([...view.pin().options].some(o=>o.textContent?.includes("conditional advisory evidence"))).toBe(false);}finally{await view.cleanup();}}
  });
  it("withholds cached causal choices during reauthorization and after source denial",async()=>{
    const f=causalFixture("supported"),ref:DecisionEvidenceReference={type:"causal_analysis",id:f.run.id,claimId:f.claim.id,versionId:f.causalVersion.id,reviewId:f.review!.id};vi.mocked(causalClaimsApi.list).mockResolvedValue({items:[{claim:f.claim,version:f.causalVersion,run:f.run}],nextCursor:null,coverage:"bounded_current_authorized_page"});vi.mocked(causalClaimsApi.detail).mockResolvedValue({claim:f.claim,versions:[{version:f.causalVersion,review:f.review,run:f.run}],coverage:"bounded_recent_native_versions"});const view=await mount(ref,f.companyId);try{let reject!:(e:Error)=>void;vi.mocked(causalClaimsApi.detail).mockImplementation(()=>new Promise((_resolve,deny)=>{reject=deny;}));await act(async()=>{void view.client.invalidateQueries({queryKey:["decision-evidence",f.companyId,"current-account"]});});await flush();expect([...view.pin().options].some(o=>o.textContent?.includes("conditional advisory evidence"))).toBe(false);await act(async()=>reject(new Error("Causal source authority denied")));await flush();expect([...view.pin().options].some(o=>o.textContent?.includes("conditional advisory evidence"))).toBe(false);}finally{await view.cleanup();}
  });

  it("sends only the exact forecast point identity and verifies the current account without copying numbers", async () => {
    const f = forecastFixture(true), ref: DecisionEvidenceReference = { type: "forecast_run", id: f.run.id, specId: f.spec.id, versionId: f.version.id, pointIndex: 0 };
    vi.mocked(businessForecastingApi.list).mockResolvedValue({ items: [f.spec], nextCursor: null, coverage: "bounded_current_authorized_page" });
    vi.mocked(businessForecastingApi.artifacts).mockResolvedValue({ items: [f.run], nextCursor: null, coverage: "bounded_current_authorized_page" });
    const view = await mount(ref, f.companyId);
    expect(businessForecastingApi.list).toHaveBeenCalledWith(f.companyId, undefined, "current-account"); expect(businessForecastingApi.artifacts).toHaveBeenCalledWith(f.companyId, f.spec.id, "run", undefined, "current-account");
    await act(async () => { view.pin().value = JSON.stringify(ref); view.pin().dispatchEvent(new Event("change", { bubbles: true })); });
    expect(view.onChange).toHaveBeenLastCalledWith(ref); expect(view.onChange.mock.lastCall![0]).not.toHaveProperty("value"); expect(view.onChange.mock.lastCall![0]).not.toHaveProperty("contentHash"); await view.cleanup();
  });
  it("hides cached forecast choices while checking current authority and after denial", async () => {
    const f = forecastFixture(true), ref: DecisionEvidenceReference = { type: "forecast_run", id: f.run.id, specId: f.spec.id, versionId: f.version.id, pointIndex: 0 };
    vi.mocked(businessForecastingApi.list).mockResolvedValue({ items: [f.spec], nextCursor: null, coverage: "bounded_current_authorized_page" }); vi.mocked(businessForecastingApi.artifacts).mockResolvedValue({ items: [f.run], nextCursor: null, coverage: "bounded_current_authorized_page" });
    const view = await mount(ref, f.companyId); expect(view.container.textContent).toContain("intervals unavailable");
    let deny!: (error: Error) => void; vi.mocked(businessForecastingApi.artifacts).mockImplementation(() => new Promise((_resolve, reject) => { deny = reject; }));
    await act(async () => { void view.client.invalidateQueries({ queryKey: ["decision-evidence", f.companyId, "current-account", "forecast-runs", f.spec.id] }); }); await flush();
    expect(view.container.textContent).not.toContain("intervals unavailable");
    await act(async () => deny(new Error("Native source authority denied"))); await flush(); expect(view.container.textContent).not.toContain("intervals unavailable"); expect(view.container.textContent).toContain("Native source authority denied"); await view.cleanup();
  });
  it("selects one exact conditional case/output and withholds stale, foreign-owner or foreign-company choices", async () => {
    const s = scenarioFixture(true), ref: DecisionEvidenceReference = { type: "scenario_run", id: s.run.id, scenarioId: s.scenario.id, versionId: s.version.id, caseKey: "option", outputKey: "capacity" };
    vi.mocked(businessScenariosApi.list).mockResolvedValue({ items: [{ scenario: s.scenario, version: s.version }], nextCursor: null, coverage: "bounded_current_authorized_page" });
    vi.mocked(businessScenariosApi.runs).mockResolvedValue({ items: [s.run], nextCursor: null, coverage: "bounded_current_authorized_page" });
    const view = await mount(ref, s.companyId);
    await act(async () => { view.pin().value = JSON.stringify(ref); view.pin().dispatchEvent(new Event("change", { bubbles: true })); });
    expect(view.onChange).toHaveBeenLastCalledWith(ref); expect(view.container.textContent).toContain("do not become measured outcomes"); expect(businessScenariosApi.runs).toHaveBeenCalledWith(s.companyId, s.scenario.id, undefined, "current-account"); await view.cleanup();
    for (const run of [{ ...s.run, currentQualification: "needs_revalidation" as const }, { ...s.run, companyId: "00000000-0000-4000-8000-000000000999" }, { ...s.run, scenarioId: "00000000-0000-4000-8000-000000000999" }]) {
      vi.mocked(businessScenariosApi.runs).mockResolvedValue({ items: [run], nextCursor: null, coverage: "bounded_current_authorized_page" });
      const denied = await mount(ref, s.companyId); expect(denied.container.textContent).not.toContain("Capacity option · capacity"); await denied.cleanup();
    }
  });
  it("pins one exact interpreted experiment without copied effects and withholds cached evidence on denial or mismatched receipt ownership",async()=>{
    const f=experimentFixture("inconclusive"),interpretation={id:"11111111-1111-4111-8111-111111111111",analysisId:f.analysis.id,conclusion:"iterate" as const,rationale:"Synthetic human presentation only",executionAuthority:"advisory_only" as const,receiptHash:"a".repeat(64),interpretedBy:f.userId,interpretedAt:f.analysis.analyzedAt};
    const receipts={...f.receipts,interpretation},ref:DecisionEvidenceReference={type:"experiment_analysis",id:f.analysis.id,experimentId:f.experiment.id,versionId:f.version.id,interpretationId:interpretation.id};
    vi.mocked(businessExperimentsApi.list).mockResolvedValue({items:[{experiment:f.experiment,version:f.version}],nextCursor:null,coverage:"bounded_current_authorized_page"});vi.mocked(businessExperimentsApi.receipts).mockResolvedValue(receipts);
    const view=await mount(ref,f.companyId);for(let i=0;i<40&&!Array.from(view.pin().options).some(o=>o.text.includes("human iterate"));i++)await flush();
    expect(businessExperimentsApi.receipts).toHaveBeenCalledWith(f.companyId,f.experiment.id,f.version.id,"current-account");
    await act(async()=>{view.pin().value=JSON.stringify(ref);view.pin().dispatchEvent(new Event("change",{bubbles:true}));});expect(view.onChange).toHaveBeenLastCalledWith(ref);expect(view.onChange.mock.lastCall![0]).not.toHaveProperty("effect");expect(view.container.textContent).toContain("conditional proxies");
    let deny!:(error:Error)=>void;vi.mocked(businessExperimentsApi.receipts).mockImplementation(()=>new Promise((_resolve,reject)=>{deny=reject;}));await act(async()=>{void view.client.invalidateQueries({queryKey:["decision-evidence",f.companyId,"current-account","experiment-receipts"]});});await flush();expect(view.container.textContent).not.toContain("human iterate");await act(async()=>deny(new Error("Experiment source authority denied")));await flush();expect(view.container.textContent).not.toContain("human iterate");await view.cleanup();
    for(const receipt of [{...receipts,currentQualification:"needs_revalidation" as const},{...receipts,interpretation:{...interpretation,analysisId:"11111111-1111-4111-8111-111111111199"}},{...receipts,analysis:{...f.analysis,companyId:"11111111-1111-4111-8111-111111111199"}}]){vi.mocked(businessExperimentsApi.receipts).mockResolvedValue(receipt);const denied=await mount(ref,f.companyId);for(let i=0;i<5;i++)await flush();expect(denied.container.textContent).not.toContain("human iterate");await denied.cleanup();}
  });

});
