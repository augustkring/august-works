# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> chat first open is read-only; concurrent first sends and retries share one task
- Location: tests/e2e/agent-chat-sessions.spec.ts:60:1

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: apiRequestContext.get: Test timeout of 120000ms exceeded.
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
          - button "Open Agent Chat 1793010374761 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793010374761" [ref=e17]
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
                    - /url: /AGE/agents/1b5717a5-933b-450c-8acf-fabfdee91ad8/runtime
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
  95  |       await json(
  96  |         await request.post(`/api/companies/${company.id}/agents`, {
  97  |           data: {
  98  |             name,
  99  |             adapterType: nativeChat ? "paperclip_runner" : "process",
  100 |             adapterConfig: nativeChat ? { provider: "codex", model: "gpt-5.1-codex-mini" } : {
  101 |               command: process.execPath,
  102 |               args: [path.resolve("tests/e2e/fixtures/agent-chat.mjs")],
  103 |               graceSec: 1,
  104 |             },
  105 |             runtimeConfig: {
  106 |               heartbeat: { enabled: false, wakeOnDemand: true },
  107 |             },
  108 |           },
  109 |         }),
  110 |       ),
  111 |     );
  112 |   const agent = agents[0];
  113 |   const chatPath = `/api/companies/${company.id}/chats/${agent.id}`;
  114 |   const route = `/${company.issuePrefix}/chats/${agent.id}`;
  115 |   return {
  116 |     company,
  117 |     agents,
  118 |     agent,
  119 |     chatPath,
  120 |     route,
  121 |     restore: async (options?: { collectState?: boolean }) => {
  122 |       try {
  123 |         if (options?.collectState === false) return;
  124 |         const chat = await request.get(chatPath);
  125 |         const history = chat.ok() ? await chat.json() : null;
  126 |         const tasks = await json(
  127 |           await request.get(`/api/companies/${company.id}/issues`),
  128 |         );
  129 |         const projects = await json(
  130 |           await request.get(`/api/companies/${company.id}/projects`),
  131 |         );
  132 |         const ledger = await json(
  133 |           await request.get(`/api/companies/${company.id}/heartbeat-runs`),
  134 |         );
  135 |         const runDetails = await Promise.all(ledger.map(async (run: any) => {
  136 |           const response = await request.get(`/api/heartbeat-runs/${run.id}`);
  137 |           if (!response.ok()) return { id: run.id, detailStatus: response.status() };
  138 |           const detail = await response.json();
  139 |           return {
  140 |             id: run.id,
  141 |             status: detail.status,
  142 |             errorCode: detail.errorCode ?? null,
  143 |             exitCode: detail.exitCode ?? null,
  144 |             signal: detail.signal ?? null,
  145 |             nativePhase: detail.nativePhase ?? null,
  146 |             issueMatchesChat: detail.issueId === history?.id,
  147 |             nativeIssueMatchesChat: detail.nativeIssueId === history?.id,
  148 |             humanMatchesChatOwner: detail.responsibleUserId === history?.responsibleUserId,
  149 |             executionRunMatchesChat: history?.executionRunId === detail.id,
  150 |           };
  151 |         }));
  152 |         const documents = await Promise.all(
  153 |           [...(history ? [history] : []), ...tasks].map(async (task: any) => ({
  154 |             taskId: task.id,
  155 |             documents: await json(
  156 |               await request.get(`/api/issues/${task.id}/documents`),
  157 |             ),
  158 |           })),
  159 |         );
  160 |         await test.info().attach("chat-persisted-state", {
  161 |           contentType: "application/json",
  162 |           body: Buffer.from(
  163 |             JSON.stringify(
  164 |               {
  165 |                 chat: history,
  166 |                 tasks,
  167 |                 projects,
  168 |                 documents,
  169 |                 runDetails,
  170 |                 comments: history
  171 |                   ? await json(
  172 |                       await request.get(`/api/issues/${history.id}/comments`),
  173 |                     )
  174 |                   : [],
  175 |                 runs: ledger.map((run: any) => ({
  176 |                   id: run.id,
  177 |                   status: run.status,
  178 |                   startedAt: run.startedAt,
  179 |                   finishedAt: run.finishedAt,
  180 |                   sessionIdBefore: run.sessionIdBefore,
  181 |                   sessionIdAfter: run.sessionIdAfter,
  182 |                   issueId: run.contextSnapshot?.issueId,
  183 |                   generation:
  184 |                     run.contextSnapshot?.conversationSessionGeneration,
  185 |                   reset: run.contextSnapshot?.conversationReset,
  186 |                 })),
  187 |               },
  188 |               null,
  189 |               2,
  190 |             ),
  191 |           ),
  192 |         });
  193 |       } finally {
  194 |         const runs = await json(
> 195 |           await request.get(`/api/companies/${company.id}/live-runs`),
      |                         ^ Error: apiRequestContext.get: Test timeout of 120000ms exceeded.
  196 |         );
  197 |         for (const run of runs)
  198 |           await json(
  199 |             await request.post(`/api/heartbeat-runs/${run.id}/cancel`),
  200 |           );
  201 |         await json(
  202 |           await instanceControlRequest.patch("/api/instance/settings/experimental", {
  203 |             data: {
  204 |               enableAgentChat: original.enableAgentChat,
  205 |               enableClassicTaskInterface: original.enableClassicTaskInterface,
  206 |               ...(nativeChat ? { enableNativeRunner: original.enableNativeRunner } : {}),
  207 |             },
  208 |           }),
  209 |         );
  210 |         if (apiKeyId) await request.delete(`/api/board-api-keys/${apiKeyId}`);
  211 |         if (pageContext) await pageContext.unroute("**/api/**");
  212 |         if (ownsApiRequest) await request.dispose();
  213 |       }
  214 |     },
  215 |     request,
  216 |   };
  217 | }
  218 | export async function send(page: Page, value: unknown) {
  219 |   await page
  220 |     .getByTestId("task-chat-composer-input")
  221 |     .last()
  222 |     .locator('[contenteditable="true"],textarea')
  223 |     .first()
  224 |     .fill(
  225 |       typeof value === "string"
  226 |         ? value
  227 |         : `fixture:${Buffer.from(JSON.stringify(value)).toString("base64url")}`,
  228 |     );
  229 |   await page.getByTestId("task-chat-composer-send").last().click();
  230 | }
  231 | export async function idle(
  232 |   request: APIRequestContext,
  233 |   chatPath: string,
  234 |   minimumReplies = 1,
  235 | ) {
  236 |   let issue: any;
  237 |   let lastDiagnostic = "not polled";
  238 |   try {
  239 |     await expect
  240 |       .poll(
  241 |       async () => {
  242 |         issue = await json(await request.get(chatPath));
  243 |         if (!issue) return false;
  244 |         const replies = await json(
  245 |           await request.get(`/api/issues/${issue.id}/comments`),
  246 |         );
  247 |         const live = await json(
  248 |           await request.get(`/api/issues/${issue.id}/live-runs`),
  249 |         );
  250 |         lastDiagnostic = JSON.stringify({
  251 |           issueId: issue.id,
  252 |           status: issue.status,
  253 |           conversationState: issue.conversationState,
  254 |           agentReplyCount: replies.filter((c: any) => c.authorAgentId).length,
  255 |           liveRunStates: live.map((run: any) => run.status),
  256 |         });
  257 |         return (
  258 |           live.length === 0 &&
  259 |           issue.conversationState === "waiting" &&
  260 |           issue.status === "in_review" &&
  261 |           replies.filter((c: any) => c.authorAgentId).length >= minimumReplies
  262 |         );
  263 |       },
  264 |       { timeout: 60_000, intervals: [100, 250, 500] },
  265 |       )
  266 |       .toBe(true);
  267 |   } catch (error) {
  268 |     throw new Error(`${error instanceof Error ? error.message : String(error)}\nLatest chat idle state: ${lastDiagnostic}`);
  269 |   }
  270 |   return issue;
  271 | }
  272 | 
```