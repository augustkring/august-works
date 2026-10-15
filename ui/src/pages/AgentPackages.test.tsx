// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AgentPackages } from "./AgentPackages";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
vi.mock("../components/MaintenanceHistoryLink", () => ({ MaintenanceHistoryLink: () => null }));
const f = vi.hoisted(() => ({
  userId: "owner-a",
  companyId: "10000000-0000-4000-8000-000000000001",
  catalog: vi.fn(),
  options: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  install: vi.fn(),
  decide: vi.fn(),
  update: vi.fn(),
  proposalsList: vi.fn(),
  proposalReview: vi.fn(),
  installationRequest: vi.fn(),
  governanceList: vi.fn(),
}));
vi.mock("@/api/companies-query", () => ({
  useAccountIdentity: () => ({ userId: f.userId, settled: true, failed: false, localImplicit: false }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: f.companyId }),
}));
vi.mock("@/api/agent-packages", () => ({
  agentPackagesApi: f,
  packageProposalsApi: { list: f.proposalsList, review: f.proposalReview },
}));
vi.mock("@/api/ai-governance", () => ({
  aiGovernanceApi: { list: f.governanceList },
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
  f.companyId = "10000000-0000-4000-8000-000000000001";
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
  sessionStorage.clear();
  f.installationRequest.mockRejectedValue(new Error("Original request unconfirmed"));
  f.list.mockResolvedValue([]);
  f.proposalsList.mockResolvedValue([]);
  f.governanceList.mockResolvedValue([]);
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
  sessionStorage.clear();
  container.remove();
  await act(async () => i18n.changeLanguage("en"));
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
it("previews the exact currently offered workflow and routine pins without starting either", async () => {
  const catalog = await f.catalog(), options = await f.options();
  const automations = [
    { key: "workflow", type: "workflow_template", resourceId: "66666666-6666-4666-8666-666666666666", versionId: "77777777-7777-4777-8777-777777777777", contentHash: "b".repeat(64), name: "Manual workflow" },
    { key: "routine", type: "routine_template", resourceId: "88888888-8888-4888-8888-888888888888", versionId: "99999999-9999-4999-8999-999999999999", contentHash: "c".repeat(64), name: "Manual routine" },
  ];
  f.catalog.mockResolvedValue([{ ...catalog[0], components: [...catalog[0].components,
    ...automations.map(({ key, type, contentHash }) => ({ key, type, contentHash, required: true }))] }]);
  f.options.mockResolvedValue({ ...options, components: [...options.components, ...automations] });
  await render(); await configure(); await click("Check readiness");
  expect(f.preview.mock.calls[0]![3].components).toEqual(expect.arrayContaining(
    automations.map(({ key, resourceId, versionId }) => ({ key, resourceId, versionId }))));
  expect(f.install).not.toHaveBeenCalled(); expect(f.decide).not.toHaveBeenCalled();
});

it("checks readiness and installs native configuration without silently activating or granting access", async () => {
  await render();
  await configure();
  await click("Check readiness");
  expect(container.textContent).toContain(
    "Optional Slack access is unavailable",
  );
  await click("Install for configuration");
  expect(f.preview.mock.calls[0]!.slice(0, 3)).toEqual([
    "10000000-0000-4000-8000-000000000001",
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
  f.companyId = "10000000-0000-4000-8000-000000000002";
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
  expect(f.list).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000002", "owner-b");
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
it("localizes Danish configuration without changing unsent selections or dispatching work", async () => {
  await render(); await configure(); await click("Check readiness");
  await act(async () => i18n.changeLanguage("da"));
  expect(container.querySelector("h1")?.textContent).toBe("Specialistpakker");
  expect(container.textContent).toContain("Opsæt Internal Review");
  expect(container.textContent).toContain("Parathed: Klar med advarsler");
  expect(container.textContent).toContain("Model- og kørselsforbrug afregnes særskilt.");
  expect(container.textContent).not.toContain("Update policy");
  expect(container.textContent).not.toContain("Check readiness");
  expect(container.querySelector("select")?.value).toBe("33333333-3333-4333-8333-333333333333");
  expect(container.querySelector('a[href="/connections"]')?.textContent).toBe("Forbindelser");
  expect(f.install).not.toHaveBeenCalled(); expect(f.decide).not.toHaveBeenCalled();
});
it("localizes current installed and historical proposal status without claiming activation", async () => {
  const catalog = (await f.catalog())[0];
  f.list.mockResolvedValue([{ id: "installation", packageId: catalog.id, installedVersionId: catalog.versionId,
    status: "degraded", version: 3, readiness: { reasons: [], warnings: [] } }]);
  f.proposalsList.mockResolvedValue([{ id: "proposal", status: "accepted", reason: "Original proposal explanation", material: true,
    beforeManifest: { maximumRisk: "C1" }, afterManifest: { purpose: "Original intended purpose", maximumRisk: "C2", requiredConnections: [],
      prohibitedUses: ["External writes"], knownLimitations: ["Original qualification limit"] } }]);
  await act(async () => i18n.changeLanguage("da")); await render();
  expect(container.textContent).toContain("Installerede pakker");
  expect(container.textContent).toContain("Status: Kræver opmærksomhed. Opdateringer kræver gennemgang.");
  expect(container.textContent).toContain("Gennemgået og accepteret");
  expect(container.textContent).toContain("Original intended purpose");
  expect(container.textContent).toContain("Risikogrænse: C1 → C2.");
  expect(container.textContent).not.toContain("Risk envelope");
  expect(f.decide).not.toHaveBeenCalled(); expect(f.proposalReview).not.toHaveBeenCalled();
});

it("retains only the original locator after a lost install response and reconciles without another write", async () => {
  f.install.mockRejectedValueOnce(Error("PRIVATE lost acknowledgement"));
  await render(); await configure(); await click("Check readiness"); await click("Install for configuration");
  expect(f.install).toHaveBeenCalledTimes(1);
  const original = f.install.mock.calls[0]![3];
  expect(original.installationRequestId).toMatch(/^[a-f0-9-]{36}$/);
  const saved = sessionStorage.getItem("aw.v9.pending-package-installation-requests")!;
  expect(saved).toContain(original.installationRequestId);
  expect(saved).not.toMatch(/PRIVATE|components|internal-review|agentId|updatePolicy|33333333/);
  expect(container.textContent).toContain("original installation could not be confirmed");
  expect(container.textContent).not.toContain("PRIVATE lost acknowledgement");
  expect(container.querySelector("select")).toBeNull();
  f.installationRequest.mockResolvedValueOnce({ companyId: f.companyId, requestId: original.installationRequestId,
    installationId: "20000000-0000-4000-8000-000000000001", installationVersion: 1, installationStatus: "configuring", observedAt: "2026-10-14T14:00:00Z" });
  await click("Check original request");
  expect(container.textContent).toContain("An installation is recorded for this request");
  expect(f.install).toHaveBeenCalledTimes(1); expect(f.decide).not.toHaveBeenCalled();
  await click("Return to packages");
  expect(sessionStorage.getItem("aw.v9.pending-package-installation-requests")).toBeNull();
  expect(f.install).toHaveBeenCalledTimes(1);
});
it("retries only the exact same in-memory request and rejects another setup while it is unresolved", async () => {
  f.install.mockRejectedValue(Error("unknown acknowledgement"));
  await render(); await configure(); await click("Check readiness"); await click("Install for configuration");
  const first = structuredClone(f.install.mock.calls[0]![3]);
  await click("Send the same request again");
  expect(f.install).toHaveBeenCalledTimes(2); expect(f.install.mock.calls[1]![3]).toEqual(first);
  expect(container.querySelector("select")).toBeNull();
  expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Return to packages")?.disabled).toBe(true);
  expect(f.decide).not.toHaveBeenCalled();
});
it("recovers a stored locator after remount without rebuilding configuration or posting", async () => {
  const requestId = "20000000-0000-4000-8000-000000000001";
  sessionStorage.setItem("aw.v9.pending-package-installation-requests", JSON.stringify([{ companyId: f.companyId, principal: f.userId, requestId }]));
  await render();
  expect(f.installationRequest).toHaveBeenCalledWith(f.companyId, f.userId, requestId, expect.any(AbortSignal));
  expect(container.textContent).toContain("Original installation request");
  expect(f.install).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled();
  expect(f.catalog).not.toHaveBeenCalled();
});
it("refuses new work when original locator storage is corrupt", async () => {
  sessionStorage.setItem("aw.v9.pending-package-installation-requests", '{"PRIVATE configuration":true}');
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("original request locator could not be retained or checked");
  expect(container.textContent).not.toContain("PRIVATE configuration");
  expect(f.install).not.toHaveBeenCalled(); expect(f.catalog).not.toHaveBeenCalled();
});

it("does not clear the original locator merely because an installation transport returned success", async () => {
  f.install.mockResolvedValueOnce({ companyId: "20000000-0000-4000-8000-000000000099", status: "active" });
  await render(); await configure(); await click("Check readiness"); await click("Install for configuration");
  expect(f.installationRequest).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("aw.v9.pending-package-installation-requests")).not.toBeNull();
  expect(container.textContent).toContain("original installation could not be confirmed");
  expect(container.textContent).not.toContain("An installation is recorded");
  expect(f.decide).not.toHaveBeenCalled();
});

it("withdraws readiness after a fresh Original options read even when its visible JSON is unchanged", async () => {
  await render(); await configure(); await click("Check readiness");
  expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Install for configuration")?.disabled).toBe(false);
  await act(async () => client.invalidateQueries({ queryKey: ["agent-package-options"] })); await flush();
  expect(container.textContent).not.toContain("Optional Slack access is unavailable");
  expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Install for configuration")?.disabled).toBe(true);
  expect(f.install).not.toHaveBeenCalled();
});
it("rejects an old readiness acknowledgement when Original options finish a new read during its request", async () => {
  let resolve!: (value: unknown) => void;
  f.preview.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(); await configure(); await click("Check readiness");
  await act(async () => client.invalidateQueries({ queryKey: ["agent-package-options"] })); await flush();
  await act(async () => resolve({ readiness: { status: "ready", reasons: [], warnings: ["PRIVATE OLD READINESS"], assessmentIds: [] } })); await flush();
  expect(container.textContent).not.toContain("PRIVATE OLD READINESS");
  expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Install for configuration")?.disabled).toBe(true);
});

it("keeps readiness unavailable while a required approved component is missing", async () => {
  await render(); await click("Review package");
  const agent = container.querySelector("select")!;
  await act(async () => { agent.value = "33333333-3333-4333-8333-333333333333"; agent.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
  const check = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Check readiness")!;
  expect(check.disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled(); expect(f.install).not.toHaveBeenCalled();
});
it("withdraws the readiness action when the selected Agent is no longer offered by the Original options owner", async () => {
  await render(); await configure();
  const before = await f.options(); f.options.mockResolvedValueOnce({ ...before, agents: [] });
  await act(async () => client.invalidateQueries({ queryKey: ["agent-package-options"] })); await flush();
  expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Check readiness")?.disabled).toBe(true);
  expect(f.preview).not.toHaveBeenCalled(); expect(f.install).not.toHaveBeenCalled();
});
it("requires an actually approved current purpose before previewing a customer package", async () => {
  const catalog = await f.catalog(); f.catalog.mockResolvedValue([{ ...catalog[0], manifest: { ...catalog[0].manifest, audience: "customer" } }]);
  const purposeId = "40000000-0000-4000-8000-000000000001";
  f.governanceList.mockResolvedValue([{ id: purposeId, status: "approved", purpose: { intendedPurpose: "Original reviewed purpose" } }]);
  await render(); await click("Review package");
  for (const value of ["33333333-3333-4333-8333-333333333333", "55555555-5555-4555-8555-555555555555"]) {
    const select = Array.from(container.querySelectorAll("select")).find(select => Array.from(select.options).some(option => option.value === value))!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  await flush();
  const check = () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Check readiness")!;
  expect(check().disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled();
  const purpose = Array.from(container.querySelectorAll("select")).find(select => Array.from(select.options).some(option => option.value === purposeId))!;
  await act(async () => { purpose.value = purposeId; purpose.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
  expect(check().disabled).toBe(false);
  f.governanceList.mockResolvedValueOnce([{ id: purposeId, status: "retired", purpose: { intendedPurpose: "Original reviewed purpose" } }]);
  await act(async () => client.invalidateQueries({ queryKey: ["package-use-cases"] })); await flush();
  expect(check().disabled).toBe(true); expect(f.install).not.toHaveBeenCalled();
});
it("requires a fresh installation review after its Original current version changes", async () => {
  const catalog = (await f.catalog())[0];
  const row = { id: "installation", packageId: catalog.id, installedVersionId: "20000000-0000-4000-8000-000000000003",
    status: "degraded", version: 3, agentId: "33333333-3333-4333-8333-333333333333", aiUseCaseId: null,
    updatePolicy: "manual", readiness: { reasons: [], warnings: [] } };
  f.list.mockResolvedValue([row]); await render(); await click("Review update");
  const role = Array.from(container.querySelectorAll("select")).find(select => Array.from(select.options).some(option => option.value === "55555555-5555-4555-8555-555555555555"))!;
  await act(async () => { role.value = "55555555-5555-4555-8555-555555555555"; role.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
  await click("Check readiness"); expect(container.textContent).toContain("Optional Slack access is unavailable");
  f.list.mockResolvedValueOnce([{ ...row, version: 4 }]);
  await act(async () => client.invalidateQueries({ queryKey: ["agent-package-installations"] })); await flush();
  expect(container.textContent).not.toContain("Optional Slack access is unavailable");
  expect(container.textContent).toContain("The installation changed");
  expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Check readiness")?.disabled).toBe(true);
  expect(f.update).not.toHaveBeenCalled(); expect(f.decide).not.toHaveBeenCalled();
});
