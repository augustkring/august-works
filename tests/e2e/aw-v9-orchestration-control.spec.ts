import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Built routing/cache/storage/keyboard/locale are actual. Verified session and
// Original owner responses are controlled fixtures; migrated PostgreSQL tests
// separately exercise actual CAS, outbox, replay and current-role rollback.
test("work Stop recovers one Original request after lost response and rollout withdrawal", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable work-control browser fixture" } }));
  const session = await json(await request.get("/api/auth/get-session")), plan = "10000000-0000-4000-8000-000000000002", task = "10000000-0000-4000-8000-000000000003";
  const base = `/api/companies/${company.id}/experience/orchestration/${plan}`;
  let posts = 0, reads = 0, saved: Record<string, unknown> | null = null, stopped = false;
  let holdSession = false, holdControl = false;
  const sessions: Array<() => void> = [], controls: Array<() => void> = [];
  await page.route("**/api/auth/get-session", async route => {
    if (holdSession) await new Promise<void>(resolve => sessions.push(resolve));
    await route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } });
  });
  await page.route(`**${base}/control?**`, async route => {
    expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
    if (route.request().method() === "POST") {
      posts++; expect(posts).toBe(1); const input = route.request().postDataJSON();
      expect(input).toMatchObject({ expectedVersion: 1, action: "cancel", rationale: "PRIVATE reviewed work-control rationale", acknowledgeCompletedEffectsRemain: true });
      saved = { companyId: company.id, planId: plan, requestId: input.requestId, action: "cancel", resultingVersion: 2,
        disposition: "control_requested", propagation: "pending_verification" };
      stopped = true; await route.abort("failed"); return;
    }
    expect(route.request().method()).toBe("GET");
    if (holdControl) await new Promise<void>(resolve => controls.push(resolve));
    await route.fulfill({ headers: { "Cache-Control": "no-store" }, json: { companyId: company.id, planId: plan, taskId: task,
      version: stopped ? 2 : 1, status: stopped ? "cancelled" : "draft", canPause: !stopped, canStop: !stopped } });
  });
  await page.route(`**${base}/control-requests/**`, async route => {
    expect(route.request().method()).toBe("GET"); reads++;
    expect(saved).not.toBeNull(); expect(new URL(route.request().url()).pathname).toContain(String(saved!.requestId));
    if (reads === 1) return route.fulfill({ status: 404, json: { error: "Private original request unavailable" } });
    await route.fulfill({ headers: { "Cache-Control": "no-store" }, json: saved });
  });
  try {
    await page.goto(`/${company.issuePrefix}/orchestration/${plan}/control`);
    await expect(page.getByRole("heading", { level: 1, name: "Pause or stop work", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reason", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Reason", exact: true }).fill("PRIVATE reviewed work-control rationale");
    await page.getByRole("checkbox").check();
    holdSession = true; holdControl = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => sessions.length).toBeGreaterThan(0);
    await expect(page.getByRole("textbox", { name: "Reason", exact: true })).toHaveCount(0);
    holdSession = false; for (const release of sessions.splice(0)) release();
    await expect.poll(() => controls.length).toBeGreaterThan(0);
    await expect(page.getByRole("textbox", { name: "Reason", exact: true })).toHaveCount(0);
    holdControl = false; for (const release of controls.splice(0)) release();
    await expect(page.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue("PRIVATE reviewed work-control rationale");
    await expect(page.getByRole("checkbox")).toBeChecked();
    await expect(page.getByRole("button", { name: "Request Stop", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Request Stop", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toContainText("This request is unconfirmed");
    expect(posts).toBe(1); expect(reads).toBe(0);
    const locator = await page.evaluate(() => sessionStorage.getItem("aw.v9.pending-orchestration-control-receipts"));
    expect(locator).toContain(String(saved!.requestId)); expect(locator).not.toMatch(/PRIVATE|rationale|cancel/);
    await json(await request.patch("/api/instance/settings/experimental", { data: { progressive_shell_v9: false, orchestration_v7: false, supervision_v7: false } }));
    await page.reload(); await expect(page.getByRole("button", { name: "Check original request", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Reason", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Check original request", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("does not prove that no request was saved");
    await page.getByRole("button", { name: "Check original request", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Control request recorded", exact: true })).toBeFocused();
    await expect(page.getByRole("main")).toContainText("does not prove that every running worker has stopped");
    expect(posts).toBe(1); expect(reads).toBe(2);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByRole("heading", { level: 1, name: "Kontrolanmodning registreret", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    await expect(page.getByRole("navigation", { name: "Mobilnavigation", exact: true }).getByRole("link", { name: "Opgaver", exact: true })).toBeVisible();
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("work-control-original-receipt-da-mobile.png"), fullPage: true });
  } finally {
    holdSession = false; holdControl = false;
    for (const release of sessions.splice(0)) release();
    for (const release of controls.splice(0)) release();
    await request.patch("/api/instance/settings/experimental", { data: flags }).catch(() => {});
    await request.delete(`/api/companies/${company.id}`).catch(() => {});
  }
});
