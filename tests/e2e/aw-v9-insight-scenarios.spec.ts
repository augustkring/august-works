import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { createDb, closeRegisteredClients, issues, businessScenarioRuns } from "../../packages/db/src/index.ts";
import { eq } from "../../packages/db/node_modules/drizzle-orm/index.js";
import { businessMetricService } from "../../server/src/services/business-metrics/service.ts";
import { businessScenarioService } from "../../server/src/services/business-scenarios/service.ts";
import { aiGovernanceService } from "../../server/src/services/ai-governance/governance-service.ts";
import { analyticalPurpose, metricDefinition } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { scenarioDefinition } from "../../server/src/__tests__/helpers/business-scenario-fixture.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Actual Native metric/scenario/publication/result owners and Source refusal;
// explicit synthetic approved governance and manager presentation fixture.
test("Insights reads conditional scenario comparisons and loses private results after Source withdrawal", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable scenario comparisons" } }));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const actor = { type: "board" as const, source: "local_implicit" as const };
  let writes = 0;
  page.on("request", req => { if (req.method() !== "GET" && /\/business-(metrics|scenarios)/.test(req.url())) writes++; });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_projection_v9: true, progressive_shell_v9: true,
      analytical_lineage_v8: true, business_metrics_v8: true, scenario_planning_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const purpose = analyticalPurpose(); purpose.analyticalPurpose!.capabilities = ["metrics", "scenario"];
    const policy = await aiGovernanceService(db).obligation(actor, company.id, purpose);
    const [issue] = await db.insert(issues).values({ companyId: company.id, status: "done", title: "PRIVATE scenario Source prose", createdAt: new Date("2026-01-01T12:00:00Z") }).returning();
    const metrics = businessMetricService(db);
    const measured = await metrics.create(company.id, actor, { key: "completed_objects", definition: { ...metricDefinition(policy.id), valueType: "count", unit: "objects", calculation: { kind: "native_count", population: { entity: "issue", statuses: ["done"], projectId: null } } } });
    await metrics.publish(company.id, actor, measured.metric.id, { expectedRevision: 1, versionId: measured.version.id });
    const observation = await metrics.query(company.id, actor, { metricId: measured.metric.id, versionId: measured.version.id, from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", dimensions: [], maxRows: 5000 });
    const owner = businessScenarioService(db);
    const created = await owner.create(company.id, actor, { key: "conditional_capacity", definition: scenarioDefinition(policy.id, {
      kind: "metric_observation", key: "objects", metricId: measured.metric.id, metricVersionId: measured.version.id, observationId: observation.id, unit: { issue: 1 },
    }) });
    const published = await owner.publish(company.id, actor, created.scenario.id, { expectedRevision: 1, versionId: created.version.id, rationale: "Synthetic human review of this conditional model and source pins" });
    const run = await owner.run(company.id, actor, published.id, { expectedRevision: published.revision, versionId: created.version.id, seed: null });
    expect(run.result.cases.map(value => value.outputs[0].nominal)).toEqual([2, 3]);
    const initial = await db.select().from(businessScenarioRuns).where(eq(businessScenarioRuns.companyId, company.id));
    await page.route(`**/api/companies/${company.id}/experience?*`, route => route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, profile: "manager", availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: new Date().toISOString(), dependencies: [], needsYou: [], inProgress: [], done: [], watch: [],
    } }));
    await page.goto(`/${company.issuePrefix}/insights`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Conditional native capacity model", exact: true })).toBeVisible();
    await expect(main).toContainText("Value: 2 tasks"); await expect(main).toContainText("Value: 3 tasks"); await expect(main).toContainText("Change from base: 1 task");
    await expect(main).toContainText("does not prove its assumptions"); await expect(main).not.toContainText("PRIVATE scenario Source");
    await main.getByText("Review assumptions and unmodeled effects", { exact: true }).click();
    await expect(main).toContainText("Human-declared assumption"); await expect(main).toContainText("Declared range: 1 to 3");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByRole("heading", { name: "Gemte scenariesammenligninger", exact: true })).toBeVisible(); await expect(main).toContainText("Værdi: 3 opgaver");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath });
    expect((await page.evaluate(async () => (window as any).axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }))).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("insight-native-scenarios-mobile-da.png"), fullPage: true });
    expect(writes).toBe(0); expect(await db.select().from(businessScenarioRuns).where(eq(businessScenarioRuns.companyId, company.id))).toEqual(initial);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, issue.id));
    expect((await request.get(`/api/companies/${company.id}/business-scenarios/${published.id}/runs/${run.id}`)).status()).toBe(403);
    await page.reload(); await expect(main).not.toContainText("Value: 3 tasks"); await expect(main).not.toContainText("Værdi: 3 opgaver");
  } finally {
    await page.goto("about:blank"); await request.patch("/api/instance/settings/experimental", { data: flags }); await closeRegisteredClients(databaseUrl);
  }
});
