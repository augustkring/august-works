import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  principalPermissionGrants,
  workflowRevisions,
  workflowRuns,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { admitCustomerWorkflowTest } from "../services/workflows/workflow-customer-test.js";
import {
  admitCustomerWorkflowPublication,
  readCustomerWorkflowPublication,
} from "../services/workflows/workflow-customer-publication.js";
import type { AuthorizationActor } from "../services/authorization.js";
const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;
describePg("V9 actual reviewed native workflow publication", () => {
  let db!: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const local: AuthorizationActor = { type: "board", source: "local_implicit" };
  const native = {
    principal: { type: "system" as const, service: "local-board" },
  };
  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase(
      "v9-reviewed-publication-",
    );
    db = createDb(fixture.connectionString);
  }, 20000);
  afterAll(async () => {
    await fixture?.cleanup();
  });
  async function source() {
    await instanceSettingsService(db).updateExperimental({
      enableWorkflowsV1: true,
      experience_projection_v9: true,
      progressive_shell_v9: true,
    });
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Actual internal publication fixture",
      issuePrefix: randomUUID(),
    });
    const created = await workflowService(db).create(
      companyId,
      { name: "Reviewed internal flow" },
      native,
    );
    return workflowService(db).updateDraft(
      companyId,
      created.id,
      {
        expectedRevisionId: created.draftRevisionId!,
        graph: {
          version: 1,
          nodes: [
            {
              id: "start",
              type: "core.manual_trigger",
              name: "Internal start",
              config: {},
              position: { x: 0, y: 0 },
            },
          ],
          edges: [],
          variables: [],
          settings: { totalDeadlineSeconds: 60 },
        },
      },
      native,
    );
  }
  async function tested(authority = local) {
    const detail = await source();
    const receipt = await admitCustomerWorkflowTest(
      db,
      detail.companyId,
      detail.id,
      {
        requestId: randomUUID(),
        expectedWorkflowId: detail.id,
        expectedDraftRevisionId: detail.draftRevisionId!,
        expectedUpdatedAt: detail.updatedAt.toISOString(),
        expectedRunStatus: "succeeded",
        acknowledgeInternalTest: true,
      },
      authority,
    );
    await workflowExecutorService(db).executeQueuedRun(
      detail.companyId,
      receipt.runId,
      native,
    );
    return { detail, receipt };
  }
  async function reviewed(
    f: Awaited<ReturnType<typeof tested>>,
    authority = local,
  ) {
    const view = await readCustomerWorkflowPublication(
      db,
      f.detail.companyId,
      f.detail.id,
      authority,
    );
    return {
      requestId: randomUUID(),
      expectedWorkflowId: view.workflowId,
      expectedUpdatedAt: view.updatedAt,
      expectedDraftRevisionId: view.draftRevisionId!,
      expectedPublishedRevisionId: view.publishedRevisionId,
      expectedTestRunId: view.testedRunId!,
      acknowledgeInternalPublication: true as const,
    };
  }
  it("publishes the exact successful internal test revision and keeps its purpose separate from live work", async () => {
    const f = await tested(),
      command = await reviewed(f);
    const receipt = await admitCustomerWorkflowPublication(
      db,
      f.detail.companyId,
      f.detail.id,
      local,
      command,
    );
    expect(receipt).toMatchObject({
      revisionId: f.receipt.revisionId,
      testRunId: f.receipt.runId,
      disposition: "published",
    });
    const detail = (await workflowService(db).getDetail(
      f.detail.companyId,
      f.detail.id,
      local,
    ))!;
    expect(detail.publishedRevisionId).toBe(f.receipt.revisionId);
    expect(detail.draftRevisionId).not.toBe(f.receipt.revisionId);
    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, f.receipt.runId));
    expect(run!.source).toBe("test");
    const current = await readCustomerWorkflowPublication(
      db,
      f.detail.companyId,
      f.detail.id,
      local,
    );
    expect(current.receipt).toEqual(receipt);
    expect(current.availability).toBe("test_required");
  });
  it("reads each exact Original Test/Publish/Run/status request after rollout withdrawal without replaying work", async () => {
    const f = await tested(), service = workflowService(db), command = await reviewed(f);
    const publication = await admitCustomerWorkflowPublication(db, f.detail.companyId, f.detail.id, local, command);
    const active = (await service.getDetail(f.detail.companyId, f.detail.id, local))!;
    const run = await service.launch(f.detail.companyId, f.detail.id, { requestId: randomUUID(), expectedUpdatedAt: active.updatedAt.toISOString(),
      expectedPublishedRevisionId: active.publishedRevisionId!, expectedDraftRevisionId: active.draftRevisionId,
      acknowledgeInternalExecution: true }, local);
    const pause = await service.lifecycle(f.detail.companyId, f.detail.id, { requestId: randomUUID(), action: "pause", expectedStatus: "active",
      expectedUpdatedAt: active.updatedAt.toISOString(), expectedPublishedRevisionId: active.publishedRevisionId,
      expectedDraftRevisionId: active.draftRevisionId, workPolicy: "finish_existing" }, local);
    const before = { runs: await db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.companyId, f.detail.companyId)),
      events: await db.select({ id: activityLog.id }).from(activityLog).where(eq(activityLog.companyId, f.detail.companyId)),
      revisions: await db.select({ id: workflowRevisions.id }).from(workflowRevisions).where(eq(workflowRevisions.companyId, f.detail.companyId)) };
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: false, progressive_shell_v9: false });
    for (const [kind, receipt] of [["test", f.receipt], ["publication", publication], ["launch", run], ["lifecycle", pause]] as const) {
      expect(await service.requestReceipt(f.detail.companyId, f.detail.id, kind, receipt.requestId, local)).toEqual({ kind, receipt });
      await expect(service.requestReceipt(f.detail.companyId, f.detail.id, kind, randomUUID(), local)).rejects.toMatchObject({ status: 404 });
    }
    expect(await db.select({ id: workflowRuns.id }).from(workflowRuns).where(eq(workflowRuns.companyId, f.detail.companyId))).toEqual(before.runs);
    expect(await db.select({ id: activityLog.id }).from(activityLog).where(eq(activityLog.companyId, f.detail.companyId))).toEqual(before.events);
    expect(await db.select({ id: workflowRevisions.id }).from(workflowRevisions).where(eq(workflowRevisions.companyId, f.detail.companyId))).toEqual(before.revisions);
    // Own historical admission is separate from the current paused workflow;
    // no queued execution, new audit, draft or publication is created by GET.
    expect((await service.getDetail(f.detail.companyId, f.detail.id, local))?.status).toBe("paused");
  });
  it("concurrent original requests publish once and replay after the next draft changes", async () => {
    const f = await tested(),
      command = await reviewed(f);
    const receipts = await Promise.all([
      admitCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        local,
        command,
      ),
      admitCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        local,
        command,
      ),
    ]);
    expect(receipts[1]).toEqual(receipts[0]);
    const detail = (await workflowService(db).getDetail(
      f.detail.companyId,
      f.detail.id,
      local,
    ))!;
    const graph = structuredClone(detail.draftRevision!.graph);
    graph.nodes[0].name = "Next reviewed draft";
    await workflowService(db).updateDraft(
      detail.companyId,
      detail.id,
      { expectedRevisionId: detail.draftRevisionId!, graph },
      native,
    );
    expect(
      await admitCustomerWorkflowPublication(
        db,
        detail.companyId,
        detail.id,
        local,
        command,
      ),
    ).toEqual(receipts[0]);
    expect(
      await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, detail.id),
            eq(activityLog.action, "workflow.customer_publication_recorded"),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(workflowRevisions)
        .where(
          and(
            eq(workflowRevisions.workflowId, detail.id),
            eq(workflowRevisions.state, "published"),
          ),
        ),
    ).toHaveLength(1);
  });
  it("refuses a stale review, another test run and false acknowledgement before publication", async () => {
    const f = await tested(),
      command = await reviewed(f);
    for (const change of [
      { expectedUpdatedAt: "2000-01-01T00:00:00Z" },
      { expectedTestRunId: randomUUID() },
    ])
      await expect(
        admitCustomerWorkflowPublication(
          db,
          f.detail.companyId,
          f.detail.id,
          local,
          { ...command, ...change },
        ),
      ).rejects.toMatchObject({ status: 409 });
    await expect(
      admitCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        local,
        { ...command, acknowledgeInternalPublication: false } as never,
      ),
    ).rejects.toThrow();
    expect(
      (await workflowService(db).getDetail(
        f.detail.companyId,
        f.detail.id,
        local,
      ))!.publishedRevisionId,
    ).toBeNull();
  });
  it("requires a successful test of the current draft rather than the previous draft", async () => {
    const f = await tested(),
      command = await reviewed(f),
      graph = structuredClone(f.detail.draftRevision!.graph);
    graph.nodes[0].name = "Changed after test";
    await workflowService(db).updateDraft(
      f.detail.companyId,
      f.detail.id,
      { expectedRevisionId: f.detail.draftRevisionId!, graph },
      native,
    );
    expect(
      (
        await readCustomerWorkflowPublication(
          db,
          f.detail.companyId,
          f.detail.id,
          local,
        )
      ).availability,
    ).toBe("test_required");
    await expect(
      admitCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        local,
        command,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("does not promote an untested draft or paused workflow", async () => {
    const detail = await source();
    expect(
      (
        await readCustomerWorkflowPublication(
          db,
          detail.companyId,
          detail.id,
          local,
        )
      ).availability,
    ).toBe("test_required");
    const f = await tested(),
      command = await reviewed(f);
    await workflowService(db).lifecycle(
      f.detail.companyId,
      f.detail.id,
      {
        requestId: randomUUID(),
        expectedUpdatedAt: f.detail.updatedAt.toISOString(),
        expectedStatus: "active",
        expectedDraftRevisionId: f.detail.draftRevisionId,
        expectedPublishedRevisionId: null,
        action: "pause",
        workPolicy: "finish_existing",
      },
      local,
    );
    await expect(
      admitCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        local,
        command,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects changed original requests and corrupt native receipts", async () => {
    const f = await tested(),
      command = await reviewed(f);
    await admitCustomerWorkflowPublication(
      db,
      f.detail.companyId,
      f.detail.id,
      local,
      command,
    );
    await expect(
      admitCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        local,
        { ...command, expectedTestRunId: randomUUID() },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const [event] = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, f.detail.id),
          eq(activityLog.action, "workflow.customer_publication_recorded"),
        ),
      );
    await db
      .update(activityLog)
      .set({
        details: {
          command,
          receipt: {
            ...(event!.details!.receipt as object),
            revisionId: randomUUID(),
          },
        },
      })
      .where(eq(activityLog.id, event!.id));
    await expect(
      readCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        local,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rolls back native publication and its next draft when the atomic receipt cannot be retained", async () => {
    const f = await tested(),
      command = await reviewed(f);
    const before = await db
      .select()
      .from(workflowRevisions)
      .where(eq(workflowRevisions.workflowId, f.detail.id));
    await db.execute(sql`create function public.v9_reject_publication_audit() returns trigger language plpgsql as $$
      begin if new.action='workflow.customer_publication_recorded' then raise exception 'Synthetic receipt persistence refusal' using errcode='23514'; end if; return new; end $$`);
    await db.execute(
      sql`create trigger v9_reject_publication_audit before insert on activity_log for each row execute function public.v9_reject_publication_audit()`,
    );
    try {
      await expect(
        admitCustomerWorkflowPublication(
          db,
          f.detail.companyId,
          f.detail.id,
          local,
          command,
        ),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    } finally {
      await db.execute(
        sql`drop trigger v9_reject_publication_audit on activity_log`,
      );
      await db.execute(sql`drop function public.v9_reject_publication_audit()`);
    }
    const current = (await workflowService(db).getDetail(
      f.detail.companyId,
      f.detail.id,
      local,
    ))!;
    expect(current.publishedRevisionId).toBeNull();
    expect(current.draftRevisionId).toBe(f.receipt.revisionId);
    expect(current.draftRevision!.state).toBe("draft");
    expect(
      await db
        .select()
        .from(workflowRevisions)
        .where(eq(workflowRevisions.workflowId, current.id)),
    ).toHaveLength(before.length);
    expect(
      await db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, current.id),
            eq(activityLog.action, "workflow.customer_publication_recorded"),
          ),
        ),
    ).toHaveLength(0);
  });
  it("requires current publisher authority and does not leak another human's stored receipt", async () => {
    const f = await tested(),
      command = await reviewed(f);
    await admitCustomerWorkflowPublication(
      db,
      f.detail.companyId,
      f.detail.id,
      local,
      command,
    );
    const userId = randomUUID(),
      authority: AuthorizationActor = {
        type: "board",
        source: "session",
        userId,
        isInstanceAdmin: true,
      };
    await db.insert(companyMemberships).values({
      companyId: f.detail.companyId,
      principalType: "user",
      principalId: userId,
      membershipRole: "member",
      status: "active",
    });
    for (const permissionKey of [
      "workflows:read",
      "workflows:edit",
      "workflows:run",
      "workflows:publish",
    ])
      await db.insert(principalPermissionGrants).values({
        companyId: f.detail.companyId,
        principalType: "user",
        principalId: userId,
        permissionKey,
      });
    expect(
      (
        await readCustomerWorkflowPublication(
          db,
          f.detail.companyId,
          f.detail.id,
          authority,
        )
      ).receipt,
    ).toBeNull();
    await expect(workflowService(db).requestReceipt(f.detail.companyId, f.detail.id, "publication", command.requestId, authority)).rejects.toMatchObject({ status: 404 });
    await db
      .delete(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.principalId, userId),
          eq(principalPermissionGrants.permissionKey, "workflows:publish"),
        ),
      );
    await expect(
      readCustomerWorkflowPublication(
        db,
        f.detail.companyId,
        f.detail.id,
        authority,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(workflowService(db).requestReceipt(f.detail.companyId, f.detail.id, "publication", command.requestId, { ...authority, isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
  });
});
