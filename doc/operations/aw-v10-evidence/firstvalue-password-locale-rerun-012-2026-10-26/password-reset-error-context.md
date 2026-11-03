# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: aw-v9-password-reset.spec.ts >> a different reset link cannot inherit the old password or its late acknowledgement
- Location: tests/e2e/aw-v9-password-reset.spec.ts:35:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.fill: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByLabel('New password', { exact: true })

```

# Page snapshot

```yaml
- main [ref=e4]:
  - generic [ref=e5]:
    - heading "Set a new password" [active] [level=1] [ref=e6]
    - generic [ref=e8]:
      - generic [ref=e9]: Language
      - combobox "Language" [ref=e10]:
        - option "English" [selected]
        - option "Dansk"
  - generic [ref=e11]:
    - generic [ref=e12]:
      - text: New password
      - textbox "New password Use 15–128 characters. Spaces are allowed." [ref=e13]
      - generic [ref=e14]: Use 15–128 characters. Spaces are allowed.
    - generic [ref=e15]:
      - link "Back to sign in" [ref=e16] [cursor=pointer]:
        - /url: /auth
      - button "Change password" [ref=e17]
```

# Test source

```ts
  1  | import { createRequire } from "node:module";
  2  | import { expect, test } from "@playwright/test";
  3  | import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
  4  | 
  5  | registerEnglishAccountLocaleIsolation(test);
  6  | const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
  7  | // Built UI with explicit synthetic authentication responses. No reset mail is
  8  | // sent and no actual account password or hosted authentication is qualified.
  9  | for (const locale of ["en", "da"]) test(`public password reset keeps errors private and works with keyboard in ${locale}`, async ({ page }) => {
  10 |   await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
  11 |   let requests = 0;
  12 |   const bodies: Record<string, string>[] = [];
  13 |   await page.route("**/api/auth/request-password-reset", async route => {
  14 |     requests++; bodies.push(route.request().postDataJSON());
  15 |     await route.fulfill(requests === 1 ? { status: 503, json: { error: "PRIVATE-AUTH-TRANSPORT-CANARY" } } : { status: 200, json: { status: true } });
  16 |   });
  17 |   await page.goto("/saas/reset-password");
  18 |   const heading = page.getByRole("heading", { name: locale === "en" ? "Reset password" : "Nulstil adgangskode", exact: true });
  19 |   await expect(heading).toBeFocused();
  20 |   const email = page.getByRole("textbox", { name: locale === "en" ? "Email" : "E-mail", exact: true });
  21 |   await expect(email).toHaveAttribute("autocomplete", "email");
  22 |   await email.fill("person@example.test"); await email.press("Enter");
  23 |   await expect(page.getByRole("alert")).toBeFocused();
  24 |   await expect(page.getByRole("alert")).not.toContainText("PRIVATE-AUTH-TRANSPORT-CANARY");
  25 |   await expect(email).toHaveValue("person@example.test");
  26 |   await page.getByRole("button", { name: locale === "en" ? "Send reset link" : "Send link til nulstilling", exact: true }).click();
  27 |   await expect(page.getByRole("status")).toBeFocused();
  28 |   await expect(page.getByRole("status")).toContainText(locale === "en" ? "If this email has an account" : "Hvis der findes en konto");
  29 |   expect(requests).toBe(2); expect(bodies[1]).toEqual(bodies[0]);
  30 |   await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
  31 |   expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
  32 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  33 | });
  34 | 
  35 | test("a different reset link cannot inherit the old password or its late acknowledgement", async ({ page }) => {
  36 |   let release!: () => void; let requests = 0;
  37 |   await page.route("**/api/auth/reset-password", async route => {
  38 |     requests++;
  39 |     expect(route.request().postDataJSON()).toEqual({ token: "first", newPassword: "PRIVATE-FIRST-PASSWORD" });
  40 |     await new Promise<void>(resolve => { release = resolve; });
  41 |     await route.fulfill({ status: 200, json: { status: true } });
  42 |   });
  43 |   await page.goto("/saas/reset-password?token=first");
> 44 |   await page.getByLabel("New password", { exact: true }).fill("PRIVATE-FIRST-PASSWORD");
     |                                                          ^ Error: locator.fill: Test timeout of 60000ms exceeded.
  45 |   await page.getByRole("button", { name: "Change password", exact: true }).click();
  46 |   await expect.poll(() => requests).toBe(1);
  47 |   await page.evaluate(() => {
  48 |     history.pushState(history.state, "", "/saas/reset-password?token=second");
  49 |     dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  50 |   });
  51 |   await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  52 |   const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/auth/reset-password");
  53 |   release(); await response;
  54 |   await expect(page.getByRole("status")).toHaveCount(0);
  55 |   await expect(page.getByRole("button", { name: "Change password", exact: true })).toBeEnabled();
  56 |   expect(requests).toBe(1);
  57 |   expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes("PRIVATE-FIRST-PASSWORD")))).toBe(false);
  58 | });
  59 | 
```