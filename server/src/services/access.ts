import { and, asc, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  companyMemberships,
  humanWorkflowCoverages,
  activityLog,
  authUsers,
  accountDeletionOperations,
  companySecretBindings,
  companySecrets,
  connectionGrantDelegations,
  connectionGrantMembers,
  connectionGrants,
  instanceUserRoles,
  issues,
  routines,
  principalPermissionGrants,
  toolAccessAuditEvents,
  toolConnections,
  userSecretDeclarations,
  workflowRevisions,
  workflows,
} from "@paperclipai/db";
import type { CreateHumanWorkflowCoverage, HumanWorkflowCoverage, PermissionKey, PrincipalType } from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { assertAssignableAgent } from "./agent-assignability.js";
import { authorizationService, type AuthorizationActor, type AuthorizationResource } from "./authorization.js";
import { ensureHumanRoleDefaultGrants } from "./principal-access-compatibility.js";
import { routineService } from "./routines.js";
import { isUniqueViolation } from "../db-errors.js";

type MembershipRow = typeof companyMemberships.$inferSelect;
type GrantInput = {
  permissionKey: PermissionKey;
  scope?: Record<string, unknown> | null;
};

type MemberArchiveInput = {
  reassignment?: {
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
  } | null;
  routineResponsibleUserId?: string | null;
};

