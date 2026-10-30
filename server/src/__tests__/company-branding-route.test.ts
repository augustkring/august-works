import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockResponsibilityContactsService = vi.hoisted(() => ({
  listEligibleUsers: vi.fn(),
  assertEligible: vi.fn(),
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

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockFeedbackService = vi.hoisted(() => ({
  listIssueVotesForUser: vi.fn(),
  listFeedbackTraces: vi.fn(),
  getFeedbackTraceById: vi.fn(),
  saveIssueVote: vi.fn(),
}));
const mockAssertCompanyCeoAgentOrBoard = vi.hoisted(() => vi.fn());
let lastErrorContext: unknown;

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  companyArtifactsService: () => mockCompanyArtifactsService,
  companyPortabilityService: () => mockCompanyPortabilityService,
  companyService: () => mockCompanyService,
  feedbackService: () => mockFeedbackService,
  instanceSettingsService: () => ({
    getExperimental: vi.fn(),
  }),
  logActivity: mockLogActivity,
}));

vi.mock("../services/authorization.js", async () => {
  const actual = await vi.importActual<typeof import("../services/authorization.js")>("../services/authorization.js");
  return { ...actual, assertCompanyCeoAgentOrBoard: mockAssertCompanyCeoAgentOrBoard };
});

vi.mock("../services/company-responsibility-contacts.js", () => ({
  companyResponsibilityContactsService: () => mockResponsibilityContactsService,
}));

async function resetAuthorizationFixture() {
  const { forbidden } = await vi.importActual<typeof import("../errors.js")>("../errors.js");
  mockAssertCompanyCeoAgentOrBoard.mockImplementation(async (
    _db: unknown,
    companyId: string,
    actor: { type?: string; agentId?: string },
    capability: string,
  ) => {
    if (actor.type === "board") return;
    if (actor.type !== "agent" || !actor.agentId) throw forbidden("Agent authentication required");
    const agent = await mockAgentService.getById(actor.agentId);
    if (!agent || agent.companyId !== companyId) throw forbidden("Agent key cannot access another company");
    if (agent.role !== "ceo") throw forbidden(`Only CEO agents can manage ${capability}`);
  });
}

function createCompany() {
  const now = new Date("2026-03-19T02:00:00.000Z");
  return {
    id: "company-1",
    name: "Paperclip",
    description: null,
    status: "active",
    issuePrefix: "PAP",
    issueCounter: 568,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    logoAssetId: "11111111-1111-4111-8111-111111111111",
    logoUrl: "/api/assets/11111111-1111-4111-8111-111111111111/content",
    createdAt: now,
    updatedAt: now,
  };
}

