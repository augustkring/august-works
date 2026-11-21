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
Latest chat idle state: {"issueId":"c540a71c-5a0d-4e7f-a15c-8a633112ac83","status":"blocked","conversationState":"active","agentReplyCount":1,"liveRunStates":[]}
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