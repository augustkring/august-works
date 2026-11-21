import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
import { createDb, closeRegisteredClients, issues, businessExperimentAnalyses } from "../../packages/db/src/index.ts";
import { eq } from "../../packages/db/node_modules/drizzle-orm/index.js";
import { businessMetricService } from "../../server/src/services/business-metrics/service.ts";
import { businessExperimentService } from "../../server/src/services/business-experiments/service.ts";
import { businessExperimentRecordingService } from "../../server/src/services/business-experiments/recording.ts";
import { businessExperimentAnalysisService } from "../../server/src/services/business-experiments/analysis.ts";
import { aiGovernanceService } from "../../server/src/services/ai-governance/governance-service.ts";
import { analyticalPrincipalId } from "../../server/src/services/analytical-reader.ts";
import { analyticalPurpose, metricDefinition } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { experimentDefinition } from "../../server/src/__tests__/helpers/business-experiment-fixture.ts";
import { ISSUE_STATUSES, insightExperimentSummarySchema, insightExperimentDetailSchema, insightExperimentPageSchema } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Actual Native recording/stop/analysis/Source owners; explicit synthetic
// governance/activity/manager fixtures. No intervention, actual Human trial,
// causal effect, qualified numeric experiment or production outcome is claimed.
test("Insights reads a stopped experiment without inventing an effect or exposing unit registers", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable experiment evidence" } }));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const session = await json(await request.get("/api/auth/get-session"));
  const actor = { type: "board" as const, source: "session" as const, userId: session.user.id,
    sessionId: session.session.id, companyIds: [company.id] }, rationale = "Synthetic Human review for Native software verification only";
  const ownerUserId = analyticalPrincipalId(actor);
  let writes = 0; const responsePaths: string[] = [];
  page.on("request", req => { if (req.method() !== "GET" && /\/experiments/.test(req.url())) writes++; });
  page.on("response", response => { if (/\/experiments/.test(response.url())) responsePaths.push(new URL(response.url()).pathname); });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_projection_v9: true, progressive_shell_v9: true,
      analytical_lineage_v8: true, business_metrics_v8: true, business_experiments_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const purpose = analyticalPurpose(); purpose.analyticalPurpose!.capabilities = ["metrics", "experiment"];
    const policy = await aiGovernanceService(db).obligation(actor, company.id, purpose);
    const metrics = [], metricOwner = businessMetricService(db);
    for (const [index, status] of ["done", "cancelled", "in_progress"].entries()) {
      const metric = metricDefinition(policy.id); metric.ownerUserId = ownerUserId;
      const created = await metricOwner.create(company.id, actor, { key: `trial_outcome_${index}`, definition: { ...metric, calculation: { kind: "native_ratio", numerator: { entity: "issue", statuses: [status], projectId: null }, denominator: { entity: "issue", statuses: [...ISSUE_STATUSES], projectId: null } } } });
      await metricOwner.publish(company.id, actor, created.metric.id, { expectedRevision: 1, versionId: created.version.id }); metrics.push({ id: created.metric.id, versionId: created.version.id });
    }
    const definition = experimentDefinition(policy.id, metrics); definition.ownerUserId = ownerUserId;
    definition.sampleOrDurationPlan.from = new Date(Date.now() + 1200).toISOString();
    definition.sampleOrDurationPlan.until = new Date(Date.parse(definition.sampleOrDurationPlan.from) + 60000).toISOString();
    definition.sampleOrDurationPlan.minimumAssignedUnits = 4;
    const registry = businessExperimentService(db), recording = businessExperimentRecordingService(db);
    const created = await registry.create(company.id, actor, { key: "recorded_stop", definition });
    await registry.transition(company.id, actor, created.experiment.id, { expectedRevision: 1, versionId: created.version.id, state: "in_review", rationale });
    await registry.transition(company.id, actor, created.experiment.id, { expectedRevision: 2, versionId: created.version.id, state: "ready", rationale });
    await recording.start(company.id, actor, created.experiment.id, { expectedRevision: 3, versionId: created.version.id, mode: "recording_only_human_attested_native_process", rationale });
    const remaining = Date.parse(definition.sampleOrDurationPlan.from) - Date.now() + 20;
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    const [unit] = await db.insert(issues).values({ companyId: company.id, status: "todo", title: "PRIVATE enrolled Source prose" }).returning();
    const assignment = await recording.assign(company.id, actor, created.experiment.id, { expectedRevision: 4, versionId: created.version.id, unitId: unit.id });
    await recording.recordExposure(company.id, actor, created.experiment.id, { expectedRevision: 4, versionId: created.version.id, assignmentId: assignment.id,
      exposure: { status: "not_applied", rationale: "Explicit synthetic non-application receipt; no actual intervention or Human trial" } });
    await recording.control(company.id, actor, created.experiment.id, { expectedRevision: 4, versionId: created.version.id, state: "completed", rationale,
      completion: { reason: "emergency_safety_stop", concurrentChangeReview: { assessment: "none_identified", rationale } } });
    const analyzed = await businessExperimentAnalysisService(db).analyze(company.id, actor, created.experiment.id, { expectedRevision: 5, versionId: created.version.id });
    expect(analyzed.analysis.result.numericallyQualified).toBe(false); expect(analyzed.analysis.result.metrics).toEqual([]);
    const summaryEndpoint = `/api/companies/${company.id}/experiments/${created.experiment.id}/versions/${created.version.id}/analysis-summary`;
    for (const [endpoint, schema] of [[`/api/companies/${company.id}/experiments`, insightExperimentPageSchema], [`/api/companies/${company.id}/experiments/${created.experiment.id}`, insightExperimentDetailSchema], [summaryEndpoint, insightExperimentSummarySchema]] as const) {
      const checked = schema.safeParse(await json(await request.get(endpoint)));
      expect(checked.success, checked.error?.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")).toBe(true);
    }
    const initial = await db.select().from(businessExperimentAnalyses).where(eq(businessExperimentAnalyses.companyId, company.id));
    await page.route(`**/api/companies/${company.id}/experience?*`, route => route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, profile: "manager", availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: new Date().toISOString(), dependencies: [], needsYou: [], inProgress: [], done: [], watch: [],
    } }));
    await page.goto(`/${company.issuePrefix}/insights`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: definition.name, exact: true })).toBeVisible();
    await expect(main).toContainText("The analysis is inconclusive."); await expect(main).toContainText("does not qualify a numerical effect");
    await expect(main).not.toContainText("PRIVATE enrolled"); await expect(main).not.toContainText("Difference:");
    expect(responsePaths.some(value => value.endsWith("/analysis-summary"))).toBe(true);
    expect(responsePaths.some(value => /\/(receipts|assignments|exposures)$/.test(value))).toBe(false);
    const summary = await json(await request.get(summaryEndpoint));
    expect(JSON.stringify(summary)).not.toContain(unit.id); expect(JSON.stringify(summary)).not.toContain(assignment.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByRole("heading", { name: "Gemte forsøgsresultater", exact: true })).toBeVisible(); await expect(main).toContainText("ikke en talmæssig effekt");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath });
    expect((await page.evaluate(async () => (window as any).axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }))).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("insight-native-experiment-mobile-da.png"), fullPage: true });
    expect(writes).toBe(0); expect(await db.select().from(businessExperimentAnalyses).where(eq(businessExperimentAnalyses.companyId, company.id))).toEqual(initial);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, unit.id));
    expect((await request.get(summaryEndpoint)).status()).toBe(404);
    await page.reload(); await expect(main.getByRole("heading", { name: definition.name, exact: true })).toHaveCount(0);
  } finally {
    await page.goto("about:blank"); await request.patch("/api/instance/settings/experimental", { data: flags }); await closeRegisteredClients(databaseUrl);
  }
});
