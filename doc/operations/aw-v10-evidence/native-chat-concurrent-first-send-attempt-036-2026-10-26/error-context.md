# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> chat first open is read-only; concurrent first sends and retries share one task
- Location: tests/e2e/agent-chat-sessions.spec.ts:60:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('task-chat-composer-input')
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for getByTestId('task-chat-composer-input')
  - Protocol error (Runtime.callFunctionOn): Page crashed.

```

```yaml
- link "Skip to Main Content":
  - /url: "#main-content"
- complementary:
  - button "Open Agent Chat 1793016684552 organization switcher": A Agent Chat 1793016684552
  - navigation:
    - button "New Task"
    - link "Search":
      - /url: /AGE/search
    - link "Overview":
      - /url: /AGE/dashboard
    - link "Agents":
      - /url: /AGE/agents
    - link "Inbox":
      - /url: /AGE/inbox
    - button "Collapse Work" [expanded]
    - text: Work
    - link "Tasks":
      - /url: /AGE/issues
    - link "Routines":
      - /url: /AGE/routines
    - link "Projects":
      - /url: /AGE/projects
    - link "Artifacts":
      - /url: /AGE/artifacts
    - link "Connections":
      - /url: /AGE/apps
    - link "Governance":
      - /url: /AGE/governance
    - button "Collapse Advanced" [expanded]
    - text: Advanced
    - link "Skills":
      - /url: /AGE/skills
    - link "Audit":
      - /url: /AGE/activity
    - region "Chats":
      - text: Chats
      - button "Chat with an agent"
      - link "Alpha":
        - /url: /AGE/chats/alpha
      - button "Star Alpha"
- button "Open account menu": AR Authenticated agent-chat reviewer
- separator "Resize sidebar"
- region "Global utilities":
  - text: Language
  - combobox "Language":
    - option "English" [selected]
    - option "Dansk"
  - link "Help / Support":
    - /url: /AGE/company/help
  - link "Contact support":
    - /url: mailto:support@blentera.com
  - link "User account":
    - /url: /AGE/company/settings/instance/profile
- main:
  - paragraph: Loading conversation…
