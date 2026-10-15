// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { agentAuthoringApi } from "../api/agent-authoring";
import { AgentRevisionEntry } from "./AgentRevisionEntry";
import "../i18n";
const state = vi.hoisted(() => ({ enabled: true, navigate: vi.fn() }));
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({ enabled: state.enabled }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: "member",
    settled: true,
    failed: false,
    localImplicit: false,
  }),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: () => {},
}));
vi.mock("../lib/router", () => ({ useNavigate: () => state.navigate }));
const company = "10000000-0000-4000-8000-000000000001",
  agentId = "10000000-0000-4000-8000-000000000002";
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
  state.enabled = true;
  state.navigate.mockClear();
});
async function mount(beforeNavigate: () => boolean | Promise<boolean>) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentRevisionEntry
          company={company}
          agentId={agentId}
          beforeNavigate={beforeNavigate}
        />
      </QueryClientProvider>,
    ),
  );
}
it("opens only a target-bound native revision draft and preserves the existing unsaved-change guard", async () => {
  vi.spyOn(agentAuthoringApi, "admission").mockResolvedValue({
    companyId: company,
    agentId,
    canCreateDraft: true,
  });
  const create = vi.spyOn(agentAuthoringApi, "create");
  const before = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  await mount(before);
  await vi.waitFor(() =>
    expect(container.querySelector("button")).not.toBeNull(),
  );
  await act(async () => container.querySelector("button")!.click());
  expect(state.navigate).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(state.navigate).toHaveBeenCalledWith(
    `/agents/custom?agentId=${agentId}`,
  );
  expect(create).not.toHaveBeenCalled();
  expect(container.textContent).toContain("active agent stays unchanged");
});
it("hides unavailable admission without exposing raw denial details", async () => {
  vi.spyOn(agentAuthoringApi, "admission").mockRejectedValue(
    new Error("PRIVATE-DENIAL"),
  );
  await mount(() => true);
  await vi.waitFor(() =>
    expect(client.getQueryCache().getAll()[0]?.state.status).toBe("error"),
  );
  expect(container.textContent).toBe("");
  expect(state.navigate).not.toHaveBeenCalled();
});
it("does not request current-account admission while the feature is disabled", async () => {
  state.enabled = false;
  const read = vi.spyOn(agentAuthoringApi, "admission");
  await mount(() => true);
  expect(read).not.toHaveBeenCalled();
  expect(container.textContent).toBe("");
});
it("ignores a late navigation confirmation after flag rollback unmounts the entry", async () => {
  vi.spyOn(agentAuthoringApi, "admission").mockResolvedValue({
    companyId: company,
    agentId,
    canCreateDraft: true,
  });
  let finish!: (value: boolean) => void;
  const before = () =>
    new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  await mount(before);
  await vi.waitFor(() =>
    expect(container.querySelector("button")).not.toBeNull(),
  );
  await act(async () => container.querySelector("button")!.click());
  state.enabled = false;
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentRevisionEntry
          company={company}
          agentId={agentId}
          beforeNavigate={before}
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => finish(true));
  expect(state.navigate).not.toHaveBeenCalled();
});
