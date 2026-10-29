import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS, agentAuthoringContentSchema, agentAuthoringDraftViewSchema, agentDraftSaveSchema, agentDraftPublicationCommandSchema, agentDraftPublicationReceiptSchema, agentPackageSetupCommandSchema, agentPackageSetupReceiptSchema } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Built customer hosts with explicitly scoped software API responses. Actual
// model reservations, dispatch, documents and verification are proven separately
// by PostgreSQL tests. This suite is not live provider or GA evidence.
for (const [kind, locale] of [["custom", "en"], ["hire", "da"], ["hire", "en"]] as const) {
  test(`${kind} publication in ${locale} requires both confirmations and recovers its Original receipt without resending`, async ({ page, request }) => {
    const company = await json(await request.post("/api/companies", { data: { name: `Disposable ${kind} publication host` } }));
    try {
      const session = await json(await request.get("/api/auth/get-session"));
      const flags = { ...await json(await request.get("/api/instance/settings/experimental")), ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
        enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true,
        hire_agent_v9: true, experience_projection_v9: true, progressive_shell_v9: true };
      const id = "10000000-0000-4000-8000-000000000001", agentId = "10000000-0000-4000-8000-000000000002", runtimeId = "10000000-0000-4000-8000-000000000003";
      const packageId = "10000000-0000-4000-8000-000000000004", planId = "10000000-0000-4000-8000-000000000005";
      const scenario = "Write a concise internal welcome draft";
      let draft = agentAuthoringDraftViewSchema.parse({ id, companyId: company.id, agentId: null, createdByUserId: session.user.id, kind, version: 1, status: "draft",
        step: kind === "custom" ? "publish" : "hire_review", baselineHash: null,
        ...(kind === "hire" ? { package: { key: "research", versionId: packageId, version: "1.0.0", contentHash: "a".repeat(64) } } : {}),
        preparation: { agentId, name: "Saved specialist", approvalId: null, status: "prepared", runtimeQualified: false, authorityGranted: false, executionStarted: false },
        content: agentAuthoringContentSchema.parse({ name: "Saved specialist", outcome: scenario, ownerUserId: session.user.id, runtimeBindingId: runtimeId, scenarios: [scenario],
          memory: "approved_work_preferences", memoryRecordIds: ["10000000-0000-4000-8000-000000000034"],
          description: "A bounded company draft specialist", internalDescription: "Saved internal review context",
          instructions: { purpose: "Produce a bounded welcome draft", responsibilities: "Draft one internal response", prohibited: "Never send externally",
            missingInformation: "Ask for missing material facts", escalation: "Ask the accountable owner", communication: "<img src=x onerror=alert(1)>" },
          capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }],
        }),
        createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" });
      let publishes = 0, receipt: ReturnType<typeof agentDraftPublicationReceiptSchema.parse> | null = null;
      const purposeId = "10000000-0000-4000-8000-000000000016";
      let setups = 0, setupReceipt: ReturnType<typeof agentPackageSetupReceiptSchema.parse> | null = null;
      await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
      await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
      await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
      await page.route(`**/api/companies/${company.id}/agent-configuration-drafts/**`, async route => {
        const req = route.request(), path = new URL(req.url()).pathname;
        expect(new URL(req.url()).searchParams.get("expectedUserId")).toBe(session.user.id);
        if (path.endsWith("/package-setup") && req.method() === "POST") {
          const input = agentPackageSetupCommandSchema.parse(req.postDataJSON()); setups++;
          expect(input).toMatchObject({ expectedVersion: draft.version, expectedReviewHash: "c".repeat(64), purposeId,
            confirmIntendedPurpose: true, confirmPackageActivation: true });
          expect(Object.keys(input)).toHaveLength(6);
          setupReceipt = agentPackageSetupReceiptSchema.parse({ companyId: company.id, draftId: id, requestId: input.requestId,
            agentId, installationId: planId, installationVersion: 3, purposeId, purposeVersion: 1,
            activatedAtConfirmation: true, authorityGranted: false, executionStarted: false });
          draft = agentAuthoringDraftViewSchema.parse({ ...draft, version: draft.version + 1 });
          return route.abort("failed");
        }
        if (path.endsWith("/publish") && req.method() === "POST") {
          const input = agentDraftPublicationCommandSchema.parse(req.postDataJSON()); publishes++;
          expect(input).toMatchObject({ expectedVersion: draft.version, expectedReviewHash: "b".repeat(64), activate: true, confirmPublication: true, confirmActivation: true });
          expect(Object.keys(input)).toHaveLength(6);
          receipt = agentDraftPublicationReceiptSchema.parse({ companyId: company.id, draftId: id, requestId: input.requestId, agentId, revisionId: input.requestId,
            ...(kind === "hire" ? { packageInstallation: { installationId: planId, versionId: packageId, key: "research", version: "1.0.0", contentHash: "a".repeat(64) } } : {}),
            publishedContent: draft.content!, publishedVersion: 2, publishedAt: "2026-10-12T00:00:00.000Z", activatedAtPublication: true,
            modelMigration: { required: false, action: "none", stage: "single_agent" }, authorityGranted: false, executionStarted: false });
          return route.abort("failed");
        }
        expect(req.method()).toBe("GET");
        if (path.endsWith("/package-setup-review")) {
          const selected = new URL(req.url()).searchParams.get("purposeId") === purposeId;
          return route.fulfill({ json: { companyId: company.id, draftId: id, version: draft.version, agentId,
            installationId: planId, installationVersion: setupReceipt ? 3 : 1, packageName: "Research draft", packageVersion: "1.0.0",
            intendedPurpose: "Produce a bounded welcome draft", purposes: [{ id: purposeId, version: 1, purposeVersion: 1, name: "Approved internal research" }],
            selectedPurposeId: selected ? purposeId : null, packageCurrent: !!setupReceipt, canConfirm: selected && !setupReceipt,
            blockers: selected ? [] : ["approved_purpose_required"], reviewHash: "c".repeat(64),
            modelCalled: false, authorityGranted: false, executionStarted: false } });
        }
        if (path.endsWith("/package-setup-receipt")) {
          expect(new URL(req.url()).searchParams.get("requestId")).toBe(setupReceipt?.requestId);
          return route.fulfill({ json: setupReceipt });
        }
        if (path.endsWith("/options")) return route.fulfill({ json: { owners: [{ id: session.user.id, name: "Accountable owner" }], knowledge: [], preferences: [{ id: "10000000-0000-4000-8000-000000000034", title: "Approved concise work", version: "2026-10-12T12:00:00Z", expiresAt: "2026-10-13T12:00:00Z", sensitivity: "internal" }], runtimes: [{ id: runtimeId }] } });
        if (path.endsWith("/hire-capability")) return route.fulfill({ json: { key: "research", versionId: packageId, version: "1.0.0", name: "Research draft", category: "Research",
          outcome: scenario, requiredKnowledge: [], requiredConnections: [], limits: [], actionClasses: ["internal_draft"], available: true } });
        if (path.endsWith("/publication-review")) return route.fulfill({ json: { companyId: company.id, draftId: id, version: draft.version, agentId,
          previousVersion: 1, nextVersion: 2, before: { ...draft.content, outcome: "Old active responsibility" }, after: draft.content,
          activate: true, canPublish: true, blockers: [], selectedMemory: [{ recordId: "10000000-0000-4000-8000-000000000034", version: "2026-10-12T12:00:00Z", title: "Approved concise work",
            bodyHash: "a".repeat(64), sensitivity: "internal", expiresAt: "2026-10-13T12:00:00Z", validFrom: null, validUntil: null }], selectedKnowledge: [{ foundationDocumentId: "10000000-0000-4000-8000-000000000031", documentId: "10000000-0000-4000-8000-000000000032",
            revisionId: "10000000-0000-4000-8000-000000000033", revisionNumber: 7, title: "Approved Aster company facts",
            bodyHash: "a".repeat(64), sensitivity: "internal", validFrom: null, validUntil: null }], requiredProcedures: [{ name: "Required security procedure", skillId: "10000000-0000-4000-8000-000000000012", versionId: "10000000-0000-4000-8000-000000000013" }],
          requiredPlaybooks: [{ playbookId: "10000000-0000-4000-8000-000000000014", revisionId: "10000000-0000-4000-8000-000000000015", name: "Approved welcome procedure", bodyHash: "e".repeat(64) }],
          maximumPerModelCallMinor: 3, currency: "USD", provider: "anthropic", model: "software-host-model",
          modelMigration: { required: false, action: "none", stage: "single_agent" }, runtimeBindingId: runtimeId, reviewHash: "b".repeat(64),
          modelCalled: false, authorityGranted: false, executionStarted: false } });
        if (path.endsWith('/publications')) return route.fulfill({ json: receipt });
        if (receipt && path.endsWith(`/publications/${receipt.requestId}`)) return route.fulfill({ json: receipt });
        if (path.endsWith("/review")) return route.fulfill({ json: { draftId: id, version: draft.version, baselineCurrent: true, productionChanged: false, publishAllowed: true,
          blockers: [], test: { status: "qualified", message: "Current verified scenario", scenariosVerified: 1 } } });
        expect(path.endsWith(`/${id}`)).toBe(true); return route.fulfill({ json: draft, headers: { "Cache-Control": "private, no-store" } });
      });
      await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
      await page.goto(`/${company.issuePrefix}/agents/${kind === "custom" ? `custom/${id}/publish` : `hire/drafts/${id}/hire_review`}`);
      if (kind === "hire") {
        const setup = page.getByRole("region", { name: locale === "en" ? "Approved purpose and package setup" : "Godkendt formål og pakkeopsætning", exact: true });
        const reviewSetup = setup.getByRole("button", { name: locale === "en" ? "Review package setup" : "Gennemgå pakkeopsætning", exact: true });
        await expect(reviewSetup).toBeDisabled();
        await setup.getByRole("combobox").selectOption(purposeId);
        await expect(reviewSetup).toBeEnabled(); await reviewSetup.click();
        const dialog = page.getByRole("alertdialog"), confirmSetup = dialog.getByRole("button", { name: locale === "en" ? "Confirm package setup" : "Bekræft pakkeopsætning", exact: true });
        await expect(dialog).toContainText("Approved internal research"); await expect(confirmSetup).toBeDisabled();
        await page.addScriptTag({ path: axePath });
        expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('[role="alertdialog"]')).violations)).toEqual([]);
        const consents = dialog.getByRole("checkbox"); await expect(consents).toHaveCount(2);
        await consents.nth(0).check(); await expect(confirmSetup).toBeDisabled(); await consents.nth(1).check();
        expect(setups).toBe(0); await confirmSetup.click();
        const checkSetup = setup.getByRole("button", { name: locale === "en" ? "Check original setup" : "Kontrollér oprindelig opsætning", exact: true });
        await expect(checkSetup).toBeVisible(); await page.reload(); await checkSetup.click();
        await expect(setup).toContainText(locale === "en" ? "The current package setup is ready for publication." : "Den aktuelle pakkeopsætning er klar til publicering.");
        await page.reload(); await expect(setup).toContainText(locale === "en" ? "The current package setup is ready for publication." : "Den aktuelle pakkeopsætning er klar til publicering.");
        expect(setups).toBe(1);
      }
      const region = page.getByRole("region", { name: locale === "en" ? "Publish and activate this version" : "Publicér og aktivér denne version", exact: true });
      await region.getByRole("button", { name: locale === "en" ? "Review publication and activation" : "Gennemgå publicering og aktivering", exact: true }).click();
      const dialog = page.getByRole("alertdialog"), submit = dialog.getByRole("button", { name: locale === "en" ? "Publish and activate" : "Publicér og aktivér", exact: true });
      await expect(submit).toBeDisabled(); await expect(dialog).toContainText("0.03 USD"); await expect(dialog).toContainText("Required security procedure");
      await expect(dialog).toContainText("Approved welcome procedure");
      await expect(dialog).toContainText(locale === "en" ? "Approved revision 7" : "Godkendt revision 7");
      await expect(dialog).toContainText("Approved Aster company facts");
      await expect(dialog).toContainText("Approved concise work");
      await expect(dialog).toContainText(locale === "en" ? "Expires" : "Udløber");
      await expect(dialog).toContainText(locale === "en" ? "grants no Memory writes" : "skriveret til Memory");
      await expect(dialog).toContainText("Old active responsibility"); await expect(dialog).toContainText("Accountable owner");
      for (const value of [draft.content!.description, draft.content!.internalDescription, ...Object.values(draft.content!.instructions)]) await expect(dialog).toContainText(value);
      await expect(dialog.locator("img")).toHaveCount(0); expect(publishes).toBe(0);
      await page.addScriptTag({ path: axePath });
      expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('[role="alertdialog"]')).violations)).toEqual([]);
      const checkboxes = dialog.getByRole("checkbox"); await expect(checkboxes).toHaveCount(2);
      await checkboxes.nth(0).check(); await expect(submit).toBeDisabled(); await checkboxes.nth(1).check(); await submit.click();
      const check = region.getByRole("button", { name: locale === "en" ? "Check original publication" : "Tjek oprindelig publicering", exact: true });
      await expect(check).toBeVisible(); await page.reload(); await check.click();
      await expect(region).toContainText(locale === "en" ? "Version 2 was published and activated" : "Version 2 blev publiceret og aktiveret"); expect(publishes).toBe(1);
      await page.reload(); await check.click(); await expect(region).toContainText(locale === "en" ? "Version 2 was published and activated" : "Version 2 blev publiceret og aktiveret"); expect(publishes).toBe(1);
      await page.addScriptTag({ path: axePath });
      expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('main')).violations)).toEqual([]);
      expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
      expect(await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`))).toEqual([]);
    } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
  });
}
