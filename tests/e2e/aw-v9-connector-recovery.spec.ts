import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Built UI uses an explicit software projection. The real verified-connection-manager,
// current-state and read-only owner checks run in the PostgreSQL suites.
// This does not qualify hosted connector provisioning, repair or human usability.
for (const personal of [false, true]) {
test(`current ${personal ? "personal" : "manager"} connector recovery cards localize and offer only keyboard-accessible native navigation`, async ({ page, request }) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable recovery-card UI fixture" } }));
  const source = { domain: "connection", companyId: company.id, resourceId: randomUUID(), version: "a".repeat(64), observedAt: new Date().toISOString() };
  let mutations = 0;
  await page.route(`**/api/companies/${company.id}/experience?*`, route => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { companyId: company.id, profile: personal ? "member" : "admin",
      availableProfiles: personal ? ["member"] : ["member", "manager", "admin"], advancedLinks: [], generatedAt: source.observedAt,
      dependencies: [{ domain: "connector-recovery", state: "fresh", observedAt: source.observedAt, reason: null }],
      needsYou: [{ id: "owned-connector-recovery", kind: "recovery", title: "server fallback title", whyYou: "server fallback reason",
        consequence: "server fallback consequence", source, freshness: "fresh", evidence: [personal ? "connector_personal_access_review" : "connector_access_review"],
        actions: [{ id: "review-connection", label: "Review app connection", labelKey: "review", operation: "open", href: `/apps/${source.resourceId}/permissions`,
          criticality: "C4", source, requiresCurrentAuthorization: true }] }], inProgress: [], done: [], watch: [] } });
  });
  await page.route("**/tools/connections**", route => {
    if (route.request().method() !== "GET") mutations++;
    return route.abort();
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: true, progressive_shell_v9: true, home_v9: true } }));
    await page.goto(`/${company.issuePrefix}/dashboard`);
    const card = page.getByRole("article", { name: "Review app connection", exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    const review = card.getByRole("link", { name: "Review", exact: true });
    await expect(review).toHaveAttribute("href", `/${company.issuePrefix}/apps/${source.resourceId}/permissions`);
    await review.focus(); await expect(review).toBeFocused();
    await expect(card).not.toContainText("server fallback");
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    const translated = page.getByRole("article", { name: "Gennemgå appforbindelse", exact: true });
    await expect(translated).toBeVisible();
    await expect(translated).toContainText(personal ? "Dette er din egen tilknyttede konto." : "Du administrerer virksomhedens appforbindelser.");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(mutations).toBe(0);
  } finally {
    await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: flags.experience_projection_v9, progressive_shell_v9: flags.progressive_shell_v9, home_v9: flags.home_v9 } });
  }
});
}
