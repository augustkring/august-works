import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Exercise the built inbox with explicit session/list software fixtures. Real
// recipient authority and delivery belong to the migrated PostgreSQL suites.
test("private notification updates wait for the current account and a fresh original list", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable notification-account browser fixture" } }));
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const notification = { id: "10000000-0000-4000-8000-000000000001", companyId: company.id,
      category: "work_update", title: "PRIVATE current account update", relativePath: `/${company.issuePrefix}/issues`,
      createdAt: "2026-10-10T00:00:00.000Z", readAt: null };
    let holdSession = false, holdList = false, reads = 0, writes = 0;
    const sessions: Array<() => void> = [], lists: Array<() => void> = [];
    await page.route("**/api/auth/get-session", async (route) => {
      if (holdSession) await new Promise<void>((resolve) => sessions.push(resolve));
      await route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } });
    });
    await page.route("**/api/saas/capabilities", (route) => route.fulfill({ json: {
      profile: "saas", signup: false, emailVerification: false, onboarding: false, billing: false,
      checkout: false, runtime: false, usage: false, support: false, deletion: false, notifications: true,
    } }));
    await page.route(`**/api/companies/${company.id}/notifications/**`, async (route) => {
      expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() !== "GET") { writes++; return route.fulfill({ status: 409, json: { error: "No fixture write is qualified" } }); }
      expect(new URL(route.request().url()).pathname.endsWith("/notifications/page")).toBe(true);
      reads++;
      if (holdList) await new Promise<void>((resolve) => lists.push(resolve));
      await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { items: [notification], nextCursor: null } });
    });
    await page.goto(`/${company.issuePrefix}/dashboard`);
    // This is a functional admission check under concurrent workspace tests.
    // Device/journey performance budgets need their own controlled measurement.
    await expect(page.getByRole("main")).toBeVisible({ timeout: 15000 });
    await page.goto(`/${company.issuePrefix}/inbox`);
    const updates = page.getByRole("region", { name: "Account and runtime updates", exact: true });
    await expect(updates.getByRole("link", { name: notification.title })).toBeVisible();
    const priorReads = reads;
    holdSession = true; holdList = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => sessions.length).toBeGreaterThan(0);
    await expect(updates).not.toContainText("PRIVATE");
    await expect(updates.getByRole("button", { name: "Mark read", exact: true })).toHaveCount(0);
    expect(reads).toBe(priorReads); expect(writes).toBe(0);
    holdSession = false; for (const release of sessions.splice(0)) release();
    await expect.poll(() => lists.length).toBeGreaterThan(0);
    await expect(updates).not.toContainText("PRIVATE");
    holdList = false; for (const release of lists.splice(0)) release();
    await expect(updates.getByRole("link", { name: notification.title })).toBeVisible();
    expect(reads).toBeGreaterThan(priorReads); expect(writes).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await updates.evaluate(async (region) => (await (window as unknown as {
      axe: { run(scope: Element): Promise<{ violations: unknown[] }> };
    }).axe.run(region)).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const base = `/api/companies/${company.id}`;
    expect(await json(await request.get(`${base}/agents`))).toEqual([]);
    expect(await json(await request.get(`${base}/issues`))).toEqual([]);
    const runs = await json(await request.get(`${base}/heartbeat-runs`));
    expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
    await page.screenshot({ path: info.outputPath("v9-notification-account-mobile.png"), fullPage: true });
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});
