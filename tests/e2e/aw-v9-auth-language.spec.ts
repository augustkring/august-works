import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Actual built auth page with explicit signed-out/capability/refusal software
// answers. No hosted identity, outbound verification email or SSO is qualified.
test("account entry changes language without sending credentials and keeps a refused form accessible", async ({ page, request }, info) => {
  const companiesBefore = await json(await request.get("/api/companies"));
  const commands: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: null }));
  await page.route("**/api/saas/capabilities", route => route.fulfill({ json: { profile: "saas", signup: true,
    emailVerification: true, enterpriseSso: false, onboarding: true, billing: false, checkout: false,
    runtime: false, usage: false, support: false, deletion: false, notifications: false } }));
  await page.route("**/api/auth/sign-*/email", route => {
    commands.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ status: 401, json: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" } });
  });
  await page.goto("/auth");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to August Works", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with company SSO", exact: true })).toHaveCount(0);
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await email.fill("software-account-fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("private-software-fixture");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
  await expect(page.locator("html")).toHaveAttribute("lang", "da");
  await expect(page.getByRole("heading", { level: 1, name: "Log ind på August Works", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toHaveValue("software-account-fixture@example.test");
  await expect(page.getByLabel("Adgangskode", { exact: true })).toHaveValue("private-software-fixture");
  expect(commands).toHaveLength(0);
  await page.getByRole("button", { name: "Log ind", exact: true }).click();
  const summary = page.getByRole("alert");await expect(summary).toHaveText("Ugyldig e-mail eller adgangskode");
  await expect(summary).toBeFocused();
  await expect(page.getByRole("textbox", { name: "E-mail", exact: true })).toHaveAttribute("aria-describedby", "auth-error");
  expect(commands).toHaveLength(1);expect(commands[0]!.path).toBe("/api/auth/sign-in/email");
  expect(commands[0]!.body).toEqual({ email: "software-account-fixture@example.test", password: "private-software-fixture" });
  await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
  await expect(summary).toHaveText("Invalid email or password");
  await expect(email).toHaveValue("software-account-fixture@example.test");
  await page.getByRole("button", { name: "Create one", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create your account", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });await page.addScriptTag({ path: axePath });
  expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(commands).toHaveLength(1);
  expect(await json(await request.get("/api/companies"))).toEqual(companiesBefore);
  await page.screenshot({ path: info.outputPath("v9-auth-language-mobile.png"), fullPage: true });
});
