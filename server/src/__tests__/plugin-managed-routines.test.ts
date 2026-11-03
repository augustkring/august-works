import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agentConfigRevisions,
  agents,
  authUsers,
  authSessions,
  companies,
  companyMemberships,
  createDb,
  documentRevisions,
  documents,
  issues,
  issuePrivacySources,
  pluginManagedResources,
  principalPermissionGrants,
  plugins,
  projects,
  routineDocuments,
  routineRevisions,
  routineRuns,
  routineTriggers,
  routines,
} from "@paperclipai/db";
import type { PaperclipPluginManifestV1 } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { buildHostServices } from "../services/plugin-host-services.js";
import { routineService } from "../services/routines.js";
import { authorizationService, canActorReadTypedTaskSourcePrivacy } from "../services/authorization.js";
import { createCanonicalHumanProject, seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: async () => {},
        subscribe: () => {},
      };
    },
  } as any;
}

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function manifest(): PaperclipPluginManifestV1 {
  return {
    id: "paperclip.managed-routines-test",
    apiVersion: 1,
    version: "0.1.0",
    displayName: "Managed Routines Test",
    description: "Test plugin",
    author: "Paperclip",
    categories: ["automation"],
    capabilities: ["agents.managed", "projects.managed", "routines.managed"],
    entrypoints: { worker: "./dist/worker.js" },
    agents: [{
      agentKey: "wiki-maintainer",
      displayName: "Wiki Maintainer",
      role: "engineer",
      adapterType: "process",
      adapterConfig: { command: "pnpm wiki:maintain" },
    }],
    projects: [{
      projectKey: "operations",
      displayName: "Plugin Operations",
      description: "Plugin operation inspection",
      status: "in_progress",
    }],
    routines: [{
      routineKey: "nightly-lint",
      title: "Nightly lint",
      description: "Lint plugin state",
      assigneeRef: { resourceKind: "agent", resourceKey: "wiki-maintainer" },
      projectRef: { resourceKind: "project", resourceKey: "operations" },
      status: "active",
      priority: "medium",
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
      activityGatePolicy: "require_external_activity",
      activityGateScope: "project",
      triggers: [{
        kind: "schedule",
        label: "Nightly",
        cronExpression: "0 3 * * *",
        timezone: "UTC",
      }],
      issueTemplate: {
        surfaceVisibility: "plugin_operation",
        originId: "operation:nightly-lint",
        billingCode: "plugin-test:nightly-lint",
      },
    }],
  };
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres plugin-managed routine tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("plugin-managed routines", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-plugin-managed-routines-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(routineRuns);
    await db.delete(routineTriggers);
    await db.delete(routineDocuments);
    await db.delete(routines);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(agentConfigRevisions);
    await db.delete(activityLog);
    await db.delete(pluginManagedResources);
    await db.delete(principalPermissionGrants);
    await db.delete(authSessions);
    await db.delete(companyMemberships);
    await db.delete(authUsers);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(plugins);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndPlugin(pluginManifest = manifest()) {
    const companyId = randomUUID();
    const pluginId = randomUUID();
    const now = new Date();
    await db.insert(authUsers).values({
      id: "responsible-user",
      name: "Routine operator",
      email: `routine-operator-${randomUUID()}@example.test`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: issuePrefix(companyId),
      defaultResponsibleUserId: "responsible-user",
    });
    const sourceActor = await seedCurrentHumanSourceActor(db, [companyId], "responsible-user");
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: pluginManifest.id,
      packageName: "@paperclipai/plugin-managed-routines-test",
      version: pluginManifest.version,
      apiVersion: pluginManifest.apiVersion,
      categories: pluginManifest.categories,
      manifestJson: pluginManifest,
      status: "ready",
      installOrder: 1,
    });
    const services = buildHostServices(db, pluginId, pluginManifest.id, createEventBusStub(), undefined, {
      manifest: pluginManifest,
    });
    return { companyId, pluginId, pluginManifest, services, sourceActor };
  }

  it("resolves routine agent and project refs by stable managed keys", async () => {
    const { companyId, services } = await seedCompanyAndPlugin();
    const agent = await services.agents.managedReconcile({ companyId, agentKey: "wiki-maintainer" });
    const project = await services.projects.reconcileManaged({ companyId, projectKey: "operations" });

    const created = await services.routines.managedReconcile({ companyId, routineKey: "nightly-lint" });

    expect(created.status).toBe("created");
    expect(created.routine).toMatchObject({
      title: "Nightly lint",
      assigneeAgentId: agent.agentId,
      projectId: project.projectId,
      activityGatePolicy: "require_external_activity",
      activityGateScope: "project",
      managedByPlugin: expect.objectContaining({
        pluginKey: "paperclip.managed-routines-test",
        resourceKind: "routine",
        resourceKey: "nightly-lint",
      }),
    });

    const [trigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, created.routineId!));
    expect(trigger).toMatchObject({
      kind: "schedule",
      cronExpression: "0 3 * * *",
      timezone: "UTC",
    });
  });

  it("returns missing refs until the operator repairs them and preserves routine edits on reconcile", async () => {
    const { companyId, services } = await seedCompanyAndPlugin();

    const missing = await services.routines.managedReconcile({ companyId, routineKey: "nightly-lint" });
    expect(missing.status).toBe("missing_refs");
    expect(missing.missingRefs).toEqual([
      expect.objectContaining({ resourceKind: "agent", resourceKey: "wiki-maintainer" }),
      expect.objectContaining({ resourceKind: "project", resourceKey: "operations" }),
    ]);

    const [agent] = await db.insert(agents).values({
      companyId,
      name: "Operator-selected maintainer",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    const [project] = await db.insert(projects).values({
      companyId,
      name: "Operator-selected project",
      status: "in_progress",
    }).returning();

    const repaired = await services.routines.managedReconcile({
      companyId,
      routineKey: "nightly-lint",
      assigneeAgentId: agent.id,
      projectId: project.id,
    });
    expect(repaired.status).toBe("created");
    expect(repaired.routine).toMatchObject({
      assigneeAgentId: agent.id,
      projectId: project.id,
    });

    await db
      .update(routines)
      .set({ title: "Operator renamed lint", updatedAt: new Date() })
      .where(eq(routines.id, repaired.routineId!));

    const reconciled = await services.routines.managedReconcile({ companyId, routineKey: "nightly-lint" });
    expect(reconciled.status).toBe("resolved");
    expect(reconciled.routine?.title).toBe("Operator renamed lint");
  });

  it("creates routine operation issues with plugin visibility and managed project scoping", async () => {
    const { companyId, pluginId, services, sourceActor } = await seedCompanyAndPlugin();
    const agent = await services.agents.managedReconcile({ companyId, agentKey: "wiki-maintainer" });
    const project = await createCanonicalHumanProject(db, companyId, sourceActor, "Plugin Operations");
    await db.insert(pluginManagedResources).values({ companyId, pluginId, pluginKey: manifest().id,
      resourceKind: "project", resourceKey: "operations", resourceId: project.id, defaultsJson: {} });
    const managedProject = await services.projects.reconcileManaged({ companyId, projectKey: "operations" });
    expect(managedProject.projectId).toBe(project.id);
    const routine = await services.routines.managedReconcile({ companyId, routineKey: "nightly-lint" });
    const wakeup = vi.fn(async () => ({ id: randomUUID() }));
    const routinesSvc = routineService(db, { heartbeat: { wakeup }, sourceActor });

    const run = await routinesSvc.runRoutine(routine.routineId!, { source: "manual" }, { userId: "responsible-user" });
    expect(run.status).toBe("issue_created");
    const [issue] = await db.select().from(issues).where(eq(issues.id, run.linkedIssueId!));
    expect(issue).toMatchObject({
      originKind: "plugin:paperclip.managed-routines-test:operation",
      originId: "operation:nightly-lint",
      billingCode: "plugin-test:nightly-lint",
      projectId: project.id,
      assigneeAgentId: agent.agentId,
    });
    const retainedSources = await db.select({ sourceKind: issuePrivacySources.sourceKind, sourceId: issuePrivacySources.sourceId })
      .from(issuePrivacySources).where(eq(issuePrivacySources.issueId, issue!.id));
    expect(retainedSources).toContainEqual({ sourceKind: "routine_run", sourceId: run.id });
    expect(retainedSources).not.toContainEqual({ sourceKind: "run", sourceId: run.id });

    const [managedRoutine] = await db.select().from(routines).where(eq(routines.id, routine.routineId!));
    const [revision] = await db.select().from(routineRevisions).where(eq(routineRevisions.id, managedRoutine!.latestRevisionId!));
    const [scheduledRun] = await db.insert(routineRuns).values({ companyId, routineId: routine.routineId!,
      routineRevisionId: revision!.id, responsibleUserId: sourceActor.userId,
      source: "schedule", status: "received" }).returning();
    const [scheduledOperation] = await db.insert(issues).values({ companyId, title: "Scheduled plugin operation source",
      visibility: "private", createdByUserId: sourceActor.userId, responsibleUserId: sourceActor.userId,
      originKind: "plugin:paperclip.managed-routines-test:operation", originId: "operation:nightly-lint",
      originRunId: scheduledRun!.id }).returning();
    const scheduledSources = await db.select({ sourceKind: issuePrivacySources.sourceKind, sourceId: issuePrivacySources.sourceId })
      .from(issuePrivacySources).where(eq(issuePrivacySources.issueId, scheduledOperation!.id));
    expect(scheduledSources).toContainEqual({ sourceKind: "routine_run", sourceId: scheduledRun!.id });
    expect(scheduledSources).not.toContainEqual({ sourceKind: "run", sourceId: scheduledRun!.id });

    expect(wakeup).toHaveBeenCalledWith(agent.agentId, expect.objectContaining({
      reason: "issue_assigned",
    }));

    await expect(db.update(issues).set({ originKind: "plugin:foreign:operation" })
      .where(eq(issues.id, issue!.id))).rejects.toMatchObject({
        cause: { code: "23514", message: expect.stringContaining("Plugin operation source binding is invalid") },
      });
    const [originAfterRejectedRetarget] = await db.select({ originKind: issues.originKind })
      .from(issues).where(eq(issues.id, issue!.id));
    expect(originAfterRejectedRetarget?.originKind).toBe("plugin:paperclip.managed-routines-test:operation");

    const foreignRoutineId = randomUUID();
    const [foreignRoutine] = await db.insert(routines).values({
      ...managedRoutine!, id: foreignRoutineId, originKind: "manual", originId: null,
      latestRevisionId: null, latestRevisionNumber: 1,
    }).returning();
    const foreignRevisionSnapshot = {
      ...revision!.snapshot,
      routine: { ...revision!.snapshot.routine, id: foreignRoutineId },
    };
    const [foreignRevision] = await db.insert(routineRevisions).values({
      companyId, routineId: foreignRoutineId, revisionNumber: 1, title: foreignRoutine!.title,
      description: foreignRoutine!.description, snapshot: foreignRevisionSnapshot,
      createdByUserId: sourceActor.userId, responsibleUserId: sourceActor.userId,
    }).returning();
    await db.update(routines).set({ latestRevisionId: foreignRevision!.id })
      .where(eq(routines.id, foreignRoutineId));
    const [foreignRun] = await db.insert(routineRuns).values({ companyId, routineId: foreignRoutineId,
      routineRevisionId: foreignRevision!.id, responsibleUserId: sourceActor.userId,
      source: "manual", status: "received" }).returning();

    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await authorizationService(tx).withReadRoutineSources(companyId, sourceActor, [run.id], async () => {
        expect(await canActorReadTypedTaskSourcePrivacy(tx, sourceActor, {
          sourceKind: "routine_run", id: run.id, companyId,
        })).toBe(true);
        expect(await canActorReadTypedTaskSourcePrivacy(tx, sourceActor, {
          sourceKind: "routine_run", id: foreignRun!.id, companyId,
        })).toBe(false);
      });
    });
  });
});