async function createApp(actor: Record<string, unknown>, db: unknown = {}) {
  const [{ companyRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/companies.js")>("../routes/companies.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.on("finish", () => {
      lastErrorContext = (res as any).__errorContext ?? null;
    });
    (req as any).actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes(db as any));
  app.use(errorHandler);
  return app;
}

describe("Company settings authorization routes", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock("../routes/companies.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.clearAllMocks();
    lastErrorContext = undefined;
    await resetAuthorizationFixture();
    mockResponsibilityContactsService.listEligibleUsers.mockResolvedValue([
      { id: "human-1", name: "Board contact", email: "human@example.com" },
    ]);
    mockResponsibilityContactsService.assertEligible.mockResolvedValue(undefined);
  });

  it("rejects non-CEO agent callers", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "engineer",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({ logoAssetId: "11111111-1111-4111-8111-111111111111" });

    expect(res.status, JSON.stringify(lastErrorContext)).toBe(403);
    expect(res.body.error).toContain("Only CEO agents");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("rejects non-CEO agent callers before validating branding body shape", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "engineer",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({ status: "archived" });

    expect(res.status, JSON.stringify(lastErrorContext)).toBe(403);
    expect(res.body.error).toContain("Only CEO agents");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("allows CEO agent callers to update branding fields", async () => {
    const company = createCompany();
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "ceo",
    });
    mockCompanyService.update.mockResolvedValue(company);
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
      });

    expect(res.status).toBe(200);
    expect(res.body.logoAssetId).toBe(company.logoAssetId);
    expect(mockCompanyService.update).toHaveBeenCalledWith("company-1", {
      logoAssetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
        agentId: "agent-1",
        runId: "run-1",
        action: "company.branding_updated",
        details: {
          logoAssetId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    );
  });

  it("allows board callers to update branding fields", async () => {
    const company = createCompany();
    mockCompanyService.update.mockResolvedValue({
      ...company,
      logoAssetId: null,
      logoUrl: null,
    });
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({ description: null, logoAssetId: null });

    expect(res.status).toBe(200);
    expect(res.body.logoAssetId ?? null).toBeNull();
  });

  it("rejects the retired brandColor field in the request body", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
        brandColor: "#123456",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("rejects non-branding fields in the request body", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
        status: "archived",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  describe("responsibility contacts", () => {
  it.each(["ceo", "engineer"] as const)("denies %s Agents from reading responsibility contacts", async (role) => {
    mockAgentService.getById.mockResolvedValue({ id: "agent-1", companyId: "company-1", role });
    const app = await createApp({ type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_key", runId: "run-1" });

    const res = await request(app).get("/api/companies/company-1/responsibility-contacts");

    expect(res.status, JSON.stringify(lastErrorContext)).toBe(403);
    expect(res.body.error).toContain("current Human Board owner or administrator");
    expect(mockResponsibilityContactsService.listEligibleUsers).not.toHaveBeenCalled();
  });

  it.each(["ceo", "engineer"] as const)("denies %s Agents from assigning responsibility contacts", async (role) => {
    mockAgentService.getById.mockResolvedValue({ id: "agent-1", companyId: "company-1", role });
    const app = await createApp({ type: "agent", agentId: "agent-1", companyId: "company-1", source: "agent_key", runId: "run-1" });

    const res = await request(app).patch("/api/companies/company-1/responsibility-contacts").send({
      securityContactUserId: "human-1", supportIncidentContactUserId: null,
    });

    expect(res.status, JSON.stringify(lastErrorContext)).toBe(403);
    expect(res.body.error).toContain("current Human Board owner or administrator");
    expect(mockResponsibilityContactsService.assertEligible).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("allows current Board %s to read the contact roster with its chooser email", async (membershipRole) => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{
      securityContactUserId: "human-1", supportIncidentContactUserId: null,
    }] }) }) }) };
    const app = await createApp({ type: "board", userId: "board-1", source: "session", companyIds: ["company-1"],
      sessionId: "session-1", memberships: [{ companyId: "company-1", membershipRole, status: "active" }] }, db);

    const res = await request(app).get("/api/companies/company-1/responsibility-contacts")
      .set("X-Blentera-Expected-User", "board-1")
      .set("X-Blentera-Expected-Session", "session-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ securityContactUserId: "human-1", supportIncidentContactUserId: null,
      eligibleUsers: [{ id: "human-1", name: "Board contact", email: "human@example.com" }] });
    expect(mockResponsibilityContactsService.listEligibleUsers).toHaveBeenCalledWith("company-1");
  });

  it("preserves the existing local trusted Board mode", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{
      securityContactUserId: null, supportIncidentContactUserId: null,
    }] }) }) }) };
    const app = await createApp({ type: "board", source: "local_implicit" }, db);

    const res = await request(app).get("/api/companies/company-1/responsibility-contacts")
      .set("X-Blentera-Expected-User", "local-board");

    expect(res.status).toBe(200);
    expect(mockResponsibilityContactsService.listEligibleUsers).toHaveBeenCalledWith("company-1");
  });

  it.each([
    ["X-Blentera-Expected-User", "other-user", "ACCOUNT_CHANGED"],
    ["X-Blentera-Expected-Session", "old-session", "AUTHENTICATION_STATE_CHANGED"],
  ])("rejects stale %s on both contact endpoints", async (header, value, code) => {
    const actor = { type: "board", userId: "board-1", sessionId: "current-session", source: "session",
      companyIds: ["company-1"], memberships: [{ companyId: "company-1", membershipRole: "owner", status: "active" }] };
    const app = await createApp(actor, {});

    const get = await request(app).get("/api/companies/company-1/responsibility-contacts").set(header, value);
    const patch = await request(app).patch("/api/companies/company-1/responsibility-contacts").set(header, value)
      .send({ securityContactUserId: null, supportIncidentContactUserId: null });

    expect(get.status).toBe(409);
    expect(get.body.details.code).toBe(code);
    expect(patch.status).toBe(409);
    expect(patch.body.details.code).toBe(code);
    expect(mockResponsibilityContactsService.listEligibleUsers).not.toHaveBeenCalled();
    expect(mockResponsibilityContactsService.assertEligible).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("allows current Board %s to set responsibility contacts", async (membershipRole) => {
    const db = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "company-1" }] }) }) }) };
    const app = await createApp({ type: "board", userId: "board-1", source: "session", companyIds: ["company-1"],
      sessionId: "session-1", memberships: [{ companyId: "company-1", membershipRole, status: "active" }] }, db);

    const res = await request(app).patch("/api/companies/company-1/responsibility-contacts")
      .set("X-Blentera-Expected-User", "board-1")
      .set("X-Blentera-Expected-Session", "session-1")
      .send({ securityContactUserId: "human-1", supportIncidentContactUserId: null });

    expect(res.status).toBe(200);
    expect(mockResponsibilityContactsService.assertEligible).toHaveBeenCalledWith("company-1", ["human-1"]);
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "company.responsibility_contacts_updated",
      details: { securityContactSet: true, supportIncidentContactSet: false },
    }));
  });

  it.each(["operator", "viewer"] as const)("denies Board %s from reading or changing the contact roster", async (membershipRole) => {
    const actor = { type: "board", userId: "board-1", source: "session", companyIds: ["company-1"],
      memberships: [{ companyId: "company-1", membershipRole, status: "active" }] };
    const app = await createApp(actor, {});

    const get = await request(app).get("/api/companies/company-1/responsibility-contacts");
    const patch = await request(app).patch("/api/companies/company-1/responsibility-contacts").send({
      securityContactUserId: null, supportIncidentContactUserId: null,
    });

    expect(get.status).toBe(403);
    expect(patch.status).toBe(403);
    expect(mockResponsibilityContactsService.listEligibleUsers).not.toHaveBeenCalled();
    expect(mockResponsibilityContactsService.assertEligible).not.toHaveBeenCalled();
  });

  it("denies a Board API key even if it carries owner membership metadata", async () => {
    const app = await createApp({ type: "board", userId: "board-1", source: "board_key", companyIds: ["company-1"],
      memberships: [{ companyId: "company-1", membershipRole: "owner", status: "active" }] }, {});

    const res = await request(app).get("/api/companies/company-1/responsibility-contacts");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("current Human Board owner or administrator");
    expect(mockResponsibilityContactsService.listEligibleUsers).not.toHaveBeenCalled();
  });
  });
});

