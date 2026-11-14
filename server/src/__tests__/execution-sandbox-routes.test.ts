import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { executionSandboxRoutes } from "../routes/execution-sandbox.js";

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  qualify: vi.fn(),
  reconcile: vi.fn(),
  compile: vi.fn(),
  posture: vi.fn(),
}));

vi.mock("../services/execution-sandbox/sandbox-service.js", () => ({
  executionSandboxService: () => mocks,
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const bindingId = "22222222-2222-4222-8222-222222222222";
const policySnapshotId = "33333333-3333-4333-8333-333333333333";
const operator = {
  type: "board",
  userId: "configured-operator",
  sessionId: "passkey-session",
  companyIds: [companyId],
  source: "session",
  isInstanceAdmin: false,
};

function app(actor: typeof operator = operator) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  server.use("/api", executionSandboxRoutes({} as any, { operatorUserIds: [operator.userId] }));
  server.use(errorHandler);
  return server;
}

describe("execution sandbox admission route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards the strict admission request and authenticated actor to the service", async () => {
    const response = { binding: { id: bindingId, status: "ready", version: 5 }, policySnapshotId, operationId: "host-op-1" };
    mocks.admit.mockResolvedValue(response);
    const body = { expectedVersion: 4, policySnapshotId };
    const result = await request(app())
      .post(`/api/companies/${companyId}/runtime-sandboxes/${bindingId}/admit`)
      .send(body);

    expect(result.status).toBe(200);
    expect(result.body).toEqual(response);
    expect(mocks.admit).toHaveBeenCalledWith(operator, companyId, bindingId, body);
  });

  it("rejects non-operator callers and malformed admission bodies before service dispatch", async () => {
    const denied = await request(app({ ...operator, userId: "ordinary-member" }))
      .post(`/api/companies/${companyId}/runtime-sandboxes/${bindingId}/admit`)
      .send({ expectedVersion: 4, policySnapshotId });
    const malformed = await request(app())
      .post(`/api/companies/${companyId}/runtime-sandboxes/${bindingId}/admit`)
      .send({ expectedVersion: 4, policySnapshotId, expiresAt: new Date().toISOString() });

    expect(denied.status).toBe(403);
    expect(malformed.status).toBe(400);
    expect(mocks.admit).not.toHaveBeenCalled();
  });
});
