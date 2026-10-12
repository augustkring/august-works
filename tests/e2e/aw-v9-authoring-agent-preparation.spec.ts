import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentAuthoringDraftViewSchema } from "../../packages/shared/src/index.ts";

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Built host coverage with explicitly scoped software responses. Actual Agent
// creation and Native invariants belong to the PostgreSQL integration suites.
for (const kind of ["custom", "hire"] as const) {
  test(`${kind} requires separate inactive preparation and reconciles reload without another command`, async ({ page, request }) => {
    const company = await json(await request.post("/api/companies", { data: { name: `Disposable ${kind} preparation host` } }));
    try {
      const session = await json(await request.get("/api/auth/get-session"));
      const originalFlags = await json(await request.get("/api/instance/settings/experimental"));
      const flags = { ...originalFlags, ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true, enableContextEngineV1: true,
        saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true, experience_projection_v9: true, progressive_shell_v9: true };
      const id = "10000000-0000-4000-8000-000000000001", packageId = "10000000-0000-4000-8000-000000000002";
      let draft = agentAuthoringDraftViewSchema.parse({ id, companyId: company.id, agentId: null, createdByUserId: session.user.id, kind, version: 1, status: "draft",
        step: kind === "custom" ? "runtime" : "hire_test", baselineHash: null,
        ...(kind === "hire" ? { package: { key: "research", versionId: packageId, version: "1.0.0", contentHash: "a".repeat(64) } } : {}),
        content: agentAuthoringContentSchema.parse({ name: "Saved preparation specialist", outcome: "Prepare an internal research draft", ownerUserId: session.user.id }),
        createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" });
      let writes = 0;
      await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
      await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
      await page.route(`**/api/companies/${company.id}/agent-configuration-drafts/**`, async route => {
        expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET") {
          expect(path.endsWith(`/${id}/prepare`)).toBe(true); writes++;
          expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 1, expectedReviewHash: "b".repeat(64), confirmInactiveAgentPreparation: true });
          draft = { ...draft, version: 2, preparation: { agentId: "10000000-0000-4000-8000-000000000003", name: "Saved preparation specialist", approvalId: null,
            status: "prepared", runtimeQualified: false, authorityGranted: false, executionStarted: false } };
          return route.fulfill({ json: draft });
        }
        if (path.endsWith("/options")) return route.fulfill({ json: { owners: [{ id: session.user.id, name: "Accountable owner" }], knowledge: [], runtimes: [] } });
        if (path.endsWith("/tests")) return route.fulfill({ json: [] });
        if (path.endsWith("/test-review")) return route.fulfill({ status: 409, json: { error: "This software fixture has no qualified model test" } });
        if (path.endsWith("/runtime")) return route.fulfill({ json: { draftId: id, companyId: company.id, version: draft.version,
          agentId: draft.preparation!.agentId, runtimeBindingId: null, configurationHash: "a".repeat(64), status: "needs_setup",
          runtimeQualified: false, safeTestQualified: false, executionStarted: false } });
        if (path.endsWith("/hire-capability")) return route.fulfill({ json: { key: "research", versionId: packageId, version: "1.0.0", name: "Research draft", category: "Research",
          outcome: "Prepare an internal research draft", requiredKnowledge: [], requiredConnections: [], limits: [], actionClasses: ["internal_draft"], available: true } });
        if (path.endsWith("/preparation-review")) return route.fulfill({ json: { draftId: id, companyId: company.id, version: 1, name: draft.content!.name,
          ...(kind === "hire" ? { packageInstallation: { versionId: packageId, name: "Research package", version: "1.0.0", contentHash: "a".repeat(64),
            components: [{ key: "research", type: "role_pack", resourceId: "10000000-0000-4000-8000-000000000011",
              versionId: "10000000-0000-4000-8000-000000000012", name: "Reviewed research procedures", revisionNumber: 2, contentHash: "c".repeat(64) }] } } : {}),
          outcome: draft.content!.outcome, accountableOwner: { userId: session.user.id, name: "Accountable owner" }, requiresBoardApproval: false,
          createsInactiveAgent: true, runtimeQualified: false, authorityGranted: false, executionStarted: false, reviewHash: "b".repeat(64) } });
        if (path.endsWith("/review")) return route.fulfill({ json: { draftId: id, version: draft.version, baselineCurrent: true, productionChanged: false, publishAllowed: false,
          blockers: [{ code: "representative_test_unqualified", message: "Representative execution remains unqualified", step: "test" }], test: { status: "unqualified", message: "No qualified test" } } });
        expect(path.endsWith(`/${id}`)).toBe(true);
        return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: draft });
      });
      await page.goto(`/${company.issuePrefix}/dashboard`);
      await expect(page.getByRole("main")).toBeVisible();
      await page.goto(`/${company.issuePrefix}/agents/${kind === "custom" ? `custom/${id}/runtime` : `hire/drafts/${id}/hire_test`}`);
      const preparation = page.getByRole("region", { name: "Prepare a draft agent", exact: true });
      await expect(preparation).toContainText("Accountable owner"); expect(writes).toBe(0);
      await preparation.getByRole("button", { name: "Review inactive agent preparation", exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      if (kind === "hire") {
        await expect(dialog).toContainText("Research package · version 1.0.0");
        await expect(dialog).toContainText("Reviewed research procedures · 2");
        await expect(dialog).toContainText("creates no app access or running work");
        expect(writes).toBe(0);
      }
      await expect(dialog.getByRole("button", { name: "Prepare inactive agent", exact: true })).toBeDisabled();
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Prepare inactive agent", exact: true }).click();
      await expect(preparation).toContainText("The inactive agent exists"); expect(writes).toBe(1);
      await page.reload();
      await expect(preparation).toContainText("The inactive agent exists");
      await expect(preparation).toContainText("does not qualify a runtime or Safe Test");
      expect(writes).toBe(1);
      expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
      expect(await json(await request.get(`/api/companies/${company.id}/issues`))).toEqual([]);
    } finally {
      await json(await request.delete(`/api/companies/${company.id}`));
    }
  });
}
