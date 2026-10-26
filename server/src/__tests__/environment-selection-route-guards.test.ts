import type { Server } from "node:http";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { projectRoutes } from "../routes/projects.js";
import { issueRoutes } from "../routes/issues.js";

const mockProjectService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  createWorkspace: vi.fn(),
  remove: vi.fn(),
  resolveByReference: vi.fn(),
  listWorkspaces: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  getByIdentifier: vi.fn(),
  assertCheckoutOwner: vi.fn(),
}));

const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockIssueReferenceService = vi.hoisted(() => ({
  deleteDocumentSource: vi.fn(async () => undefined),
  diffIssueReferenceSummary: vi.fn(() => ({
    addedReferencedIssues: [],
    removedReferencedIssues: [],
    currentReferencedIssues: [],
  })),
  emptySummary: vi.fn(() => ({ outbound: [], inbound: [] })),
  listIssueReferenceSummary: vi.fn(async () => ({ outbound: [], inbound: [] })),
  syncComment: vi.fn(async () => undefined),
  syncDocument: vi.fn(async () => undefined),
  syncIssue: vi.fn(async () => undefined),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeEnvBindingsForPersistence: vi.fn(async (_companyId: string, env: Record<string, unknown>) => env),
}));
const mockAccessDecision = vi.hoisted(() => vi.fn(async () => ({ allowed: true })));
const mockCanReadIssuePrivacy = vi.hoisted(() => vi.fn(async () => true));
const mockCanReadProjectPrivacy = vi.hoisted(() => vi.fn(async () => true));
const mockAnalyticalPayloadAccess = vi.hoisted(() => vi.fn(async () => undefined));

const mockLogActivity = vi.hoisted(() => vi.fn());
let lastRouteError: unknown = null;

function routeErrorSummary() {
  if (!(lastRouteError instanceof Error)) return String(lastRouteError);
  const cause = lastRouteError.cause;
  return JSON.stringify({
    name: lastRouteError.name,
    message: lastRouteError.message,
    stack: lastRouteError.stack?.split("\n").slice(0, 8),
    cause: cause instanceof Error
      ? { name: cause.name, message: cause.message, code: (cause as NodeJS.ErrnoException).code }
      : cause == null ? null : String(cause).slice(0, 200),
  });
}

vi.mock("../services/index.js", () => ({
  projectService: () => mockProjectService,
  issueService: () => mockIssueService,
  companyService: () => mockCompanyService,
  environmentService: () => mockEnvironmentService,
  issueReferenceService: () => mockIssueReferenceService,
  logActivity: mockLogActivity,
  workspaceOperationService: () => ({}),
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
    decide: mockAccessDecision,
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  companySkillService: () => ({
    completeTestRunForIssue: vi.fn(async () => null),
  }),
  executionWorkspaceService: () => ({}),
  goalService: () => ({
    getById: vi.fn(),
    getDefaultCompanyGoal: vi.fn(),
  }),
  heartbeatService: () => ({
    getRun: vi.fn(),
    getActiveRunForAgent: vi.fn(),
  }),
  issueApprovalService: () => ({
    listApprovalsForIssue: vi.fn(),
    unlink: vi.fn(),
  }),
  issueRecoveryActionService: () => ({
    getActiveForIssue: vi.fn(async () => null),
    listActiveForIssues: vi.fn(async () => new Map()),
  }),
  issueThreadInteractionService: () => ({
    listForIssue: vi.fn(async () => []),
    expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
    expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
  }),
  documentService: () => ({}),
  documentAnnotationService: () => ({ remapOpenThreadsForDocument: async () => [] }),
  routineService: () => ({}),
  workProductService: () => ({}),
}));

vi.mock("../services/activity-log.js", async () => ({
  ...await vi.importActual<typeof import("../services/activity-log.js")>("../services/activity-log.js"),
  persistActivity: async (db: unknown, input: unknown) => {
    await mockLogActivity(db, input);
    return { activity: { id: "activity" }, publication: null };
  },
  publishActivity: vi.fn(),
}));

vi.mock("../services/environments.js", () => ({
  environmentService: () => mockEnvironmentService,
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

// The route factories create instance settings directly rather than through
// services/index. These tests use placeholder DB objects, so the setting read
// used by issue/project write side effects must remain fixture-backed.
vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({
    getExperimental: vi.fn(async () => ({
      enableExternalObjects: false,
      enableManagedSandboxOnly: false,
    })),
  }),
}));

vi.mock("../services/issue-assignment-wakeup.js", () => ({
  queueIssueAssignmentWakeup: vi.fn(),
}));

