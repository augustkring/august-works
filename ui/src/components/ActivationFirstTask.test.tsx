// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activationFirstTaskViewSchema } from "@paperclipai/shared";
import { i18n } from "../i18n";
import { ActivationFirstTask } from "./ActivationFirstTask";
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: null, companies: [] }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const candidate = { installationId: "10000000-0000-4000-8000-000000000001", installationHash: "a".repeat(64),
  planId: "10000000-0000-4000-8000-000000000002", issueId: "10000000-0000-4000-8000-000000000003", planVersion: 7,
  title: "Prepared internal draft", maximumModelCostMinor: 0 as const, currency: "USD" as const };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); await i18n.changeLanguage("en"); });
async function mount(value: ReturnType<typeof activationFirstTaskViewSchema.parse>, canStart = true, canStop = true) {
  const handlers = { onPrepare: vi.fn(), onStart: vi.fn(), onContinue: vi.fn(), onStop: vi.fn(), onRefresh: vi.fn() };
  container = document.createElement("div");document.body.append(container);root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ActivationFirstTask value={value} canStart={canStart} canStop={canStop} pending={false} {...handlers} /></MemoryRouter></QueryClientProvider>));
  return handlers;
}
describe("Original first-task controls", () => {
  it("passes the exact reviewed native references and no-charge quote only on explicit Run", async () => {
    const handlers = await mount(activationFirstTaskViewSchema.parse({ candidates: [candidate], hasMore: false, current: null }));
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(container.textContent).toContain("USD 0.00");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(`/issues/${candidate.issueId}`);
    await act(async () => container.querySelector("button")!.click());
    expect(handlers.onStart).toHaveBeenCalledExactlyOnceWith({ operation: "start_first_task", installationId: candidate.installationId,
      planId: candidate.planId, expectedPlanVersion: 7, expectedInstallationHash: candidate.installationHash, expectedMaximumModelCostMinor: 0 });
  });
  it("keeps Stop available after start admission is withdrawn and requires an explicit Continue", async () => {
    const handlers = await mount(activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false,
      current: { installationId: candidate.installationId, installationHash: candidate.installationHash, planId: candidate.planId,
        issueId: candidate.issueId, planVersion: 8, status: "running", dispatched: false } }), false, true);
    expect(handlers.onContinue).not.toHaveBeenCalled();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.find(b => b.textContent === "Continue first task")?.disabled).toBe(true);
    const stop = buttons.find(b => b.textContent === "Stop")!;expect(stop.disabled).toBe(false);
    await act(async () => stop.click());expect(handlers.onStop).toHaveBeenCalledExactlyOnceWith(8);
    expect(container.textContent).not.toMatch(/\d+%/);
  });
  it.each([true, false])("retains only authorized Stop for a withdrawn source (current authority: %s)", async (canStop) => {
    const handlers = await mount(activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false,
      current: { installationId: candidate.installationId, installationHash: candidate.installationHash, planId: candidate.planId,
        issueId: candidate.issueId, planVersion: 8, status: "withdrawn", dispatched: false } }), false, canStop);
    const stop = [...container.querySelectorAll("button")].find(button => button.textContent === "Stop")!;
    expect(stop.disabled).toBe(!canStop);
    expect(container.textContent).not.toContain("Continue first task");
    await act(async () => stop.click());
    if (canStop) expect(handlers.onStop).toHaveBeenCalledExactlyOnceWith(8);
    else expect(handlers.onStop).not.toHaveBeenCalled();
    expect(handlers.onStart).not.toHaveBeenCalled(); expect(handlers.onContinue).not.toHaveBeenCalled();
  });
  it("does not offer another execution after native completion and renders Danish recovery", async () => {
    await i18n.changeLanguage("da");
    const handlers = await mount(activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false,
      current: { installationId: candidate.installationId, installationHash: candidate.installationHash, planId: candidate.planId,
        issueId: candidate.issueId, planVersion: 9, status: "completed", dispatched: true } }));
    expect(container.textContent).toContain("Opgaven er afsluttet");
    expect(container.textContent).toContain("uafhængig gennemgang");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    await act(async () => container.querySelector("button")!.click());expect(handlers.onRefresh).toHaveBeenCalledOnce();
    expect(handlers.onStart).not.toHaveBeenCalled();expect(handlers.onContinue).not.toHaveBeenCalled();
  });
});

it("prepares only the exact approved current purpose on explicit confirmation and never starts work", async () => {
  const option = { installationId: candidate.installationId, installationVersion: 2,
    installationHash: candidate.installationHash, agentName: "Original source-bound agent", useCaseVersion: 3,
    purposeVersion: 1, intendedPurpose: "Prepare an approved internal source-bound draft", maximumModelCostMinor: 0 };
  const handlers = await mount(activationFirstTaskViewSchema.parse({ candidates: [], hasMore: false, current: null,
    preparationOptions: [option] }));
  expect(container.textContent).toContain(option.intendedPurpose);
  expect(handlers.onPrepare).not.toHaveBeenCalled();expect(handlers.onStart).not.toHaveBeenCalled();
  const button = [...container.querySelectorAll("button")].find(value => value.textContent === "Prepare first task")!;
  await act(async () => button.click());
  expect(handlers.onPrepare).toHaveBeenCalledExactlyOnceWith({ operation: "prepare_first_task", installationId: candidate.installationId,
    expectedInstallationVersion: 2, expectedInstallationHash: candidate.installationHash,
    expectedUseCaseVersion: 3, expectedPurposeVersion: 1, confirmCurrentPurpose: true });
  expect(handlers.onStart).not.toHaveBeenCalled(); expect(handlers.onContinue).not.toHaveBeenCalled();
});
