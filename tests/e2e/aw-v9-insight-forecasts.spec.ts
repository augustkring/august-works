import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { createDb, closeRegisteredClients, projects, issues, forecastRuns } from "../../packages/db/src/index.ts";
import { eq } from "../../packages/db/node_modules/drizzle-orm/index.js";
import { businessForecastDefinitionSchema } from "../../packages/shared/src/index.ts";
import { businessForecastService } from "../../server/src/services/business-forecasting/service.ts";
import { aiGovernanceService } from "../../server/src/services/ai-governance/governance-service.ts";
import { analyticalPurpose } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { businessForecastHistoryFixture } from "../../server/src/__tests__/helpers/business-forecast-history-fixture.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Native Source/backtest/publication/run/UI owners operate over explicit
// synthetic chronological fixtures. No collected history, real business
// outcome, empirical forecast skill, real Human or provider qualification.
test("Insights reads a retained Native baseline forecast without another run or invented interval", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable forecast evidence" } }));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const actor = { type: "board" as const, source: "local_implicit" as const };
  let writes = 0; page.on("request", req => { if (req.method() !== "GET" && /\/business-forecasts/.test(req.url())) writes++; });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_projection_v9: true, progressive_shell_v9: true,
      analytical_lineage_v8: true, business_metrics_v8: true, business_forecasting_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const purpose = analyticalPurpose(); purpose.analyticalPurpose!.capabilities = ["metrics", "forecast"];
    const policy = await aiGovernanceService(db).obligation(actor, company.id, purpose);
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Synthetic retained history", createdAt: new Date(Date.now() - 20 * 86400000) }).returning();
    const history = await businessForecastHistoryFixture(db, company.id, project.id, policy.id), owner = businessForecastService(db);
    const definition = businessForecastDefinitionSchema.parse({ name: "Recorded baseline workload estimate", businessQuestion: "What could this declared baseline estimate?", decisionUse: "Human review without changing commitments", ownerUserId: "local-board", metricId: history.metricId, metricVersionId: history.versionId,
      scope: { type: "project", id: project.id }, frequency: "daily_utc", horizon: 1, provider: "aw_native", candidate: { kind: "naive" }, baselines: [{ kind: "naive" }], minimumHistory: 8, captureLatencySeconds: 60,
      backtest: { minimumTrainingPoints: 3, minimumOrigins: 3, gapPeriods: 1, maximumMAE: 1, minimumRelativeMAEImprovement: 0 }, knownFailureModes: ["Synthetic fixtures do not qualify production history"], sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [policy.id], retentionDays: 20 });
    const created = await owner.create(company.id, actor, { key: "retained_baseline", definition });
    const input = { expectedRevision: 1, versionId: created.version.id, observationIds: history.observations.map(value => value.id), cutoff: history.cutoff.toISOString() };
    const backtest = await owner.backtest(company.id, actor, created.spec.id, input);
    const published = await owner.publish(company.id, actor, created.spec.id, { expectedRevision: 1, versionId: created.version.id, backtestId: backtest.id, rationale: "Synthetic Human publication of the exact retained baseline" });
    const run = await owner.run(company.id, actor, published.id, { ...input, expectedRevision: published.revision });
    expect(run.result.points[0]).toMatchObject({ value: 1, interval: null });
    const initial = await db.select().from(forecastRuns).where(eq(forecastRuns.companyId, company.id));
    await page.route(`**/api/companies/${company.id}/experience?*`, route => route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, profile: "manager", availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: new Date().toISOString(), dependencies: [], needsYou: [], inProgress: [], done: [], watch: [],
    } }));
    await page.goto(`/${company.issuePrefix}/insights`); const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: definition.name, exact: true })).toBeVisible(); await expect(main).toContainText("Estimate: 1 (objects)");
    await expect(main).toContainText("already begun when this calculation was recorded");
    await expect(main).toContainText("No prediction interval is available"); await expect(main).toContainText("does not establish future accuracy"); await expect(main).not.toContainText("PRIVATE synthetic");
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByRole("heading", { name: "Gemte prognoser", exact: true })).toBeVisible(); await expect(main).toContainText("Intet prognoseinterval");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath }); expect((await page.evaluate(async () => (window as any).axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }))).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("insight-native-forecast-mobile-da.png"), fullPage: true });
    expect(writes).toBe(0); expect(await db.select().from(forecastRuns).where(eq(forecastRuns.companyId, company.id))).toEqual(initial);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, history.sourceIds[0]));
    expect((await request.get(`/api/companies/${company.id}/business-forecasts/${published.id}/runs/${run.id}`)).status()).toBe(403);
    await page.reload(); await expect(main).not.toContainText("Estimate: 1 (objects)");
    // Model metadata may remain admitted; the actual private estimate cannot.
    await expect(main).not.toContainText("Estimat: 1 (objects)");
  } finally {
    await page.goto("about:blank"); await request.patch("/api/instance/settings/experimental", { data: flags }); await closeRegisteredClients(databaseUrl);
  }
});
