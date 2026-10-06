import type { Db } from "@paperclipai/db";
import { v7FeatureEnabled, type V7FeatureKey } from "@paperclipai/shared";
import { instanceSettingsService } from "./instance-settings.js";
import { notFound } from "../errors.js";
export { assertV5Authorization as assertV7Authorization, v5HumanActorId as v7HumanActorId } from "./v5-authorization.js";
export async function assertV7Enabled(db: Db, feature: V7FeatureKey) {
  if (!v7FeatureEnabled(await instanceSettingsService(db).getExperimental(), feature)) throw notFound("This feature is not enabled", { code: "v7_feature_disabled", feature });
}
