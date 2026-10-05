import { and, eq } from "drizzle-orm";
import { companies, companyDeletionOperations, type Db } from "@paperclipai/db";
import {
  v6FeatureEnabled,
  v6FeatureFlagsSchema,
  type EntitlementKey,
} from "@paperclipai/shared";
import { isSaasDeployment } from "../../deployment-profile.js";
import { forbidden } from "../../errors.js";
import { entitlementService } from "../billing/entitlements.js";
import { instanceSettingsService } from "../instance-settings.js";

/** Call after domain authorization, and before effects. Privacy erasure and retention do not call this gate. */
export async function assertSaasDomainAdmission(
  db: Db,
  companyId: string,
  key: EntitlementKey = "platform.access",
) {
  if (!isSaasDeployment()) return;
  const flags = v6FeatureFlagsSchema.parse(
    await instanceSettingsService(db).getExperimental(),
  );
  if (!v6FeatureEnabled(flags, "billing_entitlements_v6"))
    throw forbidden("Commercial admission is unavailable", {
      code: "COMMERCIAL_ADMISSION_DISABLED",
    });
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.status, "active")))
    .limit(1);
  const [deletion] = await db
    .select({ id: companyDeletionOperations.id })
    .from(companyDeletionOperations)
    .where(eq(companyDeletionOperations.companyId, companyId))
    .limit(1);
  if (!company || deletion)
    throw forbidden("Company work admission is closed", {
      code: "COMPANY_EXECUTION_UNAVAILABLE",
    });
  const state = await entitlementService(db).require(
    companyId,
    "platform.access",
  );
  if (state.entitlements[key] !== true)
    throw forbidden("Commercial entitlement required", {
      code: "ENTITLEMENT_REQUIRED",
      entitlement: key,
      access: state.access,
    });
}
