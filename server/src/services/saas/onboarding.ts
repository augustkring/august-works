import { agentService } from "../agents.js";
import { issueService } from "../issues.js";
import { rolePackService } from "../role-packs.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog,
  approvals,
  agents,
  authUsers,
  billingAccounts,
  billingAccountCompanies,
  companies,
  companyMemberships,
  companyOnboardingRuns,
  companySecrets,
  heartbeatRuns,
  issues,
  principalPermissionGrants,
  rolePacks,
  type Db,
} from "@paperclipai/db";
import {
  createSaasCompanySchema,
  updateOnboardingSchema,
  PERMISSION_KEYS,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import {
  deriveIssuePrefixBase,
  isIssuePrefixConflict,
  pickAvailableIssuePrefix,
} from "../issue-prefix.js";
import { entitlementService } from "../billing/entitlements.js";
import { sha256 } from "./crypto.js";
import { foundationService } from "../foundation/foundation-service.js";
import type { z } from "zod";

const STAGES = [
  "organization",
  "plan",
  "runtime",
  "model_provider",
  "agent",
  "first_task",
  "complete",
];
export function saasOnboardingService(db: Db) {
  async function create(
    userId: string,
    input: z.infer<typeof createSaasCompanySchema>,
  ) {
    const requestHash = sha256(
      JSON.stringify({
        name: input.name,
        description: input.description ?? null,
      }),
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          // User lock prevents parallel double-onboarding and serializes the request key.
          const [user] = await tx
            .select()
            .from(authUsers)
            .where(eq(authUsers.id, userId))
            .for("update");
          if (!user?.emailVerified)
            throw forbidden("Verified email required", {
              code: "EMAIL_VERIFICATION_REQUIRED",
            });
          const [existing] = await tx
            .select()
            .from(companyOnboardingRuns)
            .where(
              and(
                eq(companyOnboardingRuns.createdByUserId, userId),
                eq(companyOnboardingRuns.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1);
          if (existing) {
            if (existing.requestHash !== requestHash)
              throw conflict("Idempotency key has a different request");
            return existing;
          }
          const owned = await tx
            .select({ id: companyMemberships.id })
            .from(companyMemberships)
            .where(
              and(
                eq(companyMemberships.principalType, "user"),
                eq(companyMemberships.principalId, userId),
                eq(companyMemberships.status, "active"),
                eq(companyMemberships.membershipRole, "owner"),
              ),
            );
          if (owned.length >= 20)
            throw unprocessable("Company creation limit reached");
          const issuePrefix = await pickAvailableIssuePrefix(
            tx,
            deriveIssuePrefixBase(input.name),
          );
          if (!issuePrefix) throw conflict("Company identifier is unavailable");
          const [company] = await tx
            .insert(companies)
            .values({
              name: input.name,
              description: input.description,
              issuePrefix,
              defaultResponsibleUserId: userId,
              requireBoardApprovalForNewAgents: true,
            })
            .returning();
          const [account] = await tx
            .insert(billingAccounts)
            .values({ displayName: input.name, payerUserId: userId })
            .returning();
          await tx
            .insert(billingAccountCompanies)
            .values({ companyId: company!.id, billingAccountId: account!.id });
          await tx.insert(companyMemberships).values({
            companyId: company!.id,
            principalType: "user",
            principalId: userId,
            membershipRole: "owner",
          });
          await tx.insert(principalPermissionGrants).values(
            PERMISSION_KEYS.map((permissionKey) => ({
              companyId: company!.id,
              principalType: "user",
              principalId: userId,
              permissionKey,
              grantedByUserId: userId,
            })),
          );
          const [run] = await tx
            .insert(companyOnboardingRuns)
            .values({
              companyId: company!.id,
              billingAccountId: account!.id,
              createdByUserId: userId,
              idempotencyKey: input.idempotencyKey,
              requestHash,
            })
            .returning();
          await tx.insert(activityLog).values({
            companyId: company!.id,
            actorType: "user",
            actorId: userId,
            action: "saas.company_created",
            entityType: "company",
            entityId: company!.id,
            details: { onboardingRunId: run!.id },
          });
          // SaaS deliberately creates neither a local environment nor local CLI agents.
          return run!;
        });
      } catch (error) {
        if (!isIssuePrefixConflict(error) || attempt === 4) throw error;
      }
    }
    throw conflict("Company creation could not be completed");
  }
  async function get(companyId: string) {
    const [run] = await db
      .select()
      .from(companyOnboardingRuns)
      .where(eq(companyOnboardingRuns.companyId, companyId))
      .limit(1);
    if (!run) throw notFound("Onboarding not found");
    return run;
  }
  async function update(
    companyId: string,
    userId: string,
    input: z.infer<typeof updateOnboardingSchema>,
  ) {
    if (
      Object.keys(input.answers).some((key) =>
        key.startsWith("createdFirstAgent"),
      )
    )
      throw unprocessable("First-agent creation evidence is server-owned");
    const current = await get(companyId);
    const from = STAGES.indexOf(current.currentStage),
      to = STAGES.indexOf(input.stage);
    if (
      current.status !== "in_progress" ||
      input.expectedVersion !== current.version
    )
      throw conflict("Onboarding has changed", {
        code: "ONBOARDING_VERSION_CONFLICT",
      });
    if (to < 0 || to > from + 1)
      throw unprocessable("Complete the current onboarding stage first");
    const answers = { ...current.answers, ...input.answers };
    if (
      from === 0 &&
      to > 0 &&
      !(typeof answers.mission === "string" && answers.mission.trim())
    )
      throw unprocessable("Add an organization mission before continuing");
    if (to > 1)
      await entitlementService(db).require(companyId, "platform.access");
    for (const [field, table] of [
      ["providerSecretId", companySecrets],
      ["agentId", agents],
      ["firstTaskId", issues],
      ["rolePackId", rolePacks],
    ] as const) {
      const id = answers[field];
      if (typeof id !== "string") continue;
      const rows = await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), eq(table.companyId, companyId)))
        .limit(1);
      if (!rows.length)
        throw unprocessable("Onboarding reference is unavailable", { field });
      if (field === "providerSecretId") {
        const [secret] = await db
          .select({ ownerUserId: companySecrets.ownerUserId })
          .from(companySecrets)
          .where(eq(companySecrets.id, id))
          .limit(1);
        if (secret?.ownerUserId && secret.ownerUserId !== userId)
          throw unprocessable("Onboarding reference is unavailable", { field });
      }
    }
    if (
      input.stage === "complete" &&
      (typeof answers.agentId !== "string" ||
        typeof answers.firstTaskId !== "string")
    )
      throw unprocessable("An agent and first task are required");
    if (input.stage === "complete") {
      const [success] = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.agentId, answers.agentId as string),
            eq(heartbeatRuns.status, "succeeded"),
            sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${answers.firstTaskId as string}`,
          ),
        )
        .limit(1);
      if (!success)
        throw unprocessable(
          "Complete a safe starter task successfully before finishing setup",
          { code: "STARTER_TASK_NOT_SUCCEEDED" },
        );
    }
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(companyOnboardingRuns)
        .set({
          answers,
          currentStage: input.stage,
          version: sql`${companyOnboardingRuns.version}+1`,
          status: input.stage === "complete" ? "completed" : "in_progress",
          completedAt: input.stage === "complete" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companyOnboardingRuns.companyId, companyId),
            eq(companyOnboardingRuns.version, input.expectedVersion),
            eq(companyOnboardingRuns.status, "in_progress"),
          ),
        )
        .returning();
      if (!updated)
        throw conflict("Onboarding has changed", {
          code: "ONBOARDING_VERSION_CONFLICT",
        });
      if (
        typeof input.answers.mission === "string" &&
        input.answers.mission.trim()
      ) {
        const foundation = foundationService(tx as unknown as Db),
          actor = { principal: { type: "user" as const, userId } };
        const existing = await foundation.getByKey(companyId, "mission");
        if (!existing) {
          const document = await foundation.createDraft(
            companyId,
            {
              foundationKey: "mission",
              title: "Organization mission",
              body: input.answers.mission.trim(),
              category: "company",
              documentType: "mission",
              ownerUserId: userId,
            },
            actor,
          );
          updated.answers = {
            ...updated.answers,
            missionFoundationId: document.id,
          };
        } else {
          if (
            existing.status !== "draft" &&
            existing.body !== input.answers.mission.trim()
          )
            throw conflict(
              "Review changes to the organization mission in Foundation first",
              { code: "MISSION_FOUNDATION_REVIEW_REQUIRED" },
            );
          if (
            existing.status === "draft" &&
            existing.body !== input.answers.mission.trim() &&
            existing.latestRevisionId
          )
            await foundation.updateDraft(
              companyId,
              existing.id,
              {
                baseRevisionId: existing.latestRevisionId,
                body: input.answers.mission.trim(),
              },
              actor,
            );
          updated.answers = {
            ...updated.answers,
            missionFoundationId: existing.id,
          };
        }
        await tx
          .update(companyOnboardingRuns)
          .set({ answers: updated.answers })
          .where(eq(companyOnboardingRuns.id, updated.id));
      }
      if (
        from === 4 &&
        to > 4 &&
        typeof answers.agentId === "string" &&
        typeof answers.rolePackId === "string"
      )
        await rolePackService(tx as unknown as Db).assign(
          {
            type: "board",
            source: "session",
            userId,
            ignoreInstanceAdmin: true,
          },
          companyId,
          {
            scopeType: "agent",
            scopeId: answers.agentId,
            rolePackId: answers.rolePackId,
            versionPolicy: "follow_published",
            pinnedVersionId: null,
          },
        );
      await tx.insert(activityLog).values({
        companyId,
        actorType: "user",
        actorId: userId,
        action: "saas.onboarding_updated",
        entityType: "onboarding",
        entityId: updated.id,
        details: { stage: updated.currentStage, version: updated.version },
      });
      return updated;
    });
  }
  async function firstAgent(
    companyId: string,
    userId: string,
    input: { expectedVersion: number; name: string },
  ) {
    return db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const actor = {
        type: "board" as const,
        source: "session" as const,
        userId,
        ignoreInstanceAdmin: true,
      };
      await assertV5Authorization(txDb, actor, companyId, "agents:create", {
        type: "company",
        companyId,
      });
      const [run] = await tx
        .select()
        .from(companyOnboardingRuns)
        .where(eq(companyOnboardingRuns.companyId, companyId))
        .for("update");
      if (!run) throw notFound("Onboarding not found");
      const name = input.name.trim();
      if (!name || name.length > 100)
        throw unprocessable("Agent name must contain 1–100 characters");
      // One durable intent per onboarding run survives concurrent requests and lost responses.
      if (typeof run.answers.createdFirstAgentId === "string") {
        if (run.answers.createdFirstAgentName !== name)
          throw conflict(
            "The first agent has already been created with another name",
          );
        return {
          agentId: run.answers.createdFirstAgentId,
          approvalId: run.answers.createdFirstAgentApprovalId ?? null,
        };
      }
      if (
        run.status !== "in_progress" ||
        run.currentStage !== "agent" ||
        run.version !== input.expectedVersion
      )
        throw conflict(
          "Reach the current agent stage before creating the first agent",
          { code: "ONBOARDING_VERSION_CONFLICT" },
        );
      await entitlementService(txDb).require(companyId, "platform.access");
      const [company] = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .for("share");
      if (!company) throw notFound("Company not found");
      const agent = await agentService(txDb).create(companyId, {
        name,
        role: "ceo",
        adapterType: "openclaw_gateway",
        adapterConfig: {},
        runtimeConfig: { heartbeat: { enabled: false } },
        budgetMonthlyCents: 0,
        status: company.requireBoardApprovalForNewAgents
          ? "pending_approval"
          : "paused",
      });
      let approvalId: string | null = null;
      if (company.requireBoardApprovalForNewAgents) {
        const [approval] = await tx
          .insert(approvals)
          .values({
            companyId,
            type: "hire_agent",
            requestedByUserId: userId,
            status: "pending",
            payload: {
              agentId: agent.id,
              name: agent.name,
              role: agent.role,
              adapterType: agent.adapterType,
              adapterConfig: agent.adapterConfig,
              runtimeConfig: agent.runtimeConfig,
              budgetMonthlyCents: 0,
              requestedConfigurationSnapshot: {
                adapterType: agent.adapterType,
                adapterConfig: agent.adapterConfig,
                runtimeConfig: agent.runtimeConfig,
                desiredSkills: [],
              },
            },
          })
          .returning();
        approvalId = approval!.id;
        await tx.insert(activityLog).values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "approval.created",
          entityType: "approval",
          entityId: approvalId,
          details: { type: "hire_agent" },
        });
      }
      await tx
        .update(companyOnboardingRuns)
        .set({
          answers: {
            ...run.answers,
            agentId: agent.id,
            createdFirstAgentId: agent.id,
            createdFirstAgentName: name,
            createdFirstAgentApprovalId: approvalId,
          },
          version: sql`${companyOnboardingRuns.version}+1`,
          updatedAt: new Date(),
        })
        .where(eq(companyOnboardingRuns.id, run.id));
      await tx.insert(activityLog).values({
        companyId,
        actorType: "user",
        actorId: userId,
        action: "agent.hire_created",
        entityType: "agent",
        entityId: agent.id,
        details: { approvalId, onboardingRunId: run.id },
      });
      return { agentId: agent.id, approvalId };
    });
  }
  async function starterTask(
    companyId: string,
    userId: string,
    expectedVersion: number,
  ) {
    const actor = {
      type: "board" as const,
      source: "session" as const,
      userId,
      ignoreInstanceAdmin: true,
    };
    await entitlementService(db).require(companyId, "platform.access");
    return db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(companyOnboardingRuns)
        .where(eq(companyOnboardingRuns.companyId, companyId))
        .for("update");
      if (
        !run ||
        run.status !== "in_progress" ||
        run.currentStage !== "first_task"
      )
        throw conflict(
          "Reach the first task stage before creating a starter task",
        );
      if (typeof run.answers.firstTaskId === "string")
        return { issueId: run.answers.firstTaskId };
      if (run.version !== expectedVersion)
        throw conflict("Onboarding has changed", {
          code: "ONBOARDING_VERSION_CONFLICT",
        });
      const agentId = run.answers.agentId;
      if (typeof agentId !== "string")
        throw unprocessable("Choose a configured agent first");
      await assertV5Authorization(
        tx as unknown as Db,
        actor,
        companyId,
        "agents:configure",
        { type: "agent", companyId, agentId },
      );
      const [agent] = await tx
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
        .limit(1);
      if (
        !agent ||
        ![
          "openclaw_gateway",
          "hermes_gateway",
          "http",
          "cursor_cloud",
        ].includes(agent.adapterType)
      )
        throw unprocessable("A remote agent is required for the starter task");
      const issue = await issueService(tx as unknown as Db).create(companyId, {
        title: "Suggest three safe next steps for this organization",
        description:
          "Review the organization mission and suggest three small next steps in a task comment. This task is a proposal only. Do not send messages, purchase anything, run shell commands, invoke external connectors, change credentials, or modify external systems. Ask the owner to approve any further work.",
        status: "backlog",
        priority: "low",
        assigneeAgentId: agentId,
        createdByUserId: userId,
        responsibleUserId: userId,
        actorResponsibleUserId: userId,
        trustExplicitResponsibleUserId: true,
        idempotencyKey: "saas-starter:" + run.id,
      });
      await tx
        .update(companyOnboardingRuns)
        .set({
          answers: { ...run.answers, firstTaskId: issue.id },
          version: sql`${companyOnboardingRuns.version}+1`,
          updatedAt: new Date(),
        })
        .where(eq(companyOnboardingRuns.id, run.id));
      await tx.insert(activityLog).values({
        companyId,
        actorType: "user",
        actorId: userId,
        action: "saas.starter_task_created",
        entityType: "issue",
        entityId: issue.id,
      });
      return { issueId: issue.id };
    });
  }
  return { create, get, update, firstAgent, starterTask };
}
