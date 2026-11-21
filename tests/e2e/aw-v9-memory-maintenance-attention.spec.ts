import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Built UI uses an explicit software projection. The real verified-current-principal,
// current-state and read-only owner checks run in the PostgreSQL suites.
// This does not qualify hosted readiness assessment, repair or human usability.
test("unconfirmed M1 index cards localize and offer only keyboard-accessible native navigation", async ({ page, request }) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable recovery-card UI fixture" } }));
  const source = { domain: "memory_job", companyId: company.id, resourceId: randomUUID(), version: "a".repeat(64), observedAt: new Date().toISOString() };
  const fixtureFlags = {
    enableFoundationV1: true, enableContextEngineV1: true, enableCollectiveMemoryV1: true,
    agent_identities_v5: true, agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true,
    role_packs_v5: true, skill_resolver_v5: true, skill_lifecycle_v5: true, playbooks_v5: true,
    saas_deployment_profile_v6: true, billing_v6: true, cognitive_memory_v7: true,
    memory_observations_v7: true, learning_engine_v7: true, ai_use_cases_v7: true,
    governance_evidence_v7: true, readiness_engine_v7: true, core_stewards_v7: true,
    experience_projection_v9: true, progressive_shell_v9: true, home_v9: true, maintenance_autopilot_v9: true,
  };
  let mutations = 0;
  await page.route(`**/api/companies/${company.id}/experience?*`, route => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { companyId: company.id, profile: "admin",
      availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: source.observedAt,
      dependencies: [{ domain: "memory-maintenance", state: "fresh", observedAt: source.observedAt, reason: null }],
      needsYou: [{ id: "owned-core-maintenance", kind: "maintenance", title: "server fallback title", whyYou: "server fallback reason",
        consequence: "server fallback consequence", source, freshness: "fresh", evidence: ["memory_index_outcome_unconfirmed"],
        actions: [{ id: "review-own-checks", label: "Review your checks", labelKey: "review", operation: "open", href: `/memory/maintenance?jobId=${source.resourceId}`,
          criticality: "C2", source, requiresCurrentAuthorization: true }] }], inProgress: [], done: [], watch: [] } });
  });
  await page.route("**/memory/**", route => {
    if (route.request().method() !== "GET") mutations++;
    return route.abort();
  });
  await page.route(`**/api/companies/${company.id}/memory/experience/maintenance?*`, route => {
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).searchParams.get("jobId")).toBe(source.resourceId);
    const now = Date.now();
    return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { companyId: company.id,
      observedAt: new Date(now).toISOString(), hasMore: false, entries: [{ jobId: source.resourceId,
        maintenanceClass: "M1", attemptNumber: 1, submittedAt: new Date(now - 3000).toISOString(),
        startedAt: new Date(now - 2000).toISOString(), finishedAt: null, leaseExpiresAt: new Date(now - 1000).toISOString(),
        outcome: "unconfirmed", receiptId: null, indexedRecordCount: null }] } });
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: fixtureFlags }));
    await page.goto(`/${company.issuePrefix}/dashboard`);
    const card = page.getByRole("article", { name: "Review an unconfirmed knowledge index check", exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    const review = card.getByRole("link", { name: "Review", exact: true });
    await expect(review).toHaveAttribute("href", `/${company.issuePrefix}/memory/maintenance?jobId=${source.resourceId}`);
    await review.focus(); await expect(review).toBeFocused();
    await expect(card).not.toContainText("server fallback");
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    const translated = page.getByRole("article", { name: "Gennemgå en ubekræftet kontrol af vidensindekset", exact: true });
    await expect(translated).toBeVisible();
    await expect(translated).toContainText("Du administrerer virksomhedens godkendte hukommelse.");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(mutations).toBe(0);
    const exactReview = translated.getByRole("link", { name: "Gennemgå", exact: true });
    await exactReview.focus(); await exactReview.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/memory/maintenance\\?jobId=${source.resourceId}$`));
    await expect(page.locator("main")).toContainText(source.resourceId);
    await expect(page.locator("main")).not.toContainText("PRIVATE-");
    expect(mutations).toBe(0);
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(fixtureFlags).map(key => [key, flags[key]])) });
  }
});
