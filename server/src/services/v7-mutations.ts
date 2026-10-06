import type { Db } from "@paperclipai/db";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
import { logger } from "../middleware/logger.js";
export async function withV7ActivityTransaction<T>(db: Db, work: (tx: Db, publications: ActivityPublication[]) => Promise<T>): Promise<T> {
  const publications: ActivityPublication[] = [];
  const value = await db.transaction((tx) => work(tx as unknown as Db, publications));
  for (const publication of publications) {
    try { publishActivity(publication); } catch (error) { logger.error({ err: error }, "Committed V7 audit publication failed"); }
  }
  return value;
}
export { logActivity };
