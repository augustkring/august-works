import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  heartbeatRuns,
  issues,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readAgentMonitor } from "../services/experience/agent-monitor.js";
import { agentMonitorRoutes } from "../routes/agent-monitor.js";
import { errorHandler } from "../middleware/error-handler.js";
const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;
describePg("V9 native current agent monitoring", () => {
  let db!: ReturnType<typeof createDb>;
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const local = { type: "board" as const, source: "local_implicit" as const };
  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase("v9-agent-monitor-");
    db = createDb(fixture.connectionString);
  }, 20000);
  afterAll(async () => {
    await fixture?.cleanup();
  });
  async function source(status = "idle") {
    await instanceSettingsService(db).updateExperimental({
      experience_projection_v9: true,
      progressive_shell_v9: true,
    });
    const companyId = randomUUID(),
      agentId = randomUUID();
    await db
      .insert(companies)
      .values({
        id: companyId,
        name: "Current private company",
        issuePrefix: randomUUID(),
      });
    await db
      .insert(agents)
      .values({
        id: agentId,
        companyId,
        name: "Current native agent",
        status,
        adapterConfig: { secret: "never-show-secret" },
        capabilities: "private-instructions",
        errorReason: "private-error",
      });
    return { companyId, agentId };
  }
  it.each([
    ["idle", "active"],
    ["running", "active"],
    ["paused", "paused"],
    ["error", "needs_attention"],
    ["pending_approval", "pending_approval"],
    ["terminated", "retired"],
  ])(
    "projects actual %s scheduling as %s without exposing configuration or readiness",
    async (status, lifecycle) => {
      const f = await source(status);
      const view = await readAgentMonitor(db, local, f.companyId, f.agentId);
      expect(view).toMatchObject({
        ...f,
        nativeStatus: status,
        lifecycle,
        recent: { runs: [], hasMore: false },
      });
      const serialized = JSON.stringify(view);
      expect(serialized).not.toMatch(
        /never-show-secret|private-instructions|private-error|verified|readiness/,
      );
    },
  );
  it("bounds actual native history and excludes another company/agent", async () => {
    const f = await source(),
      foreign = await source();
    await db
      .insert(heartbeatRuns)
      .values(
        Array.from({ length: 8 }, (_, n) => ({
          companyId: f.companyId,
          agentId: f.agentId,
          status: "succeeded",
          createdAt: new Date(Date.now() + n),
          resultJson: { secret: "private-result" },
        })),
      );
    await db
      .insert(heartbeatRuns)
      .values({
        companyId: foreign.companyId,
        agentId: foreign.agentId,
        status: "running",
      });
    const view = await readAgentMonitor(db, local, f.companyId, f.agentId);
    expect(view.recent.runs).toHaveLength(6);
    expect(view.recent.hasMore).toBe(true);
    expect(view.recent.runs.every((run) => run.status === "succeeded")).toBe(
      true,
    );
    expect(JSON.stringify(view)).not.toContain("private-result");
    await expect(
      readAgentMonitor(db, local, f.companyId, foreign.agentId),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("closes current metadata when its native conversation source is retired", async () => {
    const f = await source(),
      issueId = randomUUID();
    await db
      .insert(issues)
      .values({
        id: issueId,
        companyId: f.companyId,
        title: "Private conversation",
        status: "cancelled",
        hiddenAt: new Date(),
        conversationRetiredAt: new Date(),
      });
    await db
      .insert(heartbeatRuns)
      .values({
        companyId: f.companyId,
        agentId: f.agentId,
        nativeIssueId: issueId,
        runtimeMode: "native",
        status: "succeeded",
      });
    await expect(
      readAgentMonitor(db, local, f.companyId, f.agentId),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks actual membership after revocation rather than accepting a request snapshot", async () => {
    const f = await source(),
      userId = randomUUID();
    await db
      .insert(companyMemberships)
      .values({
        companyId: f.companyId,
        principalType: "user",
        principalId: userId,
        membershipRole: "member",
        status: "active",
      });
    const actor = {
      type: "board" as const,
      source: "session" as const,
      userId,
      isInstanceAdmin: true,
      companyIds: [f.companyId],
    };
    await readAgentMonitor(db, actor, f.companyId, f.agentId);
    await db
      .update(companyMemberships)
      .set({ status: "inactive" })
      .where(eq(companyMemberships.principalId, userId));
    await expect(
      readAgentMonitor(db, actor, f.companyId, f.agentId),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects account mismatch and disabled rollout with private no-store responses", async () => {
    const f = await source();
    const app = express();
    app.use((req, _res, next) => {
      req.actor = local;
      next();
    });
    app.use("/api", agentMonitorRoutes(db));
    app.use(errorHandler);
    const path = `/api/companies/${f.companyId}/agents/${f.agentId}/experience`;
    await request(app)
      .get(path + "?expectedUserId=other")
      .expect(409)
      .expect("Cache-Control", "private, no-store");
    await request(app)
      .get(path + "?expectedUserId=local-board")
      .expect(200)
      .expect("Cache-Control", "private, no-store");
    await instanceSettingsService(db).updateExperimental({
      progressive_shell_v9: false,
    });
    await request(app)
      .get(path + "?expectedUserId=local-board")
      .expect(404)
      .expect("Cache-Control", "private, no-store");
  });
});
