import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentAuthoringDraftViewSchema } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Scoped software responses qualify the shipped Hire interaction. Native
// provisioning/secret/operation ownership and rollback use actual PostgreSQL
// suites; this does not provision a hosted runtime or qualify a human pilot.
test("Hire recovers an unknown managed provisioning request and reloads its Original status without another effect", async ({ page, request }) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable Hire managed setup browser fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session")), original = await json(await request.get("/api/instance/settings/experimental"));
    const flags = { ...original, ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true, enableContextEngineV1: true,
      saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true, experience_projection_v9: true, progressive_shell_v9: true };
    const draft = agentAuthoringDraftViewSchema.parse({ id: id(1), companyId: company.id, createdByUserId: session.user.id, kind: "hire", agentId: null,
      version: 2, status: "draft", step: "hire_test", baselineHash: null,
      package: { key: "research", versionId: id(2), version: "1.0.0", contentHash: "a".repeat(64) },
      preparation: { agentId: id(3), name: "Inactive research agent", status: "prepared", approvalId: null, runtimeQualified: false, authorityGranted: false, executionStarted: false },
      content: agentAuthoringContentSchema.parse({ name: "Inactive research agent", ownerUserId: session.user.id, outcome: "Prepare an internal research draft" }),
      createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" });
    const imageDigest = `fixture.invalid/runtime@sha256:${"b".repeat(64)}`;
    let requests = 0, reads = 0, requestId = "";
    const receipt = () => ({ companyId: company.id, draftId: draft.id, agentId: id(3), requestId, cellId: id(4), operationId: id(5),
      recordedAt: "2026-10-13T00:00:00Z", operationStatus: "REQUESTED", runtimeStatus: "REQUESTED", modelConfigured: false,
      activatesAgent: false, grantsAuthority: false, runtimeQualified: false });
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { profile: "saas", runtime: true } }));
    await page.route(`**/api/companies/${company.id}/agent-configuration-drafts/**`, async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      expect(url.searchParams.get("expectedUserId")).toBe(session.user.id);
      if (path.endsWith("/managed-runtime") && route.request().method() === "POST") {
        requests++; const body = route.request().postDataJSON(); requestId = body.requestId;
        expect(body).toMatchObject({ capacityProfile: "software-capacity", imageDigest, expectedVersion: 2, expectedReviewHash: "c".repeat(64),
          confirmManagedCapacity: true, confirmInactiveProvisioning: true });
        return route.fulfill({ status: 503, json: { error: "PRIVATE lost acknowledgement" } });
      }
      if (path.endsWith("/managed-runtime/requests")) return route.fulfill({ json: requestId ? receipt() : null });
      if (path.includes("/managed-runtime/requests/")) { reads++; expect(path.endsWith(requestId)).toBe(true); return route.fulfill({ json: receipt() }); }
      if (path.endsWith("/managed-runtime/review")) return route.fulfill({ json: { companyId: company.id, draftId: draft.id, agentId: id(3), version: 2,
        reviewHash: "c".repeat(64), canProvision: true, blockers: [], usesIncludedCapacity: true, modelCalled: false, activatesAgent: false, grantsAuthority: false, createsRuntime: true } });
      if (path.endsWith("/managed-runtime")) return route.fulfill({ json: { companyId: company.id, draftId: draft.id, agentId: id(3), version: 2,
        capacity: [{ key: "software-capacity", product: "runtime_standard", availableCells: 1 }], versions: [{ imageDigest, providerVersion: "software-only" }], changesLiveConfiguration: false } });
      if (path.endsWith("/runtime")) return route.fulfill({ json: { draftId: draft.id, companyId: company.id, version: 2, agentId: id(3), runtimeBindingId: null,
        configurationHash: "a".repeat(64), status: "needs_setup", runtimeQualified: false, safeTestQualified: false, executionStarted: false } });
      if (path.endsWith("/options")) return route.fulfill({ json: { owners: [{ id: session.user.id, name: "Current author" }], knowledge: [], runtimes: [] } });
      if (path.endsWith("/tests")) return route.fulfill({ json: [] });
      if (path.endsWith("/hire-capability")) return route.fulfill({ json: { key: "research", versionId: id(2), version: "1.0.0", name: "Research",
        category: "Research", outcome: "Prepare an internal research draft", requiredKnowledge: [], requiredConnections: [], limits: [], actionClasses: ["internal_draft"], available: true } });
      if (path.endsWith(`/${draft.id}`)) return route.fulfill({ json: draft });
      return route.fulfill({ status: 409, json: { error: "No other fixture operation is qualified" } });
    });
    const url = `/${company.issuePrefix}/agents/hire/drafts/${draft.id}/hire_test`;
    await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible(); await page.goto(url);
    const setup = page.getByRole("region", { name: "Set up the hired agent’s managed runtime", exact: true });
    const start = setup.getByRole("button", { name: "Request managed runtime", exact: true });
    await expect(start).toBeDisabled();
    await setup.getByRole("checkbox").nth(0).check(); await setup.getByRole("checkbox").nth(1).check(); await expect(start).toBeEnabled();
    await start.click(); await expect(setup.getByRole("alert")).toBeFocused(); await expect(setup).not.toContainText("PRIVATE");
    await setup.getByRole("button", { name: "Check provisioning status", exact: true }).click();
    await expect(setup).toContainText("Managed runtime provisioning is requested"); expect(requests).toBe(1); expect(reads).toBe(1);
    await page.reload(); await expect(setup).toContainText("Managed runtime provisioning is requested");
    await expect(setup.getByRole("checkbox")).toHaveCount(0); expect(requests).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.locator("html")).toHaveAttribute("lang", "da");
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(requests).toBe(1); expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
