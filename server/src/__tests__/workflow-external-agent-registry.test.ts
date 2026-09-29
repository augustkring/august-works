import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
} from "@paperclipai/db";
import type { WorkflowGraphV1 } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workflowNodeRegistryService } from "../services/workflows/workflow-node-registry.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("External Agent workflow registry", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-workflow-external-agent-registry-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function graph(agentId: string): WorkflowGraphV1 {
    return {
      version: 1,
      nodes: [
        {
          id: "start",
          type: "core.manual_trigger",
          name: "Start",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "external",
          type: "agent.external",
          name: "External research",
          position: { x: 180, y: 0 },
          config: {
            agentId,
            objective: "Research the account",
            structuredInput: { accountId: "acme" },
            expectedOutputSchema: {
              type: "object",
              properties: {
                score: { type: "number" },
              },
              required: ["score"],
              additionalProperties: false,
            },
            timeoutSeconds: 120,
            allowedCapabilityScope: "binding_grants",
            fallbackPolicy: "fail",
          },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "external" }],
      variables: [],
      settings: {},
    };
  }

  async function seedCompany(name: string) {
    const [company] = await db.insert(companies).values({
      name,
      issuePrefix: name.slice(0, 3).toUpperCase(),
    }).returning();
    return company!;
  }

  async function seedAgent(
    companyId: string,
    input: {
      adapterType: string;
      status?: "idle" | "terminated";
      name: string;
    },
  ) {
    const [agent] = await db.insert(agents).values({
      companyId,
      name: input.name,
      role: "research",
      status: input.status ?? "idle",
      adapterType: input.adapterType,
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    return agent!;
  }

  it("accepts only a live same-company OpenClaw binding for publish", async () => {
    const company = await seedCompany("Alpha");
    const openClaw = await seedAgent(company.id, {
      adapterType: "openclaw_gateway",
      name: "OpenClaw Research",
    });

    await expect(
      workflowNodeRegistryService(db).validatePublishGraph(
        company.id,
        graph(openClaw.id),
      ),
    ).resolves.toEqual(graph(openClaw.id));
  });

  it("rejects non-OpenClaw and cross-company bindings", async () => {
    const company = await seedCompany("Alpha");
    const other = await seedCompany("Beta");
    const localAgent = await seedAgent(company.id, {
      adapterType: "paperclip_runner",
      name: "Native Research",
    });
    const otherOpenClaw = await seedAgent(other.id, {
      adapterType: "openclaw_gateway",
      name: "Other OpenClaw",
    });

    await expect(
      workflowNodeRegistryService(db).validatePublishGraph(
        company.id,
        graph(localAgent.id),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "external_agent_binding_invalid",
        nodeId: "external",
      }),
    });

    await expect(
      workflowNodeRegistryService(db).validatePublishGraph(
        company.id,
        graph(otherOpenClaw.id),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "cross_company_reference",
        nodeId: "external",
      }),
    });
  });

  it("rejects a terminated OpenClaw binding", async () => {
    const company = await seedCompany("Alpha");
    const terminated = await seedAgent(company.id, {
      adapterType: "openclaw_gateway",
      status: "terminated",
      name: "Retired OpenClaw",
    });

    await expect(
      workflowNodeRegistryService(db).validatePublishGraph(
        company.id,
        graph(terminated.id),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "workflow_node_invalid",
        reason: "external_agent_binding_unavailable",
        nodeId: "external",
      }),
    });
  });
});
