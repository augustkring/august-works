# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:214:1

# Error details

```
Error: 409 {"error":"Metric owner must be a current company human principal"}

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1   | import { execFileSync } from "node:child_process";
  2   | import path from "node:path";
  3   | import { createLocalAgentJwt } from "../../server/src/agent-auth-jwt";
  4   | import {
  5   |   test,
  6   |   expect,
  7   |   request as createRequestContext,
  8   |   type APIRequestContext,
  9   |   type Page,
  10  | } from "@playwright/test";
  11  | 
  12  | // Per-file Playwright configuration (test.use, test.setTimeout) must stay in
  13  | // the spec files themselves: calling test.use() from a shared helper makes
  14  | // Playwright fail the whole worker with "inconsistent test.use() options".
  15  | export async function json(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
> 16  |   expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(
      |                                                                          ^ Error: 409 {"error":"Metric owner must be a current company human principal"}
  17  |     true,
  18  |   );
  19  |   return response.json();
  20  | }
  21  | export async function setup(request: APIRequestContext, page?: Page) {
  22  |   let instanceControlRequest = request;
  23  |   let apiKeyId: string | undefined;
  24  |   let ownsApiRequest = false;
  25  |   const pageContext = page?.context();
  26  |   const config = page ? process.env.PAPERCLIP_E2E_SERVER_CONFIG : undefined;
  27  |   const authenticated = !!page && process.env.PAPERCLIP_E2E_AUTH_MODE === "authenticated";
  28  |   const nativeChat = !!page && process.env.PAPERCLIP_E2E_NATIVE_CHAT === "true";
  29  |   const baseURL = process.env.PAPERCLIP_API_URL
  30  |     ?? `http://127.0.0.1:${process.env.PAPERCLIP_E2E_PORT ?? "3199"}`;
  31  |   if (authenticated) {
  32  |     if (!config || !baseURL) throw new Error("An isolated authenticated E2E server is required for agent chat");
  33  |     request = page!.request;
  34  |     instanceControlRequest = request;
  35  |     // The isolated instance has one bootstrap Human claim. Reuse that account
  36  |     // across this serial browser lane instead of attempting a second claim in
  37  |     // every test; each test still creates an independent company and agents.
  38  |     const email = `agent-chat-owner-${process.env.PAPERCLIP_E2E_PORT ?? "3199"}@test.invalid`;
  39  |     const password = "Agent-chat browser test passphrase 2026!";
  40  |     const login = await request.post("/api/auth/sign-in/email", { data: { email, password } });
  41  |     if (login.status() === 401 || login.status() === 404) {
  42  |       await json(await request.post("/api/auth/sign-up/email", { data: {
  43  |         name: "Authenticated agent-chat reviewer", email, password,
  44  |       } }));
  45  |       const invitation = execFileSync("pnpm", [
  46  |         "--filter", "@paperclipai/db", "exec", "tsx",
  47  |         path.resolve("packages/db/scripts/create-auth-bootstrap-invite.ts"),
  48  |         "--config", config,
  49  |         "--base-url", baseURL,
  50  |       ], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  51  |       const invitationToken = new URL(invitation).pathname.split("/").at(-1);
  52  |       if (!invitationToken) throw new Error("Authenticated agent-chat bootstrap invitation was malformed");
  53  |       await json(await request.post(`/api/invites/${invitationToken}/accept`, { data: { requestType: "human" } }));
  54  |     } else if (!login.ok()) {
  55  |       throw new Error(`Authenticated agent-chat login failed: ${login.status()} ${await login.text()}`);
  56  |     }
  57  |   }
  58  |   const company = await json(
  59  |     await request.post("/api/companies", {
  60  |       data: { name: `Agent Chat ${Date.now()}` },
  61  |     }),
  62  |   );
  63  |   if (page) {
  64  |     if (!authenticated) {
  65  |       if (!config || !baseURL) throw new Error("An isolated E2E server is required for the local-trusted chat fixture");
  66  |       const key = JSON.parse(execFileSync("pnpm", [
  67  |         "--filter", "@paperclipai/server", "exec", "tsx",
  68  |         path.resolve("tests/e2e/fixtures/create-agent-chat-board-key.ts"),
  69  |         "--config", config,
  70  |         "--company-id", company.id,
  71  |       ], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] })) as { id: string; token: string };
  72  |       apiKeyId = key.id;
  73  |       request = await createRequestContext.newContext({
  74  |         baseURL,
  75  |         extraHTTPHeaders: { Authorization: `Bearer ${key.token}` },
  76  |       });
  77  |       ownsApiRequest = true;
  78  |       await pageContext!.route("**/api/**", (route) => route.continue({
  79  |         headers: { ...route.request().headers(), authorization: `Bearer ${key.token}` },
  80  |       }));
  81  |     }
  82  |   }
  83  |   const original = await json(
  84  |     await instanceControlRequest.get("/api/instance/settings/experimental"),
  85  |   );
  86  |   await json(
  87  |     await instanceControlRequest.patch("/api/instance/settings/experimental", {
  88  |       data: { enableAgentChat: true, enableClassicTaskInterface: false,
  89  |         ...(nativeChat ? { enableNativeRunner: true } : {}) },
  90  |     }),
  91  |   );
  92  |   const agents = [];
  93  |   for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"])
  94  |     agents.push(
  95  |       await json(
  96  |         await request.post(`/api/companies/${company.id}/agents`, {
  97  |           data: {
  98  |             name,
  99  |             adapterType: nativeChat ? "paperclip_runner" : "process",
  100 |             adapterConfig: nativeChat ? { provider: "codex", model: "gpt-5.1-codex-mini" } : {
  101 |               command: process.execPath,
  102 |               args: [path.resolve("tests/e2e/fixtures/agent-chat.mjs")],
  103 |               graceSec: 1,
  104 |             },
  105 |             runtimeConfig: {
  106 |               heartbeat: { enabled: false, wakeOnDemand: true },
  107 |             },
  108 |           },
  109 |         }),
  110 |       ),
  111 |     );
  112 |   const agent = agents[0];
  113 |   const chatPath = `/api/companies/${company.id}/chats/${agent.id}`;
  114 |   const route = `/${company.issuePrefix}/chats/${agent.id}`;
  115 |   return {
  116 |     company,
```