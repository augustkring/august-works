import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentIdentities,
  activityLog,
  authUsers,
  companySecretBindings,
  companySecrets,
  companies,
  companyMemberships,
  createDb,
  connectionGrantDelegations,
  connectionGrantMembers,
  connectionGrants,
  instanceUserRoles,
  issues,
  heartbeatRuns,
  humanWorkflowCoverages,
  principalPermissionGrants,
  routines,
  routineRevisions,
  toolAccessAuditEvents,
  toolApplications,
  toolConnections,
  userSecretDeclarations,
  userSecretDefinitions,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { accessService } from "../services/access.js";
import { issueService } from "../services/issues.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { backfillPrincipalAccessCompatibility, ensureHumanRoleDefaultGrants } from "../services/principal-access-compatibility.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createCompanyWithOwner(db: ReturnType<typeof createDb>) {
  const company = await db
    .insert(companies)
    .values({
      name: `Access Service ${randomUUID()}`,
      issuePrefix: `AS${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);

  const owner = await db
    .insert(companyMemberships)
    .values({
      companyId: company.id,
      principalType: "user",
      principalId: `owner-${randomUUID()}`,
      status: "active",
      membershipRole: "owner",
    })
    .returning()
    .then((rows) => rows[0]!);

  return { company, owner };
}

describeEmbeddedPostgres("access service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-access-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(toolAccessAuditEvents);
    await db.delete(userSecretDeclarations);
    await db.delete(companySecretBindings);
    await db.delete(connectionGrantDelegations);
    await db.delete(connectionGrantMembers);
    await db.delete(connectionGrants);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(companySecrets);
    await db.delete(userSecretDefinitions);
    await db.delete(issues);
    await db.delete(activityLog);
    await db.delete(routineRevisions);
    await db.delete(routines);
    await db.delete(principalPermissionGrants);
    await db.delete(humanWorkflowCoverages);
    await db.delete(workflows);
    await db.delete(heartbeatRuns);
    await db.delete(instanceUserRoles);
    await db.delete(agents);
    await db.delete(agentIdentities);
    await db.delete(companyMemberships);
    await db.delete(authUsers);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("routes exact published-workflow coverage without copying rights and withdraws it on member suspension", async () => {
    const company = await db.insert(companies).values({ name: `Coverage ${randomUUID()}`, issuePrefix: `CV${randomUUID().slice(0, 6).toUpperCase()}` }).returning().then(rows => rows[0]!);
    const principalUserId = randomUUID(), delegateeUserId = randomUUID(), now = new Date();
    await db.insert(authUsers).values([principalUserId, delegateeUserId].map(id => ({
      id, name: id, email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now,
    })));
    const [principal, delegatee] = await db.insert(companyMemberships).values([
      { companyId: company.id, principalType: "user", principalId: principalUserId, membershipRole: "owner", status: "active" },
      { companyId: company.id, principalType: "user", principalId: delegateeUserId, membershipRole: "operator", status: "active" },
    ]).returning();
    const workflowId = randomUUID(), revisionId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(workflows).values({ id: workflowId, companyId: company.id, name: "Coverage target", status: "active", publishedRevisionId: revisionId });
      await tx.insert(workflowRevisions).values({
        id: revisionId, companyId: company.id, workflowId, revisionNumber: 1, state: "published",
        graph: { version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} },
        createdByUserId: principalUserId,
      });
    });
    const workflow = (await db.select().from(workflows).where(eq(workflows.id, workflowId)))[0]!;
    const revision = (await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, revisionId)))[0]!;
    await db.insert(principalPermissionGrants).values([principalUserId, delegateeUserId].map(userId => ({
      companyId: company.id, principalType: "user" as const, principalId: userId,
      permissionKey: "workflows:run" as const,
    })));

    const access = accessService(db), actor = { type: "board" as const, source: "session" as const, userId: principalUserId };
    const input = { requestId: randomUUID(), delegateeUserId, workflowId: workflow.id, workflowRevisionId: revision.id,
      scopeType: "manual" as const, taskId: null, startsAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 60_000), reason: "Temporary Human absence" };
    const created = await access.createWorkflowCoverage(company.id, input, actor);
    expect(created.created).toBe(true);
    expect(created.coverage).toMatchObject({ principalUserId, delegateeUserId, actionKey: "workflows:run", workflowId: workflow.id,
      workflowRevisionId: revision.id, scopeType: "manual", taskId: null, revokedAt: null });
    expect((await access.createWorkflowCoverage(company.id, input, actor)).created).toBe(false);
    await expect(access.createWorkflowCoverage(company.id, { ...input, reason: "Different request meaning" }, actor))
      .rejects.toMatchObject({ status: 409, details: { code: "workflow_coverage_request_reused" } });
    await db.transaction(async tx => expect(await access.authorizeWorkflowCoverage({
      tx: tx as never, companyId: company.id, coverageId: created.coverage.id, delegateeUserId,
      workflowId: workflow.id, workflowRevisionId: revision.id, scopeType: "manual", taskId: null,
    })).toMatchObject({ id: created.coverage.id }));

    await access.setMemberPermissions(company.id, delegatee.id, [], principalUserId);
    const [permissionWithdrawn] = await db.select().from(humanWorkflowCoverages)
      .where(eq(humanWorkflowCoverages.id, created.coverage.id));
    expect(permissionWithdrawn?.revokedAt).toBeInstanceOf(Date);
    await access.setMemberPermissions(company.id, delegatee.id, [{ permissionKey: "workflows:run" }], principalUserId);
    await db.transaction(async tx => expect(access.authorizeWorkflowCoverage({
      tx: tx as never, companyId: company.id, coverageId: created.coverage.id, delegateeUserId,
      workflowId: workflow.id, workflowRevisionId: revision.id, scopeType: "manual", taskId: null,
    })).rejects.toMatchObject({ status: 403, details: { code: "workflow_coverage_unavailable" } }));

    const secondCoverage = await access.createWorkflowCoverage(company.id, { ...input, requestId: randomUUID() }, actor);
    await access.updateMemberAndPermissions(company.id, delegatee.id, {
      membershipRole: "viewer", grants: [],
    }, principalUserId);
    const [roleWithdrawn] = await db.select().from(humanWorkflowCoverages)
      .where(eq(humanWorkflowCoverages.id, secondCoverage.coverage.id));
    expect(roleWithdrawn?.revokedAt).toBeInstanceOf(Date);

    await access.updateMember(company.id, delegatee.id, { status: "suspended" }, principalUserId);
    const [withdrawn] = await db.select().from(humanWorkflowCoverages).where(eq(humanWorkflowCoverages.id, created.coverage.id));
    expect(withdrawn).toMatchObject({ revokedByUserId: principalUserId });
    expect(withdrawn?.revokedAt).toBeInstanceOf(Date);
    await db.transaction(async tx => expect(access.authorizeWorkflowCoverage({
      tx: tx as never, companyId: company.id, coverageId: created.coverage.id, delegateeUserId,
      workflowId: workflow.id, workflowRevisionId: revision.id, scopeType: "manual", taskId: null,
    })).rejects.toMatchObject({ status: 403 }));
  });

  it("requires both Humans' current privacy-respecting Task authority for Task-scoped coverage", async () => {
    const company = await db.insert(companies).values({ name: `Task coverage ${randomUUID()}`, issuePrefix: `TC${randomUUID().slice(0, 6).toUpperCase()}` }).returning().then(rows => rows[0]!);
    const principalUserId = randomUUID(), delegateeUserId = randomUUID(), now = new Date();
    await db.insert(authUsers).values([principalUserId, delegateeUserId].map(id => ({
      id, name: id, email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now,
    })));
    await db.insert(companyMemberships).values([
      { companyId: company.id, principalType: "user", principalId: principalUserId, membershipRole: "owner", status: "active" },
      { companyId: company.id, principalType: "user", principalId: delegateeUserId, membershipRole: "operator", status: "active" },
    ]);
    const workflowId = randomUUID(), revisionId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(workflows).values({ id: workflowId, companyId: company.id, name: "Task coverage target", status: "active", publishedRevisionId: revisionId });
      await tx.insert(workflowRevisions).values({
        id: revisionId, companyId: company.id, workflowId, revisionNumber: 1, state: "published",
        graph: { version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} },
        createdByUserId: principalUserId,
      });
    });
    const workflow = (await db.select().from(workflows).where(eq(workflows.id, workflowId)))[0]!;
    const revision = (await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, revisionId)))[0]!;
    await db.insert(principalPermissionGrants).values([principalUserId, delegateeUserId].map(userId => ({
      companyId: company.id, principalType: "user" as const, principalId: userId, permissionKey: "workflows:run" as const,
    })));
    const privateTask = await issueService(db).create(company.id, {
      title: "Private coverage Task", visibility: "private", createdByUserId: principalUserId,
    });
    const access = accessService(db), actor = { type: "board" as const, source: "session" as const, userId: principalUserId };
    const terms = { delegateeUserId, workflowId: workflow.id, workflowRevisionId: revision.id,
      scopeType: "task" as const, startsAt: new Date(Date.now() - 1_000), expiresAt: new Date(Date.now() + 60_000),
      reason: "One private Task" };
    await expect(access.createWorkflowCoverage(company.id, { ...terms, requestId: randomUUID(), taskId: privateTask.id }, actor))
      .rejects.toMatchObject({ status: 403, details: { code: "workflow_coverage_task_authority_unavailable" } });

    const openTask = await issueService(db).create(company.id, {
      title: "Open coverage Task", createdByUserId: principalUserId, assigneeUserId: delegateeUserId,
    });
    const created = await access.createWorkflowCoverage(company.id, { ...terms, requestId: randomUUID(), taskId: openTask.id }, actor);
    expect(created.coverage).toMatchObject({ scopeType: "task", taskId: openTask.id });
    await db.transaction(async tx => expect(await access.authorizeWorkflowCoverage({
      tx: tx as never, companyId: company.id, coverageId: created.coverage.id, delegateeUserId,
      workflowId: workflow.id, workflowRevisionId: revision.id, scopeType: "task", taskId: openTask.id,
    })).toMatchObject({ id: created.coverage.id }));
  });

  it.each(["owner", "admin"])("keeps the existing %s role when one read permission changes", async role => {
    const { company, owner } = await createCompanyWithOwner(db);
    if (role === "admin") await db.update(companyMemberships).set({ membershipRole: role }).where(eq(companyMemberships.id, owner.id));
    const service = accessService(db);
    await service.setPrincipalPermission(company.id, "user", owner.principalId, "foundation:read", true, owner.principalId);
    expect(await service.getMembership(company.id,"user",owner.principalId)).toMatchObject({ status: "active", membershipRole: role });
    await service.setPrincipalPermission(company.id, "user", owner.principalId, "foundation:read", false, owner.principalId);
    expect(await service.getMembership(company.id,"user",owner.principalId)).toMatchObject({ status: "active", membershipRole: role });
    await backfillPrincipalAccessCompatibility(db);
    await expect(service.canUser(company.id, owner.principalId, "foundation:read")).resolves.toBe(false);
  });

  it("rejects combined access updates that would demote the last active owner", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const access = accessService(db);

    await expect(
      access.updateMemberAndPermissions(
        company.id,
        owner.id,
        { membershipRole: "admin", grants: [] },
        "admin-user",
      ),
    ).rejects.toThrow("Cannot remove the last active owner");

    const unchanged = await db
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.id, owner.id))
      .then((rows) => rows[0]!);
    expect(unchanged.membershipRole).toBe("owner");
  });

  it("rejects role-only updates that would suspend the last active owner", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const access = accessService(db);

    await expect(
      access.updateMember(company.id, owner.id, { status: "suspended" }),
    ).rejects.toThrow("Cannot remove the last active owner");

    const unchanged = await db
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.id, owner.id))
      .then((rows) => rows[0]!);
    expect(unchanged.status).toBe("active");
  });

  it("archives members, clears grants, and reassigns open issues without deleting history", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db
      .insert(companyMemberships)
      .values({
        companyId: company.id,
        principalType: "user",
        principalId: `member-${randomUUID()}`,
        status: "active",
        membershipRole: "operator",
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: member.principalId,
      permissionKey: "tasks:assign",
      grantedByUserId: owner.principalId,
    });
    const openIssue = await db
      .insert(issues)
      .values({
        companyId: company.id,
        title: "Open assigned issue",
        status: "in_progress",
        assigneeUserId: member.principalId,
      })
      .returning()
      .then((rows) => rows[0]!);
    const doneIssue = await db
      .insert(issues)
      .values({
        companyId: company.id,
        title: "Historical assigned issue",
        status: "done",
        assigneeUserId: member.principalId,
      })
      .returning()
      .then((rows) => rows[0]!);

    const access = accessService(db);
    const result = await access.archiveMember(company.id, member.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(result?.reassignedIssueCount).toBe(1);
    const archived = await db
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.id, member.id))
      .then((rows) => rows[0]!);
    expect(archived.status).toBe("archived");

    const remainingGrants = await db
      .select()
      .from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.principalId, member.principalId));
    expect(remainingGrants).toHaveLength(0);

    const reassignedIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, openIssue.id))
      .then((rows) => rows[0]!);
    expect(reassignedIssue.assigneeUserId).toBe(owner.principalId);
    expect(reassignedIssue.status).toBe("todo");

    const historicalIssue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, doneIssue.id))
      .then((rows) => rows[0]!);
    expect(historicalIssue.assigneeUserId).toBe(member.principalId);
  });

  it("archives without a routine replacement, pauses active work, and leaves an owner action", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "operator",
    }).returning().then((rows) => rows[0]!);
    const routine = await db.insert(routines).values({
      companyId: company.id,
      title: "Member-owned routine",
      status: "active",
      responsibleUserId: member.principalId,
    }).returning().then((rows) => rows[0]!);
    const result = await accessService(db).archiveMember(company.id, member.id, {
      routineResponsibleUserId: owner.principalId,
    }, owner.principalId);
    expect(result).toMatchObject({ reassignedRoutineCount: 0, pausedRoutineCount: 1, ownerActionRoutineCount: 1 });
    expect((await accessService(db).getMemberById(company.id, member.id))?.status).toBe("archived");
    const pausedRoutine = (await db.select().from(routines).where(eq(routines.id, routine.id)))[0]!;
    expect(pausedRoutine).toMatchObject({ status: "paused", responsibleUserId: member.principalId });
    const latestRevision = (await db.select().from(routineRevisions).where(eq(routineRevisions.id, pausedRoutine.latestRevisionId!)))[0]!;
    expect(latestRevision).toMatchObject({ responsibleUserId: member.principalId, snapshot: { routine: { status: "paused", responsibleUserId: member.principalId } } });
    expect(await db.select().from(activityLog).where(and(
      eq(activityLog.entityType, "routine"),
      eq(activityLog.entityId, routine.id),
      eq(activityLog.action, "routine.paused_for_responsible_user_offboarding"),
    ))).toMatchObject([{ actorId: owner.principalId, responsibleUserId: member.principalId }]);
  });

  it("transfers manual routine responsibility through the retained revision writer", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "operator",
    }).returning().then((rows) => rows[0]!);
    const routine = await db.insert(routines).values({
      companyId: company.id,
      title: "Member-owned routine",
      status: "paused",
      responsibleUserId: member.principalId,
    }).returning().then((rows) => rows[0]!);
    const now = new Date();
    await db.insert(authUsers).values({
      id: owner.principalId,
      name: "Routine replacement owner",
      email: `${owner.principalId}@example.test`,
      createdAt: now,
      updatedAt: now,
    });
    const result = await accessService(db).archiveMember(company.id, member.id, {
      routineResponsibleUserId: owner.principalId,
    }, owner.principalId);
    expect(result).toMatchObject({ reassignedRoutineCount: 1, pausedRoutineCount: 0, ownerActionRoutineCount: 0 });
    const transferredRoutine = (await db.select().from(routines).where(eq(routines.id, routine.id)))[0]!;
    expect(transferredRoutine).toMatchObject({ status: "paused", responsibleUserId: owner.principalId });
    const latestRevision = (await db.select().from(routineRevisions).where(eq(routineRevisions.id, transferredRoutine.latestRevisionId!)))[0]!;
    expect(latestRevision).toMatchObject({ responsibleUserId: owner.principalId, snapshot: { routine: { status: "paused", responsibleUserId: owner.principalId } } });
    expect(await db.select().from(activityLog).where(and(
      eq(activityLog.entityType, "routine"),
      eq(activityLog.entityId, routine.id),
      eq(activityLog.action, "routine.responsibility_transferred"),
    ))).toMatchObject([{ actorId: owner.principalId, responsibleUserId: owner.principalId }]);
  });

  it("keeps a private conversation routine with its source owner and pauses it during archive", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "operator",
    }).returning().then((rows) => rows[0]!);
    const now = new Date();
    await db.insert(authUsers).values({
      id: member.principalId,
      name: "Private routine source owner",
      email: `${member.principalId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const identity = await db.insert(agentIdentities).values({
      name: "Private routine source agent",
      homeCompanyId: company.id,
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      agentIdentityId: identity.id,
      name: "Private routine source agent",
      status: "idle",
    }).returning().then((rows) => rows[0]!);
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "agent",
      principalId: agent.id,
      status: "active",
      membershipRole: "member",
    });
    const conversation = await issueService(db).create(company.id, {
      title: "Private routine conversation",
      status: "in_progress",
      assigneeAgentId: agent.id,
      conversationAgentId: agent.id,
      conversationUserId: member.principalId,
      conversationState: "active",
      createdByUserId: member.principalId,
    });
    const originRun = await db.insert(heartbeatRuns).values({
      companyId: company.id,
      agentId: agent.id,
      responsibleUserId: member.principalId,
      nativeIssueId: conversation.id,
      runtimeMode: "native",
      status: "running",
      contextSnapshot: { issueId: conversation.id, conversationSessionGeneration: 0 },
    }).returning().then((rows) => rows[0]!);
    const inserted = await db.insert(routines).values({
      companyId: company.id,
      title: "Private conversation routine",
      status: "active",
      originKind: "conversation_draft",
      originId: originRun.id,
      createdByAgentId: agent.id,
      responsibleUserId: member.principalId,
    }).returning().then((rows) => rows[0]!);
    const [unErased] = await db.execute<{ erased: boolean }>(sql`
      select aw_conversation_routine_source_erased(${company.id}::uuid, ${inserted.id}::uuid) as erased
    `);
    expect(unErased?.erased).toBe(false);

    const result = await accessService(db).archiveMember(company.id, member.id, {}, owner.principalId);
    expect(result).toMatchObject({ reassignedRoutineCount: 0, pausedRoutineCount: 1, ownerActionRoutineCount: 1 });
    expect((await accessService(db).getMemberById(company.id, member.id))?.status).toBe("archived");
    const privateRoutine = (await db.select().from(routines).where(eq(routines.id, inserted.id)))[0]!;
    expect(privateRoutine).toMatchObject({ status: "paused", originKind: "conversation_draft", originId: originRun.id, createdByAgentId: agent.id, responsibleUserId: member.principalId });
    const latestRevision = (await db.select().from(routineRevisions).where(eq(routineRevisions.id, privateRoutine.latestRevisionId!)))[0]!;
    expect(latestRevision).toMatchObject({ responsibleUserId: member.principalId, snapshot: { routine: { responsibleUserId: member.principalId, status: "paused" } } });
  });

  it.each(["suspended", "pending"] as const)("moves an active member to %s and pauses owned routines through the retained revision writer", async (status) => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "operator",
    }).returning().then((rows) => rows[0]!);
    const routine = await db.insert(routines).values({
      companyId: company.id,
      title: "Routine paused on suspension",
      status: "active",
      responsibleUserId: member.principalId,
    }).returning().then((rows) => rows[0]!);

    const suspended = await accessService(db).updateMember(
      company.id,
      member.id,
      { status },
      owner.principalId,
    );
    expect(suspended?.status).toBe(status);
    const paused = (await db.select().from(routines).where(eq(routines.id, routine.id)))[0]!;
    expect(paused).toMatchObject({ status: "paused", responsibleUserId: member.principalId });
    const latestRevision = (await db.select().from(routineRevisions).where(eq(routineRevisions.id, paused.latestRevisionId!)))[0]!;
    expect(latestRevision).toMatchObject({ responsibleUserId: member.principalId, snapshot: { routine: { status: "paused", responsibleUserId: member.principalId } } });
  });

  it("rejects instance-level company access removal for self and protected users", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const access = accessService(db);

    await expect(
      access.setUserCompanyAccess(owner.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("You cannot remove yourself");

    const admin = await db
      .insert(companyMemberships)
      .values({
        companyId: company.id,
        principalType: "user",
        principalId: `admin-${randomUUID()}`,
        status: "active",
        membershipRole: "admin",
      })
      .returning()
      .then((rows) => rows[0]!);

    await expect(
      access.setUserCompanyAccess(admin.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("Owners and admins cannot be removed from company access");

    const operator = await db
      .insert(companyMemberships)
      .values({
        companyId: company.id,
        principalType: "user",
        principalId: `operator-${randomUUID()}`,
        status: "active",
        membershipRole: "operator",
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(instanceUserRoles).values({
      userId: operator.principalId,
      role: "instance_admin",
    });

    await expect(
      access.setUserCompanyAccess(operator.principalId, [], { actorUserId: owner.principalId }),
    ).rejects.toThrow("Instance admins cannot be removed from company access");
  });

  it("sweeps personal grants when instance-level company access is removed", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Instance access delegated agent",
      role: "worker",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `instance-access-${randomUUID()}`,
      name: "Instance access app",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Instance access connection",
      uid: `instance-access-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const grant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      status: "active",
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantDelegations).values({
      companyId: company.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });

    await accessService(db).setUserCompanyAccess(member.principalId, [], {
      actorUserId: owner.principalId,
    });

    expect(await db.select().from(companyMemberships).where(eq(companyMemberships.id, member.id)))
      .toEqual([expect.objectContaining({ status: "archived" })]);
    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked" })]);
  });

  it("revokes personal connection access and destroys user-scoped secrets when membership is archived", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Delegated agent",
      role: "worker",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `app-${randomUUID()}`,
      name: "Personal mail",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Mail",
      uid: `mail-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      companyId: company.id,
      key: `oauth-${randomUUID()}`,
      name: "Personal OAuth token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: `OAuth ${randomUUID()}`,
    }).returning().then((rows) => rows[0]!);
    await db.update(toolConnections).set({
      credentialSecretRefs: [{ secretId: secret.id, configPath: "oauth.access_token" }],
    }).where(eq(toolConnections.id, connection.id));
    const grant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      credentialSecretRefs: [{ secretId: secret.id, configPath: "oauth.access_token" }],
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantDelegations).values({
      companyId: company.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });
    await accessService(db).archiveMember(company.id, member.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(connectionGrantMembers)).toHaveLength(0);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, secret.id))).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({
        status: "draft",
        enabled: false,
        healthStatus: "missing_secret",
        lastError: "oauth_reauthorization_required",
        credentialSecretRefs: [],
      })]);
    expect(await db.select().from(toolAccessAuditEvents).where(eq(toolAccessAuditEvents.reasonCode, "membership_removed")))
      .toHaveLength(1);
  });

  it("retains a personal credential while another member grant still uses it", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const [departing, surviving] = await db.insert(companyMemberships).values([
      {
        companyId: company.id,
        principalType: "user" as const,
        principalId: `departing-${randomUUID()}`,
        status: "active" as const,
        membershipRole: "member" as const,
      },
      {
        companyId: company.id,
        principalType: "user" as const,
        principalId: `surviving-${randomUUID()}`,
        status: "active" as const,
        membershipRole: "member" as const,
      },
    ]).returning();
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `shared-personal-${randomUUID()}`,
      name: "Shared personal app",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Shared personal connection",
      uid: `shared-personal-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      companyId: company.id,
      key: `shared-personal-${randomUUID()}`,
      name: "Shared personal token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "user",
      ownerUserId: departing!.principalId,
      userSecretDefinitionId: definition.id,
      key: `shared-personal-${randomUUID()}`,
      name: "Shared personal token",
    }).returning().then((rows) => rows[0]!);
    const credentialSecretRefs = [{ secretId: secret.id, configPath: "oauth.access_token" }];
    await db.update(toolConnections).set({ credentialSecretRefs }).where(eq(toolConnections.id, connection.id));
    const [departingGrant, survivingGrant] = await db.insert(connectionGrants).values([
      {
        companyId: company.id,
        connectionId: connection.id,
        kind: "user" as const,
        subjectUserId: departing!.principalId,
        status: "active" as const,
        credentialSecretRefs,
      },
      {
        companyId: company.id,
        connectionId: connection.id,
        kind: "user" as const,
        subjectUserId: surviving!.principalId,
        status: "active" as const,
        credentialSecretRefs,
      },
    ]).returning();

    await accessService(db).archiveMember(company.id, departing!.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, secret.id)))
      .toHaveLength(1);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, departingGrant!.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, survivingGrant!.id)))
      .toEqual([expect.objectContaining({ status: "active", credentialSecretRefs })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({ status: "active", enabled: true, credentialSecretRefs })]);
  });

  it("keeps a mixed connection active when an unaffected organization credential survives", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const departing = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `departing-mixed-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `mixed-${randomUUID()}`,
      name: "Mixed credential app",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      companyId: company.id,
      key: `mixed-personal-${randomUUID()}`,
      name: "Mixed personal token",
    }).returning().then((rows) => rows[0]!);
    const personalSecret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "user",
      ownerUserId: departing.principalId,
      userSecretDefinitionId: definition.id,
      key: `mixed-personal-${randomUUID()}`,
      name: "Mixed personal token",
    }).returning().then((rows) => rows[0]!);
    const organizationSecret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "company",
      key: `mixed-organization-${randomUUID()}`,
      name: "Mixed organization token",
    }).returning().then((rows) => rows[0]!);
    const personalRef = { secretId: personalSecret.id, configPath: "credentials.personal" };
    const organizationRef = { secretId: organizationSecret.id, configPath: "credentials.organization" };
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Mixed credential connection",
      uid: `mixed-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "api_key",
      credentialPolicy: "per_user_with_fallback",
      status: "active",
      enabled: true,
      healthStatus: "healthy",
      credentialSecretRefs: [personalRef, organizationRef],
    }).returning().then((rows) => rows[0]!);
    const personalGrant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: departing.principalId,
      credentialSecretRefs: [personalRef],
    }).returning().then((rows) => rows[0]!);
    const organizationGrant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "organization",
      status: "active",
      isDefault: true,
      credentialSecretRefs: [organizationRef],
    }).returning().then((rows) => rows[0]!);

    await accessService(db).archiveMember(company.id, departing.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, personalSecret.id)))
      .toHaveLength(0);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, organizationSecret.id)))
      .toHaveLength(1);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, personalGrant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, organizationGrant.id)))
      .toEqual([expect.objectContaining({ status: "active", credentialSecretRefs: [organizationRef] })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({
        status: "active",
        enabled: true,
        healthStatus: "healthy",
        lastError: null,
        credentialSecretRefs: [organizationRef],
      })]);
  });

  it("keeps a sole organization audience dormant until its member is reactivated", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const departing = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `departing-org-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `shared-org-${randomUUID()}`,
      name: "Shared organization app",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Shared organization connection",
      uid: `shared-org-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "shared",
      status: "active",
      enabled: true,
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      companyId: company.id,
      key: `shared-org-${randomUUID()}`,
      name: "Shared organization token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "user",
      ownerUserId: departing.principalId,
      userSecretDefinitionId: definition.id,
      key: `shared-org-${randomUUID()}`,
      name: "Shared organization token",
    }).returning().then((rows) => rows[0]!);
    const credentialSecretRefs = [{ secretId: secret.id, configPath: "oauth.access_token" }];
    await db.update(toolConnections).set({ credentialSecretRefs }).where(eq(toolConnections.id, connection.id));
    await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: departing.principalId,
      status: "active",
      credentialSecretRefs,
    });
    const organizationGrant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "organization",
      status: "active",
      isDefault: true,
      credentialSecretRefs,
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantMembers).values({
      companyId: company.id,
      grantId: organizationGrant.id,
      subjectType: "user",
      subjectId: departing.principalId,
    });

    await accessService(db).archiveMember(company.id, departing.id, {
      reassignment: { assigneeUserId: owner.principalId },
    });

    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, secret.id)))
      .toHaveLength(1);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, organizationGrant.id)))
      .toEqual([expect.objectContaining({ status: "active", isDefault: true, credentialSecretRefs })]);
    expect(await db.select().from(connectionGrantMembers).where(eq(connectionGrantMembers.grantId, organizationGrant.id)))
      .toEqual([expect.objectContaining({ subjectId: departing.principalId })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({ status: "active", enabled: true, credentialSecretRefs })]);

    await accessService(db).setUserCompanyAccess(departing.principalId, [company.id]);

    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, secret.id)))
      .toHaveLength(1);
    expect(await db.select().from(companyMemberships).where(eq(companyMemberships.id, departing.id)))
      .toEqual([expect.objectContaining({ status: "active" })]);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, organizationGrant.id)))
      .toEqual([expect.objectContaining({ status: "active", credentialSecretRefs })]);
  });

  it("revokes delegated personal connection access when membership is suspended", async () => {
    const { company } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const agent = await db.insert(agents).values({
      companyId: company.id,
      name: "Delegated agent",
      role: "worker",
      adapterType: "process",
      adapterConfig: {},
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `app-${randomUUID()}`,
      name: "Personal mail",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Mail",
      uid: `mail-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "oauth",
      credentialPolicy: "per_user",
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      companyId: company.id,
      key: `oauth-${randomUUID()}`,
      name: "Personal OAuth token",
    }).returning().then((rows) => rows[0]!);
    const secret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: `OAuth ${randomUUID()}`,
    }).returning().then((rows) => rows[0]!);
    const grant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      credentialSecretRefs: [{ secretId: secret.id, configPath: "oauth.access_token" }],
    }).returning().then((rows) => rows[0]!);
    await db.insert(connectionGrantDelegations).values({
      companyId: company.id,
      grantId: grant.id,
      agentId: agent.id,
      createdByUserId: member.principalId,
    });

    await accessService(db).updateMember(company.id, member.id, { status: "suspended" });

    expect(await db.select().from(connectionGrantDelegations)).toHaveLength(0);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, secret.id))).toHaveLength(0);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
  });

  it("preserves personal grant secrets used by surviving declarations and bindings", async () => {
    const { company } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const application = await db.insert(toolApplications).values({
      companyId: company.id,
      applicationKey: `app-${randomUUID()}`,
      name: "Personal shared credentials",
      type: "mcp",
      status: "active",
    }).returning().then((rows) => rows[0]!);
    const definitions = await db.insert(userSecretDefinitions).values([
      { companyId: company.id, key: `agent-declared-${randomUUID()}`, name: "Agent-declared credential" },
      { companyId: company.id, key: `environment-declared-${randomUUID()}`, name: "Environment-declared credential" },
      { companyId: company.id, key: `bound-${randomUUID()}`, name: "Bound credential" },
    ]).returning();
    const secrets = await db.insert(companySecrets).values(definitions.map((definition, index) => ({
      companyId: company.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `shared-${index}-${randomUUID()}`,
      name: `Shared credential ${index}`,
    }))).returning();
    const connection = await db.insert(toolConnections).values({
      companyId: company.id,
      applicationId: application.id,
      name: "Shared personal connection",
      uid: `shared-${randomUUID()}`,
      connectionKind: "managed",
      ownership: "customer",
      transport: "mcp_remote",
      authKind: "api_key",
      credentialPolicy: "per_user",
      status: "active",
      enabled: true,
      credentialSecretRefs: secrets.map((secret, index) => ({
        secretId: secret.id,
        configPath: `credentials.shared_${index}`,
      })),
    }).returning().then((rows) => rows[0]!);
    const grant = await db.insert(connectionGrants).values({
      companyId: company.id,
      connectionId: connection.id,
      kind: "user",
      subjectUserId: member.principalId,
      credentialSecretRefs: secrets.map((secret, index) => ({
        secretId: secret.id,
        configPath: `credentials.shared_${index}`,
      })),
    }).returning().then((rows) => rows[0]!);
    await db.insert(userSecretDeclarations).values([
      {
        companyId: company.id,
        userSecretDefinitionId: definitions[0]!.id,
        targetType: "agent",
        targetId: `surviving-agent-${randomUUID()}`,
        configPath: "env.AGENT_TOKEN",
        envKey: "AGENT_TOKEN",
      },
      {
        companyId: company.id,
        userSecretDefinitionId: definitions[1]!.id,
        targetType: "environment",
        targetId: `surviving-environment-${randomUUID()}`,
        configPath: "env.ENVIRONMENT_TOKEN",
        envKey: "ENVIRONMENT_TOKEN",
      },
    ]);
    await db.insert(companySecretBindings).values([
      ...secrets.map((secret, index) => ({
        companyId: company.id,
        secretId: secret.id,
        targetType: "tool_connection",
        targetId: connection.id,
        configPath: `credentials.shared_${index}`,
      })),
      {
        companyId: company.id,
        secretId: secrets[2]!.id,
        targetType: "environment",
        targetId: `surviving-environment-${randomUUID()}`,
        configPath: "env.BOUND_TOKEN",
      },
    ]);

    await accessService(db).updateMember(company.id, member.id, { status: "suspended" });

    expect(await db.select().from(companySecrets).where(inArray(companySecrets.id, secrets.map((secret) => secret.id))))
      .toHaveLength(3);
    expect(await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))
      .toEqual([expect.objectContaining({ status: "revoked", credentialSecretRefs: [] })]);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.id, connection.id)))
      .toEqual([expect.objectContaining({
        status: "draft",
        enabled: false,
        credentialSecretRefs: [],
      })]);
    expect(await db.select().from(companySecretBindings)).toEqual([
      expect.objectContaining({
        secretId: secrets[2]!.id,
        targetType: "environment",
      }),
    ]);
    expect(await db.select().from(userSecretDeclarations)).toHaveLength(2);
  });

  it("preserves unrelated user-scoped secrets when membership is suspended", async () => {
    const { company } = await createCompanyWithOwner(db);
    const member = await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: `member-${randomUUID()}`,
      status: "active",
      membershipRole: "member",
    }).returning().then((rows) => rows[0]!);
    const definition = await db.insert(userSecretDefinitions).values({
      companyId: company.id,
      key: `oauth-${randomUUID()}`,
      name: "Personal OAuth token",
    }).returning().then((rows) => rows[0]!);
    const unrelatedSecret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "user",
      ownerUserId: member.principalId,
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: "Environment API key",
    }).returning().then((rows) => rows[0]!);
    const otherUserSecret = await db.insert(companySecrets).values({
      companyId: company.id,
      scope: "user",
      ownerUserId: "another-user",
      userSecretDefinitionId: definition.id,
      key: `oauth-${randomUUID()}`,
      name: "Another user's credential",
    }).returning().then((rows) => rows[0]!);

    await accessService(db).updateMember(company.id, member.id, { status: "suspended" });

    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, unrelatedSecret.id)))
      .toHaveLength(1);
    expect(await db.select().from(companySecrets).where(eq(companySecrets.id, otherUserSecret.id)))
      .toHaveLength(1);
  });

  it("allows owner and admin role-default grants to manage environments", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const access = accessService(db);
    const roles = ["admin", "operator", "viewer"] as const;
    const members = await db
      .insert(companyMemberships)
      .values(
        roles.map((role) => ({
          companyId: company.id,
          principalType: "user" as const,
          principalId: `${role}-${randomUUID()}`,
          status: "active" as const,
          membershipRole: role,
        })),
      )
      .returning();

    await access.setPrincipalGrants(
      company.id,
      "user",
      owner.principalId,
      grantsForHumanRole("owner"),
      owner.principalId,
    );
    for (const member of members) {
      await access.setPrincipalGrants(
        company.id,
        "user",
        member.principalId,
        grantsForHumanRole(member.membershipRole as "admin" | "operator" | "viewer"),
        owner.principalId,
      );
    }

    const admin = members.find((member) => member.membershipRole === "admin")!;
    const operator = members.find((member) => member.membershipRole === "operator")!;
    const viewer = members.find((member) => member.membershipRole === "viewer")!;

    await expect(access.canUser(company.id, owner.principalId, "environments:manage")).resolves.toBe(true);
    await expect(access.canUser(company.id, admin.principalId, "environments:manage")).resolves.toBe(true);
    await expect(access.canUser(company.id, operator.principalId, "environments:manage")).resolves.toBe(false);
    await expect(access.canUser(company.id, viewer.principalId, "environments:manage")).resolves.toBe(false);
  });

  it("initializes uninitialized human memberships without replacing custom grants", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const scopedEnvironmentGrant = { environmentId: "env-1" };
    const humanRows = await db
      .insert(companyMemberships)
      .values([
        {
          companyId: company.id,
          principalType: "user",
          principalId: `admin-${randomUUID()}`,
          status: "active",
          membershipRole: "admin",
        },
        {
          companyId: company.id,
          principalType: "user",
          principalId: `operator-${randomUUID()}`,
          status: "active",
          membershipRole: "operator",
        },
        {
          companyId: company.id,
          principalType: "user",
          principalId: `viewer-${randomUUID()}`,
          status: "active",
          membershipRole: "viewer",
        },
        {
          companyId: company.id,
          principalType: "user",
          principalId: `legacy-${randomUUID()}`,
          status: "active",
          membershipRole: null,
        },
      ])
      .returning();
    const admin = humanRows[0]!;
    const operator = humanRows[1]!;
    const viewer = humanRows[2]!;
    const legacyMember = humanRows[3]!;

    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: owner.principalId,
      permissionKey: "environments:manage",
      scope: scopedEnvironmentGrant,
      grantedByUserId: "custom-author",
    });

    const first = await backfillPrincipalAccessCompatibility(db);
    const second = await backfillPrincipalAccessCompatibility(db);

    expect(first.humanGrantsInserted).toBeGreaterThan(0);
    expect(second.humanGrantsInserted).toBe(0);
    await expect(accessService(db).canUser(company.id, admin.principalId, "environments:manage")).resolves.toBe(true);
    await expect(accessService(db).canUser(company.id, operator.principalId, "tasks:assign")).resolves.toBe(true);
    await expect(accessService(db).canUser(company.id, legacyMember.principalId, "tasks:assign")).resolves.toBe(true);
    await expect(accessService(db).canUser(company.id, viewer.principalId, "tasks:assign")).resolves.toBe(false);

    const ownerEnvironmentGrants = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, company.id),
          eq(principalPermissionGrants.principalId, owner.principalId),
          eq(principalPermissionGrants.permissionKey, "environments:manage"),
        ),
      );
    expect(ownerEnvironmentGrants).toHaveLength(1);
    expect(ownerEnvironmentGrants[0]?.scope).toEqual(scopedEnvironmentGrant);
    expect(ownerEnvironmentGrants[0]?.grantedByUserId).toBe("custom-author");
    const initializedRows = await db.select({ initializedAt: companyMemberships.permissionsInitializedAt })
      .from(companyMemberships).where(eq(companyMemberships.companyId, company.id));
    expect(initializedRows.length).toBeGreaterThan(0);
    expect(initializedRows.every(row => row.initializedAt instanceof Date)).toBe(true);
  });

  it("does not restore explicitly revoked role defaults on compatibility backfill", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const access = accessService(db);
    await ensureHumanRoleDefaultGrants(db, { companyId: company.id, principalId: owner.principalId,
      membershipRole: "owner", grantedByUserId: null });
    await expect(access.canUser(company.id, owner.principalId, "pipelines:write")).resolves.toBe(true);

    await access.setMemberPermissions(company.id, owner.id, [], "permission-manager");
    const backfill = await backfillPrincipalAccessCompatibility(db);
    expect(backfill.humanGrantsInserted).toBe(0);
    await expect(access.canUser(company.id, owner.principalId, "pipelines:write")).resolves.toBe(false);
    const [membership] = await db.select().from(companyMemberships).where(eq(companyMemberships.id, owner.id));
    expect(membership?.permissionsInitializedAt).toBeInstanceOf(Date);
  });

  it("preserves migrated historical owner grants without adding the new pipeline default", async () => {
    const { company } = await createCompanyWithOwner(db);
    const principalId = `historical-owner-${randomUUID()}`;
    await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId,
      status: "active", membershipRole: "owner", permissionsInitializedAt: new Date() });

    await backfillPrincipalAccessCompatibility(db);
    await expect(accessService(db).canUser(company.id, principalId, "pipelines:write")).resolves.toBe(false);
    const grants = await db.select().from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, company.id), eq(principalPermissionGrants.principalId, principalId),
    ));
    expect(grants).toHaveLength(0);
  });

  it("marks combined role and permission replacements initialized even when the grant set is empty", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    await ensureHumanRoleDefaultGrants(db, { companyId: company.id, principalId: owner.principalId,
      membershipRole: "owner", grantedByUserId: null });
    const [member] = await db.insert(companyMemberships).values({ companyId: company.id,
      principalType: "user", principalId: `operator-${randomUUID()}`, status: "active", membershipRole: "operator" })
      .returning();
    await ensureHumanRoleDefaultGrants(db, { companyId: company.id, principalId: member!.principalId,
      membershipRole: "operator", grantedByUserId: null });
    await expect(accessService(db).canUser(company.id, member!.principalId, "workflows:edit")).resolves.toBe(true);

    await accessService(db).updateMemberAndPermissions(company.id, member!.id,
      { membershipRole: "operator", grants: [] }, owner.principalId);
    expect(await db.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, company.id), eq(principalPermissionGrants.principalType, "user"),
      eq(principalPermissionGrants.principalId, member!.principalId),
    ))).toEqual([]);
    const backfill = await backfillPrincipalAccessCompatibility(db);
    expect(backfill.humanGrantsInserted).toBe(0);
    await expect(accessService(db).canUser(company.id, member!.principalId, "workflows:edit")).resolves.toBe(false);
    const [updated] = await db.select().from(companyMemberships).where(eq(companyMemberships.id, member!.id));
    expect(updated?.permissionsInitializedAt).toBeInstanceOf(Date);
  });

  it("keeps explicit empty principal grant replacements empty across compatibility backfill", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const access = accessService(db);
    await ensureHumanRoleDefaultGrants(db, { companyId: company.id, principalId: owner.principalId,
      membershipRole: "owner", grantedByUserId: null });
    await access.setPrincipalGrants(company.id, "user", owner.principalId, [], "permission-manager");

    const backfill = await backfillPrincipalAccessCompatibility(db);
    expect(backfill.humanGrantsInserted).toBe(0);
    await expect(access.canUser(company.id, owner.principalId, "pipelines:write")).resolves.toBe(false);
  });

  it("backfills non-terminal agents as active company members without reviving pending or terminated agents", async () => {
    const { company } = await createCompanyWithOwner(db);
    const agentRows = await db
      .insert(agents)
      .values([
        {
          companyId: company.id,
          name: `Idle ${randomUUID()}`,
          role: "engineer",
          status: "idle",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          companyId: company.id,
          name: `Running ${randomUUID()}`,
          role: "engineer",
          status: "running",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          companyId: company.id,
          name: `Pending ${randomUUID()}`,
          role: "engineer",
          status: "pending_approval",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
        {
          companyId: company.id,
          name: `Terminated ${randomUUID()}`,
          role: "engineer",
          status: "terminated",
          adapterType: "process",
          adapterConfig: {},
          runtimeConfig: {},
        },
      ])
      .returning();
    const idleAgent = agentRows[0]!;
    const runningAgent = agentRows[1]!;
    const pendingAgent = agentRows[2]!;
    const terminatedAgent = agentRows[3]!;

    const first = await backfillPrincipalAccessCompatibility(db);
    const second = await backfillPrincipalAccessCompatibility(db);

    expect(first.agentMembershipsInserted).toBe(2);
    expect(second.agentMembershipsInserted).toBe(0);
    const memberships = await db
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.principalType, "agent"));
    expect(memberships.map((membership) => membership.principalId).sort()).toEqual([
      idleAgent.id,
      runningAgent.id,
    ].sort());
    expect(memberships.every((membership) => membership.status === "active")).toBe(true);
    expect(memberships.every((membership) => membership.membershipRole === "member")).toBe(true);
    expect(memberships.some((membership) => membership.principalId === pendingAgent.id)).toBe(false);
    expect(memberships.some((membership) => membership.principalId === terminatedAgent.id)).toBe(false);
  });

  it("copies active user memberships with role-default grants for safe company imports", async () => {
    const source = await createCompanyWithOwner(db);
    const target = await createCompanyWithOwner(db);
    const admin = await db
      .insert(companyMemberships)
      .values({
        companyId: source.company.id,
        principalType: "user",
        principalId: `admin-${randomUUID()}`,
        status: "active",
        membershipRole: "admin",
      })
      .returning()
      .then((rows) => rows[0]!);

    const access = accessService(db);
    await access.copyActiveUserMemberships(source.company.id, target.company.id);

    const copiedOwnerGrants = await access.listPrincipalGrants(
      target.company.id,
      "user",
      source.owner.principalId,
    );
    const copiedAdminGrants = await access.listPrincipalGrants(
      target.company.id,
      "user",
      admin.principalId,
    );
    expect(copiedOwnerGrants.map((grant) => grant.permissionKey)).toEqual(
      grantsForHumanRole("owner").map((grant) => grant.permissionKey).sort(),
    );
    expect(copiedAdminGrants.map((grant) => grant.permissionKey)).toEqual(
      grantsForHumanRole("admin").map((grant) => grant.permissionKey).sort(),
    );
  });

  it("preserves explicit scoped environment grants when backfilling owner and admin defaults", async () => {
    const { company, owner } = await createCompanyWithOwner(db);
    const scopedGrant = { environmentId: "env-1" };
    await db.insert(principalPermissionGrants).values({
      companyId: company.id,
      principalType: "user",
      principalId: owner.principalId,
      permissionKey: "environments:manage",
      scope: scopedGrant,
      grantedByUserId: "custom-grant-author",
    });

    await db.execute(sql.raw(`
      INSERT INTO "principal_permission_grants" (
        "company_id",
        "principal_type",
        "principal_id",
        "permission_key",
        "scope",
        "granted_by_user_id",
        "created_at",
        "updated_at"
      )
      SELECT
        "company_id",
        'user',
        "principal_id",
        'environments:manage',
        NULL,
        NULL,
        now(),
        now()
      FROM "company_memberships"
      WHERE "principal_type" = 'user'
        AND "status" = 'active'
        AND "membership_role" IN ('owner', 'admin')
      ON CONFLICT (
        "company_id",
        "principal_type",
        "principal_id",
        "permission_key"
      ) DO NOTHING
    `));

    const grants = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, company.id),
          eq(principalPermissionGrants.principalId, owner.principalId),
          eq(principalPermissionGrants.permissionKey, "environments:manage"),
        ),
      );
    expect(grants).toHaveLength(1);
    expect(grants[0]?.scope).toEqual(scopedGrant);
    expect(grants[0]?.grantedByUserId).toBe("custom-grant-author");
  });
});