// Keep authorization explicit at this route-unit boundary; database-backed
// privacy qualification has separate PostgreSQL integration coverage.
vi.mock("../services/authorization.js", async () => ({
  ...await vi.importActual<typeof import("../services/authorization.js")>("../services/authorization.js"),
  canActorReadIssuePrivacy: mockCanReadIssuePrivacy,
  canActorReadProjectPrivacy: mockCanReadProjectPrivacy,
}));

vi.mock("../services/analytical-context-authority.js", async () => ({
  ...await vi.importActual<typeof import("../services/analytical-context-authority.js")>("../services/analytical-context-authority.js"),
  assertAnalyticalContextPayloadAccess: mockAnalyticalPayloadAccess,
}));

// Project creation's privacy-tree lock is covered by service integration
// tests. This suite isolates environment selection and uses a placeholder DB.
vi.mock("../services/issues.js", async () => ({
  ...await vi.importActual<typeof import("../services/issues.js")>("../services/issues.js"),
  lockIssuePrivacyTree: vi.fn(async () => undefined),
}));

function buildApp(routerFactory: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    };
    next();
  });
  routerFactory(app);
  app.use((err, req, res, next) => {
    lastRouteError = err;
    errorHandler(err, req, res, next);
  });
  return app;
}

let projectServer: Server | null = null;
let issueServer: Server | null = null;

function createProjectApp() {
  projectServer ??= buildApp((expressApp) => {
    expressApp.use("/api", projectRoutes({ transaction: async (effect: (tx: unknown) => unknown) => effect({}) } as any));
  }).listen(0);
  return projectServer;
}

function createIssueApp() {
  issueServer ??= buildApp((expressApp) => {
    expressApp.use("/api", issueRoutes({} as any, {} as any));
  }).listen(0);
  return issueServer;
}

const sandboxEnvironmentId = "11111111-1111-4111-8111-111111111111";

