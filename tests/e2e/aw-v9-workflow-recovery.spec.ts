import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Built UI uses an explicit software projection. The real verified-reader,
// current-state and read-only owner checks run in the PostgreSQL suites.
// This does not qualify hosted workflow provisioning, repair or human usability.
test("current workflow recovery cards localize and offer only keyboard-accessible native navigation", async ({ page, request }) => {
  const session = await json(await request.get("/api/auth/get-session"));
  const expectedUserId = session.user.id;
  const preferences = await json(await request.get(`/api/auth/preferences?expectedUserId=${encodeURIComponent(expectedUserId)}`));
  await json(await request.patch("/api/auth/preferences", { data: { expectedUserId, locale: "en" } }));
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable recovery-card UI fixture" } }));
  const source = { domain: "workflow", companyId: company.id, resourceId: randomUUID(), version: "a".repeat(64), observedAt: new Date().toISOString() };
  let mutations = 0;
  await page.route(`**/api/companies/${company.id}/experience?*`, route => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { companyId: company.id, profile: "admin",
      availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: source.observedAt,
      dependencies: [{ domain: "workflow-recovery", state: "fresh", observedAt: source.observedAt, reason: null }],
      needsYou: [{ id: "owned-workflow-recovery", kind: "recovery", title: "server fallback title", whyYou: "server fallback reason",
        consequence: "server fallback consequence", source, freshness: "fresh", evidence: ["workflow_test_run", "workflow_failed"],
        actions: [{ id: "review-runtime", label: "Review workflow", labelKey: "review", operation: "open", href: "/workflows/10000000-0000-4000-8000-000000000001/runs/10000000-0000-4000-8000-000000000002",
          criticality: "C4", source, requiresCurrentAuthorization: true }] }], inProgress: [], done: [], watch: [] } });
  });
  await page.route("**/workflow-runs/**", route => {
    if (route.request().method() !== "GET") mutations++;
    return route.abort();
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: true, progressive_shell_v9: true, home_v9: true } }));
    await page.goto(`/${company.issuePrefix}/dashboard`);
    const card = page.getByRole("article", { name: "Review workflow recovery", exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    const review = card.getByRole("link", { name: "Review", exact: true });
    await expect(review).toHaveAttribute("href", `/${company.issuePrefix}/workflows/10000000-0000-4000-8000-000000000001/runs/10000000-0000-4000-8000-000000000002`);
    await review.focus(); await expect(review).toBeFocused();
    await expect(card).not.toContainText("server fallback");
    await expect(card).toContainText("Test workflow run");
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    const translated = page.getByRole("article", { name: "Gennemgå workflow-recovery", exact: true });
    await expect(translated).toBeVisible();
    await expect(translated).toContainText("Du har adgang til at gennemgå virksomhedens workflows.");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(mutations).toBe(0);
  } finally {
    await json(await request.patch("/api/auth/preferences", { data: { expectedUserId, locale: preferences.locale ?? null } }));
    await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: flags.experience_projection_v9, progressive_shell_v9: flags.progressive_shell_v9, home_v9: flags.home_v9 } });
  }
});
