import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  createDb,
  invites,
  issues,
  principalPermissionGrants,
  projects,
} from "@paperclipai/db";
import { buildHostServices } from "../services/plugin-host-services.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const pluginId = "plugin-record-id";

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: vi.fn(),
        subscribe: vi.fn(),
        clear: vi.fn(),
      };
    },
  } as any;
}

async function createCompany(db: ReturnType<typeof createDb>, prefix: string) {
  return db
    .insert(companies)
    .values({
      name: `${prefix} ${randomUUID()}`,
      issuePrefix: `${prefix}${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

describeEmbeddedPostgres("plugin access and authorization host services", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-plugin-access-authz-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(invites);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("rejects grant writes for principals outside the requested company", async () => {
    const targetCompany = await createCompany(db, "PAX");
    const otherCompany = await createCompany(db, "PAY");
    const otherAgent = await db
      .insert(agents)
      .values({
        companyId: otherCompany.id,
        name: "Other agent",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        permissions: {},
      })
      .returning()
      .then((rows) => rows[0]!);
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());

    await expect(
      services.authorization.setGrants({
        companyId: targetCompany.id,
        principalType: "agent",
        principalId: otherAgent.id,
        grants: [{ permissionKey: "tasks:assign" }],
      }),
    ).rejects.toThrow("Agent not found");

    const rows = await db.select().from(principalPermissionGrants);
    expect(rows).toEqual([]);
    services.dispose();
  });

  it("redacts invite token hashes and sensitive defaults from plugin invite reads", async () => {
    const company = await createCompany(db, "PAZ");
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());

    const created = await services.access.createInvite({
      companyId: company.id,
      allowedJoinTypes: "human",
      defaultsPayload: {
        human: { role: "operator", apiKey: "secret-value" },
        secret: "top-secret",
      },
    });

    expect(created.token).toMatch(/^pcp_invite_/);
    expect("tokenHash" in created).toBe(false);
    expect(created.defaultsPayload).toMatchObject({
      human: { role: "operator", apiKey: "***REDACTED***" },
      secret: "***REDACTED***",
    });

    const listed = await services.access.listInvites({ companyId: company.id });
    expect(listed.invites).toHaveLength(1);
    expect("token" in listed.invites[0]!).toBe(false);
    expect("tokenHash" in listed.invites[0]!).toBe(false);
    services.dispose();
  });

  it("filters authorization audit entries by allow or deny decision details", async () => {
    const company = await createCompany(db, "PAU");
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());
    await db.insert(activityLog).values([
      {
        companyId: company.id,
        actorType: "agent",
        actorId: "agent-1",
        action: "authorization.assignment_preview",
        entityType: "issue",
        entityId: "issue-1",
        details: { decision: "allow", secret: "do-not-leak" },
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        companyId: company.id,
        actorType: "agent",
        actorId: "agent-1",
        action: "authorization.assignment_preview",
        entityType: "issue",
        entityId: "issue-2",
        details: { reason: "deny_scope" },
        createdAt: new Date("2026-01-03T00:00:00Z"),
      },
    ]);

    const [allowed, denied] = await Promise.all([
      services.authorization.searchAudit({
        companyId: company.id,
        action: "authorization.assignment_preview",
        decision: "allow",
        limit: 1,
      }),
      services.authorization.searchAudit({
        companyId: company.id,
        action: "authorization.assignment_preview",
        decision: "deny",
      }),
    ]);

    expect(allowed).toHaveLength(1);
    expect(allowed[0]!.entityId).toBe("issue-1");
    expect(allowed[0]!.details).toMatchObject({ decision: "allow", secret: "***REDACTED***" });
    expect(denied).toHaveLength(1);
    expect(denied[0]!.entityId).toBe("issue-2");
    services.dispose();
  });

  it("uses persisted agent policy for plugin assignment preview and explanation", async () => {
    const company = await createCompany(db, "PAP");
    const [actorAgent, targetAgent] = await db
      .insert(agents)
      .values([
        {
          companyId: company.id,
          name: "Actor agent",
          role: "engineer",
          adapterType: "process",
          adapterConfig: {},
          permissions: {},
        },
        {
          companyId: company.id,
          name: "Protected target",
          role: "engineer",
          adapterType: "process",
          adapterConfig: {},
          permissions: {},
        },
      ])
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: actorAgent!.id,
      status: "active",
      membershipRole: "member",
    });

    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());
    const updatedPolicy = await services.authorization.updatePolicy({
      companyId: company.id,
      resourceType: "agent",
      resourceId: targetAgent!.id,
      policy: {
        assignmentPolicy: {
          mode: "protected",
        },
        protectedAgent: {
          blockAssignment: true,
          blockReason: "Protected assignment",
        },
        managedBy: "permissions-extension",
      },
    });
    const input = {
      companyId: company.id,
      actor: {
        type: "agent" as const,
        agentId: actorAgent!.id,
        companyId: company.id,
        source: "agent_key" as const,
      },
      target: { assigneeAgentId: targetAgent!.id },
    };
    const [policy, preview, explanation] = await Promise.all([
      Promise.resolve(updatedPolicy),
      services.authorization.previewAssignment(input),
      services.authorization.explainAssignment(input),
    ]);

    expect(policy.policy).toMatchObject({
      protectedAgent: { blockAssignment: true },
    });
    expect(preview).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(preview.explanation).toContain("assignment is blocked");
    expect(preview.explanation).toContain("company administrator");
    expect(preview.explanation).not.toContain("approval");
    expect(explanation).toMatchObject(preview);

    const injectedBoardPreview = await services.authorization.previewAssignment({
      companyId: company.id,
      actor: {
        type: "board",
        userId: "operator",
        companyIds: [company.id],
        source: "local_implicit",
        isInstanceAdmin: true,
      } as any,
      target: { assigneeAgentId: targetAgent!.id },
    });
    expect(injectedBoardPreview).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    services.dispose();
  });

  it("sanitizes plugin authorization policy updates and records audit activity", async () => {
    const company = await createCompany(db, "PAS");
    const targetAgent = await db
      .insert(agents)
      .values({
        companyId: company.id,
        name: "Policy target",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        permissions: {},
      })
      .returning()
      .then((rows) => rows[0]!);
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());

    const updatedPolicy = await services.authorization.updatePolicy({
      companyId: company.id,
      resourceType: "agent",
      resourceId: targetAgent.id,
      policy: {
        assignmentPolicy: { mode: "protected" },
        apiKey: "sk-test-secret",
        nested: {
          authorization: "Bearer should-not-persist",
          safeLabel: "kept",
        },
      },
    });

    expect(updatedPolicy.policy).toMatchObject({
      assignmentPolicy: { mode: "protected" },
      apiKey: "***REDACTED***",
      nested: {
        authorization: "***REDACTED***",
        safeLabel: "kept",
      },
    });

    const rows = await db.select().from(activityLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: company.id,
      actorType: "plugin",
      actorId: pluginId,
      action: "authorization.policy_updated_by_plugin",
      entityType: "agent",
      entityId: targetAgent.id,
    });
    expect(rows[0]!.details).toMatchObject({
      hasPolicy: true,
      sourcePluginId: pluginId,
      sourcePluginKey: "permissions-extension",
    });
    expect(JSON.stringify(rows[0]!.details)).not.toContain("sk-test-secret");
    expect(JSON.stringify(rows[0]!.details)).not.toContain("should-not-persist");
    services.dispose();
  });

  it.each(["issue", "project"] as const)("invalidates changed %s policy captures while preserving an unchanged body", async resourceType => {
    const company = await createCompany(db, "PAC");
    const policy = { assignmentPolicy: { mode: "open" } };
    const [resource] = resourceType === "issue"
      ? await db.insert(issues).values({ companyId: company.id, title: "Captured policy task", payloadSourceProtocolVersion: 1,
        executionPolicy: { authorizationPolicy: policy } }).returning({ id: issues.id })
      : await db.insert(projects).values({ companyId: company.id, name: "Captured policy project", payloadSourceProtocolVersion: 1,
        executionWorkspacePolicy: { enabled: false, authorizationPolicy: policy } }).returning({ id: projects.id });
    const table = sql.identifier(resourceType === "issue" ? "issues" : "projects");
    // Structural binding fixture only: no authenticated producer, complete
    // source closure or permission qualification is implied by this snapshot.
    const [bound] = await db.execute<{ snapshot: unknown }>(sql`update ${table} target set payload_source_snapshot=(
      select content || jsonb_build_object('digest',encode(sha256(convert_to(content::text,'UTF8')),'hex')) from (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind',${resourceType}::text,
          'companyId',target.company_id,'id',target.id,'contentHash',public.aw_native_payload_body_hash(${resourceType},to_jsonb(target))),
          'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as content
      ) actual_body) where target.company_id=${company.id}::uuid and target.id=${resource!.id}::uuid
      returning payload_source_snapshot as snapshot`);
    const services = buildHostServices(db, pluginId, "permissions-extension", createEventBusStub());
    const read = () => db.execute<{ snapshot: unknown; invalidated: boolean }>(sql`select payload_source_snapshot as snapshot,
      payload_source_snapshot_invalidated as invalidated from ${table} where company_id=${company.id}::uuid and id=${resource!.id}::uuid`);
    try {
      const unchanged = await services.authorization.updatePolicy({ companyId: company.id, resourceType, resourceId: resource!.id, policy });
      expect(unchanged.policy).toMatchObject(policy);
      expect((await read())[0]).toEqual({ snapshot: bound!.snapshot, invalidated: false });
      const changed = await services.authorization.updatePolicy({ companyId: company.id, resourceType, resourceId: resource!.id,
        policy: { assignmentPolicy: { mode: "protected" } } });
      expect(changed.policy).toMatchObject({ assignmentPolicy: { mode: "protected" } });
      expect((await read())[0]).toEqual({ snapshot: null, invalidated: true });
    } finally { services.dispose(); }
  });
});
