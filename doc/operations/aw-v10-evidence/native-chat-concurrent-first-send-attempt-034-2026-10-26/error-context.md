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
Latest chat idle state: {"issueId":"f85bbb31-fb07-403a-a5f6-842b7fbdb973","status":"blocked","conversationState":"active","agentReplyCount":0,"liveRunStates":[]}
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
          - button "Open Agent Chat 1793016225261 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793016225261" [ref=e17]
          - navigation [ref=e18]:
            - generic [ref=e19]:
              - button "New Task" [ref=e20]
              - link "Search" [ref=e25] [cursor=pointer]:
                - /url: /AGE/search
              - link "Overview" [ref=e31] [cursor=pointer]:
                - /url: /AGE/dashboard
              - link "Agents" [ref=e39] [cursor=pointer]:
                - /url: /AGE/agents
              - link "Inbox 1" [ref=e47] [cursor=pointer]:
                - /url: /AGE/inbox
                - generic [ref=e53]: Inbox
                - generic [ref=e54]: "1"
            - generic [ref=e55]:
              - generic [ref=e57]:
                - button "Collapse Work" [expanded] [ref=e58]
                - generic [ref=e61]: Work
              - generic [ref=e64]:
                - link "Tasks" [ref=e65] [cursor=pointer]:
                  - /url: /AGE/issues
                - link "Routines" [ref=e71] [cursor=pointer]:
                  - /url: /AGE/routines
                - link "Projects" [ref=e79] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=e84] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=e91]:
              - link "Connections" [ref=e92] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=e102] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=e108]:
              - generic [ref=e110]:
                - button "Collapse Advanced" [expanded] [ref=e111]
                - generic [ref=e114]: Advanced
              - generic [ref=e117]:
                - link "Skills" [ref=e118] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=e131] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=e138]:
              - generic [ref=e139]:
                - generic [ref=e140]: Chats
                - button "Chat with an agent" [ref=e141]
              - generic [ref=e142]:
                - link "Alpha" [ref=e143] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
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
          - /url: /AGE/company/help
        - link "Contact support" [ref=e167] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e168] [cursor=pointer]:
          - /url: /AGE/company/settings/instance/profile
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
                    - /url: /AGE/agents/3306dcb3-c5b9-49c9-b135-cc65b4994a13/runtime
            - button "Hide properties" [ref=e186]
          - main [ref=e187]:
            - tabpanel [ref=e190]:
              - generic [ref=e192]:
                - generic [ref=e197]:
                  - generic [ref=e200]:
                    - paragraph [ref=e203]: Same first message
                    - generic [ref=e204]: 12:03 PM
                  - separator "Run failed" [ref=e206]:
                    - generic [ref=e208]:
                      - generic [ref=e213]: Run failed
                      - generic [ref=e214]: · The run failed (adapter_failed). You can retry this message now.
                  - generic [ref=e217]:
                    - paragraph [ref=e220]: Same first message
                    - generic [ref=e221]: 12:03 PM
                  - separator "Run failed" [ref=e223]:
                    - generic [ref=e225]:
                      - generic [ref=e230]: Run failed
                      - generic [ref=e231]: · The run failed (setup_failed). You can retry this message now.
                      - button "Try again" [ref=e232]
                  - 'group "System update: No live execution path" [ref=e235]':
                    - generic [ref=e236]:
                      - button "No live execution path · just now" [ref=e237]:
                        - generic [ref=e240]: No live execution path
                        - generic [ref=e241]: · just now
                      - button "Try again" [ref=e244]
                - generic [ref=e248]:
                  - generic [ref=e252]:
                    - textbox "editable markdown" [ref=e254]:
                      - paragraph [ref=e255]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e256]:
                    - button "Attach file" [ref=e257]
                    - button "Auto mode" [ref=e259]
                    - button "Send" [disabled] [ref=e262]
        - complementary [ref=e265]:
          - separator "Resize panel" [ref=e266]
          - region "Side panel" [ref=e269]:
            - generic [ref=e270]:
              - generic [ref=e273]:
                - tablist [ref=e274]:
                  - generic [ref=e277]:
                    - tab "Artifacts" [selected] [ref=e278]
                    - button "Close Artifacts" [ref=e280]
                  - status [ref=e284]
                - button "Open a new tab" [ref=e286]
              - generic [ref=e288]:
                - button "Maximize side panel" [ref=e289]
                - button "Close side panel" [ref=e290]
            - tabpanel "Artifacts" [ref=e293]:
              - generic [ref=e294]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e295]:
    - heading "Command Palette" [level=2] [ref=e296]
    - paragraph [ref=e297]: Search for a command to run...
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