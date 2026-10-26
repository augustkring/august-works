import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS } from "../../packages/shared/src/v5-feature-flags.ts";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
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
  const automationChoices = [
    { key: "workflow", type: "workflow_template", resourceId: randomUUID(), versionId: randomUUID(), contentHash: "b".repeat(64), name: "PRIVATE manual workflow" },
    { key: "routine", type: "routine_template", resourceId: randomUUID(), versionId: randomUUID(), contentHash: "c".repeat(64), name: "PRIVATE manual routine" },
  ];
  let reviewedPins: unknown;
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
    components: [{ key: "role", type: "role_pack", required: true, contentHash: "a".repeat(64) },
      ...automationChoices.map(({ key, type, contentHash }) => ({ key, type, contentHash, required: true }))] }] }));
  await page.route(`**/api/companies/${company.id}/agent-package-options?*`, route => route.fulfill(failOptions
    ? { status: 503, json: { error: "PRIVATE-PROVIDER-ERROR customer configuration" } }
    : { json: { agents: [{ id: agentId, name: "PRIVATE worker" }], components: [{ type: "role_pack", resourceId,
      versionId: roleVersionId, contentHash: "a".repeat(64), name: "PRIVATE role" }, ...automationChoices] } }));
  await page.route(`**/api/companies/${company.id}/agent-package-installations?*`, route => route.fulfill({ json: [{
    id: randomUUID(), packageId, installedVersionId: versionId, agentId, version: 3, status: "degraded",
    updatePolicy: "manual", readiness: { reasons: [], warnings: [] }, installedByUserId: "local-board" }] }));
  await page.route(`**/api/companies/${company.id}/agent-package-update-proposals?*`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/companies/${company.id}/agent-packages/internal-review/preview?*`, route => {
    reviewedPins = route.request().postDataJSON().components;
    return route.fulfill({ json: { readiness: { status: "ready_with_warnings", reasons: [], warnings: ["PRIVATE readiness receipt"], assessmentIds: [] } } });
  });
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
    await expect(main.getByRole("button", { name: "Check readiness", exact: true })).toBeDisabled();
    for (const choice of automationChoices)
      await configuration.getByRole("combobox", { name: `${choice.key} (required)`, exact: true }).selectOption(choice.versionId);
    await configuration.getByRole("checkbox").first().check();
    await main.getByRole("button", { name: "Check readiness", exact: true }).click();
    await expect(main.getByText("PRIVATE readiness receipt", { exact: true })).toBeVisible();
    expect(reviewedPins).toEqual(expect.arrayContaining(automationChoices.map(({ key, resourceId, versionId }) => ({ key, resourceId, versionId }))));
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
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByRole("heading", { name: "Specialistpakker", exact: true })).toBeVisible();
    await expect(main.getByRole("region", { name: "Pakkeopsætning" })).toBeVisible();
    await expect(main).toContainText("Status: Kræver opmærksomhed. Opdateringer kræver gennemgang.");
    await expect(main.getByRole("combobox", { name: "Agent", exact: true })).toHaveValue(agentId);
    await expect(main.getByRole("link", { name: "Forbindelser", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const back = await main.getByRole("button", { name: "Annuller", exact: true }).boundingBox();
    const primary = await main.getByRole("button", { name: "Installer til opsætning", exact: true }).boundingBox();
    expect(Math.abs(back!.y + back!.height / 2 - primary!.y - primary!.height / 2)).toBeLessThan(1);
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("package-current-account-mobile.png"), fullPage: true });
    failOptions = true; await page.reload();
    await expect(main.getByRole("alert")).toContainText("Anmodningen kunne ikke bekræftes");
    await expect(main).not.toContainText("PRIVATE"); expect(writes).toBe(0);
  } finally {
    hold = false; release?.();
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(patch).map(key => [key, flags[key]])) })
      .catch(error => { if (!page.isClosed()) throw error; });
  }
});

// Lost-response and recorded-state routes below are explicit transport fixtures.
// Real Native install/request binding and readonly HTTP are tested with PostgreSQL.
test("a lost installation response keeps one locator and reads it after reload and rollout closure", async ({ page, request }) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable original installation fixture" } }));
  const packageId = randomUUID(), agentId = randomUUID(), versionId = randomUUID(), roleId = randomUUID(), roleVersionId = randomUUID(), installationId = randomUUID();
  const patch = { ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])), enableFoundationV1: true,
    enableContextEngineV1: true, enableCollectiveMemoryV1: true, saas_deployment_profile_v6: true,
    billing_v6: true, agent_packages_v7: true, experience_projection_v9: true, progressive_shell_v9: true };
  let original: string | undefined, posts = 0, reads = 0;
  await page.route("**/api/agent-packages?*", route => route.fulfill({ json: [{ id: packageId, key: "internal-review",
    name: "PRIVATE recovery package", description: "PRIVATE setup", versionId, version: "1.0.0",
    manifest: { audience: "internal_test", purpose: "PRIVATE purpose", prohibitedUses: [], requiredConnections: [], optionalConnections: [] },
    components: [{ key: "role", type: "role_pack", required: true, contentHash: "a".repeat(64) }] }] }));
  await page.route(`**/api/companies/${company.id}/agent-package-options?*`, route => route.fulfill({ json: {
    agents: [{ id: agentId, name: "PRIVATE recovery worker" }], components: [{ type: "role_pack", resourceId: roleId,
      versionId: roleVersionId, contentHash: "a".repeat(64), name: "PRIVATE role" }] } }));
  for (const suffix of ["agent-package-installations", "agent-package-update-proposals"])
    await page.route(`**/api/companies/${company.id}/${suffix}?*`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/companies/${company.id}/agent-packages/internal-review/preview?*`, route => route.fulfill({
    json: { readiness: { status: "ready", reasons: [], warnings: [], assessmentIds: [] } } }));
  await page.route(`**/api/companies/${company.id}/agent-packages/internal-review/install?*`, async route => {
    posts++;
    const body = route.request().postDataJSON(); original = body.installationRequestId;
    expect(original).toMatch(/^[a-f0-9-]{36}$/); expect(body.agentId).toBe(agentId);
    await route.abort("failed");
  });
  await page.route(`**/api/companies/${company.id}/agent-package-installations/requests/*?*`, route => {
    reads++; expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe("local-board");
    expect(route.request().url()).toContain(`/requests/${original}?`);
    return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, requestId: original, installationId, installationVersion: 1,
      installationStatus: "configuring", observedAt: "2026-10-14T14:00:00Z" } });
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: patch }));
    await page.goto(`/${company.issuePrefix}/agents/packages`);
    await page.getByRole("combobox", { name: /Language|Sprog/, exact: true }).selectOption("en");
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Review package", exact: true }).click();
    await main.getByRole("combobox", { name: "Agent", exact: true }).selectOption(agentId);
    await main.getByRole("combobox", { name: "role (required)", exact: true }).selectOption(roleVersionId);
    await main.getByRole("checkbox").first().check();
    await main.getByRole("button", { name: "Check readiness", exact: true }).click();
    await expect(main.getByRole("button", { name: "Install for configuration", exact: true })).toBeEnabled();
    await main.getByRole("button", { name: "Install for configuration", exact: true }).click();
    await expect(main.getByRole("heading", { name: "An installation is recorded for this request", exact: true })).toBeVisible();
    await expect(main).not.toContainText("PRIVATE"); await expect(main.getByRole("combobox")).toHaveCount(0);
    const value = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-package-installation-requests"));
    expect(value).toContain(original); expect(value).not.toMatch(/PRIVATE|components|agentId|internal-review|updatePolicy/);
    expect(posts).toBe(1);
    await json(await request.patch("/api/instance/settings/experimental", { data: { agent_packages_v7: false } }));
    await page.reload();
    await expect(main.getByRole("heading", { name: "An installation is recorded for this request", exact: true })).toBeVisible();
    expect(reads).toBeGreaterThan(1); expect(posts).toBe(1);
    await expect(main.getByRole("button", { name: "Send the same request again", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("original-installation-request-mobile.png"), fullPage: true });
    await main.getByRole("button", { name: "Return to packages", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${company.issuePrefix}/dashboard$`));
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-package-installation-requests"))).toBeNull();
    expect(posts).toBe(1);
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(patch).map(key => [key, flags[key]])) })
      .catch(error => { if (!page.isClosed()) throw error; });
  }
});
