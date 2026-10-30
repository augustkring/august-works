# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:214:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
Latest chat idle state: {"issueId":"6104a13a-8492-4b37-9594-b477dc5563a9","status":"blocked","conversationState":"active","agentReplyCount":1,"liveRunStates":[]}
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