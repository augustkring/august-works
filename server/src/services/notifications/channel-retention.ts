import { lt } from "drizzle-orm";
import { notificationChannelPreferenceCommands, type Db } from "@paperclipai/db";

/** Purpose expiry is independent of feature rollout and channel availability.
 * The Original receipt owner deletes only expired metadata, never provider data. */
export async function purgeExpiredNotificationChannelCommands(db: Db, now = new Date()) {
  await db.delete(notificationChannelPreferenceCommands).where(lt(notificationChannelPreferenceCommands.expiresAt, now));
}
