import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { customerFeedbackSchema } from "../../packages/shared/src/index.ts";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// The built page consumes explicit original-session/feedback software fixtures.
// Native membership, operator privilege and durable feedback effects are proved
// separately by the migrated PostgreSQL suites; no hosted user is qualified here.
test("private feedback preserves the original unknown reply through session and source rechecks", async ({ page, request }, info) => {
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable private-history browser fixture" } }));
  let holdSession = false, holdDetail = false;
  const sessions: Array<() => void> = [], details: Array<() => void> = [];
  try {
    const session = await json(await request.get("/api/auth/get-session"));
    const id = "10000000-0000-4000-8000-000000000001";
    let receipt = customerFeedbackSchema.parse({ id, feedbackId: "AWF-10000000000040008000000000000001", companyId: company.id,
      category: "BUG", body: "PRIVATE original customer report", goal: "PRIVATE original customer goal", blocksWork: false,
      omitName: true, status: "NEEDS_INFO", version: 1, createdAt: "2026-10-10T00:00:00.000Z", messages: [] });
    const writes: unknown[] = [];
    let reads = 0;
    await page.route("**/api/auth/get-session", async route => {
      if (holdSession) await new Promise<void>(resolve => sessions.push(resolve));
      await route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } });
    });
    await page.route("**/api/saas/capabilities", route => route.fulfill({ json: {
      profile: "saas", signup: false, emailVerification: false, onboarding: false, billing: false,
      checkout: false, runtime: false, usage: false, support: false, deletion: false, notifications: false,
    } }));
    await page.route(`**/api/companies/${company.id}/customer-feedback**`, async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("expectedUserId")).toBe(session.user.id);
      if (route.request().method() === "POST") {
        expect(url.pathname).toBe(`/api/companies/${company.id}/customer-feedback/${id}/follow-up`);
        const body = route.request().postDataJSON();
        expect(Object.keys(body).sort()).toEqual(["body", "expectedVersion", "idempotencyKey"]);
        expect(body.body).toBe("PRIVATE frozen customer reply");
        expect(body.expectedVersion).toBe(1);
        writes.push(body);
        if (writes.length === 1) {
          receipt = { ...receipt, status: "REVIEWING", version: 2 };
          return route.abort("failed");
        }
        expect(body).toEqual(writes[0]);
        return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: receipt });
      }
      expect(route.request().method()).toBe("GET");
      reads++;
      const isDetail = url.pathname.endsWith(`/${id}`);
      if (isDetail && holdDetail) await new Promise<void>(resolve => details.push(resolve));
      await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: isDetail ? receipt : [receipt] });
    });
    await page.goto(`/${company.issuePrefix}/my-feedback?feedbackId=${id}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "My feedback", exact: true })).toBeFocused();
    const reply = main.getByRole("textbox");
    await expect(reply).toBeVisible();
    await reply.fill("PRIVATE frozen customer reply");
    await main.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect(main.getByRole("alert")).toBeVisible();
    await expect(reply).toBeDisabled();
    expect(writes).toHaveLength(1);
    const previousReads = reads;
    holdSession = true; holdDetail = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => sessions.length).toBeGreaterThan(0);
    await expect(main).not.toContainText("PRIVATE");
    await expect(main.getByRole("textbox")).toHaveCount(0);
    expect(reads).toBe(previousReads); expect(writes).toHaveLength(1);
    holdSession = false; for (const release of sessions.splice(0)) release();
    await expect.poll(() => details.length).toBeGreaterThan(0);
    await expect(main).not.toContainText("PRIVATE");
    expect(writes).toHaveLength(1);
    holdDetail = false; for (const release of details.splice(0)) release();
    await expect(reply).toHaveValue("PRIVATE frozen customer reply");
    await expect(reply).toBeDisabled();
    await main.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    await expect(main.getByRole("textbox")).toHaveCount(0);
    await expect(main).toContainText("PRIVATE original customer report");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await main.evaluate(async scope => (await (window as unknown as {
      axe: { run(scope: Element): Promise<{ violations: unknown[] }> };
    }).axe.run(scope)).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const base = `/api/companies/${company.id}`;
    expect(await json(await request.get(`${base}/agents`))).toEqual([]);
    expect(await json(await request.get(`${base}/issues`))).toEqual([]);
    const runs = await json(await request.get(`${base}/heartbeat-runs`));
    expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
    await page.screenshot({ path: info.outputPath("v9-private-history-mobile.png"), fullPage: true });
  } finally {
    holdSession = false; holdDetail = false;
    for (const release of [...sessions.splice(0), ...details.splice(0)]) release();
    await json(await request.delete(`/api/companies/${company.id}`));
  }
});
