import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  automationArtifacts,
  automationArtifactVersions,
  companies,
  companyMemberships,
  createDb,
  instanceSettings,
  workflows,
} from "@paperclipai/db";
import type { ExecutionPrincipal } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { instanceSettingsService } from "../instance-settings.js";
import {
  automationArtifactService,
  type AutomationArtifactMutationActor,
} from "./automation-artifact-service.js";
import { automationArtifactRuntimeService } from "./automation-artifact-runtime.js";
import { and, eq } from "drizzle-orm";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

function userActor(userId: string): AutomationArtifactMutationActor {
  const principal: ExecutionPrincipal = { type: "user", userId };
  return { principal };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Normalize lead email",
    description: "Normalize an email before deterministic downstream use.",
    kind: "expression",
    language: null,
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
      additionalProperties: false,
    },
    riskClass: "C1",
    sideEffectClass: "pure",
    createdByOptimizerSuggestionId: null,
    originWorkflowId: null,
    originNodeId: null,
    sourceCode: "lower(trim(input.email))",
    dependencyManifest: {},
    testSpec: {
      cases: [
        {
          input: { email: " Alice@Example.COM " },
          output: { email: "alice@example.com" },
        },
      ],
    },
    ...overrides,
  } as const;
}

describePg("Automation Artifact service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-automation-artifacts-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db
      .update(automationArtifacts)
      .set({ latestVersionId: null });
    await db.delete(automationArtifacts);
    await db.delete(workflows);
    await db.delete(companyMemberships);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Artifact Co") {
    const userId = `user-${randomUUID()}`;
    const [company] = await db
      .insert(companies)
      .values({
        name,
        issuePrefix: `A${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      })
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company!.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });
    return { company: company!, userId };
  }

  it("creates an immutable candidate with one hash-addressed version", async () => {
    const seeded = await seedCompany();
    const service = automationArtifactService(db);

    const created = await service.create(
      seeded.company.id,
      input(),
      userActor(seeded.userId),
    );

    expect(created.artifact).toMatchObject({
      companyId: seeded.company.id,
      kind: "expression",
      language: null,
      status: "candidate",
      riskClass: "C1",
      sideEffectClass: "pure",
      successCount: 0,
      failureCount: 0,
    });
    expect(created.artifact.latestVersionId).toBe(created.latestVersion?.id);
    expect(created.latestVersion).toMatchObject({
      versionNumber: 1,
      sourceCode: "lower(trim(input.email))",
      validationReport: null,
      securityReport: null,
    });
    expect(created.latestVersion?.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const rows = await db
      .select()
      .from(automationArtifactVersions)
      .where(
        eq(
          automationArtifactVersions.artifactId,
          created.artifact.id,
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("appends with CAS, preserves old versions, and rejects semantic replay", async () => {
    const seeded = await seedCompany();
    const service = automationArtifactService(db);
    const actor = userActor(seeded.userId);
    const created = await service.create(seeded.company.id, input(), actor);
    const first = created.latestVersion!;

    const second = await service.appendVersion(
      seeded.company.id,
      created.artifact.id,
      {
        expectedLatestVersionId: first.id,
        sourceCode: "lower(trim(input.email ?? ''))",
        inputSchema: first.inputSchema,
        outputSchema: first.outputSchema,
        dependencyManifest: {},
        testSpec: { cases: [] },
      },
      actor,
    );

    expect(second.latestVersion).toMatchObject({
      versionNumber: 2,
      sourceCode: "lower(trim(input.email ?? ''))",
    });
    expect(second.artifact.latestVersionId).toBe(second.latestVersion?.id);

    const preserved = await db
      .select()
      .from(automationArtifactVersions)
      .where(
        and(
          eq(automationArtifactVersions.companyId, seeded.company.id),
          eq(automationArtifactVersions.id, first.id),
        ),
      )
      .then((rows) => rows[0]);
    expect(preserved).toMatchObject({
      sourceCode: first.sourceCode,
      contentHash: first.contentHash,
      versionNumber: 1,
    });

    await expect(
      service.appendVersion(
        seeded.company.id,
        created.artifact.id,
        {
          expectedLatestVersionId: first.id,
          sourceCode: "different",
          inputSchema: first.inputSchema,
          outputSchema: first.outputSchema,
          dependencyManifest: {},
          testSpec: {},
        },
        actor,
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "revision_conflict" }),
    });

    await expect(
      service.appendVersion(
        seeded.company.id,
        created.artifact.id,
        {
          expectedLatestVersionId: second.latestVersion!.id,
          sourceCode: first.sourceCode,
          inputSchema: first.inputSchema,
          outputSchema: first.outputSchema,
          dependencyManifest: first.dependencyManifest,
          testSpec: first.testSpec,
        },
        actor,
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({
        code: "automation_artifact_version_unchanged",
      }),
    });
  });

  it("enforces tenant scope in service and database origin references", async () => {
    const alpha = await seedCompany("Alpha");
    const beta = await seedCompany("Beta");
    const [betaWorkflow] = await db
      .insert(workflows)
      .values({
        companyId: beta.company.id,
        name: "Beta workflow",
        status: "active",
      })
      .returning();

    const service = automationArtifactService(db);
    const created = await service.create(
      alpha.company.id,
      input(),
      userActor(alpha.userId),
    );

    await expect(
      service.getDetail(
        alpha.company.id,
        created.artifact.id,
        userActor(beta.userId),
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({ code: "company_boundary_denied" }),
    });

    await expect(
      service.create(
        alpha.company.id,
        input({ originWorkflowId: betaWorkflow!.id, originNodeId: "n1" }),
        userActor(alpha.userId),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({ code: "cross_company_reference" }),
    });

    await expect(
      db.insert(automationArtifacts).values({
        companyId: alpha.company.id,
        name: "Invalid raw cross-company origin",
        kind: "expression",
        language: null,
        riskClass: "C1",
        sideEffectClass: "pure",
        originWorkflowId: betaWorkflow!.id,
      }),
    ).rejects.toThrow();
  });

  it("blocks activation before PR 41 security gates and archives reversibly", async () => {
    const seeded = await seedCompany();
    const service = automationArtifactService(db);
    const actor = userActor(seeded.userId);
    const created = await service.create(seeded.company.id, input(), actor);

    const testing = await service.transitionStatus(
      seeded.company.id,
      created.artifact.id,
      {
        expectedStatus: "candidate",
        expectedLatestVersionId: created.latestVersion!.id,
        status: "testing",
      },
      actor,
    );
    expect(testing.artifact.status).toBe("testing");

    await expect(
      service.transitionStatus(
        seeded.company.id,
        created.artifact.id,
        {
          expectedStatus: "testing",
          expectedLatestVersionId: created.latestVersion!.id,
          status: "active",
        },
        actor,
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "automation_artifact_security_gate_required",
      }),
    });

    const archived = await service.archive(
      seeded.company.id,
      created.artifact.id,
      { expectedLatestVersionId: created.latestVersion!.id },
      actor,
    );
    expect(archived.artifact.status).toBe("deprecated");
    expect(archived.artifact.archivedAt).toBeInstanceOf(Date);

    await expect(
      service.appendVersion(
        seeded.company.id,
        created.artifact.id,
        {
          expectedLatestVersionId: created.latestVersion!.id,
          sourceCode: "new content",
          inputSchema: created.latestVersion!.inputSchema,
          outputSchema: created.latestVersion!.outputSchema,
          dependencyManifest: {},
          testSpec: {},
        },
        actor,
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({
        code: "automation_artifact_archived",
      }),
    });
  });

  it("enforces immutable version content and one-time gate report finalization in PostgreSQL", async () => {
    const seeded = await seedCompany();
    const created = await automationArtifactService(db).create(
      seeded.company.id,
      input(),
      userActor(seeded.userId),
    );
    const version = created.latestVersion!;
    const report = {
      schema: "automation_artifact_gate.v1" as const,
      kind: "validation" as const,
      status: "passed" as const,
      contentHash: version.contentHash,
      checkedAt: "2026-09-30T12:00:00.000Z",
      checks: [{ code: "parse", status: "passed" as const, detail: null }],
    };

    await expect(
      db
        .update(automationArtifactVersions)
        .set({ sourceCode: "mutated" })
        .where(eq(automationArtifactVersions.id, version.id)),
    ).rejects.toThrow(/immutable/i);

    await db
      .update(automationArtifactVersions)
      .set({ validationReport: report })
      .where(eq(automationArtifactVersions.id, version.id));

    await expect(
      db
        .update(automationArtifactVersions)
        .set({
          validationReport: {
            ...report,
            checkedAt: "2026-09-30T12:01:00.000Z",
          },
        })
        .where(eq(automationArtifactVersions.id, version.id)),
    ).rejects.toThrow(/already finalized/i);

    await expect(
      db
        .delete(automationArtifactVersions)
        .where(eq(automationArtifactVersions.id, version.id)),
    ).rejects.toThrow(/cannot be deleted directly/i);
  });

  it("keeps runtime disabled by default and resolves only active hash-gated versions", async () => {
    const seeded = await seedCompany();
    const actor = userActor(seeded.userId);
    const service = automationArtifactService(db);
    const runtime = automationArtifactRuntimeService(db);
    const created = await service.create(seeded.company.id, input(), actor);
    const version = created.latestVersion!;

    await expect(
      runtime.resolveActiveBinding(
        seeded.company.id,
        created.artifact.id,
        version.id,
        actor,
      ),
    ).rejects.toMatchObject({
      status: 404,
      details: expect.objectContaining({ code: "automation_artifacts_disabled" }),
    });

    await instanceSettingsService(db).updateExperimental({
      enableAutomationArtifactsV1: true,
    });

    await expect(
      runtime.resolveActiveBinding(
        seeded.company.id,
        created.artifact.id,
        version.id,
        actor,
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "automation_artifact_not_active" }),
    });

    await db
      .update(automationArtifacts)
      .set({ status: "active" })
      .where(eq(automationArtifacts.id, created.artifact.id));

    await expect(
      runtime.resolveActiveBinding(
        seeded.company.id,
        created.artifact.id,
        version.id,
        actor,
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({
        code: "automation_artifact_validation_required",
      }),
    });

    const checkedAt = "2026-09-30T12:00:00.000Z";
    await db
      .update(automationArtifactVersions)
      .set({
        validationReport: {
          schema: "automation_artifact_gate.v1",
          kind: "validation",
          status: "passed",
          contentHash: version.contentHash,
          checkedAt,
          checks: [],
        },
        securityReport: {
          schema: "automation_artifact_gate.v1",
          kind: "security",
          status: "passed",
          contentHash: version.contentHash,
          checkedAt,
          checks: [],
        },
      })
      .where(eq(automationArtifactVersions.id, version.id));

    const binding = await runtime.resolveActiveBinding(
      seeded.company.id,
      created.artifact.id,
      version.id,
      actor,
    );
    expect(binding).toMatchObject({
      artifactId: created.artifact.id,
      artifactVersionId: version.id,
      companyId: seeded.company.id,
      kind: "expression",
      riskClass: "C1",
      sideEffectClass: "pure",
      contentHash: version.contentHash,
    });
    expect(binding.sourceCode).toBe(version.sourceCode);
  });
});
