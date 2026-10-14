import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { agents, authUsers, companyMemberships, createDb, closeRegisteredClients, principalPermissionGrants, issues, workflowRuns, heartbeatRuns, toolApplications, toolConnections, toolCatalogEntries, toolInvocations, toolActionRequests } from "../../packages/db/src/index.ts";
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

test("guided empty Native flow composes explicit steps and recovers its exact lost approval draft save", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(path.basename(path.dirname(path.dirname(path.dirname(configPath))))).toMatch(/^paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8")), pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const flags = await json(await request.get("/api/instance/settings/experimental")), session = await json(await request.get("/api/auth/get-session"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable Native flow fixture" } })), userId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Flow editor fixture", email: `${createHash("sha256").update(userId).digest("hex")}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({ companyId: company.id, principalType: "user", principalId: userId, permissionKey })));
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId }; next(); }); app.use("/api", workflowRoutes(db)); app.use(errorHandler);
  const bridge = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => bridge.once("listening", resolve));
  const address = bridge.address(); if (!address || typeof address === "string") throw new Error("Controlled fixture listener unavailable"); const bridgeBase = `http://127.0.0.1:${address.port}`;
  let posts = 0, receipts = 0, lost: { requestId: string } | null = null;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true } }));
    const base = `/api/companies/${company.id}/workflows`, created = await json(await request.post(base, { data: { name: "Empty described intent fixture" } }));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, user: { ...session.user, id: userId, emailVerified: true }, session: { ...session.session, userId, localImplicit: false } } }));
    await page.route(`**${base}/${created.id}/experience/draft-flow**`, async route => {
      const url = new URL(route.request().url()), response = await route.fetch({ url: bridgeBase + url.pathname + url.search });
      if (route.request().method() === "POST") { posts++; expect(posts).toBeLessThanOrEqual(3); if (posts === 3) { lost = await json(response); await route.abort("failed"); return; } }
      await route.fulfill({ response });
    });
    await page.route(`**${base}/${created.id}/experience/requests/draft_build/**`, async route => {
      expect(route.request().method()).toBe("GET"); receipts++; const url = new URL(route.request().url()); expect(url.pathname.endsWith(`/draft_build/${lost!.requestId}`)).toBe(true);
      await route.fulfill({ response: await route.fetch({ url: bridgeBase + url.pathname + url.search }) });
    });
    await page.goto(`/${company.issuePrefix}/workflows/${created.id}/draft`);
    await expect(page.getByRole("heading", { level: 1, name: "Build the draft flow", exact: true })).toBeVisible();
    await page.getByRole("spinbutton", { name: "Maximum run time (seconds)", exact: true }).fill("30");
    await page.getByRole("button", { name: "Add a manual start", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Start when I run the workflow", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Step name", exact: true }).fill("Wait for evidence");
    await page.getByRole("spinbutton", { name: "Wait time (seconds)", exact: true }).fill("3");
    await page.getByRole("button", { name: "Add a step", exact: true }).click();
    await expect(page.getByRole("link", { name: "Wait for evidence", exact: true })).toBeVisible();
    const waiting = await json(await request.get(`${base}/${created.id}`));
    const published = await json(await request.post(`${base}/${created.id}/publish`, { data: { expectedDraftRevisionId: waiting.draftRevisionId, expectedPublishedRevisionId: null, approvalId: null } }));
    // Publishing changes the current Native draft identity. Reload before the
    // explicit third command rather than pretending the stale review is current.
    await page.reload(); await expect(page.getByRole("link", { name: "Wait for evidence", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da"); await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("combobox", { name: "Hvad skal ske som det næste?", exact: true }).selectOption("append_approval");
    await page.getByRole("textbox", { name: "Trinnets navn", exact: true }).fill("Gennemgå resultatet");
    await page.getByRole("textbox", { name: "Hvad skal godkendes?", exact: true }).fill("PRIVATE gennemgå fakta");
    await page.getByRole("textbox", { name: "Hvad sker der, hvis det godkendes?", exact: true }).fill("PRIVATE fortsæt til næste trin");
    await page.addScriptTag({ path: axePath }); expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("guided-flow-approval-da-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Tilføj et trin", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(() => lost?.requestId).toBeTruthy(); await expect(page.getByRole("main")).toContainText("oprindelige gemte anmodning");
    const current = await json(await request.get(`${base}/${created.id}`)); expect(current.publishedRevision).toEqual(published.publishedRevision);
    expect(current.draftRevision.graph.nodes).toHaveLength(3); expect(current.draftRevision.graph.nodes[2]).toMatchObject({ type: "human.approval", config: { summary: "PRIVATE gennemgå fakta", consequence: "PRIVATE fortsæt til næste trin" } });
    const locator = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")); expect(locator).toContain(lost!.requestId); expect(locator).not.toContain("PRIVATE");
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowBuilderV1: false, enableWorkflowsV1: false, progressive_shell_v9: false } }));
    await page.reload(); await page.getByRole("link", { name: "Kontrollér den gemte anmodning", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workflowanmodning bekræftet", exact: true })).toBeFocused();
    await expect(page.getByRole("main")).toContainText("Din ændring af kladdeflowet blev gemt"); expect(posts).toBe(3); expect(receipts).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) => bridge.close(err => err ? reject(err) : resolve()));
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {}); await request.delete(`/api/companies/${company.id}`).catch(() => {});
    await db.delete(authUsers).where(eq(authUsers.id, userId)); await closeRegisteredClients(databaseUrl);
  }
});

