import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authUsers, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { projectBusinessEvent } from "../services/business-events.js";
import { projectService as nativeProjectService } from "../services/projects.js";

const mockProjectService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  updateWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  remove: vi.fn(),
  resolveByReference: vi.fn(),
}));
const mockSecretService = vi.hoisted(() => ({
  normalizeEnvBindingsForPersistence: vi.fn(),
}));
const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());
const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: mockGetTelemetryClient,
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  environmentService: () => mockEnvironmentService,
  logActivity: mockLogActivity,
  projectService: () => mockProjectService,
  secretService: () => mockSecretService,
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

vi.mock("../services/environments.js", () => ({
  environmentService: () => mockEnvironmentService,
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/workspace-runtime.js", () => ({
  startRuntimeServicesForWorkspaceControl: vi.fn(),
  stopRuntimeServicesForProjectWorkspace: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../services/activity-log.js", async () => ({
    ...await vi.importActual<typeof import("../services/activity-log.js")>("../services/activity-log.js"),
    persistActivity: async (db: unknown, input: unknown) => { await mockLogActivity(db, input); return { activity: { id: "activity" }, publication: null }; },
    publishActivity: vi.fn(),
  }));
  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: mockGetTelemetryClient,
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    environmentService: () => mockEnvironmentService,
    logActivity: mockLogActivity,
    projectService: () => mockProjectService,
    secretService: () => mockSecretService,
    workspaceOperationService: () => mockWorkspaceOperationService,
  }));

  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));

  vi.doMock("../services/secrets.js", () => ({
    secretService: () => mockSecretService,
  }));

  vi.doMock("../services/workspace-runtime.js", () => ({
    startRuntimeServicesForWorkspaceControl: vi.fn(),
    stopRuntimeServicesForProjectWorkspace: vi.fn(),
  }));
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createApp(db: ReturnType<typeof createDb>, companyId: string, userId: string) {
  const [{ projectRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/projects.js")>("../routes/projects.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // This route fixture exercises the native DB mutation boundary with a
    // stored human and membership; it does not qualify HTTP session auth.
    req.actor = {
      type: "board",
      userId,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "admin", status: "active" }],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("project env routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";
  let userId = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-project-routes-env-");
    db = createDb(tempDb.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await tempDb?.cleanup();
  }, 30_000);

  async function seedCompany() {
    companyId = randomUUID();
    userId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Project Env Test",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const now = new Date();
    await db.insert(authUsers).values({
      id: userId,
      name: "Project Owner",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "admin",
    });
  }

  function routeApp() {
    mockProjectService.create.mockImplementation((...args: Parameters<ReturnType<typeof nativeProjectService>["create"]>) => nativeProjectService(db).create(...args));
    mockProjectService.getById.mockImplementation((...args: Parameters<ReturnType<typeof nativeProjectService>["getById"]>) => nativeProjectService(db).getById(...args));
    mockProjectService.update.mockImplementation((...args: Parameters<ReturnType<typeof nativeProjectService>["update"]>) => nativeProjectService(db).update(...args));
    return createApp(db, companyId, userId);
  }
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/projects.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.doUnmock("../services/environments.js");
    vi.doUnmock("../services/secrets.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      action: "project:read",
      reason: "allow_test",
      explanation: "Allowed by test mock.",
    });
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockProjectService.resolveByReference.mockResolvedValue({ ambiguous: false, project: null });
    mockProjectService.createWorkspace.mockResolvedValue(null);
    mockProjectService.listWorkspaces.mockResolvedValue([]);
    mockEnvironmentService.getById.mockReset();
    mockSecretService.normalizeEnvBindingsForPersistence.mockImplementation(async (_companyId, env) => env);
  });

  it("normalizes env bindings on create and logs only env keys", async () => {
    await seedCompany();
    const normalizedEnv = {
      API_KEY: {
        type: "secret_ref",
        secretId: "11111111-1111-4111-8111-111111111111",
        version: "latest",
      },
    };
    mockSecretService.normalizeEnvBindingsForPersistence.mockResolvedValue(normalizedEnv);
    const app = await routeApp();
    const res = await request(app)
      .post(`/api/companies/${companyId}/projects`)
      .send({
        name: "Project",
        env: normalizedEnv,
      });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(mockSecretService.normalizeEnvBindingsForPersistence).toHaveBeenCalledWith(
      companyId,
      normalizedEnv,
      expect.objectContaining({ fieldPath: "env" }),
    );
    expect(mockProjectService.create).toHaveBeenCalledTimes(1);
    const [createdCompany, createdInput, creationTx, creationActor] = mockProjectService.create.mock.calls[0]!;
    expect(createdCompany).toBe(companyId);
    expect(createdInput).toMatchObject({ env: normalizedEnv });
    expect(creationTx).toBeDefined();
    expect(creationActor).toMatchObject({ type: "board", userId, companyIds: [companyId] });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: expect.objectContaining({
          envKeys: ["API_KEY"],
          status:"backlog",
        }),
      }),
    );
  });

  it("normalizes env bindings on update and avoids logging raw values", async () => {
    await seedCompany();
    const normalizedEnv = {
      PLAIN_KEY: { type: "plain", value: "top-secret" },
    };
    mockSecretService.normalizeEnvBindingsForPersistence.mockResolvedValue(normalizedEnv);
    const app = await routeApp();
    const created = await request(app).post(`/api/companies/${companyId}/projects`).send({ name: "Project" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const projectId = created.body.id as string;
    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .send({
        env: normalizedEnv,
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        details: {
          changedKeys: ["env"],
          envKeys: ["PLAIN_KEY"],
        },
      }),
    );
  });

  it("records returned project states for lifecycle projection while keeping environment-only changes status-free",async()=>{
    await seedCompany();
    const app=await routeApp();
    const created = await request(app).post(`/api/companies/${companyId}/projects`).send({name:"Planned native flow",status:"planned"}).expect(201);
    const projectId = created.body.id as string;
    await request(app).patch(`/api/projects/${projectId}`).send({status:"completed"}).expect(200);
    const sources=mockLogActivity.mock.calls.map(call=>call[1] as {action:string;entityType:string;entityId:string;details:Record<string,unknown>})
      .map((source,index)=>projectBusinessEvent({...source,createdAt:new Date(`2026-01-01T12:0${index}:00Z`)}));
    expect(sources[0]).toMatchObject({lifecycle:"created",attributes:{status:"planned"},objects:[{objectType:"project",objectId:projectId,qualifier:"primary"}]});
    expect(sources[1]).toMatchObject({lifecycle:"updated",attributes:{status:"completed"}});
    expect(JSON.stringify(sources)).not.toContain("Planned native flow");
  });
});
