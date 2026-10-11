import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Built UI with explicitly controlled account/measure software responses.
// Native current-owner/verification authority is exercised separately in the
// unfiltered original PostgreSQL activation/package suites. This is not a
// hosted authentication, human UX, TTFO baseline or live outcome qualification.
test("activation measures localize, withdraw old values and distinguish unavailable TTFO", async ({ page, request }, info) => {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable activation measure UI fixture" } }));
  const principal = "software-measure-owner";
  let status = "verified", reads = 0;
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: {
    session: { id: "software-measure-session", userId: principal, localImplicit: false },
    user: { id: principal, email: "software-measure@example.test", name: "Measure UI fixture", image: null }, sentryDsn: null,
  } }));
  await page.route("**/experience/analytics?**", route => {
    reads++; expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(principal);
    return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { companyId: company.id,
      observedAt: "2026-10-11T00:00:05Z", contractId: "aw.activation-owner-measures.v1", status,
      creationToVerificationBucket: status === "verified" ? "one_to_five_minutes" : null,
      recordedSetupChangesBucket: status === "verified" ? "two_to_five" : null,
      setupWindow: status === "verified" ? "complete" : "not_applicable", usableBaseline: "unavailable" } });
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: true, progressive_shell_v9: true, experience_analytics_v9: true,
    } }));
    await page.goto(`/${company.issuePrefix}/company/measures`);
    const heading = page.getByRole("heading", { level: 1, name: "Activation measures", exact: true });
    await expect(heading).toBeVisible(); await expect(heading).toBeFocused();
    await expect(page.getByText("One to under five minutes", { exact: true })).toBeVisible();
    await expect(page.getByText("Unavailable: the usable-account start point", { exact: false })).toBeVisible();
    const beforeLanguage = reads;
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByRole("heading", { level: 1, name: "Aktiveringsmålinger", exact: true })).toBeVisible();
    await expect(page.getByText("To til fem registrerede overgange", { exact: true })).toBeVisible();
    expect(reads).toBe(beforeLanguage);
    await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
    const back = page.getByRole("link", { name: "Return to activation", exact: true });
    await expect(back).toHaveAttribute("href", "/saas/activation"); await back.focus(); await expect(back).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-activation-measures-mobile.png"), fullPage: true });
    status = "withdrawn"; await page.reload();
    await expect(page.getByText("The original result is no longer currently verified.", { exact: false })).toBeVisible();
    await expect(page.getByText("One to under five minutes", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Two to five recorded transitions", { exact: true })).toHaveCount(0);
    await json(await request.patch("/api/instance/settings/experimental", { data: { experience_analytics_v9: false } }));
    await page.reload(); await expect(heading).toHaveCount(0);
  } finally { await json(await request.patch("/api/instance/settings/experimental", { data: original })); }
});
