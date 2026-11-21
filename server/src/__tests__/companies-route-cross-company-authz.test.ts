import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyAId = "11111111-1111-4111-8111-111111111111";
const companyBId = "22222222-2222-4222-8222-222222222222";
const ceoAgentId = "ceo-agent-a";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
  ensureRoleDefaultGrants: vi.fn(),
  getMembership: vi.fn(),
}));

const mockAssertHumanAuthentication = vi.hoisted(() => vi.fn());

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockCompanyArtifactsService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockFeedbackService = vi.hoisted(() => ({
  listFeedbackTraces: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerCompanyRouteMocks() {
  vi.doMock("../auth/authenticator-assurance.js", () => ({
    assertHumanAuthentication: mockAssertHumanAuthentication,
  }));
  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    budgetService: () => mockBudgetService,
    companyArtifactsService: () => mockCompanyArtifactsService,
    companyPortabilityService: () => mockCompanyPortabilityService,
    companyService: () => mockCompanyService,
    feedbackService: () => mockFeedbackService,
    logActivity: mockLogActivity,
  }));
}

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>) {
  registerCompanyRouteMocks();
  appImportCounter += 1;
  const routeModulePath = `../routes/companies.js?cross-company-authz-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?cross-company-authz-${appImportCounter}`;
  const [{ companyRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/companies.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => actor.type === "agent"
            ? [{ companyId: actor.companyId, role: "ceo" }]
            : [],
        }),
      }),
    }),
  };
  app.use("/api/companies", companyRoutes(db as any));
  app.use(errorHandler);
  return app;
}

