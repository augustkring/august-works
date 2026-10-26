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
Latest chat idle state: {"issueId":"ab330e1c-60da-40cc-96bc-3074e394d727","status":"in_progress","conversationState":"active","agentReplyCount":1,"liveRunStates":["running"]}
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
          - button "Open Agent Chat 1793053710377 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793053710377" [ref=e17]
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
                    - /url: /AGE/agents/85e88712-307e-40f8-8bcc-386023708d0f/runtime
            - button "Hide properties" [ref=e189]
          - main [ref=e190]:
            - tabpanel [ref=e193]:
              - generic [ref=e195]:
                - generic [ref=e200]:
                  - generic [ref=e203]:
                    - paragraph [ref=e206]: Same first message
                    - generic [ref=e207]: 10:28 PM
                  - generic [ref=e209]:
                    - generic [ref=e211]:
                      - generic [ref=e212]:
                        - generic [ref=e213]: Alpha
                        - generic [ref=e217]: Worked for 33s
                      - button "Expand read files (2 activities)" [ref=e222]:
                        - generic "Read files" [ref=e227]
                    - paragraph [ref=e233]: "Reply generation 0:"
                    - generic [ref=e234]:
                      - generic [ref=e235]: 10:29 PM
                      - generic [ref=e236]:
                        - button "Copy message" [ref=e237]
                        - button "Helpful" [ref=e241]
                        - button "Needs work" [ref=e244]
                  - generic [ref=e248]:
                    - paragraph [ref=e251]: Same first message
                    - generic [ref=e252]: 10:28 PM
                  - generic [ref=e255]:
                    - generic [ref=e256]:
                      - generic [ref=e257]: Alpha
                      - generic [ref=e261]: Working for 38s
                    - button "Expand 2 activities" [ref=e266]:
                      - generic [ref=e273]:
                        - generic [ref=e274]: Read task history
                        - 'generic "limit: 100" [ref=e275]'
                      - generic [ref=e276]: "2"
                    - generic [ref=e280]:
                      - paragraph [ref=e283]: "Reply generation 0: Same first message"
                      - generic [ref=e284]:
                        - generic [ref=e285]: 10:29 PM
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
  190 |                   id: run.id,
  191 |                   status: run.status,
  192 |                   startedAt: run.startedAt,
  193 |                   finishedAt: run.finishedAt,
  194 |                   sessionIdBefore: run.sessionIdBefore,
  195 |                   sessionIdAfter: run.sessionIdAfter,
  196 |                   issueId: run.contextSnapshot?.issueId,
  197 |                   generation:
  198 |                     run.contextSnapshot?.conversationSessionGeneration,
  199 |                   reset: run.contextSnapshot?.conversationReset,
  200 |                 })),
  201 |               },
  202 |               null,
  203 |               2,
  204 |             ),
  205 |           ),
  206 |         });
  207 |       } catch (error) {
  208 |         await test.info().attach("chat-state-capture-warning", {
  209 |           contentType: "application/json",
  210 |           body: Buffer.from(JSON.stringify({ errorName: error instanceof Error ? error.name : "unknown" })),
  211 |         }).catch(() => undefined);
  212 |       } finally {
  213 |         await safeCleanup(async () => {
  214 |           const response = await request.get(`/api/companies/${company.id}/live-runs`, { timeout: 5_000 });
  215 |           const runs = await json(response);
  216 |           await Promise.all(runs.map((run: any) => safeCleanup(async () => json(
  217 |             await request.post(`/api/heartbeat-runs/${run.id}/cancel`, { timeout: 5_000 }),
  218 |           ))));
  219 |         });
  220 |         await safeCleanup(async () => json(
  221 |           await instanceControlRequest.patch("/api/instance/settings/experimental", {
  222 |             data: {
  223 |               enableAgentChat: original.enableAgentChat,
  224 |               enableClassicTaskInterface: original.enableClassicTaskInterface,
  225 |               ...(nativeChat ? { enableNativeRunner: original.enableNativeRunner } : {}),
  226 |             },
  227 |             timeout: 5_000,
  228 |           }),
  229 |         ));
  230 |         if (apiKeyId) await safeCleanup(async () => request.delete(`/api/board-api-keys/${apiKeyId}`, { timeout: 5_000 }));
  231 |         if (pageContext) await pageContext.unroute("**/api/**");
  232 |         if (ownsApiRequest) await safeCleanup(() => request.dispose());
  233 |       }
  234 |     },
  235 |     request,
  236 |   };
  237 | }
  238 | export async function send(page: Page, value: unknown) {
  239 |   await page
  240 |     .getByTestId("task-chat-composer-input")
  241 |     .last()
  242 |     .locator('[contenteditable="true"],textarea')
  243 |     .first()
  244 |     .fill(
  245 |       typeof value === "string"
  246 |         ? value
  247 |         : `fixture:${Buffer.from(JSON.stringify(value)).toString("base64url")}`,
  248 |     );
  249 |   await page.getByTestId("task-chat-composer-send").last().click();
  250 | }
  251 | export async function idle(
  252 |   request: APIRequestContext,
  253 |   chatPath: string,
  254 |   minimumReplies = 1,
  255 | ) {
  256 |   let issue: any;
  257 |   let lastDiagnostic = "not polled";
  258 |   try {
  259 |     await expect
  260 |       .poll(
  261 |       async () => {
  262 |         issue = await json(await request.get(chatPath));
  263 |         if (!issue) return false;
  264 |         const [replies, live] = await Promise.all([
  265 |           request
  266 |             .get(`/api/issues/${issue.id}/comments`)
  267 |             .then(json),
  268 |           request
  269 |             .get(`/api/issues/${issue.id}/live-runs`)
  270 |             .then(json),
  271 |         ]);
  272 |         lastDiagnostic = JSON.stringify({
  273 |           issueId: issue.id,
  274 |           status: issue.status,
  275 |           conversationState: issue.conversationState,
  276 |           agentReplyCount: replies.filter((c: any) => c.authorAgentId).length,
  277 |           liveRunStates: live.map((run: any) => run.status),
  278 |         });
  279 |         return (
  280 |           live.length === 0 &&
  281 |           issue.conversationState === "waiting" &&
  282 |           issue.status === "in_review" &&
  283 |           replies.filter((c: any) => c.authorAgentId).length >= minimumReplies
  284 |         );
  285 |       },
  286 |       { timeout: 60_000, intervals: [100, 250, 500] },
  287 |       )
  288 |       .toBe(true);
  289 |   } catch (error) {
> 290 |     throw new Error(`${error instanceof Error ? error.message : String(error)}\nLatest chat idle state: ${lastDiagnostic}`);
      |           ^ Error: expect(received).toBe(expected) // Object.is equality
  291 |   }
  292 |   return issue;
  293 | }
  294 | 
```