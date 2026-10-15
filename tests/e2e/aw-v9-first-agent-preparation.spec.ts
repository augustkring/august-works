import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { activationViewSchema, initialActivationState } from "../../packages/shared/src/activation.ts";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Built customer UI with explicit software account/capability/activation answers.
// Original PostgreSQL creation, approval and rollback are qualified separately.
// This is not hosted identity, representative provider, funding or activation proof.
test("explicit paused agent preparation survives a lost answer without replacement or work", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable paused agent browser fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const id = "10000000-0000-4000-8000-000000000001";
    const { receipts: _, ...initial } = initialActivationState();
    let value = activationViewSchema.parse({ runId: id, companyId: company.id, companyName: company.name, version: 3, status: "in_progress",
      state: { ...initial, step: "review", intent: "Prepare one internal research draft", packageVersionId: id },
      capabilities: [{ versionId: id, name: "Research draft", purpose: "Prepare one internal draft for human review", requiredConnections: [], knownLimitations: [] }],
      sources: [], blockers: ["safe_execution_unqualified"], firstValue: { status: "not_recorded", result: null, candidates: [], hasMore: false },
      firstTask: { candidates: [], hasMore: false, current: null, preparationOptions: [] },
      firstAgent: { status: "not_created", agentId: null, name: null, canPrepare: true } });
    const commands: Array<Record<string, unknown>> = [];
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { activationV9: true, onboarding: true } }));
    await page.route(`**/api/companies/${company.id}/activation?**`, async route => {
      expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() === "GET") return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: value });
      const input = route.request().postDataJSON(); commands.push(input);
      expect(commands).toHaveLength(1);
      expect(Object.keys(input).sort()).toEqual(["confirmPausedPreparation", "expectedVersion", "operation", "requestId"]);
      expect(input).toMatchObject({ operation: "prepare_first_agent", expectedVersion: 3, confirmPausedPreparation: true });
      expect(input.requestId).toMatch(/^[a-f0-9-]{36}$/);
      value = activationViewSchema.parse({ ...value, version: 4,
        firstAgent: { status: "prepared", agentId: id, name: "Original prepared research agent", canPrepare: false } });
      return route.abort("failed");
    });
    await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/saas/activation/9");
    await expect(page.getByRole("heading", { level: 1, name: "Review before your first run", exact: true })).toBeVisible();
    const section = page.getByRole("region", { name: "Prepare your first agent", exact: true });
    const prepare = page.getByRole("button", { name: "Prepare first agent", exact: true });
    await expect(prepare).toBeEnabled(); await expect(section.getByText("This creates a paused agent.", { exact: false })).toBeVisible();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByRole("button", { name: "Forbered første agent", exact: true })).toBeEnabled(); expect(commands).toHaveLength(0);
    await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
    await prepare.focus(); await prepare.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible(); expect(commands).toHaveLength(1);
    await page.reload();
    await expect(section.getByText("Agent prepared and paused. Access and testing are still needed.", { exact: true })).toBeVisible();
    await expect(prepare).toHaveCount(0);
    const monitor = page.getByRole("link", { name: "Open prepared agent", exact: true });
    await expect(monitor).toHaveAttribute("href", new RegExp(`/agents/${id}/monitor$`));
    await monitor.focus(); await expect(monitor).toBeFocused();
    await expect(page.getByRole("button", { name: "Run first task", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-first-agent-prepared-mobile.png"), fullPage: true });
    value = activationViewSchema.parse({ ...value, firstAgent: { status: "unavailable", agentId: null, name: null, canPrepare: false } });
    await page.reload(); await expect(section.getByRole("alert")).toHaveText("The original prepared agent is unavailable. No replacement has been created.");
    await expect(monitor).toHaveCount(0); await expect(prepare).toHaveCount(0); expect(commands).toHaveLength(1);
    const base = `/api/companies/${company.id}`;
    expect(await json(await request.get(`${base}/agents`))).toEqual([]);
    expect(await json(await request.get(`${base}/issues`))).toEqual([]);
    const runs = await json(await request.get(`${base}/heartbeat-runs`)); expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
