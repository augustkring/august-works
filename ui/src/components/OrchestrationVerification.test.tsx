// @vitest-environment jsdom
import { withV7AccountScope } from "@/context/V7AccountScope";
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => ({ userId: "fixture-user", settled: true, failed: false }) }));
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { expect,it,vi } from "vitest";
import type { OrchestrationPlanDetail,VerificationPacket } from "@paperclipai/shared";
import { OrchestrationVerification } from "./OrchestrationVerification";
import { orchestrationApi } from "@/api/orchestration";
vi.mock("@/api/orchestration",() => { const orchestrationApi = { verificationPacket: vi.fn(),verifications: vi.fn(async () => []),verify: vi.fn(async () => ({ result: "fail" })),trajectory: vi.fn() }; return { orchestrationApi, createOrchestrationApi: () => orchestrationApi }; });
vi.mock("@/lib/router",() => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("keeps coordinator review and offers the primary-task worker",async () => {
  const companyId = "company", plan = { id: "plan",version: 2,status: "running",issueId: "task",workers: [{ id: "worker",issueId: "task",agentId: "agent",completionContractId: "contract",workerKey: "primary task",dependsOn: [],status: "active",attemptCount: 1 }],attempts: [{ id: "attempt",workerId: "worker",runId: "run",workflowRunId: null,status: "running",attempt: 1 }] } as unknown as OrchestrationPlanDetail;
  const packet: VerificationPacket = { planId: plan.id,planVersion: 2,workerId: null,issueId: "task",contractId: "contract",contractHash: "sha256:contract",resultHash: "a".repeat(64),contract: { objective: "Review the consequential result",requiredOutputs: [{ kind: "task_document",key: "result",jsonSchema: null }],businessInvariants: ["Only the approved recipient receives the approved message"],evidenceRequirements: [],prohibitedOutcomes: [],requiredPostconditions: [] },evidence: [{ ref: "tool:approved-receipt",type: "tool_receipt",sourceId: "receipt",sourceVersion: "version",hash: "hash" }],deterministicFailures: [],liveAttempts: 0,riskClass: "C3",policy: { independentRequired: true,humanRequired: true,workerSelfCertification: false } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false,staleTime: Infinity } } });
  client.setQueryData(["verification-packet",companyId, "user:fixture-user",plan.id,plan.version,null],packet);
  client.setQueryData(["verification-history",companyId, "user:fixture-user",plan.id,plan.version],[{ id: "model-review",result: "needs_human",reviewerType: "model",createdAt: "2026-10-05T00:00:00Z",erasedAt: null }]);
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  const Scoped = withV7AccountScope(() => <OrchestrationVerification companyId={companyId} plan={plan} onReviewed={() => {}} />);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><Scoped /></QueryClientProvider>));
    expect(element.textContent).toContain("Model assessment: needs human · human review required");
    expect(Array.from(element.querySelectorAll("select")[0]!.options).map(option => option.textContent)).toEqual(["Final coordinator result", "primary task"]);
    expect(Array.from(element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every(input => !input.checked)).toBe(true);
    const rationale = Array.from(element.querySelectorAll("label")).find(label => label.textContent?.startsWith("Review rationale"))!.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(rationale,"Independently reviewed this exact consequential output"); rationale.dispatchEvent(new Event("input",{ bubbles: true })); });
    await act(async () => Array.from(element.querySelectorAll("button")).find(button => button.textContent === "Record independent review")!.click());
    expect(orchestrationApi.verify).toHaveBeenCalledWith(companyId,plan.id,expect.objectContaining({ expectedPlanVersion: 2,expectedResultHash: packet.resultHash,result: "needs_human",objectiveSatisfied: false,explicitHighImpactApproval: false,businessInvariants: [{ index: 0,satisfied: false,evidenceRefs: [] }] }));
  } finally { await act(async () => root.unmount()); element.remove(); }
});
