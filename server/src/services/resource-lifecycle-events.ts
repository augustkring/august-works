import { resourceLifecycleEvents, type Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

/** Append a committed outbox row in the source mutation transaction. */
export async function recordResourceCreationEvent(db: Db, companyId: string, resourceType: "agent" | "project", resourceId: string) {
  await notifyDeliveryWork(db, DELIVERY_QUEUES.pluginLifecycle);
  await db.insert(resourceLifecycleEvents).values({ companyId, resourceType, resourceId, action: "create" })
    .onConflictDoNothing({ target: [resourceLifecycleEvents.companyId, resourceLifecycleEvents.resourceType, resourceLifecycleEvents.resourceId], where: sql`${resourceLifecycleEvents.action} = 'create'` });
}

export async function recordAgentStatusEvent(db: Db, companyId: string, agentId: string, before: string, after: string) {
  const action = after === "terminated" ? "terminate"
    : after === "paused" ? "pause"
      : before === "paused" && ["active", "idle", "running", "error"].includes(after) ? "resume" : null;
  if (!action) return;
  await notifyDeliveryWork(db, DELIVERY_QUEUES.pluginLifecycle);
  await db.insert(resourceLifecycleEvents).values({ companyId, resourceType: "agent", resourceId: agentId, action });
}

/** Call inside the locked project mutation/removal transaction. */
export async function recordProjectLifecycleEvent(db: Db, companyId: string, projectId: string, action: "update" | "archive" | "delete" = "update") {
  await notifyDeliveryWork(db, DELIVERY_QUEUES.pluginLifecycle);
  await db.insert(resourceLifecycleEvents).values({ companyId, resourceType: "project", resourceId: projectId, action });
}
