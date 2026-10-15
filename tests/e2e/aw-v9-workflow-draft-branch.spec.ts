import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { authUsers, companyMemberships, createDb, closeRegisteredClients, principalPermissionGrants } from "../../packages/db/src/index.ts";
import { workflowRoutes } from "../../server/src/routes/workflows.ts";
import { errorHandler } from "../../server/src/middleware/error-handler.ts";
const requireServer = createRequire(new URL("../../server/package.json", import.meta.url));
const express = requireServer("express"), { eq } = requireServer("drizzle-orm");
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }
// Controlled verified-actor/session fixture over actual Native owners; no
// real Human, provider, Agent runtime or external action is qualified here.
test("guided conditional composition saves one actual Native branch graph and recovers a lost response in Danish mobile", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(path.basename(path.dirname(path.dirname(path.dirname(configPath))))).toMatch(/^paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8")), pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const flags = await json(await request.get("/api/instance/settings/experimental")), session = await json(await request.get("/api/auth/get-session"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable branch authoring fixture" } })), userId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Editor fixture", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({ companyId: company.id, principalType: "user", principalId: userId, permissionKey })));
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId }; next(); });
  app.use("/api", workflowRoutes(db)); app.use(errorHandler);
  const bridge = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => bridge.once("listening", resolve));
  const address = bridge.address(); if (!address || typeof address === "string") throw new Error("Controlled fixture listener unavailable");
  const bridgeBase = `http://127.0.0.1:${address.port}`;
  let posts = 0, lost: { requestId: string } | null = null, receipts = 0;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true } }));
    const base = `/api/companies/${company.id}/workflows`, created = await json(await request.post(base, { data: { name: "Compare amount" } }));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, user: { ...session.user, id: userId, emailVerified: true }, session: { ...session.session, userId, localImplicit: false } } }));
    await page.route(`**${base}/${created.id}/experience/draft-flow**`, async route => {
      const url = new URL(route.request().url()), response = await route.fetch({ url: bridgeBase + url.pathname + url.search });
      if (route.request().method() === "POST" && ++posts === 2) { lost = await response.json(); await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    await page.route(`**${base}/${created.id}/experience/requests/draft_build/**`, async route => { receipts++; const url = new URL(route.request().url()); await route.fulfill({ response: await route.fetch({ url: bridgeBase + url.pathname + url.search }) }); });
    await page.goto(`/${company.issuePrefix}/workflows/${created.id}/draft`);
    await page.getByRole("spinbutton", { name: "Maximum run time (seconds)", exact: true }).fill("30");
    await page.getByRole("button", { name: "Add a manual start", exact: true }).click();
    await expect(page.getByRole("link", { name: "Start when I run the workflow", exact: true })).toBeVisible();
    const started = await json(await request.get(`${base}/${created.id}`));
    const published = await json(await request.post(`${base}/${created.id}/publish`, { data: { expectedDraftRevisionId: started.draftRevisionId, expectedPublishedRevisionId: null, approvalId: null } }));
    await page.reload(); await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da"); await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Hvad skal ske som det næste?", exact: true }).selectOption("append_condition");
    await page.getByRole("textbox", { name: "Trinnets navn", exact: true }).first().fill("Sammenlign beløb");
    await page.getByRole("textbox", { name: "Feltnavne, fra yderste til inderste niveau", exact: true }).fill("amount");
    await page.getByRole("combobox", { name: "Sammenligning", exact: true }).selectOption(">=");
    await page.getByRole("combobox", { name: "Sammenligningsværdiens type", exact: true }).selectOption("number");
    await page.getByRole("spinbutton", { name: "Sammenlign med", exact: true }).fill("10000");
    const yes = page.getByRole("group", { name: "Hvis betingelsen er opfyldt", exact: true }), no = page.getByRole("group", { name: "Ellers", exact: true });
    await yes.getByRole("textbox", { name: "Trinnets navn", exact: true }).fill("PRIVATE stort beløb"); await yes.getByRole("spinbutton", { name: "Ventetid (sekunder)", exact: true }).fill("1");
    await no.getByRole("textbox", { name: "Trinnets navn", exact: true }).fill("PRIVATE mindre beløb"); await no.getByRole("spinbutton", { name: "Ventetid (sekunder)", exact: true }).fill("1");
    await page.addScriptTag({ path: axePath }); expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("guided-condition-branches-da-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Tilføj et trin", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(() => lost?.requestId).toBeTruthy(); await expect(page.getByRole("main")).toContainText("oprindelige gemte anmodning");
    const current = await json(await request.get(`${base}/${created.id}`)); expect(current.publishedRevision).toEqual(published.publishedRevision);
    expect(current.draftRevision.graph.nodes).toHaveLength(4); expect(current.draftRevision.graph.edges.filter(edge => edge.sourceHandle).map(edge => edge.sourceHandle)).toEqual(["true", "false"]);
    expect(current.draftRevision.graph.nodes.find(node => node.type === "core.condition").config).toEqual({ expression: '{{trigger["amount"]}} >= 10000' });
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).not.toContain("PRIVATE");
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowBuilderV1: false, enableWorkflowsV1: false, progressive_shell_v9: false } }));
    await page.reload(); await page.getByRole("link", { name: "Kontrollér den gemte anmodning", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workflowanmodning bekræftet", exact: true })).toBeFocused();
    await expect(page.getByRole("main")).toContainText("Din ændring af kladdeflowet blev gemt"); expect(posts).toBe(2); expect(receipts).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) => bridge.close(err => err ? reject(err) : resolve()));
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {}); await request.delete(`/api/companies/${company.id}`).catch(() => {});
    await db.delete(authUsers).where(eq(authUsers.id, userId)); await closeRegisteredClients(databaseUrl);
  }
});
