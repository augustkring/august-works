import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { createDb, closeRegisteredClients, issues, businessMetricObservations } from "../../packages/db/src/index.ts";
import { eq } from "../../packages/db/node_modules/drizzle-orm/index.js";
import { businessMetricService } from "../../server/src/services/business-metrics/service.ts";
import { analyticalPrincipalId } from "../../server/src/services/analytical-reader.ts";
import { aiGovernanceService } from "../../server/src/services/ai-governance/governance-service.ts";
import { analyticalPurpose, metricDefinition } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
registerEnglishAccountLocaleIsolation(test);
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Actual local Native metric definition/calculation/observation owners with
// synthetic governance and a manager projection fixture. No genuine Human,
// company outcome, model/provider or whole-portfolio qualification is claimed.
test("Insights reads a retained Native measurement without creating another calculation", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable retained measurements" } }));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const session = await json(await request.get("/api/auth/get-session"));
  const actor = { type: "board" as const, source: "session" as const, userId: session.user.id,
    sessionId: session.session.id, companyIds: [company.id] };
  let writes = 0;
  page.on("request", req => { if (req.method() !== "GET" && /\/business-metrics/.test(req.url())) writes++; });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_projection_v9: true, progressive_shell_v9: true,
      analytical_lineage_v8: true, business_metrics_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const policy = await aiGovernanceService(db).obligation(actor, company.id, analyticalPurpose());
    const owner = businessMetricService(db);
    const created = await owner.create(company.id, actor, { key: "recorded_completion", definition: { ...metricDefinition(policy.id), ownerUserId: analyticalPrincipalId(actor), name: "Recorded delivery proportion" } });
    await owner.publish(company.id, actor, created.metric.id, { expectedRevision: 1, versionId: created.version.id });
    await db.insert(issues).values(["done", "todo", "todo"].map(status => ({ companyId: company.id, status, title: "PRIVATE source title is not an insight", description: "PRIVATE source prose", createdAt: new Date("2026-01-01T12:00:00Z") })));
    const measured = await owner.query(company.id, actor, { metricId: created.metric.id, versionId: created.version.id,
      from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", dimensions: [], maxRows: 5000 });
    expect(measured.status).toBe("observed"); expect(measured.value).toBeCloseTo(1 / 3);
    const initial = await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId, company.id));
    await page.route(`**/api/companies/${company.id}/experience?*`, route => route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, profile: "manager", availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: new Date().toISOString(),
      dependencies: [], needsYou: [], inProgress: [], done: [], watch: [],
    } }));
    await page.goto(`/${company.issuePrefix}/insights`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Recorded delivery proportion", exact: true })).toBeVisible();
    await expect(main).toContainText("33.3%");
    await expect(main).toContainText("not a reconstruction of historical state");
    await expect(main).not.toContainText("PRIVATE source");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main).toContainText("33,3");
    await expect(main.getByRole("heading", { name: "Gemte målinger", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath });
    expect((await page.evaluate(async () => (window as any).axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }))).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("insight-native-measurement-mobile-da.png"), fullPage: true });
    expect(writes).toBe(0);
    expect(await db.select().from(businessMetricObservations).where(eq(businessMetricObservations.companyId, company.id))).toEqual(initial);
  } finally {
    await page.goto("about:blank");
    await request.patch("/api/instance/settings/experimental", { data: flags });
    // This disposable database owns the synthetic governance/measurement rows.
    // The legacy local remove does not erase governance evidence; its teardown
    // must not be presented as a successful tenant-erasure qualification.
    await closeRegisteredClients(databaseUrl);
  }
});
