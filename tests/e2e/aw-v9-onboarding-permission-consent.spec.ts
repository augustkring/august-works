import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { activationViewSchema, initialActivationState } from "../../packages/shared/src/activation.ts";
import { activationConnectionReviewSchema, activationConnectionConsentReceiptSchema } from "../../packages/shared/src/activation-connection-consent.ts";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), await response.text()).toBe(true); return response.json(); }

// Built UI with explicit software purpose/receipt responses. Actual Native
// ownership is qualified separately; these replies are never provider proof.
test("eight distinct permission fields, keyboard C3, unknown receipt recovery and separate withdrawal", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable onboarding consent fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const id = "10000000-0000-4000-8000-000000000001", { receipts: _, ...initial } = initialActivationState();
    const value = activationViewSchema.parse({ runId: id, companyId: company.id, companyName: company.name, version: 3, status: "in_progress",
      state: { ...initial, step: "access", intent: "Prepare one internal draft", packageVersionId: id },
      capabilities: [{ versionId: id, name: "Draft agent", purpose: "Prepare an internal draft", requiredConnections: ["gmail"], knownLimitations: [] }],
      requiredAccess: [{ key: "gmail", status: "needs_review", checkedAt: null }], sources: [], blockers: ["required_access_pending"],
      firstValue: { status: "not_recorded", result: null, candidates: [], hasMore: false },
      firstTask: { candidates: [], hasMore: false, current: null, preparationOptions: [] },
      firstAgent: { status: "not_created", agentId: null, name: null, canPrepare: false } });
    const review = activationConnectionReviewSchema.parse({ companyId: company.id, onboardingRunId: id, onboardingVersion: 3,
      packageVersionId: id, packageContentHash: "a".repeat(64), applicationId: id, applicationKey: "gmail", applicationName: "Original Gmail",
      galleryKey: "gmail", connectionMethodKey: "paperclip-read", methodHash: "b".repeat(64), providerScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      explanation: { providerName: "Gmail", resource: "https://gmailmcp.googleapis.com/mcp/v1", capabilityName: "Draft agent", providerWriteTools: [] },
      existingConnection: null, scopeProfile: "gmail.read", grantKind: "user", deferAgentAccess: true, reviewHash: "c".repeat(64),
      preview: { neededNow: ["Personal Google sign-in", "https://www.googleapis.com/auth/gmail.readonly"], why: "Prepare the original draft",
        usedBy: "Draft agent; no Agent receives access now", canRead: ["The authorized personal account"], canChange: ["No business changes authorized"],
        notRequested: ["No sending, deletion or spending"], automatic: ["No Agent execution"], asksFirst: ["Agent access needs its own review and Safe Test"] } });
    let saved: ReturnType<typeof activationConnectionConsentReceiptSchema.parse> | null = null;
    const approvals: Record<string, unknown>[] = [], withdrawals: Record<string, unknown>[] = [];
    let receiptReads = 0;
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { activationV9: true, onboarding: true } }));
    await page.route(`**/api/companies/${company.id}/activation?**`, route => route.fulfill({ json: value }));
    await page.route(`**/api/companies/${company.id}/activation/connections/gmail/review?**`, route => route.fulfill({ json: review }));
    await page.route(`**/api/companies/${company.id}/activation/connections/gmail/consent?**`, async route => {
      expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() === "GET") return route.fulfill({ json: saved?.status === "withdrawn" ? null : saved });
      const input = route.request().postDataJSON(); approvals.push(input);
      expect(Object.keys(input).sort()).toEqual(["confirmConnectionAuthorization", "expectedReviewHash", "requestKey"]);
      expect(input).toMatchObject({ confirmConnectionAuthorization: true, expectedReviewHash: review.reviewHash });
      saved = activationConnectionConsentReceiptSchema.parse({ id, companyId: company.id, onboardingRunId: id, onboardingVersion: 3,
        packageVersionId: id, applicationId: id, requestKey: input.requestKey, reviewHash: review.reviewHash,
        status: "approved", connectionId: null, connectedAt: null, requestedAt: new Date().toISOString() });
      return route.abort("failed");
    });
    await page.route(`**/api/companies/${company.id}/activation/connection-consents/**`, route => {
      if (route.request().method() === "GET") { receiptReads++; return route.fulfill({ json: saved }); }
      expect(route.request().url()).toContain("/withdraw?");
      const input = route.request().postDataJSON(); withdrawals.push(input);
      expect(input).toEqual({ confirmWithdrawal: true, expectedReviewHash: review.reviewHash });
      saved = activationConnectionConsentReceiptSchema.parse({ ...saved, status: "withdrawn" });
      return route.fulfill({ json: saved });
    });
    await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/saas/activation/8");
    const section = page.getByRole("region", { name: "Connection permissions: Original Gmail (gmail)", exact: true });
    await expect(section.locator("dt")).toHaveCount(8);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    const decide = page.getByRole("button", { name: "Review connection approval", exact: true });
    await decide.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm decision", exact: true })).toBeDisabled();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeFocused(); await page.keyboard.press("Enter"); await expect(decide).toBeFocused();
    expect(approvals).toHaveLength(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath });
    const accessibility = await page.evaluate(async () => (window as unknown as { axe: { run: (selector: string) => Promise<{ violations: unknown[] }> } }).axe.run("main"));
    expect(accessibility.violations).toEqual([]);
    await decide.click(); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check original receipt", exact: true })).toBeVisible();
    expect(approvals).toHaveLength(1); await page.getByRole("button", { name: "Check original receipt", exact: true }).click();
    await expect(page.getByRole("button", { name: "Continue to provider sign-in", exact: true })).toBeVisible();
    expect(receiptReads).toBe(1); expect(approvals).toHaveLength(1);
    await page.reload(); await expect(page.getByRole("button", { name: "Continue to provider sign-in", exact: true })).toBeVisible();
    expect(approvals).toHaveLength(1);
    await page.getByRole("button", { name: "Withdraw purpose approval", exact: true }).click();
    expect(withdrawals).toHaveLength(0); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
    await expect(decide).toBeVisible(); expect(withdrawals).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("onboarding-consent-narrow.png"), fullPage: true });
  } finally { expect((await request.delete(`/api/companies/${company.id}`)).ok()).toBe(true); }
});

