import { instanceSettingsService } from "../services/instance-settings.js";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueCreateIdempotencyKeys,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";


const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres V9 task receipt route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("V9 Native task receipt read", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "paperclip-v9-task-draft-receipt-",
    );
    db = createDb(tempDb.connectionString);
    await instanceSettingsService(db).updateExperimental({
      experience_projection_v9: true,
      ambient_commands_v9: true,
    });
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueCreateIdempotencyKeys);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  it("reads minimal current Native task data without another mutation", async () => {
    const companyId = await seedCompany(),
      key = randomUUID(),
      app = createApp();
    const created = await request(app)
      .post(`/api/companies/${companyId}/issues?awExperienceDraft=task`)
      .send({
        title: "Private customer task",
        description: "PRIVATE-DESCRIPTION",
        status: "backlog",
        priority: "medium",
        assigneeAgentId: null,
        assigneeUserId: null,
        allowDuplicate: true,
        idempotencyKey: key,
      })
      .expect(201);
    const url = `/api/companies/${companyId}/issues/create-receipts/${key}`;
    const read = await request(app).get(url).expect(200);
    expect(read.body).toEqual({
      id: created.body.id,
      companyId,
      title: "Private customer task",
    });
    expect(read.headers["cache-control"]).toBe("no-store");
    await db
      .update(issues)
      .set({ title: "Current Native title" })
      .where(eq(issues.id, created.body.id));
    expect((await request(app).get(url).expect(200)).body.title).toBe(
      "Current Native title",
    );
    expect(await db.select().from(issues)).toHaveLength(1);
    expect(await db.select().from(heartbeatRuns)).toHaveLength(0);
  });
  it("does not manufacture an issue or key when no receipt was committed", async () => {
    const companyId = await seedCompany(),
      app = createApp();
    await request(app)
      .get(`/api/companies/${companyId}/issues/create-receipts/${randomUUID()}`)
      .expect(404);
    expect(await db.select().from(issues)).toEqual([]);
    expect(await db.select().from(issueCreateIdempotencyKeys)).toEqual([]);
  });
  it("cannot read another company's receipt through the selected company", async () => {
    const owner = await seedCompany(),
      other = await seedCompany(),
      key = randomUUID(),
      app = createApp();
    await request(app)
      .post(`/api/companies/${owner}/issues`)
      .send({ title: "Foreign private task", idempotencyKey: key })
      .expect(201);
    const response = await request(app)
      .get(`/api/companies/${other}/issues/create-receipts/${key}`)
      .expect(404);
    expect(JSON.stringify(response.body)).not.toContain("Foreign private task");
  });
  it("leaves a deleted Native key unconfirmed without recreating its task", async () => {
    const companyId = await seedCompany(),
      key = randomUUID(),
      app = createApp();
    await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Erased receipt task", idempotencyKey: key })
      .expect(201);
    await db
      .delete(issueCreateIdempotencyKeys)
      .where(eq(issueCreateIdempotencyKeys.idempotencyKey, key));
    await request(app)
      .get(`/api/companies/${companyId}/issues/create-receipts/${key}`)
      .expect(404);
    expect(await db.select().from(issues)).toHaveLength(1);
    expect(await db.select().from(issueCreateIdempotencyKeys)).toEqual([]);
  });
  it("fails closed on feature rollback and malformed keys", async () => {
    const companyId = await seedCompany(),
      key = randomUUID(),
      app = createApp();
    await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Private task", idempotencyKey: key })
      .expect(201);
    await request(app)
      .get(
        `/api/companies/${companyId}/issues/create-receipts/invalid-private-key`,
      )
      .expect(404);
    await instanceSettingsService(db).updateExperimental({
      ambient_commands_v9: false,
    });
    try {
      await request(app)
        .get(`/api/companies/${companyId}/issues/create-receipts/${key}`)
        .expect(404);
    } finally {
      await instanceSettingsService(db).updateExperimental({
        ambient_commands_v9: true,
      });
    }
    expect(await db.select().from(issues)).toHaveLength(1);
  });
});
