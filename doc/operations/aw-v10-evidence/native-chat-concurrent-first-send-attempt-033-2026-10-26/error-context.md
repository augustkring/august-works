# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> chat first open is read-only; concurrent first sends and retries share one task
- Location: tests/e2e/agent-chat-sessions.spec.ts:60:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
Latest chat idle state: {"issueId":"db8a5e1f-fe62-48ad-8f35-ef43e83974fa","status":"in_progress","conversationState":"active","agentReplyCount":2,"liveRunStates":["running"]}
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
          - button "Open Agent Chat 1793015560543 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793015560543" [ref=e17]
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
                    - /url: /AGE/agents/8484b899-dcf8-4541-a01d-fb1aba72200a/runtime
            - button "Hide properties" [ref=e189]
          - main [ref=e190]:
            - tabpanel [ref=e193]:
              - generic [ref=e195]:
                - generic [ref=e200]:
                  - generic [ref=e203]:
                    - paragraph [ref=e206]: Same first message
                    - generic [ref=e207]: 11:52 AM
                  - generic [ref=e209]:
                    - generic [ref=e211]:
                      - generic [ref=e212]:
                        - generic [ref=e213]: Alpha
                        - generic [ref=e217]: Worked for 32s
                      - button "Expand read files, used tools (3 activities)" [ref=e222]:
                        - generic "Read files, used tools" [ref=e229]
                    - paragraph [ref=e235]: "Reply generation 0: Same first message"
                    - generic [ref=e236]:
                      - generic [ref=e237]: 11:53 AM
                      - generic [ref=e238]:
                        - button "Copy message" [ref=e239]
                        - button "Helpful" [ref=e243]
                        - button "Needs work" [ref=e246]
                  - generic [ref=e250]:
                    - paragraph [ref=e253]: Same first message
                    - generic [ref=e254]: 11:52 AM
                  - generic [ref=e256]:
                    - generic [ref=e258]:
                      - generic [ref=e259]:
                        - generic [ref=e260]: Alpha
                        - generic [ref=e264]: Worked for 32s
                      - button "Expand read files, used tools (3 activities)" [ref=e269]:
                        - generic "Read files, used tools" [ref=e276]
                    - paragraph [ref=e282]: "Reply generation 0: Same first message"
                    - generic [ref=e283]:
                      - generic [ref=e284]: 11:53 AM
                      - generic [ref=e285]:
                        - button "Copy message" [ref=e286]
                        - button "Helpful" [ref=e290]
                        - button "Needs work" [ref=e293]
                - generic [ref=e299]:
                  - generic [ref=e303]:
                    - textbox "editable markdown" [ref=e305]:
                      - paragraph [ref=e306]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e307]:
                    - button "Attach file" [ref=e308]
                    - button "Auto mode" [ref=e310]
                    - button "Send" [disabled] [ref=e313]
        - complementary [ref=e316]:
          - separator "Resize panel" [ref=e317]
          - region "Side panel" [ref=e320]:
            - generic [ref=e321]:
              - generic [ref=e324]:
                - tablist [ref=e325]:
                  - generic [ref=e328]:
                    - tab "Artifacts" [selected] [ref=e329]
                    - button "Close Artifacts" [ref=e331]
                  - status [ref=e335]
                - button "Open a new tab" [ref=e337]
              - generic [ref=e339]:
                - button "Maximize side panel" [ref=e340]
                - button "Close side panel" [ref=e341]
            - tabpanel "Artifacts" [ref=e344]:
              - generic [ref=e345]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e346]:
    - heading "Command Palette" [level=2] [ref=e347]
    - paragraph [ref=e348]: Search for a command to run...
```

# Test source

```ts
  183 |                   : [],
  184 |                 runs: ledger.map((run: any) => ({
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
  259 |         const replies = await json(
  260 |           await request.get(`/api/issues/${issue.id}/comments`),
  261 |         );
  262 |         const live = await json(
  263 |           await request.get(`/api/issues/${issue.id}/live-runs`),
  264 |         );
  265 |         lastDiagnostic = JSON.stringify({
  266 |           issueId: issue.id,
  267 |           status: issue.status,
  268 |           conversationState: issue.conversationState,
  269 |           agentReplyCount: replies.filter((c: any) => c.authorAgentId).length,
  270 |           liveRunStates: live.map((run: any) => run.status),
  271 |         });
  272 |         return (
  273 |           live.length === 0 &&
  274 |           issue.conversationState === "waiting" &&
  275 |           issue.status === "in_review" &&
  276 |           replies.filter((c: any) => c.authorAgentId).length >= minimumReplies
  277 |         );
  278 |       },
  279 |       { timeout: 60_000, intervals: [100, 250, 500] },
  280 |       )
  281 |       .toBe(true);
  282 |   } catch (error) {
> 283 |     throw new Error(`${error instanceof Error ? error.message : String(error)}\nLatest chat idle state: ${lastDiagnostic}`);
      |           ^ Error: expect(received).toBe(expected) // Object.is equality
  284 |   }
  285 |   return issue;
  286 | }
  287 | 
```