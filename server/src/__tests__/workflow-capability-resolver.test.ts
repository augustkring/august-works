import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  toolApplications,
  toolCatalogEntries,
  toolConnections,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  rankWorkflowCapabilities,
  workflowCapabilityResolverService,
} from "../services/workflows/workflow-capability-resolver.js";
import type { WorkflowCapabilityCandidate } from "@paperclipai/shared";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describe("Workflow capability ranking", () => {
  const candidate = (
    id: string,
    title: string,
    kind: WorkflowCapabilityCandidate["kind"],
  ): WorkflowCapabilityCandidate => ({
    id,
    kind,
    title,
    description: null,
    nodeType: "core.manual_trigger",
    configTemplate: {},
    executionMode: kind === "agent" ? "agent" : "deterministic",
    sideEffectClass: "pure",
    riskClass: "C0",
    inputSchema: null,
    outputSchema: null,
    requiredPermissions: [],
    availability: { status: "available", reason: null },
    operationalProfile: {
      reliabilityBasis: "static_contract",
      reliabilitySignal: "ready",
      latencyProfile: null,
      costProfile: null,
    },
    publishState: "ready",
    publishBlockedReason: null,
    source: {},
  });

  it("ranks exact deterministic matches ahead of partial matches without model inference", () => {
    const ranked = rankWorkflowCapabilities(
      [
        candidate("a", "Condition", "core_node"),
        candidate("b", "Conditional email", "connected_tool"),
        candidate("c", "Research agent", "agent"),
      ],
      { q: "condition", limit: 10, kind: undefined },
    );
    expect(ranked.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describePg("Workflow capability resolver", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-workflow-capabilities-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(toolCatalogEntries);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name: string) {
    const [company] = await db.insert(companies).values({
      name,
      issuePrefix: `C${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    }).returning();
    return company!;
  }

  async function seedTool(companyId: string, input: {
    title: string;
    toolName: string;
    healthStatus?: "ok" | "degraded";
  }) {
    const [application] = await db.insert(toolApplications).values({
      companyId,
      applicationKey: `fixture-${randomUUID()}`,
      name: "Mail App",
      type: "mcp_http",
      status: "active",
    }).returning();
    const [connection] = await db.insert(toolConnections).values({
      companyId,
      applicationId: application!.id,
      name: "Mail connection",
      uid: `fixture/${randomUUID()}`,
      transport: "mcp_remote",
      status: "active",
      enabled: true,
      healthStatus: input.healthStatus ?? "ok",
      config: { url: "https://fixture.invalid/mcp", secretMarker: "must-not-leak" },
      transportConfig: { url: "https://fixture.invalid/mcp" },
    }).returning();
    const [entry] = await db.insert(toolCatalogEntries).values({
      companyId,
      applicationId: application!.id,
      connectionId: connection!.id,
      entryKind: "tool",
      name: input.toolName,
      toolName: input.toolName,
      title: input.title,
      description: "Send a customer email",
      inputSchema: {
        type: "object",
        properties: { to: { type: "string" }, body: { type: "string" } },
        required: ["to"],
      },
      outputSchema: { type: "object", properties: { messageId: { type: "string" } } },
      riskLevel: "write",
      isReadOnly: false,
      isWrite: true,
      isDestructive: false,
      status: "active",
      versionHash: randomUUID(),
      schemaHash: randomUUID(),
    }).returning();
    return { application: application!, connection: connection!, entry: entry! };
  }

  it("returns company-scoped connected tools and agents as typed addable candidates", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    const alphaTool = await seedTool(alpha.id, {
      title: "Send email",
      toolName: "send_email",
    });
    await seedTool(beta.id, {
      title: "Send beta email",
      toolName: "send_beta_email",
    });
    const [agent] = await db.insert(agents).values({
      companyId: alpha.id,
      name: "Sales Researcher",
      role: "sales",
      title: "Sales Researcher",
      capabilities: "Research accounts and qualify leads",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      status: "idle",
    }).returning();
    await db.insert(agents).values({
      companyId: beta.id,
      name: "Beta Researcher",
      role: "sales",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      status: "idle",
    });

    const svc = workflowCapabilityResolverService(db);
    const tools = await svc.search(alpha.id, { q: "email", limit: 20 });
    const tool = tools.candidates.find((item) => item.kind === "connected_tool");
    expect(tool).toMatchObject({
      id: `tool:${alphaTool.entry.id}`,
      kind: "connected_tool",
      nodeType: "connector.action",
      configTemplate: {
        toolCatalogEntryId: alphaTool.entry.id,
        connectionId: alphaTool.connection.id,
        input: {},
      },
      sideEffectClass: "write",
      riskClass: "C2",
      requiredPermissions: ["tools:use"],
      availability: { status: "available", reason: null },
      source: {
        applicationName: "Mail App",
        connectionName: "Mail connection",
        toolName: "send_email",
      },
    });
    expect(JSON.stringify(tools)).not.toContain("must-not-leak");
    expect(JSON.stringify(tools)).not.toContain("send_beta_email");

    const agentsResult = await svc.search(alpha.id, { q: "research", limit: 20 });
    expect(agentsResult.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `agent:${agent!.id}`,
          kind: "agent",
          nodeType: "agent.task",
          requiredPermissions: ["tasks:assign"],
          availability: { status: "available", reason: null },
          source: expect.objectContaining({ agentId: agent!.id }),
        }),
      ]),
    );
    expect(JSON.stringify(agentsResult)).not.toContain("Beta Researcher");
  });

  it("reports degraded connected-tool health without hiding the capability", async () => {
    const company = await seedCompany("Alpha");
    await seedTool(company.id, {
      title: "Send email",
      toolName: "send_email",
      healthStatus: "degraded",
    });

    const result = await workflowCapabilityResolverService(db).search(
      company.id,
      { q: "email", limit: 10 },
    );
    expect(result.candidates[0]).toMatchObject({
      kind: "connected_tool",
      availability: {
        status: "degraded",
        reason: "connection_degraded",
      },
    });
  });
});
