# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> sidebar discovery, stars, recent agents, configuration links, and drafts survive switching
- Location: tests/e2e/agent-chat-sessions.spec.ts:388:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
Latest chat idle state: {"issueId":"65c4fbaf-60ad-49b2-bb0c-53963e1f6646","status":"in_progress","conversationState":"active","agentReplyCount":0,"liveRunStates":["running"]}
```

# Page snapshot

```yaml
- generic [ref=f7e4]:
  - link "Skip to Main Content" [ref=f7e5] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=f7e6]:
    - generic [ref=f7e7]:
      - generic [ref=f7e8]:
        - complementary [ref=f7e10]:
          - button "Open Agent Chat 1793024648372 organization switcher" [ref=f7e12]:
            - generic [ref=f7e13]:
              - generic [ref=f7e14]: A
              - generic "Agent Chat 1793024648372" [ref=f7e17]
          - navigation [ref=f7e18]:
            - generic [ref=f7e19]:
              - button "New Task" [ref=f7e20]
              - link "Search" [ref=f7e25] [cursor=pointer]:
                - /url: /AGE/search
              - link "Overview 1 live" [ref=f7e31] [cursor=pointer]:
                - /url: /AGE/dashboard
                - generic [ref=f7e38]: Overview
                - generic [ref=f7e39]: 1 live
              - link "Agents" [ref=f7e44] [cursor=pointer]:
                - /url: /AGE/agents
              - link "Inbox" [ref=f7e52] [cursor=pointer]:
                - /url: /AGE/inbox
            - generic [ref=f7e58]:
              - generic [ref=f7e60]:
                - button "Collapse Work" [expanded] [ref=f7e61]
                - generic [ref=f7e64]: Work
              - generic [ref=f7e67]:
                - link "Tasks" [ref=f7e68] [cursor=pointer]:
                  - /url: /AGE/issues
                - link "Routines" [ref=f7e74] [cursor=pointer]:
                  - /url: /AGE/routines
                - link "Projects" [ref=f7e82] [cursor=pointer]:
                  - /url: /AGE/projects
                - link "Artifacts" [ref=f7e87] [cursor=pointer]:
                  - /url: /AGE/artifacts
            - generic [ref=f7e94]:
              - link "Connections" [ref=f7e95] [cursor=pointer]:
                - /url: /AGE/apps
              - link "Governance" [ref=f7e105] [cursor=pointer]:
                - /url: /AGE/governance
            - generic [ref=f7e111]:
              - generic [ref=f7e113]:
                - button "Collapse Advanced" [expanded] [ref=f7e114]
                - generic [ref=f7e117]: Advanced
              - generic [ref=f7e120]:
                - link "Skills" [ref=f7e121] [cursor=pointer]:
                  - /url: /AGE/skills
                - link "Audit" [ref=f7e134] [cursor=pointer]:
                  - /url: /AGE/activity
            - region "Chats" [ref=f7e141]:
              - generic [ref=f7e142]:
                - generic [ref=f7e143]: Chats
                - button "Chat with an agent" [ref=f7e144]
              - generic [ref=f7e145]:
                - link "Alpha" [ref=f7e146] [cursor=pointer]:
                  - /url: /AGE/chats/alpha
                - button "Unstar Alpha" [pressed] [ref=f7e152]
              - generic [ref=f7e153]:
                - link "Zeta" [ref=f7e154] [cursor=pointer]:
                  - /url: /AGE/chats/zeta
                - button "Unstar Zeta" [pressed] [ref=f7e160]
              - generic [ref=f7e161]:
                - link "Epsilon" [ref=f7e162] [cursor=pointer]:
                  - /url: /AGE/chats/epsilon
                - button "Star Epsilon" [ref=f7e168]
              - generic [ref=f7e169]:
                - link "Delta" [ref=f7e170] [cursor=pointer]:
                  - /url: /AGE/chats/delta
                - button "Star Delta" [ref=f7e176]
              - generic [ref=f7e177]:
                - link "Gamma" [ref=f7e178] [cursor=pointer]:
                  - /url: /AGE/chats/gamma
                - button "Star Gamma" [ref=f7e184]
              - generic [ref=f7e185]:
                - link "Beta" [ref=f7e186] [cursor=pointer]:
                  - /url: /AGE/chats/beta
                - button "Star Beta" [ref=f7e192]
        - button "Open account menu" [ref=f7e195]:
          - generic [ref=f7e196]: AR
          - generic [ref=f7e198]: Authenticated agent-chat reviewer
      - separator "Resize sidebar" [ref=f7e199]
    - generic [ref=f7e201]:
      - generic [ref=f7e202]:
        - region "Global utilities" [ref=f7e203]:
          - generic [ref=f7e206]:
            - generic [ref=f7e207]: Language
            - combobox "Language" [ref=f7e208]:
              - option "English" [selected]
              - option "Dansk"
          - link "Help / Support" [ref=f7e209] [cursor=pointer]:
            - /url: /AGE/company/help
          - link "Contact support" [ref=f7e210] [cursor=pointer]:
            - /url: mailto:support@blentera.com
          - link "User account" [ref=f7e211] [cursor=pointer]:
            - /url: /AGE/company/settings/instance/profile
        - navigation "breadcrumb" [ref=f7e218]:
          - list [ref=f7e219]:
            - listitem [ref=f7e220]:
              - link "Agents" [ref=f7e221] [cursor=pointer]:
                - /url: /AGE/agents
            - listitem [ref=f7e222]
            - listitem [ref=f7e225]:
              - link "Alpha" [ref=f7e226] [cursor=pointer]:
                - /url: /AGE/agents/alpha/overview
            - listitem [ref=f7e227]
            - listitem [ref=f7e230]:
              - link "Harness / Runtime" [disabled] [ref=f7e231]
      - generic [ref=f7e232]:
        - complementary [ref=f7e234]:
          - navigation "Alpha navigation" [ref=f7e235]:
            - generic [ref=f7e236]:
              - paragraph [ref=f7e237]: Agent
              - generic [ref=f7e238]:
                - link "Overview" [ref=f7e239] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/overview
                - link "Instructions" [ref=f7e245] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/instructions
                - link "Skills" [ref=f7e250] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/skills
            - generic [ref=f7e255]:
              - paragraph [ref=f7e256]: Runtime
              - generic [ref=f7e257]:
                - link "Harness / Runtime" [ref=f7e258] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/runtime
                - link "Secrets & variables" [ref=f7e264] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/secrets
                - link "Tools" [ref=f7e270] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/tools
            - generic [ref=f7e275]:
              - paragraph [ref=f7e276]: Governance
              - generic [ref=f7e277]:
                - link "Permissions / Trust" [ref=f7e278] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/permissions
                - link "API Keys" [ref=f7e284] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/api-keys
                - link "Revisions" [ref=f7e290] [cursor=pointer]:
                  - /url: /AGE/agents/alpha/revisions
            - generic [ref=f7e297]:
              - paragraph [ref=f7e298]: Audit
              - generic [ref=f7e299]:
                - link "Activity" [ref=f7e300] [cursor=pointer]:
                  - /url: /AGE/activity?mode=agents&agentId=4bdda39d-265a-48ad-a69b-87a198a5c2aa
                - link "Runs" [ref=f7e305] [cursor=pointer]:
                  - /url: /AGE/activity/runs?agentId=4bdda39d-265a-48ad-a69b-87a198a5c2aa
                - link "Costs" [ref=f7e311] [cursor=pointer]:
                  - /url: /AGE/activity/costs?agentId=4bdda39d-265a-48ad-a69b-87a198a5c2aa
                - link "Budgets" [ref=f7e316] [cursor=pointer]:
                  - /url: /AGE/activity/budgets?agentId=4bdda39d-265a-48ad-a69b-87a198a5c2aa
        - main [active] [ref=f7e323]:
          - generic [ref=f7e324]:
            - generic [ref=f7e325]:
              - generic [ref=f7e326]:
                - img "Alpha avatar" [ref=f7e327]
                - generic [ref=f7e331]:
                  - heading "Alpha" [level=1] [ref=f7e332]
                  - generic [ref=f7e333]:
                    - generic [ref=f7e334]: Blentera Runner
                    - generic [ref=f7e335]: ·
                    - generic [ref=f7e336]: General
              - generic [ref=f7e337]:
                - button "Unstar Alpha" [pressed] [ref=f7e338]
                - generic [ref=f7e339]:
                  - button "Assign Task" [ref=f7e340]
                  - button "Run now" [ref=f7e342]
                  - button "Run with provider trace" [ref=f7e344]
                  - button "Pause" [ref=f7e346]
                  - button "Open actions for Alpha" [ref=f7e348]
            - heading "Harness / Runtime" [level=2] [ref=f7e349]
            - generic [ref=f7e352]:
              - generic [ref=f7e353]:
                - heading "Agent identity" [level=3] [ref=f7e354]
                - generic [ref=f7e355]:
                  - generic [ref=f7e356]:
                    - generic [ref=f7e357]:
                      - generic [ref=f7e358]: Name
                      - button [ref=f7e359]
                    - textbox "Agent name" [ref=f7e363]: Alpha
                  - generic [ref=f7e364]:
                    - generic [ref=f7e365]:
                      - generic [ref=f7e366]: Title
                      - button [ref=f7e367]
                    - textbox "e.g. VP of Engineering" [ref=f7e371]
                  - generic [ref=f7e372]:
                    - generic [ref=f7e373]:
                      - generic [ref=f7e374]: Reports to
                      - button [ref=f7e375]
                    - button "Choose manager…" [ref=f7e379]
              - generic [ref=f7e384]:
                - heading "Adapter" [level=3] [ref=f7e386]
                - generic [ref=f7e387]:
                  - generic [ref=f7e388]:
                    - generic [ref=f7e389]:
                      - generic [ref=f7e390]: Adapter type
                      - button [ref=f7e391]
                    - button "Blentera Runner Experimental" [ref=f7e395]:
                      - generic [ref=f7e396]:
                        - generic [ref=f7e397]: Blentera Runner
                        - generic [ref=f7e398]: Experimental
                  - generic [ref=f7e401]:
                    - heading "Existing authentication — not managed by Connections" [level=3] [ref=f7e402]
                    - paragraph [ref=f7e403]: This agent keeps its current authentication until you choose and test a managed connection. Confirm the account and who may use it before adopting.
                    - button "Choose a managed connection" [ref=f7e404]
                  - generic [ref=f7e405]:
                    - generic [ref=f7e406]:
                      - generic [ref=f7e407]: Provider
                      - button [ref=f7e408]
                    - combobox [ref=f7e412]:
                      - option "Codex" [selected]
                      - option "OpenCode 1.18.32"
                      - option "Claude Managed"
                      - option "AWS AgentCore"
                      - option "ACPX Claude"
                  - generic [ref=f7e413]:
                    - generic [ref=f7e414]:
                      - generic [ref=f7e415]: Model
                      - button [ref=f7e416]
                    - button "gpt-5.1-codex-mini" [ref=f7e420]
              - generic [ref=f7e424]:
                - heading "Configuration" [level=3] [ref=f7e425]
                - button "Advanced" [ref=f7e428]
              - generic [ref=f7e431]:
                - heading "Environment variables" [level=3] [ref=f7e432]
                - generic [ref=f7e434]:
                  - paragraph [ref=f7e435]: No environment variables
                  - button "Add variable" [ref=f7e437]
                  - paragraph [ref=f7e439]: Set the KEY to the env var name the process expects, for example GH_TOKEN. Choose a secret to resolve a stored value at run start. PAPERCLIP_* variables are injected automatically.
              - generic [ref=f7e440]:
                - heading "Run Policy" [level=3] [ref=f7e441]
                - generic [ref=f7e444]:
                  - generic [ref=f7e447]:
                    - generic [ref=f7e448]:
                      - generic [ref=f7e449]: Heartbeat on interval
                      - button [ref=f7e450]
                    - switch [ref=f7e454]
                  - button "Advanced Run Policy" [ref=f7e456]
              - generic [ref=f7e459]:
                - heading "Debugging" [level=3] [ref=f7e460]
                - generic [ref=f7e471]:
                  - generic [ref=f7e472]:
                    - generic [ref=f7e473]: Capture raw provider traces
                    - button [ref=f7e474]
                  - switch [ref=f7e478]
              - region "Runtime test" [ref=f7e479]:
                - generic [ref=f7e484]:
                  - status [ref=f7e485]:
                    - heading "Test your agent" [level=3] [ref=f7e486]
                    - paragraph [ref=f7e487]: Check that your runtime and model can respond.
                  - button "Run test" [ref=f7e488]
            - generic [ref=f7e489]:
              - status
              - generic [ref=f7e490]:
                - button "Discard" [disabled]
                - button "Save changes" [disabled]
  - generic [ref=f7e491]:
    - heading "Command Palette" [level=2] [ref=f7e492]
    - paragraph [ref=f7e493]: Search for a command to run...
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