function createCompany(id: string) {
  const now = new Date("2026-06-18T00:00:00.000Z");
  return {
    id,
    name: id === companyAId ? "Company A" : "Company B",
    description: null,
    locale: "en",
    timezone: "UTC",
    status: "active",
    issuePrefix: id === companyAId ? "CPA" : "CPB",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    logoAssetId: null,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

const exportRequest = {
  include: { company: true, agents: true, projects: true },
};

function exportResult() {
  return {
    rootPath: "paperclip",
    manifest: {
      agents: [],
      skills: [],
      projects: [],
      issues: [],
      envInputs: [],
      includes: { company: true, agents: true, projects: true, issues: false, skills: false },
      company: null,
      schemaVersion: 1,
      generatedAt: "2026-06-18T00:00:00.000Z",
      source: null,
    },
    files: {},
    warnings: [],
  };
}

function exportPreviewResult() {
  return {
    ...exportResult(),
    fileInventory: [],
    counts: { files: 0, agents: 0, skills: 0, projects: 0, issues: 0 },
    paperclipExtensionPath: ".paperclip.yaml",
  };
}

function importRequest(targetCompanyId = companyBId) {
  return {
    source: { type: "inline", files: { "COMPANY.md": "---\nname: Imported\n---\n" } },
    include: { company: true, agents: true, projects: false, issues: false },
    target: { mode: "existing_company", companyId: targetCompanyId },
    collisionStrategy: "rename",
  };
}

function importResult(companyId = companyBId) {
  return {
    company: { id: companyId, action: "updated" },
    agents: [],
    warnings: [],
  };
}

function resetMockDefaults() {
  mockCompanyService.getById.mockImplementation(async (id: string) => {
    if (id === companyAId || id === companyBId) return createCompany(id);
    return null;
  });
  mockCompanyService.update.mockImplementation(async (id: string, body: Record<string, unknown>) => ({
    ...createCompany(id),
    ...body,
  }));
  mockCompanyService.archive.mockImplementation(async (id: string) => ({
    ...createCompany(id),
    status: "archived",
  }));
  mockCompanyService.remove.mockImplementation(async (id: string) => createCompany(id));
  // Fresh membership read used by the company deletion guard.
  mockAccessService.getMembership.mockImplementation(async (companyId: string, _type: string, userId: string) => {
    const role = ({ owner: "owner", member: "member", viewer: "viewer", admin: "admin" } as Record<string, string>)[userId];
    return role && companyId === companyBId ? { companyId, principalId: userId, membershipRole: role, status: "active" } : null;
  });
  mockAssertHumanAuthentication.mockResolvedValue({ method: "password" });
  mockAgentService.getById.mockImplementation(async (id: string) => {
    if (id === ceoAgentId) return { id, companyId: companyAId, role: "ceo" };
    return null;
  });
  mockAgentService.list.mockResolvedValue([]);
  mockCompanyPortabilityService.exportBundle.mockResolvedValue(exportResult());
  mockCompanyPortabilityService.previewExport.mockResolvedValue(exportPreviewResult());
  mockCompanyPortabilityService.previewImport.mockResolvedValue({ ok: true });
  mockCompanyPortabilityService.importBundle.mockResolvedValue(importResult());
}

function assertNoTargetMutationSideEffects() {
  expect(mockCompanyService.update).not.toHaveBeenCalled();
  expect(mockCompanyService.archive).not.toHaveBeenCalled();
  expect(mockCompanyService.remove).not.toHaveBeenCalled();
  expect(mockCompanyPortabilityService.exportBundle).not.toHaveBeenCalled();
  expect(mockCompanyPortabilityService.previewExport).not.toHaveBeenCalled();
  expect(mockCompanyPortabilityService.previewImport).not.toHaveBeenCalled();
  expect(mockCompanyPortabilityService.importBundle).not.toHaveBeenCalled();
  expect(mockLogActivity).not.toHaveBeenCalled();
}

function companyACeoActor() {
  return {
    type: "agent",
    agentId: ceoAgentId,
    companyId: companyAId,
    source: "agent_key",
    runId: "run-1",
  };
}

function boardActor(input: {
  userId: string;
  companyIds?: string[];
  memberships?: Array<{ companyId: string; membershipRole: string; status: string }>;
  isInstanceAdmin?: boolean;
  source?: string;
}) {
  return {
    type: "board",
    userId: input.userId,
    source: input.source ?? "session",
    companyIds: input.companyIds ?? [],
    memberships: input.memberships ?? [],
    isInstanceAdmin: input.isInstanceAdmin ?? false,
  };
}

describe.sequential("company route cross-company authorization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.clearAllMocks();
    resetMockDefaults();
  });

  it.each([false, true])("SaaS limits the product directory and stats to memberships (admin=%s)", async (isInstanceAdmin) => {
    vi.stubEnv("AW_DEPLOYMENT_PROFILE", "saas");
    vi.stubEnv("PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN", undefined);
    vi.stubEnv("PAPERCLIP_MANAGED_CONFIG", undefined);
    try {
      mockCompanyService.list.mockResolvedValue([createCompany(companyBId), createCompany(companyAId)]);
      mockCompanyService.stats.mockResolvedValue({ [companyAId]: { agents: 1 }, [companyBId]: { agents: 99 } });
      const app = await createApp(boardActor({ userId: "owner-a", isInstanceAdmin, companyIds: [companyAId] }));
      const directory = await request(app).get("/api/companies").expect(200);
      expect(directory.body.map((company: { id: string }) => company.id)).toEqual([companyAId]);
      const stats = await request(app).get("/api/companies/stats").expect(200);
      expect(stats.body).toEqual({ [companyAId]: { agents: 1 } });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["session", "board_key", "cloud_tenant"])(
    "limits navigable companies to memberships for a %s instance admin",
    async (source) => {
      mockCompanyService.list.mockResolvedValue([createCompany(companyBId), createCompany(companyAId)]);
      const app = await createApp(boardActor({
        userId: "owner-a",
        source,
        isInstanceAdmin: true,
        companyIds: [companyAId],
      }));

      const navigation = await request(app).get("/api/companies?scope=accessible").expect(200);
      expect(navigation.body.map((company: { id: string }) => company.id)).toEqual([companyAId]);
      await request(app).get(`/api/companies/${companyAId}`).expect(200);
      await request(app).get(`/api/companies/${companyBId}`).expect(403);

      // The existing directory remains available for instance administration.
      const directory = await request(app).get("/api/companies").expect(200);
      expect(directory.body.map((company: { id: string }) => company.id)).toEqual([companyBId, companyAId]);
    },
  );

  it.each([false, true])("returns no navigable companies without memberships (admin=%s)", async (isInstanceAdmin) => {
    mockCompanyService.list.mockResolvedValue([createCompany(companyAId)]);
    const app = await createApp(boardActor({ userId: "outsider", isInstanceAdmin }));
    const res = await request(app).get("/api/companies?scope=accessible").expect(200);
    expect(res.body).toEqual([]);
  });

  it.each(["scope=accessible&scope=accessible", "scope=accessible&scope=all", "scope=all", "scope="])(
    "rejects malformed list scope without loading the directory: %s",
    async (query) => {
      const app = await createApp(boardActor({ userId: "admin", isInstanceAdmin: true }));
      await request(app).get(`/api/companies?${query}`).expect(400);
      expect(mockCompanyService.list).not.toHaveBeenCalled();
    },
  );

  it("includes additional companies where a cloud user has membership", async () => {
    mockCompanyService.list.mockResolvedValue([createCompany(companyAId), createCompany(companyBId)]);
    const app = await createApp(boardActor({
      userId: "owner-of-both",
      source: "cloud_tenant",
      companyIds: [companyAId, companyBId],
    }));
    const res = await request(app).get("/api/companies?scope=accessible").expect(200);
    expect(res.body.map((company: { id: string }) => company.id)).toEqual([companyAId, companyBId]);
    await request(app).get(`/api/companies/${companyBId}`).expect(200);
  });

  it("keeps all companies navigable for the local trusted board", async () => {
    mockCompanyService.list.mockResolvedValue([createCompany(companyAId), createCompany(companyBId)]);
    const app = await createApp(boardActor({ userId: "local-board", source: "local_implicit" }));
    const res = await request(app).get("/api/companies?scope=accessible").expect(200);
    expect(res.body.map((company: { id: string }) => company.id)).toEqual([companyAId, companyBId]);
  });

  it("allows an authorized company member to update locale and timezone defaults only in that tenant", async () => {
    const app = await createApp(boardActor({
      userId: "settings-admin",
      companyIds: [companyBId],
      memberships: [{ companyId: companyBId, membershipRole: "admin", status: "active" }],
    }));

    await request(app).patch(`/api/companies/${companyBId}`)
      .send({ locale: "da", timezone: "Europe/Copenhagen" }).expect(200);

    expect(mockCompanyService.update).toHaveBeenCalledWith(
      companyBId,
      { locale: "da", timezone: "Europe/Copenhagen" },
      expect.anything(),
    );
  });

  it("rejects unauthenticated company-default changes and invalid timezones before persistence", async () => {
    const unauthenticated = await createApp({ type: "none", source: "none" });
    await request(unauthenticated).patch(`/api/companies/${companyAId}`)
      .send({ locale: "da", timezone: "Europe/Copenhagen" }).expect(401);
    expect(mockCompanyService.update).not.toHaveBeenCalled();

    const member = await createApp(boardActor({
      userId: "settings-admin",
      companyIds: [companyAId],
      memberships: [{ companyId: companyAId, membershipRole: "admin", status: "active" }],
    }));
    await request(member).patch(`/api/companies/${companyAId}`)
      .send({ timezone: "Mars/Olympus" }).expect(400);
    expect(mockCompanyService.update).not.toHaveBeenCalled();

    vi.clearAllMocks();
    resetMockDefaults();
    const foreignTenantAdmin = await createApp(boardActor({
      userId: "settings-admin-a",
      companyIds: [companyAId],
      memberships: [{ companyId: companyAId, membershipRole: "admin", status: "active" }],
    }));
    await request(foreignTenantAdmin).patch(`/api/companies/${companyBId}`)
      .send({ locale: "da" }).expect(403);
    expect(mockCompanyService.update).not.toHaveBeenCalled();

    vi.clearAllMocks();
    resetMockDefaults();
    const operator = await createApp(boardActor({
      userId: "settings-operator",
      companyIds: [companyAId],
      memberships: [{ companyId: companyAId, membershipRole: "operator", status: "active" }],
    }));
    const denied = await request(operator).patch(`/api/companies/${companyAId}`)
      .send({ locale: "da" }).expect(403);
    expect(denied.body.error).toContain("owner or administrator");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it.each([{ type: "none", source: "none" }, companyACeoActor()])(
    "rejects navigation list requests from a $type actor",
    async (actor) => {
      const app = await createApp(actor);
      await request(app).get("/api/companies?scope=accessible").expect(403);
      expect(mockCompanyService.list).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "GET /api/companies/:companyId",
      request: (app: express.Express) => request(app).get(`/api/companies/${companyBId}`),
    },
    {
      label: "PATCH /api/companies/:companyId",
      request: (app: express.Express) => request(app).patch(`/api/companies/${companyBId}`).send({ description: "Nope" }),
    },
    {
      label: "PATCH /api/companies/:companyId/branding",
      request: (app: express.Express) => request(app).patch(`/api/companies/${companyBId}/branding`).send({ description: "Nope" }),
    },
    {
      label: "POST /api/companies/:companyId/archive",
      request: (app: express.Express) => request(app).post(`/api/companies/${companyBId}/archive`).send({}),
    },
    {
      label: "DELETE /api/companies/:companyId",
      request: (app: express.Express) => request(app).delete(`/api/companies/${companyBId}`),
    },
    {
      label: "POST /api/companies/:companyId/export",
      request: (app: express.Express) => request(app).post(`/api/companies/${companyBId}/export`).send(exportRequest),
    },
    {
      label: "POST /api/companies/:companyId/exports/preview",
      request: (app: express.Express) => request(app).post(`/api/companies/${companyBId}/exports/preview`).send(exportRequest),
    },
    {
      label: "GET /api/companies/:companyId/export/fidelity",
      request: (app: express.Express) => request(app).get(`/api/companies/${companyBId}/export/fidelity`),
    },
    {
      label: "POST /api/companies/:companyId/imports/preview",
      request: (app: express.Express) => request(app).post(`/api/companies/${companyBId}/imports/preview`).send(importRequest()),
    },
    {
      label: "POST /api/companies/:companyId/imports/apply",
      request: (app: express.Express) => request(app).post(`/api/companies/${companyBId}/imports/apply`).send(importRequest()),
    },
  ])("rejects a company A CEO attempting company B operation: $label", async ({ request: buildRequest }) => {
    const app = await createApp(companyACeoActor());

    const res = await buildRequest(app);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/another company|access to this company|active company access/i);
    assertNoTargetMutationSideEffects();
  });

  it("allows a same-company CEO to use CEO-safe company routes without allowing board-only lifecycle routes", async () => {
    const app = await createApp(companyACeoActor());

    await request(app).get(`/api/companies/${companyAId}`).expect(200);
    const branding = await request(app).patch(`/api/companies/${companyAId}`).send({ description: "Branding" });
    expect(branding.status, JSON.stringify(branding.body)).toBe(200);
    await request(app).patch(`/api/companies/${companyAId}/branding`).send({ description: "Branding" }).expect(200);
    await request(app).post(`/api/companies/${companyAId}/export`).send(exportRequest).expect(200);
    await request(app).post(`/api/companies/${companyAId}/exports/preview`).send(exportRequest).expect(200);
    await request(app).post(`/api/companies/${companyAId}/imports/preview`).send(importRequest(companyAId)).expect(200);
    await request(app).post(`/api/companies/${companyAId}/imports/apply`).send(importRequest(companyAId)).expect(200);

    const archive = await request(app).post(`/api/companies/${companyAId}/archive`).send({});
    expect(archive.status).toBe(403);
    expect(archive.body.error).toContain("Board access required");
    const remove = await request(app).delete(`/api/companies/${companyAId}`);
    expect(remove.status).toBe(403);
    expect(remove.body.error).toContain("Board access required");
  });

  it("covers board actor access for non-member, viewer, active member, local trusted board, and instance admin without target membership", async () => {
    const nonMemberApp = await createApp(boardActor({ userId: "outsider" }));
    const nonMember = await request(nonMemberApp).get(`/api/companies/${companyBId}`);
    expect(nonMember.status).toBe(403);
    expect(nonMember.body.error).toContain("access to this company");

    vi.clearAllMocks();
    resetMockDefaults();
    const viewerApp = await createApp(boardActor({
      userId: "viewer",
      companyIds: [companyBId],
      memberships: [{ companyId: companyBId, membershipRole: "viewer", status: "active" }],
    }));
    await request(viewerApp).get(`/api/companies/${companyBId}`).expect(200);
    const viewerWrite = await request(viewerApp).patch(`/api/companies/${companyBId}`).send({ description: "Nope" });
    expect(viewerWrite.status).toBe(403);
    expect(viewerWrite.body.error).toContain("Viewer access is read-only");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();

    vi.clearAllMocks();
    resetMockDefaults();
    const memberApp = await createApp(boardActor({
      userId: "member",
      companyIds: [companyBId],
      memberships: [{ companyId: companyBId, membershipRole: "member", status: "active" }],
    }));
    await request(memberApp).patch(`/api/companies/${companyBId}`).send({ description: "Updated" }).expect(200);
    await request(memberApp).patch(`/api/companies/${companyBId}/branding`).send({ description: "Branding" }).expect(200);
    await request(memberApp).post(`/api/companies/${companyBId}/archive`).send({}).expect(200);
    const memberDelete = await request(memberApp).delete(`/api/companies/${companyBId}`).send({ confirmName: "Company B" });
    expect(memberDelete.status).toBe(403);
    expect(memberDelete.body.error).toContain("Only a company owner");
    expect(mockCompanyService.remove).not.toHaveBeenCalled();
    await request(memberApp).post(`/api/companies/${companyBId}/export`).send(exportRequest).expect(200);
    await request(memberApp).post(`/api/companies/${companyBId}/exports/preview`).send(exportRequest).expect(200);
    await request(memberApp).post(`/api/companies/${companyBId}/imports/preview`).send(importRequest()).expect(200);
    await request(memberApp).post(`/api/companies/${companyBId}/imports/apply`).send(importRequest()).expect(200);

    vi.clearAllMocks();
    resetMockDefaults();
    const localTrustedApp = await createApp(boardActor({
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    }));
    await request(localTrustedApp).get(`/api/companies/${companyBId}`).expect(200);
    await request(localTrustedApp).patch(`/api/companies/${companyBId}`).send({ description: "Local" }).expect(200);

    vi.clearAllMocks();
    resetMockDefaults();
    const adminWithoutMembershipApp = await createApp(boardActor({
      userId: "instance-admin",
      isInstanceAdmin: true,
    }));
    const adminRead = await request(adminWithoutMembershipApp).get(`/api/companies/${companyBId}`);
    expect(adminRead.status).toBe(403);
    expect(adminRead.body.error).toContain("access to this company");
    const adminWrite = await request(adminWithoutMembershipApp).patch(`/api/companies/${companyBId}`).send({ description: "Admin" });
    expect(adminWrite.status).toBe(403);
    expect(adminWrite.body.error).toContain("access to this company");
    assertNoTargetMutationSideEffects();
  });
  describe("company deletion authority and confirmation (EXIT-AUTH1)", () => {
    const owner = () => boardActor({
      userId: "owner",
      companyIds: [companyBId],
      memberships: [{ companyId: companyBId, membershipRole: "owner", status: "active" }],
    });

    it.each([
      ["member", "member"],
      ["admin", "admin"],
    ])("refuses an active %s who is not an owner", async (userId, membershipRole) => {
      const app = await createApp(boardActor({
        userId, companyIds: [companyBId], memberships: [{ companyId: companyBId, membershipRole, status: "active" }],
      }));
      const res = await request(app).delete(`/api/companies/${companyBId}`).send({ confirmName: "Company B" });
      expect(res.status).toBe(403);
      expect(res.body.details?.code).toBe("COMPANY_OWNER_REQUIRED");
      expect(mockCompanyService.remove).not.toHaveBeenCalled();
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("refuses an owner whose membership is no longer active in the database", async () => {
      mockAccessService.getMembership.mockResolvedValue({ membershipRole: "owner", status: "suspended" });
      const res = await request(await createApp(owner())).delete(`/api/companies/${companyBId}`).send({ confirmName: "Company B" });
      expect(res.status).toBe(403);
      expect(mockCompanyService.remove).not.toHaveBeenCalled();
    });

    it.each([
      ["a wrong name", { confirmName: "Company A" }],
      ["a differently cased name", { confirmName: "company b" }],
      ["no name", {}],
    ])("rejects an owner with %s (422) and deletes nothing", async (_label, body) => {
      const res = await request(await createApp(owner())).delete(`/api/companies/${companyBId}`).send(body);
      expect(res.status).toBe(422);
      expect(res.body.details?.code).toBe("COMPANY_DELETE_CONFIRMATION_MISMATCH");
      expect(mockCompanyService.remove).not.toHaveBeenCalled();
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("requires a recent sign-in from the owner before anything is deleted", async () => {
      mockAssertHumanAuthentication.mockRejectedValue(Object.assign(new Error("Authenticate again to continue"), {
        status: 403, details: { code: "recent_authentication_required" },
      }));
      const res = await request(await createApp(owner())).delete(`/api/companies/${companyBId}`).send({ confirmName: "Company B" });
      expect(res.status).not.toBe(200);
      expect(mockCompanyService.remove).not.toHaveBeenCalled();
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("deletes for the sole owner with the exact name, recording activity before the purge", async () => {
      const order: string[] = [];
      mockLogActivity.mockImplementation(async () => { order.push("activity"); });
      mockCompanyService.remove.mockImplementation(async (id: string) => { order.push("remove"); return createCompany(id); });
      const res = await request(await createApp(owner())).delete(`/api/companies/${companyBId}`).send({ confirmName: "Company B" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(mockAssertHumanAuthentication).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "owner" }),
        { requireRecent: true, phishingResistant: false });
      expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        companyId: companyBId, action: "company.deletion_requested", entityType: "company", entityId: companyBId,
      }));
      expect(order).toEqual(["activity", "remove"]);
    });

    it("lets the local trusted operator delete with the exact name, without a session step-up", async () => {
      const app = await createApp(boardActor({ userId: "local-board", source: "local_implicit", isInstanceAdmin: true }));
      await request(app).delete(`/api/companies/${companyBId}`).send({ confirmName: "Wrong" }).expect(422);
      await request(app).delete(`/api/companies/${companyBId}`).send({ confirmName: "Company B" }).expect(200);
      expect(mockAssertHumanAuthentication).not.toHaveBeenCalled();
    });
  });
});
