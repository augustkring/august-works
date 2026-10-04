import type { Db } from "@paperclipai/db";
import { forbidden, notFound } from "../errors.js";
import { authorizationService, type AuthorizationAction, type AuthorizationActor, type AuthorizationResource } from "./authorization.js";
import { instanceSettingsService } from "./instance-settings.js";
import { v5FeatureEnabled, type V5FeatureKey } from "@paperclipai/shared";

export async function assertV5Enabled(db: Db, feature: V5FeatureKey) {
  if (!v5FeatureEnabled(await instanceSettingsService(db).getExperimental(), feature)) {
    throw notFound("This V5 feature is not enabled", { code: "v5_feature_disabled", feature });
  }
}

export async function assertV5Authorization(db: Db, actor: AuthorizationActor, companyId: string, action: AuthorizationAction, resource?: AuthorizationResource) {
  const decision = await authorizationService(db).decide({ actor, action, resource: resource ?? { type: "company", companyId }, enforceResponsibleUserIntersection: true });
  if (!decision.allowed) throw forbidden(decision.explanation, { code: "permission_denied", reason: decision.reason });
}

export function v5HumanActorId(actor: AuthorizationActor): string {
  if (actor.type !== "board") throw forbidden("Human operator access required");
  if (actor.source === "local_implicit") return "local-board";
  if (!actor.userId) throw forbidden("Authenticated human identity required");
  return actor.userId;
}
