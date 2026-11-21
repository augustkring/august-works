# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> chat first open is read-only; concurrent first sends and retries share one task
- Location: tests/e2e/agent-chat-sessions.spec.ts:59:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
Latest chat idle state: {"issueId":"2e734902-cb74-4508-8082-43c6365a48d4","status":"in_progress","conversationState":"active","agentReplyCount":1,"liveRunStates":["running"]}
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
          - button "Open Agent Chat 1793057124583 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793057124583" [ref=e17]
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
                    - /url: /AGE/agents/46bed9dd-5099-46d7-bdc1-2dd009d07500/runtime
            - button "Hide properties" [ref=e189]
          - main [ref=e190]:
            - tabpanel [ref=e193]:
              - generic [ref=e195]:
                - generic [ref=e200]:
                  - generic [ref=e203]:
                    - paragraph [ref=e206]: Same first message
                    - generic [ref=e207]: 11:25 PM
                  - generic [ref=e209]:
                    - generic [ref=e211]:
                      - generic [ref=e212]:
                        - generic [ref=e213]: Alpha
                        - generic [ref=e217]: Worked for 34s
                      - button "Expand read files (2 activities)" [ref=e222]:
                        - generic "Read files" [ref=e227]
                    - paragraph [ref=e233]: "Reply generation 0: Same first message"
                    - generic [ref=e234]:
                      - generic [ref=e235]: 11:26 PM
                      - generic [ref=e236]:
                        - button "Copy message" [ref=e237]
                        - button "Helpful" [ref=e241]
                        - button "Needs work" [ref=e244]
                  - generic [ref=e248]:
                    - paragraph [ref=e251]: Same first message
                    - generic [ref=e252]: 11:25 PM
                  - generic [ref=e255]:
                    - generic [ref=e256]:
                      - generic [ref=e257]: Alpha
                      - generic [ref=e261]: Working for 36s
                    - button "Expand 2 activities" [ref=e266]:
                      - generic [ref=e273]:
                        - generic [ref=e274]: Read task history
                        - 'generic "limit: 100" [ref=e275]'
                      - generic [ref=e276]: "2"
                    - generic [ref=e280]:
                      - paragraph [ref=e283]: "Reply generation 0: Same first message"
                      - generic [ref=e284]:
                        - generic [ref=e285]: 11:26 PM
                        - button "Copy message" [ref=e287]
                - generic [ref=e294]:
                  - generic [ref=e298]:
                    - textbox "editable markdown" [ref=e300]:
                      - paragraph [ref=e301]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e302]:
                    - button "Attach file" [ref=e303]
                    - button "Auto mode" [ref=e305]
                    - button "Stop" [ref=e308]
        - complementary [ref=e311]:
          - separator "Resize panel" [ref=e312]
          - region "Side panel" [ref=e315]:
            - generic [ref=e316]:
              - generic [ref=e319]:
                - tablist [ref=e320]:
                  - generic [ref=e323]:
                    - tab "Artifacts" [selected] [ref=e324]
                    - button "Close Artifacts" [ref=e326]
                  - status [ref=e330]
                - button "Open a new tab" [ref=e332]
              - generic [ref=e334]:
                - button "Maximize side panel" [ref=e335]
                - button "Close side panel" [ref=e336]
            - tabpanel "Artifacts" [ref=e339]:
              - generic [ref=e340]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e341]:
    - heading "Command Palette" [level=2] [ref=e342]
    - paragraph [ref=e343]: Search for a command to run...
