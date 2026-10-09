// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  V5_FEATURE_KEYS,
  type HireAgentCapability,
  type LiveEvent,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "../api/agent-authoring";
import { instanceSettingsApi } from "../api/instanceSettings";
import { HireAgent } from "./HireAgent";

const context = vi.hoisted(() => ({
  company: "10000000-0000-4000-8000-000000000001",
  principal: "author",
  live: null as null | ((event: LiveEvent) => void),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: context.company,
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: context.principal,
    settled: true,
    localImplicit: false,
  }),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (handler: (event: LiveEvent) => void) => {
    context.live = handler;
  },
}));
const capability: HireAgentCapability = {
  key: "research",
  versionId: "10000000-0000-4000-8000-000000000002",
  version: "1.0.0",
  name: "Research assistant",
  category: "Research",
  outcome: "Prepare a sourced competitor brief",
  requiredKnowledge: ["Approved competitors"],
  requiredConnections: ["Approved document store"],
  limits: ["Drafts need human review"],
  actionClasses: ["internal_draft"],
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  context.principal = "author";
  context.live = null;
  vi.restoreAllMocks();
});
async function mount(path = "/AW/agents/hire") {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({
    ...Object.fromEntries(V5_FEATURE_KEYS.map((key) => [key, true])),
    enableFoundationV1: true,
    enableContextEngineV1: true,
    saas_deployment_profile_v6: true,
    billing_v6: true,
    agent_packages_v7: true,
    hire_agent_v9: true,
  } as never);
  await act(async () =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/AW/agents/hire" element={<HireAgent />} />
              <Route
                path="/AW/agents/hire/capabilities/:versionId"
                element={<HireAgent />}
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
}
it("searches capabilities by outcome and displays the current native detail without creating or activating an agent", async () => {
  vi.spyOn(agentAuthoringApi, "hireCatalog").mockResolvedValue([capability]);
  const create = vi.spyOn(agentAuthoringApi, "create");
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain(capability.outcome),
  );
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "competitor");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("Research assistant");
  await act(async () =>
    (
      container.querySelector(
        `a[href*="${capability.versionId}"]`,
      ) as HTMLAnchorElement
    ).click(),
  );
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Important limits"),
  );
  expect(container.textContent).toContain("Asks before");
  expect(container.textContent).toContain("Approved document store");
  expect(
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Use this agent",
    )?.disabled,
  ).toBe(true);
  expect(create).not.toHaveBeenCalled();
});
it("shows a truthful empty catalog and rejects a withdrawn deep-linked version", async () => {
  vi.spyOn(agentAuthoringApi, "hireCatalog").mockResolvedValue([]);
  await mount(`/AW/agents/hire/capabilities/${capability.versionId}`);
  await vi.waitFor(() =>
    expect(container.textContent).toContain("no longer available"),
  );
  expect(container.textContent).not.toContain(capability.name);
  expect(container.querySelector("button:disabled")).toBeNull();
});
it("hides the catalog on a permission event while the native owner rechecks current access", async () => {
  const get = vi
    .spyOn(agentAuthoringApi, "hireCatalog")
    .mockResolvedValue([capability]);
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain(capability.name),
  );
  get.mockImplementation(() => new Promise(() => {}));
  await act(async () =>
    context.live?.({
      id: 1,
      createdAt: "2026-10-09T00:00:00.000Z",
      type: "activity.logged",
      companyId: context.company,
      payload: {
        action: "company_membership.permission_changed",
        entityType: "company_membership",
      },
    } as LiveEvent),
  );
  expect(container.textContent).not.toContain(capability.name);
  expect(container.textContent).toContain("Loading available capabilities");
});
