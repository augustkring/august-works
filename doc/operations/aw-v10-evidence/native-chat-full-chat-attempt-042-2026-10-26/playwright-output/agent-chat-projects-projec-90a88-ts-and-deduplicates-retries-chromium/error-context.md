# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-projects.spec.ts >> project card through direct API persists and deduplicates retries
- Location: tests/e2e/agent-chat-projects.spec.ts:15:3

# Error details

```
Error: apiRequestContext.get: Test ended.
Latest chat idle state: {"issueId":"814eba18-b0e3-4bdc-9b40-2f2a6d73305d","status":"in_progress","conversationState":"active","agentReplyCount":0,"liveRunStates":["running"]}
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
          - button "Open Agent Chat 1793019610171 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793019610171" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGEA/search
              - link "Overview 1 live" [ref=e31] [cursor=pointer]:
                - /url: /AGEA/dashboard
                - generic [ref=e38]: Overview
                - generic [ref=e39]: 1 live
              - link "Agents" [ref=e44] [cursor=pointer]:
                - /url: /AGEA/agents
              - link "Inbox" [ref=e52] [cursor=pointer]:
                - /url: /AGEA/inbox
            - generic [ref=e58]:
              - generic [ref=e60]:
                - button "Collapse Work" [expanded] [ref=e61]
                - generic [ref=e64]: Work
              - generic [ref=e67]:
                - link "Tasks" [ref=e68] [cursor=pointer]:
                  - /url: /AGEA/issues
                - link "Routines" [ref=e74] [cursor=pointer]:
                  - /url: /AGEA/routines
                - link "Projects" [ref=e82] [cursor=pointer]:
                  - /url: /AGEA/projects
                - link "Artifacts" [ref=e87] [cursor=pointer]:
                  - /url: /AGEA/artifacts
            - generic [ref=e94]:
              - link "Connections" [ref=e95] [cursor=pointer]:
                - /url: /AGEA/apps
              - link "Governance" [ref=e105] [cursor=pointer]:
                - /url: /AGEA/governance
            - generic [ref=e111]:
              - generic [ref=e113]:
                - button "Collapse Advanced" [expanded] [ref=e114]
                - generic [ref=e117]: Advanced
              - generic [ref=e120]:
                - link "Skills" [ref=e121] [cursor=pointer]:
                  - /url: /AGEA/skills
                - link "Audit" [ref=e134] [cursor=pointer]:
                  - /url: /AGEA/activity
            - region "Chats" [ref=e141]:
              - generic [ref=e142]:
                - generic [ref=e143]: Chats
                - button "Chat with an agent" [ref=e144]
              - generic [ref=e145]:
                - link "Alpha" [ref=e146] [cursor=pointer]:
                  - /url: /AGEA/chats/alpha
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
          - /url: /AGEA/company/help
        - link "Contact support" [ref=e170] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e171] [cursor=pointer]:
          - /url: /AGEA/company/settings/instance/profile
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
                    - /url: /AGEA/agents/88dc7005-5043-46b3-bed0-a2851a589452/runtime
            - button "Hide properties" [ref=e189]
          - main [ref=e190]:
            - tabpanel [ref=e193]:
              - generic [ref=e195]:
                - generic [ref=e200]:
                  - generic [ref=e203]:
                    - paragraph [ref=e206]: fixture:eyJhY3Rpb24iOiJwcm9qZWN0IiwibmFtZSI6IkJyb3dzZXIgcmVwb3NpdG9yaWVzIiwiZGlyZWN0Ijp0cnVlLCJ1cmxzIjpbImh0dHBzOi8vZ2l0aHViLmNvbS9vY3RvY2F0L0hlbGxvLVdvcmxkLmdpdCIsImh0dHBzOi8vZ2l0aHViLmNvbS9vY3RvY2F0L1Nwb29uLUtuaWZlIiwiaHR0cHM6Ly9naXRodWIuY29tL29jdG9jYXQvSGVsbG8tV29ybGQiXX0
                    - generic [ref=e207]: 1:00 PM
                  - generic [ref=e210]:
                    - generic [ref=e211]:
                      - generic [ref=e212]: Alpha
                      - generic [ref=e216]: Working for 13s
                    - button "Expand 1 activity" [ref=e221]:
                      - generic [ref=e222]: Read task context
                      - generic [ref=e230]: "1"
                - generic [ref=e236]:
                  - generic [ref=e240]:
                    - textbox "editable markdown" [ref=e242]:
                      - paragraph [ref=e243]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e244]:
                    - button "Attach file" [ref=e245]
                    - button "Auto mode" [ref=e247]
                    - button "Stop" [ref=e250]
        - complementary [ref=e253]:
          - separator "Resize panel" [ref=e254]
          - region "Side panel" [ref=e257]:
            - generic [ref=e258]:
              - generic [ref=e261]:
                - tablist [ref=e262]:
                  - generic [ref=e265]:
                    - tab "Artifacts" [selected] [ref=e266]
                    - button "Close Artifacts" [ref=e268]
                  - status [ref=e272]
                - button "Open a new tab" [ref=e274]
              - generic [ref=e276]:
                - button "Maximize side panel" [ref=e277]
                - button "Close side panel" [ref=e278]
            - tabpanel "Artifacts" [ref=e281]:
              - generic [ref=e282]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e283]:
    - heading "Command Palette" [level=2] [ref=e284]
    - paragraph [ref=e285]: Search for a command to run...
```

