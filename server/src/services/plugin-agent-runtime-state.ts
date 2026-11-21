import { and, desc, eq, sql } from "drizzle-orm";
import {
  agents,
  authUsers,
  companyMemberships,
  accountDeletionOperations,
  pluginCompanySettings,
  pluginConfig,
  plugins,
  companies,
  heartbeatRuns,
  agentExecutionManifests,
  resourceLifecycleEvents,
  type Db,
} from "@paperclipai/db";
import type { PluginAgentRuntimeState } from "@paperclipai/plugin-sdk";
import { conflict, forbidden } from "../errors.js";
import { agentService } from "./agents.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { companySkillService } from "./company-skills.js";
import { pluginAgentConnectionAssignments } from "./plugin-agent-connections.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { agentRuntimeFabricService } from "./agent-runtime-fabric.js";
import type { Agent } from "@paperclipai/shared";
import { redactAgentAdapterConfig, redactEventPayload } from "../redaction.js";

type BaseState = Omit<PluginAgentRuntimeState, "skills" | "connectionAssignments" | "skillsReady"> & {
  activeRunId: string | null;
  responsibleUserId: string | null;
  hasExecutionManifest: boolean;
};

type RuntimeAgentData = Agent & { lifecycleRequiredPluginIds?: string[]; errorReason?: string | null };

/** Preserve the canonical API redaction boundary for lifecycle-owner reads. */
export function redactPluginAgentRuntimeAgent(agent: RuntimeAgentData): Agent {
  const safe = { ...agent } as Agent & { lifecycleRequiredPluginIds?: string[] };
  delete safe.lifecycleRequiredPluginIds;
  delete safe.errorReason;
  const redacted = redactEventPayload(safe as unknown as Record<string, unknown>) ?? {};
  return {
    ...redacted,
    adapterConfig: redactAgentAdapterConfig(safe.adapterConfig),
  } as Agent;
}

async function readBaseState(
  db: Db,
  pluginId: string,
  companyId: string,
  agentId: string,
): Promise<BaseState | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)))
      .for("share");
    if (!row) return null;
    const [company] = await tx.select({ defaultResponsibleUserId: companies.defaultResponsibleUserId })
      .from(companies).where(eq(companies.id, companyId));
    const [plugin] = await tx.select({ status: plugins.status, manifest: plugins.manifestJson })
      .from(plugins).where(eq(plugins.id, pluginId));
    const [configuration] = await tx.select({ id: pluginConfig.id }).from(pluginConfig)
      .where(and(eq(pluginConfig.pluginId, pluginId), eq(pluginConfig.companyId, companyId)));
    const [settings] = await tx.select({ enabled: pluginCompanySettings.enabled }).from(pluginCompanySettings)
      .where(and(eq(pluginCompanySettings.pluginId, pluginId), eq(pluginCompanySettings.companyId, companyId)));
    if (plugin?.status !== "ready" || !configuration || settings?.enabled === false ||
        !plugin.manifest.capabilities.includes("events.subscribe") ||
        !plugin.manifest.capabilities.includes("agents.lifecycle.manage") ||
        plugin.manifest.agentLifecycle !== true || !plugin.manifest.resourceLifecycle?.includes("agent_runtime") ||
        !row.lifecycleRequiredPluginIds.includes(pluginId)) {
      throw forbidden("Agent runtime state requires the current assigned lifecycle owner");
    }
    const [run] = await tx.select({ id: heartbeatRuns.id, responsibleUserId: heartbeatRuns.responsibleUserId })
      .from(heartbeatRuns)
      .where(and(
        eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId),
        eq(heartbeatRuns.status, "running"),
        eq(heartbeatRuns.runtimeMode, "native"),
      )).orderBy(desc(heartbeatRuns.startedAt)).limit(1);
    const responsibleUserId = run?.responsibleUserId ?? company?.defaultResponsibleUserId ?? null;
    if (run && !responsibleUserId) throw forbidden("Active native runtime has no responsible Human");
    if (responsibleUserId) {
      const [human] = await tx.select({ id: authUsers.id }).from(authUsers).where(and(
        eq(authUsers.id, responsibleUserId),
        sql`NOT EXISTS (SELECT 1 FROM ${accountDeletionOperations} deletion WHERE deletion.user_id = ${authUsers.id})`,
      )).for("share", { noWait: true });
      const [membership] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, responsibleUserId),
        eq(companyMemberships.status, "active"),
      )).for("share", { noWait: true });
      if (!human || !membership) throw forbidden("Agent runtime state requires its current active Human membership");
      const actor: AuthorizationActor = {
        type: "agent", source: "none", agentId, companyId, onBehalfOfUserId: responsibleUserId,
        ...(run ? { runId: run.id } : {}),
      };
      await assertV5Authorization(tx as unknown as Db, actor, companyId, "agent_config:read", {
        type: "agent", companyId, agentId,
      });
    }
    const [manifest] = run ? await tx.select({ id: agentExecutionManifests.id }).from(agentExecutionManifests)
      .where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.runId, run.id))).limit(1) : [];
    const [latest] = await tx.select({ id: resourceLifecycleEvents.id }).from(resourceLifecycleEvents)
      .where(and(
        eq(resourceLifecycleEvents.companyId, companyId),
        eq(resourceLifecycleEvents.resourceType, "agent_runtime"),
        eq(resourceLifecycleEvents.resourceId, agentId),
      )).orderBy(desc(resourceLifecycleEvents.id)).limit(1);
    const currentAgent = await agentService(tx as unknown as Db).getById(agentId);
    if (!currentAgent) return null;
    const agentForPlugin = redactPluginAgentRuntimeAgent(currentAgent as Agent);
    const instructions = await agentInstructionsService(tx as unknown as Db).getBundle(row);
    return {
      revision: latest?.id.toString() ?? "0",
      agent: agentForPlugin,
      instructionsRootPath: instructions.rootPath,
      instructionsEntryFile: instructions.entryFile,
      activeRunId: run?.id ?? null,
      responsibleUserId,
      hasExecutionManifest: Boolean(manifest),
    };
  });
}

