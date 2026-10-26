import { execFileSync } from "node:child_process";
import path from "node:path";
import { createLocalAgentJwt } from "../../server/src/agent-auth-jwt";
import {
  test,
  expect,
  request as createRequestContext,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Per-file Playwright configuration (test.use, test.setTimeout) must stay in
// the spec files themselves: calling test.use() from a shared helper makes
// Playwright fail the whole worker with "inconsistent test.use() options".
export async function json(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
export async function setup(request: APIRequestContext, page?: Page) {
  let instanceControlRequest = request;
  let apiKeyId: string | undefined;
  let ownsApiRequest = false;
  const pageContext = page?.context();
  const config = page ? process.env.PAPERCLIP_E2E_SERVER_CONFIG : undefined;
  const authenticated = !!page && process.env.PAPERCLIP_E2E_AUTH_MODE === "authenticated";
  const nativeChat = !!page && process.env.PAPERCLIP_E2E_NATIVE_CHAT === "true";
  const baseURL = process.env.PAPERCLIP_API_URL
    ?? `http://127.0.0.1:${process.env.PAPERCLIP_E2E_PORT ?? "3199"}`;
  if (authenticated) {
    if (!config || !baseURL) throw new Error("An isolated authenticated E2E server is required for agent chat");
    request = page!.request;
    instanceControlRequest = request;
    // The isolated instance has one bootstrap Human claim. Reuse that account
    // across this serial browser lane instead of attempting a second claim in
    // every test; each test still creates an independent company and agents.
    const email = `agent-chat-owner-${process.env.PAPERCLIP_E2E_PORT ?? "3199"}@test.invalid`;
    const password = "Agent-chat browser test passphrase 2026!";
    const login = await request.post("/api/auth/sign-in/email", { data: { email, password } });
    if (login.status() === 401 || login.status() === 404) {
      await json(await request.post("/api/auth/sign-up/email", { data: {
        name: "Authenticated agent-chat reviewer", email, password,
      } }));
      const invitation = execFileSync("pnpm", [
        "--filter", "@paperclipai/db", "exec", "tsx",
        path.resolve("packages/db/scripts/create-auth-bootstrap-invite.ts"),
        "--config", config,
        "--base-url", baseURL,
      ], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
      const invitationToken = new URL(invitation).pathname.split("/").at(-1);
      if (!invitationToken) throw new Error("Authenticated agent-chat bootstrap invitation was malformed");
      await json(await request.post(`/api/invites/${invitationToken}/accept`, { data: { requestType: "human" } }));
    } else if (!login.ok()) {
      throw new Error(`Authenticated agent-chat login failed: ${login.status()} ${await login.text()}`);
    }
  }
  const company = await json(
    await request.post("/api/companies", {
      data: { name: `Agent Chat ${Date.now()}` },
    }),
  );
  if (page) {
    if (!authenticated) {
      if (!config || !baseURL) throw new Error("An isolated E2E server is required for the local-trusted chat fixture");
      const key = JSON.parse(execFileSync("pnpm", [
        "--filter", "@paperclipai/server", "exec", "tsx",
        path.resolve("tests/e2e/fixtures/create-agent-chat-board-key.ts"),
        "--config", config,
        "--company-id", company.id,
      ], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] })) as { id: string; token: string };
      apiKeyId = key.id;
      request = await createRequestContext.newContext({
        baseURL,
        extraHTTPHeaders: { Authorization: `Bearer ${key.token}` },
      });
      ownsApiRequest = true;
      await pageContext!.route("**/api/**", (route) => route.continue({
        headers: { ...route.request().headers(), authorization: `Bearer ${key.token}` },
      }));
    }
  }
  const original = await json(
    await instanceControlRequest.get("/api/instance/settings/experimental"),
  );
  await json(
    await instanceControlRequest.patch("/api/instance/settings/experimental", {
      data: { enableAgentChat: true, enableClassicTaskInterface: false,
        ...(nativeChat ? { enableNativeRunner: true } : {}) },
    }),
  );
  const agents = [];
  for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"])
    agents.push(
      await json(
        await request.post(`/api/companies/${company.id}/agents`, {
          data: {
            name,
            adapterType: nativeChat ? "paperclip_runner" : "process",
            adapterConfig: nativeChat ? { provider: "codex", model: "gpt-5.1-codex-mini" } : {
              command: process.execPath,
              args: [path.resolve("tests/e2e/fixtures/agent-chat.mjs")],
              graceSec: 1,
            },
            runtimeConfig: {
              heartbeat: { enabled: false, wakeOnDemand: true },
            },
          },
        }),
      ),
    );
  const agent = agents[0];
  const chatPath = `/api/companies/${company.id}/chats/${agent.id}`;
  const route = `/${company.issuePrefix}/chats/${agent.id}`;
  return {
    company,
    agents,
    agent,
    chatPath,
    route,
    restore: async (options?: { collectState?: boolean }) => {
      try {
        if (options?.collectState === false) return;
        const chat = await request.get(chatPath);
        const history = chat.ok() ? await chat.json() : null;
        const tasks = await json(
          await request.get(`/api/companies/${company.id}/issues`),
        );
        const projects = await json(
          await request.get(`/api/companies/${company.id}/projects`),
        );
        const ledger = await json(
          await request.get(`/api/companies/${company.id}/heartbeat-runs`),
        );
        const runDetails = await Promise.all(ledger.map(async (run: any) => {
          const response = await request.get(`/api/heartbeat-runs/${run.id}`);
          if (!response.ok()) return { id: run.id, detailStatus: response.status() };
          const detail = await response.json();
          return {
            id: run.id,
            status: detail.status,
            errorCode: detail.errorCode ?? null,
            exitCode: detail.exitCode ?? null,
            signal: detail.signal ?? null,
            nativePhase: detail.nativePhase ?? null,
            issueMatchesChat: detail.issueId === history?.id,
            nativeIssueMatchesChat: detail.nativeIssueId === history?.id,
            humanMatchesChatOwner: detail.responsibleUserId === history?.responsibleUserId,
            executionRunMatchesChat: history?.executionRunId === detail.id,
          };
        }));
        const documents = await Promise.all(
          [...(history ? [history] : []), ...tasks].map(async (task: any) => ({
            taskId: task.id,
            documents: await json(
              await request.get(`/api/issues/${task.id}/documents`),
            ),
          })),
        );
        await test.info().attach("chat-persisted-state", {
          contentType: "application/json",
          body: Buffer.from(
            JSON.stringify(
              {
                chat: history,
                tasks,
                projects,
                documents,
                runDetails,
                comments: history
                  ? await json(
                      await request.get(`/api/issues/${history.id}/comments`),
                    )
                  : [],
                runs: ledger.map((run: any) => ({
                  id: run.id,
                  status: run.status,
                  startedAt: run.startedAt,
                  finishedAt: run.finishedAt,
                  sessionIdBefore: run.sessionIdBefore,
                  sessionIdAfter: run.sessionIdAfter,
                  issueId: run.contextSnapshot?.issueId,
                  generation:
                    run.contextSnapshot?.conversationSessionGeneration,
                  reset: run.contextSnapshot?.conversationReset,
                })),
              },
              null,
              2,
            ),
          ),
        });
      } finally {
        const runs = await json(
          await request.get(`/api/companies/${company.id}/live-runs`),
        );
        for (const run of runs)
          await json(
            await request.post(`/api/heartbeat-runs/${run.id}/cancel`),
          );
        await json(
          await instanceControlRequest.patch("/api/instance/settings/experimental", {
            data: {
              enableAgentChat: original.enableAgentChat,
              enableClassicTaskInterface: original.enableClassicTaskInterface,
              ...(nativeChat ? { enableNativeRunner: original.enableNativeRunner } : {}),
            },
          }),
        );
        if (apiKeyId) await request.delete(`/api/board-api-keys/${apiKeyId}`);
        if (pageContext) await pageContext.unroute("**/api/**");
        if (ownsApiRequest) await request.dispose();
      }
    },
    request,
  };
}
export async function send(page: Page, value: unknown) {
  await page
    .getByTestId("task-chat-composer-input")
    .last()
    .locator('[contenteditable="true"],textarea')
    .first()
    .fill(
      typeof value === "string"
        ? value
        : `fixture:${Buffer.from(JSON.stringify(value)).toString("base64url")}`,
    );
  await page.getByTestId("task-chat-composer-send").last().click();
}
export async function idle(
  request: APIRequestContext,
  chatPath: string,
  minimumReplies = 1,
) {
  let issue: any;
  let lastDiagnostic = "not polled";
  try {
    await expect
      .poll(
      async () => {
        issue = await json(await request.get(chatPath));
        if (!issue) return false;
        const replies = await json(
          await request.get(`/api/issues/${issue.id}/comments`),
        );
        const live = await json(
          await request.get(`/api/issues/${issue.id}/live-runs`),
        );
        lastDiagnostic = JSON.stringify({
          issueId: issue.id,
          status: issue.status,
          conversationState: issue.conversationState,
          agentReplyCount: replies.filter((c: any) => c.authorAgentId).length,
          liveRunStates: live.map((run: any) => run.status),
        });
        return (
          live.length === 0 &&
          issue.conversationState === "waiting" &&
          issue.status === "in_review" &&
          replies.filter((c: any) => c.authorAgentId).length >= minimumReplies
        );
      },
      { timeout: 60_000, intervals: [100, 250, 500] },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nLatest chat idle state: ${lastDiagnostic}`);
  }
  return issue;
}
