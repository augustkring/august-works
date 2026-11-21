import { readCompanyResponsibilityAttention } from "./company-responsibility-attention.js";
import { readCoreMaintenance } from "./core-maintenance.js";
import { readMemoryMaintenanceAttention } from "./memory-maintenance-attention.js";
import { readConnectorRecovery } from "./connector-recovery.js";
import { readWorkflowRecovery } from "./workflow-recovery.js";
import { readPackageMaintenanceAttention } from "./maintenance-attention.js";
import { readRuntimeRecovery } from "./runtime-recovery.js";
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
  experienceModelSchema,
  v9FeatureEnabled,
  v5FeatureEnabled,
  v7FeatureEnabled,
  v6FeatureEnabled,
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
import { attentionExperienceCard } from "./attention-card.js";

export function experienceService(db: Db, configuredOperatorUserIds: readonly string[] = []) {
  const auth = authorizationService(db);
  /** Visibility of each attention item, in order. An item is visible only
   * when every Task it names (subject, related Task, metadata Task ids and
   * the Tasks linked to an approval) exists in this company and is readable,
   * and its project and agent are readable. Each check is the same as one
   * item at a time; the Tasks' issue:read decisions run together so their
   * privacy probes share one statement (PERF5). */
  async function attentionVisibility(
    actor: AuthorizationActor,
    companyId: string,
    items: readonly AttentionItem[],
    signal: AbortSignal,
  ): Promise<boolean[]> {
    const issueIdsByItem: Array<Set<string> | null> = [];
    for (const item of items) {
      if (item.companyId !== companyId || item.subject.companyId !== companyId) {
        issueIdsByItem.push(null);
        continue;
      }
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
        if (links.length > 25) {
          issueIdsByItem.push(null);
          continue;
        }
        for (const link of links) issueIds.add(link.id);
      }
      issueIdsByItem.push(issueIds);
    }
    const tasks = new Map<string, Awaited<ReturnType<ReturnType<typeof issueService>["getById"]>>>();
    for (const issueIds of issueIdsByItem) {
      for (const id of issueIds ?? []) {
        if (tasks.has(id)) continue;
        signal.throwIfAborted();
        tasks.set(id, await issueService(db).getById(id));
      }
    }
    signal.throwIfAborted();
    const readableTasks = [...tasks.entries()].flatMap(([id, task]) =>
      task && task.companyId === companyId ? [{ id, task }] : [],
    );
    const decisions = await auth.decideIssueReads(
      actor,
      readableTasks.map(({ task }) => ({
        type: "issue" as const,
        companyId,
        issueId: task!.id,
        projectId: task!.projectId,
        assigneeAgentId: task!.assigneeAgentId,
        assigneeUserId: task!.assigneeUserId,
      })),
    );
    const taskReadable = new Map(
      readableTasks.map(({ id }, index) => [id, decisions[index]?.allowed === true]),
    );
    const visible: boolean[] = [];
    for (const [index, item] of items.entries()) {
      const issueIds = issueIdsByItem[index];
      if (!issueIds || [...issueIds].some((id) => taskReadable.get(id) !== true)) {
        visible.push(false);
        continue;
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
      ) {
        visible.push(false);
        continue;
      }
      if (
        item.subject.kind === "agent" &&
        !(
          await auth.decide({
            actor,
            action: "agent:read",
            resource: { type: "agent", companyId, agentId: item.subject.id },
          })
        ).allowed
      ) {
        visible.push(false);
        continue;
      }
      visible.push(true);
    }
    return visible;
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
          const taskSnapshots = new Map<string, number>();
          admittedSignal.throwIfAborted();
          const advancedLinks: NonNullable<ExperienceModel["advancedLinks"]> =
            [];
          const entries = [
            {
              id: "custom_agent",
              href: "/agents/custom",
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
              ...(v9FeatureEnabled(flags, "maintenance_autopilot_v9") && v7FeatureEnabled(flags, "core_stewards_v7") && v7FeatureEnabled(flags, "readiness_engine_v7")
                ? [{ domain: "core-maintenance", read: (signal: AbortSignal) => readCoreMaintenance(db, actor, companyId, signal) }]
                : []),
              ...(v9FeatureEnabled(flags, "maintenance_autopilot_v9") && flags.enableCollectiveMemoryV1
                ? [{ domain: "memory-maintenance", read: (signal: AbortSignal) => readMemoryMaintenanceAttention(db, actor, companyId, signal) }]
                : []),
              ...(v9FeatureEnabled(flags, "maintenance_autopilot_v9")
                ? [{ domain: "connector-recovery", read: (signal: AbortSignal) => readConnectorRecovery(db, actor, companyId, signal) }]
                : []),
              ...(v9FeatureEnabled(flags, "maintenance_autopilot_v9") && v9FeatureEnabled(flags, "progressive_shell_v9") && flags.enableWorkflowsV1
                ? [{ domain: "workflow-recovery", read: (signal: AbortSignal) => readWorkflowRecovery(db, actor, companyId, signal) }]
                : []),
              ...(v9FeatureEnabled(flags, "maintenance_autopilot_v9") && v6FeatureEnabled(flags, "hosted_openclaw_v6")
                ? [{ domain: "runtime-recovery", read: (signal: AbortSignal) => readRuntimeRecovery(db, actor, companyId, signal) }]
                : []),
              ...(v9FeatureEnabled(flags, "maintenance_autopilot_v9") &&
              v7FeatureEnabled(flags, "agent_packages_v7")
                ? [
                    {
                      domain: "maintenance",
                      read: (signal: AbortSignal) =>
                        readPackageMaintenanceAttention(
                          db,
                          actor,
                          companyId,
                          signal,
                        ),
                    },
                  ]
                : []),
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
                  const visibility = await attentionVisibility(
                    actor,
                    companyId,
                    feed.items,
                    signal,
                  );
                  const visible = feed.items.filter(
                    (_, index) => visibility[index],
                  );
                  let responsibilityCards: ExperienceCard[] = [];
                  let responsibilityUnavailable: "source_stale" | "source_unavailable" | "overflow" | null = null;
                  try {
                    const companyResponsibility = await readCompanyResponsibilityAttention(db, actor, companyId, signal, configuredOperatorUserIds);
                    responsibilityCards = [...companyResponsibility.needsYou];
                    responsibilityUnavailable = typeof companyResponsibility.coverage === "object"
                      ? companyResponsibility.coverage.reason : null;
                  } catch {
                    signal.throwIfAborted();
                    responsibilityUnavailable = "source_stale";
                  }
                  return {
                    ...(feed.nextCursor || responsibilityUnavailable
                      ? {
                          coverage: {
                            state: "partial" as const,
                            reason: responsibilityUnavailable ?? "more_items_available" as const,
                          },
                        }
                      : {}),
                    needsYou: [
                      ...responsibilityCards,
                      ...visible.map((item) => attentionExperienceCard(item, feed.generatedAt)),
                    ],
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
                  // One issue:read decision per Task, as before; the Task
                  // privacy probe of all 24 candidates runs as one statement.
                  signal.throwIfAborted();
                  const candidates = [...active, ...completed];
                  const decisions = await auth.decideIssueReads(
                    actor,
                    candidates.map((task) => ({
                      type: "issue" as const,
                      companyId,
                      issueId: task.id,
                      projectId: task.projectId,
                      assigneeAgentId: task.assigneeAgentId,
                      assigneeUserId: task.assigneeUserId,
                    })),
                  );
                  const allowed = new Set(
                    candidates
                      .filter((_, index) => decisions[index]?.allowed === true)
                      .map((task) => task.id),
                  );
                  const project = async (
                    rows: typeof active,
                    kind: "progress" | "result",
                  ) => {
                    const cards: ExperienceCard[] = [];
                    for (const task of rows) {
                      signal.throwIfAborted();
                      if (!allowed.has(task.id)) continue;
                      taskSnapshots.set(
                        task.id,
                        new Date(task.updatedAt).getTime(),
                      );
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
          // Native source checks are repeated after fan-out, within the same
          // admission/deadline. An earlier allowed decision is not a receipt
          // for a resource that has since become private or changed.
          const markPartial = (
            domain: string,
            reason: "denied" | "source_stale" | "source_unavailable" | "overflow" | "more_items_available",
          ) => {
            const dependency = result.dependencies.find(
              (entry) => entry.domain === domain,
            );
            if (dependency) {
              dependency.state = "partial";
              dependency.reason = reason;
            }
          };
          // Re-read every card's Task first, then decide issue:read for each
          // current one (privacy probes batched as in the reader). Outcomes are
          // applied in the original card order, so the reported reason is the
          // same as one-card-at-a-time.
          const rechecks: Array<{
            section: "inProgress" | "done";
            card: ExperienceCard;
            task: Awaited<ReturnType<ReturnType<typeof issueService>["getById"]>>;
            stale: boolean;
          }> = [];
          for (const section of ["inProgress", "done"] as const) {
            for (const card of result[section]) {
              admittedSignal.throwIfAborted();
              const task = await issueService(db).getById(
                card.source.resourceId,
              );
              const stale =
                !task ||
                task.companyId !== companyId ||
                !!task.hiddenAt ||
                String(task.statusVersion) !== card.source.version ||
                new Date(task.updatedAt).getTime() !==
                  taskSnapshots.get(task.id);
              rechecks.push({ section, card, task, stale });
            }
          }
          admittedSignal.throwIfAborted();
          const currentTasks = rechecks.flatMap((entry) =>
            entry.stale || !entry.task ? [] : [entry.task],
          );
          const currentDecisions = await auth.decideIssueReads(
            actor,
            currentTasks.map((task) => ({
              type: "issue" as const,
              companyId,
              issueId: task.id,
              projectId: task.projectId,
              assigneeAgentId: task.assigneeAgentId,
              assigneeUserId: task.assigneeUserId,
            })),
          );
          const currentlyAllowed = new Map(
            currentTasks.map((task, index) => [
              task,
              currentDecisions[index]?.allowed === true,
            ]),
          );
          const currentCards = {
            inProgress: [] as ExperienceCard[],
            done: [] as ExperienceCard[],
          };
          for (const entry of rechecks) {
            if (entry.stale || !entry.task) {
              markPartial("tasks", "source_stale");
              continue;
            }
            if (!currentlyAllowed.get(entry.task)) {
              markPartial("tasks", "denied");
              continue;
            }
            currentCards[entry.section].push(entry.card);
          }
          result.inProgress = currentCards.inProgress;
          result.done = currentCards.done;
          if (
            result.needsYou.some((card) => card.source.domain === "attention")
          ) {
            const feed = await attentionService(db, {
              materializeQueues: false,
            }).list(companyId, {
              userId: actor.userId ?? resolved.principal,
              limit: 25,
            });
            const current = new Map(feed.items.map((item) => [item.id, item]));
            const cards: ExperienceCard[] = [];
            const attentionCards = result.needsYou
              .filter((card) => card.source.domain === "attention")
              .map((card) => {
                const item = current.get(card.source.resourceId);
                return item && item.updatedAt === card.source.version
                  ? { card, item }
                  : { card, item: null };
              });
            admittedSignal.throwIfAborted();
            const currentItems = attentionCards.flatMap((entry) =>
              entry.item ? [entry.item] : [],
            );
            const currentVisibility = await attentionVisibility(
              actor,
              companyId,
              currentItems,
              admittedSignal,
            );
            const visibleNow = new Map(
              currentItems.map((item, index) => [item, currentVisibility[index]]),
            );
            for (const { item } of attentionCards) {
              admittedSignal.throwIfAborted();
              if (!item) {
                markPartial("attention", "source_stale");
                continue;
              }
              if (!visibleNow.get(item)) {
                markPartial("attention", "denied");
                continue;
              }
              cards.push(attentionExperienceCard(item, feed.generatedAt));
            }
            result.needsYou = [
              ...cards,
              ...result.needsYou.filter(
                (card) => card.source.domain !== "attention",
              ),
            ];
          }
          if (result.needsYou.some(card => card.source.domain === "company_responsibility")) {
            try {
              const current = await readCompanyResponsibilityAttention(db, actor, companyId, admittedSignal, configuredOperatorUserIds);
              const cards = new Map(current.needsYou.map(card => [card.id, card]));
              if (typeof current.coverage === "object") markPartial("attention", current.coverage.reason);
              result.needsYou = result.needsYou.flatMap(card => {
                if (card.source.domain !== "company_responsibility") return [card];
                const fresh = cards.get(card.id);
                if (fresh?.source.version === card.source.version) return [fresh];
                markPartial("attention", "source_stale");
                return [];
              });
            } catch {
              admittedSignal.throwIfAborted();
              result.needsYou = result.needsYou.filter(card => card.source.domain !== "company_responsibility");
              markPartial("attention", "denied");
            }
          }
          const isAutomaticPackageMaintenance = (card: ExperienceCard) => card.source.domain === "agent_package_installation" &&
            !card.evidence.includes("package_revalidation_required");
          if (result.needsYou.some(isAutomaticPackageMaintenance)) {
            try {
              const reread = await readPackageMaintenanceAttention(
                db,
                actor,
                companyId,
                admittedSignal,
              );
              const current = new Map(
                reread.needsYou.map((card) => [card.id, card]),
              );
              result.needsYou = result.needsYou.flatMap((card) => {
                if (!isAutomaticPackageMaintenance(card))
                  return [card];
                const source = current.get(card.id);
                if (!source || source.source.version !== card.source.version) {
                  markPartial("maintenance", "source_stale");
                  return [];
                }
                return [source];
              });
              if (reread.coverage) {
                const dependency = result.dependencies.find(
                  (entry) => entry.domain === "maintenance",
                );
                if (dependency) {
                  dependency.state = "partial";
                  dependency.reason = reread.coverage.reason;
                }
              }
            } catch {
              admittedSignal.throwIfAborted();
              result.needsYou = result.needsYou.filter(
                (card) => !isAutomaticPackageMaintenance(card),
              );
              markPartial("maintenance", "denied");
            }
          }
          for (const action of allowed.keys()) {
            admittedSignal.throwIfAborted();
            allowed.set(
              action,
              (
                await auth.decide({
                  actor,
                  action,
                  resource: { type: "company", companyId },
                })
              ).allowed,
            );
          }
          if (result.needsYou.some(card => card.source.domain === "memory_job")) {
            try {
              const reread = await readMemoryMaintenanceAttention(db, actor, companyId, admittedSignal);
              const current = new Map(reread.needsYou.map(card => [card.id, card]));
              result.needsYou = result.needsYou.flatMap(card => {
                if (card.source.domain !== "memory_job") return [card];
                const source = current.get(card.id);
                if (!source || source.source.version !== card.source.version) {
                  markPartial("memory-maintenance", "source_stale"); return [];
                }
                return [source];
              });
              if (reread.coverage) markPartial("memory-maintenance", reread.coverage.reason);
            } catch (error) {
              admittedSignal.throwIfAborted();
              result.needsYou = result.needsYou.filter(card => card.source.domain !== "memory_job");
              markPartial("memory-maintenance", "denied");
            }
          }
          const isCoreMaintenance = (card: ExperienceCard) => card.kind === "maintenance" &&
            (["readiness", "company_skill", "playbook"].includes(card.source.domain) ||
              card.source.domain === "agent_package_installation" && card.evidence.includes("package_revalidation_required"));
          if (result.needsYou.some(isCoreMaintenance)) {
            try {
              const reread = await readCoreMaintenance(db, actor, companyId, admittedSignal);
              const current = new Map(reread.needsYou.map(card => [card.id, card]));
              result.needsYou = result.needsYou.flatMap(card => {
                if (!isCoreMaintenance(card)) return [card];
                const source = current.get(card.id);
                if (!source || source.source.version !== card.source.version) {
                  markPartial("core-maintenance", "source_stale"); return [];
                }
                return [source];
              });
              if (reread.coverage) {
                const dependency = result.dependencies.find(entry => entry.domain === "core-maintenance");
                if (dependency) { dependency.state = "partial"; dependency.reason = reread.coverage.reason; }
              }
            } catch {
              admittedSignal.throwIfAborted();
              result.needsYou = result.needsYou.filter(card => !isCoreMaintenance(card));
              markPartial("core-maintenance", "denied");
            }
          }
          if (result.needsYou.some(card => card.source.domain === "connection" && card.kind === "recovery")) {
            try {
              const reread = await readConnectorRecovery(db, actor, companyId, admittedSignal);
              const current = new Map(reread.needsYou.map(card => [card.id, card]));
              result.needsYou = result.needsYou.flatMap(card => {
                if (card.source.domain !== "connection" || card.kind !== "recovery") return [card];
                const source = current.get(card.id);
                if (!source || source.source.version !== card.source.version) {
                  markPartial("connector-recovery", "source_stale"); return [];
                }
                return [source];
              });
              if (reread.coverage) {
                const dependency = result.dependencies.find(entry => entry.domain === "connector-recovery");
                if (dependency) { dependency.state = "partial"; dependency.reason = reread.coverage.reason; }
              }
            } catch {
              admittedSignal.throwIfAborted();
              result.needsYou = result.needsYou.filter(card => card.source.domain !== "connection" || card.kind !== "recovery");
              markPartial("connector-recovery", "denied");
            }
          }
          if (result.needsYou.some(card => card.source.domain === "workflow" && card.kind === "recovery")) {
            try {
              const reread = await readWorkflowRecovery(db, actor, companyId, admittedSignal);
              const current = new Map(reread.needsYou.map(card => [card.id, card]));
              result.needsYou = result.needsYou.flatMap(card => {
                if (card.source.domain !== "workflow" || card.kind !== "recovery") return [card];
                const source = current.get(card.id);
                if (!source || source.source.version !== card.source.version) {
                  markPartial("workflow-recovery", "source_stale"); return [];
                }
                return [source];
              });
              if (reread.coverage) {
                const dependency = result.dependencies.find(entry => entry.domain === "workflow-recovery");
                if (dependency) { dependency.state = "partial"; dependency.reason = reread.coverage.reason; }
              }
            } catch {
              admittedSignal.throwIfAborted();
              result.needsYou = result.needsYou.filter(card => card.source.domain !== "workflow" || card.kind !== "recovery");
              markPartial("workflow-recovery", "denied");
            }
          }
          if (result.needsYou.some(card => card.source.domain === "runtime_cell")) {
            try {
              const reread = await readRuntimeRecovery(db, actor, companyId, admittedSignal);
              const current = new Map(reread.needsYou.map(card => [card.id, card]));
              result.needsYou = result.needsYou.flatMap(card => {
                if (card.source.domain !== "runtime_cell") return [card];
                const source = current.get(card.id);
                if (!source || source.source.version !== card.source.version) {
                  markPartial("runtime-recovery", "source_stale"); return [];
                }
                return [source];
              });
              if (reread.coverage) {
                const dependency = result.dependencies.find(entry => entry.domain === "runtime-recovery");
                if (dependency) { dependency.state = "partial"; dependency.reason = reread.coverage.reason; }
              }
            } catch {
              admittedSignal.throwIfAborted();
              result.needsYou = result.needsYou.filter(card => card.source.domain !== "runtime_cell");
              markPartial("runtime-recovery", "denied");
            }
          }
          const currentFlags =
            await instanceSettingsService(db).getExperimental();
          if (JSON.stringify(currentFlags) !== JSON.stringify(flags))
            throw notFound("Experience context changed", {
              code: "v9_context_changed",
            });
          const current = await context(actor, companyId, preferred);
          admittedSignal.throwIfAborted();
          return experienceModelSchema.parse({
            ...result,
            profile: current.profile,
            availableProfiles: current.availableProfiles,
            advancedLinks: advancedLinks.filter((link) => {
              const entry = entries.find((entry) => entry.id === link.id);
              return entry && allowed.get(entry.action);
            }),
          });
        },
        { signal },
      );
    },
  };
}
