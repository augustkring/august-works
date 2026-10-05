import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

/** All profiles must refuse an operator-restored database until quarantine is cleared. */
export async function assertDatabaseRestoreAdmission(db: Db) {
  const rows = await db.execute<{ quarantine: unknown }>(
    sql`select general->'awV6RestoreQuarantine' as quarantine from instance_settings where singleton_key='default'`,
  );
  if (rows.some((row) => row.quarantine != null))
    throw Error(
      "Restored database remains quarantined; operator recovery qualification is required before application startup",
    );
}
