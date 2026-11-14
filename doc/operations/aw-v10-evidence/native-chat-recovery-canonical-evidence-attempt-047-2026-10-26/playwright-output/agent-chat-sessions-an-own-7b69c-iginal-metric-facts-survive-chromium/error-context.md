# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:212:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
Latest chat idle state: {"issueId":"3c0eb986-7b2e-49af-81e7-1390d79c4ede","status":"blocked","conversationState":"active","agentReplyCount":0,"liveRunStates":[]}
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
          - button "Open Agent Chat 1793021815492 organization switcher" [ref=e12]:
            - generic [ref=e13]:
              - generic [ref=e14]: A
              - generic "Agent Chat 1793021815492" [ref=e17]
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
                - link "Management reviews" [ref=e79] [cursor=pointer]:
                  - /url: /AGE/management-reviews
                - link "Business metrics" [ref=e85] [cursor=pointer]:
                  - /url: /AGE/business-metrics
                - link "AI Governance" [ref=e92] [cursor=pointer]:
                  - /url: /AGE/ai-governance
                - link "Projects" [ref=e97] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=e102] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=e109]:
              - link "Connections" [ref=e110] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=e120] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=e126]:
              - generic [ref=e128]:
                - button "Collapse Advanced" [expanded] [ref=e129]
                - generic [ref=e132]: Advanced
              - generic [ref=e135]:
                - link "Skills" [ref=e136] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=e149] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=e156]:
              - generic [ref=e157]:
                - generic [ref=e158]: Chats
                - button "Chat with an agent" [ref=e159]
              - generic [ref=e160]:
                - link "Alpha" [ref=e161] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
                - button "Star Alpha" [ref=e167]
        - button "Open account menu" [ref=e170]:
          - generic [ref=e171]: AR
          - generic [ref=e173]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=e174]
    - generic [ref=e176]:
      - region "Global utilities" [ref=e178]:
        - generic [ref=e181]:
          - generic [ref=e182]: Language
          - combobox "Language" [ref=e183]:
            - option "English" [selected]
            - option "Dansk"
        - link "Help / Support" [ref=e184] [cursor=pointer]:
          - /url: /AGE/company/help
        - link "Contact support" [ref=e185] [cursor=pointer]:
          - /url: mailto:support@blentera.com
        - link "User account" [ref=e186] [cursor=pointer]:
          - /url: /AGE/company/settings/instance/profile
      - generic [ref=e190]:
        - generic [ref=e191]:
          - generic [ref=e192]:
            - navigation "breadcrumb" [ref=e194]:
              - list [ref=e195]:
                - listitem [ref=e196]:
                  - link "AL Alpha" [disabled] [ref=e197]:
                    - generic [ref=e198]: AL
                    - generic [ref=e201]: Alpha
                  - link "Configure Alpha" [ref=e203] [cursor=pointer]:
                    - /url: /AGE/agents/5555694f-3f62-441d-928d-2d3812de21c5/runtime
            - button "Hide properties" [ref=e204]
          - main [ref=e205]:
            - tabpanel [ref=e208]:
              - generic [ref=e210]:
                - generic [ref=e215]:
                  - generic [ref=e218]:
                    - paragraph [ref=e221]: fixture:eyJhY3Rpb24iOiJtZXRyaWMiLCJtZXRyaWNJZCI6IjI0YWZiNzM1LTAyMTgtNDgxYy04NjMxLTdhN2FjMDdjYjM5OCIsInZlcnNpb25JZCI6ImVlMDg5ZmQzLTI4ZGQtNDEwMi04OTMxLWFmMDZlMmI2ZDI5NyIsImZyb20iOiIyMDI2LTEwLTI1VDEzOjM2OjU2LjI5N1oiLCJ1bnRpbCI6IjIwMjYtMTAtMjZUMTM6MzY6NTcuMjk3WiJ9
                    - generic [ref=e222]: 1:36 PM
                  - separator "Run failed" [ref=e224]:
                    - generic [ref=e226]:
                      - generic [ref=e231]: Run failed
                      - generic [ref=e232]: · The run failed (adapter_failed). You can retry this message now.
                  - separator "Run failed" [ref=e235]:
                    - generic [ref=e237]:
                      - generic [ref=e242]: Run failed
                      - generic [ref=e243]: · The run failed (adapter_failed). You can retry this message now.
                      - button "Try again" [ref=e244]
                  - 'group "System update: No live execution path" [ref=e247]':
                    - generic [ref=e248]:
                      - button "No live execution path · just now" [ref=e249]:
                        - generic [ref=e252]: No live execution path
                        - generic [ref=e253]: · just now
                      - button "Try again" [ref=e256]
                - generic [ref=e260]:
                  - generic [ref=e264]:
                    - textbox "editable markdown" [ref=e266]:
                      - paragraph [ref=e267]
                    - generic:
                      - paragraph: Message Alpha — describe what you want done…
                  - generic [ref=e268]:
                    - button "Attach file" [ref=e269]
                    - button "Auto mode" [ref=e271]
                    - button "Send" [disabled] [ref=e274]
        - complementary [ref=e277]:
          - separator "Resize panel" [ref=e278]
          - region "Side panel" [ref=e281]:
            - generic [ref=e282]:
              - generic [ref=e285]:
                - tablist [ref=e286]:
                  - generic [ref=e289]:
                    - tab "Artifacts" [selected] [ref=e290]
                    - button "Close Artifacts" [ref=e292]
                  - status [ref=e296]
                - button "Open a new tab" [ref=e298]
              - generic [ref=e300]:
                - button "Maximize side panel" [ref=e301]
                - button "Close side panel" [ref=e302]
            - tabpanel "Artifacts" [ref=e305]:
              - generic [ref=e306]: No artifacts yet. Work products, documents, and agent-produced files will appear here.
  - generic [ref=e307]:
    - heading "Command Palette" [level=2] [ref=e308]
    - paragraph [ref=e309]: Search for a command to run...
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
      |           ^ Error: expect(received).toBe(expected) // Object.is equality
  286 |   }
  287 |   return issue;
  288 | }
  289 | 
```