test("explicit C3 reuses the exact personal connection and refreshes access without provider setup", async ({ page, request }) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable connection reuse fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const id = "10000000-0000-4000-8000-000000000001", connectionId = "20000000-0000-4000-8000-000000000001";
    const { receipts: _, ...initial } = initialActivationState();
    const value = activationViewSchema.parse({ runId: id, companyId: company.id, companyName: company.name, version: 3, status: "in_progress",
      state: { ...initial, step: "access", intent: "Prepare one internal draft", packageVersionId: id },
      capabilities: [{ versionId: id, name: "Draft agent", purpose: "Prepare an internal draft", requiredConnections: ["gmail"], knownLimitations: [] }],
      requiredAccess: [{ key: "gmail", status: "needs_review", checkedAt: null }], sources: [], blockers: ["required_access_pending"],
      firstValue: { status: "not_recorded", result: null, candidates: [], hasMore: false },
      firstTask: { candidates: [], hasMore: false, current: null, preparationOptions: [] },
      firstAgent: { status: "not_created", agentId: null, name: null, canPrepare: false } });
    const review = activationConnectionReviewSchema.parse({ companyId: company.id, onboardingRunId: id, onboardingVersion: 3,
      packageVersionId: id, packageContentHash: "a".repeat(64), applicationId: id, applicationKey: "gmail", applicationName: "Original Gmail",
      galleryKey: "gmail", connectionMethodKey: "paperclip-read", methodHash: "b".repeat(64), providerScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      explanation: { providerName: "Gmail", resource: "https://gmailmcp.googleapis.com/mcp/v1", capabilityName: "Draft agent", providerWriteTools: [] },
      existingConnection: { id: connectionId, name: "Saved personal Gmail", setupHash: "d".repeat(64) },
      scopeProfile: "gmail.read", grantKind: "user", deferAgentAccess: true, reviewHash: "c".repeat(64),
      preview: { neededNow: ["Reuse Saved personal Gmail", "https://www.googleapis.com/auth/gmail.readonly"], why: "Prepare the original draft",
        usedBy: "Draft agent; no Agent receives access now", canRead: ["The authorized personal account"], canChange: ["No business changes authorized"],
        notRequested: ["No sending, deletion or spending"], automatic: ["No Agent execution"], asksFirst: ["Agent access needs its own review and Safe Test"] } });
    let saved: ReturnType<typeof activationConnectionConsentReceiptSchema.parse> | null = null;
    const approvals: Record<string, unknown>[] = [], providerSetup: string[] = [];
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { activationV9: true, onboarding: true } }));
    await page.route(`**/api/companies/${company.id}/activation?**`, route => route.fulfill({ json: saved ? { ...value,
      requiredAccess: [{ key: "gmail", status: "recorded", checkedAt: saved.connectedAt }], blockers: [] } : value }));
    await page.route(`**/api/companies/${company.id}/activation/connections/gmail/review?**`, route => route.fulfill({ json: review }));
    await page.route(`**/api/companies/${company.id}/activation/connections/gmail/consent?**`, route => {
      if (route.request().method() === "GET") return route.fulfill({ json: saved });
      const input = route.request().postDataJSON(); approvals.push(input);
      expect(input).toEqual({ requestKey: expect.any(String), confirmConnectionAuthorization: true, expectedReviewHash: review.reviewHash });
      saved = activationConnectionConsentReceiptSchema.parse({ id, companyId: company.id, onboardingRunId: id, onboardingVersion: 3,
        packageVersionId: id, applicationId: id, requestKey: input.requestKey, reviewHash: review.reviewHash,
        status: "connected", connectionId, connectedAt: new Date().toISOString(), requestedAt: new Date().toISOString() });
      return route.fulfill({ json: saved });
    });
    page.on("request", req => { if (req.method() === "POST" && /\/connect$|\/oauth\/start/.test(new URL(req.url()).pathname)) providerSetup.push(req.url()); });
    await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/saas/activation/8");
    const section = page.getByRole("region", { name: "Connection permissions: Original Gmail (gmail)", exact: true });
    await expect(section.locator("dt")).toHaveCount(8);
    await expect(section).toContainText("does not create another connection or repeat provider sign-in");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    expect(approvals).toHaveLength(0); expect(providerSetup).toEqual([]);
    await page.getByRole("button", { name: "Review connection approval", exact: true }).click();
    await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    expect(approvals).toHaveLength(1); expect(providerSetup).toEqual([]);
    await page.reload(); await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    expect(approvals).toHaveLength(1); expect(providerSetup).toEqual([]);
  } finally { expect((await request.delete(`/api/companies/${company.id}`)).ok()).toBe(true); }
});
