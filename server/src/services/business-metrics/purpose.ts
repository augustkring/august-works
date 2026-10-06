import type { BusinessMetricDefinition } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";

export async function currentMetricPurpose(tx: Db, companyId: string, definition: BusinessMetricDefinition, now = new Date()) {
  return currentAnalyticalPurpose(tx, companyId, definition, "metrics", now);
}
