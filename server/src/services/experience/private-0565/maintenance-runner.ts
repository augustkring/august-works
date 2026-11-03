/** PRIVATE scheduler seam for the existing SaaS/background maintenance job.
 * Register `runResponsibilityScanMaintenanceTick` there at a 2-second tick;
 * this function claims at most one fair company run and advances only one
 * 40-row kind page, keeping cursor progress/lease work separate from UI reads. */
import type { Db } from "@paperclipai/db";
import { nativeResponsibilityMetadataSources } from "./native-metadata-sources.js";
import { enqueueNextFairResponsibilityScan, expireResponsibilityScanMetadata, postgresResponsibilityScanStore } from "./responsibility-scan-store.js";
import { runResponsibilityScanOnce } from "./responsibility-scan.js";

export async function runResponsibilityScanMaintenanceTick(input: { db: Db; worker: string; now?: () => Date }) {
  const now = input.now ?? (() => new Date());
  const at = now();
  const store = postgresResponsibilityScanStore(input.db);
  await expireResponsibilityScanMetadata(input.db, at, 100);
  await enqueueNextFairResponsibilityScan(input.db, at);
  return runResponsibilityScanOnce({ store, sources: nativeResponsibilityMetadataSources(input.db), worker: input.worker, now });
}

/** Registration shape consumed by the existing SaaS platform scheduler; no
 * second timer or independent singleton lease is introduced by this module. */
export function responsibilityScanMaintenanceJob(input: { db: Db; worker: string }) {
  return { key: "company-responsibility-scan", interval: 2_000,
    run: () => runResponsibilityScanMaintenanceTick(input) } as const;
}