# Test source

```ts
  185 |                   id: run.id,
  186 |                   status: run.status,
  187 |                   startedAt: run.startedAt,
  188 |                   finishedAt: run.finishedAt,
  189 |                   sessionIdBefore: run.sessionIdBefore,
  190 |                   sessionIdAfter: run.sessionIdAfter,
  191 |                   issueId: run.contextSnapshot?.issueId,
  192 |                   generation:
  193 |                     run.contextSnapshot?.conversationSessionGeneration,
  194 |                   reset: run.contextSnapshot?.conversationReset,
  195 |                 })),
  196 |               },
  197 |               null,
  198 |               2,
  199 |             ),
  200 |           ),
  201 |         });
  202 |       } catch (error) {
  203 |         await test.info().attach("chat-state-capture-warning", {
  204 |           contentType: "application/json",
  205 |           body: Buffer.from(JSON.stringify({ errorName: error instanceof Error ? error.name : "unknown" })),
  206 |         }).catch(() => undefined);
  207 |       } finally {
  208 |         await safeCleanup(async () => {
  209 |           const response = await request.get(`/api/companies/${company.id}/live-runs`, { timeout: 5_000 });
  210 |           const runs = await json(response);
  211 |           await Promise.all(runs.map((run: any) => safeCleanup(async () => json(
  212 |             await request.post(`/api/heartbeat-runs/${run.id}/cancel`, { timeout: 5_000 }),
  213 |           ))));
  214 |         });
  215 |         await safeCleanup(async () => json(
  216 |           await instanceControlRequest.patch("/api/instance/settings/experimental", {
  217 |             data: {
  218 |               enableAgentChat: original.enableAgentChat,
  219 |               enableClassicTaskInterface: original.enableClassicTaskInterface,
  220 |               ...(nativeChat ? { enableNativeRunner: original.enableNativeRunner } : {}),
  221 |             },
  222 |             timeout: 5_000,
  223 |           }),
  224 |         ));
  225 |         if (apiKeyId) await safeCleanup(async () => request.delete(`/api/board-api-keys/${apiKeyId}`, { timeout: 5_000 }));
  226 |         if (pageContext) await pageContext.unroute("**/api/**");
  227 |         if (ownsApiRequest) await safeCleanup(() => request.dispose());
  228 |       }
  229 |     },
  230 |     request,
  231 |   };
  232 | }
  233 | export async function send(page: Page, value: unknown) {
  234 |   await page
  235 |     .getByTestId("task-chat-composer-input")
  236 |     .last()
  237 |     .locator('[contenteditable="true"],textarea')
  238 |     .first()
  239 |     .fill(
  240 |       typeof value === "string"
  241 |         ? value
  242 |         : `fixture:${Buffer.from(JSON.stringify(value)).toString("base64url")}`,
  243 |     );
  244 |   await page.getByTestId("task-chat-composer-send").last().click();
  245 | }
  246 | export async function idle(
  247 |   request: APIRequestContext,
  248 |   chatPath: string,
  249 |   minimumReplies = 1,
  250 | ) {
  251 |   let issue: any;
  252 |   let lastDiagnostic = "not polled";
  253 |   try {
  254 |     await expect
  255 |       .poll(
  256 |       async () => {
  257 |         issue = await json(await request.get(chatPath));
  258 |         if (!issue) return false;
  259 |         const [replies, live] = await Promise.all([
  260 |           request
  261 |             .get(`/api/issues/${issue.id}/comments`)
  262 |             .then(json),
  263 |           request
  264 |             .get(`/api/issues/${issue.id}/live-runs`)
  265 |             .then(json),
  266 |         ]);
  267 |         lastDiagnostic = JSON.stringify({
  268 |           issueId: issue.id,
  269 |           status: issue.status,
  270 |           conversationState: issue.conversationState,
  271 |           agentReplyCount: replies.filter((c: any) => c.authorAgentId).length,
  272 |           liveRunStates: live.map((run: any) => run.status),
  273 |         });
  274 |         return (
  275 |           live.length === 0 &&
  276 |           issue.conversationState === "waiting" &&
  277 |           issue.status === "in_review" &&
  278 |           replies.filter((c: any) => c.authorAgentId).length >= minimumReplies
  279 |         );
  280 |       },
  281 |       { timeout: 60_000, intervals: [100, 250, 500] },
  282 |       )
  283 |       .toBe(true);
  284 |   } catch (error) {
> 285 |     throw new Error(`${error instanceof Error ? error.message : String(error)}\nLatest chat idle state: ${lastDiagnostic}`);
      |           ^ Error: apiRequestContext.get: Test ended.
  286 |   }
  287 |   return issue;
  288 | }
  289 | 
```