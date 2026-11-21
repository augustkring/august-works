# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> chat first open is read-only; concurrent first sends and retries share one task
- Location: tests/e2e/agent-chat-sessions.spec.ts:60:1

# Error details

```
TimeoutError: page.waitForResponse: Timeout 15000ms exceeded while waiting for event "response"
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - link "Skip to Main Content" [ref=e5] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e6]:
    - generic [ref=e7]:
      - generic [ref=e8]:
        - complementary [ref=e10]:
          - button "Open Agent Chat 1793011429319 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793011429319" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGE/search
              - link "Overview" [ref=e31] [cursor=pointer]:
                - /url: /AGE/dashboard
              - link "Agents" [ref=e39] [cursor=pointer]:
                - /url: /AGE/agents
              - link "Inbox" [ref=e47] [cursor=pointer]:
                - /url: /AGE/inbox
            - generic [ref=e53]:
              - generic [ref=e55]:
                - button "Collapse Work" [expanded] [ref=e56]
                - generic [ref=e59]: Work
              - generic [ref=e62]:
                - link "Tasks" [ref=e63] [cursor=pointer]:
                  - /url: /AGE/issues
                - link "Routines" [ref=e69] [cursor=pointer]:
                  - /url: /AGE/routines
                - link "Projects" [ref=e77] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=e82] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=e89]:
              - link "Connections" [ref=e90] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=e100] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=e106]:
              - generic [ref=e108]:
                - button "Collapse Advanced" [expanded] [ref=e109]
                - generic [ref=e112]: Advanced
              - generic [ref=e115]:
                - link "Skills" [ref=e116] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=e129] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=e136]:
              - generic [ref=e137]:
                - generic [ref=e138]: Chats
                - button "Chat with an agent" [ref=e139]
              - generic [ref=e140]:
                - link "Alpha" [ref=e141] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
                - button "Star Alpha" [ref=e147]
        - button "Open account menu" [ref=e150]:
          - generic [ref=e151]: AR
          - generic [ref=e153]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=e154]
    - generic [ref=e156]:
      - region "Global utilities" [ref=e158]:
        - generic [ref=e161]:
          - generic [ref=e162]: Language
          - combobox "Language" [ref=e163]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=e164] [cursor=pointer]:
          - /url: /AGE/company/help
        - link "Contact support" [ref=e165] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e166] [cursor=pointer]:
          - /url: /AGE/company/settings/instance/profile
      - generic [ref=e170]:
        - generic [ref=e171]:
          - generic [ref=e172]:
            - navigation "breadcrumb" [ref=e174]:
              - list [ref=e175]:
                - listitem [ref=e176]:
                  - link "AL Alpha" [disabled] [ref=e177]:
                    - generic [ref=e178]: AL
                    - generic [ref=e181]: Alpha
                  - link "Configure Alpha" [ref=e183] [cursor=pointer]:
                    - /url: /AGE/agents/8ae0f3dc-3d84-4df7-8e67-18e3fc4bd251/runtime
            - button "Hide properties" [ref=e184]
          - main [ref=e185]:
            - tabpanel [ref=e188]:
              - generic [ref=e190]:
                - generic [ref=e191]:
                  - status [ref=e192]:
                    - text: Some task history could not be loaded.
                    - button "Retry" [ref=e193]
                  - generic [ref=e194]: No messages yet.
                - generic [ref=e201]:
                  - textbox "editable markdown" [ref=e207]:
                    - paragraph [ref=e208]: Same first message
                  - generic [ref=e209]:
                    - button "Attach file" [ref=e210]
                    - button "Auto mode" [ref=e212]
                    - button "Send" [ref=e215]
        - complementary [ref=e218]:
          - separator "Resize panel" [ref=e219]
          - region "Side panel" [ref=e222]:
            - generic [ref=e223]:
              - generic [ref=e226]:
                - tablist [ref=e227]:
                  - generic [ref=e230]:
                    - tab "Artifacts" [selected] [ref=e231]
                    - button "Close Artifacts" [ref=e233]
                  - status [ref=e237]
                - button "Open a new tab" [ref=e239]
              - generic [ref=e241]:
                - button "Maximize side panel" [ref=e242]
                - button "Close side panel" [ref=e243]
            - tabpanel "Artifacts" [ref=e246]:
              - generic [ref=e247]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e248]:
    - heading "Command Palette" [level=2] [ref=e249]
    - paragraph [ref=e250]: Search for a command to run...
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
  69  |     await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  70  |     expect(await json(await request.get(f.chatPath))).toBeNull();
  71  |     expect(
  72  |       await json(
  73  |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  74  |       ),
  75  |     ).toHaveLength(0);
  76  |     const other = await context.newPage();
  77  |     await other.goto(f.route);
> 78  |     const waitForInitialComment = (target: Page) => target.waitForResponse((response) =>
      |                                                            ^ TimeoutError: page.waitForResponse: Timeout 15000ms exceeded while waiting for event "response"
  79  |       response.request().method() === "POST" &&
  80  |       /\/api\/issues\/[^/]+\/comments$/.test(new URL(response.url()).pathname),
  81  |       { timeout: 15_000 },
  82  |     );
  83  |     const initialCommentResponses = Promise.all([
  84  |       waitForInitialComment(page),
  85  |       waitForInitialComment(other),
  86  |     ]);
  87  |     await Promise.all([send(page, "Same first message"), send(other, "Same first message")]);
  88  |     for (const response of await initialCommentResponses)
  89  |       expect(response.status(), `Initial chat comment failed: ${await response.text()}`).toBe(201);
  90  |     const issue = await idle(request, f.chatPath, 2);
  91  |     const initialComments = await json(await request.get(`/api/issues/${issue.id}/comments`));
  92  |     expect(initialComments.filter((comment: any) => !comment.authorAgentId && comment.body === "Same first message")).toHaveLength(2);
  93  |     const resolved = await Promise.all(
  94  |       Array.from({ length: 4 }, () =>
  95  |         request.post(f.chatPath, { data: {} }).then(json),
  96  |       ),
  97  |     );
  98  |     expect(new Set(resolved.map((row) => row.id))).toEqual(new Set([issue.id]));
  99  |     const body = {
  100 |       body: "Retry once",
  101 |       clientRequestId: "00000000-0000-4000-8000-000000000001",
  102 |     };
  103 |     const replies = await Promise.all([
  104 |       request
  105 |         .post(`/api/issues/${issue.id}/comments`, { data: body })
  106 |         .then(json),
  107 |       request
  108 |         .post(`/api/issues/${issue.id}/comments`, { data: body })
  109 |         .then(json),
  110 |     ]);
  111 |     expect(replies[0].id).toBe(replies[1].id);
  112 |     await idle(request, f.chatPath, 3);
  113 |     await page.reload();
  114 |     await expect(
  115 |       page.getByText("Reply generation 0: Retry once", { exact: true }),
  116 |     ).toBeVisible();
  117 |     expect(
  118 |       await json(await request.get(`/api/companies/${f.company.id}/issues`)),
  119 |     ).toHaveLength(0);
  120 |     const dashboard = await json(
  121 |       await request.get(`/api/companies/${f.company.id}/dashboard`),
  122 |     );
  123 |     expect(dashboard.tasks).toEqual({
  124 |       open: 0,
  125 |       inProgress: 0,
  126 |       blocked: 0,
  127 |       done: 0,
  128 |     });
  129 |     const count = (
  130 |       await json(
  131 |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  132 |       )
  133 |     ).length;
  134 |     await page.goto(`/${f.company.issuePrefix}/issues/${issue.identifier}`);
  135 |     await page.goto(f.route);
  136 |     expect(
  137 |       await json(
  138 |         await request.get(`/api/companies/${f.company.id}/heartbeat-runs`),
  139 |       ),
  140 |     ).toHaveLength(count);
  141 |     await other.close();
  142 |   } finally {
  143 |     await f.restore();
  144 |   }
  145 | });
  146 | 
  147 | // UI response-contract fixture; original source erasure and fresh native SDK
  148 | // admission are separately exercised against PostgreSQL, without this routing.
  149 | test("source loss refreshes the read-only chat identity and drops cached history before another send", async ({ page, request }) => {
  150 |   const f = await setup(request, page);
  151 |   request = f.request;
  152 |   try {
  153 |     const original = await json(await request.post(f.chatPath, { data: {} }));
  154 |     await json(await request.post(`/api/issues/${original.id}/comments`, { data: { body: "Private history before source loss", clientRequestId: "00000000-0000-4000-8000-000000000099" } }));
  155 |     await idle(request, f.chatPath, 1);
  156 |     await page.goto(f.route);
  157 |     await expect(page.getByText("Private history before source loss", { exact: true })).toBeVisible();
  158 |     await page.screenshot({ path: test.info().outputPath("source-retained-history.png"), fullPage: true });
  159 |     let sourceLost = false, refreshed = 0, creations = 0;
  160 |     await page.route(`**${f.chatPath}`, async route => {
  161 |       if (route.request().method() === "POST") creations++;
  162 |       if (sourceLost && route.request().method() === "GET") {
  163 |         refreshed++;
  164 |         return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  165 |       }
  166 |       await route.continue();
  167 |     });
  168 |     await page.route(`**/api/issues/${original.id}/comments*`, async route => {
  169 |       sourceLost = true;
  170 |       await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Analytical conversation source access is unavailable", details: { code: "analytical_source_access_lost" } }) });
  171 |     });
  172 |     await page.reload();
  173 |     await expect.poll(() => refreshed).toBeGreaterThan(0);
  174 |     await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  175 |     await expect(page.getByText("Private history before source loss", { exact: true })).toHaveCount(0);
  176 |     expect(creations).toBe(0);
  177 |     await page.screenshot({ path: test.info().outputPath("source-loss-fresh-draft.png"), fullPage: true });
  178 |   } finally { await f.restore(); }
```