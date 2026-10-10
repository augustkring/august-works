import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { activationViewSchema, initialActivationState } from "../../packages/shared/src/activation.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Actual built route, layout, Query cache and controls with explicit software
// first-task fixtures. This does not qualify a real provider, no-charge funding,
// native Task preparation, or successful business output.
test("first task recovers through a current read, continues only explicitly and retains Stop after rollout withdrawal", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable first-task browser fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const id = "10000000-0000-4000-8000-000000000001";
    const candidate = { installationId: id, installationHash: "a".repeat(64), planId: id, issueId: id,
      planVersion: 2, title: "Prepared original first task", maximumModelCostMinor: 0, currency: "USD" };
    const { receipts: _, ...initial } = initialActivationState();
    let enabled = true;
    let value = activationViewSchema.parse({ runId: id, companyId: company.id, companyName: company.name, version: 3, status: "in_progress",
      state: { ...initial, step: "review", intent: "Prepare one internal research draft", packageVersionId: id },
      capabilities: [{ versionId: id, name: "Research draft", purpose: "Prepare an internal draft", requiredConnections: [], knownLimitations: [] }],
      sources: [], blockers: [], firstValue: { status: "not_recorded", result: null, candidates: [], hasMore: false },
      firstTask: { candidates: [candidate], hasMore: false, current: null } });
    const commands: Array<Record<string, unknown>> = [];
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { activationV9: enabled, onboarding: true } }));
    await page.route(`**/api/companies/${company.id}/activation?**`, async route => {
      expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() === "GET") return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: value });
      const input = route.request().postDataJSON();commands.push(input);
      expect(input.expectedVersion).toBe(value.version);
      if (input.operation === "start_first_task") {
        expect(commands).toHaveLength(1);
        expect(Object.keys(input).sort()).toEqual(["expectedInstallationHash", "expectedMaximumModelCostMinor", "expectedPlanVersion", "expectedVersion", "installationId", "operation", "planId", "requestId"]);
        expect(input).toMatchObject({ expectedInstallationHash: candidate.installationHash, expectedMaximumModelCostMinor: 0, expectedPlanVersion: 2,
          installationId: id, planId: id });
        const reference = { installationId: id, installationHash: candidate.installationHash, planId: id, issueId: id };
        value = activationViewSchema.parse({ ...value, version: 4, state: { ...value.state, step: "running", firstTask: reference },
          firstTask: { candidates: [], hasMore: false, current: { ...reference, planVersion: 3, status: "running", dispatched: false } } });
        return route.abort("failed");
      }
      if (input.operation === "continue_first_task") {
        expect(commands).toHaveLength(2);
        expect(Object.keys(input).sort()).toEqual(["expectedVersion", "operation", "requestId"]);
        value = activationViewSchema.parse({ ...value, version: 5, firstTask: { ...value.firstTask!, current: { ...value.firstTask!.current!, dispatched: true } } });
        return route.fulfill({ json: value });
      }
      expect(enabled).toBe(false);expect(input.operation).toBe("stop_first_task");expect(commands).toHaveLength(3);
      expect(Object.keys(input).sort()).toEqual(["expectedPlanVersion", "expectedVersion", "operation", "requestId"]);
      expect(input.expectedPlanVersion).toBe(3);
      value = activationViewSchema.parse({ ...value, version: 6, firstTask: { ...value.firstTask!, current: { ...value.firstTask!.current!, planVersion: 4, status: "cancelled" } } });
      return route.fulfill({ json: value });
    });
    await page.goto(`/${company.issuePrefix}/dashboard`);await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/saas/activation/9");
    await page.getByRole("button", { name: "Run first task", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();expect(commands).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Working on it", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run first task", exact: true })).toHaveCount(0);
    const continued = page.getByRole("button", { name: "Continue first task", exact: true });
    await expect(continued).toBeEnabled();expect(commands).toHaveLength(1);
    await continued.click();await expect(continued).toHaveCount(0);expect(commands).toHaveLength(2);
    enabled = false;
    value = activationViewSchema.parse({ ...value, firstTask: { ...value.firstTask!, current: { ...value.firstTask!.current!, status: "withdrawn" } } });
    await page.reload();
    const stop = page.getByRole("button", { name: "Stop", exact: true });await expect(stop).toBeEnabled();
    await stop.click();await expect(page.getByRole("status").filter({ hasText: "Stop is recorded" })).toBeVisible();
    expect(commands).toHaveLength(3);
    await page.setViewportSize({ width: 390, height: 844 });await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const base = `/api/companies/${company.id}`;
    expect(await json(await request.get(`${base}/issues`))).toEqual([]);expect(await json(await request.get(`${base}/agents`))).toEqual([]);
    const runs = await json(await request.get(`${base}/heartbeat-runs`));expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
    await page.screenshot({ path: info.outputPath("v9-first-task-stop-mobile.png"), fullPage: true });
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
