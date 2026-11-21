import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, companies, createDb, projects } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { projectRoutes } from "../routes/projects.js";

const mockProjectReadDecision = vi.hoisted(() => vi.fn());
vi.mock("../services/index.js", async () => {
  const actual = await vi.importActual<typeof import("../services/index.js")>("../services/index.js");
  return {
    ...actual,
    accessService: (db: Parameters<typeof actual.accessService>[0]) => ({
      ...actual.accessService(db),
      decide: mockProjectReadDecision,
    }),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project list archived tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

function boardActor(companyId: string): Express.Request["actor"] {
  return {
    type: "board",
    userId: "local-board",
    source: "local_implicit",
    isInstanceAdmin: true,
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: "admin", status: "active" }],
  };
}

function createApp(db: ReturnType<typeof createDb>, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("project list archived route defaults", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-projects-list-archived-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(() => {
    mockProjectReadDecision.mockImplementation(async (input: { action: string }) => ({
      allowed: true, action: input.action, reason: "allow_test", explanation: "Project list behavior fixture.",
    }));
  });

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const app = createApp(db, boardActor(companyId));
    const active = await request(app).post(`/api/companies/${companyId}/projects`).send({
      name: "Active Project",
      status: "in_progress",
    });
    expect(active.status).toBe(201);
    const archived = await request(app).post(`/api/companies/${companyId}/projects`).send({
      name: "Archived Project",
      status: "completed",
    });
    expect(archived.status).toBe(201);
    const archivedProjectId = archived.body.id as string;
    const archiveResult = await request(app).patch(`/api/projects/${archivedProjectId}`).send({
      archivedAt: new Date().toISOString(),
    });
    expect(archiveResult.status).toBe(200);

    return { activeProjectId: active.body.id as string, archivedProjectId, companyId };
  }

  it("omits archived projects by default", async () => {
    const { activeProjectId, archivedProjectId, companyId } = await seed();
    const app = createApp(db, boardActor(companyId));

    const res = await request(app).get(`/api/companies/${companyId}/projects`);

    expect(res.status).toBe(200);
    expect(res.body.map((project: { id: string }) => project.id)).toEqual([activeProjectId]);
    expect(res.body.map((project: { id: string }) => project.id)).not.toContain(archivedProjectId);
  });

  it("includes archived projects when includeArchived is true", async () => {
    const { activeProjectId, archivedProjectId, companyId } = await seed();
    const app = createApp(db, boardActor(companyId));

    const res = await request(app).get(`/api/companies/${companyId}/projects?includeArchived=true`);

    expect(res.status).toBe(200);
    // The list contract does not specify physical PostgreSQL row order.
    expect(res.body.map((project: { id: string }) => project.id).sort()).toEqual([activeProjectId, archivedProjectId].sort());
  });
});
