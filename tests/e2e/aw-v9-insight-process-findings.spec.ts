import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { createDb, closeRegisteredClients, issues, activityLog, processAnalysisRuns, processFindings } from "../../packages/db/src/index.ts";
import { eq } from "../../packages/db/node_modules/drizzle-orm/index.js";
import { aiGovernanceService } from "../../server/src/services/ai-governance/governance-service.ts";
import { businessEventService } from "../../server/src/services/business-events.ts";
import { processAnalysisService } from "../../server/src/services/process-analysis.ts";
import { processFindingService } from "../../server/src/services/process-findings.ts";
import { analyticalPurpose } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Real Native owners and Source refusal with a synthetic approved governance,
// activity and role fixture. This is not real-company/Human qualification.
test("Insights reads a retained process finding and withdraws it after Source access changes", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable process findings" } }));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const actor = { type: "board" as const, source: "local_implicit" as const };
  let writes = 0;
  page.on("request", req => { if (req.method() !== "GET" && /\/process-definitions/.test(req.url())) writes++; });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_projection_v9: true, progressive_shell_v9: true,
      analytical_lineage_v8: true, business_events_v8: true, process_intelligence_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const purpose = analyticalPurpose();
    purpose.analyticalPurpose = { ...purpose.analyticalPurpose!, purpose: "process_intelligence", capabilities: ["process"] };
    const policy = await aiGovernanceService(db).obligation(actor, company.id, purpose);
    const [issue] = await db.insert(issues).values({ companyId: company.id, status: "done", title: "PRIVATE raw Source title", createdAt: new Date("2026-01-01T00:00:00Z") }).returning();
    await db.insert(activityLog).values([
      { companyId: company.id, actorType: "user", actorId: "local-board", action: "issue.created", entityType: "issue", entityId: issue.id, details: { status: "todo" }, createdAt: new Date("2026-01-01T00:00:00Z") },
      { companyId: company.id, actorType: "user", actorId: "local-board", action: "issue.updated", entityType: "issue", entityId: issue.id, details: { status: "done", previousStatus: "todo" }, createdAt: new Date("2026-01-01T00:01:00Z") },
    ]);
    const owner = processAnalysisService(db), period = { from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z" };
    const created = await owner.create(company.id, actor, { key: "arrival_review", definition: { name: "Recorded delivery path", businessQuestion: "Is arrival evidence sufficient for this recorded process?",
      ownerUserId: "local-board", reviewFrequencyDays: 30, retentionDays: 30, scope: "company", sensitivity: "internal", purpose: "process_intelligence", governanceObligationRefs: [policy.id],
      requiredSourceProviders: ["activity_log"], objectTypes: ["issue"], requiredActivities: ["issue.created", "issue.updated"], minimumCoverageSeconds: 3600,
      analysisFamilies: ["cycle_time"], requiresArrivalEvidence: true, maxLateArrivalRate: 0, conformance: null, cycleTimeSemantics: "first_completion_since_recorded_creation" } });
    await owner.publish(company.id, actor, created.root.id, { expectedRevision: 1, versionId: created.version.id, rationale: "Synthetic human review requires qualified arrival evidence" });
    await businessEventService(db).backfill(company.id, actor, { ...period, limit: 100, retentionDays: 30, governanceObligationRefs: [policy.id] });
    const run = await owner.run(company.id, actor, created.root.id, { ...period, versionId: created.version.id });
    expect(run.result.errorCode).toBe("DATA_NOT_READY");
    const finding = await processFindingService(db).create(company.id, actor, created.root.id, run.id, { findingType: "missing_process_data", objectType: null, variantHash: null, severity: "medium",
      interpretation: "Review arrival evidence before comparing process duration" });
    const initialRuns = await db.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.companyId, company.id));
    const initialFindings = await db.select().from(processFindings).where(eq(processFindings.companyId, company.id));
    await page.route(`**/api/companies/${company.id}/experience?*`, route => route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, profile: "manager", availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: new Date().toISOString(), dependencies: [], needsYou: [], inProgress: [], done: [], watch: [],
    } }));
    await page.goto(`/${company.issuePrefix}/insights`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: finding.summary, exact: true })).toBeVisible();
    await expect(main).toContainText("Human interpretation"); await expect(main).toContainText(finding.interpretation); await expect(main).not.toContainText("PRIVATE raw Source");
    await main.getByText("Review observed facts and limitations", { exact: true }).click();
    await expect(main).toContainText("unknown");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByRole("heading", { name: "Gemte procesfund", exact: true })).toBeVisible(); await expect(main).toContainText("Menneskelig fortolkning");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath });
    expect((await page.evaluate(async () => (window as any).axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }))).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("insight-native-process-mobile-da.png"), fullPage: true });
    expect(writes).toBe(0);
    expect(await db.select().from(processAnalysisRuns).where(eq(processAnalysisRuns.companyId, company.id))).toEqual(initialRuns);
    expect(await db.select().from(processFindings).where(eq(processFindings.companyId, company.id))).toEqual(initialFindings);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, issue.id));
    const refused = await request.get(`/api/companies/${company.id}/process-definitions/${created.root.id}/runs/${run.id}/findings`);
    expect(refused.status()).toBe(403);
    await page.reload();
    // Native listRuns omits unavailable evidence. The UI must not restore its
    // earlier result or interpret missing authorized findings as a healthy process.
    await expect(main).not.toContainText(finding.interpretation); await expect(main.getByRole("heading", { name: finding.summary, exact: true })).toHaveCount(0);
  } finally {
    await page.goto("about:blank"); await request.patch("/api/instance/settings/experimental", { data: flags });
    await closeRegisteredClients(databaseUrl);
  }
});
