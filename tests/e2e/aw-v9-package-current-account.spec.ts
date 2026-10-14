import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS } from "../../packages/shared/src/v5-feature-flags.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Explicit catalog/preview fixtures exercise the shipped page and real session
// fence. Original package persistence/policy/HTTP checks run separately. No
// provider, hosted authentication, package qualification or Human claim.
test("package setup withdraws during session checks and requires a fresh readiness receipt", async ({ page, request }) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable package account fixture" } }));
  const session = await json(await request.get("/api/auth/get-session"));
  const packageId = randomUUID(), agentId = randomUUID(), versionId = randomUUID(), resourceId = randomUUID(), roleVersionId = randomUUID();
  const patch = { ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true,
    enableContextEngineV1: true, enableCollectiveMemoryV1: true, saas_deployment_profile_v6: true,
    billing_v6: true, agent_packages_v7: true, experience_projection_v9: true, progressive_shell_v9: true };
  let hold = false, release: (() => void) | undefined, failOptions = false, writes = 0;
  await page.route("**/api/auth/get-session", async route => {
    if (hold) await new Promise<void>(done => { release = done; });
    await route.fulfill({ json: session });
  });
  await page.route("**/api/agent-packages?*", route => route.fulfill({ json: [{ id: packageId, key: "internal-review",
    name: "PRIVATE package", description: "PRIVATE description", versionId, version: "1.0.0",
    manifest: { audience: "internal_test", purpose: "PRIVATE purpose", prohibitedUses: ["External writes"], requiredConnections: [], optionalConnections: [] },
    components: [{ key: "role", type: "role_pack", required: true, contentHash: "a".repeat(64) }] }] }));
  await page.route(`**/api/companies/${company.id}/agent-package-options?*`, route => route.fulfill(failOptions
    ? { status: 503, json: { error: "PRIVATE-PROVIDER-ERROR customer configuration" } }
    : { json: { agents: [{ id: agentId, name: "PRIVATE worker" }], components: [{ type: "role_pack", resourceId,
      versionId: roleVersionId, contentHash: "a".repeat(64), name: "PRIVATE role" }] } }));
  for (const suffix of ["agent-package-installations", "agent-package-update-proposals"])
    await page.route(`**/api/companies/${company.id}/${suffix}?*`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/companies/${company.id}/agent-packages/internal-review/preview?*`, route => route.fulfill({
    json: { readiness: { status: "ready_with_warnings", reasons: [], warnings: ["PRIVATE readiness receipt"], assessmentIds: [] } } }));
  page.on("request", req => {
    if (req.method() !== "GET" && /\/agent-package/.test(req.url()) && !/\/preview\?/.test(req.url())) writes++;
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: patch }));
    await page.goto(`/${company.issuePrefix}/agents/packages`);
    const main = page.getByRole("main"); await expect(main).toHaveCount(1);
    const heading = main.getByRole("heading", { name: "Specialist packages", exact: true });
    await expect(heading).toBeFocused(); await main.getByRole("button", { name: "Review package", exact: true }).click();
    await main.getByRole("combobox", { name: "Agent", exact: true }).selectOption(agentId);
    const configuration = main.getByRole("region", { name: "Package configuration" });
    await configuration.getByRole("combobox", { name: "role (required)", exact: true }).selectOption(roleVersionId);
    await configuration.getByRole("checkbox").first().check();
    await main.getByRole("button", { name: "Check readiness", exact: true }).click();
    await expect(main.getByText("PRIVATE readiness receipt", { exact: true })).toBeVisible();
    await main.getByRole("combobox", { name: "Agent", exact: true }).focus();
    hold = true; await page.clock.setFixedTime(new Date(Date.now() + 31_000));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => release !== undefined).toBe(true);
    await expect(main).not.toContainText("PRIVATE"); await expect(main.getByRole("combobox")).toHaveCount(0);
    hold = false; release!();
    await expect(main.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue(agentId);
    await expect(main.getByRole("combobox", { name: "Agent", exact: true })).toBeFocused();
    await expect(main).not.toContainText("PRIVATE readiness receipt");
    await expect(main.getByRole("button", { name: "Install for configuration", exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    const back = await main.getByRole("button", { name: "Cancel", exact: true }).boundingBox();
    const primary = await main.getByRole("button", { name: "Install for configuration", exact: true }).boundingBox();
    expect(Math.abs(back!.y + back!.height / 2 - primary!.y - primary!.height / 2)).toBeLessThan(1);
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("package-current-account-mobile.png"), fullPage: true });
    failOptions = true; await page.reload();
    await expect(main.getByRole("alert")).toContainText("This request could not be confirmed");
    await expect(main).not.toContainText("PRIVATE"); expect(writes).toBe(0);
  } finally {
    hold = false; release?.();
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(patch).map(key => [key, flags[key]])) })
      .catch(error => { if (!page.isClosed()) throw error; });
  }
});
