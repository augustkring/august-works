import { and, eq, ilike, isNull, ne, desc } from "drizzle-orm";
import { agents, projects, issues, type Db } from "@paperclipai/db";
import {
  EXPERIENCE_COMMAND_DESTINATIONS,
  experienceCommandsSchema,
  parseExperienceCommand,
  v9FeatureEnabled,
  v8FeatureEnabled,
  type ExperienceCommands,
  type ExperienceCommandId,
} from "@paperclipai/shared";
import {
  authorizationService,
  type AuthorizationAction,
  type AuthorizationActor,
} from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { experienceService } from "./service.js";
import { withExperienceAdmission } from "./admission.js";
import { visibleIssueCondition } from "../issue-visibility.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import { isDeepStrictEqual } from "node:util";

export async function experienceCommands(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  query: string,
  signal?: AbortSignal,
) {
  return withExperienceAdmission(
    async (signal) => {
      const settings = instanceSettingsService(db),
        flags = await settings.getExperimental();
      if (!v9FeatureEnabled(flags, "ambient_commands_v9"))
        throw notFound("Commands are not enabled");
      const context = await experienceService(db).context(actor, companyId),
        auth = authorizationService(db);
      const intent = parseExperienceCommand(query);
      const commands: ExperienceCommands["commands"] = [];
      const definitions: Array<{
        id: ExperienceCommandId;
        group: "navigate" | "create" | "run" | "ask";
        action?: AuthorizationAction;
        enabled?: boolean;
      }> = [
        {
          id: "home",
          group: "navigate",
        },
        { id: "needs_you", group: "navigate" },
        { id: "work", group: "navigate" },
        { id: "agents", group: "navigate" },
        { id: "projects", group: "navigate" },
        { id: "apps", group: "navigate", action: "tools:use" },
        {
          id: "company",
          group: "navigate",
          enabled:
            v9FeatureEnabled(flags, "progressive_shell_v9") &&
            (context.profile === "admin" ||
              context.profile === "security_admin"),
        },
        {
          id: "insights",
          group: "navigate",
          enabled:
            context.profile !== "member" &&
            v9FeatureEnabled(flags, "progressive_shell_v9") &&
            (
              [
                "business_metrics_v8",
                "process_intelligence_v8",
                "business_forecasting_v8",
                "scenario_planning_v8",
                "management_reviews_v8",
              ] as const
            ).some((feature) => v8FeatureEnabled(flags, feature)),
          action: "tools:use",
        },
        {
          id: "advanced",
          group: "navigate",
          enabled: v9FeatureEnabled(flags, "progressive_shell_v9"),
        },
        { id: "search", group: "navigate" },
        // This opens an editable native draft. Assignment/access/effects are checked by the native create owner.
        { id: "create_task", group: "create" },
        {
          id: "connect_app",
          group: "create",
          action: "tools:manage_connections",
        },
        {
          id: "run_workflow",
          group: "run",
          action: "workflows:run",
          enabled: flags.enableWorkflowsV1 && flags.enableWorkflowBuilderV1,
        },
      ];
      const decisions = new Map<AuthorizationAction, boolean>();
      async function allowed(action: AuthorizationAction) {
        if (!decisions.has(action))
          decisions.set(
            action,
            (
              await auth.decide({
                actor,
                action,
                resource: { type: "company", companyId },
              })
            ).allowed,
          );
        return decisions.get(action) === true;
      }
      for (const definition of definitions) {
        signal.throwIfAborted();
        if (definition.enabled === false) continue;
        if (definition.action && !(await allowed(definition.action))) continue;
        if (
          definition.id === "run_workflow" &&
          !(await allowed("workflows:read"))
        )
          continue;
        commands.push({
          id: definition.id,
          href: EXPERIENCE_COMMAND_DESTINATIONS[definition.id],
          group: definition.group,
          canonicalAuthorizationRequired: true,
        });
      }
      const resources: ExperienceCommands["resources"] = [];
      if (intent.kind === "resources") {
        // Literal bounded matching, not an LLM. Database text is never instructions.
        const match = `%${intent.text.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
        if (intent.resourceKind === "agent" || intent.resourceKind === "all") {
          const rows = await db
            .select({
              id: agents.id,
              title: agents.name,
              updatedAt: agents.updatedAt,
            })
            .from(agents)
            .where(
              and(
                eq(agents.companyId, companyId),
                ne(agents.status, "terminated"),
                ilike(agents.name, match),
              ),
            )
            .orderBy(desc(agents.updatedAt), desc(agents.id))
            .limit(6);
          for (const row of rows) {
            signal.throwIfAborted();
            if (
              (
                await auth.decide({
                  actor,
                  action: "agent:read",
                  resource: { type: "agent", companyId, agentId: row.id },
                })
              ).allowed
            )
              resources.push({
                id: row.id,
                title: row.title.slice(0, 2000),
                companyId,
                kind: "agent",
                href: `/agents/${row.id}`,
                version: row.updatedAt.toISOString(),
              });
          }
        }
        if (
          intent.resourceKind === "project" ||
          intent.resourceKind === "all"
        ) {
          const rows = await db
            .select({
              id: projects.id,
              title: projects.name,
              updatedAt: projects.updatedAt,
            })
            .from(projects)
            .where(
              and(
                eq(projects.companyId, companyId),
                isNull(projects.archivedAt),
                ilike(projects.name, match),
              ),
            )
            .orderBy(desc(projects.updatedAt), desc(projects.id))
            .limit(6);
          for (const row of rows) {
            signal.throwIfAborted();
            if (
              (
                await auth.decide({
                  actor,
                  action: "project:read",
                  resource: { type: "project", companyId, projectId: row.id },
                })
              ).allowed
            )
              resources.push({
                id: row.id,
                title: row.title.slice(0, 2000),
                companyId,
                kind: "project",
                href: `/projects/${row.id}`,
                version: row.updatedAt.toISOString(),
              });
          }
        }
        if (intent.resourceKind === "task" || intent.resourceKind === "all") {
          const rows = await db
            .select({
              id: issues.id,
              title: issues.title,
              updatedAt: issues.updatedAt,
              projectId: issues.projectId,
              assigneeAgentId: issues.assigneeAgentId,
              assigneeUserId: issues.assigneeUserId,
            })
            .from(issues)
            .where(
              and(
                eq(issues.companyId, companyId),
                visibleIssueCondition(),
                ilike(issues.title, match),
              ),
            )
            .orderBy(desc(issues.updatedAt), desc(issues.id))
            .limit(6);
          for (const row of rows) {
            signal.throwIfAborted();
            if (
              (
                await auth.decide({
                  actor,
                  action: "issue:read",
                  resource: {
                    type: "issue",
                    companyId,
                    issueId: row.id,
                    projectId: row.projectId,
                    assigneeAgentId: row.assigneeAgentId,
                    assigneeUserId: row.assigneeUserId,
                  },
                })
              ).allowed
            )
              resources.push({
                id: row.id,
                title: row.title.slice(0, 2000),
                companyId,
                kind: "task",
                href: `/issues/${row.id}`,
                version: row.updatedAt.toISOString(),
              });
          }
        }
      }
      signal.throwIfAborted();
      async function assertCurrentAllowed(
        input: Parameters<typeof auth.decide>[0],
      ) {
        signal.throwIfAborted();
        if (!(await auth.decide(input)).allowed)
          throw forbidden("Command access changed; search again");
        signal.throwIfAborted();
      }
      // Resource-specific authority and versions can change while other kinds
      // are being read. Company membership alone cannot release retained names.
      for (const resource of resources) {
        signal.throwIfAborted();
        if (resource.kind === "agent") {
          const [current] = await db
            .select({ name: agents.name, updatedAt: agents.updatedAt })
            .from(agents)
            .where(
              and(
                eq(agents.companyId, companyId),
                eq(agents.id, resource.id),
                ne(agents.status, "terminated"),
              ),
            );
          if (
            !current ||
            current.updatedAt.toISOString() !== resource.version ||
            current.name.slice(0, 2000) !== resource.title
          )
            throw conflict("Command results changed; search again");
          await assertCurrentAllowed({
            actor,
            action: "agent:read",
            resource: { type: "agent", companyId, agentId: resource.id },
          });
        } else if (resource.kind === "project") {
          const [current] = await db
            .select({ name: projects.name, updatedAt: projects.updatedAt })
            .from(projects)
            .where(
              and(
                eq(projects.companyId, companyId),
                eq(projects.id, resource.id),
                isNull(projects.archivedAt),
              ),
            );
          if (
            !current ||
            current.updatedAt.toISOString() !== resource.version ||
            current.name.slice(0, 2000) !== resource.title
          )
            throw conflict("Command results changed; search again");
          await assertCurrentAllowed({
            actor,
            action: "project:read",
            resource: { type: "project", companyId, projectId: resource.id },
          });
        } else {
          const [current] = await db
            .select({
              title: issues.title,
              updatedAt: issues.updatedAt,
              projectId: issues.projectId,
              assigneeAgentId: issues.assigneeAgentId,
              assigneeUserId: issues.assigneeUserId,
            })
            .from(issues)
            .where(
              and(
                eq(issues.companyId, companyId),
                eq(issues.id, resource.id),
                visibleIssueCondition(),
              ),
            );
          if (
            !current ||
            current.updatedAt.toISOString() !== resource.version ||
            current.title.slice(0, 2000) !== resource.title
          )
            throw conflict("Command results changed; search again");
          await assertCurrentAllowed({
            actor,
            action: "issue:read",
            resource: {
              type: "issue",
              companyId,
              issueId: resource.id,
              projectId: current.projectId,
              assigneeAgentId: current.assigneeAgentId,
              assigneeUserId: current.assigneeUserId,
            },
          });
        }
      }
      // Never reuse the initial command-availability decisions for release.
      for (const command of commands) {
        const definition = definitions.find(
          (entry) => entry.id === command.id,
        )!;
        if (definition.action)
          await assertCurrentAllowed({
            actor,
            action: definition.action,
            resource: { type: "company", companyId },
          });
        if (command.id === "run_workflow")
          await assertCurrentAllowed({
            actor,
            action: "workflows:read",
            resource: { type: "company", companyId },
          });
      }
      const currentContext = await experienceService(db).context(
        actor,
        companyId,
      );
      if (currentContext.profile !== context.profile)
        throw forbidden("Command access changed; search again");
      const currentFlags = await settings.getExperimental();
      if (!isDeepStrictEqual(flags, currentFlags))
        throw conflict("Command context changed; search again");
      if (!v9FeatureEnabled(currentFlags, "ambient_commands_v9"))
        throw notFound("Commands are not enabled");
      signal.throwIfAborted();
      return experienceCommandsSchema.parse({
        companyId,
        profile: context.profile,
        observedAt: new Date().toISOString(),
        commands,
        resources,
        semanticDrafting: "unqualified",
      });
    },
    { signal },
  );
}
