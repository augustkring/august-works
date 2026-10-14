import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { authUsers, companyMemberships, createDb, closeRegisteredClients, principalPermissionGrants } from "../../packages/db/src/index.ts";
import { workflowRoutes } from "../../server/src/routes/workflows.ts";
import { errorHandler } from "../../server/src/middleware/error-handler.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const express = serverRequire("express"), { eq } = serverRequire("drizzle-orm");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Built UI and actual migrated Native HTTP/revision/journal owners. The bridge
// fixes a verified actor and the UI session as explicit software fixtures; this
// is not a real authenticated Human, model or hosted provider qualification.
for (const edit of ["wait", "condition"] as const) test(`guided Native ${edit} edit recovers one lost save through rollout closure with Danish mobile accessibility`, async ({ page, request }, info) => {
  test.setTimeout(120000);
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(path.basename(path.dirname(path.dirname(path.dirname(configPath))))).toMatch(/^paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const flags = await json(await request.get("/api/instance/settings/experimental")), session = await json(await request.get("/api/auth/get-session"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable guided draft fixture" } }));
  const userId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Draft editor fixture", email: `${createHash("sha256").update(userId).digest("hex")}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({ companyId: company.id, principalType: "user", principalId: userId, permissionKey })));
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId }; next(); });
  app.use("/api", workflowRoutes(db)); app.use(errorHandler);
  const bridge = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => bridge.once("listening", resolve));
  const address = bridge.address(); if (!address || typeof address === "string") throw new Error("Controlled fixture listener unavailable");
  const bridgeBase = `http://127.0.0.1:${address.port}`;
  let saved: { requestId: string; draftRevisionId: string } | null = null, posts = 0, receipts = 0;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true } }));
    const base = `/api/companies/${company.id}/workflows`, created = await json(await request.post(base, { data: { name: "Guided waiting flow" } }));
    const drafted = await json(await request.patch(`${base}/${created.id}/draft`, { data: { expectedRevisionId: created.draftRevisionId,
      graph: { version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        edit === "wait" ? { id: "wait", type: "core.wait", name: "Original waiting step", position: { x: 0, y: 1 }, config: { durationSeconds: 3 } }
          : { id: "condition", type: "core.condition", name: "Review large amount", position: { x: 0, y: 1 }, config: { expression: '{{trigger.amount}} >= 50000' } },
        ...edit === "condition" ? [
          { id: "yes", type: "core.wait", name: "Large amount", position: { x: 1, y: 2 }, config: { durationSeconds: 3 } },
          { id: "no", type: "core.wait", name: "Small amount", position: { x: -1, y: 2 }, config: { durationSeconds: 3 } },
        ] : [],
      ], edges: edit === "wait" ? [{ id: "next", source: "start", target: "wait" }] : [
        { id: "next", source: "start", target: "condition" },
        { id: "yes", source: "condition", target: "yes", sourceHandle: "true", label: "true" },
        { id: "no", source: "condition", target: "no", sourceHandle: "false", label: "false" },
      ], variables: [], settings: {} } } }));
    const published = await json(await request.post(`${base}/${created.id}/publish`, { data: { expectedDraftRevisionId: drafted.draftRevisionId, expectedPublishedRevisionId: null, approvalId: null } }));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, user: { ...session.user, id: userId, emailVerified: true }, session: { ...session.session, userId, localImplicit: false } } }));
    await page.route(`**${base}/${created.id}/experience/draft-steps**`, async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: bridgeBase + url.pathname + url.search });
      if (route.request().method() === "POST") { posts++; expect(posts).toBe(1); saved = await json(response); await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    await page.route(`**${base}/${created.id}/experience/requests/draft_edit/**`, async route => {
      expect(route.request().method()).toBe("GET"); receipts++;
      const url = new URL(route.request().url()); expect(url.pathname.endsWith(`/draft_edit/${saved!.requestId}`)).toBe(true);
      await route.fulfill({ response: await route.fetch({ url: bridgeBase + url.pathname + url.search }) });
    });
    await page.goto(`/${company.issuePrefix}/workflows/${created.id}/draft/steps/${edit}`);
    await expect(page.getByRole("heading", { level: 1, name: "Edit a draft step", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Step name", exact: true }).fill("Revised draft step");
    if (edit === "wait") await page.getByRole("spinbutton", { name: "Wait time (seconds)", exact: true }).fill("7");
    else {
      await page.getByRole("spinbutton", { name: "Compare with", exact: true }).fill("");
      await page.getByRole("button", { name: "Save draft changes", exact: true }).click();
      await expect(page.locator('#draft-step-value')).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("alert")).toBeFocused(); expect(posts).toBe(0);
      expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).toBeNull();
      await page.locator('#draft-step-value').fill("10000");
    }
    await page.getByRole("button", { name: "Save draft changes", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(() => saved?.requestId).toBeTruthy();
    await expect(page.getByRole("main")).toContainText("Check the original saved request");
    const current = await json(await request.get(`${base}/${created.id}`));
    expect(current.publishedRevision).toEqual(published.publishedRevision);
    expect(current.draftRevision.graph.nodes[1]).toMatchObject({ name: "Revised draft step", config: edit === "wait" ? { durationSeconds: 7 } : { expression: '{{trigger["amount"]}} >= 10000' } });
    expect(current.draftRevision.graph.edges).toEqual(published.publishedRevision.graph.edges);
    const locator = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"));
    expect(locator).toContain(saved!.requestId); expect(locator).not.toContain("Revised draft step"); expect(locator).not.toContain("amount");
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowBuilderV1: false, enableWorkflowsV1: false, progressive_shell_v9: false } }));
    await page.reload(); await page.getByRole("link", { name: "Check the saved request", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workflow request confirmed", exact: true })).toBeFocused();
    await expect(page.getByRole("main")).toContainText("Your draft change was saved");
    expect(posts).toBe(1); expect(receipts).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).toBeNull();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da"); await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("main")).toContainText("Din kladdeændring blev gemt");
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("guided-draft-recovery-da-mobile.png"), fullPage: true });
  } finally {
    await new Promise<void>((resolve, reject) => bridge.close(err => err ? reject(err) : resolve()));
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {});
    await request.delete(`/api/companies/${company.id}`).catch(() => {});
    await db.delete(authUsers).where(eq(authUsers.id, userId)); await closeRegisteredClients(databaseUrl);
  }
});
