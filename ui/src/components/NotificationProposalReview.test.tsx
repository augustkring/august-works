// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { afterEach,expect,it,vi } from "vitest";
import type { NotificationPreferenceProposalView } from "@paperclipai/shared";
import { NotificationProposalReview } from "./NotificationProposalReview";
import * as proposals from "../api/notification-proposals";
import { authApi } from "../api/auth";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
const company="10000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000002";
const account=vi.hoisted(()=>({principal:"author",company:"10000000-0000-4000-8000-000000000001"}));
vi.mock("../api/companies-query",()=>({useAccountIdentity:()=>({userId:account.principal,settled:true,localImplicit:false})}));
vi.mock("../context/CompanyContext",()=>({useCompany:()=>({selectedCompanyId:account.company})}));
let live:(event:{companyId:string;type:string;payload:Record<string,unknown>})=>void;
vi.mock("../context/LiveUpdatesProvider",()=>({useCompanyLiveEvent:(listener:typeof live)=>{live=listener;}}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const data:NotificationPreferenceProposalView={id,companyId:company,version:1,status:"pending",category:"work_update",
  preference:{category:"work_update",emailEnabled:false,policy:{version:1,cadence:"digest",timezone:"Europe/Copenhagen",quietHours:{startMinute:1320,endMinute:480},digestMinute:540}},
  baselineHash:"a".repeat(64),baselineChanged:false,preferenceApplied:false,requiresHumanReview:true,confirmationRequestId:null};
let root:Root,container:HTMLDivElement,client:QueryClient;
async function render(){await act(async()=>root.render(<QueryClientProvider client={client}><NotificationProposalReview company={company} principal={account.principal} id={id}/></QueryClientProvider>));}
async function mount(){vi.spyOn(authApi,"getSession").mockImplementation(async()=>v9SessionFixture(account.principal));
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});client.setQueryDefaults(queryKeys.auth.session,{gcTime:Infinity});
  client.setQueryData(queryKeys.auth.session,v9SessionFixture(account.principal));container=document.createElement("div");document.body.append(container);root=createRoot(container);await render();}
async function click(text:string){const button=Array.from(container.querySelectorAll("button")).find(item=>item.textContent===text);expect(button).toBeTruthy();await act(async()=>button!.click());}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();client?.clear();account.principal="author";account.company=company;vi.restoreAllMocks();await i18n.changeLanguage("en");});
it("reviews complete actual preference consequences in EN/DA without a write",async()=>{
  vi.spyOn(proposals,"getNotificationProposal").mockResolvedValue(data);const apply=vi.spyOn(proposals,"applyNotificationProposal");await mount();await click("Review notification proposal");
  await vi.waitFor(()=>expect(container.textContent).toContain("across all companies"));expect(container.textContent).toContain("22:00–08:00");expect(container.textContent).toContain("09:00");expect(apply).not.toHaveBeenCalled();
  await act(async()=>i18n.changeLanguage("da"));expect(container.textContent).toContain("på tværs af alle virksomheder");expect(container.textContent).toContain("Anvend på min konto");
});
it("applies one reviewed baseline and reads the actual confirmation",async()=>{
  const get=vi.spyOn(proposals,"getNotificationProposal").mockResolvedValue(data);
  const apply=vi.spyOn(proposals,"applyNotificationProposal").mockImplementation(async(_company,_principal,_id,input)=>{
    const confirmation=input as {requestId:string};const saved={...data,version:2,status:"applied" as const,preferenceApplied:true,requiresHumanReview:false,confirmationRequestId:confirmation.requestId};get.mockResolvedValue(saved);return saved;});
  await mount();await click("Review notification proposal");await vi.waitFor(()=>expect(container.textContent).toContain("Apply to my account"));await click("Apply to my account");
  await vi.waitFor(()=>expect(container.textContent).toContain("after your confirmation"));expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0]?.[3]).toMatchObject({expectedProposalVersion:1,expectedBaselineHash:data.baselineHash});
});
it("keeps unknown acceptance read-only and never repeats the write on refresh",async()=>{
  vi.spyOn(proposals,"getNotificationProposal").mockResolvedValue(data);const apply=vi.spyOn(proposals,"applyNotificationProposal").mockRejectedValue(new Error("response lost"));
  await mount();await click("Review notification proposal");await vi.waitFor(()=>expect(container.textContent).toContain("Apply to my account"));await click("Apply to my account");
  await vi.waitFor(()=>expect(container.textContent).toContain("result is unknown"));await click("Refresh current proposal");expect(apply).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Apply to my account");
});
it("conceals prior preferences immediately when the Source or current account changes",async()=>{
  const get=vi.spyOn(proposals,"getNotificationProposal").mockResolvedValue(data);await mount();await click("Review notification proposal");await vi.waitFor(()=>expect(container.textContent).toContain("Europe/Copenhagen"));
  let release!:(value:NotificationPreferenceProposalView)=>void;get.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await act(async()=>live({companyId:company,type:"activity.logged",payload:{entityType:"notification_preference_proposal",action:"source.erased"}}));
  expect(container.textContent).not.toContain("Europe/Copenhagen");account.principal="other-user";await render();await act(async()=>release(data));expect(container.textContent).not.toContain("Europe/Copenhagen");
});
