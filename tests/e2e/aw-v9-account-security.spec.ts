import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
registerEnglishAccountLocaleIsolation(test);
import { createRequire } from "node:module";
import { expect, test, type APIResponse, type APIRequestContext, type Page, type Locator } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Privacy checks may withdraw an input between Playwright's focus and its
// separate insertText command. Retry only this local edit after the current
// account frame returns; no deletion, consent or Native request is replayed.
async function enterCurrentField(field: Locator, value: string) {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 10000 });
}
// Actual built security page with explicit personal-account software fixtures.
// No personal account is deleted or live identity/transport acceptance claimed.
async function fixture(page: Page, request: APIRequestContext, company: { id: string; issuePrefix: string }) {
  const session = await json(await request.get("/api/auth/get-session"));
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const state = { holdSession: false, holdPreferences: false, reads: 0, writes: [] as Array<{ path: string; body: Record<string, unknown> | null }>,
    sessions: [] as Array<() => void>, preferences: [] as Array<() => void> };
  await page.route("**/api/auth/get-session", async route => {
    if (state.holdSession) await new Promise<void>(resolve => state.sessions.push(resolve));
    await route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } });
  });
  await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: { ...flags, notification_policy_v9: true } }));
  await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { profile: "saas", signup: false, emailVerification: false,
    onboarding: false, billing: false, checkout: false, runtime: false, usage: false, support: false, deletion: true, notifications: true } }));
  await page.route("**/api/saas/account/**", async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("expectedUserId")).toBe(session.user.id);
    if (route.request().method() !== "GET") {
      state.writes.push({ path: url.pathname, body: route.request().postDataJSON() });
      return route.fulfill({ status: 503, json: { error: "Unknown software-fixture acknowledgement" } });
    }
    state.reads++;
    let body: unknown;
    if (url.pathname.endsWith("/notification-preferences")) {
      if (state.holdPreferences) await new Promise<void>(resolve => state.preferences.push(resolve));
      body = [{ category: "work_update", emailEnabled: true, policy: { version: 1, cadence: "immediate", timezone: "Europe/Copenhagen", quietHours: null, digestMinute: 540 } }];
    } else if (url.pathname.endsWith("/sessions")) {
      body = [{ id: session.session.id, createdAt: "2026-10-10T00:00:00.000Z", expiresAt: "2027-10-10T00:00:00.000Z" }];
    } else {
      expect(url.pathname.endsWith("/deletion-receipts")).toBe(true);
      body = [{ id: "10000000-0000-4000-8000-000000000001", companyId: company.id, status: "processing", stage: "retention", createdAt: "2026-10-10T00:00:00.000Z", completedAt: null }];
    }
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: body });
  });
  await page.goto(`/${company.issuePrefix}/dashboard`); await expect(page.getByRole("main")).toBeVisible();
  await page.goto(`/${company.issuePrefix}/company/settings/security`);
  await expect(page.getByRole("textbox", { name: "Timezone", exact: true })).toHaveValue("Europe/Copenhagen");
  return state;
}
async function noNativeWork(request: APIRequestContext, companyId: string) {
  const base = `/api/companies/${companyId}`;
  expect(await json(await request.get(`${base}/agents`))).toEqual([]);
  expect(await json(await request.get(`${base}/issues`))).toEqual([]);
  const runs = await json(await request.get(`${base}/heartbeat-runs`)); expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
}

test("account security hides private drafts during a session check and waits for fresh policy reads", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable account-security browser fixture" } }));
  try {
    const state = await fixture(page, request, company);
    const main = page.getByRole("main"), heading = main.getByRole("heading", { name: "Account security", exact: true });
    const timezone = main.getByRole("textbox", { name: "Timezone", exact: true });
    const password = main.getByRole("region", { name: "Delete your account", exact: true }).getByLabel("Current password", { exact: true });
    const confirmation = main.getByLabel("Type DELETE MY ACCOUNT", { exact: true });
    await timezone.fill("Europe/Paris"); await password.fill("PRIVATE current account password");
    await confirmation.fill("DELETE MY ACCOUNT");
    const priorReads = state.reads; state.holdSession = true; state.holdPreferences = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => state.sessions.length).toBeGreaterThan(0);
    await expect(main.locator("input")).toHaveCount(0);
    await expect(main).not.toContainText(company.id); await expect(main.getByRole("button", { name: "Revoke session", exact: true })).toHaveCount(0);
    expect(state.reads).toBe(priorReads); expect(state.writes).toEqual([]);
    state.holdSession = false; for (const release of state.sessions.splice(0)) release();
    await expect.poll(() => state.preferences.length).toBeGreaterThan(0);
    await expect(timezone).toHaveCount(0);
    state.holdPreferences = false; for (const release of state.preferences.splice(0)) release();
    await expect(timezone).toHaveValue("Europe/Paris"); await expect(password).toHaveValue("PRIVATE current account password");
    await expect(confirmation).toHaveValue("DELETE MY ACCOUNT");
    await expect(heading).toBeFocused(); expect(state.writes).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await noNativeWork(request, company.id);
    await page.screenshot({ path: info.outputPath("v9-account-security-mobile.png"), fullPage: true });
  } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
});

