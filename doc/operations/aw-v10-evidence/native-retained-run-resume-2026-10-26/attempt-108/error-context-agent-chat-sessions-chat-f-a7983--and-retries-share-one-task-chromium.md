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
Latest chat idle state: {"issueId":"abe5ce22-32ce-4b2e-a1e6-6689689cb30c","status":"blocked","conversationState":"active","agentReplyCount":1,"liveRunStates":[]}
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
          - button "Open Agent Chat 1793050985474 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793050985474" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGEA/search
              - link "Overview" [ref=e31] [cursor=pointer]:
                - /url: /AGEA/dashboard
              - link "Agents" [ref=e39] [cursor=pointer]:
                - /url: /AGEA/agents
              - link "Inbox 1" [ref=e47] [cursor=pointer]:
                - /url: /AGEA/inbox
                - generic [ref=e53]: Inbox
                - generic [ref=e54]: "1"
            - generic [ref=e55]:
              - generic [ref=e57]:
                - button "Collapse Work" [expanded] [ref=e58]
                - generic [ref=e61]: Work
              - generic [ref=e64]:
                - link "Tasks" [ref=e65] [cursor=pointer]:
                  - /url: /AGEA/issues
                - link "Routines" [ref=e71] [cursor=pointer]:
                  - /url: /AGEA/routines
                - link "Projects" [ref=e79] [cursor=pointer]:
                  - /url: /AGEA/projects
                - link "Artifacts" [ref=e84] [cursor=pointer]:
                  - /url: /AGEA/artifacts
            - generic [ref=e91]:
              - link "Connections" [ref=e92] [cursor=pointer]:
                - /url: /AGEA/apps
              - link "Governance" [ref=e102] [cursor=pointer]:
                - /url: /AGEA/governance
            - generic [ref=e108]:
              - generic [ref=e110]:
                - button "Collapse Advanced" [expanded] [ref=e111]
                - generic [ref=e114]: Advanced
              - generic [ref=e117]:
                - link "Skills" [ref=e118] [cursor=pointer]:
                  - /url: /AGEA/skills
                - link "Audit" [ref=e131] [cursor=pointer]:
                  - /url: /AGEA/activity
            - region "Chats" [ref=e138]:
              - generic [ref=e139]:
                - generic [ref=e140]: Chats
                - button "Chat with an agent" [ref=e141]
              - generic [ref=e142]:
                - link "Alpha" [ref=e143] [cursor=pointer]:
                  - /url: /AGEA/chats/alpha
                - button "Star Alpha" [ref=e149]
        - button "Open account menu" [ref=e152]:
          - generic [ref=e153]: AR
          - generic [ref=e155]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=e156]
    - generic [ref=e158]:
      - region "Global utilities" [ref=e160]:
        - generic [ref=e163]:
          - generic [ref=e164]: Language
          - combobox "Language" [ref=e165]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=e166] [cursor=pointer]:
          - /url: /AGEA/company/help
        - link "Contact support" [ref=e167] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e168] [cursor=pointer]:
          - /url: /AGEA/company/settings/instance/profile
      - generic [ref=e172]:
        - generic [ref=e173]:
          - generic [ref=e174]:
            - navigation "breadcrumb" [ref=e176]:
              - list [ref=e177]:
                - listitem [ref=e178]:
                  - link "AL Alpha" [disabled] [ref=e179]:
                    - generic [ref=e180]: AL
                    - generic [ref=e183]: Alpha
                  - link "Configure Alpha" [ref=e185] [cursor=pointer]:
                    - /url: /AGEA/agents/1b9f035e-8bd8-4378-9803-00ca77b95df3/runtime
            - button "Hide properties" [ref=e186]
          - main [ref=e187]:
            - tabpanel [ref=e190]:
              - generic [ref=e192]:
                - generic [ref=e197]:
                  - generic [ref=e200]:
                    - paragraph [ref=e203]: Same first message
                    - generic [ref=e204]: 9:43 PM
                  - generic [ref=e206]:
                    - generic [ref=e208]:
                      - generic [ref=e209]:
                        - generic [ref=e210]: Alpha
                        - generic [ref=e214]: Worked for 35s
                      - button "Expand read files (2 activities)" [ref=e219]:
                        - generic "Read files" [ref=e224]
                    - paragraph [ref=e230]: "Reply generation 0: Same first message"
                    - generic [ref=e231]:
                      - generic [ref=e232]: 9:43 PM
                      - generic [ref=e233]:
                        - button "Copy message" [ref=e234]
                        - button "Helpful" [ref=e238]
                        - button "Needs work" [ref=e241]
                  - generic [ref=e245]:
                    - paragraph [ref=e248]: Same first message
                    - generic [ref=e249]: 9:43 PM
                  - separator "Run failed" [ref=e251]:
                    - generic [ref=e253]:
                      - generic [ref=e258]: Run failed
                      - generic [ref=e259]: · The run failed (adapter_failed). You can retry this message now.
                  - separator "Run failed" [ref=e262]:
                    - generic [ref=e264]:
                      - generic [ref=e269]: Run failed
                      - generic [ref=e270]: · The run failed (adapter_failed). You can retry this message now.
                      - button "Try again" [ref=e271]
                  - 'group "System update: No live execution path" [ref=e274]':
                    - generic [ref=e275]:
                      - button "No live execution path · just now" [ref=e276]:
                        - generic [ref=e279]: No live execution path
                        - generic [ref=e280]: · just now
                      - button "Try again" [ref=e283]
                - generic [ref=e287]:
                  - generic [ref=e291]:
                    - textbox "editable markdown" [ref=e293]:
                      - paragraph [ref=e294]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e295]:
                    - button "Attach file" [ref=e296]
                    - button "Auto mode" [ref=e298]
                    - button "Send" [disabled] [ref=e301]
        - complementary [ref=e304]:
          - separator "Resize panel" [ref=e305]
          - region "Side panel" [ref=e308]:
            - generic [ref=e309]:
              - generic [ref=e312]:
                - tablist [ref=e313]:
                  - generic [ref=e316]:
                    - tab "Artifacts" [selected] [ref=e317]
                    - button "Close Artifacts" [ref=e319]
                  - status [ref=e323]
                - button "Open a new tab" [ref=e325]
              - generic [ref=e327]:
                - button "Maximize side panel" [ref=e328]
                - button "Close side panel" [ref=e329]
            - tabpanel "Artifacts" [ref=e332]:
              - generic [ref=e333]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e334]:
    - heading "Command Palette" [level=2] [ref=e335]
    - paragraph [ref=e336]: Search for a command to run...
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