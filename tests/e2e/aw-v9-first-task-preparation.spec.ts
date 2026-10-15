import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { activationViewSchema, initialActivationState } from "../../packages/shared/src/activation.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Actual built customer page and Native disposable company with explicit
// software activation answers. PostgreSQL preparation/authority tests separately
// verify the original writers. This is not live provider or funding evidence.
test("prepares the reviewed first task only explicitly and recovers a lost acknowledgement without starting work", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable first-preparation browser fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const id = "10000000-0000-4000-8000-000000000001";
    const option = { installationId: id, installationVersion: 2, installationHash: "a".repeat(64),
      agentName: "Original approved research agent", useCaseVersion: 3, purposeVersion: 1,
      intendedPurpose: "Prepare an internal source-bound research draft for human review", maximumModelCostMinor: 0 };
    const { receipts: _, ...initial } = initialActivationState();
    let value = activationViewSchema.parse({ runId: id, companyId: company.id, companyName: company.name, version: 3, status: "in_progress",
      state: { ...initial, step: "review", intent: "Prepare one internal research draft", packageVersionId: id },
      capabilities: [{ versionId: id, name: "Research draft", purpose: option.intendedPurpose, requiredConnections: [], knownLimitations: [] }],
      sources: [], blockers: [], firstValue: { status: "not_recorded", result: null, candidates: [], hasMore: false },
      firstTask: { candidates: [], hasMore: false, current: null, preparationOptions: [option] } });
    const commands: Array<Record<string, unknown>> = [];
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { activationV9: true, onboarding: true } }));
    await page.route(`**/api/companies/${company.id}/activation?**`, async route => {
      expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() === "GET") return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: value });
      const input = route.request().postDataJSON();commands.push(input);
      expect(commands).toHaveLength(1);
      expect(Object.keys(input).sort()).toEqual(["confirmCurrentPurpose", "expectedInstallationHash", "expectedInstallationVersion", "expectedPurposeVersion", "expectedUseCaseVersion", "expectedVersion", "installationId", "operation", "requestId"]);
      expect(input).toMatchObject({ operation: "prepare_first_task", expectedVersion: 3, installationId: id,
        expectedInstallationVersion: 2, expectedInstallationHash: option.installationHash,
        expectedUseCaseVersion: 3, expectedPurposeVersion: 1, confirmCurrentPurpose: true });
      const reference = { installationId: id, installationHash: option.installationHash, planId: id, issueId: id };
      value = activationViewSchema.parse({ ...value, version: 4, state: { ...value.state, preparedFirstTask: reference },
        firstTask: { candidates: [{ ...reference, planVersion: 1, title: value.state.intent, maximumModelCostMinor: 0, currency: "USD" }],
          preparationOptions: [], hasMore: false, current: null } });
      return route.abort("failed");
    });
    await page.goto(`/${company.issuePrefix}/dashboard`);await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/saas/activation/9");
    const prepare = page.getByRole("button", { name: "Prepare first task", exact: true });
    await expect(prepare).toBeEnabled();
    await expect(page.getByRole("heading", { level: 2, name: option.agentName, exact: true })).toBeVisible();
    await expect(page.getByText(option.intendedPurpose, { exact: true }).last()).toBeVisible();
    expect(commands).toHaveLength(0);
    await prepare.click();await expect(page.getByRole("main").getByRole("alert")).toBeVisible();expect(commands).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole("button", { name: "Run first task", exact: true })).toBeEnabled();
    await expect(prepare).toHaveCount(0);expect(commands).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const base = `/api/companies/${company.id}`;
    expect(await json(await request.get(`${base}/issues`))).toEqual([]);
    const runs = await json(await request.get(`${base}/heartbeat-runs`));expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
    expect(commands).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("v9-first-task-prepared-mobile.png"), fullPage: true });
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