test("guided Native flow appends a named Agent task and recovers its only lost save without starting work", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(path.basename(path.dirname(path.dirname(path.dirname(configPath))))).toMatch(/^paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8")), pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const flags = await json(await request.get("/api/instance/settings/experimental")), session = await json(await request.get("/api/auth/get-session"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable guided Agent task" } })), userId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Task editor fixture", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({ companyId: company.id, principalType: "user", principalId: userId, permissionKey })));
  const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Readable task Agent", adapterType: "process" }).returning();
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId }; next(); }); app.use("/api", workflowRoutes(db)); app.use(errorHandler);
  const bridge = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => bridge.once("listening", resolve));
  const address = bridge.address(); if (!address || typeof address === "string") throw new Error("Controlled fixture listener unavailable"); const bridgeBase = `http://127.0.0.1:${address.port}`;
  let posts = 0, receipts = 0, lost: { requestId: string } | null = null;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true } }));
    const base = `/api/companies/${company.id}/workflows`, created = await json(await request.post(base, { data: { name: "Guided task fixture" } }));
    const prepared = await json(await request.patch(`${base}/${created.id}/draft`, { data: { expectedRevisionId: created.draftRevisionId, graph: {
      version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: { totalDeadlineSeconds: 30 },
    } } }));
    const published = await json(await request.post(`${base}/${created.id}/publish`, { data: { expectedDraftRevisionId: prepared.draftRevisionId, expectedPublishedRevisionId: null, approvalId: null } }));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, user: { ...session.user, id: userId, emailVerified: true }, session: { ...session.session, userId, localImplicit: false } } }));
    await page.route(`**${base}/${created.id}/experience/draft-flow**`, async route => {
      const url = new URL(route.request().url()), response = await route.fetch({ url: bridgeBase + url.pathname + url.search });
      if (route.request().method() === "POST") { posts++; expect(posts).toBe(1); lost = await json(response); await route.abort("failed"); return; }
      await route.fulfill({ response });
    });
    await page.route(`**${base}/${created.id}/experience/requests/draft_build/**`, async route => {
      expect(route.request().method()).toBe("GET"); receipts++; const url = new URL(route.request().url());
      expect(url.pathname.endsWith(`/draft_build/${lost!.requestId}`)).toBe(true);
      await route.fulfill({ response: await route.fetch({ url: bridgeBase + url.pathname + url.search }) });
    });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/${company.issuePrefix}/workflows/${created.id}/draft`);
    await expect(page.getByRole("heading", { name: "Build the draft flow", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await page.getByRole("combobox", { name: "Hvad skal ske som det næste?", exact: true }).selectOption("append_agent_task");
    await page.getByRole("textbox", { name: "Trinnets navn", exact: true }).fill("PRIVATE Agent-opgave");
    await page.getByRole("textbox", { name: "Hvad skal Agenten gøre?", exact: true }).fill("PRIVATE opgavebeskrivelse");
    await page.getByRole("combobox", { name: "Agent til dette trin", exact: true }).selectOption({ label: "Readable task Agent" });
    await expect(page.getByRole("main")).toContainText("den interne test af ventetrin og betingelser kan ikke køre dem");
    await page.addScriptTag({ path: axePath }); expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("guided-agent-task-da-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Tilføj et trin", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(() => lost?.requestId).toBeTruthy();
    const current = await json(await request.get(`${base}/${created.id}`)); expect(current.publishedRevision).toEqual(published.publishedRevision);
    expect(current.draftRevision.graph.nodes).toHaveLength(2); expect(current.draftRevision.graph.nodes[1]).toMatchObject({ type: "agent.task", name: "PRIVATE Agent-opgave", config: { agentId: agent.id, objective: "PRIVATE opgavebeskrivelse", waitForCompletion: true } });
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, company.id))).toEqual([]);
    expect(await db.select().from(issues).where(eq(issues.companyId, company.id))).toEqual([]);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, company.id))).toEqual([]);
    const locator = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")); expect(locator).toContain(lost!.requestId); expect(locator).not.toMatch(/PRIVATE|Readable task Agent|agentId|objective/);
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowBuilderV1: false, enableWorkflowsV1: false, progressive_shell_v9: false } }));
    await page.reload(); await page.getByRole("link", { name: "Kontrollér den gemte anmodning", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Workflowanmodning bekræftet", exact: true })).toBeFocused();
    expect(posts).toBe(1); expect(receipts).toBeGreaterThanOrEqual(1); expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) => bridge.close(err => err ? reject(err) : resolve()));
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {}); await request.delete(`/api/companies/${company.id}`).catch(() => {});
    await db.delete(authUsers).where(eq(authUsers.id, userId)); await closeRegisteredClients(databaseUrl);
  }
});

test("guided Native flow appends a scalar connected operation and recovers its only lost save without starting work", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(path.basename(path.dirname(path.dirname(path.dirname(configPath))))).toMatch(/^paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8")), pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`, db = createDb(databaseUrl);
  const flags = await json(await request.get("/api/instance/settings/experimental")), session = await json(await request.get("/api/auth/get-session"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable guided connected operation" } })), userId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Operation editor fixture", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey => ({ companyId: company.id, principalType: "user", principalId: userId, permissionKey })));
  const [application] = await db.insert(toolApplications).values({ companyId: company.id, name: "Contacts", type: "mcp_http" }).returning();
  const [connection] = await db.insert(toolConnections).values({ companyId: company.id, applicationId: application.id, name: "Contact system", uid: randomUUID(), transport: "mcp_remote", status: "active", enabled: true, config: { privateToken: "PRIVATE connection credential" } }).returning();
  const [entry] = await db.insert(toolCatalogEntries).values({ companyId: company.id, applicationId: application.id, connectionId: connection.id, name: "contacts.find", toolName: "contacts.find", title: "Find contacts", versionHash: "v1", schemaHash: "s1", inputSchema: { type: "object", properties: { query: { type: "string", title: "Søgetekst", minLength: 1 }, count: { type: "integer", title: "Antal", minimum: 1, maximum: 10 }, includeInactive: { type: "boolean", title: "Medtag inaktive" } }, required: ["query"], additionalProperties: false } }).returning();
  const app = express(); app.use(express.json()); app.use(async (req, _res, next) => {
    try {
      const memberships = await db.select().from(companyMemberships).where(eq(companyMemberships.principalId, userId));
      req.actor = { type: "board", source: "session", userId, isInstanceAdmin: false,
        companyIds: memberships.filter(item => item.principalType === "user" && item.status === "active").map(item => item.companyId) };
      next();
    } catch (error) { next(error); }
  }); app.use("/api", workflowRoutes(db)); app.use(errorHandler);
  const bridge = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => bridge.once("listening", resolve));
  const address = bridge.address(); if (!address || typeof address === "string") throw new Error("Controlled fixture listener unavailable"); const bridgeBase = `http://127.0.0.1:${address.port}`;
  let posts = 0, receipts = 0, lost: { requestId: string } | null = null;
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowsV1: true, enableWorkflowBuilderV1: true, experience_projection_v9: true, progressive_shell_v9: true } }));
    const base = `/api/companies/${company.id}/workflows`, created = await json(await request.post(base, { data: { name: "Guided task fixture" } }));
    const prepared = await json(await request.patch(`${base}/${created.id}/draft`, { data: { expectedRevisionId: created.draftRevisionId, graph: {
      version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: { totalDeadlineSeconds: 30 },
    } } }));
    const published = await json(await request.post(`${base}/${created.id}/publish`, { data: { expectedDraftRevisionId: prepared.draftRevisionId, expectedPublishedRevisionId: null, approvalId: null } }));
    await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, user: { ...session.user, id: userId, emailVerified: true }, session: { ...session.session, userId, localImplicit: false } } }));
    await page.route(`**${base}/${created.id}/experience/draft-flow**`, async route => {
      const url = new URL(route.request().url()), response = await route.fetch({ url: bridgeBase + url.pathname + url.search });
      if (route.request().method() === "POST") { posts++; expect(posts).toBe(1); lost = await json(response); await route.abort("failed"); return; }
      await route.fulfill({ response });
    });
    await page.route(url => url.pathname === `${base}/${created.id}/experience`, async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: bridgeBase + url.pathname + url.search });
      expect(response.ok(), `Native current review ${response.status()}: ${await response.text()}`).toBe(true);
      await route.fulfill({ response });
    });
    await page.route(`**${base}/${created.id}/experience/requests/draft_build/**`, async route => {
      expect(route.request().method()).toBe("GET"); receipts++; const url = new URL(route.request().url());
      expect(url.pathname.endsWith(`/draft_build/${lost!.requestId}`)).toBe(true);
      await route.fulfill({ response: await route.fetch({ url: bridgeBase + url.pathname + url.search }) });
    });
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/${company.issuePrefix}/workflows/${created.id}/draft`);
    await expect(page.getByRole("heading", { name: "Build the draft flow", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await page.getByRole("combobox", { name: "Hvad skal ske som det næste?", exact: true }).selectOption("append_tool");
    await page.getByRole("textbox", { name: "Trinnets navn", exact: true }).fill("PRIVATE kontakttrin");
    await page.getByRole("combobox", { name: "Forbindelse og operation", exact: true }).selectOption(entry.id);
    await expect(page.getByRole("spinbutton", { name: "Antal", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Søgetekst", exact: true }).fill(" PRIVATE forespørgsel ");
    await page.getByRole("checkbox", { name: "Medtag Medtag inaktive", exact: true }).check();
    await page.getByRole("combobox", { name: "Medtag inaktive", exact: true }).selectOption("false");
    await expect(page.getByRole("main")).toContainText("den interne test af ventetrin og betingelser kan ikke køre dem");
    await page.addScriptTag({ path: axePath }); expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("guided-connected-tool-da-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Tilføj et trin", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect.poll(() => lost?.requestId).toBeTruthy();
    const current = await json(await request.get(`${base}/${created.id}`)); expect(current.publishedRevision).toEqual(published.publishedRevision);
    expect(current.draftRevision.graph.nodes).toHaveLength(2); expect(current.draftRevision.graph.nodes[1]).toMatchObject({ type: "connector.action", name: "PRIVATE kontakttrin", config: { toolCatalogEntryId: entry.id, connectionId: connection.id, catalogVersionHash: "v1", catalogSchemaHash: "s1", projectedInputSchemaHash: expect.stringMatching(/^[a-f0-9]{64}$/), input: { query: " PRIVATE forespørgsel ", includeInactive: false } } });
    expect(await db.select().from(toolInvocations).where(eq(toolInvocations.companyId, company.id))).toEqual([]);
    expect(await db.select().from(toolActionRequests).where(eq(toolActionRequests.companyId, company.id))).toEqual([]);
    expect(await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, company.id))).toEqual([]);
    expect(await db.select().from(issues).where(eq(issues.companyId, company.id))).toEqual([]);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, company.id))).toEqual([]);
    const locator = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")); expect(locator).toContain(lost!.requestId); expect(locator).not.toMatch(/PRIVATE|contacts|query|includeInactive|connectionId/);
    const nativeReview = await json(await request.get(`${bridgeBase}${base}/${created.id}/experience?expectedUserId=${userId}`));
    expect(nativeReview.draft.steps[1].inputReview).toMatchObject({ kind: "connected_tool", values: { query: " PRIVATE forespørgsel ", includeInactive: false } });
    await page.goto(`/${company.issuePrefix}/workflows/${created.id}?revision=draft`);
    await expect(page.getByRole("main")).toContainText('" PRIVATE forespørgsel "');
    await expect(page.getByRole("main")).toContainText("Input til operationen");
    await expect(page.getByRole("main")).toContainText("Ikke medtaget");
    await page.addScriptTag({ path: axePath }); expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("guided-connected-input-review-da-mobile.png"), fullPage: true });
    await db.update(toolConnections).set({ status: "draft" }).where(eq(toolConnections.id, connection.id));
    await page.reload(); await expect(page.getByRole("main")).toContainText("PRIVATE kontakttrin");
    await expect(page.getByRole("main")).not.toContainText("PRIVATE forespørgsel");
    await page.goto(`/${company.issuePrefix}/workflows/${created.id}/draft`);
    await json(await request.patch("/api/instance/settings/experimental", { data: { enableWorkflowBuilderV1: false, enableWorkflowsV1: false, progressive_shell_v9: false } }));
    await page.reload(); await page.getByRole("link", { name: "Kontrollér den gemte anmodning", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Workflowanmodning bekræftet", exact: true })).toBeFocused();
    expect(posts).toBe(1); expect(receipts).toBeGreaterThanOrEqual(1); expect(await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-workflow-request-receipts"))).toBeNull();
  } finally {
    await new Promise<void>((resolve, reject) => bridge.close(err => err ? reject(err) : resolve()));
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {}); await request.delete(`/api/companies/${company.id}`).catch(() => {});
    await db.delete(authUsers).where(eq(authUsers.id, userId)); await closeRegisteredClients(databaseUrl);
  }
});
