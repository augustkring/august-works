import { expect, test } from "@playwright/test";
import { json } from "./agent-chat.shared";

// Actual shipped chunks and local Native owner reads. This measures loading
// behavior; it is not a human journey or hosted performance qualification.
test("advanced planning code and data load when the admitted route opens", async ({ page, request }, info) => {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable route loading fixture" } }));
  const paths: string[] = [];
  page.on("request", request => paths.push(new URL(request.url()).pathname));
  try {
    // This probes an existing company's admitted route, not the agentless
    // onboarding overlay. Keep the Native fixture unable to schedule work.
    const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
      name: "Paused route loading fixture", adapterType: "process", adapterConfig: { command: "/usr/bin/true" },
      runtimeConfig: { heartbeat: { enabled: false } }, budgetMonthlyCents: 0,
    } }));
    expect((await json(await request.post(`/api/agents/${agent.id}/pause`, { data: {} }))).status).toBe("paused");
    await json(await request.patch("/api/instance/settings/experimental", { data: { business_metrics_v8: false, adaptive_planning_v8: false, planning_optimizer_v8: false } }));
    await page.goto(`/${company.issuePrefix}/dashboard`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create your first agent", exact: true })).not.toBeVisible();
    expect(paths.filter(path => /\/assets\/(?:BusinessMetrics|CrossProjectPlanning)-/.test(path))).toEqual([]);
    expect(paths.filter(path => path.includes(`/companies/${company.id}/adaptive-planning/`))).toEqual([]);
    const initialNavigation = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { domInteractiveMs: navigation.domInteractive, domContentLoadedMs: navigation.domContentLoadedEventEnd };
    });
    await json(await request.patch("/api/instance/settings/experimental", { data: { analytical_lineage_v8: true, business_metrics_v8: true,
      strategy_execution_v8: true, adaptive_planning_v8: true, planning_optimizer_v8: true, enableFoundationV1: true,
      project_roadmap_v5: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    await page.goto(`/${company.issuePrefix}/adaptive-planning`);
    await expect(page.locator("main").getByRole("heading", { name: "Cross-project planning", exact: true })).toBeVisible();
    expect(paths.filter(path => /\/assets\/CrossProjectPlanning-/.test(path))).toHaveLength(1);
    await expect.poll(() => paths.some(path => path.includes(`/companies/${company.id}/adaptive-planning/`))).toBe(true);
    expect(paths.filter(path => /\/assets\/BusinessMetrics-/.test(path))).toEqual([]);
    await page.reload();
    await expect(page.locator("main").getByRole("heading", { name: "Cross-project planning", exact: true })).toBeVisible();
    await info.attach("route-loading-observations.json", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      qualification: "local-built-software-observation", initialNavigation,
      planningChunkRequests: paths.filter(path => /\/assets\/CrossProjectPlanning-/.test(path)).length,
      unusedMetricsChunkRequests: paths.filter(path => /\/assets\/BusinessMetrics-/.test(path)).length,
    }, null, 2)) });
  } finally {
    await json(await request.patch("/api/instance/settings/experimental", { data: original }));
    await json(await request.delete(`/api/companies/${company.id}`));
  }
});