- heading "Command Palette" [level=2]
- paragraph: Search for a command to run...
```

# Test source

```ts
  1   | import {randomUUID,createHash} from "node:crypto";
  2   | import {readFile} from "node:fs/promises";
  3   | import path from "node:path";
  4   | import {eq} from "../../server/node_modules/drizzle-orm/index.js";
  5   | import {createDb,issues,memoryBindings,memoryRecords,analyticalContextRoots,analyticalContextDependencies,contextManifestMemoryRoots,businessMetricObservations,businessMetricVersions} from "../../packages/db/src/index.ts";
  6   | import {contextManifestService} from "../../server/src/services/context/context-manifest.ts";
  7   | import {memoryDeletionKey} from "../../server/src/services/memory/memory-privacy.ts";
  8   | import {analyticalPurpose,metricDefinition} from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
  9   | import { expect, test, type Page } from "@playwright/test";
  10  | 
  11  | import { createLocalAgentJwt } from "../../server/src/agent-auth-jwt";
  12  | 
  13  | import { idle, json, send, setup } from "./agent-chat.shared";
  14  | 
  15  | test.use({ trace: "retain-on-failure" });
  16  | test.setTimeout(120_000);
  17  | 
  18  | /**
  19  |  * Agent chat session lifecycle coverage: first-open semantics, the feature
  20  |  * flag, Stop + queued /new resets, and sidebar discovery. Shared fixtures
  21  |  * live in ./agent-chat.shared.ts; project, attachment, and history flows run
  22  |  * in agent-chat-projects.spec.ts.
  23  |  */
  24  | test("built chat initializes after service worker takeover and reload with a slow CPU", async ({
  25  |   page,
  26  |   context,
  27  |   request,
  28  | }) => {
  29  |   const f = await setup(request, page);
  30  |   request = f.request;
  31  |   try {
  32  |     const cdp = await context.newCDPSession(page);
  33  |     try {
  34  |       await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  35  |       await page.goto(f.route);
  36  |       await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  37  |       // The failed CI traces stopped before React evaluated, while a service
  38  |       // worker forwarded the Vite module graph. Keep this test on shipped assets
  39  |       // and cover both first takeover and subsequent controlled navigations.
  40  |       const scripts = await page.locator('script[type="module"][src]').evaluateAll(
  41  |         (elements) => elements.map((element) => element.getAttribute("src")),
  42  |       );
  43  |       expect(scripts.length).toBeGreaterThan(0);
  44  |       expect(scripts.every((src) => src?.startsWith("/assets/"))).toBe(true);
  45  |       await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  46  |       for (let reload = 0; reload < 3; reload += 1) {
  47  |         await page.reload();
  48  |         await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  49  |         expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  50  |       }
  51  |       expect(await json(await request.get(f.chatPath))).toBeNull();
  52  |     } finally {
  53  |       await cdp.detach();
  54  |     }
  55  |   } finally {
  56  |     await f.restore();
  57  |   }
  58  | });
  59  | 
  60  | test("chat first open is read-only; concurrent first sends and retries share one task", async ({
  61  |   page,
  62  |   context,
  63  |   request,
  64  | }) => {
  65  |   const f = await setup(request, page);
  66  |   request = f.request;
  67  |   try {
  68  |     await page.goto(f.route);
> 69  |     await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
      |                                                                ^ Error: expect(locator).toBeVisible() failed
  70  |     expect(await json(await request.get(f.chatPath))).toBeNull();
  71  |     expect(
  72  |       await json(
  73  |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  74  |       ),
  75  |     ).toHaveLength(0);
  76  |     const other = await context.newPage();
  77  |     await other.goto(f.route);
  78  |     const waitForInitialComment = (target: Page) => target.waitForResponse((response) =>
  79  |       response.request().method() === "POST" &&
  80  |       /\/api\/issues\/[^/]+\/comments$/.test(new URL(response.url()).pathname),
  81  |       { timeout: 15_000 },
  82  |     );
  83  |     const initialCommentResponses = [waitForInitialComment(page), waitForInitialComment(other)];
  84  |     await Promise.all([send(page, "Same first message"), send(other, "Same first message")]);
  85  |     const initialCommentOutcomes = await Promise.all([
  86  |       ...initialCommentResponses,
  87  |     ].map((response) => response.then(
  88  |       (result) => ({ status: result.status() }),
  89  |       (error) => ({ waitError: error instanceof Error ? error.name : "unknown" }),
  90  |     )));
  91  |     expect(initialCommentOutcomes).toEqual([{ status: 201 }, { status: 201 }]);
  92  |     const issue = await idle(request, f.chatPath, 2);
  93  |     const initialComments = await json(await request.get(`/api/issues/${issue.id}/comments`));
  94  |     expect(initialComments.filter((comment: any) => !comment.authorAgentId && comment.body === "Same first message")).toHaveLength(2);
  95  |     const resolved = await Promise.all(
  96  |       Array.from({ length: 4 }, () =>
  97  |         request.post(f.chatPath, { data: {} }).then(json),
  98  |       ),
  99  |     );
  100 |     expect(new Set(resolved.map((row) => row.id))).toEqual(new Set([issue.id]));
  101 |     const body = {
  102 |       body: "Retry once",
  103 |       clientRequestId: "00000000-0000-4000-8000-000000000001",
  104 |     };
  105 |     const replies = await Promise.all([
  106 |       request
  107 |         .post(`/api/issues/${issue.id}/comments`, { data: body })
  108 |         .then(json),
  109 |       request
  110 |         .post(`/api/issues/${issue.id}/comments`, { data: body })
  111 |         .then(json),
  112 |     ]);
  113 |     expect(replies[0].id).toBe(replies[1].id);
  114 |     await idle(request, f.chatPath, 3);
  115 |     await page.reload();
  116 |     await expect(
  117 |       page.getByText("Reply generation 0: Retry once", { exact: true }),
  118 |     ).toBeVisible();
  119 |     expect(
  120 |       await json(await request.get(`/api/companies/${f.company.id}/issues`)),
  121 |     ).toHaveLength(0);
  122 |     const dashboard = await json(
  123 |       await request.get(`/api/companies/${f.company.id}/dashboard`),
  124 |     );
  125 |     expect(dashboard.tasks).toEqual({
  126 |       open: 0,
  127 |       inProgress: 0,
  128 |       blocked: 0,
  129 |       done: 0,
  130 |     });
  131 |     const count = (
  132 |       await json(
  133 |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  134 |       )
  135 |     ).length;
  136 |     await page.goto(`/${f.company.issuePrefix}/issues/${issue.identifier}`);
  137 |     await page.goto(f.route);
  138 |     expect(
  139 |       await json(
  140 |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  141 |       ),
  142 |     ).toHaveLength(count);
  143 |     await other.close();
  144 |   } finally {
  145 |     await f.restore();
  146 |   }
  147 | });
  148 | 
  149 | // UI response-contract fixture; original source erasure and fresh native SDK
  150 | // admission are separately exercised against PostgreSQL, without this routing.
  151 | test("source loss refreshes the read-only chat identity and drops cached history before another send", async ({ page, request }) => {
  152 |   const f = await setup(request, page);
  153 |   request = f.request;
  154 |   try {
  155 |     const original = await json(await request.post(f.chatPath, { data: {} }));
  156 |     await json(await request.post(`/api/issues/${original.id}/comments`, { data: { body: "Private history before source loss", clientRequestId: "00000000-0000-4000-8000-000000000099" } }));
  157 |     await idle(request, f.chatPath, 1);
  158 |     await page.goto(f.route);
  159 |     await expect(page.getByText("Private history before source loss", { exact: true })).toBeVisible();
  160 |     await page.screenshot({ path: test.info().outputPath("source-retained-history.png"), fullPage: true });
  161 |     let sourceLost = false, refreshed = 0, creations = 0;
  162 |     await page.route(`**${f.chatPath}`, async route => {
  163 |       if (route.request().method() === "POST") creations++;
  164 |       if (sourceLost && route.request().method() === "GET") {
  165 |         refreshed++;
  166 |         return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  167 |       }
  168 |       await route.continue();
  169 |     });
```