import { and, asc, eq, isNull, or } from "drizzle-orm";
import { pluginCompanySettings, pluginConfig, plugins, type Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { pluginLifecycleInbox } from "./plugin-lifecycle-inbox.js";
import { DELIVERY_QUEUES } from "./delivery-work-notifications.js";
import type { createDeliveryWorkCoordinator } from "./delivery-work-coordinator.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";
import type { PluginLifecycleManager } from "./plugin-lifecycle.js";
import { synchronizeAllAgentRuntimeOwners } from "./agent-runtime-owner-assignments.js";

/** Outbox rows are authoritative; local transaction signals only reduce latency. */
export function registerPluginLifecycleDelivery(
  coordinator: ReturnType<typeof createDeliveryWorkCoordinator>, db: Db,
  manager: Pick<PluginWorkerManager, "call" | "isRunning"> & Pick<PluginWorkerManager, "onConfigApplied">,
  lifecycle: Pick<PluginLifecycleManager, "on" | "off">,
) {
  let pending = true;
  let disposed = false;
  const retryMs = 30_000;
  let nextAuthoritativeSweepAt = Date.now() + retryMs;
  const retryAt = new Map<string, number>();
  const task = coordinator.register(DELIVERY_QUEUES.pluginLifecycle, {
    retryMs,
    hasPending: async () => pending,
    onSettled: () => { pending = true; },
    nextRunAt() {
      let next: number | null = nextAuthoritativeSweepAt;
      for (const at of retryAt.values()) if (at > Date.now() && (next === null || at < next)) next = at;
      return next;
    },
    async run(signal) {
      pending = false;
      nextAuthoritativeSweepAt = Date.now() + retryMs;
      for (const [key, at] of retryAt) if (at <= Date.now()) retryAt.delete(key);
      try {
        await synchronizeAllAgentRuntimeOwners(db);
        const configured = await db.select({ plugin: plugins, companyId: pluginConfig.companyId }).from(plugins)
          .innerJoin(pluginConfig, eq(pluginConfig.pluginId, plugins.id)).where(eq(plugins.status, "ready"))
          .orderBy(asc(plugins.installOrder), asc(pluginConfig.companyId));
        for (const { plugin, companyId } of configured) {
          const types = plugin.manifestJson.resourceLifecycle;
          if (!types?.length || !plugin.manifestJson.capabilities.includes("events.subscribe")) continue;
          const [disabled] = await db.select({ id: pluginCompanySettings.id }).from(pluginCompanySettings)
            .where(and(eq(pluginCompanySettings.pluginId, plugin.id), eq(pluginCompanySettings.companyId, companyId), eq(pluginCompanySettings.enabled, false)));
          if (disabled) continue;
          const inbox = pluginLifecycleInbox(db, plugin.id);
          // No global cursor: independent resources progress, and each resource's oldest
          // unacknowledged row stays authoritative across retries and process restarts.
          const events = await inbox.list(companyId, 100, undefined, types);
          for (const event of events) {
            if (signal.aborted || disposed) return;
            const retryKey = `${plugin.id}:${event.id}`;
            if (retryAt.has(retryKey)) { pending = true; continue; }
            if (!manager.isRunning(plugin.id)) { pending = true; continue; }
            let stage = "eligibility";
            try {
              const [enabled] = await db.select({ manifest: plugins.manifestJson }).from(plugins)
                .leftJoin(pluginCompanySettings, and(eq(pluginCompanySettings.pluginId, plugins.id), eq(pluginCompanySettings.companyId, companyId)))
                .where(and(eq(plugins.id, plugin.id), eq(plugins.status, "ready"), or(isNull(pluginCompanySettings.enabled), eq(pluginCompanySettings.enabled, true))));
              if (!enabled?.manifest.resourceLifecycle?.includes(event.resourceType) || !enabled.manifest.capabilities.includes("events.subscribe")) continue;
              stage = "callback";
              const { recipientPluginIds: _recipientPluginIds, ...publicEvent } = event as typeof event & { recipientPluginIds?: string[] };
              const result = await manager.call(plugin.id, "resourceLifecycle", publicEvent, 30_000) as { eventId?: unknown; status?: unknown } | undefined;
              if (!result || result.eventId !== event.id || !["acknowledged", "retry", "deferred"].includes(String(result.status))) throw new Error("Invalid lifecycle response");
              if (signal.aborted || disposed) return;
              if (result.status === "acknowledged") {
                stage = "acknowledgment";
                await inbox.acknowledge(companyId, event.id);
                wake();
              } else if (result.status === "retry") {
                retryAt.set(retryKey, Date.now() + retryMs); pending = true;
              }
            } catch (error) {
              retryAt.set(retryKey, Date.now() + retryMs); pending = true;
              const code = (error as { code?: unknown } | null)?.code;
              logger.warn({ pluginId: plugin.id, companyId, eventId: event.id, stage, ...(typeof code === "number" ? { rpcCode: code } : {}) }, "Resource lifecycle delivery failed; retry scheduled");
            }
          }
          if (events.length === 100) pending = true;
        }
      } catch (error) {
        pending = true;
        throw error;
      }
    },
    pausePassiveMaintenance: true,
  });
  function wake() { if (disposed) return; pending = true; task.wake(); }
  const pluginChanged = () => wake();
  const unsubscribeConfig = manager.onConfigApplied?.(pluginChanged) ?? (() => {});
  lifecycle.on("plugin.loaded", pluginChanged);
  lifecycle.on("plugin.enabled", pluginChanged);
  lifecycle.on("plugin.worker_started", pluginChanged);
  lifecycle.on("plugin.status_changed", pluginChanged);
  lifecycle.on("plugin.disabled", pluginChanged);
  lifecycle.on("plugin.unloaded", pluginChanged);
  return {
    ...task, wake,
    dispose() {
      disposed = true;
      unsubscribeConfig();
      lifecycle.off("plugin.loaded", pluginChanged);
      lifecycle.off("plugin.enabled", pluginChanged);
      lifecycle.off("plugin.worker_started", pluginChanged);
      lifecycle.off("plugin.status_changed", pluginChanged);
      lifecycle.off("plugin.disabled", pluginChanged);
      lifecycle.off("plugin.unloaded", pluginChanged);
    },
  };
}
