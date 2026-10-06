import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import {
  agents,
  issues,
  aiUseCases,
  aiUseCaseVersions,
  aiUseCaseAssessments,
  aiUseCaseDeployments,
  aiUseCaseChangeEvents,
  humanOversightProfiles,
  governanceObligations,
  governanceStopActions,
  principalPermissionGrants,
  type Db,
} from "@paperclipai/db";
import {
  createUseCaseSchema,
  updateUseCaseSchema,
  useCaseAssessmentSchema,
  useCaseDecisionSchema,
  useCaseDeploymentSchema,
  oversightProfileSchema,
  governanceObligationSchema,
  type AIUseCaseView,
} from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import {
  assertV7Enabled,
  assertV7Authorization,
  v7HumanActorId,
} from "../v7-authorization.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { conflict, notFound } from "../../errors.js";
import {
  classifyGovernanceChange,
  useCaseDeploymentBlockers,
} from "./governance-policy.js";
import type { z } from "zod";
export function aiGovernanceService(db: Db) {
  async function access(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    write = false,
  ) {
    v7HumanActorId(actor);
    await assertV7Authorization(
      tx,
      actor,
      companyId,
      write ? "users:manage_permissions" : "company_scope:read",
    );
  }
  async function current(tx: Db, companyId: string, id: string, lock = false) {
    const query = tx
      .select()
      .from(aiUseCases)
      .where(and(eq(aiUseCases.companyId, companyId), eq(aiUseCases.id, id)));
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw notFound("Use case not found");
    const [revision] = await tx
      .select()
      .from(aiUseCaseVersions)
      .where(
        and(
          eq(aiUseCaseVersions.companyId, companyId),
          eq(aiUseCaseVersions.useCaseId, id),
          eq(aiUseCaseVersions.purposeVersion, row.purposeVersion),
        ),
      );
    if (!revision) throw conflict("Use-case purpose version is unavailable");
    return { row, revision };
  }
  async function profile(tx: Db, companyId: string, id: string) {
    const [row] = await tx
      .select()
      .from(humanOversightProfiles)
      .where(
        and(
          eq(humanOversightProfiles.companyId, companyId),
          eq(humanOversightProfiles.id, id),
        ),
      )
      .for("share");
    if (!row || row.status !== "active")
      throw conflict("An active company oversight profile is required");
    return row;
  }
  function version(row: typeof aiUseCases.$inferSelect, expected: number) {
    if (row.version !== expected || row.status === "retired")
      throw conflict("Use-case state changed; refresh before reviewing");
  }
  function view(
    row: typeof aiUseCases.$inferSelect,
    revision: typeof aiUseCaseVersions.$inferSelect,
  ): AIUseCaseView {
    return {
      id: row.id,
      companyId: row.companyId,
      key: row.key,
      ownerUserId: row.ownerUserId,
      version: row.version,
      purposeVersion: row.purposeVersion,
      status: row.status,
      purpose: revision.purpose,
      purposeHash: revision.purposeHash,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  return {
    targets: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "ai_use_cases_v7");
      await access(db, actor, companyId, true);
      const candidates = await db
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            isNull(issues.hiddenAt),
            isNotNull(issues.assigneeAgentId),
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(100);
      const targets: Array<{
        id: string;
        title: string;
        identifier: string | null;
        assigneeAgentId: string;
      }> = [];
      for (const task of candidates) {
        try {
          await assertV7Authorization(db, actor, companyId, "issue:read", {
            type: "issue",
            companyId,
            issueId: task.id,
            projectId: task.projectId,
            parentIssueId: task.parentId,
            assigneeAgentId: task.assigneeAgentId,
            assigneeUserId: task.assigneeUserId,
            status: task.status,
          });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 403
          )
            continue;
          throw error;
        }
        if (task.assigneeAgentId)
          targets.push({
            id: task.id,
            title: task.title,
            identifier: task.identifier,
            assigneeAgentId: task.assigneeAgentId,
          });
      }
      return targets;
    },
    list: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "ai_use_cases_v7");
      await access(db, actor, companyId);
      const rows = await db
        .select()
        .from(aiUseCases)
        .where(eq(aiUseCases.companyId, companyId))
        .orderBy(desc(aiUseCases.updatedAt))
        .limit(100);
      return Promise.all(
        rows.map(async (row) => {
          const source = await current(db, companyId, row.id);
          return view(source.row, source.revision);
        }),
      );
    },
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      await access(db, actor, companyId, true);
      const source = await current(db, companyId, id);
      const assessments = await db
        .select()
        .from(aiUseCaseAssessments)
        .where(
          and(
            eq(aiUseCaseAssessments.companyId, companyId),
            eq(aiUseCaseAssessments.useCaseId, id),
          ),
        )
        .orderBy(desc(aiUseCaseAssessments.createdAt))
        .limit(100);
      const history = await db
        .select()
        .from(aiUseCaseVersions)
        .where(
          and(
            eq(aiUseCaseVersions.companyId, companyId),
            eq(aiUseCaseVersions.useCaseId, id),
          ),
        )
        .orderBy(desc(aiUseCaseVersions.purposeVersion))
        .limit(50);
      const changes = await db
        .select()
        .from(aiUseCaseChangeEvents)
        .where(
          and(
            eq(aiUseCaseChangeEvents.companyId, companyId),
            eq(aiUseCaseChangeEvents.useCaseId, id),
          ),
        )
        .orderBy(desc(aiUseCaseChangeEvents.createdAt))
        .limit(100);
      const allDeployments = await db
        .select()
        .from(aiUseCaseDeployments)
        .where(
          and(
            eq(aiUseCaseDeployments.companyId, companyId),
            eq(aiUseCaseDeployments.useCaseId, id),
          ),
        )
        .limit(100);
      const deployments: typeof allDeployments = [];
      for (const deployment of allDeployments) {
        const [task] = await db
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              eq(issues.id, deployment.issueId),
            ),
          );
        if (!task) continue;
        try {
          await assertV7Authorization(db, actor, companyId, "issue:read", {
            type: "issue",
            companyId,
            issueId: task.id,
            projectId: task.projectId,
            parentIssueId: task.parentId,
            assigneeAgentId: task.assigneeAgentId,
            assigneeUserId: task.assigneeUserId,
            status: task.status,
          });
          deployments.push(deployment);
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 403
          )
            continue;
          throw error;
        }
      }
      const stopRequests = deployments.length
        ? await db
            .select()
            .from(governanceStopActions)
            .where(
              and(
                eq(governanceStopActions.companyId, companyId),
                inArray(
                  governanceStopActions.deploymentId,
                  deployments.map((row) => row.id),
                ),
              ),
            )
            .limit(100)
        : [];
      return {
        useCase: view(source.row, source.revision),
        assessments,
        history,
        changes,
        deployments,
        stopRequests,
      };
    },
    obligations: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "governance_evidence_v7");
      await access(db, actor, companyId, true);
      return db
        .select()
        .from(governanceObligations)
        .where(eq(governanceObligations.companyId, companyId))
        .orderBy(governanceObligations.nextReviewAt)
        .limit(100);
    },
    obligation: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: z.infer<typeof governanceObligationSchema>,
    ) => {
      const input = governanceObligationSchema.parse(raw);
      if (new Date(input.nextReviewAt) <= new Date())
        throw conflict("Set a future obligation review date");
      await assertV7Enabled(db, "governance_evidence_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await access(tx, actor, companyId, true);
        await lockAnalyticalCompany(tx, companyId);
        const [row] = await tx
          .insert(governanceObligations)
          .values({
            companyId,
            obligation: input,
            obligationHash: nativeSha256(input),
            ownerUserId: v7HumanActorId(actor),
            lastReviewedAt: new Date(),
            nextReviewAt: new Date(input.nextReviewAt),
          })
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: "governance.obligation_registered",
            entityType: "governance_obligation",
            entityId: row!.id,
            details: {
              framework: input.framework,
              obligationHash: row!.obligationHash,
            },
          },
          publications,
        );
        return row!;
      });
    },
    oversight: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: z.infer<typeof oversightProfileSchema>,
    ) => {
      const input = oversightProfileSchema.parse(raw);
      await assertV7Enabled(db, "ai_use_cases_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await access(tx, actor, companyId, true);
        const [row] = await tx
          .insert(humanOversightProfiles)
          .values({
            companyId,
            profile: input,
            profileHash: nativeSha256(input),
            createdByUserId: v7HumanActorId(actor),
          })
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: "governance.oversight_created",
            entityType: "human_oversight_profile",
            entityId: row!.id,
            details: { profileHash: row!.profileHash },
          },
          publications,
        );
        return row!;
      });
    },
    profiles: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "ai_use_cases_v7");
      await access(db, actor, companyId);
      return db
        .select()
        .from(humanOversightProfiles)
        .where(eq(humanOversightProfiles.companyId, companyId));
    },
    create: async (
      actor: AuthorizationActor,
      companyId: string,
      raw: z.infer<typeof createUseCaseSchema>,
    ) => {
      const input = createUseCaseSchema.parse(raw);
      await assertV7Enabled(db, "ai_use_cases_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await access(tx, actor, companyId, true);
        const oversight = await profile(
          tx,
          companyId,
          input.purpose.oversightProfileId,
        );
        if (new Date(input.purpose.nextReviewAt) <= new Date())
          throw conflict("Set a future purpose review date");
        const [row] = await tx
          .insert(aiUseCases)
          .values({
            companyId,
            key: input.key,
            ownerUserId: v7HumanActorId(actor),
            nextReviewAt: new Date(input.purpose.nextReviewAt),
          })
          .returning();
        const [revision] = await tx
          .insert(aiUseCaseVersions)
          .values({
            companyId,
            useCaseId: row!.id,
            purposeVersion: 1,
            purpose: input.purpose,
            purposeHash: nativeSha256(input.purpose),
            oversightProfileId: oversight.id,
            oversightProfileHash: oversight.profileHash,
            changeClassification: "review_required",
            changeReason: "Initial intended-purpose registration",
            createdByUserId: v7HumanActorId(actor),
          })
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: "governance.use_case_created",
            entityType: "ai_use_case",
            entityId: row!.id,
            details: { purposeHash: revision!.purposeHash, version: 1 },
          },
          publications,
        );
        return view(row!, revision!);
      });
    },
    update: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: z.infer<typeof updateUseCaseSchema>,
    ) => {
      const input = updateUseCaseSchema.parse(raw);
      await assertV7Enabled(db, "ai_use_cases_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await access(tx, actor, companyId, true);
        const { row, revision } = await current(tx, companyId, id, true);
        version(row, input.expectedVersion);
        const oversight = await profile(
          tx,
          companyId,
          input.purpose.oversightProfileId,
        );
        if (new Date(input.purpose.nextReviewAt) <= new Date())
          throw conflict("Set a future purpose review date");
        const change = classifyGovernanceChange(
          revision.purpose,
          input.purpose,
        );
        const [next] = await tx
          .insert(aiUseCaseVersions)
          .values({
            companyId,
            useCaseId: id,
            purposeVersion: row.purposeVersion + 1,
            purpose: input.purpose,
            purposeHash: nativeSha256(input.purpose),
            oversightProfileId: oversight.id,
            oversightProfileHash: oversight.profileHash,
            changeClassification: change.classification,
            changeReason: input.changeReason,
            createdByUserId: v7HumanActorId(actor),
          })
          .returning();
        const [updated] = await tx
          .update(aiUseCases)
          .set({
            purposeVersion: next!.purposeVersion,
            version: row.version + 1,
            status: "assessing",
            approvedAt: null,
            nextReviewAt: new Date(input.purpose.nextReviewAt),
            updatedAt: new Date(),
          })
          .where(eq(aiUseCases.id, id))
          .returning();
        await tx.insert(aiUseCaseChangeEvents).values({
          companyId,
          useCaseId: id,
          purposeVersion: next!.purposeVersion,
          classification: change.classification,
          reasonCode: "human_purpose_revision",
          sourceRefHash: revision.purposeHash,
        });
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: "governance.purpose_changed",
            entityType: "ai_use_case",
            entityId: id,
            details: {
              classification: change.classification,
              purposeVersion: next!.purposeVersion,
              changedFields: change.changedFields,
            },
          },
          publications,
        );
        return view(updated!, next!);
      });
    },
    assess: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: z.infer<typeof useCaseAssessmentSchema>,
    ) => {
      const input = useCaseAssessmentSchema.parse(raw);
      await assertV7Enabled(db, "ai_use_cases_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await access(tx, actor, companyId, true);
        const source = await current(tx, companyId, id, true);
        version(source.row, input.expectedVersion);
        const [assessment] = await tx
          .insert(aiUseCaseAssessments)
          .values({
            companyId,
            useCaseId: id,
            purposeVersion: source.row.purposeVersion,
            assessment: input,
            assessmentHash: nativeSha256(input),
            assessedByUserId: v7HumanActorId(actor),
          })
          .returning();
        await tx
          .update(aiUseCases)
          .set({
            version: source.row.version + 1,
            status: "assessing",
            approvedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(aiUseCases.id, id));
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: "governance.assessment_recorded",
            entityType: "ai_use_case",
            entityId: id,
            details: {
              assessmentId: assessment!.id,
              framework: input.framework,
              assessmentHash: assessment!.assessmentHash,
              purposeVersion: source.row.purposeVersion,
            },
          },
          publications,
        );
        return assessment!;
      });
    },
    bind: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      raw: z.infer<typeof useCaseDeploymentSchema>,
    ) => {
      const input = useCaseDeploymentSchema.parse(raw);
      await assertV7Enabled(db, "ai_use_cases_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await access(tx, actor, companyId, true);
        const [task] = await tx
          .select()
          .from(issues)
          .where(
            and(eq(issues.companyId, companyId), eq(issues.id, input.issueId)),
          )
          .for("share");
        if (!task || task.hiddenAt || task.assigneeAgentId !== input.agentId)
          throw conflict(
            "Bind the current owned native Task, not another presence's purpose",
          );
        await assertV7Authorization(tx, actor, companyId, "issue:mutate", {
          type: "issue",
          companyId,
          issueId: task.id,
          projectId: task.projectId,
          parentIssueId: task.parentId,
          assigneeAgentId: task.assigneeAgentId,
          assigneeUserId: task.assigneeUserId,
          status: task.status,
        });
        const worker: AuthorizationActor = {
          type: "agent",
          companyId,
          agentId: input.agentId,
          onBehalfOfUserId: v7HumanActorId(actor),
        };
        await assertV7Authorization(tx, worker, companyId, "issue:read", {
          type: "issue",
          companyId,
          issueId: task.id,
          projectId: task.projectId,
          parentIssueId: task.parentId,
          assigneeAgentId: task.assigneeAgentId,
          assigneeUserId: task.assigneeUserId,
          status: task.status,
        });
        await agentProviderBindingService(tx).assertRuntime(
          companyId,
          input.agentId,
        );
        const source = await current(tx, companyId, id, true);
        version(source.row, input.expectedVersion);
        if (
          source.row.status !== "approved" ||
          source.row.nextReviewAt <= new Date()
        )
          throw conflict("Deploy only a currently approved use-case purpose");
        const [obligations] = await tx.execute(
          sql`select aw_v7_governance_obligations_current(${companyId}::uuid) as allowed`,
        );
        if (obligations?.allowed !== true)
          throw conflict(
            "Review uncertain or overdue company obligations before activating this use case",
          );
        const requiredRisk = Number(source.revision.purpose.riskClass.slice(1));
        if (requiredRisk >= 2) {
          const [planning] = await tx.execute(
            sql`select exists(select 1 from orchestration_plans p where p.company_id=${companyId}::uuid and (p.issue_id=${task.id}::uuid or exists(select 1 from orchestration_workers w where w.company_id=p.company_id and w.plan_id=p.id and w.issue_id=${task.id}::uuid)) and substring(p.risk_class from 2)::int>=${requiredRisk} and p.verification_mode='independent_required' and (${requiredRisk}<3 or p.human_oversight_mode='required')) as allowed`,
          );
          if (planning?.allowed !== true)
            throw conflict(
              "Create a matching independently verified orchestration plan before activating this use case",
            );
        }
        const [prior] = await tx
          .select()
          .from(aiUseCaseDeployments)
          .where(
            and(
              eq(aiUseCaseDeployments.companyId, companyId),
              eq(aiUseCaseDeployments.issueId, task.id),
              inArray(aiUseCaseDeployments.status, [
                "active",
                "review_required",
                "suspended",
              ]),
            ),
          )
          .for("update");
        if (prior?.status === "active")
          throw conflict("Task already has an active intended purpose");
        if (prior)
          await tx
            .update(aiUseCaseDeployments)
            .set({ status: "retired", updatedAt: new Date() })
            .where(eq(aiUseCaseDeployments.id, prior.id));
        const [hash] = await tx.execute(
          sql`select aw_v7_governance_authority_hash(${companyId}::uuid,${task.id}::uuid,${input.agentId}::uuid,${v7HumanActorId(actor)}) as hash`,
        );
        if (!hash || typeof hash.hash !== "string")
          throw conflict("Current native authority is unavailable");
        const [deployment] = await tx
          .insert(aiUseCaseDeployments)
          .values({
            companyId,
            useCaseId: id,
            purposeVersion: source.row.purposeVersion,
            issueId: task.id,
            agentId: input.agentId,
            purposeHash: source.revision.purposeHash,
            authorityHash: hash.hash,
            status: "active",
            createdByUserId: v7HumanActorId(actor),
          })
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: "governance.deployment_bound",
            entityType: "ai_use_case",
            entityId: id,
            details: {
              deploymentId: deployment!.id,
              issueId: task.id,
              agentId: input.agentId,
              purposeVersion: source.row.purposeVersion,
            },
          },
          publications,
        );
        return deployment!;
      });
    },
    decide: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      action: "approve" | "suspend" | "retire",
      raw: z.infer<typeof useCaseDecisionSchema>,
    ) => {
      const input = useCaseDecisionSchema.parse(raw);
      if (action === "approve") await assertV7Enabled(db, "ai_use_cases_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await access(tx, actor, companyId, true);
        const source = await current(tx, companyId, id, true);
        version(source.row, input.expectedVersion);
        if (action === "approve") {
          const oversight = await profile(
            tx,
            companyId,
            source.revision.oversightProfileId,
          );
          if (oversight.profileHash !== source.revision.oversightProfileHash)
            throw conflict("Oversight changed; revise intended purpose");
          const assessments = await tx
            .select()
            .from(aiUseCaseAssessments)
            .where(
              and(
                eq(aiUseCaseAssessments.companyId, companyId),
                eq(aiUseCaseAssessments.useCaseId, id),
                eq(
                  aiUseCaseAssessments.purposeVersion,
                  source.row.purposeVersion,
                ),
              ),
            );
          const blockers = useCaseDeploymentBlockers(
            source.revision.purpose,
            oversight.profile,
            assessments.map((item) => item.assessment),
          );
          if (blockers.length)
            throw conflict(
              "Use case needs qualified review before deployment",
              { blockers },
            );
        }
        const [updated] = await tx
          .update(aiUseCases)
          .set({
            status:
              action === "approve"
                ? "approved"
                : action === "suspend"
                  ? "suspended"
                  : "retired",
            version: source.row.version + 1,
            approvedAt: action === "approve" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(aiUseCases.id, id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: `governance.${action}`,
            entityType: "ai_use_case",
            entityId: id,
            details: {
              purposeVersion: source.row.purposeVersion,
              rationale: input.rationale,
            },
          },
          publications,
        );
        return view(updated!, source.revision);
      });
    },
  };
}
