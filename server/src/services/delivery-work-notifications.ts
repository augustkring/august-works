import { signalDatabaseWork, subscribeDatabaseWork } from "@paperclipai/db";

/** Process-local wake hints for the existing durable schedule owners. */
export const DELIVERY_QUEUES = {
  routineSchedules: "routine-schedules",
  issueMonitors: "issue-monitors",
  pluginLifecycle: "plugin-lifecycle",
} as const;
export type DeliveryQueue = typeof DELIVERY_QUEUES[keyof typeof DELIVERY_QUEUES];

export async function notifyDeliveryWork(transaction: object, queue: DeliveryQueue): Promise<void> {
  await signalDatabaseWork(transaction, queue);
}
export function subscribeDeliveryWork(owner: object, queue: DeliveryQueue, wake: () => void): () => void {
  return subscribeDatabaseWork(owner, queue, event => { if (event === "settled") wake(); });
}
