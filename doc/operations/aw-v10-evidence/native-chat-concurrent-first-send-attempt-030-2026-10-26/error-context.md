# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> chat first open is read-only; concurrent first sends and retries share one task
- Location: tests/e2e/agent-chat-sessions.spec.ts:60:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Array [
    Object {
      "status": 201,
    },
    Object {
-     "status": 201,
+     "waitError": "TimeoutError",
    },
  ]
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
          - button "Open Agent Chat 1793014067756 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793014067756" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGE/search
              - link "Overview 1 live" [ref=e31] [cursor=pointer]:
                - /url: /AGE/dashboard
                - generic [ref=e38]: Overview
                - generic [ref=e39]: 1 live
              - link "Agents" [ref=e44] [cursor=pointer]:
                - /url: /AGE/agents
              - link "Inbox" [ref=e52] [cursor=pointer]:
                - /url: /AGE/inbox
            - generic [ref=e58]:
              - generic [ref=e60]:
                - button "Collapse Work" [expanded] [ref=e61]
                - generic [ref=e64]: Work
              - generic [ref=e67]:
                - link "Tasks" [ref=e68] [cursor=pointer]:
                  - /url: /AGE/issues
                - link "Routines" [ref=e74] [cursor=pointer]:
                  - /url: /AGE/routines
                - link "Projects" [ref=e82] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=e87] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=e94]:
              - link "Connections" [ref=e95] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=e105] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=e111]:
              - generic [ref=e113]:
                - button "Collapse Advanced" [expanded] [ref=e114]
                - generic [ref=e117]: Advanced
              - generic [ref=e120]:
                - link "Skills" [ref=e121] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=e134] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=e141]:
              - generic [ref=e142]:
                - generic [ref=e143]: Chats
                - button "Chat with an agent" [ref=e144]
              - generic [ref=e145]:
                - link "Alpha" [ref=e146] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
                - button "Star Alpha" [ref=e152]
        - button "Open account menu" [ref=e155]:
          - generic [ref=e156]: AR
          - generic [ref=e158]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=e159]
    - generic [ref=e161]:
      - region "Global utilities" [ref=e163]:
        - generic [ref=e166]:
          - generic [ref=e167]: Language
          - combobox "Language" [ref=e168]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=e169] [cursor=pointer]:
          - /url: /AGE/company/help
        - link "Contact support" [ref=e170] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e171] [cursor=pointer]:
          - /url: /AGE/company/settings/instance/profile
      - generic [ref=e175]:
        - generic [ref=e176]:
          - generic [ref=e177]:
            - navigation "breadcrumb" [ref=e179]:
              - list [ref=e180]:
                - listitem [ref=e181]:
                  - link "AL Alpha" [disabled] [ref=e182]:
                    - generic [ref=e183]: AL
                    - generic [ref=e186]: Alpha
                  - link "Configure Alpha" [ref=e188] [cursor=pointer]:
                    - /url: /AGE/agents/abe2f412-a0c5-49d5-8124-e233d56c1d61/runtime
            - button "Hide properties" [ref=e189]
          - main [ref=e190]:
            - tabpanel [ref=e193]:
              - generic [ref=e195]:
                - generic [ref=e203]:
                  - paragraph [ref=e206]: Same first message
                  - generic [ref=e207]: 11:27 AM
                - generic [ref=e211]:
                  - generic [ref=e215]:
                    - textbox "editable markdown" [ref=e217]:
                      - paragraph [ref=e218]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e219]:
                    - button "Attach file" [ref=e220]
                    - button "Auto mode" [ref=e222]
                    - button "Send" [disabled] [ref=e225]
        - complementary [ref=e228]:
          - separator "Resize panel" [ref=e229]
          - region "Side panel" [ref=e232]:
            - generic [ref=e233]:
              - generic [ref=e236]:
                - tablist [ref=e237]:
                  - generic [ref=e240]:
                    - tab "Artifacts" [selected] [ref=e241]
                    - button "Close Artifacts" [ref=e243]
                  - status [ref=e247]
                - button "Open a new tab" [ref=e249]
              - generic [ref=e251]:
                - button "Maximize side panel" [ref=e252]
                - button "Close side panel" [ref=e253]
            - tabpanel "Artifacts" [ref=e256]:
              - generic [ref=e257]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e258]:
    - heading "Command Palette" [level=2] [ref=e259]
    - paragraph [ref=e260]: Search for a command to run...
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
> 91  |     expect(initialCommentOutcomes).toEqual([{ status: 201 }, { status: 201 }]);
      |                                    ^ Error: expect(received).toEqual(expected) // deep equality
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
  170 |     await page.route(`**/api/issues/${original.id}/comments*`, async route => {
  171 |       sourceLost = true;
  172 |       await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Analytical conversation source access is unavailable", details: { code: "analytical_source_access_lost" } }) });
  173 |     });
  174 |     await page.reload();
  175 |     await expect.poll(() => refreshed).toBeGreaterThan(0);
  176 |     await expect(page.getByTestId("task-chat-composer-input")).toBeVisible();
  177 |     await expect(page.getByText("Private history before source loss", { exact: true })).toHaveCount(0);
  178 |     expect(creations).toBe(0);
  179 |     await page.screenshot({ path: test.info().outputPath("source-loss-fresh-draft.png"), fullPage: true });
  180 |   } finally { await f.restore(); }
  181 | });
  182 | 
  183 | // Actual native source, authorization, recovery API and UI. The historical
  184 | // private retention root is seeded in the isolated DB; this browser case does
  185 | // not claim an external LLM or SDK analytical tool invocation.
  186 | // Live denial is an explicit UI response-contract fixture. Recipient admission
  187 | // and source/IAM changes are independently exercised over real WS + PostgreSQL.
  188 | test("live source denial removes cached chat history without a reload or implicit replacement", async ({page,request}) => {
  189 |   const f=await setup(request, page);
  190 |   request = f.request;
  191 |   try{
```