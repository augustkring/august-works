import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentAuthoringDraftViewSchema, agentDraftSaveSchema, agentDraftTestCommandSchema, agentDraftTestViewSchema, orchestrationCompletionSchema } from "../../packages/shared/src/index.ts";
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
      let draft = agentAuthoringDraftViewSchema.parse({ id, companyId: company.id, agentId: null, createdByUserId: session.user.id, kind, version: 1, status: "draft",
        step: kind === "custom" ? "test" : "hire_test", baselineHash: null,
        ...(kind === "hire" ? { package: { key: "research", versionId: packageId, version: "1.0.0", contentHash: "a".repeat(64) } } : {}),
        preparation: { agentId, name: "Saved specialist", approvalId: null, status: "prepared", runtimeQualified: false, authorityGranted: false, executionStarted: false },
        content: agentAuthoringContentSchema.parse({ name: "Saved specialist", outcome: scenario, ownerUserId: session.user.id, runtimeBindingId: runtimeId, scenarios: [scenario],
          description: "A bounded company draft specialist", internalDescription: "Saved internal review context",
          instructions: { purpose: "Produce a bounded welcome draft", responsibilities: "Draft one internal response", prohibited: "Never send externally",
            missingInformation: "Ask for missing material facts", escalation: "Ask the accountable owner", communication: "<img src=x onerror=alert(1)>" },
          capabilities: [{ operation: "create_internal_draft", autonomy: "ask_first" }],
        }),
        createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" });
      let starts = 0, reviews = 0, saves = 0, outcome: ReturnType<typeof agentDraftTestViewSchema.parse> | null = null;
      await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
      await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
      await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
      await page.route(`**/api/companies/${company.id}/agent-configuration-drafts/**`, async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        expect(new URL(req.url()).searchParams.get("expectedUserId")).toBe(session.user.id);
        if (path.endsWith("/save") && req.method() === "POST") {
          const input = agentDraftSaveSchema.parse(req.postDataJSON());
          expect(input.expectedVersion).toBe(draft.version); expect(input.content).toEqual(draft.content); saves++;
          draft = { ...draft, step: input.step, version: draft.version + 1 }; return route.fulfill({ json: draft });
        }
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
          reviews++; expect(req.postDataJSON()).toMatchObject({ expectedResultHash: "e".repeat(64), expectedPlanVersion: 1, workerId: null, objectiveSatisfied: true, explicitHighImpactApproval: true, result: "pass" });
          outcome = { ...outcome!, verification: "pass", testQualified: true }; return route.fulfill({ json: outcome });
        }
        expect(req.method()).toBe("GET");
        if (path.endsWith("/options")) return route.fulfill({ json: { owners: [{ id: session.user.id, name: "Accountable owner" }], knowledge: [], runtimes: [{ id: runtimeId }] } });
        if (path.endsWith("/hire-capability")) return route.fulfill({ json: { key: "research", versionId: packageId, version: "1.0.0", name: "Research draft", category: "Research",
          outcome: scenario, requiredKnowledge: [], requiredConnections: [], limits: [], actionClasses: ["internal_draft"], available: true } });
        if (path.endsWith("/runtime")) return route.fulfill({ json: { draftId: id, companyId: company.id, version: draft.version, agentId, runtimeBindingId: runtimeId,
          configurationHash: "a".repeat(64), status: "qualified", runtimeQualified: true, safeTestQualified: false, executionStarted: false } });
        if (path.endsWith("/test-review")) return route.fulfill({ json: { companyId: company.id, draftId: id, version: draft.version, agentId, scenarioIndex: 0, scenario,
          runtimeBindingId: runtimeId, configurationHash: "a".repeat(64), candidateHash: "c".repeat(64), maximumCostMinor: 3, currency: "USD", provider: "anthropic", model: "software-host-model",
          procedureSnapshotHash: "f".repeat(64), requiredProcedures: [{ skillId: "10000000-0000-4000-8000-000000000021", versionId: "10000000-0000-4000-8000-000000000022", name: "Required security procedure", bodyHash: "f".repeat(64) }],
          transport: "server-text-only-v1", toolsGranted: false, activatesAgent: false, companyVisibleResult: true, reviewHash: "b".repeat(64) } });
        if (path.endsWith("/tests")) return route.fulfill({ json: outcome ? [outcome] : [] });
        if (path.endsWith("/verification-packet")) return route.fulfill({ json: { planId, planVersion: 1, workerId: null, issueId: "10000000-0000-4000-8000-000000000008",
          contractId: "10000000-0000-4000-8000-000000000009", contractHash: "d".repeat(64), resultHash: "e".repeat(64),
          contract: orchestrationCompletionSchema.parse({ objective: scenario, requiredOutputs: [{ key: "representative-draft" }], businessInvariants: ["Welcome is concise"],
            evidenceRequirements: ["Compare the saved scenario"], prohibitedOutcomes: ["External send"] }),
          evidence: [{ ref: "document:original:revision", type: "task_document", sourceId: "10000000-0000-4000-8000-000000000010", sourceVersion: "10000000-0000-4000-8000-000000000011", hash: "f".repeat(64) }],
          deterministicFailures: [], liveAttempts: 0, riskClass: "C0", policy: { independentRequired: true, humanRequired: true, workerSelfCertification: false } } });
        if (outcome && path.endsWith(`/tests/${outcome.requestId}`)) return route.fulfill({ json: outcome });
        if (path.endsWith("/publication-review")) return route.fulfill({ json: { companyId: company.id, draftId: id, version: draft.version, agentId,
          previousVersion: null, nextVersion: 1, before: null, after: draft.content, activate: true, canPublish: false,
          blockers: [{ code: "capability_mapping_required", message: "Publication remains a separate action in this Safe Test host fixture" }],
          requiredProcedures: [], maximumPerModelCallMinor: null, currency: "USD", provider: null, model: null, runtimeBindingId: runtimeId,
          reviewHash: "f".repeat(64), modelCalled: false, authorityGranted: false, executionStarted: false } });
        if (path.endsWith("/review")) return route.fulfill({ json: { draftId: id, version: draft.version, baselineCurrent: true, productionChanged: false, publishAllowed: false,
          blockers: [{ code: "native_promotion_unqualified", message: "Promotion is separate", step: "review" }],
          test: outcome?.testQualified ? { status: "qualified", message: "Current verified scenario", scenariosVerified: 1 } : { status: "unqualified", message: "No qualified test" } } });
        expect(path.endsWith(`/${id}`)).toBe(true); return route.fulfill({ json: draft, headers: { "Cache-Control": "private, no-store" } });
      });
      await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
      await page.goto(`/${company.issuePrefix}/agents/${kind === "custom" ? `custom/${id}/test` : `hire/drafts/${id}/hire_test`}`);
      const region = page.getByRole("region", { name: locale === "en" ? "Representative Safe Test" : "Repræsentativ Safe Test", exact: true });
      await region.getByRole("button", { name: locale === "en" ? "Review Safe Test" : "Gennemgå Safe Test", exact: true }).click();
      const dialog = page.getByRole("alertdialog"), run = dialog.getByRole("button", { name: locale === "en" ? "Run this test" : "Kør denne test", exact: true });
      await expect(run).toBeDisabled(); await expect(dialog).toContainText("0.03 USD"); await expect(dialog).toContainText("Anthropic · software-host-model"); expect(starts).toBe(0);
      await expect(dialog.getByText("Required security procedure", { exact: true })).toBeVisible();
      await expect(dialog.getByText(locale === "en" ? "Required procedures used in this test" : "Obligatoriske procedurer i denne test", { exact: true })).toBeVisible();
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
      await page.getByRole("button", { name: locale === "en" ? "Continue" : "Fortsæt", exact: true }).click();
      await expect(page.getByRole("main")).toContainText(locale === "en" ? "Every saved representative scenario passed" : "Alle gemte repræsentative scenarier har bestået");
      const savedReview = page.getByRole("region", { name: locale === "en" ? "Saved candidate, version 2" : "Gemt kandidat, version 2", exact: true });
      await expect(savedReview).toContainText("Accountable owner");
      await expect(savedReview).toContainText("Saved specialist");
      await expect(savedReview).toContainText(scenario);
      for (const value of [draft.content!.description, draft.content!.internalDescription, ...Object.values(draft.content!.instructions)]) {
        await expect(savedReview).toContainText(value);
      }
      await expect(savedReview.locator("img")).toHaveCount(0);
      await expect(savedReview).toContainText(locale === "en" ? "Not allowed" : "Ikke tilladt");
      await expect(savedReview.getByRole("list").last().getByRole("listitem")).toHaveCount(1);
      await page.addScriptTag({ path: axePath });
      expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('main')).violations)).toEqual([]);
      expect(saves).toBe(1); expect(draft.version).toBe(2); expect(starts).toBe(1); expect(reviews).toBe(1);
      if (kind === "custom") {
        await page.getByRole("navigation", { name: "Agent authoring sections", exact: true }).getByRole("button", { name: "Test", exact: true }).click();
        await page.getByRole("button", { name: "Add representative scenario", exact: true }).click();
        const first = page.getByLabel("Representative scenario", { exact: true });
        const second = page.getByLabel("Representative scenario 2", { exact: true });
        await expect(first).toHaveValue(scenario);
        await second.fill("Produce a second bounded internal draft.");
        await first.fill("Revise the first bounded internal draft.");
        await expect(second).toHaveValue("Produce a second bounded internal draft.");
        await page.getByRole("button", { name: "Remove scenario 1", exact: true }).click();
        await expect(first).toHaveValue("Produce a second bounded internal draft.");
        for (let index = 1; index < 10; index++) await page.getByRole("button", { name: "Add representative scenario", exact: true }).click();
        await expect(page.getByRole("button", { name: "Add representative scenario", exact: true })).toBeDisabled();
        await expect(page.getByLabel("Representative scenario 10", { exact: true })).toBeVisible();
        expect(saves).toBe(2); expect(starts).toBe(1); expect(reviews).toBe(1);
      }
      expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
      expect(await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`))).toEqual([]);
    } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
  });
}
