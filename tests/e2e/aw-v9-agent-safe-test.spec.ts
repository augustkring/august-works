import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentAuthoringDraftViewSchema, agentDraftTestCommandSchema, agentDraftTestViewSchema, orchestrationCompletionSchema } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Built customer hosts with explicitly scoped software API responses. Actual
// model reservations, dispatch, documents and verification are proven separately
// by PostgreSQL tests. This suite is not live provider or GA evidence.
for (const [kind, locale] of [["custom", "en"], ["hire", "da"]] as const) {
  test(`${kind} Safe Test in ${locale} confirms disclosure and recovers its original outcome before human review`, async ({ page, request }) => {
    const company = await json(await request.post("/api/companies", { data: { name: `Disposable ${kind} Safe Test host` } }));
    try {
      const session = await json(await request.get("/api/auth/get-session"));
      const flags = { ...await json(await request.get("/api/instance/settings/experimental")), ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
        enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true,
        hire_agent_v9: true, experience_projection_v9: true, progressive_shell_v9: true };
      const id = "10000000-0000-4000-8000-000000000001", agentId = "10000000-0000-4000-8000-000000000002", runtimeId = "10000000-0000-4000-8000-000000000003";
      const packageId = "10000000-0000-4000-8000-000000000004", planId = "10000000-0000-4000-8000-000000000005";
      const scenario = "Write a concise internal welcome draft";
      const draft = agentAuthoringDraftViewSchema.parse({ id, companyId: company.id, agentId: null, createdByUserId: session.user.id, kind, version: 1, status: "draft",
        step: kind === "custom" ? "test" : "hire_test", baselineHash: null,
        ...(kind === "hire" ? { package: { key: "research", versionId: packageId, version: "1.0.0", contentHash: "a".repeat(64) } } : {}),
        preparation: { agentId, name: "Saved specialist", approvalId: null, status: "prepared", runtimeQualified: false, authorityGranted: false, executionStarted: false },
        content: agentAuthoringContentSchema.parse({ name: "Saved specialist", outcome: scenario, ownerUserId: session.user.id, runtimeBindingId: runtimeId, scenarios: [scenario] }),
        createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" });
      let starts = 0, reviews = 0, outcome: ReturnType<typeof agentDraftTestViewSchema.parse> | null = null;
      await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
      await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
      await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
      await page.route(`**/api/companies/${company.id}/agent-configuration-drafts/**`, async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        expect(new URL(req.url()).searchParams.get("expectedUserId")).toBe(session.user.id);
        if (path.endsWith("/tests") && req.method() === "POST") {
          const input = agentDraftTestCommandSchema.parse(req.postDataJSON()); starts++;
          expect(input).toMatchObject({ expectedVersion: 1, scenarioIndex: 0, expectedReviewHash: "b".repeat(64), confirmRepresentativeTest: true, confirmCompanyVisibleResult: true });
          outcome = agentDraftTestViewSchema.parse({ id: "10000000-0000-4000-8000-000000000006", companyId: company.id, draftId: id, version: 1,
            requestId: input.requestId, scenarioIndex: 0, scenario, agentId, runId: "10000000-0000-4000-8000-000000000007", planId,
            candidateCurrent: true, runtimeCurrent: true, resultCurrent: true, execution: "succeeded", verification: "not_reviewed", testQualified: false,
            toolsGranted: false, activatesAgent: false, result: "Software host fixture: an internal welcome draft.", maximumCostMinor: 3, currency: "USD", createdAt: "2026-10-12T00:00:00.000Z" });
          return route.abort("failed");
        }
        if (path.endsWith("/verify") && req.method() === "POST") {
          reviews++; expect(req.postDataJSON()).toMatchObject({ expectedResultHash: "e".repeat(64), expectedPlanVersion: 1, workerId: null, objectiveSatisfied: true, result: "pass" });
          outcome = { ...outcome!, verification: "pass", testQualified: true }; return route.fulfill({ json: outcome });
        }
        expect(req.method()).toBe("GET");
        if (path.endsWith("/options")) return route.fulfill({ json: { owners: [{ id: session.user.id, name: "Accountable owner" }], knowledge: [], runtimes: [{ id: runtimeId }] } });
        if (path.endsWith("/hire-capability")) return route.fulfill({ json: { key: "research", versionId: packageId, version: "1.0.0", name: "Research draft", category: "Research",
          outcome: scenario, requiredKnowledge: [], requiredConnections: [], limits: [], actionClasses: ["internal_draft"], available: true } });
        if (path.endsWith("/runtime")) return route.fulfill({ json: { draftId: id, companyId: company.id, version: 1, agentId, runtimeBindingId: runtimeId,
          configurationHash: "a".repeat(64), status: "qualified", runtimeQualified: true, safeTestQualified: false, executionStarted: false } });
        if (path.endsWith("/test-review")) return route.fulfill({ json: { companyId: company.id, draftId: id, version: 1, agentId, scenarioIndex: 0, scenario,
          runtimeBindingId: runtimeId, configurationHash: "a".repeat(64), candidateHash: "c".repeat(64), maximumCostMinor: 3, currency: "USD", provider: "anthropic", model: "software-host-model",
          transport: "server-text-only-v1", toolsGranted: false, activatesAgent: false, companyVisibleResult: true, reviewHash: "b".repeat(64) } });
        if (path.endsWith("/tests")) return route.fulfill({ json: outcome ? [outcome] : [] });
        if (path.endsWith("/verification-packet")) return route.fulfill({ json: { planId, planVersion: 1, workerId: null, issueId: "10000000-0000-4000-8000-000000000008",
          contractId: "10000000-0000-4000-8000-000000000009", contractHash: "d".repeat(64), resultHash: "e".repeat(64),
          contract: orchestrationCompletionSchema.parse({ objective: scenario, requiredOutputs: [{ key: "representative-draft" }], businessInvariants: ["Welcome is concise"],
            evidenceRequirements: ["Compare the saved scenario"], prohibitedOutcomes: ["External send"] }),
          evidence: [{ ref: "document:original:revision", type: "task_document", sourceId: "10000000-0000-4000-8000-000000000010", sourceVersion: "10000000-0000-4000-8000-000000000011", hash: "f".repeat(64) }],
          deterministicFailures: [], liveAttempts: 0, riskClass: "C0", policy: { independentRequired: true, humanRequired: true, workerSelfCertification: false } } });
        if (outcome && path.endsWith(`/tests/${outcome.requestId}`)) return route.fulfill({ json: outcome });
        if (path.endsWith("/review")) return route.fulfill({ json: { draftId: id, version: 1, baselineCurrent: true, productionChanged: false, publishAllowed: false,
          blockers: [{ code: "native_promotion_unqualified", message: "Promotion is separate", step: "review" }], test: { status: "unqualified", message: "No production proof" } } });
        expect(path.endsWith(`/${id}`)).toBe(true); return route.fulfill({ json: draft, headers: { "Cache-Control": "private, no-store" } });
      });
      await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
      await page.goto(`/${company.issuePrefix}/agents/${kind === "custom" ? `custom/${id}/test` : `hire/drafts/${id}/hire_test`}`);
      const region = page.getByRole("region", { name: locale === "en" ? "Representative Safe Test" : "Repræsentativ Safe Test", exact: true });
      await region.getByRole("button", { name: locale === "en" ? "Review Safe Test" : "Gennemgå Safe Test", exact: true }).click();
      const dialog = page.getByRole("alertdialog"), run = dialog.getByRole("button", { name: locale === "en" ? "Run this test" : "Kør denne test", exact: true });
      await expect(run).toBeDisabled(); await expect(dialog).toContainText("0.03 USD"); await expect(dialog).toContainText("Anthropic · software-host-model"); expect(starts).toBe(0);
      await page.addScriptTag({ path: axePath });
      expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('[role="alertdialog"]')).violations)).toEqual([]);
      await dialog.getByRole("checkbox").check(); await run.click();
      await expect(region.getByRole("button", { name: locale === "en" ? "Check original test" : "Kontroller oprindelig test", exact: true })).toBeVisible();
      await page.reload(); await region.getByRole("button", { name: locale === "en" ? "Check original test" : "Kontroller oprindelig test", exact: true }).click();
      await expect(region).toContainText("Software host fixture: an internal welcome draft."); expect(starts).toBe(1); expect(reviews).toBe(0);
      await region.getByRole("button", { name: locale === "en" ? "Review actual result" : "Vurder det faktiske resultat", exact: true }).click();
      const form = region.getByRole("group", { name: locale === "en" ? "Separate human verification" : "Særskilt menneskelig verifikation", exact: true });
      const submit = form.getByRole("button", { name: locale === "en" ? "Record human review" : "Gem menneskelig vurdering", exact: true });
      await expect(submit).toBeDisabled(); for (const checkbox of await form.getByRole("checkbox").all()) { await expect(checkbox).not.toBeChecked(); await checkbox.check(); }
      await form.getByRole("combobox").selectOption("pass"); await form.getByRole("textbox").fill("I compared the actual output with the scenario and every criterion."); await submit.click();
      await expect(region).toContainText(locale === "en" ? "passed human verification" : "bestået menneskelig verifikation"); expect(starts).toBe(1); expect(reviews).toBe(1);
      expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
      expect(await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`))).toEqual([]);
    } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
  });
}
