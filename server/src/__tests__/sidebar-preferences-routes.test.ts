import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSidebarPreferenceService = vi.hoisted(() => ({
  getCompanyOrder: vi.fn(),
  upsertCompanyOrder: vi.fn(),
  getProjectOrder: vi.fn(),
  upsertProjectOrder: vi.fn(),
  getPreferredCoworker: vi.fn(),
  setPreferredCoworker: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    sidebarPreferenceService: () => mockSidebarPreferenceService,
    logActivity: mockLogActivity,
  }));
}

async function createApp(actor: Record<string, unknown>) {
  const [{ sidebarPreferenceRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/sidebar-preferences.js"),
    import("../middleware/error-handler.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as never;
    next();
  });
  app.use("/api", sidebarPreferenceRoutes({} as never));
  app.use(errorHandler);
  return app;
}

const ORDERED_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

describe("sidebar preference routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/sidebar-preferences.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockSidebarPreferenceService.getCompanyOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    mockSidebarPreferenceService.upsertCompanyOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    mockSidebarPreferenceService.getProjectOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    mockSidebarPreferenceService.upsertProjectOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    mockSidebarPreferenceService.getPreferredCoworker.mockResolvedValue({ agentId: null, updatedAt: null });
    mockSidebarPreferenceService.setPreferredCoworker.mockImplementation(async (_companyId, _userId, agentId) => ({ agentId, updatedAt: null }));
  });

  it("returns company rail order for board users", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app).get("/api/sidebar-preferences/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    expect(mockSidebarPreferenceService.getCompanyOrder).toHaveBeenCalledWith("user-1");
  });

  it("updates company rail order for board users", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: ["company-1"],
    });

    const res = await request(app)
      .put("/api/sidebar-preferences/me")
      .send({ orderedIds: ORDERED_IDS });

    expect(res.status).toBe(200);
    expect(mockSidebarPreferenceService.upsertCompanyOrder).toHaveBeenCalledWith("user-1", ORDERED_IDS);
  });

  it("returns project order for companies the board user can access", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app).get("/api/companies/company-1/sidebar-preferences/me");

    expect(res.status).toBe(200);
    expect(mockSidebarPreferenceService.getProjectOrder).toHaveBeenCalledWith("company-1", "user-1");
  });

  it("logs project order updates for company-scoped writes", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
      runId: "run-1",
    });

    const res = await request(app)
      .put("/api/companies/company-1/sidebar-preferences/me")
      .send({ orderedIds: ORDERED_IDS });

    expect(res.status).toBe(200);
    expect(mockSidebarPreferenceService.upsertProjectOrder).toHaveBeenCalledWith("company-1", "user-1", ORDERED_IDS);
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        companyId: "company-1",
        action: "sidebar_preferences.project_order_updated",
        details: expect.objectContaining({
          userId: "user-1",
          orderedIds: ORDERED_IDS,
        }),
      }),
    );
  });

  it("rejects company-scoped reads when the board user lacks company access", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-2"],
    });

    const res = await request(app).get("/api/companies/company-1/sidebar-preferences/me");

    expect(res.status).toBe(403);
    expect(mockSidebarPreferenceService.getProjectOrder).not.toHaveBeenCalled();
  });

  it("rejects agent callers", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
    });

    const res = await request(app).get("/api/sidebar-preferences/me");

    expect(res.status).toBe(403);
    expect(mockSidebarPreferenceService.getCompanyOrder).not.toHaveBeenCalled();
  });

  it("reads the signed-in user's preferred Co-worker within the selected company", async () => {
    const app = await createApp({
      type: "board", userId: "user-1", source: "session", isInstanceAdmin: false,
      companyIds: ["company-1"],
    });
    mockSidebarPreferenceService.getPreferredCoworker.mockResolvedValue({
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updatedAt: null,
    });
    const res = await request(app).get("/api/companies/company-1/sidebar-preferences/preferred-coworker/me");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body.agentId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(mockSidebarPreferenceService.getPreferredCoworker).toHaveBeenCalledWith("company-1", "user-1");
  });

  it("saves or clears the preferred Co-worker as a preference without changing grants", async () => {
    const app = await createApp({
      type: "board", userId: "user-1", source: "session", isInstanceAdmin: false,
      companyIds: ["company-1"],
    });
    const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const res = await request(app)
      .put("/api/companies/company-1/sidebar-preferences/preferred-coworker/me")
      .send({ agentId });
    expect(res.status).toBe(200);
    expect(mockSidebarPreferenceService.setPreferredCoworker).toHaveBeenCalledWith("company-1", "user-1", agentId);
    expect(mockLogActivity).toHaveBeenCalledWith({} as never, expect.objectContaining({
      companyId: "company-1",
      action: "sidebar_preferences.preferred_coworker_updated",
      details: { userId: "user-1", preferredAgentId: agentId },
    }));
    await request(app)
      .put("/api/companies/company-1/sidebar-preferences/preferred-coworker/me")
      .send({ agentId: null });
    expect(mockSidebarPreferenceService.setPreferredCoworker).toHaveBeenLastCalledWith("company-1", "user-1", null);
  });

  it("rejects malformed preferred Co-worker IDs", async () => {
    const app = await createApp({
      type: "board", userId: "user-1", source: "session", isInstanceAdmin: false,
      companyIds: ["company-1"],
    });
    const res = await request(app)
      .put("/api/companies/company-1/sidebar-preferences/preferred-coworker/me")
      .send({ agentId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(mockSidebarPreferenceService.setPreferredCoworker).not.toHaveBeenCalled();
  });
});