test("unknown account deletion retains one original request across the actual organization switcher", async ({ page, request }, info) => {
  const first = await json(await request.post("/api/companies", { data: { name: "Disposable account-deletion context A" } }));
  let second: { id: string; issuePrefix: string; name: string } | null = null;
  try {
    second = await json(await request.post("/api/companies", { data: { name: "Disposable account-deletion context B" } }));
    const state = await fixture(page, request, first), main = page.getByRole("main");
    await enterCurrentField(main.getByLabel("Type DELETE MY ACCOUNT", { exact: true }), "DELETE MY ACCOUNT");
    await main.getByRole("region", { name: "Delete your account", exact: true }).getByLabel("Current password", { exact: true }).fill("PRIVATE deletion password");
    await expect(main.getByLabel("Type DELETE MY ACCOUNT", { exact: true })).toHaveValue("DELETE MY ACCOUNT");
    await main.getByRole("checkbox", { name: "I have saved any exports I need.", exact: true }).check();
    await main.getByRole("button", { name: "Delete account", exact: true }).click();
    await expect(main.getByRole("region", { name: "Delete your account", exact: true }).getByRole("alert")).toContainText("Your deletion request is not confirmed");
    expect(state.writes).toHaveLength(1); const original = structuredClone(state.writes[0]);
    // Settings has its own sidebar. Return through the real app navigation to
    // reach the original organization switcher, unmounting the private form.
    await page.getByRole("link", { name: "Back to app", exact: true }).click();
    await page.getByRole("button", { name: `Open ${first.name} organization switcher`, exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(second!.name) }).click();
    await expect(page).toHaveURL(new RegExp(`/${second!.issuePrefix}/dashboard$`));
    await page.goto(`/${second!.issuePrefix}/company/settings/security`);
    await expect(main.getByRole("region", { name: "Delete your account", exact: true }).getByLabel("Current password", { exact: true })).toHaveValue("");
    await expect(main).toContainText("An earlier deletion request is unresolved");
    expect(state.writes).toHaveLength(1);
    await enterCurrentField(main.getByLabel("Type DELETE MY ACCOUNT", { exact: true }), "DELETE MY ACCOUNT");
    await main.getByRole("region", { name: "Delete your account", exact: true }).getByLabel("Current password", { exact: true }).fill("PRIVATE deletion password");
    await expect(main.getByLabel("Type DELETE MY ACCOUNT", { exact: true })).toHaveValue("DELETE MY ACCOUNT");
    await main.getByRole("checkbox", { name: "I have saved any exports I need.", exact: true }).check();
    await main.getByRole("button", { name: "Retry the same deletion request", exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(2); expect(state.writes[1]).toEqual(original);
    expect(original.path).toBe("/api/saas/account/deletion");
    expect(original.body).toMatchObject({ confirmation: "DELETE MY ACCOUNT", password: "PRIVATE deletion password", acknowledgeExport: true, idempotencyKey: expect.any(String) });
    expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes("PRIVATE deletion password")))).toBe(false);
    await noNativeWork(request, first.id); await noNativeWork(request, second!.id);
  } finally {
    for (const company of [second, first]) if (company) {
      try { await json(await request.delete(`/api/companies/${company.id}`)); }
      catch (error) {
        // A timed-out fixture may already have closed its API context. Keep
        // the original browser assertion instead of replacing it with cleanup.
        if (info.status === info.expectedStatus) throw error;
      }
    }
  }
});
