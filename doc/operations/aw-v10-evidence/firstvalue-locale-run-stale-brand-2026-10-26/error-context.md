# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: aw-v9-first-value.spec.ts >> change setup recovers a missing acknowledgement through a current read and preserves the saved goal
- Location: tests/e2e/aw-v9-first-value.spec.ts:20:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'What would you like August Works to help with first?', exact: true, level: 1 })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'What would you like August Works to help with first?', exact: true, level: 1 })

```

```yaml
- main:
  - text: Blentera Language
  - combobox "Language":
    - option "English" [selected]
    - option "Dansk"
  - link "Help / Support":
    - /url: mailto:support@blentera.com
  - paragraph: "Getting started: Company → First task → Access → Result"
  - heading "What would you like Blentera to help with first?" [level=1]
  - text: First outcome/goal
  - textbox "First outcome/goal": PRIVATE saved research goal
  - button "Continue"
  - button "Back"
  - button "Save & exit"
```

# Test source

```ts
  1   | import { createRequire } from "node:module";
  2   | import { expect, test, type APIResponse } from "@playwright/test";
  3   | import {
  4   |   activationViewSchema,
  5   |   initialActivationState,
  6   | } from "../../packages/shared/src/activation.ts";
  7   | import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
  8   | 
  9   | registerEnglishAccountLocaleIsolation(test);
  10  | const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
  11  | async function json(response: APIResponse) {
  12  |   expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
  13  |     true,
  14  |   );
  15  |   return response.json();
  16  | }
  17  | 
  18  | // Browser account/activation answers are explicit software fixtures. Native
  19  | // command authorization, atomicity and unchanged work are tested separately.
  20  | test("change setup recovers a missing acknowledgement through a current read and preserves the saved goal", async ({ page, request }, info) => {
  21  |   const company = await json(await request.post("/api/companies", {
  22  |     data: { name: "Disposable change-setup browser fixture" },
  23  |   }));
  24  |   try {
  25  |     const session = await json(await request.get("/api/auth/get-session"));
  26  |     const id = "10000000-0000-4000-8000-000000000001";
  27  |     const { receipts: _, ...initial } = initialActivationState();
  28  |     let value = activationViewSchema.parse({
  29  |       runId: id, companyId: company.id, companyName: company.name, version: 3,
  30  |       status: "in_progress",
  31  |       state: { ...initial, step: "review", intent: "PRIVATE saved research goal",
  32  |         companyPurpose: "PRIVATE retained company answers", packageVersionId: id },
  33  |       capabilities: [], sources: [], blockers: ["safe_execution_unqualified"],
  34  |       firstValue: { status: "not_recorded", result: null, candidates: [], hasMore: false },
  35  |     });
  36  |     const commands: Array<Record<string, unknown>> = [];
  37  |     let releasePost: (() => void) | undefined;
  38  |     await page.route("**/api/auth/get-session", (route) => route.fulfill({
  39  |       json: { ...session, session: { ...session.session, localImplicit: false } },
  40  |     }));
  41  |     await page.route("**/api/saas/capabilities", (route) => route.fulfill({
  42  |       json: { activationV9: true, onboarding: true },
  43  |     }));
  44  |     await page.route(`**/api/companies/${company.id}/activation?**`, async (route) => {
  45  |       expect(new URL(route.request().url()).searchParams.get("expectedUserId")).toBe(session.user.id);
  46  |       if (route.request().method() === "POST") {
  47  |         const input = route.request().postDataJSON(); commands.push(input);
  48  |         expect(Object.keys(input).sort()).toEqual(["expectedVersion", "operation", "requestId"]);
  49  |         expect(input).toMatchObject({ expectedVersion: 3, operation: "change_setup" });
  50  |         await new Promise<void>((resolve) => { releasePost = resolve; });
  51  |         value = activationViewSchema.parse({ ...value, version: 4,
  52  |           state: { ...value.state, step: "intent", packageVersionId: null },
  53  |         });
  54  |         return route.abort("failed");
  55  |       }
  56  |       return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: value });
  57  |     });
  58  |     await page.goto(`/${company.issuePrefix}/dashboard`);
  59  |     await expect(page.getByRole("main")).toBeVisible();
  60  |     await page.goto("/saas/activation/9");
  61  |     const change = page.getByRole("button", { name: "Change setup", exact: true });
  62  |     await expect(change).toBeEnabled(); await change.click();
  63  |     await expect.poll(() => releasePost !== undefined).toBe(true);
  64  |     await expect(change).toBeDisabled(); expect(commands).toHaveLength(1);
  65  |     releasePost!();
  66  |     await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  67  |     await page.reload();
  68  |     const heading = page.getByRole("heading", { level: 1,
  69  |       name: "What would you like August Works to help with first?", exact: true });
> 70  |     await expect(heading).toBeVisible(); await expect(heading).toBeFocused();
      |                           ^ Error: expect(locator).toBeVisible() failed
  71  |     await expect(page.getByRole("textbox", { name: "First outcome/goal", exact: true }))
  72  |       .toHaveValue("PRIVATE saved research goal");
  73  |     await expect(change).toHaveCount(0); expect(commands).toHaveLength(1);
  74  |     const base = `/api/companies/${company.id}`;
  75  |     expect(await json(await request.get(`${base}/issues`))).toEqual([]);
  76  |     expect(await json(await request.get(`${base}/agents`))).toEqual([]);
  77  |     const runs = await json(await request.get(`${base}/heartbeat-runs`));
  78  |     expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
  79  |     await page.setViewportSize({ width: 390, height: 844 });
  80  |     await page.addScriptTag({ path: axePath });
  81  |     expect(await page.evaluate(async () => (await (window as unknown as {
  82  |       axe: { run(scope: string): Promise<{ violations: unknown[] }> };
  83  |     }).axe.run("main")).violations)).toEqual([]);
  84  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  85  |     await page.screenshot({ path: info.outputPath("v9-change-setup-mobile.png"), fullPage: true });
  86  |   } finally {
  87  |     await json(await request.delete(`/api/companies/${company.id}`));
  88  |   }
  89  | });
  90  | 
  91  | // Actual built browser/route/layout with explicit account and private API
  92  | // software fixtures. The original Native DB/verification suite proves the
  93  | // separate task/run/review binding; these fixtures establish no real output.
  94  | test("first result recovers a missing acknowledgement and withdraws success when current evidence is lost", async ({
  95  |   page,
  96  |   request,
  97  | }, info) => {
  98  |   test.setTimeout(120000);
  99  |   const company = await json(
  100 |     await request.post("/api/companies", {
  101 |       data: { name: "Disposable first-result browser fixture" },
  102 |     }),
  103 |   );
  104 |   const session = await json(await request.get("/api/auth/get-session"));
  105 |   const id = "10000000-0000-4000-8000-000000000001";
  106 |   const { receipts: _, ...initial } = initialActivationState();
  107 |   const result = {
  108 |     installationId: id,
  109 |     verificationRunId: id,
  110 |     issueId: id,
  111 |     runId: id,
  112 |     title: "Native fixture reviewed draft",
  113 |     resultHash: "a".repeat(64),
  114 |     verifiedAt: "2026-10-10T09:00:00.000Z",
  115 |     artifacts: [{ documentId: id, documentKey: "result", revisionId: id, hash: "b".repeat(64) }],
  116 |   };
  117 |   let value = activationViewSchema.parse({
  118 |     runId: id,
  119 |     companyId: company.id,
  120 |     companyName: company.name,
  121 |     version: 3,
  122 |     status: "in_progress",
  123 |     state: {
  124 |       ...initial,
  125 |       step: "review",
  126 |       intent: "Prepare a customer research draft",
  127 |       packageVersionId: id,
  128 |     },
  129 |     capabilities: [
  130 |       {
  131 |         versionId: id,
  132 |         name: "Research draft",
  133 |         purpose: "Prepare a reviewed draft",
  134 |         requiredConnections: [],
  135 |         knownLimitations: [],
  136 |       },
  137 |     ],
  138 |     sources: [],
  139 |     blockers: ["safe_execution_unqualified"],
  140 |     firstValue: {
  141 |       status: "not_recorded",
  142 |       result: null,
  143 |       candidates: [result],
  144 |       hasMore: false,
  145 |     },
  146 |   });
  147 |   const commands: Array<Record<string, unknown>> = [];
  148 |   let holdRead = false;
  149 |   const pendingReads: Array<() => void> = [];
  150 |   await page.route("**/api/auth/get-session", (route) =>
  151 |     route.fulfill({
  152 |       json: {
  153 |         ...session,
  154 |         session: { ...session.session, localImplicit: false },
  155 |       },
  156 |     }),
  157 |   );
  158 |   await page.route("**/api/saas/capabilities", (route) =>
  159 |     route.fulfill({ json: { activationV9: true, onboarding: true } }),
  160 |   );
  161 |   await page.route(
  162 |     `**/api/companies/${company.id}/activation?**`,
  163 |     async (route) => {
  164 |       expect(
  165 |         new URL(route.request().url()).searchParams.get("expectedUserId"),
  166 |       ).toBe(session.user.id);
  167 |       const headers = { "Cache-Control": "private, no-store" };
  168 |       if (route.request().method() === "POST") {
  169 |         const input = route.request().postDataJSON();
  170 |         commands.push(input);
```