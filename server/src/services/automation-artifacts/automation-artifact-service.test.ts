import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  automationArtifacts,
  automationArtifactVersions,
  companies,
  companyMemberships,
  createDb,
  instanceSettings,
  workflowOptimizerSuggestions,
  workflowRevisions,
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
import { automationArtifactSecurityService } from "./automation-artifact-security.js";
import { and, eq } from "drizzle-orm";

async function expectDatabaseCause(
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected database operation to fail");
  } catch (error) {
    const cause =
      error instanceof Error && "cause" in error
        ? (error as Error & { cause?: unknown }).cause
        : null;
    const message =
      cause instanceof Error
        ? cause.message
        : typeof cause === "object" &&
            cause !== null &&
            "message" in cause &&
            typeof (cause as { message?: unknown }).message === "string"
          ? (cause as { message: string }).message
          : error instanceof Error
            ? error.message
            : String(error);
    expect(message).toMatch(pattern);
  }
}

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

const qualifiedLinuxArtifactSandbox =
  process.platform === "linux" &&
  existsSync("/usr/bin/bwrap") &&
  existsSync("/usr/bin/prlimit");

function userActor(userId: string): AutomationArtifactMutationActor {
  const principal: ExecutionPrincipal = { type: "user", userId };
  return { principal };
}

