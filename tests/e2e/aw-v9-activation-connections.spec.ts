import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { activationViewSchema, initialActivationState } from "../../packages/shared/src/activation.ts";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Explicit software setup observations through the built customer UI. Native
// company/account/policy checks are covered separately. No provider-health,
// Agent-authority or representative safe-execution qualification is inferred.
test("connection setup review stays distinct from agent access and survives a lost continuation reply", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable connection setup browser fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const id = "10000000-0000-4000-8000-000000000001";
    const { receipts: _, ...initial } = initialActivationState();
    let value = activationViewSchema.parse({ runId: id, companyId: company.id, companyName: company.name, version: 3, status: "in_progress",
      state: { ...initial, step: "access", intent: "Prepare one internal draft", packageVersionId: id },
      capabilities: [{ versionId: id, name: "Draft agent", purpose: "Prepare an internal draft", requiredConnections: ["linear", "notion"], knownLimitations: [] }],
      requiredAccess: [{ key: "linear", status: "recorded", checkedAt: new Date().toISOString() }, { key: "notion", status: "needs_review", checkedAt: null }],
      sources: [], blockers: ["required_access_pending"], firstValue: { status: "not_recorded", result: null, candidates: [], hasMore: false },
      firstTask: { candidates: [], hasMore: false, current: null, preparationOptions: [] },
      firstAgent: { status: "not_created", agentId: null, name: null, canPrepare: false } });
    const commands: Array<Record<string, unknown>> = [];
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { activationV9: true, onboarding: true } }));
    await page.route(`**/api/companies/${company.id}/activation?**`, async route => {
      expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() === "GET") return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: value });
      const input = route.request().postDataJSON(); commands.push(input);
      expect(commands).toHaveLength(1);
      expect(Object.keys(input).sort()).toEqual(["expectedVersion", "operation", "requestId"]);
      expect(input).toMatchObject({ operation: "continue_access", expectedVersion: 3 });
      value = activationViewSchema.parse({ ...value, version: 4, state: { ...value.state, step: "review" }, blockers: ["safe_execution_unqualified"] });
      return route.abort("failed");
    });
    await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/saas/activation/8");
    const next = page.getByRole("button", { name: "Continue", exact: true });
    await expect(next).toBeDisabled();
    await expect(page.getByText("notion: Review connection setup", { exact: true })).toBeVisible();
    const apps = page.getByRole("link", { name: "Review connections in Apps", exact: true });
    await expect(apps).toHaveAttribute("href", new RegExp(`/${company.issuePrefix}/apps$`));
    await apps.focus(); await expect(apps).toBeFocused(); expect(commands).toHaveLength(0);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByText("notion: Gennemgå forbindelsens opsætning", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fortsæt", exact: true })).toBeDisabled();
    await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
    value = activationViewSchema.parse({ ...value, requiredAccess: value.requiredAccess!.map(row => ({ ...row, status: "recorded", checkedAt: new Date().toISOString() })), blockers: [] });
    await page.reload(); await expect(next).toBeEnabled();
    await expect(page.getByText("The required connections are recorded.", { exact: false })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-connection-setup-mobile.png"), fullPage: true });
    await next.focus(); await next.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible(); expect(commands).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Review before your first run", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run first task", exact: true })).toHaveCount(0);
    expect(commands).toHaveLength(1);
    expect(await json(await request.get(`/api/companies/${company.id}/agents`))).toEqual([]);
    expect(await json(await request.get(`/api/companies/${company.id}/issues`))).toEqual([]);
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
