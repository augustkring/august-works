import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Built UI over a disposable Native company and an explicitly supplied aggregate.
// This proves the chart host and keyboard/table behavior, not real run outcomes,
// authorization changes, screen-reader qualification or representative usability.
test("chart values have keyboard-accessible tables at narrow width in both themes", async ({ page, request }) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable chart table host" } }));
  // Use the actual Native dashboard after initial setup. A company with no
  // Agents opens the inherited first-Agent wizard over this page.
  await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
    name: "Idle chart host agent", role: "engineer", adapterType: "process", adapterConfig: {},
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
  } }));
  const summary = await json(await request.get(`/api/companies/${company.id}/dashboard`));
  const date = new Date().toISOString().slice(0, 10);
  const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await json(await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Chart table task", status: "blocked", priority: "high" } }));
  await page.route(`**/api/companies/${company.id}/dashboard`, route => route.fulfill({ json: { ...summary,
    runActivity: [
      { date: previous, succeeded: 0, recovered: 0, failed: 0, other: 0, total: 0, failedByErrorCode: {} },
      { date, succeeded: 3, recovered: 4, failed: 1, other: 0, total: 8, failedByErrorCode: { process_lost: 1 } },
    ],
  } }));
  await page.addInitScript(() => localStorage.setItem("aw.v9.display-locale", "en"));
  await page.setViewportSize({ width: 320, height: 720 });
  try {
    await page.goto(`/${company.issuePrefix}/dashboard`);
    const runSummary = page.getByText("View Run activity as data", { exact: true });
    await expect(runSummary).toBeVisible();
    await runSummary.focus();
    await page.keyboard.press("Enter");
    const runs = page.getByRole("region", { name: "Run activity", exact: true });
    await expect(runs).toBeVisible();
    await expect(runs.getByRole("columnheader", { name: "Failure reasons" })).toBeVisible();
    await expect(runs.getByRole("cell", { name: "process_lost: 1", exact: true })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(runs).toBeFocused();
    await page.getByText("View Run success rate as data", { exact: true }).click();
    const rates = page.getByRole("table", { name: "Run success rate", exact: true });
    await expect(rates.getByRole("cell", { name: "No runs", exact: true })).toBeVisible();
    await expect(rates.getByRole("cell", { name: "88%", exact: true })).toBeVisible();
    await page.addScriptTag({ path: axePath });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const violations = await page.evaluate(async () => (await (window as any).axe.run("main", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      })).violations.map((item: any) => ({ id: item.id, targets: item.nodes.map((node: any) => node.target) })));
      expect(violations, theme).toEqual([]);
    }
    await page.reload();
    await expect(page.getByText("View Run activity as data", { exact: true })).toBeVisible();
    expect(await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`))).toEqual([]);
  } finally {
    await page.goto("about:blank");
    // Native tenant erasure is a separate lifecycle; this fixture stays local to
    // the disposable test instance. No physical deletion or run is claimed.
  }
});