function systemActor(): AutomationArtifactMutationActor {
  return { principal: { type: "system", service: "artifact-security-test" } };
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
    await db.delete(workflowOptimizerSuggestions);
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

  it("binds optimizer provenance to the same company and origin workflow", async () => {
    const alpha = await seedCompany("Optimizer Alpha");
    const beta = await seedCompany("Optimizer Beta");

    async function seedSuggestion(
      companyId: string,
      name: string,
    ) {
      const workflowId = randomUUID();
      const revisionId = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(workflows).values({
          id: workflowId,
          companyId,
          name,
          status: "active",
          publishedRevisionId: revisionId,
        });
        await tx.insert(workflowRevisions).values({
          id: revisionId,
          companyId,
          workflowId,
          revisionNumber: 1,
          state: "published",
          graph: {
            version: 1,
            nodes: [],
            edges: [],
            variables: [],
            settings: {},
          },
        });
      });
      const [suggestion] = await db
        .insert(workflowOptimizerSuggestions)
        .values({
          companyId,
          workflowId,
          workflowRevisionId: revisionId,
          signatureHash: "a".repeat(64),
          status: "detected",
          candidateType: "transform",
          stepOrdinals: [1],
          operationTypes: ["core.transform"],
          capabilityRefs: [null],
          sideEffectRisk: "low",
          observationCount: 3,
          successRate: 1,
          humanCorrectionRate: null,
          humanCorrectionEvidenceCount: 0,
          humanCorrectionEvidenceCoverage: 0,
          inputShapeStability: 1,
          outputShapeStability: 1,
          averageDurationMs: 10,
          averageCost: null,
          estimatedLatencySavingsMs: 10,
          estimatedCostSavings: null,
          observedRunIds: [],
        })
        .returning();
      return { workflowId, revisionId, suggestion: suggestion! };
    }

    const alphaSource = await seedSuggestion(
      alpha.company.id,
      "Alpha source workflow",
    );
    const betaSource = await seedSuggestion(
      beta.company.id,
      "Beta source workflow",
    );
    const [alphaOtherWorkflow] = await db
      .insert(workflows)
      .values({
        companyId: alpha.company.id,
        name: "Alpha other workflow",
        status: "active",
      })
      .returning();

    const service = automationArtifactService(db);

    await expect(
      service.create(
        alpha.company.id,
        input({
          createdByOptimizerSuggestionId: betaSource.suggestion.id,
          originWorkflowId: alphaSource.workflowId,
        }),
        systemActor(),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "cross_company_reference",
        resourceType: "workflow_optimizer_suggestion",
      }),
    });

    await expect(
      service.create(
        alpha.company.id,
        input({
          createdByOptimizerSuggestionId: alphaSource.suggestion.id,
          originWorkflowId: alphaOtherWorkflow!.id,
        }),
        systemActor(),
      ),
    ).rejects.toMatchObject({
      status: 422,
      details: expect.objectContaining({
        code: "optimizer_suggestion_origin_mismatch",
      }),
    });

    const created = await service.create(
      alpha.company.id,
      input({
        createdByOptimizerSuggestionId: alphaSource.suggestion.id,
        originWorkflowId: alphaSource.workflowId,
      }),
      systemActor(),
    );
    expect(created.artifact).toMatchObject({
      companyId: alpha.company.id,
      createdByOptimizerSuggestionId: alphaSource.suggestion.id,
      originWorkflowId: alphaSource.workflowId,
    });
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

    await expectDatabaseCause(
      db
        .update(automationArtifactVersions)
        .set({ sourceCode: "mutated" })
        .where(eq(automationArtifactVersions.id, version.id)),
      /immutable/i,
    );

    await db
      .update(automationArtifactVersions)
      .set({ validationReport: report })
      .where(eq(automationArtifactVersions.id, version.id));

    await expectDatabaseCause(
      db
        .update(automationArtifactVersions)
        .set({
          validationReport: {
            ...report,
            checkedAt: "2026-09-30T12:01:00.000Z",
          },
        })
        .where(eq(automationArtifactVersions.id, version.id)),
      /already finalized/i,
    );

    await expectDatabaseCause(
      db
        .delete(automationArtifactVersions)
        .where(eq(automationArtifactVersions.id, version.id)),
      /cannot be deleted directly/i,
    );
  });

  it("allows lifecycle-owned company cascade while blocking direct version deletion", async () => {
    const seeded = await seedCompany();
    const created = await automationArtifactService(db).create(
      seeded.company.id,
      input(),
      userActor(seeded.userId),
    );

    const versionId = created.latestVersion!.id;

    await expectDatabaseCause(
      db
        .delete(automationArtifactVersions)
        .where(eq(automationArtifactVersions.id, versionId)),
      /cannot be deleted directly/i,
    );

    await db
      .delete(activityLog)
      .where(eq(activityLog.companyId, seeded.company.id));
    await db
      .delete(companyMemberships)
      .where(eq(companyMemberships.companyId, seeded.company.id));
    await db.delete(companies).where(eq(companies.id, seeded.company.id));

    expect(
      await db
        .select()
        .from(automationArtifacts)
        .where(eq(automationArtifacts.companyId, seeded.company.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(automationArtifactVersions)
        .where(eq(automationArtifactVersions.companyId, seeded.company.id)),
    ).toHaveLength(0);
  });

  it("records hash-bound gates only through the system evaluator and activates a tested declarative artifact", async () => {
    const seeded = await seedCompany();
    const user = userActor(seeded.userId);
    const system = systemActor();
    const service = automationArtifactService(db);
    const security = automationArtifactSecurityService(db);
    const runtime = automationArtifactRuntimeService(db);

    const created = await service.create(
      seeded.company.id,
      input({
        kind: "transform",
        sourceCode: JSON.stringify({
          email: "{{input.email}}",
        }),
        testSpec: {
          cases: [
            {
              name: "copies-email-through-governed-transform",
              input: { email: "alice@example.com" },
              output: { email: "alice@example.com" },
            },
          ],
        },
      }),
      user,
    );
    const version = created.latestVersion!;

    const passedReport = {
      schema: "automation_artifact_gate.v1" as const,
      status: "passed" as const,
      contentHash: version.contentHash,
      checkedAt: "2026-09-30T20:00:00.000Z",
      checks: [],
    };

    await expect(
      service.recordGateReports(
        seeded.company.id,
        created.artifact.id,
        version.id,
        {
          validationReport: { ...passedReport, kind: "validation" },
          securityReport: { ...passedReport, kind: "security" },
        },
        user,
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "automation_artifact_gate_writer_denied",
      }),
    });

    const evaluated = await security.evaluateLatestVersion(
      seeded.company.id,
      created.artifact.id,
      system,
    );
    expect(evaluated.latestVersion?.validationReport).toMatchObject({
      kind: "validation",
      status: "passed",
      contentHash: version.contentHash,
    });
    expect(evaluated.latestVersion?.securityReport).toMatchObject({
      kind: "security",
      status: "passed",
      contentHash: version.contentHash,
    });

    await service.transitionStatus(
      seeded.company.id,
      created.artifact.id,
      {
        expectedStatus: "candidate",
        expectedLatestVersionId: version.id,
        status: "testing",
      },
      user,
    );
    const active = await service.transitionStatus(
      seeded.company.id,
      created.artifact.id,
      {
        expectedStatus: "testing",
        expectedLatestVersionId: version.id,
        status: "active",
      },
      user,
    );
    expect(active.artifact.status).toBe("active");

    await instanceSettingsService(db).updateExperimental({
      enableAutomationArtifactsV1: true,
    });
    const executed = await runtime.execute(
      seeded.company.id,
      created.artifact.id,
      version.id,
      { email: " BOB@Example.com " },
      user,
    );
    expect(executed.output).toEqual({ email: " BOB@Example.com " });
  });

  it("rejects mismatched gate hashes and keeps generated-code execution behind its kill switch", async () => {
    const seeded = await seedCompany();
    const user = userActor(seeded.userId);
    const system = systemActor();
    const service = automationArtifactService(db);

    const created = await service.create(
      seeded.company.id,
      input({
        kind: "typescript",
        language: "typescript",
        inputSchema: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false,
        },
        sourceCode:
          "export default (input: { value: number }) => ({ value: input.value + 1 });",
        testSpec: {
          cases: [{ input: { value: 1 }, output: { value: 2 } }],
        },
      }),
      user,
    );
    const version = created.latestVersion!;
    const reportBase = {
      schema: "automation_artifact_gate.v1" as const,
      status: "passed" as const,
      checkedAt: "2026-09-30T20:00:00.000Z",
      checks: [],
    };

    await expect(
      service.recordGateReports(
        seeded.company.id,
        created.artifact.id,
        version.id,
        {
          validationReport: {
            ...reportBase,
            kind: "validation",
            contentHash: "0".repeat(64),
          },
          securityReport: {
            ...reportBase,
            kind: "security",
            contentHash: "0".repeat(64),
          },
        },
        system,
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({
        code: "automation_artifact_gate_hash_mismatch",
      }),
    });

    await service.recordGateReports(
      seeded.company.id,
      created.artifact.id,
      version.id,
      {
        validationReport: {
          ...reportBase,
          kind: "validation",
          contentHash: version.contentHash,
        },
        securityReport: {
          ...reportBase,
          kind: "security",
          contentHash: version.contentHash,
        },
      },
      system,
    );

    await service.transitionStatus(
      seeded.company.id,
      created.artifact.id,
      {
        expectedStatus: "candidate",
        expectedLatestVersionId: version.id,
        status: "testing",
      },
      user,
    );
    await expect(
      service.transitionStatus(
        seeded.company.id,
        created.artifact.id,
        {
          expectedStatus: "testing",
          expectedLatestVersionId: version.id,
          status: "active",
        },
        user,
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "automation_artifact_code_execution_disabled",
      }),
    });

    if (qualifiedLinuxArtifactSandbox) {
      await instanceSettingsService(db).updateExperimental({
        enableAutomationArtifactsV1: true,
        enableAutomationArtifactCodeExecutionV1: true,
      });
      const active = await service.transitionStatus(
        seeded.company.id,
        created.artifact.id,
        {
          expectedStatus: "testing",
          expectedLatestVersionId: version.id,
          status: "active",
        },
        user,
      );
      expect(active.artifact.status).toBe("active");

      const executed = await automationArtifactRuntimeService(db).execute(
        seeded.company.id,
        created.artifact.id,
        version.id,
        { value: 1 },
        user,
      );
      expect(executed.output).toEqual({ value: 2 });
    }
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
