import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Explicit role/projection fixture; no business data, actual manager permission,
// provider, model, analytical result or representative Human qualification.
test("insight destinations localize and withdraw during current account reads", async ({ page, request }) => {
  const before = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable insight directory" } }));
  const patch = { experience_projection_v9: true, progressive_shell_v9: true,
    analytical_lineage_v8: true, business_metrics_v8: true, business_events_v8: true, process_intelligence_v8: true,
    business_forecasting_v8: true, scenario_planning_v8: true, business_experiments_v8: true, management_reviews_v8: true,
    ai_use_cases_v7: true, governance_evidence_v7: true };
  let hold = false, writes = 0; const release: Array<() => void> = [];
  await page.route(`**/api/companies/${company.id}/experience?*`, async route => {
    if (hold) await new Promise<void>(done => release.push(done));
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, profile: "manager", availableProfiles: ["member", "manager", "admin"], advancedLinks: [],
      generatedAt: new Date().toISOString(), dependencies: [], needsYou: [], inProgress: [], done: [], watch: [],
    } });
  });
  page.on("request", req => { if (req.method() !== "GET" && /\/business-(metrics|forecasts|scenarios|experiments)/.test(req.url())) writes++; });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: patch }));
    await page.goto(`/${company.issuePrefix}/insights`);
    const main = page.getByRole("main"); await expect(main).toHaveCount(1);
    const heading = main.getByRole("heading", { name: "Insights", exact: true });
    await expect(heading).toBeVisible(); await expect(main.getByRole("link")).toHaveCount(12);
    const experiments = main.getByRole("link", { name: "Business experiments", exact: true });
    await expect(experiments).toHaveAttribute("href", `/${company.issuePrefix}/business-experiments`);
    await heading.focus(); await page.keyboard.press("Tab");
    await expect(main.getByRole("link", { name: "Inspect definitions and observations", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(main.getByRole("link", { name: "Review processes and their findings", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(main.getByRole("link", { name: "Review forecasts and their source evidence", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(main.getByRole("link", { name: "Review scenarios and their assumptions", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(main.getByRole("link", { name: "Review registered experiments and evidence", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(main.getByRole("link", { name: "Review management summaries and their sources", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(main.getByRole("link", { name: "Business performance", exact: true })).toBeFocused();
    hold = true; await page.clock.setFixedTime(new Date(Date.now() + 31_000));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => release.length).toBeGreaterThan(0);
    await expect(main.getByRole("link")).toHaveCount(0);
    hold = false; release.splice(0).forEach(done => done());
    await expect(main.getByRole("link")).toHaveCount(12);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByRole("heading", { name: "Indsigter", exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "Virksomhedseksperimenter", exact: true })).toBeVisible();
    await expect(main).toContainText("betingede beregninger");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const finalLink = main.getByRole("link", { name: "Virksomhedseksperimenter", exact: true });
    await finalLink.scrollIntoViewIfNeeded(); await finalLink.focus();
    expect(await finalLink.evaluate(link => {
      const rect = link.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("a") === link;
    })).toBe(true);
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("insights-directory-mobile-da.png"), fullPage: true });
    expect(writes).toBe(0);
  } finally {
    hold = false; release.splice(0).forEach(done => done());
    await request.patch("/api/instance/settings/experimental", { data: Object.fromEntries(Object.keys(patch).map(key => [key, before[key]])) });
  }
});
