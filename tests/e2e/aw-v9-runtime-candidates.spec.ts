import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentAuthoringDraftViewSchema } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}

// Built software journey with scoped intercepted responses. The actual Native
// probes, liability ledger and atomic promotion run in PostgreSQL integration
// tests; this fixture does not qualify a hosted provider or user pilot.
test("saved runtime selection survives reload and an unknown qualification uses only its Original receipt", async ({ page, request }) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable runtime proposal browser fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const originalFlags = await json(await request.get("/api/instance/settings/experimental"));
    const flags = { ...originalFlags, ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true,
      enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true,
      experience_projection_v9: true, progressive_shell_v9: true };
    let draft = agentAuthoringDraftViewSchema.parse({ id: id(1), companyId: company.id, agentId: id(2), createdByUserId: session.user.id,
      kind: "custom", version: 1, status: "draft", step: "runtime", baselineHash: "a".repeat(64),
      content: agentAuthoringContentSchema.parse({ name: "Runtime specialist", ownerUserId: session.user.id }),
      createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" });
    const candidate = { id: id(3), companyId: company.id, draftId: draft.id, agentId: id(2), modelProfileId: id(4),
      configurationHash: "a".repeat(64), recordedStatus: "draft", qualificationRequestId: null, qualificationCurrent: false,
      changesLive: false, createdAt: "2026-10-13T00:00:00Z" };
    let creations = 0, qualifications = 0, receipts = 0, originalRequest = "";
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
    await page.route(`**/api/companies/${company.id}/agent-identities`, route => route.fulfill({ json: [{ id: id(5), agentId: id(6), name: "Isolation peer" }] }));
    await page.route(`**/api/companies/${company.id}/agent-configuration-drafts/**`, async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      expect(url.searchParams.get("expectedUserId")).toBe(session.user.id);
      if (path.endsWith("/runtime-candidates") && route.request().method() === "POST") {
        creations++; expect(route.request().postDataJSON()).toMatchObject({ modelProfileId: id(4), expectedVersion: 1 });
        return route.fulfill({ json: candidate });
      }
      if (path.endsWith("/runtime-candidates")) return route.fulfill({ json: { companyId: company.id, draftId: draft.id, version: draft.version,
        agentId: id(2), identityId: id(5), choices: [{ modelProfileId: id(4), model: "Software fixture model", configurationHash: "a".repeat(64),
          maxOutputTokens: 256, maximumMinorPerCall: 3, currency: "USD", requiresConformance: true, changesLive: false }] } });
      if (path.endsWith("/conformance-review")) return route.fulfill({ json: { companyId: company.id, draftId: draft.id, candidateId: id(3), version: draft.version,
        reviewHash: "b".repeat(64), canTest: true, blockers: [], maximumMinor: 12, currency: "USD", probeCount: 4, toolsGranted: false,
        changesLiveConfiguration: false, providerComputeStopConfirmed: false } });
      if (path.endsWith("/conformance")) {
        qualifications++; const body = route.request().postDataJSON(); originalRequest = body.requestId;
        expect(body).toMatchObject({ expectedVersion: 2, expectedReviewHash: "b".repeat(64), confirmBoundedConformance: true,
          confirmCompanyVisibleProbes: true, isolationPeer: { companyId: company.id, agentId: id(6) } });
        return route.fulfill({ status: 503, json: { error: "PRIVATE lost qualification response" } });
      }
      if (path.includes("/conformance/requests/")) {
        receipts++; expect(path.endsWith(originalRequest)).toBe(true); expect(route.request().method()).toBe("GET");
        return route.fulfill({ json: { companyId: company.id, draftId: draft.id, candidateId: id(3), requestId: originalRequest, status: "qualified",
          createdAt: "2026-10-13T00:00:00Z", finishedAt: "2026-10-13T00:01:00Z", runIds: [id(7), id(8), id(9), id(10)],
          reservationIds: [id(11), id(12), id(13), id(14)], reservedMinor: 12, unknownCharges: 1,
          changesLiveConfiguration: false, providerComputeStopConfirmed: false } });
      }
      if (path.endsWith("/options")) return route.fulfill({ json: { owners: [{ id: session.user.id, name: "Current author" }], knowledge: [], runtimes: [] } });
      if (path.endsWith("/preparation-review")) return route.fulfill({ status: 409, json: { error: "Existing software Agent" } });
      if (path.endsWith("/runtime")) return route.fulfill({ json: { draftId: draft.id, companyId: company.id, version: draft.version,
        agentId: id(2), runtimeBindingId: null, configurationHash: "a".repeat(64), status: "needs_setup", runtimeQualified: false,
        safeTestQualified: false, executionStarted: false } });
      if (path.endsWith("/tests")) return route.fulfill({ json: [] });
      if (path.endsWith(`/${draft.id}/save`)) {
        const body = route.request().postDataJSON(); expect(body.content.runtimeCandidateId).toBe(id(3));
        draft = { ...draft, content: body.content, version: 2, step: body.step }; return route.fulfill({ json: draft });
      }
      if (path.endsWith(`/${draft.id}`)) return route.fulfill({ json: draft });
      return route.fulfill({ status: 409, json: { error: "No other fixture operation is qualified" } });
    });
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.goto(`/${company.issuePrefix}/agents/custom/${draft.id}/runtime`);
    const advanced = page.locator("summary", { hasText: "Advanced runtime alternatives" });
    await advanced.click();
    await expect(page.getByRole("combobox", { name: "Installed model profile", exact: true }).locator("option", { hasText: "Software fixture model" })).toHaveCount(1);
    await page.getByRole("combobox", { name: "Installed model profile", exact: true }).selectOption(id(4));
    await expect(page.getByRole("combobox", { name: "Installed model profile", exact: true })).toHaveValue(id(4));
    await page.getByRole("button", { name: "Save runtime proposal", exact: true }).click();
    await expect(page.getByRole("main")).toContainText("Save your agent draft to retain this candidate selection");
    await page.getByRole("button", { name: "Save & exit", exact: true }).click();
    await expect.poll(() => draft.content?.runtimeCandidateId).toBe(id(3));
    await page.goto(`/${company.issuePrefix}/agents/custom/${draft.id}/runtime`);
    await advanced.click();
    await page.getByRole("combobox", { name: "Company with the approved isolation test agent", exact: true }).selectOption(company.id);
    await expect(page.getByRole("main")).toContainText("Maximum liability for four probes: USD 0.12");
    await page.getByLabel("I authorize four bounded model probes and their reviewed possible charges.", { exact: true }).check();
    await page.getByLabel("I understand that the synthetic probes and receipts are visible in the company.", { exact: true }).check();
    await page.getByRole("button", { name: "Run four qualification probes", exact: true }).click();
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(page.getByRole("main")).not.toContainText("PRIVATE");
    await page.getByRole("button", { name: "Check original qualification receipt", exact: true }).click();
    await expect(page.getByRole("main")).toContainText("Complete representative tests and review publication");
    expect(creations).toBe(1); expect(qualifications).toBe(1); expect(receipts).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.locator("html")).toHaveAttribute("lang", "da");
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(qualifications).toBe(1);
    expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
