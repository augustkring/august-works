import { and, desc, eq, sql } from "drizzle-orm";
import {
  agents,
  authUsers,
  companyMemberships,
  accountDeletionOperations,
  pluginCompanySettings,
  pluginConfig,
  plugins,
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
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { skillVersionSelectionMap } from "./runtime-skill-selections.js";
import { instanceSettingsService } from "./instance-settings.js";
import { pluginAgentConnectionAssignments } from "./plugin-agent-connections.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { agentRuntimeFabricService } from "./agent-runtime-fabric.js";
import type { Agent } from "@paperclipai/shared";
import { redactAgentAdapterConfig, redactEventPayload } from "../redaction.js";

type BaseState = Omit<PluginAgentRuntimeState, "skills" | "connectionAssignments"> & {
  activeRunId: string | null;
  responsibleUserId: string;
  hasExecutionManifest: boolean;
};

/** Preserve the canonical API redaction boundary for lifecycle-owner reads. */
export function redactPluginAgentRuntimeAgent(agent: Agent): Agent {
  const safe = { ...agent } as Agent & { lifecycleRequiredPluginIds?: string[] };
  delete safe.lifecycleRequiredPluginIds;
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
    const responsibleUserId = run?.responsibleUserId ?? row.responsibleUserId;
    if (!responsibleUserId) throw forbidden("Agent runtime state requires its current responsible Human");
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
      onBehalfOfUserId: state.responsibleUserId,
    };
    const execution = state.activeRunId && state.hasExecutionManifest
      ? await agentRuntimeFabricService(db).getManifest(actor, companyId, state.activeRunId)
      : null;
    const preference = readPaperclipSkillSyncPreference(state.agent.adapterConfig);
    const settings = await instanceSettingsService(db).getExperimental();
    const resolvedSkills = state.activeRunId ? await companySkillService(db).listRuntimeSkillEntries(companyId, {
        actor,
        readScope: "task",
        selectionConfig: state.agent.adapterConfig,
        includeLegacy: state.agent.adapterType !== "paperclip_runner",
        snapshotLatest: true,
        ...(execution ? {
          selectedSkillKeys: new Set(execution.manifest.skills.map((pin) => pin.key)),
          versionSelections: new Map<string, string | null>(execution.manifest.skills.map((pin) => [pin.key, pin.versionId])),
        } : {
          versionSelections: skillVersionSelectionMap(preference.desiredSkillEntries, {
            versionPinsEnabled: settings.enableBetaSkills,
          }),
        }),
      }) : [];
    const skills = resolvedSkills.map((skill) => ({
      key: skill.key,
      runtimeName: skill.runtimeName,
      source: skill.source,
      versionId: skill.versionId ?? null,
      currentVersionId: skill.currentVersionId ?? null,
      sourceStatus: skill.sourceStatus === "missing" ? "missing" as const : "available" as const,
      missingDetail: skill.missingDetail ?? null,
    }));
    const connectionAssignments = await pluginAgentConnectionAssignments(db, companyId, agentId, {
      publicMcp: settings.enablePublicMcp,
      chatConnectors: settings.enableChatConnectors,
    });
    const current = await readBaseState(db, pluginId, companyId, agentId);
    if (!current) return null;
    if (current.revision === state.revision && current.activeRunId === state.activeRunId && current.responsibleUserId === state.responsibleUserId) {
      const publicState = { ...current } as typeof current & {
        activeRunId?: string;
        responsibleUserId?: string;
        hasExecutionManifest?: boolean;
      };
      delete publicState.activeRunId;
      delete publicState.responsibleUserId;
      delete publicState.hasExecutionManifest;
      return { ...publicState, skillsReady: state.activeRunId !== null, skills, connectionAssignments };
    }
  }
  throw conflict("Agent runtime changed while resolving synchronization inputs; retry");
}
