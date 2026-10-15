import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
// This software fixture needs its first failure trace: the suite has no retries.
test.use({ trace: "retain-on-failure" });
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Built UI with explicit software operator-session/expiry/erasure replies.
// The original company and customer case are Native fixtures, but remain
// untouched by software erasure. Migrated Native HTTP/disk tests independently
// qualify the actual operator, policy and erasure owners. No hosted auth proof.
test("erasure uses separate keyboard C3, reads an unknown reply, survives account recheck and recovers its original command after reload", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable erasure UI fixture" } }));
  await json(await request.patch("/api/instance/settings/experimental", { data: { customer_feedback_v9: true, progressive_shell_v9: true, experience_projection_v9: true } }));
  const body = "Owned original feedback text for software erasure UI";
  const feedback = await json(await request.post(`/api/companies/${company.id}/customer-feedback?expectedUserId=local-board`, { data: {
    idempotencyKey: randomUUID(), category: "BUG", body, omitName: true,
    context: { surfaceKey: "home", locale: "en", timezone: "UTC", viewportClass: "wide" },
  } }));
  const nativeSession = await json(await request.get("/api/auth/get-session"));
  const session = { ...nativeSession, session: { ...nativeSession.session, localImplicit: false } };
  const base = `/api/internal/customer-feedback/${company.id}`, erase = `${base}/${feedback.id}/retention-erasures`;
  const pending = { id: randomUUID(), companyId: company.id, feedbackId: feedback.id, target: { kind: "case" },
    status: "pending", requestedAt: new Date().toISOString(), completedAt: null as string | null };
  const summary = { id: feedback.id, feedbackId: feedback.feedbackId, category: feedback.category, body, goal: "",
    version: feedback.version, createdAt: feedback.createdAt, internalState: "RECEIVED" };
  const detail = { ...feedback, internalState: "RECEIVED", context: { surfaceKey: "home", locale: "en", timezone: "UTC",
    viewportClass: "wide", routeTemplate: null, releaseBuildId: "unverified:software-erasure-ui" }, diagnostics: null, events: [], nextEventCursor: null };
  const review = { companyId: company.id, feedbackId: feedback.id, reviewHash: "a".repeat(64), caseVersion: feedback.version,
    retentionVersion: 0, configuration: { closedFeedbackDays: 90, imageDays: 30, openFeedbackMonths: 12 }, held: false,
    caseDueAt: "2026-10-01T00:00:00Z", caseEligible: true, caseCanErase: true, images: [] };
  let command: unknown, writes = 0, statusReads = 0, holdSession = false, releaseSession: (() => void) | undefined;
  await page.route("**/api/auth/get-session", async route => {
    if (holdSession) await new Promise<void>(resolve => { releaseSession = resolve; });
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: session });
  });
  await page.route(`**${base}**`, async route => {
    const req = route.request(), url = new URL(req.url());
    expect(url.searchParams.get("expectedUserId")).toBe("local-board");
    if (url.pathname === erase && req.method() === "POST") {
      const next = req.postDataJSON(); expect(next).toMatchObject({ confirmErasure: true, expectedReviewHash: review.reviewHash, target: { kind: "case" } });
      expect(next.requestKey).toMatch(/^[a-f0-9-]{36}$/); writes++;
      if (writes === 1) { command = next; return route.abort("failed"); }
      expect(writes).toBe(2); expect(next).toEqual(command);
      pending.status = "completed"; pending.completedAt = new Date().toISOString();
      return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: pending });
    }
    if (url.pathname.includes("/retention-erasures/requests/")) {
      expect(command).toBeDefined(); expect(url.pathname).toBe(`${erase}/requests/${(command as { requestKey: string }).requestKey}`); statusReads++;
      return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: pending });
    }
    if (url.pathname === base + "/retention-erasures") return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: command ? [{ receipt: pending, command }] : [] });
    if (url.pathname === erase + "/review") return command ? route.fulfill({ status: 404, json: { error: "Feedback not found" } }) :
      route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: review });
    if (url.pathname === base) return route.fulfill({ json: command ? [] : [summary] });
    if (url.pathname === `${base}/${feedback.id}`) return command ? route.fulfill({ status: 404, json: { error: "Feedback not found" } }) : route.fulfill({ json: detail });
    if (url.pathname.endsWith("/images")) return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: [] });
    if (url.pathname.endsWith("/retention")) return route.fulfill({ json: { companyId: company.id, feedbackId: feedback.id, version: 0,
      legalHold: { active: false, releaseAt: null, reason: "" }, extensionUntil: null, extensionReason: "", updatedAt: null } });
    throw Error(`Unexpected owned software operator request: ${req.method()} ${url.pathname}`);
  });
  async function openQueue() {
    const input = page.getByRole("textbox", { name: "Company ID", exact: true });
    // A session recheck can withdraw the private form between focus and input.
    // Retry only this local edit after the current form returns, never erasure.
    await expect(async () => {
      await input.fill(company.id);
      await expect(input).toHaveValue(company.id);
    }).toPass({ timeout: 10000 });
    const open = page.getByRole("button", { name: "Open queue", exact: true });
    await expect(open).toBeEnabled();
    await open.focus(); await open.press("Enter");
  }
  let journeyCompleted = false;
  try {
    await page.goto("/saas/feedback"); await openQueue();
    const select = page.getByRole("button", { name: `${feedback.feedbackId} · RECEIVED`, exact: true });
    await expect(select).toBeVisible(); await select.focus(); await select.press("Enter");
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    const eraseButton = page.getByRole("button", { name: "Erase expired case", exact: true }); await expect(eraseButton).toBeEnabled();
    await eraseButton.focus(); await eraseButton.press("Enter");
    const confirm = page.getByRole("alertdialog"); await expect(confirm).toBeVisible(); expect(writes).toBe(0);
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('[role="alertdialog"]')).violations)).toEqual([]);
    const approve = confirm.getByRole("button", { name: "Confirm erasure", exact: true }); await approve.focus(); await approve.press("Enter");
    const erasure = page.getByRole("region", { name: "Erase expired feedback", exact: true });
    await expect(erasure).toContainText("Erasure is awaiting confirmation"); await expect(page.getByText(body, { exact: true })).toHaveCount(0);
    expect(writes).toBe(1); const count = statusReads;
    const check = erasure.getByRole("button", { name: "Check erasure status", exact: true }); await check.focus(); await check.press("Enter");
    await expect.poll(() => statusReads).toBeGreaterThan(count); expect(writes).toBe(1);
    await page.clock.setFixedTime(new Date(Date.now() + 31000)); holdSession = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => releaseSession !== undefined).toBe(true); await expect(erasure).not.toContainText("Erasure is awaiting confirmation");
    holdSession = false; releaseSession!(); await expect(erasure).toContainText("Erasure is awaiting confirmation"); expect(writes).toBe(1);
    await page.reload(); await openQueue();
    const history = page.getByRole("button", { name: "Erasure history", exact: true }); await expect(history).toBeVisible(); await history.focus(); await history.press("Enter");
    const original = page.getByRole("button", { name: `Case · Awaiting confirmation · ${pending.requestedAt}`, exact: true }); await original.focus(); await original.press("Enter");
    await expect(erasure).toContainText("Erasure is awaiting confirmation"); expect(writes).toBe(1);
    const resume = erasure.getByRole("button", { name: "Review the same erasure again", exact: true }); await expect(resume).toBeEnabled(); await resume.focus(); await resume.press("Enter");
    const again = page.getByRole("alertdialog").getByRole("button", { name: "Confirm erasure", exact: true }); await again.focus(); await again.press("Enter");
    await expect(erasure).toContainText("Erasure confirmed"); expect(writes).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-erasure-history-mobile.png"), fullPage: true });
    const native = await json(await request.get(`/api/companies/${company.id}/customer-feedback/${feedback.id}?expectedUserId=local-board`));
    expect(native.body).toBe(body); // Software replies did not erase the Native fixture.
    journeyCompleted = true;
  } finally {
    holdSession = false; releaseSession?.();
    try {
      await json(await request.patch("/api/instance/settings/experimental", { data: flags }));
      await json(await request.delete(`/api/companies/${company.id}`));
    } catch (error) {
      // Playwright closes this request context after a test deadline. Keep
      // the original action/assertion failure instead of replacing it with
      // an unrelated cleanup failure. Successful journeys still require cleanup.
      if (journeyCompleted) throw error;
      info.annotations.push({ type: "cleanup", description: "The failed journey could not finish disposal of its isolated software fixture." });
    }
  }
});
