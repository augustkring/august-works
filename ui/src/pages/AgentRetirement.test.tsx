// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentRetirementView } from "@paperclipai/shared";
import { agentRetirementApi } from "../api/agent-retirement";
import { authApi } from "../api/auth";
import { AgentRetirement } from "./AgentRetirement";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let live: (event: { companyId: string; type: string; payload: Record<string, unknown> }) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company", selectedCompany: { issuePrefix: "AW" } }) }));
const ready: AgentRetirementView = { companyId: "company", agentId: "agent", name: "Reviewed original agent", observedAt: "2026-10-11T00:00:00Z",
  sourceToken: "a".repeat(64), state: "ready", alreadyStopped: false, canRetire: true, blockers: [], retiredAt: null,
  policyVersion: "aw.agent-retirement.v1", affectedAccess: { apiKeys: 1, permissions: 2, agentPermissionSettings: 1, connectedApps: 0, credentialBindings: 0, runtimeBindings: 0, toolTokens: 0, toolProfiles: 0 } };
const retired: AgentRetirementView = { ...ready, state: "retired", alreadyStopped: true, canRetire: false, retiredAt: ready.observedAt };
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount()); client?.clear(); container?.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en");
});
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(["auth", "session"], v9SessionFixture("owner"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><main>
    <AgentRetirement company="company" principal="owner" agentId="agent" />
  </main></MemoryRouter></QueryClientProvider>));
}
function button(label: string) { return [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === label)!; }
async function confirm() { await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
it("requires explicit confirmation, localizes without writing and sends one immutable request on a double click", async () => {
  vi.spyOn(agentRetirementApi, "get").mockResolvedValue(ready);
  let finish!: (value: AgentRetirementView) => void;
  const write = vi.spyOn(agentRetirementApi, "retire").mockImplementation(() => new Promise(done => { finish = done; }));
  await mount(); await vi.waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
  expect(document.activeElement).toBe(container.querySelector("h1")); expect(button("Permanently retire agent").disabled).toBe(true);
  await act(async () => i18n.changeLanguage("da")); expect(container.textContent).toContain("Pensionér Reviewed original agent"); expect(write).not.toHaveBeenCalled();
  await act(async () => i18n.changeLanguage("en")); await confirm(); const retire = button("Permanently retire agent");
  await act(async () => { retire.click(); retire.click(); }); expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][3]).toMatchObject({ expectedSourceToken: ready.sourceToken, confirmRetirement: true, pendingWorkPolicy: "require_settled" });
  expect(Object.isFrozen(write.mock.calls[0][3])).toBe(true);
  await act(async () => finish(retired));
});
it("retries exactly the same unknown request without inventing a completed state from its acknowledgement", async () => {
  const get = vi.spyOn(agentRetirementApi, "get").mockResolvedValue(ready);
  const write = vi.spyOn(agentRetirementApi, "retire").mockRejectedValueOnce(new Error("PRIVATE token")).mockResolvedValue(retired);
  await mount(); await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull()); await confirm();
  await act(async () => button("Permanently retire agent").click()); await vi.waitFor(() => expect(button("Retry the same retirement")).toBeDefined());
  expect(container.textContent).not.toContain("PRIVATE"); expect(container.textContent).not.toContain("Retirement is confirmed");
  const original = write.mock.calls[0][3]; get.mockResolvedValue(retired);
  await act(async () => button("Retry the same retirement").click());
  await vi.waitFor(() => expect(container.textContent).toContain("Retirement is confirmed"));
  expect(write).toHaveBeenCalledTimes(2); expect(write.mock.calls[1][3]).toBe(original); expect(container.querySelector("input")).toBeNull();
});
it("clears old confirmation on a changed source and restores the original return link after refresh", async () => {
  const get = vi.spyOn(agentRetirementApi, "get").mockResolvedValue(ready), write = vi.spyOn(agentRetirementApi, "retire");
  await mount(); await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull()); await confirm();
  const back = container.querySelector<HTMLAnchorElement>('footer a')!; back.focus();
  let finish!: (value: AgentRetirementView) => void; get.mockImplementationOnce(() => new Promise(done => { finish = done; }));
  await act(async () => live({ companyId: "company", type: "activity.logged", payload: {} }));
  expect(container.textContent).not.toContain(ready.name);
  await act(async () => finish({ ...ready, sourceToken: "b".repeat(64), affectedAccess: { ...ready.affectedAccess!, apiKeys: 2 } }));
  await vi.waitFor(() => expect(button("Permanently retire agent")).toBeDefined());
  expect(button("Permanently retire agent").disabled).toBe(true); expect(container.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
  expect(document.activeElement).toBe(container.querySelector('footer a')); expect(write).not.toHaveBeenCalled();
});
it("blocks same-turn writes during account recheck and requires renewed confirmation after the authority changes", async () => {
  vi.spyOn(agentRetirementApi, "get").mockResolvedValue(ready); const write = vi.spyOn(agentRetirementApi, "retire");
  await mount(); await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull()); await confirm();
  const oldButton = button("Permanently retire agent"); let finish!: (value: ReturnType<typeof v9SessionFixture>) => void;
  vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise(done => { finish = done; })); let pending!: Promise<unknown>;
  await act(async () => { pending = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: authApi.getSession, staleTime: 0 }); oldButton.click(); });
  expect(write).not.toHaveBeenCalled(); expect(container.textContent).not.toContain(ready.name);
  await act(async () => { finish(v9SessionFixture("owner")); await pending; });
  await vi.waitFor(() => expect(button("Permanently retire agent")).toBeDefined()); expect(button("Permanently retire agent").disabled).toBe(true);
});
it("fences a late acknowledgement from a changed account and shows only current original-owner state", async () => {
  const get = vi.spyOn(agentRetirementApi, "get").mockResolvedValue(ready);
  let finish!: (value: AgentRetirementView) => void; vi.spyOn(agentRetirementApi, "retire").mockImplementation(() => new Promise(done => { finish = done; }));
  await mount(); await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull()); await confirm();
  await act(async () => button("Permanently retire agent").click());
  get.mockResolvedValue({ ...ready, state: "blocked", canRetire: false, blockers: ["work_pending"] });
  await act(async () => client.setQueryData(["auth", "session"], { ...v9SessionFixture("owner"), session: { ...v9SessionFixture("owner").session, id: "new-original-session" } }));
  await act(async () => finish(retired)); await vi.waitFor(() => expect(container.textContent).toContain("Settle or reassign outstanding work"));
  expect(container.textContent).not.toContain("Retirement is confirmed");
});
it("does not turn an unbounded access review or legacy stopped status into zero counts or retirement proof", async () => {
  vi.spyOn(agentRetirementApi, "get").mockResolvedValue({ ...ready, state: "blocked", alreadyStopped: true, canRetire: false, blockers: ["source_limit"], affectedAccess: null });
  const write = vi.spyOn(agentRetirementApi, "retire"); await mount(); await vi.waitFor(() => expect(container.textContent).toContain("A complete access count is unavailable"));
  expect(container.textContent).toContain("previously stopped"); expect(container.querySelector("dd")).toBeNull();
  expect(container.querySelector("input")).toBeNull(); expect(container.textContent).not.toContain("Retirement is confirmed"); expect(write).not.toHaveBeenCalled();
});
