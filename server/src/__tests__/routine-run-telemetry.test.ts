import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  authUsers,
  authSessions,
  companies,
  companyMemberships,
  createDb,
  documentRevisions,
  documents,
  executionWorkspaces,
  heartbeatRuns,
  issues,
  projectWorkspaces,
  principalPermissionGrants,
  projects,
  pluginManagedResources,
  plugins,
  routineDocuments,
  routineRuns,
  routines,
  routineTriggers,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
const mockTrackRoutineRun = vi.hoisted(() => vi.fn());

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: () => mockTelemetryClient,
}));

vi.mock("@paperclipai/shared/telemetry", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/shared/telemetry")>(
    "@paperclipai/shared/telemetry",
  );
  return {
    ...actual,
    trackRoutineRun: mockTrackRoutineRun,
  };
});

import { routineService } from "../services/routines.ts";
import { createCanonicalHumanProject, seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { buildHostServices } from "../services/plugin-host-services.js";
import type { PaperclipPluginManifestV1 } from "@paperclipai/shared";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const routineTelemetryManifest: PaperclipPluginManifestV1 = {
  id: "paperclip.routine-telemetry-test", apiVersion: 1, version: "0.1.0", displayName: "Routine telemetry test",
  description: "Exercises telemetry through the qualified managed Routine owner", author: "Paperclip",
  categories: ["automation"], capabilities: ["agents.managed", "projects.managed", "routines.managed"],
  entrypoints: { worker: "./dist/worker.js" },
  agents: [{ agentKey: "telemetry-worker", displayName: "Telemetry worker", role: "engineer", adapterType: "process",
    adapterConfig: { command: "pnpm telemetry:noop" } }],
  projects: [{ projectKey: "operations", displayName: "Routine telemetry operations", description: "Routine telemetry scope",
    status: "in_progress" }],
  routines: [{ routineKey: "telemetry", title: "Run telemetry test", description: "Routine body",
    assigneeRef: { resourceKind: "agent", resourceKey: "telemetry-worker" },
    projectRef: { resourceKind: "project", resourceKey: "operations" }, status: "active", priority: "medium",
    concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed", activityGatePolicy: "always",
    activityGateScope: "company", triggers: [{ kind: "schedule", label: "Telemetry", cronExpression: "0 3 * * *", timezone: "UTC" }],
    issueTemplate: { surfaceVisibility: "plugin_operation", originId: "operation:telemetry", billingCode: "test:telemetry" } }],
};

function createEventBusStub() {
  return { forPlugin: () => ({ emit: async () => {}, subscribe: () => {} }) } as any;
}

describeEmbeddedPostgres("routine run telemetry", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-routine-telemetry-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    vi.clearAllMocks();
    await db.delete(routineRuns);
    await db.delete(routineTriggers);
    await db.delete(routineDocuments);
    await db.delete(routines);
    await db.delete(documents);
    await db.delete(documentRevisions);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(pluginManagedResources);
    await db.delete(activityLog);
    await db.delete(plugins);
    await db.delete(agents);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(authSessions);
    await db.delete(companies);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedFixture() {
    const companyId = randomUUID();
    const pluginId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    const sourceActor = await seedCurrentHumanSourceActor(db, [companyId], "responsible-user");
    await db.insert(plugins).values({ id: pluginId, pluginKey: routineTelemetryManifest.id,
      packageName: "@paperclipai/plugin-routine-telemetry-test", version: routineTelemetryManifest.version,
      apiVersion: routineTelemetryManifest.apiVersion, categories: routineTelemetryManifest.categories,
      manifestJson: routineTelemetryManifest, status: "ready", installOrder: 1 });
    const host = buildHostServices(db, pluginId, routineTelemetryManifest.id, createEventBusStub(), undefined,
      { manifest: routineTelemetryManifest });
    await host.agents.managedReconcile({ companyId, agentKey: "telemetry-worker" });
    const project = await createCanonicalHumanProject(db, companyId, sourceActor, "Routines");
    const projectId = project.id;
    await db.insert(pluginManagedResources).values({ companyId, pluginId, pluginKey: routineTelemetryManifest.id,
      resourceKind: "project", resourceKey: "operations", resourceId: projectId, defaultsJson: {} });
    await host.projects.reconcileManaged({ companyId, projectKey: "operations" });
    const managedRoutine = await host.routines.managedReconcile({ companyId, routineKey: "telemetry" });
    if (!managedRoutine.routineId) throw new Error("Managed telemetry Routine was not created");

    const svc = routineService(db, {
      sourceActor,
      heartbeat: {
        wakeup: async (wakeupAgentId, wakeupOpts) => {
          const issueId =
            (typeof wakeupOpts.payload?.issueId === "string" && wakeupOpts.payload.issueId)
            || (typeof wakeupOpts.contextSnapshot?.issueId === "string" && wakeupOpts.contextSnapshot.issueId)
            || null;
          if (!issueId) return null;
          const queuedRunId = randomUUID();
          await db.insert(heartbeatRuns).values({
            id: queuedRunId,
            companyId,
            agentId: wakeupAgentId,
            invocationSource: wakeupOpts.source ?? "assignment",
            triggerDetail: wakeupOpts.triggerDetail ?? null,
            status: "queued",
            contextSnapshot: { ...(wakeupOpts.contextSnapshot ?? {}), issueId },
          });
          await db
            .update(issues)
            .set({
              executionRunId: queuedRunId,
              executionLockedAt: new Date(),
            })
            .where(eq(issues.id, issueId));
          return { id: queuedRunId };
        },
      },
    });

    return { routine: { id: managedRoutine.routineId }, svc, sourceActor };
  }

  it("emits telemetry for routine runs from the service layer", async () => {
    const { routine, svc, sourceActor } = await seedFixture();

    const run = await svc.runRoutine(routine.id, { source: "manual" }, sourceActor);

    expect(run.status, run.failureReason ?? undefined).toBe("issue_created");
    expect(mockTrackRoutineRun).toHaveBeenCalledWith(mockTelemetryClient, {
      source: "manual",
      status: "issue_created",
    });
  });
});
