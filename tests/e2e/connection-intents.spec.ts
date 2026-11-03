import { expect, test, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { listenOnFetchAllowedPort } from "./fetch-allowed-port";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
import { withManagedConnectionIntent } from "./fixtures/managed-connection-intent";

registerEnglishAccountLocaleIsolation(test);

type Json = Record<string, unknown>;
type Seed = { companyId: string; prefix: string };
type Agent = { id: string; name: string };

async function json<T = Json>(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
): Promise<T> {
  expect(
    response.ok(),
    `${response.url()} failed ${response.status()}: ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

async function newCompany(request: APIRequestContext): Promise<Seed> {
  const company = await json<{ id: string; issuePrefix: string }>(
    await request.post("/api/companies", {
      data: { name: `Connection intent E2E ${Date.now()}` },
    }),
  );
  return { companyId: company.id, prefix: company.issuePrefix };
}

async function createAgent(
  request: APIRequestContext,
  companyId: string,
  name: string,
): Promise<Agent> {
  return await json<Agent>(
    await request.post(`/api/companies/${companyId}/agents`, {
      data: {
        name,
        role: "qa",
        title: "Connection intent fixture agent",
        capabilities: "Exercises deterministic connection intent wiring.",
        adapterType: "process",
        adapterConfig: {
          command: process.execPath,
          args: ["--input-type=module", "-e", "process.exit(0)"],
        },
      },
    }),
  );
}

async function startFakeProvider() {
  const captures: Array<{ method: string; toolName: string | null }> = [];
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const payload = JSON.parse(
      Buffer.concat(chunks).toString("utf8") || "{}",
    ) as {
      id?: string | number;
      method?: string;
      params?: { name?: string };
    };
    captures.push({
      method: String(payload.method ?? "<unknown>"),
      toolName: payload.params?.name ?? null,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (payload.method === "tools/list") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            tools: [
              {
                name: "notion:list_pages",
                title: "List fixture pages",
                description:
                  "Reads deterministic pages from the fake Notion provider.",
                inputSchema: {
                  type: "object",
                  properties: {},
                  additionalProperties: false,
                },
              },
            ],
          },
        }),
      );
      return;
    }
    if (payload.method === "tools/call") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            content: [{ type: "text", text: "Fixture page inventory" }],
          },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({ jsonrpc: "2.0", id: payload.id ?? null, result: {} }),
    );
  });
  const port = await listenOnFetchAllowedPort(server);
  return {
    url: `http://127.0.0.1:${port}/`,
    captures,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("the store refuses an opaque MCP action before provider dispatch", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const provider = await startFakeProvider();
  try {
    const seed = await newCompany(request);
    const holder = await createAgent(
      request,
      seed.companyId,
      "Existing access holder",
    );

    // Entry point one: connect and test the provider through the Connections store.
    await page.goto(`/${seed.prefix}/apps`);
    await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible({
      timeout: 30_000,
    });
    const customConnector = page
      .getByRole("list", { name: "Connections list" })
      .getByRole("listitem")
      .filter({ hasText: "Connect your own tool" });
    await customConnector.getByRole("button", { name: "Connect", exact: true }).click();
    await customConnector.getByRole("button", { name: "Connect your own MCP server" }).click();
    await page
      .getByPlaceholder("https://example.com/actions")
      .fill(provider.url);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.getByRole("button", { name: /Check link/i }).click();
    // A no-auth read-only provider can complete the access/install defaults in
    // one commit. Other methods exercise the same intermediate steps in the
    // shared-flow component suite.
    await expect(page.getByRole("heading", { name: /is ready/i })).toBeVisible({
      timeout: 30_000,
    });

    const connections = await json<{
      connections: Array<{ id: string; name: string; config: Json }>;
    }>(await request.get(`/api/companies/${seed.companyId}/tools/connections`));
    expect(connections.connections).toHaveLength(1);
    const connection = connections.connections[0]!;
    const connectionId = connection.id;
    await json(
      await request.patch(`/api/tool-connections/${connectionId}`, {
        data: {
          config: {
            ...connection.config,
            url: provider.url,
            sourceTemplateKey: "notion",
          },
        },
      }),
    );
    await json(
      await request.put(`/api/tool-connections/${connectionId}/installs`, {
        data: {
          installs: [{ targetType: "agent", targetId: holder.id }],
        },
      }),
    );

    await page.goto(`/${seed.prefix}/apps/${connectionId}/permissions`);
    const actionRow = page.locator("[data-action-id]").filter({ hasText: "List fixture pages" });
    await actionRow.getByRole("button", { name: "Test", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Test List fixture pages" }),
    ).toBeVisible({ timeout: 30_000 });
    const refused = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/tool-connections/${connectionId}/test-calls`);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const refusal = await refused;
    expect(refusal.status()).toBe(409);
    expect(await refusal.json()).toMatchObject({ reasonCode: "tool_model_effect_unqualified" });
    await expect(page.getByText("Fixture page inventory")).toHaveCount(0);
    expect(provider.captures.filter(capture => capture.method === "tools/call")).toHaveLength(0);
    const runs = await json<unknown[]>(await request.get(`/api/companies/${seed.companyId}/heartbeat-runs?agentId=${holder.id}&limit=10`));
    expect(runs).toHaveLength(0);

  } finally {
    await provider.close();
  }
});

test("a Human connection card resumes two actual managed Native Runs with the fixed Railway tool result", async ({ page }) => {
  // One initial case envelope, shared by setup and both waits. This estimate
  // replaces the obsolete process fixture's 45s polls; no live Run/lease/report
  // is extended, and each actual managed Run retains its 180s policy.
  test.setTimeout(360_000);
  const deadlineAt = Date.now() + 360_000;
  await withManagedConnectionIntent(page, deadlineAt);
});
