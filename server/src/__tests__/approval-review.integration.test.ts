import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvals, companies, createDb } from "@paperclipai/db";
import { approvalService } from "../services/approvals.js";
import { approvalReviewHash } from "../services/approval-review.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe.sequential : describe.skip)("Original approval material binding", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-approval-review-"); db = createDb(database.connectionString); }, 60000);
  afterAll(async () => { await database?.cleanup(); });
  async function fixture(type = "request_board_approval") {
    const [company] = await db.insert(companies).values({ name: "Approval review fixture", issuePrefix: `R${randomUUID().replaceAll("-", "").toUpperCase()}` }).returning();
    const [value] = await db.insert(approvals).values({ companyId: company.id, type, payload: { summary: "Reviewed material", consequence: "One bounded action" } }).returning();
    return value;
  }
  it("refuses a changed payload before decision and keeps exact terminal retries idempotent", async () => {
    const value = await fixture(), service = approvalService(db), hash = approvalReviewHash(value);
    await db.update(approvals).set({ payload: { summary: "Different material" }, updatedAt: new Date() }).where(eq(approvals.id, value.id));
    await expect(service.approve(value.id, "reviewer", undefined, hash)).rejects.toMatchObject({ status: 409, details: { code: "approval_review_changed" } });
    const current = (await service.getById(value.id))!;
    expect(current.status).toBe("pending");
    const reviewed = approvalReviewHash(current);
    expect(await service.approve(value.id, "reviewer", undefined, reviewed)).toMatchObject({ applied: true, approval: { status: "approved" } });
    expect(await service.approve(value.id, "reviewer", undefined, reviewed)).toMatchObject({ applied: false, approval: { status: "approved" } });
  });
  it("compares material in the actual UPDATE after a concurrent row-lock wait", async () => {
    const value = await fixture(), service = approvalService(db), hash = approvalReviewHash(value);
    let unlock!: () => void, locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const writer = db.transaction(async tx => {
      await tx.select().from(approvals).where(eq(approvals.id, value.id)).for("update");
      locked(); await release;
      await tx.update(approvals).set({ payload: { summary: "Concurrent replacement" }, updatedAt: new Date() }).where(eq(approvals.id, value.id));
    });
    await ready;
    const resolution = service.approve(value.id, "reviewer", undefined, hash);
    const outcome = resolution.then(result => ({ result }), error => ({ error }));
    try {
      await expect.poll(async () => {
        const rows = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_stat_activity where datname = current_database()
          and wait_event_type = 'Lock' and query ilike '%update%approvals%') as waiting`);
        return rows[0]?.waiting;
      }, { timeout: 5000 }).toBe(true);
    } finally { unlock(); await writer; }
    expect(await outcome).toMatchObject({ error: { status: 409, details: { code: "approval_review_changed" } } });
    expect(await service.getById(value.id)).toMatchObject({ status: "pending", payload: { summary: "Concurrent replacement" } });
  });
  it("keeps the published workflow checkpoint material immutable during resubmission", async () => {
    const value = await fixture("workflow_step_approval"), service = approvalService(db);
    await service.requestRevision(value.id, "reviewer");
    await expect(service.resubmit(value.id, { ...value.payload, consequence: "Another action" })).rejects.toMatchObject({ status: 409, details: { code: "workflow_approval_snapshot_immutable" } });
    expect(await service.getById(value.id)).toMatchObject({ status: "revision_requested", payload: value.payload });
    expect(await service.resubmit(value.id, value.payload)).toMatchObject({ status: "pending", payload: value.payload });
  });
  it("preserves Original caller-authored revision and resubmission behavior", async () => {
    const value = await fixture(), service = approvalService(db);
    await service.requestRevision(value.id, "reviewer", "Clarify the action");
    expect(await service.resubmit(value.id, { summary: "Explicit revision" })).toMatchObject({ status: "pending", payload: { summary: "Explicit revision" } });
    expect(await db.select().from(approvals).where(and(eq(approvals.id, value.id), eq(approvals.status, "pending")))).toHaveLength(1);
  });
});
