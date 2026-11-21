import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { agents, pluginCompanySettings, pluginConfig, plugins, type Db } from "@paperclipai/db";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

/** Resolve only explicitly declared, enabled, configured runtime consumers. */
export async function eligibleAgentRuntimePlugins(db: Db, companyId: string): Promise<string[]> {
  const rows = await db.select({ id: plugins.id, manifest: plugins.manifestJson }).from(plugins)
    .innerJoin(pluginConfig, eq(pluginConfig.pluginId, plugins.id))
    .leftJoin(pluginCompanySettings, and(eq(pluginCompanySettings.pluginId, plugins.id), eq(pluginCompanySettings.companyId, companyId)))
    .where(and(eq(pluginConfig.companyId, companyId), eq(plugins.status, "ready"),
      or(isNull(pluginCompanySettings.enabled), eq(pluginCompanySettings.enabled, true))))
    .orderBy(asc(plugins.installOrder), asc(plugins.id));
  return rows.filter(({ manifest }) => manifest.capabilities.includes("events.subscribe") &&
    manifest.capabilities.includes("agents.lifecycle.manage") && manifest.agentLifecycle === true &&
    manifest.resourceLifecycle?.includes("agent_runtime"))
    .map(({ id }) => id);
}

/** Hold agent locks in deterministic order before changing any lifecycle-owner source. */
export async function lockCompanyRuntimeAgents(db: Db, companyId: string) {
  return db.select({ id: agents.id, companyId: agents.companyId, lifecycleRequiredPluginIds: agents.lifecycleRequiredPluginIds })
    .from(agents).where(and(eq(agents.companyId, companyId), sql`${agents.status} NOT IN ('pending_approval','terminated')`))
    .orderBy(asc(agents.id)).for("no key update");
}

/** Persist the actual owner set and append the same-transaction revision events. */
export async function synchronizeCompanyAgentRuntimeOwners(db: Db, companyId: string, alreadyLocked?: Awaited<ReturnType<typeof lockCompanyRuntimeAgents>>) {
  const ownerIds = await eligibleAgentRuntimePlugins(db, companyId);
  const ownerSet = new Set(ownerIds);
  const locked = alreadyLocked ?? await lockCompanyRuntimeAgents(db, companyId);
  const changed = locked.filter(agent => {
    const previous = [...(agent.lifecycleRequiredPluginIds ?? [])].sort();
    const next = [...ownerIds].sort();
    return previous.length !== next.length || previous.some((id, index) => id !== next[index]);
  });
  if (changed.length === 0) return 0;
  await notifyDeliveryWork(db, DELIVERY_QUEUES.pluginLifecycle);
  for (const agent of changed) {
    await db.update(agents).set({ lifecycleRequiredPluginIds: [...ownerSet].sort(), updatedAt: new Date() })
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agent.id)));
  }
  return changed.length;
}

export async function synchronizeAllAgentRuntimeOwners(db: Db) {
  const companies = await db.selectDistinct({ companyId: agents.companyId }).from(agents).orderBy(asc(agents.companyId));
  let changed = 0;
  for (const { companyId } of companies) {
    changed += await db.transaction(tx => synchronizeCompanyAgentRuntimeOwners(tx as unknown as Db, companyId));
  }
  return changed;
}
