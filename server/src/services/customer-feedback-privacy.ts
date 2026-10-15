import { instanceSettings, type Db } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { instanceSettingsService } from "./instance-settings.js";
export async function awOutputFeedbackIsLocal(reader: Db) {
  const settings = instanceSettingsService(reader);
  const general = await settings.getGeneral();
  if (general.outputFeedbackPolicyVersion === "aw-v9-local-v1") return true;
  // Managed admission is effective at read time even before the tenant row is written.
  if ((await settings.getExperimental()).customer_feedback_v9 !== true)
    return false;
  // Latch managed activation as well. Merge atomically without overwriting other settings.
  await reader
    .update(instanceSettings)
    .set({
      general: sql`coalesce(${instanceSettings.general},'{}'::jsonb) || '{"outputFeedbackPolicyVersion":"aw-v9-local-v1"}'::jsonb`,
    })
    .where(eq(instanceSettings.singletonKey, "default"));
  return true;
}
