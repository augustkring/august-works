import { pluginCompanySettings, pluginConfig, pluginLifecycleAcknowledgments, plugins, resourceLifecycleEvents, type Db } from "@paperclipai/db";
import type { ResourceLifecycleEvent } from "@paperclipai/plugin-sdk";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";

const decimalId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value);

/** Durable inbox. Dispatch happens outside source transactions; event rows are the authority. */
export function pluginLifecycleInbox(db: Db, pluginId: string) {
  const unacknowledged = sql`NOT EXISTS (SELECT 1 FROM plugin_lifecycle_acknowledgments ack
    WHERE ack.company_id = ${resourceLifecycleEvents.companyId} AND ack.plugin_id = ${pluginId}::uuid AND ack.event_id = ${resourceLifecycleEvents.id})`;
  const firstForResource = (types: ResourceLifecycleEvent["resourceType"][]) => sql`NOT EXISTS (SELECT 1 FROM resource_lifecycle_events older
    WHERE older.company_id = ${resourceLifecycleEvents.companyId} AND older.resource_type = ${resourceLifecycleEvents.resourceType}
      AND older.resource_type IN (${sql.join(types.map(type => sql`${type}`), sql`, `)})
      AND (older.resource_type <> 'agent_runtime' OR ${pluginId}::uuid = ANY(older.recipient_plugin_ids))
      AND older.resource_id = ${resourceLifecycleEvents.resourceId} AND older.id < ${resourceLifecycleEvents.id}
      AND NOT EXISTS (SELECT 1 FROM plugin_lifecycle_acknowledgments ack WHERE ack.company_id = older.company_id
        AND ack.plugin_id = ${pluginId}::uuid AND ack.event_id = older.id))`;
  const assignedRuntime = sql`(${resourceLifecycleEvents.resourceType} <> 'agent_runtime' OR ${pluginId}::uuid = ANY(${resourceLifecycleEvents.recipientPluginIds}))`;
  async function assertAvailable(database: Db, companyId: string) {
    if (!z.string().uuid().safeParse(companyId).success) throw badRequest("companyId must be a UUID");
    const [plugin] = await database.select({ status: plugins.status, manifest: plugins.manifestJson }).from(plugins).where(eq(plugins.id, pluginId));
    const [config] = await database.select({ id: pluginConfig.id }).from(pluginConfig)
      .where(and(eq(pluginConfig.pluginId, pluginId), eq(pluginConfig.companyId, companyId)));
    const [setting] = await database.select({ enabled: pluginCompanySettings.enabled }).from(pluginCompanySettings)
      .where(and(eq(pluginCompanySettings.pluginId, pluginId), eq(pluginCompanySettings.companyId, companyId)));
    if (plugin?.status !== "ready" || !config || setting?.enabled === false || !plugin.manifest.capabilities.includes("events.subscribe")) throw forbidden("Plugin is not enabled for this company");
    return plugin.manifest.resourceLifecycle ?? [];
  }
  return {
    async list(companyId: string, limit = 50, afterId?: string, types?: ResourceLifecycleEvent["resourceType"][]): Promise<ResourceLifecycleEvent[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest("limit must be an integer from 1 to 100");
      if (afterId !== undefined && !decimalId(afterId)) throw badRequest("Invalid lifecycle page id");
      const declaredTypes = await assertAvailable(db, companyId);
      const subscribedTypes = types?.length
        ? declaredTypes.filter(type => types.includes(type))
        : declaredTypes;
      if (subscribedTypes.length === 0) return [];
      const rows = await db.select().from(resourceLifecycleEvents).where(and(eq(resourceLifecycleEvents.companyId, companyId), unacknowledged,
        firstForResource(subscribedTypes), assignedRuntime, inArray(resourceLifecycleEvents.resourceType, subscribedTypes),
        afterId === undefined ? undefined : gt(resourceLifecycleEvents.id, BigInt(afterId))))
        .orderBy(asc(resourceLifecycleEvents.id)).limit(limit);
      return rows.map(({ recipientPluginIds: _recipients, ...row }) => ({ ...row, id: row.id.toString(), createdAt: row.createdAt.toISOString() })) as ResourceLifecycleEvent[];
    },
    async acknowledge(companyId: string, eventId: string) {
      if (!z.string().uuid().safeParse(companyId).success || !decimalId(eventId)) throw badRequest("Invalid lifecycle event identity");
      await db.transaction(async tx => {
        const [event] = await tx.select().from(resourceLifecycleEvents)
          .where(and(eq(resourceLifecycleEvents.companyId, companyId), eq(resourceLifecycleEvents.id, BigInt(eventId)))).for("update");
        if (!event) throw notFound("Lifecycle event not found");
        const declaredTypes = await assertAvailable(tx as unknown as Db, companyId);
        if (!declaredTypes.includes(event.resourceType)) throw notFound("Lifecycle event not found");
        if (event.resourceType === "agent_runtime" && !event.recipientPluginIds.includes(pluginId)) throw notFound("Lifecycle event not found");
        const [eligible] = await tx.select({ id: resourceLifecycleEvents.id }).from(resourceLifecycleEvents)
          .where(and(eq(resourceLifecycleEvents.id, event.id), firstForResource(declaredTypes)));
        if (!eligible) throw conflict("Acknowledge earlier lifecycle events for this resource first");
        await tx.insert(pluginLifecycleAcknowledgments).values({ companyId, pluginId, eventId: event.id }).onConflictDoNothing();
      });
    },
  };
}
