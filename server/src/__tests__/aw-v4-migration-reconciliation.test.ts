import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  agents,
  companies,
  createDb,
  pipelineAutomationExecutions,
  pipelineCaseEvents,
  pipelineCases,
  pipelineStages,
  pipelines,
  routines,
  workflows,
} from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";

import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { awV4MigrationReconciliationService } from "../services/aw-v4-migration-reconciliation.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe.sequential
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping AW V4 migration reconciliation tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("AW V4 migration reconciliation", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-aw-v4-migration-",
    );
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(pipelineAutomationExecutions);
    await db.delete(pipelineCaseEvents);
    await db.delete(pipelineCases);
    await db.delete(pipelineStages);
    await db.delete(pipelines);
    await db.delete(routines);
    await db.delete(workflows);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name: string) {
    const id = randomUUID();
    const [company] = await db
      .insert(companies)
      .values({
        id,
        name,
        issuePrefix: name.slice(0, 3).toUpperCase() + id.slice(0, 3),
      })
      .returning();
    return company!;
  }

  async function seedAgent(companyId: string, name: string) {
    const [agent] = await db
      .insert(agents)
      .values({
        companyId,
        name,
        role: "general",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      })
      .returning();
    return agent!;
  }

  async function seedLegacyPipelineExecution(input: {
    companyId: string;
    routineId: string;
    key: string;
  }) {
    const [pipeline] = await db
      .insert(pipelines)
      .values({
        companyId: input.companyId,
        key: input.key,
        name: input.key,
      })
      .returning();
    const [stage] = await db
      .insert(pipelineStages)
      .values({
        pipelineId: pipeline!.id,
        key: "working",
        name: "Working",
        kind: "working",
        position: 0,
      })
      .returning();
    const [pipelineCase] = await db
      .insert(pipelineCases)
      .values({
        companyId: input.companyId,
        pipelineId: pipeline!.id,
        stageId: stage!.id,
        caseKey: input.key,
        title: input.key,
      })
      .returning();
    const [event] = await db
      .insert(pipelineCaseEvents)
      .values({
        companyId: input.companyId,
        caseId: pipelineCase!.id,
        type: "ingested",
        actorType: "system",
      })
      .returning();
    const [execution] = await db
      .insert(pipelineAutomationExecutions)
      .values({
        companyId: input.companyId,
        caseId: pipelineCase!.id,
        automationId: `legacy-${input.key}`,
        triggeringEventId: event!.id,
        routineId: input.routineId,
        status: "failed",
        error: "legacy_fixture",
      })
      .returning();
    return execution!;
  }

  it("repairs only same-company unambiguous legacy targets and reports unsafe rows", async () => {
    const ownCompany = await seedCompany("Own");
    const otherCompany = await seedCompany("Other");
    const ownAgent = await seedAgent(ownCompany.id, "Own agent");
    const otherAgent = await seedAgent(otherCompany.id, "Other agent");

    const [safeRoutine] = await db
      .insert(routines)
      .values({
        companyId: ownCompany.id,
        title: "Safe legacy routine",
        assigneeAgentId: ownAgent.id,
        status: "active",
      })
      .returning();
    const [crossCompanyRoutine] = await db
      .insert(routines)
      .values({
        companyId: ownCompany.id,
        title: "Unsafe legacy routine",
        assigneeAgentId: otherAgent.id,
        status: "active",
      })
      .returning();
    await db.insert(routines).values({
      companyId: ownCompany.id,
      title: "Missing active target",
      assigneeAgentId: null,
      status: "active",
    });
    const [otherCompanyRoutine] = await db
      .insert(routines)
      .values({
        companyId: otherCompany.id,
        title: "Other company routine",
        assigneeAgentId: otherAgent.id,
        status: "active",
      })
      .returning();

    const safeExecution = await seedLegacyPipelineExecution({
      companyId: ownCompany.id,
      routineId: safeRoutine!.id,
      key: "safe-pipeline",
    });
    const unsafeExecution = await seedLegacyPipelineExecution({
      companyId: ownCompany.id,
      routineId: otherCompanyRoutine!.id,
      key: "unsafe-pipeline",
    });

    const reconciliation = awV4MigrationReconciliationService(db);
    const before = await reconciliation.inspect();

    expect(before.routines).toMatchObject({
      legacyTargets: 3,
      repairableLegacyTargets: 2,
      unsafeLegacyTargets: 1,
      activeWithoutTarget: 1,
    });
    expect(before.pipelines).toMatchObject({
      legacyRoutineTargets: 2,
      repairableLegacyRoutineTargets: 1,
      unsafeLegacyRoutineTargets: 1,
    });
    expect(before.cutoverReady).toBe(false);

    const repaired = await reconciliation.repairBatch({ batchSize: 10 });
    expect(repaired).toEqual({
      routinesRepaired: 2,
      pipelineExecutionsRepaired: 1,
      repaired: 3,
    });

    const [safeRoutineAfter] = await db
      .select()
      .from(routines)
      .where(eq(routines.id, safeRoutine!.id));
    expect(safeRoutineAfter).toMatchObject({
      assigneeAgentId: ownAgent.id,
      executionTargetKind: "agent_task",
      executionTargetRef: ownAgent.id,
    });

    const [unsafeRoutineAfter] = await db
      .select()
      .from(routines)
      .where(eq(routines.id, crossCompanyRoutine!.id));
    expect(unsafeRoutineAfter).toMatchObject({
      assigneeAgentId: otherAgent.id,
      executionTargetKind: null,
      executionTargetRef: null,
    });

    const [safeExecutionAfter] = await db
      .select()
      .from(pipelineAutomationExecutions)
      .where(eq(pipelineAutomationExecutions.id, safeExecution.id));
    expect(safeExecutionAfter).toMatchObject({
      routineId: safeRoutine!.id,
      targetKind: "routine",
      targetRef: safeRoutine!.id,
    });

    const [unsafeExecutionAfter] = await db
      .select()
      .from(pipelineAutomationExecutions)
      .where(eq(pipelineAutomationExecutions.id, unsafeExecution.id));
    expect(unsafeExecutionAfter).toMatchObject({
      routineId: otherCompanyRoutine!.id,
      targetKind: null,
      targetRef: null,
    });

    await expect(
      reconciliation.repairBatch({ batchSize: 10 }),
    ).resolves.toEqual({
      routinesRepaired: 0,
      pipelineExecutionsRepaired: 0,
      repaired: 0,
    });

    const after = await reconciliation.inspect();
    expect(after.repairableCount).toBe(0);
    expect(after.routines.unsafeLegacyTargets).toBe(1);
    expect(after.routines.activeWithoutTarget).toBe(1);
    expect(after.pipelines.unsafeLegacyRoutineTargets).toBe(1);
    expect(after.blockerCount).toBeGreaterThanOrEqual(3);
    expect(after.cutoverReady).toBe(false);
  });

  it("revalidates legacy source authority when a repair races with reassignment", async () => {
    const ownCompany = await seedCompany("RaceOwn");
    const otherCompany = await seedCompany("RaceOther");
    const ownAgent = await seedAgent(ownCompany.id, "Original agent");
    const otherAgent = await seedAgent(otherCompany.id, "Cross-company agent");
    const [routine] = await db
      .insert(routines)
      .values({
        companyId: ownCompany.id,
        title: "Racing legacy routine",
        assigneeAgentId: ownAgent.id,
        status: "active",
      })
      .returning();

    const lockDb = createDb(tempDb!.connectionString);
    let releaseMutation: (() => void) | null = null;
    let markLocked: (() => void) | null = null;
    const mutationRelease = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const rowLocked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });

    const mutation = lockDb.transaction(async (tx) => {
      await tx
        .select({ id: routines.id })
        .from(routines)
        .where(eq(routines.id, routine!.id))
        .for("update");
      markLocked?.();
      await mutationRelease;
      await tx
        .update(routines)
        .set({
          assigneeAgentId: otherAgent.id,
          updatedAt: new Date(),
        })
        .where(eq(routines.id, routine!.id));
    });

    await rowLocked;

    const reconciliation = awV4MigrationReconciliationService(db);
    const repair = reconciliation.repairBatch({ batchSize: 10 });

    let blockedRepairObserved = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await db.execute(sql`
        select count(*)::int as count
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query ilike '%update%routines%'
      `);
      const raw = (rows as unknown as Array<{ count?: number | string }>)[0]?.count;
      if (Number(raw ?? 0) > 0) {
        blockedRepairObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blockedRepairObserved).toBe(true);

    releaseMutation?.();
    await mutation;

    await expect(repair).resolves.toEqual({
      routinesRepaired: 0,
      pipelineExecutionsRepaired: 0,
      repaired: 0,
    });

    const [stored] = await db
      .select()
      .from(routines)
      .where(eq(routines.id, routine!.id));
    expect(stored).toMatchObject({
      assigneeAgentId: otherAgent.id,
      executionTargetKind: null,
      executionTargetRef: null,
    });

    const snapshot = await reconciliation.inspect();
    expect(snapshot.routines.unsafeLegacyTargets).toBe(1);
    expect(snapshot.cutoverReady).toBe(false);
  });

  it("converges idempotently to a cutover-ready state for valid legacy rows", async () => {
    const company = await seedCompany("Ready");
    const agent = await seedAgent(company.id, "Ready agent");
    const [routine] = await db
      .insert(routines)
      .values({
        companyId: company.id,
        title: "Legacy ready routine",
        assigneeAgentId: agent.id,
        status: "active",
      })
      .returning();
    await seedLegacyPipelineExecution({
      companyId: company.id,
      routineId: routine!.id,
      key: "ready-pipeline",
    });

    const reconciliation = awV4MigrationReconciliationService(db);
    expect((await reconciliation.inspect()).cutoverReady).toBe(false);

    await expect(
      reconciliation.repairBatch({ batchSize: 1 }),
    ).resolves.toEqual({
      routinesRepaired: 1,
      pipelineExecutionsRepaired: 1,
      repaired: 2,
    });

    const final = await reconciliation.inspect();
    expect(final).toMatchObject({
      repairableCount: 0,
      blockerCount: 0,
      cutoverReady: true,
    });

    await expect(
      reconciliation.repairBatch({ batchSize: 1 }),
    ).resolves.toEqual({
      routinesRepaired: 0,
      pipelineExecutionsRepaired: 0,
      repaired: 0,
    });
  });

  it("rejects invalid repair batch sizes before touching data", async () => {
    const reconciliation = awV4MigrationReconciliationService(db);
    await expect(
      reconciliation.repairBatch({ batchSize: 0 }),
    ).rejects.toThrow(/batchSize/);
    await expect(
      reconciliation.repairBatch({ batchSize: 2_001 }),
    ).rejects.toThrow(/batchSize/);
  });
});