```

# Test source

```ts
  194 |                   id: run.id,
  195 |                   status: run.status,
  196 |                   startedAt: run.startedAt,
  197 |                   finishedAt: run.finishedAt,
  198 |                   sessionIdBefore: run.sessionIdBefore,
  199 |                   sessionIdAfter: run.sessionIdAfter,
  200 |                   issueId: run.contextSnapshot?.issueId,
  201 |                   generation:
  202 |                     run.contextSnapshot?.conversationSessionGeneration,
  203 |                   reset: run.contextSnapshot?.conversationReset,
  204 |                 })),
  205 |               },
  206 |               null,
  207 |               2,
  208 |             ),
  209 |           ),
  210 |         });
  211 |       } catch (error) {
  212 |         await test.info().attach("chat-state-capture-warning", {
  213 |           contentType: "application/json",
  214 |           body: Buffer.from(JSON.stringify({ errorName: error instanceof Error ? error.name : "unknown" })),
  215 |         }).catch(() => undefined);
  216 |       } finally {
  217 |         await safeCleanup(async () => {
  218 |           const response = await request.get(`/api/companies/${company.id}/live-runs`, { timeout: 5_000 });
  219 |           const runs = await json(response);
  220 |           await Promise.all(runs.map((run: any) => safeCleanup(async () => json(
  221 |             await request.post(`/api/heartbeat-runs/${run.id}/cancel`, { timeout: 5_000 }),
  222 |           ))));
  223 |         });
  224 |         await safeCleanup(async () => json(
  225 |           await instanceControlRequest.patch("/api/instance/settings/experimental", {
  226 |             data: {
  227 |               enableAgentChat: original.enableAgentChat,
  228 |               enableClassicTaskInterface: original.enableClassicTaskInterface,
  229 |               ...(nativeChat ? { enableNativeRunner: original.enableNativeRunner } : {}),
  230 |             },
  231 |             timeout: 5_000,
  232 |           }),
  233 |         ));
  234 |         if (apiKeyId) await safeCleanup(async () => request.delete(`/api/board-api-keys/${apiKeyId}`, { timeout: 5_000 }));
  235 |         if (pageContext) await pageContext.unroute("**/api/**");
  236 |         if (ownsApiRequest) await safeCleanup(() => request.dispose());
  237 |       }
  238 |     },
  239 |     request,
  240 |   };
  241 | }
  242 | export async function send(page: Page, value: unknown) {
  243 |   await page
  244 |     .getByTestId("task-chat-composer-input")
  245 |     .last()
  246 |     .locator('[contenteditable="true"],textarea')
  247 |     .first()
  248 |     .fill(
  249 |       typeof value === "string"
  250 |         ? value
  251 |         : `fixture:${Buffer.from(JSON.stringify(value)).toString("base64url")}`,
  252 |     );
  253 |   await page.getByTestId("task-chat-composer-send").last().click();
  254 | }
  255 | export async function idle(
  256 |   request: APIRequestContext,
  257 |   chatPath: string,
  258 |   minimumReplies = 1,
  259 | ) {
  260 |   let issue: any;
  261 |   let lastDiagnostic = "not polled";
  262 |   try {
  263 |     await expect
  264 |       .poll(
  265 |       async () => {
  266 |         issue = await json(await request.get(chatPath));
  267 |         if (!issue) return false;
  268 |         const [replies, live] = await Promise.all([
  269 |           request
  270 |             .get(`/api/issues/${issue.id}/comments`)
  271 |             .then(json),
  272 |           request
  273 |             .get(`/api/issues/${issue.id}/live-runs`)
  274 |             .then(json),
  275 |         ]);
  276 |         lastDiagnostic = JSON.stringify({
  277 |           issueId: issue.id,
  278 |           status: issue.status,
  279 |           conversationState: issue.conversationState,
  280 |           agentReplyCount: replies.filter((c: any) => c.authorAgentId).length,
  281 |           liveRunStates: live.map((run: any) => run.status),
  282 |         });
  283 |         return (
  284 |           live.length === 0 &&
  285 |           issue.conversationState === "waiting" &&
  286 |           issue.status === "in_review" &&
  287 |           replies.filter((c: any) => c.authorAgentId).length >= minimumReplies
  288 |         );
  289 |       },
  290 |       { timeout: 60_000, intervals: [100, 250, 500] },
  291 |       )
  292 |       .toBe(true);
  293 |   } catch (error) {
> 294 |     throw new Error(`${error instanceof Error ? error.message : String(error)}\nLatest chat idle state: ${lastDiagnostic}`);
      |           ^ Error: expect(received).toBe(expected) // Object.is equality
  295 |   }
  296 |   return issue;
  297 | }
  298 | 
```