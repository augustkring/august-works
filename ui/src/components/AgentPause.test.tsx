// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AgentPause } from "./AgentPause";
import { agentPauseApi } from "../api/agent-pause";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
const company = "10000000-0000-4000-8000-000000000001", agentId = "10000000-0000-4000-8000-000000000002";
const review = { companyId: company, agentId, name: "Owned agent", nativeStatus: "idle" as const, sourceToken: "a".repeat(64), canPause: true };
let root: Root, container: HTMLDivElement, client: QueryClient;
vi.mock("../api/companies-query", () => ({ useAccountIdentity: () => ({ userId: "owner", settled: true, localImplicit: false, failed: false }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); client?.clear(); sessionStorage.clear(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><AgentPause company={company} principal="owner" agentId={agentId} /></QueryClientProvider>)); }
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity }); client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await render(); await vi.waitFor(() => expect(container.textContent).toContain("Pause agent"));
}
async function click(label: string, dialog = false) {
  await vi.waitFor(() => {
    const scope = dialog ? document.querySelector('[role="alertdialog"]') : container;
    expect(scope && [...scope.querySelectorAll("button")].some(button => button.textContent === label && !button.disabled)).toBeTruthy();
  });
  const scope = dialog ? document.querySelector('[role="alertdialog"]')! : container;
  await act(async () => [...scope.querySelectorAll("button")].find(button => button.textContent === label)!.click());
}
it.each(["drain", "cancel"] as const)("requires an explicit %s choice and sends one bounded Native command", async policy => {
  vi.spyOn(agentPauseApi, "review").mockResolvedValue(review);
  const pause = vi.spyOn(agentPauseApi, "pause").mockImplementation(async (_c, _p, _a, input) => ({ companyId: company, agentId, requestId: input.requestId,
    pendingWork: input.pendingWork, acceptedAt: "2026-10-12T00:00:00Z", admissionClosedAtAcceptance: true, workSettled: false }));
  await mount(); await click("Pause agent"); const dialog = document.querySelector('[role="alertdialog"]')!;
  expect([...dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every(input => !input.checked)).toBe(true);
  expect([...dialog.querySelectorAll("button")].find(button => button.textContent === "Pause agent")?.disabled).toBe(true); expect(pause).not.toHaveBeenCalled();
  await act(async () => dialog.querySelector<HTMLInputElement>(`input[value="${policy}"]`)!.click()); await click("Pause agent", true);
  await vi.waitFor(() => expect(container.textContent).toContain("The pause is recorded"));
  expect(pause).toHaveBeenCalledExactlyOnceWith(company, "owner", agentId, { requestId: expect.any(String), expectedSourceToken: review.sourceToken, pendingWork: policy, confirmPause: true });
});
it("recovers an unknown acknowledgement after reload using only the Original receipt", async () => {
  vi.spyOn(agentPauseApi, "review").mockResolvedValue(review);
  const pause = vi.spyOn(agentPauseApi, "pause").mockRejectedValue(new Error("Unknown remote reply")), original = vi.spyOn(agentPauseApi, "receipt").mockResolvedValue(null);
  await mount(); await click("Pause agent"); await act(async () => document.querySelector<HTMLInputElement>('input[value="cancel"]')!.click()); await click("Pause agent", true);
  await vi.waitFor(() => expect(container.textContent).toContain("Check original pause")); const input = pause.mock.calls[0]![3];
  await act(async () => root.unmount()); root = createRoot(container); await render();
  await vi.waitFor(() => expect(container.textContent).toContain("Check original pause")); await click("Check original pause");
  await vi.waitFor(() => expect(original).toHaveBeenCalledWith(company, "owner", agentId, input.requestId));
  expect(pause).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain("The pause is recorded");
  original.mockResolvedValue({ companyId: company, agentId, requestId: input.requestId, pendingWork: "cancel", acceptedAt: "2026-10-12T00:00:00Z", admissionClosedAtAcceptance: true, workSettled: false });
  await click("Check original pause"); await vi.waitFor(() => expect(container.textContent).toContain("The pause is recorded")); expect(pause).toHaveBeenCalledTimes(1);
});
it("discards consent when the current source is rechecked", async () => {
  const source = vi.spyOn(agentPauseApi, "review").mockResolvedValue(review), pause = vi.spyOn(agentPauseApi, "pause");
  await mount(); await click("Pause agent"); await act(async () => document.querySelector<HTMLInputElement>('input[value="drain"]')!.click());
  let release!: (value: typeof review) => void; source.mockImplementationOnce(() => new Promise(done => { release = done; })); let pending!: Promise<void>;
  await act(async () => { pending = client.refetchQueries({ queryKey: ["agent-pause-review"] }); });
  await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
  await act(async () => { release(review); await pending; }); await click("Pause agent");
  expect([...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every(input => !input.checked)).toBe(true); expect(pause).not.toHaveBeenCalled();
});
it("recovers a known acknowledgement after remount only through a fresh Original GET", async () => {
  vi.spyOn(agentPauseApi, "review").mockResolvedValue(review);
  const pause = vi.spyOn(agentPauseApi, "pause").mockImplementation(async (_c, _p, _a, input) => ({ companyId: company, agentId, requestId: input.requestId,
    pendingWork: input.pendingWork, acceptedAt: "2026-10-12T00:00:00Z", admissionClosedAtAcceptance: true, workSettled: false }));
  let release!: (value: Awaited<ReturnType<typeof agentPauseApi.receipt>>) => void;
  const original = vi.spyOn(agentPauseApi, "receipt").mockImplementation(() => new Promise(done => { release = done; }));
  await mount(); await click("Pause agent"); await act(async () => document.querySelector<HTMLInputElement>('input[value="drain"]')!.click()); await click("Pause agent", true);
  await vi.waitFor(() => expect(container.textContent).toContain("The pause is recorded")); const input = pause.mock.calls[0]![3];
  await act(async () => root.unmount()); root = createRoot(container); await render();
  await vi.waitFor(() => expect(original).toHaveBeenCalledWith(company, "owner", agentId, input.requestId, expect.any(AbortSignal)));
  expect(container.textContent).not.toContain("The pause is recorded"); expect(pause).toHaveBeenCalledTimes(1);
  await act(async () => release({ companyId: company, agentId, requestId: input.requestId, pendingWork: "drain", acceptedAt: "2026-10-12T00:00:00Z", admissionClosedAtAcceptance: true, workSettled: false }));
  await vi.waitFor(() => expect(container.textContent).toContain("The pause is recorded")); expect(pause).toHaveBeenCalledTimes(1);
});
it("refuses confirmation immediately when the Original session cache changes", async () => {
  vi.spyOn(agentPauseApi, "review").mockResolvedValue(review); const pause = vi.spyOn(agentPauseApi, "pause");
  await mount(); await click("Pause agent"); await act(async () => document.querySelector<HTMLInputElement>('input[value="drain"]')!.click());
  const confirm = [...document.querySelector('[role="alertdialog"]')!.querySelectorAll("button")].find(button => button.textContent === "Pause agent")!;
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other")); confirm.click(); });
  expect(pause).not.toHaveBeenCalled(); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
