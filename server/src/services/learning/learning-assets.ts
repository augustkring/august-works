import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
/** Native consumers enforce retained lineage independently of Learning rollout flags. */
export async function assertLearningAssetCurrent(db: Db, companyId: string, type: string, id: string) {
  const result = await db.execute(sql`select aw_learning_asset_current(${companyId}::uuid, ${type}, ${id}::uuid) as current`);
  if (!(result[0] as { current: boolean } | undefined)?.current) throw conflict("Learning source evidence changed; review this version before use");
}