async function closeServer(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe.sequential("execution environment route guards", () => {
  afterAll(async () => {
    await closeServer(projectServer);
    await closeServer(issueServer);
    projectServer = null;
    issueServer = null;
  });

  beforeEach(() => {
    lastRouteError = null;
    mockProjectService.create.mockReset();
    mockProjectService.getById.mockReset();
    mockProjectService.update.mockReset();
    mockProjectService.createWorkspace.mockReset();
    mockProjectService.remove.mockReset();
    mockProjectService.resolveByReference.mockReset();
    mockProjectService.listWorkspaces.mockReset();
    mockIssueService.create.mockReset();
    mockIssueService.getById.mockReset();
    mockIssueService.update.mockReset();
    mockIssueService.getByIdentifier.mockReset();
    mockIssueService.assertCheckoutOwner.mockReset();
    mockCompanyService.getById.mockReset();
    mockCompanyService.getById.mockResolvedValue({
      id: "company-1",
    });
    mockEnvironmentService.getById.mockReset();
    mockIssueReferenceService.deleteDocumentSource.mockClear();
    mockIssueReferenceService.diffIssueReferenceSummary.mockClear();
    mockIssueReferenceService.emptySummary.mockClear();
    mockIssueReferenceService.listIssueReferenceSummary.mockClear();
    mockIssueReferenceService.syncComment.mockClear();
    mockIssueReferenceService.syncDocument.mockClear();
    mockIssueReferenceService.syncIssue.mockClear();
    mockSecretService.normalizeEnvBindingsForPersistence.mockClear();
    mockLogActivity.mockReset();
    mockAccessDecision.mockReset().mockResolvedValue({ allowed: true });
    mockCanReadIssuePrivacy.mockReset().mockResolvedValue(true);
    mockCanReadProjectPrivacy.mockReset().mockResolvedValue(true);
    mockAnalyticalPayloadAccess.mockReset().mockResolvedValue(undefined);
  });

  it("accepts sandbox environments on project create", async () => {
    mockEnvironmentService.getById.mockResolvedValue({
      id: sandboxEnvironmentId,
      companyId: "company-1",
      driver: "sandbox",
      config: { provider: "fake-plugin" },
    });
    mockProjectService.create.mockImplementation(async (_companyId, data) => ({
      id: "project-1",
      ...data,
    }));
    const app = createProjectApp();

    const res = await request(app)
      .post("/api/companies/company-1/projects")
      .send({
        name: "Sandboxed Project",
        executionWorkspacePolicy: {
          enabled: true,
          environmentId: sandboxEnvironmentId,
        },
      });

    expect(res.status).not.toBe(422);
    expect(mockProjectService.create, `route returned ${res.status}: ${routeErrorSummary()}`).toHaveBeenCalled();
  });

  it("accepts sandbox environments on project update", async () => {
    mockProjectService.getById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Sandboxed Project",
      status: "backlog",
      archivedAt: null,
    });
    mockEnvironmentService.getById.mockResolvedValue({
      id: sandboxEnvironmentId,
      companyId: "company-1",
      driver: "sandbox",
      config: { provider: "fake-plugin" },
    });
    mockProjectService.update.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Sandboxed Project",
      status: "backlog",
    });
    const app = createProjectApp();

    const res = await request(app)
      .patch("/api/projects/project-1")
      .send({
        executionWorkspacePolicy: {
          enabled: true,
          environmentId: sandboxEnvironmentId,
        },
      });

    expect(res.status).not.toBe(422);
    expect(mockProjectService.update, `route returned ${res.status}: ${routeErrorSummary()}`).toHaveBeenCalled();
  });

  it("does not mutate a project when its privacy check denies the actor", async () => {
    mockProjectService.getById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Sandboxed Project",
      status: "backlog",
      archivedAt: null,
    });
    mockCanReadProjectPrivacy.mockResolvedValue(false);

    const res = await request(createProjectApp())
      .patch("/api/projects/project-1")
      .send({ executionWorkspacePolicy: { environmentId: sandboxEnvironmentId } });

    expect(res.status).toBe(404);
    expect(mockProjectService.update).not.toHaveBeenCalled();
  });

  it("accepts sandbox environments on issue create", async () => {
    mockEnvironmentService.getById.mockResolvedValue({
      id: sandboxEnvironmentId,
      companyId: "company-1",
      driver: "sandbox",
      config: { provider: "fake-plugin" },
    });
    mockIssueService.create.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      title: "Sandboxed Issue",
      status: "todo",
      identifier: "PAPA-999",
    });
    const app = createIssueApp();

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Sandboxed Issue",
        executionWorkspaceSettings: {
          environmentId: sandboxEnvironmentId,
        },
      });

    expect(res.status).not.toBe(422);
    expect(mockIssueService.create).toHaveBeenCalled();
  });

  it("rejects unsupported driver environments on issue create", async () => {
    mockEnvironmentService.getById.mockResolvedValue({
      id: sandboxEnvironmentId,
      companyId: "company-1",
      driver: "unsupported_driver",
      config: {},
    });
    const app = createIssueApp();

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Unsupported Driver Issue",
        executionWorkspaceSettings: {
          environmentId: sandboxEnvironmentId,
        },
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Environment driver "unsupported_driver" is not allowed here');
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("rejects built-in fake sandbox environments on issue create", async () => {
    mockEnvironmentService.getById.mockResolvedValue({
      id: sandboxEnvironmentId,
      companyId: "company-1",
      driver: "sandbox",
      config: { provider: "fake" },
    });
    const app = createIssueApp();

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Fake Sandbox Issue",
        executionWorkspaceSettings: {
          environmentId: sandboxEnvironmentId,
        },
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Environment sandbox provider "fake" is not allowed here');
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("accepts plugin-backed sandbox environments on issue create", async () => {
    mockEnvironmentService.getById.mockResolvedValue({
      id: sandboxEnvironmentId,
      companyId: "company-1",
      driver: "sandbox",
      config: { provider: "fake-plugin" },
    });
    mockIssueService.create.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      title: "Plugin Sandbox Issue",
      status: "todo",
      identifier: "PAPA-999",
    });
    const app = createIssueApp();

    const res = await request(app)
      .post("/api/companies/company-1/issues")
      .send({
        title: "Plugin Sandbox Issue",
        executionWorkspaceSettings: {
          environmentId: sandboxEnvironmentId,
        },
      });

    expect(res.status).not.toBe(422);
    expect(mockIssueService.create).toHaveBeenCalled();
  });

  it("accepts sandbox environments on issue update", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByUserId: null,
      identifier: "PAPA-999",
    });
    mockEnvironmentService.getById.mockResolvedValue({
      id: sandboxEnvironmentId,
      companyId: "company-1",
      driver: "sandbox",
      config: { provider: "fake-plugin" },
    });
    mockIssueService.update.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      status: "todo",
      identifier: "PAPA-999",
    });
    const app = createIssueApp();

    const res = await request(app)
      .patch("/api/issues/issue-1")
      .send({
        executionWorkspaceSettings: {
          environmentId: sandboxEnvironmentId,
        },
      });

    expect(res.status).not.toBe(422);
    expect(mockIssueService.update, `route returned ${res.status}: ${routeErrorSummary()}`).toHaveBeenCalled();
  });

  it("does not mutate an issue when its privacy check denies the actor", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByUserId: null,
      identifier: "PAPA-999",
    });
    mockCanReadIssuePrivacy.mockResolvedValue(false);

    const res = await request(createIssueApp())
      .patch("/api/issues/issue-1")
      .send({ title: "Denied update" });

    expect(res.status).toBe(404);
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });
});