describe("PATCH /api/companies/:companyId", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock("../routes/companies.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.clearAllMocks();
    lastErrorContext = undefined;
    await resetAuthorizationFixture();
  });

  it("rejects non-CEO agent callers before loading the company or validating settings body shape", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "engineer",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({ status: "archived" });

    expect(res.status, JSON.stringify(lastErrorContext)).toBe(403);
    expect(res.body.error).toContain("Only CEO agents");
    expect(mockCompanyService.getById).not.toHaveBeenCalled();
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("allows CEO agent callers to update only branding fields through the general settings route", async () => {
    const company = createCompany();
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "ceo",
    });
    mockCompanyService.getById.mockResolvedValue(company);
    mockCompanyService.update.mockResolvedValue({
      ...company,
      name: "New Name",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(mockCompanyService.update).toHaveBeenCalledWith("company-1", { name: "New Name" }, expect.objectContaining({
      actorType: "agent",
      actorId: "agent-1",
    }));
  });

  it("rejects CEO agent attempts to update lifecycle, budget, consent, or prefix fields", async () => {
    const company = createCompany();
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "ceo",
    });
    mockCompanyService.getById.mockResolvedValue(company);
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({
        status: "archived",
        budgetMonthlyCents: 1000,
        spentMonthlyCents: 500,
        requireBoardApprovalForNewAgents: true,
        feedbackDataSharingEnabled: true,
        issuePrefix: "BAD",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("keeps full company settings updates board-only", async () => {
    const company = createCompany();
    mockCompanyService.getById.mockResolvedValue(company);
    mockCompanyService.update.mockResolvedValue({
      ...company,
      status: "paused",
    });
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({ status: "paused" });

    expect(res.status).toBe(200);
    expect(mockCompanyService.update).toHaveBeenCalledWith("company-1", { status: "paused" }, expect.objectContaining({
      actorType: "user",
      actorId: "user-1",
    }));
  });
});
