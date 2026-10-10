import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { agentAuthoringContentSchema } from "@paperclipai/shared";
import { agentAuthoringRoutes } from "../routes/agent-authoring.js";
import { errorHandler } from "../middleware/error-handler.js";

const service = vi.hoisted(() => ({
  admission: vi.fn(),
  hireCapability: vi.fn(),
  hireCatalog: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  options: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  discard: vi.fn(),
  review: vi.fn(),
}));
vi.mock("../services/agents/authoring-drafts.js", () => ({
  agentAuthoringService: () => service,
}));
const companyId = "10000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000002",
  requestId = "10000000-0000-4000-8000-000000000003";
function app() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      source: "session",
      userId: "author",
      companyIds: [companyId],
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentAuthoringRoutes({} as Db));
  app.use(errorHandler);
  return app;
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe("native authoring HTTP boundary", () => {
  it("checks current draft admission without creating a proposal or reading authoring options", async () => {
    service.admission.mockResolvedValue({
      companyId,
      agentId: id,
      canCreateDraft: true,
    });
    const url = `/api/companies/${companyId}/agent-configuration-drafts/admission?agentId=${id}`;
    await request(app()).get(`${url}&expectedUserId=other`).expect(409);
    expect(service.admission).not.toHaveBeenCalled();
    await request(app())
      .get(`${url}&expectedUserId=author`)
      .expect(200)
      .expect("Cache-Control", "private, no-store");
    expect(service.admission).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "author" }),
      companyId,
      id,
    );
    expect(service.create).not.toHaveBeenCalled();
    expect(service.options).not.toHaveBeenCalled();
  });
  it("binds saved Hire capability reads to the current private principal and admits only an explicit version reference on create", async () => {
    const path = `/api/companies/${companyId}/agent-configuration-drafts`;
    service.hireCapability.mockResolvedValue({ available: false });
    await request(app())
      .get(`${path}/${id}/hire-capability?expectedUserId=other`)
      .expect(409);
    expect(service.hireCapability).not.toHaveBeenCalled();
    const response = await request(app())
      .get(`${path}/${id}/hire-capability?expectedUserId=author`)
      .expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(service.hireCapability).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "author" }),
      companyId,
      id,
    );
    service.create.mockResolvedValue({ id });
    await request(app())
      .post(`${path}?expectedUserId=author`)
      .send({ requestId, agentId: null, packageVersionId: id })
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "author" }),
      companyId,
      { requestId, agentId: null, packageVersionId: id },
    );
    service.create.mockClear();
    await request(app())
      .post(`${path}?expectedUserId=author`)
      .send({
        requestId,
        packageVersionId: id,
        packageContentHash: "a".repeat(64),
        approved: true,
      })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("binds the customer capability catalog to the current company and account with private no-store responses", async () => {
    service.hireCatalog.mockResolvedValue([]);
    const path = `/api/companies/${companyId}/agent-configuration-drafts/hire-catalog`;
    await request(app()).get(`${path}?expectedUserId=other`).expect(409);
    expect(service.hireCatalog).not.toHaveBeenCalled();
    const response = await request(app())
      .get(`${path}?expectedUserId=author`)
      .expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(service.hireCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "author" }),
      companyId,
    );
  });
  it("prevents a stale principal or foreign company from reaching the draft owner", async () => {
    await request(app())
      .get(
        `/api/companies/${companyId}/agent-configuration-drafts/${id}?expectedUserId=other`,
      )
      .expect(409);
    await request(app())
      .get(
        `/api/companies/${id}/agent-configuration-drafts/${id}?expectedUserId=author`,
      )
      .expect(403);
    expect(service.get).not.toHaveBeenCalled();
  });
  it("uses private no-store receipts and forwards current native identity and cursor", async () => {
    service.list.mockResolvedValue({ items: [], nextCursor: null });
    const response = await request(app())
      .get(
        `/api/companies/${companyId}/agent-configuration-drafts?expectedUserId=author&before=${id}`,
      )
      .expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "author" }),
      companyId,
      id,
    );
  });
  it("rejects untyped creation or save authority and publication fields before persistence", async () => {
    await request(app())
      .post(`/api/companies/${companyId}/agent-configuration-drafts`)
      .send({ requestId, agentId: null, permissions: { admin: true } })
      .expect(400);
    await request(app())
      .post(`/api/companies/${companyId}/agent-configuration-drafts/${id}/save`)
      .send({
        requestId,
        expectedVersion: 1,
        step: "publish",
        content: agentAuthoringContentSchema.parse({}),
        publish: true,
      })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });
  it("keeps publish closed on native readiness and never treats a draft save as activation", async () => {
    service.review.mockResolvedValue({
      draftId: id,
      version: 2,
      productionChanged: false,
      baselineCurrent: true,
      blockers: [
        {
          code: "representative_test_unqualified",
          message: "No qualified test",
          step: "test",
        },
      ],
      test: { status: "unqualified", message: "No result" },
      publishAllowed: false,
    });
    const response = await request(app())
      .post(
        `/api/companies/${companyId}/agent-configuration-drafts/${id}/publish?expectedUserId=author`,
      )
      .send({ approve: true })
      .expect(422);
    expect(response.body.details.code).toBe("draft_publish_unqualified");
    expect(service.create).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });
});