export function accessService(db: Db) {
  const authorization = authorizationService(db);

  function workflowCoverageActor(userId: string): AuthorizationActor {
    return { type: "board", source: "session", userId, ignoreInstanceAdmin: true };
  }

  async function assertWorkflowCoverageHumanRights(input: {
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0];
    companyId: string;
    principalUserId: string;
    delegateeUserId: string;
    workflowId: string;
    workflowRevisionId: string;
    scopeType: "manual" | "task";
    taskId: string | null;
  }) {
    if (input.principalUserId === input.delegateeUserId) {
      throw unprocessable("Workflow coverage must route to a different Human.", { code: "workflow_coverage_self_route" });
    }
    const userIds = [input.principalUserId, input.delegateeUserId];
    const currentUsers = await input.tx.select({ id: authUsers.id }).from(authUsers).where(and(
      inArray(authUsers.id, userIds),
      sql`not exists (select 1 from ${accountDeletionOperations} d where d.user_id = ${authUsers.id})`,
    )).for("share");
    if (currentUsers.length !== 2) {
      throw forbidden("Both workflow coverage principals must be current Human accounts.", { code: "workflow_coverage_human_unavailable" });
    }
    const memberships = await input.tx.select({ principalId: companyMemberships.principalId }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, input.companyId),
      eq(companyMemberships.principalType, "user"),
      inArray(companyMemberships.principalId, userIds),
      eq(companyMemberships.status, "active"),
    )).for("share");
    if (new Set(memberships.map((membership) => membership.principalId)).size !== 2) {
      throw forbidden("Both workflow coverage principals need active company membership.", { code: "workflow_coverage_membership_unavailable" });
    }

    const [workflow] = await input.tx.select({ status: workflows.status, publishedRevisionId: workflows.publishedRevisionId })
      .from(workflows).where(and(eq(workflows.companyId, input.companyId), eq(workflows.id, input.workflowId))).for("share");
    const [revision] = await input.tx.select({ state: workflowRevisions.state }).from(workflowRevisions).where(and(
      eq(workflowRevisions.companyId, input.companyId),
      eq(workflowRevisions.workflowId, input.workflowId),
      eq(workflowRevisions.id, input.workflowRevisionId),
    )).for("share");
    if (!workflow || workflow.status !== "active" || workflow.publishedRevisionId !== input.workflowRevisionId || revision?.state !== "published") {
      throw conflict("Coverage must name the currently published active workflow revision.", { code: "workflow_coverage_revision_changed" });
    }

    const scopedAuthorization = authorizationService(input.tx as unknown as Db);
    for (const userId of userIds) {
      const decision = await scopedAuthorization.decide({
        actor: workflowCoverageActor(userId),
        action: "workflows:run",
        resource: { type: "company", companyId: input.companyId },
      });
      if (!decision.allowed) {
        throw forbidden("Both workflow coverage principals must currently be authorized to run this workflow.", {
          code: "workflow_coverage_run_permission_unavailable", reason: decision.reason,
        });
      }
    }

    if (input.scopeType === "task" && input.taskId) {
      const [task] = await input.tx.select({ id: issues.id, companyId: issues.companyId, projectId: issues.projectId,
        parentId: issues.parentId, assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId,
        originKind: issues.originKind, originId: issues.originId, status: issues.status,
      }).from(issues).where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.taskId))).for("share");
      if (!task) throw notFound("Task not found");
      if (task.status === "done" || task.status === "cancelled") {
        throw conflict("Task is already terminal", { code: "workflow_task_not_active", issueId: task.id, status: task.status });
      }
      const taskResource: AuthorizationResource = {
        type: "issue", companyId: input.companyId, issueId: task.id, projectId: task.projectId,
        parentIssueId: task.parentId, assigneeAgentId: task.assigneeAgentId, assigneeUserId: task.assigneeUserId,
        originKind: task.originKind, originId: task.originId, status: task.status,
      };
      for (const userId of userIds) {
        const decision = await scopedAuthorization.decide({ actor: workflowCoverageActor(userId), action: "issue:mutate", resource: taskResource });
        if (!decision.allowed) {
          throw forbidden("Both workflow coverage principals need current Task access and mutation authority.", {
            code: "workflow_coverage_task_authority_unavailable", reason: decision.reason,
          });
        }
      }
    }
  }

  async function assertWorkflowCoverageCurrent(input: {
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0];
    companyId: string;
    coverageId: string;
    delegateeUserId: string;
    workflowId: string;
    workflowRevisionId: string;
    scopeType: "manual" | "task";
    taskId: string | null;
    now?: Date;
  }) {
    // Lock authorization owners before the coverage row. Member permission
    // updates and offboarding lock membership first, then revoke matching
    // coverage rows; matching that order prevents a claim/offboarding cycle.
    const [candidate] = await input.tx.select().from(humanWorkflowCoverages).where(and(
      eq(humanWorkflowCoverages.companyId, input.companyId), eq(humanWorkflowCoverages.id, input.coverageId),
    ));
    if (!candidate) {
      throw forbidden("Current Human workflow coverage is unavailable for this exact action.", { code: "workflow_coverage_unavailable" });
    }
    await assertWorkflowCoverageHumanRights({ tx: input.tx, companyId: input.companyId,
      principalUserId: candidate.principalUserId, delegateeUserId: candidate.delegateeUserId,
      workflowId: input.workflowId, workflowRevisionId: input.workflowRevisionId,
      scopeType: input.scopeType, taskId: input.taskId });

    const [coverage] = await input.tx.select().from(humanWorkflowCoverages).where(and(
      eq(humanWorkflowCoverages.companyId, input.companyId), eq(humanWorkflowCoverages.id, input.coverageId),
    )).for("update");
    const now = input.now ?? new Date();
    if (!coverage || coverage.revokedAt || coverage.startsAt > now || coverage.expiresAt <= now ||
      coverage.delegateeUserId !== input.delegateeUserId || coverage.workflowId !== input.workflowId ||
      coverage.workflowRevisionId !== input.workflowRevisionId || coverage.scopeType !== input.scopeType ||
      coverage.taskId !== input.taskId || coverage.principalUserId !== candidate.principalUserId ||
      coverage.delegateeUserId !== candidate.delegateeUserId) {
      throw forbidden("Current Human workflow coverage is unavailable for this exact action.", { code: "workflow_coverage_unavailable" });
    }
    return coverage;
  }

  async function sweepMemberConnectionAccess(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    companyId: string,
    userId: string,
    now: Date,
  ) {
    const departingAudienceRows = await tx.select({
      grantId: connectionGrantMembers.grantId,
    }).from(connectionGrantMembers).where(and(
      eq(connectionGrantMembers.companyId, companyId),
      eq(connectionGrantMembers.subjectType, "user"),
      eq(connectionGrantMembers.subjectId, userId),
    ));
    const departingAudienceGrantIds = [...new Set(departingAudienceRows.map((row) => row.grantId))];
    const affectedAudienceRows = departingAudienceGrantIds.length === 0 ? [] : await tx.select({
      grantId: connectionGrantMembers.grantId,
      subjectId: connectionGrantMembers.subjectId,
    }).from(connectionGrantMembers).where(and(
      eq(connectionGrantMembers.companyId, companyId),
      eq(connectionGrantMembers.subjectType, "user"),
      inArray(connectionGrantMembers.grantId, departingAudienceGrantIds),
    ));
    const activeOrganizationAudienceGrants = departingAudienceGrantIds.length === 0 ? [] : await tx.select({
      id: connectionGrants.id,
    }).from(connectionGrants).where(and(
      eq(connectionGrants.companyId, companyId),
      eq(connectionGrants.kind, "organization"),
      eq(connectionGrants.status, "active"),
      inArray(connectionGrants.id, departingAudienceGrantIds),
    ));
    const activeOrganizationAudienceGrantIds = new Set(activeOrganizationAudienceGrants.map((grant) => grant.id));
    const soleAudienceGrantIds = new Set(departingAudienceGrantIds.filter((grantId) =>
      activeOrganizationAudienceGrantIds.has(grantId)
      && affectedAudienceRows.filter((row) => row.grantId === grantId).length === 1,
    ));

    const ownedGrants = await tx.select({
      id: connectionGrants.id,
      connectionId: connectionGrants.connectionId,
      credentialSecretRefs: connectionGrants.credentialSecretRefs,
    }).from(connectionGrants).where(and(
      eq(connectionGrants.companyId, companyId),
      eq(connectionGrants.kind, "user"),
      eq(connectionGrants.subjectUserId, userId),
    ));
    const grantIds = ownedGrants.map((grant) => grant.id);
    const ownedGrantIds = new Set(grantIds);
    const affectedConnectionIds = [...new Set(ownedGrants.map((grant) => grant.connectionId))];
    const affectedConnections = new Set(affectedConnectionIds);
    // Membership removal revokes personal connection identities. It must not
    // erase unrelated user-scoped values used by agent or environment secret
    // declarations or bindings. Start with only secrets the departing user's
    // grants explicitly reference, then fail toward retention whenever another
    // consumer still names the secret or its user-secret definition.
    const referencedSecretIds = [...new Set(ownedGrants.flatMap((grant) =>
      grant.credentialSecretRefs.map((ref) => ref.secretId),
    ))];
    const ownedSecrets = referencedSecretIds.length === 0 ? [] : await tx.select({
      id: companySecrets.id,
      userSecretDefinitionId: companySecrets.userSecretDefinitionId,
    }).from(companySecrets).where(and(
      eq(companySecrets.companyId, companyId),
      eq(companySecrets.scope, "user"),
      eq(companySecrets.ownerUserId, userId),
      inArray(companySecrets.id, referencedSecretIds),
    ));
    const ownedSecretIds = ownedSecrets.map((secret) => secret.id);
    const ownedSecretSet = new Set(ownedSecretIds);
    const retainedSecretIds = new Set<string>();
    const sharedConnectionSecretIds = new Set<string>();
    let grantMemberRefs: Array<{ grantId: string; subjectId: string }> = [];
    let existingMemberUserIds = new Set<string>();
    let grantRefs: Array<{
      id: string;
      connectionId: string;
      kind: typeof connectionGrants.$inferSelect.kind;
      status: typeof connectionGrants.$inferSelect.status;
      credentialSecretRefs: typeof connectionGrants.$inferSelect.credentialSecretRefs;
    }> = [];
    let connectionRefs: Array<{
      id: string;
      credentialRefs: typeof toolConnections.$inferSelect.credentialRefs;
      credentialSecretRefs: typeof toolConnections.$inferSelect.credentialSecretRefs;
    }> = [];
    if (ownedSecretIds.length > 0) {
      const definitionIds = ownedSecrets.flatMap((secret) =>
        secret.userSecretDefinitionId ? [secret.userSecretDefinitionId] : [],
      );
      const [
        bindingRefs,
        declarationRefs,
        allGrantRefs,
        allConnectionRefs,
        allGrantMemberRefs,
        membershipRefs,
      ] = await Promise.all([
        tx.select({
          secretId: companySecretBindings.secretId,
          targetType: companySecretBindings.targetType,
          targetId: companySecretBindings.targetId,
        }).from(companySecretBindings).where(and(
          eq(companySecretBindings.companyId, companyId),
          inArray(companySecretBindings.secretId, ownedSecretIds),
        )),
        definitionIds.length === 0 ? Promise.resolve([]) : tx.select({
          userSecretDefinitionId: userSecretDeclarations.userSecretDefinitionId,
        }).from(userSecretDeclarations).where(and(
          eq(userSecretDeclarations.companyId, companyId),
          inArray(userSecretDeclarations.userSecretDefinitionId, definitionIds),
        )),
        tx.select({
          id: connectionGrants.id,
          connectionId: connectionGrants.connectionId,
          kind: connectionGrants.kind,
          status: connectionGrants.status,
          credentialSecretRefs: connectionGrants.credentialSecretRefs,
        }).from(connectionGrants).where(eq(connectionGrants.companyId, companyId)),
        tx.select({
          id: toolConnections.id,
          credentialRefs: toolConnections.credentialRefs,
          credentialSecretRefs: toolConnections.credentialSecretRefs,
        }).from(toolConnections).where(eq(toolConnections.companyId, companyId)),
        tx.select({
          grantId: connectionGrantMembers.grantId,
          subjectId: connectionGrantMembers.subjectId,
        }).from(connectionGrantMembers).where(and(
          eq(connectionGrantMembers.companyId, companyId),
          eq(connectionGrantMembers.subjectType, "user"),
        )),
        tx.select({ userId: companyMemberships.principalId }).from(companyMemberships).where(and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          ne(companyMemberships.principalId, userId),
        )),
      ]);
      grantRefs = allGrantRefs;
      connectionRefs = allConnectionRefs;
      grantMemberRefs = allGrantMemberRefs;
      existingMemberUserIds = new Set(membershipRefs.map((row) => row.userId));

      for (const binding of bindingRefs) {
        if (binding.targetType !== "tool_connection" || !affectedConnections.has(binding.targetId)) {
          retainedSecretIds.add(binding.secretId);
        }
      }
      const declaredDefinitions = new Set(declarationRefs.map((row) => row.userSecretDefinitionId));
      for (const secret of ownedSecrets) {
        if (secret.userSecretDefinitionId && declaredDefinitions.has(secret.userSecretDefinitionId)) {
          retainedSecretIds.add(secret.id);
        }
      }
      for (const grant of grantRefs) {
        if (ownedGrantIds.has(grant.id)) continue;
        const grantAudience = grantMemberRefs.filter((member) => member.grantId === grant.id);
        const remainingGrantAudience = grantAudience.filter((member) => member.subjectId !== userId);
        const hasSurvivingOrganizationAudience = grant.kind === "organization"
          && grant.status === "active"
          && (
            soleAudienceGrantIds.has(grant.id)
              ? true
              : remainingGrantAudience.length === 0
              ? existingMemberUserIds.size > 0
              : remainingGrantAudience.some((member) => existingMemberUserIds.has(member.subjectId))
          );
        for (const ref of grant.credentialSecretRefs) {
          if (!ownedSecretSet.has(ref.secretId)) continue;
          if (!affectedConnections.has(grant.connectionId)) {
            retainedSecretIds.add(ref.secretId);
          } else if (grant.kind === "user" || hasSurvivingOrganizationAudience) {
            // A connection may temporarily carry separate user grants that
            // reference the same credential, or an organization grant may
            // still have another persisted audience member. A sole named
            // audience row stays persisted instead of being widened to company
            // scope; both resolvers require current active membership, so the
            // row remains dormant until company access is restored. Pending,
            // suspended, and archived memberships are intentionally included
            // because company access can reactivate each of them later.
            retainedSecretIds.add(ref.secretId);
            sharedConnectionSecretIds.add(ref.secretId);
          }
        }
      }
      for (const connection of connectionRefs) {
        if (affectedConnections.has(connection.id)) continue;
        for (const ref of [...connection.credentialRefs, ...connection.credentialSecretRefs]) {
          if (ownedSecretSet.has(ref.secretId)) retainedSecretIds.add(ref.secretId);
        }
      }
    }
    const secretIdsToDelete = ownedSecretIds.filter((secretId) => !retainedSecretIds.has(secretId));
    const connectionSecretIdsToRemove = new Set(
      ownedSecretIds.filter((secretId) => !sharedConnectionSecretIds.has(secretId)),
    );
    const removedDelegations = grantIds.length === 0 ? [] : await tx
      .delete(connectionGrantDelegations)
      .where(and(
        eq(connectionGrantDelegations.companyId, companyId),
        inArray(connectionGrantDelegations.grantId, grantIds),
      ))
      .returning();
    if (grantIds.length > 0) {
      await tx.update(connectionGrants).set({
        status: "revoked",
        isDefault: false,
        revokedAt: now,
        revokedByUserId: null,
        revokedByAgentId: null,
        updatedAt: now,
      }).where(and(
        eq(connectionGrants.companyId, companyId),
        inArray(connectionGrants.id, grantIds),
      ));
    }
    if (ownedSecretIds.length > 0) {
      for (const grant of grantRefs) {
        if (!ownedGrantIds.has(grant.id) && !affectedConnections.has(grant.connectionId)) continue;
        const refsToRemove = ownedGrantIds.has(grant.id) ? ownedSecretSet : connectionSecretIdsToRemove;
        const credentialSecretRefs = grant.credentialSecretRefs.filter(
          (ref) => !refsToRemove.has(ref.secretId),
        );
        if (credentialSecretRefs.length !== grant.credentialSecretRefs.length) {
          await tx.update(connectionGrants).set({
            credentialSecretRefs,
            ...(ownedGrantIds.has(grant.id) || grant.status === "revoked" ? {
              status: "revoked" as const,
              isDefault: false,
            } : {
              status: "needs_reauthorization" as const,
              isDefault: false,
            }),
            updatedAt: now,
          })
            .where(eq(connectionGrants.id, grant.id));
        }
      }
      for (const connection of connectionRefs) {
        if (!affectedConnections.has(connection.id)) continue;
        const credentialRefs = connection.credentialRefs.filter(
          (ref) => !connectionSecretIdsToRemove.has(ref.secretId),
        );
        const credentialSecretRefs = connection.credentialSecretRefs.filter(
          (ref) => !connectionSecretIdsToRemove.has(ref.secretId),
        );
        if (
          credentialRefs.length !== connection.credentialRefs.length ||
          credentialSecretRefs.length !== connection.credentialSecretRefs.length
        ) {
          const hasUnaffectedActiveGrant = grantRefs.some((grant) =>
            grant.connectionId === connection.id
            && !ownedGrantIds.has(grant.id)
            && grant.status === "active"
            && grant.credentialSecretRefs.length > 0
            && grant.credentialSecretRefs.every((ref) => !connectionSecretIdsToRemove.has(ref.secretId)),
          );
          await tx.update(toolConnections).set({
            credentialRefs,
            credentialSecretRefs,
            ...(!hasUnaffectedActiveGrant ? {
              status: "draft" as const,
              enabled: false,
              healthStatus: "missing_secret" as const,
              healthMessage: "Personal credential owner no longer has company access. Reauthorize this connection.",
              lastError: "oauth_reauthorization_required",
            } : {}),
            updatedAt: now,
          })
            .where(eq(toolConnections.id, connection.id));
        }
      }
      if (affectedConnectionIds.length > 0 && connectionSecretIdsToRemove.size > 0) {
        await tx.delete(companySecretBindings).where(and(
          eq(companySecretBindings.companyId, companyId),
          eq(companySecretBindings.targetType, "tool_connection"),
          inArray(companySecretBindings.targetId, affectedConnectionIds),
          inArray(companySecretBindings.secretId, [...connectionSecretIdsToRemove]),
        ));
      }
      if (secretIdsToDelete.length > 0) {
        await tx.delete(companySecrets).where(and(
          eq(companySecrets.companyId, companyId),
          inArray(companySecrets.id, secretIdsToDelete),
        ));
      }
    }
    await tx.delete(connectionGrantMembers).where(and(
      eq(connectionGrantMembers.companyId, companyId),
      eq(connectionGrantMembers.subjectType, "user"),
      eq(connectionGrantMembers.subjectId, userId),
      soleAudienceGrantIds.size > 0
        ? notInArray(connectionGrantMembers.grantId, [...soleAudienceGrantIds])
        : undefined,
    ));
    if (removedDelegations.length > 0) {
      const connectionByGrant = new Map(ownedGrants.map((grant) => [grant.id, grant.connectionId]));
      await tx.insert(toolAccessAuditEvents).values(removedDelegations.map((delegation) => ({
        companyId,
        connectionId: connectionByGrant.get(delegation.grantId) ?? null,
        actorType: "system",
        actorId: null,
        action: "connection_grant.delegation_revoked",
        outcome: "success",
        reasonCode: "membership_removed",
        details: {
          grantId: delegation.grantId,
          delegationId: delegation.id,
          agentId: delegation.agentId,
          ownerUserId: userId,
        },
      })));
    }
  }

  async function pauseActiveOwnedRoutinesForWithdrawal(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    companyId: string,
    userId: string,
    actorUserId: string | null | undefined,
  ) {
    const owned = await tx
      .select({ id: routines.id, originKind: routines.originKind })
      .from(routines)
      .where(and(
        eq(routines.companyId, companyId),
        eq(routines.responsibleUserId, userId),
        eq(routines.status, "active"),
      ))
      .for("update");
    if (owned.length === 0) return 0;

    const service = routineService(db);
    const actorId = actorUserId ?? "system";
    for (const routine of owned) {
      await service.pauseForResponsibleUserOffboardingInTransaction(
        tx as unknown as Db,
        companyId,
        routine.id,
        userId,
        { userId: actorId },
      );
      await tx.insert(activityLog).values({
        companyId,
        actorType: "user",
        actorId,
        action: "routine.paused_for_responsible_user_offboarding",
        entityType: "routine",
        entityId: routine.id,
        responsibleUserId: userId,
        details: { privateSourcePreserved: routine.originKind === "conversation_draft" },
      });
    }
    return owned.length;
  }

  async function isInstanceAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const row = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function getMembership(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
  ): Promise<MembershipRow | null> {
    return db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, principalType),
          eq(companyMemberships.principalId, principalId),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function hasPermission(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    return authorization.decidePrincipalGrant({
      companyId,
      principalType,
      principalId,
      permissionKey,
      action: permissionKey,
    }).then((decision) => decision.allowed);
  }

  async function canUser(
    companyId: string,
    userId: string | null | undefined,
    permissionKey: PermissionKey,
  ): Promise<boolean> {
    return authorization.decide({
      actor: { type: "board", userId },
      action: permissionKey,
      resource: { type: "company", companyId },
    }).then((decision) => decision.allowed);
  }

  async function decide(input: {
    actor: AuthorizationActor;
    action: Parameters<typeof authorization.decide>[0]["action"];
    resource: AuthorizationResource;
    scope?: Record<string, unknown> | null;
    enforceResponsibleUserIntersection?: boolean;
  }) {
    return authorization.decide(input);
  }

  async function listMembers(companyId: string) {
    return db
      .select()
      .from(companyMemberships)
      .where(eq(companyMemberships.companyId, companyId))
      .orderBy(sql`${companyMemberships.createdAt} desc`);
  }

  async function searchMembers(companyId: string, actor: AuthorizationActor, query: string, limit = 20) {
    const decision = await authorization.decide({
      actor,
      action: "users:manage_permissions",
      resource: { type: "company", companyId },
    });
    if (!decision.allowed) throw forbidden("Company members are outside this actor's authorization boundary");
    const escaped = query.replace(/[\\%_]/g, (value) => `\\${value}`);
    const pattern = `%${escaped}%`;
    const rows = await db.select({
      id: authUsers.id,
      name: authUsers.name,
      email: authUsers.email,
      updatedAt: companyMemberships.updatedAt,
    }).from(companyMemberships)
      .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
      .where(and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.status, "active"),
        or(ilike(authUsers.name, pattern), ilike(authUsers.email, pattern)),
      ))
      .orderBy(desc(companyMemberships.updatedAt), asc(authUsers.name), asc(authUsers.id))
      .limit(Math.min(100, Math.max(1, limit)) + 1);
    return { items: rows.slice(0, limit), partial: rows.length > limit };
  }

  async function getMemberById(companyId: string, memberId: string) {
    return db
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, memberId)))
      .then((rows) => rows[0] ?? null);
  }

  async function listActiveUserMemberships(companyId: string) {
    return db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
        ),
      )
      .orderBy(sql`${companyMemberships.createdAt} asc`);
  }

  async function setMemberPermissions(
    companyId: string,
    memberId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    return db.transaction(async (tx) => {
      const [member] = await tx.select().from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, memberId),
      )).for("update");
      if (!member) return null;
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, member.principalType),
            eq(principalPermissionGrants.principalId, member.principalId),
          ),
        );
      if (grants.length > 0) {
        await tx.insert(principalPermissionGrants).values(
          grants.map((grant) => ({
            companyId,
            principalType: member.principalType,
            principalId: member.principalId,
            permissionKey: grant.permissionKey,
            scope: grant.scope ?? null,
            grantedByUserId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        );
      }
      await tx.update(companyMemberships).set({ permissionsInitializedAt: new Date(), updatedAt: new Date() })
        .where(eq(companyMemberships.id, member.id));
      return member;
    });
  }

  async function updateMemberAndPermissions(
    companyId: string,
    memberId: string,
    data: {
      membershipRole?: string | null;
      status?: "pending" | "active" | "suspended";
      grants: GrantInput[];
    },
    grantedByUserId: string | null,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${companyMemberships.id}
        from ${companyMemberships}
        where ${companyMemberships.companyId} = ${companyId}
          and ${companyMemberships.principalType} = 'user'
          and ${companyMemberships.status} = 'active'
          and ${companyMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, memberId)))
        .for("update")
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextMembershipRole =
        data.membershipRole !== undefined ? data.membershipRole : existing.membershipRole;
      const nextStatus = data.status ?? existing.status;

      if (
        existing.principalType === "user" &&
        existing.status === "active" &&
        existing.membershipRole === "owner" &&
        (nextStatus !== "active" || nextMembershipRole !== "owner")
      ) {
        const activeOwnerCount = await tx
          .select({ id: companyMemberships.id })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.status, "active"),
              eq(companyMemberships.membershipRole, "owner"),
            ),
          )
          .then((rows) => rows.length);
        if (activeOwnerCount <= 1) {
          throw conflict("Cannot remove the last active owner");
        }
      }

      const now = new Date();
      if (existing.status === "active" && nextStatus !== "active" && existing.principalType === "user") {
        await sweepMemberConnectionAccess(tx, companyId, existing.principalId, now);
        await pauseActiveOwnedRoutinesForWithdrawal(tx, companyId, existing.principalId, grantedByUserId);
        await revokeWorkflowCoveragesForMember(tx, companyId, existing.principalId, grantedByUserId, now);
      }
      const updated = await tx
        .update(companyMemberships)
        .set({
          membershipRole: nextMembershipRole,
          status: nextStatus,
          permissionsInitializedAt: now,
          updatedAt: now,
        })
        .where(eq(companyMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);

      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, existing.principalType),
            eq(principalPermissionGrants.principalId, existing.principalId),
          ),
        );
      if (data.grants.length > 0) {
        await tx.insert(principalPermissionGrants).values(
          data.grants.map((grant) => ({
            companyId,
            principalType: existing.principalType,
            principalId: existing.principalId,
            permissionKey: grant.permissionKey,
            scope: grant.scope ?? null,
            grantedByUserId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return updated;
    });
  }

  async function assertCanRemoveActiveOwner(
    companyId: string,
    principalType: PrincipalType,
    status: string,
    membershipRole: string | null,
    tx: Pick<Db, "select">,
  ) {
    if (
      principalType !== "user" ||
      status !== "active" ||
      membershipRole !== "owner"
    ) {
      return;
    }

    const activeOwnerCount = await tx
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
          eq(companyMemberships.membershipRole, "owner"),
        ),
      )
      .then((rows) => rows.length);
    if (activeOwnerCount <= 1) {
      throw conflict("Cannot remove the last active owner");
    }
  }

  async function assertAssignableArchiveTarget(
    companyId: string,
    input: MemberArchiveInput["reassignment"],
    tx: Pick<Db, "select">,
  ) {
    if (!input?.assigneeAgentId && !input?.assigneeUserId) return;
    if (input.assigneeAgentId && input.assigneeUserId) {
      throw conflict("Choose either an agent or user reassignment target");
    }
    if (input.assigneeUserId) {
      const membership = await tx
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, input.assigneeUserId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!membership) {
        throw conflict("Replacement user must be an active company member");
      }
      return;
    }

    await assertAssignableAgent(tx as Db, companyId, input.assigneeAgentId, { kind: "work" });
  }

  async function archiveMember(companyId: string, memberId: string, input: MemberArchiveInput = {}, actorUserId = "system") {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${companyMemberships.id}
        from ${companyMemberships}
        where ${companyMemberships.companyId} = ${companyId}
          and ${companyMemberships.principalType} = 'user'
          and ${companyMemberships.status} = 'active'
          and ${companyMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, memberId)))
        .for("update")
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;
      if (existing.principalType !== "user") {
        throw conflict("Only human company members can be archived");
      }
      if (existing.status === "archived") {
        return {
          member: existing,
          reassignedIssueCount: 0,
          reassignedRoutineCount: 0,
          pausedRoutineCount: 0,
          ownerActionRoutineCount: 0,
        };
      }
      if (input.reassignment?.assigneeUserId === existing.principalId) {
        throw conflict("Replacement user cannot be the archived member");
      }

      await assertCanRemoveActiveOwner(
        companyId,
        existing.principalType,
        existing.status,
        existing.membershipRole,
        tx,
      );
      await assertAssignableArchiveTarget(companyId, input.reassignment, tx);

      const ownedRoutines = await tx
        .select({ id: routines.id, originKind: routines.originKind, status: routines.status })
        .from(routines)
        .where(and(
          eq(routines.companyId, companyId),
          eq(routines.responsibleUserId, existing.principalId),
          inArray(routines.status, ["active", "paused"]),
        ))
        .for("update");
      let routineReplacementUserId: string | null = null;
      if (input.routineResponsibleUserId && input.routineResponsibleUserId !== existing.principalId) {
        const replacement = await tx
          .select({ id: companyMemberships.id, userId: authUsers.id })
          .from(companyMemberships)
          .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
          .where(and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, input.routineResponsibleUserId),
            eq(companyMemberships.status, "active"),
          ))
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (replacement) routineReplacementUserId = replacement.userId;
      }

      const now = new Date();
      await sweepMemberConnectionAccess(tx, companyId, existing.principalId, now);
      await revokeWorkflowCoveragesForMember(tx, companyId, existing.principalId, actorUserId, now);
      const assignmentPatch = {
        assigneeAgentId: input.reassignment?.assigneeAgentId ?? null,
        assigneeUserId: input.reassignment?.assigneeUserId ?? null,
        updatedAt: now,
      };
      const assignedOpenIssueWhere = and(
        eq(issues.companyId, companyId),
        eq(issues.assigneeUserId, existing.principalId),
        sql`${issues.status} not in ('done', 'cancelled')`,
      );
      const resetInProgress = await tx
        .update(issues)
        .set({
          ...assignmentPatch,
          status: "todo",
          startedAt: null,
          checkoutRunId: null,
          executionRunId: null,
          executionLockedAt: null,
        })
        .where(and(assignedOpenIssueWhere, eq(issues.status, "in_progress")))
        .returning({ id: issues.id });
      const reassigned = await tx
        .update(issues)
        .set(assignmentPatch)
        .where(and(assignedOpenIssueWhere, ne(issues.status, "in_progress")))
        .returning({ id: issues.id });

      let reassignedRoutineCount = 0;
      let pausedRoutineCount = 0;
      let ownerActionRoutineCount = 0;
      const routinesSvc = ownedRoutines.length > 0 ? routineService(db) : null;
      for (const routine of ownedRoutines) {
        const txDb = tx as unknown as Db;
        if (routine.originKind === "conversation_draft") {
          if (routine.status === "active") {
            await routinesSvc!.pauseForResponsibleUserOffboardingInTransaction(
              txDb, companyId, routine.id, existing.principalId, { userId: actorUserId },
            );
            pausedRoutineCount++;
            await tx.insert(activityLog).values({
              companyId,
              actorType: "user",
              actorId: actorUserId,
              action: "routine.paused_for_responsible_user_offboarding",
              entityType: "routine",
              entityId: routine.id,
              responsibleUserId: existing.principalId,
              details: { privateSourcePreserved: true },
            });
          }
          ownerActionRoutineCount++;
          continue;
        }
        if (routineReplacementUserId) {
          await routinesSvc!.transferResponsibilityInTransaction(
            txDb,
            companyId,
            routine.id,
            existing.principalId,
            routineReplacementUserId,
            { userId: actorUserId },
          );
          await tx.insert(activityLog).values({
            companyId,
            actorType: "user",
            actorId: actorUserId,
            action: "routine.responsibility_transferred",
            entityType: "routine",
            entityId: routine.id,
            responsibleUserId: routineReplacementUserId,
            details: { previousResponsibleUserId: existing.principalId },
          });
          reassignedRoutineCount++;
          continue;
        }
        if (routine.status === "active") {
          await routinesSvc!.pauseForResponsibleUserOffboardingInTransaction(
            txDb, companyId, routine.id, existing.principalId, { userId: actorUserId },
          );
          pausedRoutineCount++;
          await tx.insert(activityLog).values({
            companyId,
            actorType: "user",
            actorId: actorUserId,
            action: "routine.paused_for_responsible_user_offboarding",
            entityType: "routine",
            entityId: routine.id,
            responsibleUserId: existing.principalId,
            details: { privateSourcePreserved: false },
          });
        }
        ownerActionRoutineCount++;
      }

      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, existing.principalType),
            eq(principalPermissionGrants.principalId, existing.principalId),
          ),
        );

      const archived = await tx
        .update(companyMemberships)
        .set({
          status: "archived",
          updatedAt: now,
        })
        .where(eq(companyMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);

      return {
        member: archived,
        reassignedIssueCount: resetInProgress.length + reassigned.length,
        reassignedRoutineCount,
        pausedRoutineCount,
        ownerActionRoutineCount,
      };
    });
  }

  async function promoteInstanceAdmin(userId: string) {
    const existing = await db
      .select()
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;
    return db
      .insert(instanceUserRoles)
      .values({
        userId,
        role: "instance_admin",
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function demoteInstanceAdmin(userId: string) {
    return db
      .delete(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function listUserCompanyAccess(userId: string) {
    return db
      .select()
      .from(companyMemberships)
      .where(and(eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId)))
      .orderBy(sql`${companyMemberships.createdAt} desc`);
  }

  async function setUserCompanyAccess(
    userId: string,
    companyIds: string[],
    options: { actorUserId?: string | null } = {},
  ) {
    const target = new Set(companyIds);

    await db.transaction(async (tx) => {
      // Serialize every company-access removal/reactivation with personal OAuth
      // completion, which locks the same membership row before writing secrets.
      const existing = await tx
        .select()
        .from(companyMemberships)
        .where(and(eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId)))
        .for("update");
      const existingByCompany = new Map(existing.map((row) => [row.companyId, row]));
      const toArchive = existing.filter((row) => !target.has(row.companyId) && row.status !== "archived");
      if (toArchive.length > 0 && options.actorUserId && options.actorUserId === userId) {
        throw conflict("You cannot remove yourself");
      }
      if (toArchive.length > 0 && (await isInstanceAdmin(userId))) {
        throw conflict("Instance admins cannot be removed from company access");
      }
      const protectedArchives = toArchive.filter((row) => row.membershipRole === "owner" || row.membershipRole === "admin");
      if (protectedArchives.length > 0) {
        throw conflict("Owners and admins cannot be removed from company access");
      }
      const activeOwnerArchives = toArchive.filter(
        (row) => row.status === "active" && row.membershipRole === "owner",
      );
      if (activeOwnerArchives.length > 0) {
        const activeOwnerRows = await tx
          .select({ companyId: companyMemberships.companyId, id: companyMemberships.id })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.status, "active"),
              eq(companyMemberships.membershipRole, "owner"),
              inArray(companyMemberships.companyId, activeOwnerArchives.map((row) => row.companyId)),
            ),
          );
        for (const row of activeOwnerArchives) {
          const remainingOwners =
            activeOwnerRows.filter((owner) => owner.companyId === row.companyId).length - 1;
          if (remainingOwners <= 0) {
            throw conflict("Cannot remove the last active owner");
          }
        }
      }
      if (toArchive.length > 0) {
        const now = new Date();
        for (const membership of toArchive) {
          await sweepMemberConnectionAccess(tx, membership.companyId, membership.principalId, now);
          await pauseActiveOwnedRoutinesForWithdrawal(
            tx,
            membership.companyId,
            membership.principalId,
            options.actorUserId,
          );
          await revokeWorkflowCoveragesForMember(tx, membership.companyId, membership.principalId, options.actorUserId ?? null, now);
        }
        await tx
          .update(companyMemberships)
          .set({ status: "archived", updatedAt: now })
          .where(inArray(companyMemberships.id, toArchive.map((row) => row.id)));
        await tx
          .delete(principalPermissionGrants)
          .where(
            and(
              eq(principalPermissionGrants.principalType, "user"),
              eq(principalPermissionGrants.principalId, userId),
              inArray(principalPermissionGrants.companyId, toArchive.map((row) => row.companyId)),
            ),
          );
      }

      for (const companyId of target) {
        const existingMembership = existingByCompany.get(companyId);
        if (existingMembership) {
          if (existingMembership.status !== "active") {
            await tx
              .update(companyMemberships)
              .set({
                status: "active",
                membershipRole: existingMembership.membershipRole ?? "operator",
                updatedAt: new Date(),
              })
              .where(eq(companyMemberships.id, existingMembership.id));
          }
          continue;
        }
        await tx.insert(companyMemberships).values({
          companyId,
          principalType: "user",
          principalId: userId,
          status: "active",
          membershipRole: "operator",
        });
      }
    });

    return listUserCompanyAccess(userId);
  }

  async function ensureMembership(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    membershipRole: string | null = "member",
    status: "pending" | "active" | "suspended" = "active",
  ) {
    const existing = await getMembership(companyId, principalType, principalId);
    if (existing) {
      if (existing.status !== status || existing.membershipRole !== membershipRole) {
        const updated = await db
          .update(companyMemberships)
          .set({ status, membershipRole, updatedAt: new Date() })
          .where(eq(companyMemberships.id, existing.id))
          .returning()
          .then((rows) => rows[0] ?? null);
        return updated ?? existing;
      }
      return existing;
    }

    return db
      .insert(companyMemberships)
      .values({
        companyId,
        principalType,
        principalId,
        status,
        membershipRole,
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function setPrincipalGrants(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    grants: GrantInput[],
    grantedByUserId: string | null,
  ) {
    await db.transaction(async (tx) => {
      const now = new Date();
      if (principalType === "user") {
        const [membership] = await tx.select({ id: companyMemberships.id })
          .from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, principalId)))
          .for("update");
        if (membership) await tx.update(companyMemberships)
          .set({ permissionsInitializedAt: now, updatedAt: now }).where(eq(companyMemberships.id, membership.id));
      }
      await tx
        .delete(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, principalType),
            eq(principalPermissionGrants.principalId, principalId),
          ),
        );
      if (grants.length === 0) return;
      await tx.insert(principalPermissionGrants).values(
        grants.map((grant) => ({
          companyId,
          principalType,
          principalId,
          permissionKey: grant.permissionKey,
          scope: grant.scope ?? null,
          grantedByUserId,
          createdAt: now,
          updatedAt: now,
        })),
      );
    });
  }

  async function copyActiveUserMemberships(sourceCompanyId: string, targetCompanyId: string) {
    const sourceMemberships = await listActiveUserMemberships(sourceCompanyId);
    for (const membership of sourceMemberships) {
      await ensureMembership(
        targetCompanyId,
        "user",
        membership.principalId,
        membership.membershipRole,
        "active",
      );
      await ensureHumanRoleDefaultGrants(db, {
        companyId: targetCompanyId,
        principalId: membership.principalId,
        membershipRole: membership.membershipRole,
        grantedByUserId: null,
      });
    }
    return sourceMemberships;
  }

  async function ensureRoleDefaultGrants(
    companyId: string,
    principalId: string,
    membershipRole: string | null | undefined,
    grantedByUserId: string | null,
  ) {
    return ensureHumanRoleDefaultGrants(db, {
      companyId,
      principalId,
      membershipRole,
      grantedByUserId,
    });
  }

  async function listPrincipalGrants(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
  ) {
    return db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
        ),
      )
      .orderBy(principalPermissionGrants.permissionKey);
  }

  async function setPrincipalPermission(
    companyId: string,
    principalType: PrincipalType,
    principalId: string,
    permissionKey: PermissionKey,
    enabled: boolean,
    grantedByUserId: string | null,
    scope: Record<string, unknown> | null = null,
  ) {
    if (!enabled) {
      if (principalType === "user") {
        const membership = await getMembership(companyId, "user", principalId);
        if (membership) await ensureHumanRoleDefaultGrants(db, { companyId, principalId,
          membershipRole: membership.membershipRole, grantedByUserId: null });
      }
      await db.transaction(async tx => {
        const [membership] = principalType === "user" ? await tx.select({ id: companyMemberships.id })
          .from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, principalId)))
          .for("update") : [];
        await tx.delete(principalPermissionGrants).where(and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ));
        if (membership) await tx.update(companyMemberships).set({ permissionsInitializedAt: new Date() })
          .where(and(eq(companyMemberships.id, membership.id), isNull(companyMemberships.permissionsInitializedAt)));
      });
      return;
    }

    // Preserve the role at the row-write boundary, including concurrent role
    // changes. Existing active memberships require no membership mutation.
    await db.insert(companyMemberships).values({ companyId, principalType, principalId, status: "active", membershipRole: "member" })
      .onConflictDoUpdate({ target: [companyMemberships.companyId, companyMemberships.principalType, companyMemberships.principalId],
        set: { status: "active", membershipRole: "member", updatedAt: new Date() },
        setWhere: ne(companyMemberships.status, "active") });

    if (principalType === "user") {
      const membership = await getMembership(companyId, "user", principalId);
      if (membership) await ensureHumanRoleDefaultGrants(db, { companyId, principalId,
        membershipRole: membership.membershipRole, grantedByUserId });
    }

    const existing = await db
      .select()
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, principalType),
          eq(principalPermissionGrants.principalId, principalId),
          eq(principalPermissionGrants.permissionKey, permissionKey),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (existing) {
      await db
        .update(principalPermissionGrants)
        .set({
          scope,
          grantedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(principalPermissionGrants.id, existing.id));
      return;
    }

    await db.insert(principalPermissionGrants).values({
      companyId,
      principalType,
      principalId,
      permissionKey,
      scope,
      grantedByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function createWorkflowCoverage(companyId: string, input: {
    requestId: string;
    delegateeUserId: string;
    workflowId: string;
    workflowRevisionId: string;
    scopeType: "manual" | "task";
    taskId: string | null;
    startsAt: Date;
    expiresAt: Date;
    reason: string;
  }, actor: AuthorizationActor) {
    if (actor.type !== "board" || actor.source !== "session" || !actor.userId || actor.userId === input.delegateeUserId) {
      throw forbidden("A current Human session must create coverage for a different Human.", { code: "workflow_coverage_session_required" });
    }
    const assertSameRequest = (existing: typeof humanWorkflowCoverages.$inferSelect) => {
      if (existing.principalUserId !== actor.userId || existing.delegateeUserId !== input.delegateeUserId ||
          existing.workflowId !== input.workflowId || existing.workflowRevisionId !== input.workflowRevisionId ||
          existing.scopeType !== input.scopeType || existing.taskId !== input.taskId ||
          existing.startsAt.getTime() !== input.startsAt.getTime() || existing.expiresAt.getTime() !== input.expiresAt.getTime() ||
          existing.reason !== input.reason.trim()) {
        throw conflict("Coverage request ID was already used for different terms.", { code: "workflow_coverage_request_reused" });
      }
      return { coverage: existing, created: false as const };
    };
    try {
      return await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(humanWorkflowCoverages).where(and(
          eq(humanWorkflowCoverages.companyId, companyId), eq(humanWorkflowCoverages.requestId, input.requestId),
        )).for("update");
        if (existing) return assertSameRequest(existing);
        await assertWorkflowCoverageHumanRights({ tx, companyId, principalUserId: actor.userId!,
          delegateeUserId: input.delegateeUserId, workflowId: input.workflowId,
          workflowRevisionId: input.workflowRevisionId, scopeType: input.scopeType, taskId: input.taskId });
        const [coverage] = await tx.insert(humanWorkflowCoverages).values({
          requestId: input.requestId, companyId, principalUserId: actor.userId!, delegateeUserId: input.delegateeUserId,
          actionKey: "workflows:run", workflowId: input.workflowId, workflowRevisionId: input.workflowRevisionId,
          scopeType: input.scopeType, taskId: input.taskId, startsAt: input.startsAt, expiresAt: input.expiresAt,
          reason: input.reason.trim(), createdAt: new Date(),
        }).returning();
        if (!coverage) throw new Error("Workflow coverage insert returned no row");
        return { coverage, created: true as const };
      });
    } catch (error) {
      if (!isUniqueViolation(error, "human_workflow_coverages_company_request_uq")) throw error;
      const [existing] = await db.select().from(humanWorkflowCoverages).where(and(
        eq(humanWorkflowCoverages.companyId, companyId), eq(humanWorkflowCoverages.requestId, input.requestId),
      ));
      if (!existing) throw error;
      return assertSameRequest(existing);
    }
  }

  async function listWorkflowCoverages(companyId: string, userId: string) {
    return db.select().from(humanWorkflowCoverages).where(and(
      eq(humanWorkflowCoverages.companyId, companyId),
      or(eq(humanWorkflowCoverages.principalUserId, userId), eq(humanWorkflowCoverages.delegateeUserId, userId)),
    )).orderBy(desc(humanWorkflowCoverages.createdAt)).limit(100);
  }

  async function revokeWorkflowCoverage(companyId: string, coverageId: string, actor: AuthorizationActor) {
    if (actor.type !== "board" || actor.source !== "session" || !actor.userId) {
      throw forbidden("A current Human session is required to revoke workflow coverage.", { code: "workflow_coverage_session_required" });
    }
    return db.transaction(async (tx) => {
      const [coverage] = await tx.select().from(humanWorkflowCoverages).where(and(
        eq(humanWorkflowCoverages.companyId, companyId), eq(humanWorkflowCoverages.id, coverageId),
      )).for("update");
      if (!coverage) return null;
      if (actor.userId !== coverage.principalUserId && actor.userId !== coverage.delegateeUserId) {
        throw forbidden("Only a Human named by this workflow coverage may revoke it.", { code: "workflow_coverage_revoke_denied" });
      }
      if (coverage.revokedAt) return coverage;
      const [revoked] = await tx.update(humanWorkflowCoverages).set({ revokedAt: new Date(), revokedByUserId: actor.userId })
        .where(and(eq(humanWorkflowCoverages.companyId, companyId), eq(humanWorkflowCoverages.id, coverageId), isNull(humanWorkflowCoverages.revokedAt)))
        .returning();
      return revoked ?? coverage;
    });
  }

  async function revokeWorkflowCoveragesForMember(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0], companyId: string, userId: string, revokedByUserId: string | null, now: Date,
  ) {
    await tx.update(humanWorkflowCoverages).set({ revokedAt: now, revokedByUserId })
      .where(and(eq(humanWorkflowCoverages.companyId, companyId), isNull(humanWorkflowCoverages.revokedAt),
        or(eq(humanWorkflowCoverages.principalUserId, userId), eq(humanWorkflowCoverages.delegateeUserId, userId))));
  }

  async function authorizeWorkflowCoverage(input: {
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0];
    companyId: string;
    coverageId: string;
    delegateeUserId: string;
    workflowId: string;
    workflowRevisionId: string;
    scopeType: "manual" | "task";
    taskId: string | null;
    now?: Date;
  }) {
    return assertWorkflowCoverageCurrent(input);
  }

  async function updateMember(
    companyId: string,
    memberId: string,
    data: {
      membershipRole?: string | null;
      status?: "pending" | "active" | "suspended";
    },
    actorUserId: string | null = null,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        select ${companyMemberships.id}
        from ${companyMemberships}
        where ${companyMemberships.companyId} = ${companyId}
          and ${companyMemberships.principalType} = 'user'
          and ${companyMemberships.status} = 'active'
          and ${companyMemberships.membershipRole} = 'owner'
        for update
      `);

      const existing = await tx
        .select()
        .from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, memberId)))
        .for("update")
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextMembershipRole =
        data.membershipRole !== undefined ? data.membershipRole : existing.membershipRole;
      const nextStatus = data.status ?? existing.status;

      if (
        existing.principalType === "user" &&
        existing.status === "active" &&
        existing.membershipRole === "owner" &&
        (nextStatus !== "active" || nextMembershipRole !== "owner")
      ) {
        const activeOwnerCount = await tx
          .select({ id: companyMemberships.id })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.status, "active"),
              eq(companyMemberships.membershipRole, "owner"),
            ),
          )
          .then((rows) => rows.length);
        if (activeOwnerCount <= 1) {
          throw conflict("Cannot remove the last active owner");
        }
      }

      const now = new Date();
      if (
        existing.principalType === "user" &&
        existing.status === "active" &&
        nextStatus !== "active"
      ) {
        await sweepMemberConnectionAccess(tx, companyId, existing.principalId, now);
        await pauseActiveOwnedRoutinesForWithdrawal(tx, companyId, existing.principalId, actorUserId);
        await revokeWorkflowCoveragesForMember(tx, companyId, existing.principalId, actorUserId, now);
      }

      return tx
        .update(companyMemberships)
        .set({
          membershipRole: nextMembershipRole,
          status: nextStatus,
          updatedAt: now,
        })
        .where(eq(companyMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? existing);
    });
  }

  return {
    isInstanceAdmin,
    decide,
    withReadSources: authorization.withReadSources,
    canUser,
    hasPermission,
    getMembership,
    getMemberById,
    ensureMembership,
    listMembers,
    searchMembers,
    listActiveUserMemberships,
    copyActiveUserMemberships,
    ensureRoleDefaultGrants,
    archiveMember,
    setMemberPermissions,
    updateMemberAndPermissions,
    promoteInstanceAdmin,
    demoteInstanceAdmin,
    listUserCompanyAccess,
    setUserCompanyAccess,
    setPrincipalGrants,
    listPrincipalGrants,
    setPrincipalPermission,
    updateMember,
    createWorkflowCoverage,
    listWorkflowCoverages,
    revokeWorkflowCoverage,
    authorizeWorkflowCoverage,
  };
}
