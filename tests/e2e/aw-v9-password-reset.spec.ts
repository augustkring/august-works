import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
// Built UI with explicit synthetic authentication responses. No reset mail is
// sent and no actual account password or hosted authentication is qualified.
for (const locale of ["en", "da"]) test(`public password reset keeps errors private and works with keyboard in ${locale}`, async ({ page }) => {
  await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
  let requests = 0;
  const bodies: Record<string, string>[] = [];
  await page.route("**/api/auth/request-password-reset", async route => {
    requests++; bodies.push(route.request().postDataJSON());
    await route.fulfill(requests === 1 ? { status: 503, json: { error: "PRIVATE-AUTH-TRANSPORT-CANARY" } } : { status: 200, json: { status: true } });
  });
  await page.goto("/saas/reset-password");
  const heading = page.getByRole("heading", { name: locale === "en" ? "Reset password" : "Nulstil adgangskode", exact: true });
  await expect(heading).toBeFocused();
  const email = page.getByRole("textbox", { name: locale === "en" ? "Email" : "E-mail", exact: true });
  await expect(email).toHaveAttribute("autocomplete", "email");
  await email.fill("person@example.test"); await email.press("Enter");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByRole("alert")).not.toContainText("PRIVATE-AUTH-TRANSPORT-CANARY");
  await expect(email).toHaveValue("person@example.test");
  await page.getByRole("button", { name: locale === "en" ? "Send reset link" : "Send link til nulstilling", exact: true }).click();
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.getByRole("status")).toContainText(locale === "en" ? "If this email has an account" : "Hvis der findes en konto");
  expect(requests).toBe(2); expect(bodies[1]).toEqual(bodies[0]);
  await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
  expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a different reset link cannot inherit the old password or its late acknowledgement", async ({ page }) => {
  let release!: () => void; let requests = 0;
  await page.route("**/api/auth/reset-password", async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ token: "first", newPassword: "PRIVATE-FIRST-PASSWORD" });
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 200, json: { status: true } });
  });
  await page.goto("/saas/reset-password?token=first");
  await page.getByLabel("New password", { exact: true }).fill("PRIVATE-FIRST-PASSWORD");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(() => {
    history.pushState(history.state, "", "/saas/reset-password?token=second");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/auth/reset-password");
  release(); await response;
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change password", exact: true })).toBeEnabled();
  expect(requests).toBe(1);
  expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes("PRIVATE-FIRST-PASSWORD")))).toBe(false);
});
