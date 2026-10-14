// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AgentPackages } from "./AgentPackages";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import "../i18n";
vi.mock("../components/MaintenanceHistoryLink", () => ({ MaintenanceHistoryLink: () => null }));
const f = vi.hoisted(() => ({
  userId: "owner-a",
  companyId: "company-a",
  catalog: vi.fn(),
  options: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  install: vi.fn(),
  decide: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/api/companies-query", () => ({
  useAccountIdentity: () => ({ userId: f.userId, settled: true, failed: false, localImplicit: false }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: f.companyId }),
}));
vi.mock("@/api/agent-packages", () => ({
  agentPackagesApi: f,
  packageProposalsApi: { list: async () => [] },
}));
vi.mock("@/api/ai-governance", () => ({
  aiGovernanceApi: { list: async () => [] },
}));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  f.userId = "owner-a";
  f.companyId = "company-a";
  const hash = "a".repeat(64);
  f.catalog.mockResolvedValue([
    {
      id: "11111111-1111-4111-8111-111111111111",
      key: "internal-review",
      name: "Internal Review",
      description: "Read-only test package",
      versionId: "22222222-2222-4222-8222-222222222222",
      version: "1.0.0",
      manifest: {
        audience: "internal_test",
        purpose: "Prepare a governed draft",
        prohibitedUses: ["External writes"],
        requiredConnections: [],
        optionalConnections: ["slack"],
      },
      components: [
        { key: "role", type: "role_pack", required: true, contentHash: hash },
      ],
    },
  ]);
  f.options.mockResolvedValue({
    agents: [
      { id: "33333333-3333-4333-8333-333333333333", name: "Company agent" },
    ],
    components: [
      {
        type: "role_pack",
        resourceId: "44444444-4444-4444-8444-444444444444",
        versionId: "55555555-5555-4555-8555-555555555555",
        contentHash: hash,
        name: "Approved role",
      },
    ],
  });
  f.list.mockResolvedValue([]);
  f.preview.mockResolvedValue({
    readiness: {
      status: "ready_with_warnings",
      reasons: [],
      warnings: ["Optional Slack access is unavailable"],
      assessmentIds: [],
    },
  });
  f.install.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(f.userId));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentPackages />
      </QueryClientProvider>,
    ),
  );
  await flush();
}
async function click(text: string) {
  const b = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  )!;
  expect(b).toBeTruthy();
  await act(async () => b.click());
  await flush();
}
async function configure() {
  await click("Review package");
  const selects = container.querySelectorAll("select");
  for (const select of selects) {
    await act(async () => {
      select.value = select.options[1]!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
}
it("checks readiness and installs native configuration without silently activating or granting access", async () => {
  await render();
  await configure();
  await click("Check readiness");
  expect(container.textContent).toContain(
    "Optional Slack access is unavailable",
  );
  await click("Install for configuration");
  expect(f.preview.mock.calls[0]!.slice(0, 3)).toEqual([
    "company-a",
    "owner-a",
    "internal-review",
  ]);
  expect(f.install.mock.calls[0]![3]).toMatchObject({
    acceptInternalEvaluation: true,
    components: [
      {
        key: "role",
        resourceId: "44444444-4444-4444-8444-444444444444",
        versionId: "55555555-5555-4555-8555-555555555555",
      },
    ],
  });
  expect(f.decide).not.toHaveBeenCalled();
});
it("discards readiness returned after an account or company change", async () => {
  let resolve!: (value: unknown) => void;
  f.preview.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await configure();
  await click("Check readiness");
  f.userId = "owner-b";
  f.companyId = "company-b";
  await act(async () => client.setQueryData(queryKeys.auth.session, v9SessionFixture(f.userId)));
  await render();
  await act(async () =>
    resolve({
      readiness: {
        status: "ready",
        reasons: [],
        warnings: ["Old account readiness"],
        assessmentIds: [],
      },
    }),
  );
  await flush();
  expect(container.textContent).not.toContain("Old account readiness");
  expect(f.install).not.toHaveBeenCalled();
  expect(f.list).toHaveBeenCalledWith("company-b", "owner-b");
});

it("withdraws private setup during a current-session check and restores same-person unsent inputs without an old readiness receipt", async () => {
  await render(); await configure(); await click("Check readiness");
  expect(container.textContent).toContain("Optional Slack access is unavailable");
  let resolve!: (value: unknown) => void;
  let checking!: Promise<unknown>;
  await act(async () => { checking = client.fetchQuery({ queryKey: queryKeys.auth.session,
    queryFn: () => new Promise(done => { resolve = done; }), staleTime: 0 }); });
  await flush();
  expect(container.textContent).not.toContain("Internal Review");
  expect(container.textContent).not.toContain("Optional Slack access is unavailable");
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector("main")).toBeNull();
  await act(async () => { resolve(v9SessionFixture(f.userId)); await checking; });
  await flush();
  expect(container.textContent).toContain("Configure Internal Review");
  expect(container.querySelector("select")?.value).toBe("33333333-3333-4333-8333-333333333333");
  expect(container.textContent).not.toContain("Optional Slack access is unavailable");
  expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Install for configuration")?.disabled).toBe(true);
  expect(f.install).not.toHaveBeenCalled();
});
it("rejects a late private catalog from an earlier session and hides raw Native error text", async () => {
  let resolve!: (value: unknown) => void;
  const rows = await f.catalog();
  f.catalog.mockResolvedValue([]).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render();
  await act(async () => client.setQueryData(queryKeys.auth.session, { ...v9SessionFixture(f.userId), session: { ...v9SessionFixture(f.userId).session, id: "new-session" } }));
  await flush(); await act(async () => resolve(rows)); await flush();
  expect(container.textContent).not.toContain("Internal Review");
  f.options.mockRejectedValueOnce(Error("PRIVATE-PROVIDER-ERROR credentials and customer configuration"));
  await act(async () => client.invalidateQueries({ queryKey: ["agent-package-options"] }));
  await flush();
  expect(container.textContent).not.toContain("PRIVATE-PROVIDER-ERROR");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("This request could not be confirmed");
  expect(container.textContent).not.toContain("Company agent");
  expect(container.querySelector("select")).toBeNull();
  expect(f.install).not.toHaveBeenCalled();
});

it("withdraws a selected immutable version when the Original catalog no longer admits it", async () => {
  await render(); await configure(); await click("Check readiness");
  expect(container.textContent).toContain("Configure Internal Review");
  f.catalog.mockResolvedValueOnce([]);
  await act(async () => client.invalidateQueries({ queryKey: ["agent-packages"] })); await flush();
  expect(container.textContent).not.toContain("Configure Internal Review");
  expect(container.textContent).not.toContain("Optional Slack access is unavailable");
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("selected package version could not be confirmed");
  expect(f.install).not.toHaveBeenCalled();
});
