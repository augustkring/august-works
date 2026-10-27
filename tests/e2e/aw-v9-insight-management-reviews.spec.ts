import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { createDb, closeRegisteredClients, goals, managementReviewSnapshots } from "../../packages/db/src/index.ts";
import { eq } from "../../packages/db/node_modules/drizzle-orm/index.js";
import { managementReviewDefinitionSchema } from "../../packages/shared/src/index.ts";
import { managementReviewService } from "../../server/src/services/management-reviews/service.ts";
import { aiGovernanceService } from "../../server/src/services/ai-governance/governance-service.ts";
import { analyticalPurpose } from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import { lockMemoryPrivacy } from "../../server/src/services/memory/memory-privacy.ts";
import { eraseAnalyticalSourcesUnderMemory } from "../../server/src/services/analytical-source-erasure.ts";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
registerEnglishAccountLocaleIsolation(test);
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Actual Original snapshot/publication/current-source/privacy owners operate
// on explicit synthetic governance/goal/manager fixtures. No real Human study,
// company result, decision, approval or production qualification is claimed.
test("Insights reads a signed historical review and withdraws agenda after source change and erasure", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable management review" } }));
  const session = await json(await request.get("/api/auth/get-session"));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8")); expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8"), databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const actor = { type: "board" as const, source: "session" as const, userId: session.user.id,
    sessionId: session.session.id, companyIds: [company.id] };
  let writes = 0; page.on("request", req => { if (req.method() !== "GET" && /\/management-reviews/.test(req.url())) writes++; });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_projection_v9: true, progressive_shell_v9: true, enableFoundationV1: true, project_roadmap_v5: true,
      analytical_lineage_v8: true, business_metrics_v8: true, management_reviews_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true } }));
    const purpose = analyticalPurpose(); purpose.analyticalPurpose!.capabilities = ["metrics", "reviews"];
    const policy = await aiGovernanceService(db).obligation(actor, company.id, purpose), [goal] = await db.insert(goals).values({ companyId: company.id, title: "Recorded Native goal", status: "planned" }).returning();
    const now = Date.now(), nextAction = "Review the cited Native goal before requesting a decision", hypothesis = "Human suspects a constraint; no cause has been established";
    const definition = managementReviewDefinitionSchema.parse({ name: "Recorded leadership review", reviewType: "weekly_leadership", period: { from: new Date(now - 86400000).toISOString(), until: new Date(now).toISOString() },
      purpose: "management_intelligence", sensitivity: "internal", retentionDays: 1, governanceObligationRefs: [policy.id], sources: [{ key: "goal", source: { kind: "canonical", reference: { type: "goal", id: goal.id } } }],
      agenda: [{ key: "review", category: "DECISION_REQUIRED", ownerUserId: session.user.id, dueAt: new Date(now + 86400000).toISOString(), sourceKeys: ["goal"], nextAction, hypothesis }] });
    const owner = managementReviewService(db), created = await owner.create(company.id, actor, definition);
    await owner.publish(company.id, actor, created.id, { expectedContentHash: created.contentHash, rationale: "Synthetic Human publication of the exact cited review", evidenceAndUncertaintyAcknowledged: true, supersedesId: null });
    const endpoint = `/api/companies/${company.id}/management-reviews/${created.id}/summary`, summary = await json(await request.get(endpoint));
    for (const field of ["sources", "events", "createdBy", "publishedBy"]) expect(summary).not.toHaveProperty(field);
    expect(summary.packet.agenda[0]).not.toHaveProperty("ownerUserId"); expect(JSON.stringify(summary)).not.toContain(goal.id);
    const initial = await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.companyId, company.id));
    await page.route(`**/api/companies/${company.id}/experience?*`, route => route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      companyId: company.id, profile: "manager", availableProfiles: ["member", "manager", "admin"], advancedLinks: [], generatedAt: new Date().toISOString(), dependencies: [], needsYou: [], inProgress: [], done: [], watch: [],
    } }));
    await page.goto(`/${company.issuePrefix}/insights`); const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: definition.name, exact: true })).toBeVisible(); await expect(main).toContainText(nextAction);
    await expect(main).toContainText("not completed decisions or approvals"); await expect(main).toContainText("Human hypothesis; not an established cause");
    await main.getByText("Review cited facts and limitations", { exact: true }).click(); await expect(main).toContainText("Cited sources: goal");
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(main.getByRole("heading", { name: "Udgivne ledelsesgennemgange", exact: true })).toBeVisible(); await expect(main).toContainText("ikke en fastslået årsag");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ path: axePath }); expect((await page.evaluate(async () => (window as any).axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }))).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("insight-native-management-mobile-da.png"), fullPage: true });
    expect(writes).toBe(0); expect(await db.select().from(managementReviewSnapshots).where(eq(managementReviewSnapshots.companyId, company.id))).toEqual(initial);
    await db.update(goals).set({ title: "Changed actual Native goal" }).where(eq(goals.id, goal.id));
    expect((await json(await request.get(endpoint))).currentQualification).toBe("needs_revalidation"); await page.reload();
    await expect(main).not.toContainText(nextAction); await expect(main).not.toContainText(hypothesis);
    await db.transaction(async raw => { const tx = raw as unknown as typeof db; await lockMemoryPrivacy(tx, company.id); await eraseAnalyticalSourcesUnderMemory(tx, company.id, "goal", [goal.id]); });
    expect((await request.get(endpoint)).status()).toBe(404); await page.reload();
    await expect(main.getByRole("heading", { name: definition.name, exact: true })).toHaveCount(0);
  } finally {
    await page.goto("about:blank"); await request.patch("/api/instance/settings/experimental", { data: flags }); await closeRegisteredClients(databaseUrl);
  }
});