/** Resolve a bounded current snapshot; revision changes during source resolution cause retry. */
export async function pluginAgentRuntimeState(
  db: Db,
  pluginId: string,
  companyId: string,
  agentId: string,
): Promise<PluginAgentRuntimeState | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readBaseState(db, pluginId, companyId, agentId);
    if (!state) return null;
    const actor: AuthorizationActor = {
      type: "agent", source: "none", agentId, companyId,
      ...(state.activeRunId ? { runId: state.activeRunId } : {}),
      ...(state.responsibleUserId ? { onBehalfOfUserId: state.responsibleUserId } : {}),
    };
    const execution = state.activeRunId && state.hasExecutionManifest
      ? await agentRuntimeFabricService(db).getManifest(actor, companyId, state.activeRunId)
      : null;
    const skillsService = companySkillService(db);
    const resolvedSkills = state.activeRunId && execution
      ? await skillsService.listRuntimeSkillEntriesForCurrentExecution(companyId, actor, state.activeRunId)
      : [];
    const skills = resolvedSkills.map((skill) => ({
      key: skill.key,
      runtimeName: skill.runtimeName,
      source: skill.source,
      versionId: skill.versionId ?? null,
      currentVersionId: skill.currentVersionId ?? null,
      sourceStatus: skill.sourceStatus === "missing" ? "missing" as const : "available" as const,
      missingDetail: skill.missingDetail ?? null,
    }));
    const connectionAssignments = await pluginAgentConnectionAssignments(db, companyId, agentId);
    const current = await readBaseState(db, pluginId, companyId, agentId);
    if (!current) return null;
    if (current.revision === state.revision && current.activeRunId === state.activeRunId && current.responsibleUserId === state.responsibleUserId) {
      const { activeRunId, responsibleUserId, hasExecutionManifest, ...publicState } = current;
      void activeRunId;
      void responsibleUserId;
      void hasExecutionManifest;
      return { ...publicState, skillsReady: state.activeRunId !== null && state.hasExecutionManifest, skills, connectionAssignments };
    }
  }
  throw conflict("Agent runtime changed while resolving synchronization inputs; retry");
}
