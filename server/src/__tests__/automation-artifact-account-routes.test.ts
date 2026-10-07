import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { automationArtifactRoutes } from "../routes/automation-artifacts.js";
const services = vi.hoisted(() => ({ list: vi.fn(async () => []), getDetail: vi.fn(async () => ({ artifact: { id: "artifact" }, latestVersion: null })), decide: vi.fn(async () => ({ allowed: true })) }));
vi.mock("../services/automation-artifacts/automation-artifact-service.js", () => ({ automationArtifactService: () => services }));
vi.mock("../services/automation-artifacts/automation-artifact-security.js", () => ({ automationArtifactSecurityService: () => ({}) }));
vi.mock("../services/access.js", () => ({ accessService: () => services }));
vi.mock("../services/instance-settings.js", () => ({ instanceSettingsService: () => ({ getExperimental: async () => ({ enableAutomationArtifactsV1: true }) }) }));
const companyId = "00000000-0000-4000-8000-000000000001", artifactId = "00000000-0000-4000-8000-000000000002";
function app() {
  const value = express(); value.use(express.json());
  value.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId: "reviewer", companyIds: [companyId], isInstanceAdmin: false }; next(); });
  value.use("/api", automationArtifactRoutes({} as never));
  value.use((error: { status?: number; details?: unknown }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.status ?? 500).json({ details: error.details }); }); return value;
}
beforeEach(() => vi.clearAllMocks());
describe("Current account admission for native artifact reads", () => {
  it.each(["", `/${artifactId}`])("rejects a stale account before exposing native artifact data: %s", async suffix => {
    const response = await request(app()).get(`/api/companies/${companyId}/automation-artifacts${suffix}?expectedUserId=previous-account`);
    expect(response.status).toBe(409); expect(response.body.details.code).toBe("ACCOUNT_CHANGED"); expect(response.headers["cache-control"]).toBe("no-store");
    expect(services.list).not.toHaveBeenCalled(); expect(services.getDetail).not.toHaveBeenCalled();
  });
  it.each(["", `/${artifactId}`])("preserves current-account native read permission with no-store: %s", async suffix => {
    const response = await request(app()).get(`/api/companies/${companyId}/automation-artifacts${suffix}?expectedUserId=reviewer`);
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(services.decide).toHaveBeenCalled();
  });
});
