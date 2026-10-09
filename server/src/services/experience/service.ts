import type { Db } from "@paperclipai/db";
import {
  activityLog,
  companyMemberships,
  companyUserSidebarPreferences,
  issueApprovals,
} from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import {
  resolveExperienceProfile,
  authorizedExperienceProfiles,
  experienceProfileSchema,
  v9FeatureEnabled,
  v5FeatureEnabled,
  v7FeatureEnabled,
  EXPERIENCE_ADVANCED_DESTINATIONS,
  type ExperienceCard,
  type ExperienceProfile,
  type ExperienceModel,
  type AttentionItem,
} from "@paperclipai/shared";
import { instanceSettingsService } from "../instance-settings.js";
import {
  authorizationService,
  type AuthorizationAction,
  type AuthorizationActor,
} from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { attentionService } from "../attention.js";
import { issueService } from "../issues.js";
import { forbidden, notFound } from "../../errors.js";
import { composeExperience } from "./projection.js";
import { withExperienceAdmission } from "./admission.js";

export function experienceService(db: Db) {
  const auth = authorizationService(db);
  async function attentionIsVisible(
    actor: AuthorizationActor,
    companyId: string,
    item: AttentionItem,
    signal: AbortSignal,
  ) {
    if (item.companyId !== companyId || item.subject.companyId !== companyId)
      return false;
    const issueIds = new Set<string>();
    if (item.subject.kind === "issue") issueIds.add(item.subject.id);
    if (item.relatedIssue?.kind === "issue") issueIds.add(item.relatedIssue.id);
    for (const key of ["issueId", "originIssueId"]) {
      const id = item.subject.metadata?.[key];
      if (typeof id === "string") issueIds.add(id);
    }
    if (item.subject.kind === "approval") {
      const links = await db
        .select({ id: issueApprovals.issueId })
        .from(issueApprovals)
        .where(
          and(
            eq(issueApprovals.companyId, companyId),
            eq(issueApprovals.approvalId, item.subject.id),
          ),
        )
        .limit(26);
      if (links.length > 25) return false;
      for (const link of links) issueIds.add(link.id);
    }
    for (const id of issueIds) {
      signal.throwIfAborted();
      const task = await issueService(db).getById(id);
      if (!task || task.companyId !== companyId) return false;
      const decision = await auth.decide({
        actor,
        action: "issue:read",
        resource: {
          type: "issue",
          companyId,
          issueId: task.id,
          projectId: task.projectId,
          assigneeAgentId: task.assigneeAgentId,
          assigneeUserId: task.assigneeUserId,
        },
      });
      if (!decision.allowed) return false;
    }
    if (
      item.project &&
      !(
        await auth.decide({
          actor,
          action: "project:read",
          resource: { type: "project", companyId, projectId: item.project.id },
        })
      ).allowed
    )
      return false;
    if (
      item.subject.kind === "agent" &&
      !(
        await auth.decide({
          actor,
          action: "agent:read",
          resource: { type: "agent", companyId, agentId: item.subject.id },
        })
      ).allowed
    )
      return false;
    return true;
  }
  async function currentMembership(
    actor: AuthorizationActor,
    companyId: string,
  ) {
    const principal = v5HumanActorId(actor);
    await assertV5Authorization(db, actor, companyId, "company_scope:read");
    const [membership] =
      actor.source === "local_implicit"
        ? []
        : await db
            .select()
            .from(companyMemberships)
            .where(
              and(
                eq(companyMemberships.companyId, companyId),
                eq(companyMemberships.principalType, "user"),
                eq(companyMemberships.principalId, principal),
                eq(companyMemberships.status, "active"),
              ),
            )
            .limit(1);
    if (actor.source !== "local_implicit" && !membership)
      throw forbidden("Active company membership required");
    return { principal, membership };
  }
  async function context(
    actor: AuthorizationActor,
    companyId: string,
    preferred?: ExperienceProfile,
  ) {
    const { principal, membership } = await currentMembership(actor, companyId);
    const [preference] = await db
      .select({ profile: companyUserSidebarPreferences.experienceProfile })
      .from(companyUserSidebarPreferences)
      .where(
        and(
          eq(companyUserSidebarPreferences.companyId, companyId),
          eq(companyUserSidebarPreferences.userId, principal),
        ),
      )
      .limit(1);
    const saved = experienceProfileSchema.safeParse(preference?.profile);
    const [company, security] = await Promise.all([
      auth.decide({
        actor,
        action: "users:invite",
        resource: { type: "company", companyId },
      }),
      auth.decide({
        actor,
        action: "users:manage_permissions",
        resource: { type: "company", companyId },
      }),
    ]);
    const authority = {
      membershipRole: membership?.membershipRole ?? null,
      canManageCompany: company.allowed,
      canManageSecurity: security.allowed,
    };
    return {
      principal,
      profile: resolveExperienceProfile({
        ...authority,
        preferred: preferred ?? (saved.success ? saved.data : undefined),
      }),
      availableProfiles: authorizedExperienceProfiles(authority),
    };
  }
  return {
    context,
    async setProfile(
      actor: AuthorizationActor,
      companyId: string,
      profile: ExperienceProfile,
    ) {
      if (
        !v9FeatureEnabled(
          await instanceSettingsService(db).getExperimental(),
          "experience_projection_v9",
        )
      )
        throw notFound("Experience profiles are not enabled");
      return db.transaction(async (tx) => {
        const service = experienceService(tx as unknown as Db),
          resolved = await service.context(actor, companyId, profile);
        if (!resolved.availableProfiles.includes(profile))
          throw forbidden(
            "This view is unavailable for your current permissions",
          );
        if (actor.source !== "local_implicit") {
          const [current] = await tx
            .select()
            .from(companyMemberships)
            .where(
              and(
                eq(companyMemberships.companyId, companyId),
                eq(companyMemberships.principalType, "user"),
                eq(companyMemberships.principalId, resolved.principal),
                eq(companyMemberships.status, "active"),
              ),
            )
            .for("share");
          if (!current) throw forbidden("Active company membership required");
        }
        await tx
          .insert(companyUserSidebarPreferences)
          .values({
            companyId,
            userId: resolved.principal,
            experienceProfile: profile,
          })
          .onConflictDoUpdate({
            target: [
              companyUserSidebarPreferences.companyId,
              companyUserSidebarPreferences.userId,
            ],
            set: { experienceProfile: profile, updatedAt: new Date() },
          });
        await tx.insert(activityLog).values({
          companyId,
          actorType: "user",
          actorId: resolved.principal,
          action: "experience.profile_changed",
          entityType: "user",
          entityId: resolved.principal,
          details: { profile },
        });
        return { profile };
      });
    },
    async home(
      actor: AuthorizationActor,
      companyId: string,
      signal?: AbortSignal,
      preferred?: ExperienceProfile,
    ) {
      return withExperienceAdmission(
        async (admittedSignal, remainingMs) => {
          const flags = await instanceSettingsService(db).getExperimental();
          if (!v9FeatureEnabled(flags, "experience_projection_v9")) {
            throw notFound("Experience projections are not enabled", {
              code: "v9_feature_disabled",
            });
          }
          const resolved = await context(actor, companyId, preferred);
          admittedSignal.throwIfAborted();
          const advancedLinks: NonNullable<ExperienceModel["advancedLinks"]> =
            [];
          const entries = [
            {
              id: "custom_agent",
              href: "/agents/new",
              action: "agents:create",
              enabled: true,
            },
            {
              id: "foundation",
              href: "/foundation",
              action: "foundation:read",
              enabled: flags.enableFoundationV1,
            },
            {
              id: "workflows",
              href: "/workflows",
              action: "workflows:read",
              enabled: flags.enableWorkflowsV1,
            },
            {
              id: "runtime",
              href: "/company/settings/runtime",
              action: "runtime:manage",
              enabled: true,
            },
            {
              id: "tool_gateway",
              href: "/apps/gateways",
              action: "tools:admin",
              enabled: true,
            },
            {
              id: "audit",
              href: "/activity",
              action: "tools:view_audit",
              enabled: true,
            },
            {
              id: "role_packs",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.role_packs,
              action: "company_scope:read",
              enabled: v5FeatureEnabled(flags, "role_packs_v5"),
            },
            {
              id: "skills",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.skills,
              action: "company_scope:read",
              enabled: true,
            },
            {
              id: "playbooks",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.playbooks,
              action: "foundation:read",
              enabled: v5FeatureEnabled(flags, "playbooks_v5"),
            },
            {
              id: "agent_identities",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.agent_identities,
              action: "company_scope:read",
              enabled: v5FeatureEnabled(flags, "agent_identities_v5"),
            },
            {
              id: "organization",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.organization,
              action: "company_scope:read",
              enabled: v5FeatureEnabled(flags, "org_units_v5"),
            },
            {
              id: "relationships",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.relationships,
              action: "company_scope:read",
              enabled: v5FeatureEnabled(flags, "company_relationships_v5"),
            },
            {
              id: "portfolio",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.portfolio,
              action: "company_scope:read",
              enabled: v5FeatureEnabled(flags, "portfolio_view_v5"),
            },
            {
              id: "shared_capabilities",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.shared_capabilities,
              action: "company_scope:read",
              enabled: v5FeatureEnabled(flags, "portfolio_skill_sharing_v5"),
            },
            {
              id: "memory",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.memory,
              action: "company_scope:read",
              enabled: flags.enableCollectiveMemoryV1,
            },
            {
              id: "derived_intelligence",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.derived_intelligence,
              action: "company_scope:read",
              enabled: v7FeatureEnabled(flags, "memory_observations_v7"),
            },
            {
              id: "learning",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.learning,
              action: "company_scope:read",
              enabled: v7FeatureEnabled(flags, "learning_engine_v7"),
            },
            {
              id: "cognitive_providers",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.cognitive_providers,
              action: "company_scope:read",
              enabled: v7FeatureEnabled(flags, "cognitive_memory_v7"),
            },
            {
              id: "readiness",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.readiness,
              action: "company_scope:read",
              enabled: v7FeatureEnabled(flags, "readiness_engine_v7"),
            },
            {
              id: "orchestration",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.orchestration,
              action: "company_scope:read",
              enabled: v7FeatureEnabled(flags, "orchestration_v7"),
            },
            {
              id: "security_events",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.security_events,
              action: "users:manage_permissions",
              enabled: v7FeatureEnabled(flags, "security_event_export_v7"),
            },
            {
              id: "experimental",
              href: EXPERIENCE_ADVANCED_DESTINATIONS.experimental,
              action: "company_scope:read",
              enabled:
                actor.source === "local_implicit" ||
                (actor.type === "board" && actor.isInstanceAdmin === true),
            },
          ] as const;
          const allowed = new Map<AuthorizationAction, boolean>();
          for (const entry of entries) {
            admittedSignal.throwIfAborted();
            if (!entry.enabled) continue;
            if (!allowed.has(entry.action))
              allowed.set(
                entry.action,
                (
                  await auth.decide({
                    actor,
                    action: entry.action,
                    resource: { type: "company", companyId },
                  })
                ).allowed,
              );
            if (allowed.get(entry.action))
              advancedLinks.push({ id: entry.id, href: entry.href });
          }
          const result = await composeExperience({
            companyId,
            profile: resolved.profile,
            signal: admittedSignal,
            deadlineMs: remainingMs(),
            readers: [
              {
                domain: "attention",
                read: async (signal) => {
                  const feed = await attentionService(db, {
                    materializeQueues: false,
                  }).list(companyId, {
                    userId: actor.userId ?? resolved.principal,
                    limit: 25,
                  });
                  signal.throwIfAborted();
                  const visible: AttentionItem[] = [];
                  for (const item of feed.items)
                    if (
                      await attentionIsVisible(actor, companyId, item, signal)
                    )
                      visible.push(item);
                  return {
                    needsYou: visible.map((item) => {
                      const source = {
                        domain: "attention" as const,
                        companyId,
                        resourceId: item.id,
                        version: item.updatedAt,
                        observedAt: feed.generatedAt,
                      };
                      return {
                        id: item.id,
                        kind:
                          item.sourceKind === "approval"
                            ? "approval"
                            : "decision",
                        title: item.subject.title ?? item.whyNow,
                        whyYou: item.whyNow,
                        consequence: null,
                        source,
                        freshness: "fresh",
                        evidence: [
                          item.subject.status ?? "Current attention item",
                        ],
                        actions: [
                          {
                            id: "open",
                            label: "Review",
                            labelKey: "review",
                            operation: "open",
                            href:
                              item.sourceKind === "decision"
                                ? `/needs-you?decisionId=${encodeURIComponent(item.subject.id)}`
                                : `/needs-you?attentionId=${encodeURIComponent(item.id)}`,
                            criticality:
                              item.severity === "critical" ? "C3" : "C2",
                            source,
                            requiresCurrentAuthorization: true,
                          },
                        ],
                      };
                    }) as ExperienceCard[],
                  };
                },
              },
              {
                domain: "tasks",
                read: async (signal) => {
                  const [active, completed] = await Promise.all([
                    issueService(db).list(companyId, {
                      status: "in_progress",
                      limit: 12,
                      sortField: "updated",
                      sortDir: "desc",
                    }),
                    issueService(db).list(companyId, {
                      status: "done",
                      limit: 12,
                      sortField: "updated",
                      sortDir: "desc",
                    }),
                  ]);
                  const project = async (
                    rows: typeof active,
                    kind: "progress" | "result",
                  ) => {
                    const cards: ExperienceCard[] = [];
                    for (const task of rows) {
                      signal.throwIfAborted();
                      const decision = await auth.decide({
                        actor,
                        action: "issue:read",
                        resource: {
                          type: "issue",
                          companyId,
                          issueId: task.id,
                          projectId: task.projectId,
                          assigneeAgentId: task.assigneeAgentId,
                          assigneeUserId: task.assigneeUserId,
                        },
                      });
                      if (!decision.allowed) continue;
                      const source = {
                        domain: "task" as const,
                        companyId,
                        resourceId: task.id,
                        version: String(task.statusVersion),
                        observedAt: new Date().toISOString(),
                      };
                      cards.push({
                        id: task.id,
                        kind,
                        title: task.title,
                        whyYou: null,
                        consequence: null,
                        source,
                        freshness: "fresh",
                        evidence: [task.status],
                        actions: [
                          {
                            id: "open",
                            label:
                              kind === "result" ? "View result" : "View task",
                            labelKey:
                              kind === "result" ? "view_result" : "view_task",
                            operation: "open",
                            href: `/issues/${encodeURIComponent(task.identifier ?? task.id)}`,
                            criticality: "C1",
                            source,
                            requiresCurrentAuthorization: true,
                          },
                        ],
                      });
                    }
                    return cards;
                  };
                  return {
                    inProgress: await project(active, "progress"),
                    done: await project(completed, "result"),
                  };
                },
              },
            ],
          });
          // Revocation during fan-out must suppress the whole result, not leak the snapshot.
          await currentMembership(actor, companyId);
          admittedSignal.throwIfAborted();
          return {
            ...result,
            availableProfiles: resolved.availableProfiles,
            advancedLinks,
          };
        },
        { signal },
      );
    },
  };
}
