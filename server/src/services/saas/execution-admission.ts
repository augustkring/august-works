import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  companies,
  companyDeletionOperations,
  runtimeCells,
  type Db,
} from "@paperclipai/db";
import { v6FeatureEnabled, v6FeatureFlagsSchema } from "@paperclipai/shared";
import { isSaasDeployment } from "../../deployment-profile.js";
import { forbidden } from "../../errors.js";
import { instanceSettingsService } from "../instance-settings.js";
import { entitlementService } from "../billing/entitlements.js";

/** Called at durable admission and again before dispatch, including scheduler/internal callers. */
export function assertSaasRemoteAdapterConfig(
  adapterType: string,
  config: Record<string, unknown>,
) {
  if (!isSaasDeployment()) return;
  if (
    !["openclaw_gateway", "hermes_gateway", "http", "cursor_cloud"].includes(
      adapterType,
    )
  )
    throw forbidden("SaaS execution requires a remote provider", {
      code: "SAAS_LOCAL_EXECUTION_DISABLED",
    });
  for (const field of [
    "instructionsFilePath",
    "instructionsBundlePath",
    "managedHome",
    "workspacePath",
    "worktreePath",
  ])
    if (typeof config[field] === "string" && config[field].trim())
      throw forbidden(
        "Use company instructions instead of a control-plane file path",
        { code: "SAAS_LOCAL_FILE_DISABLED" },
      );
  if (
    adapterType === "cursor_cloud" &&
    typeof config.runtimeEnvType === "string" &&
    config.runtimeEnvType.trim() &&
    !/^cloud$/i.test(config.runtimeEnvType.trim())
  )
    throw forbidden("Use the cloud runtime for Cursor in SaaS", {
      code: "SAAS_LOCAL_EXECUTION_DISABLED",
    });
}
export async function assertSaasExecutionAdmission(
  db: Db,
  agent: {
    id: string;
    companyId: string;
    adapterType: string;
    adapterConfig: Record<string, unknown>;
  },
) {
  if (!isSaasDeployment()) return;
  assertSaasRemoteAdapterConfig(agent.adapterType, agent.adapterConfig);
  if (
    !["openclaw_gateway", "hermes_gateway", "http", "cursor_cloud"].includes(
      agent.adapterType,
    )
  )
    throw forbidden("SaaS execution requires a remote provider", {
      code: "SAAS_LOCAL_EXECUTION_DISABLED",
    });
  const settings = v6FeatureFlagsSchema.parse(
    await instanceSettingsService(db).getExperimental(),
  );
  if (!v6FeatureEnabled(settings, "billing_entitlements_v6"))
    throw forbidden("Commercial admission is temporarily unavailable", {
      code: "COMMERCIAL_ADMISSION_DISABLED",
    });
  const [company] = await db
    .select({ status: companies.status })
    .from(companies)
    .where(eq(companies.id, agent.companyId))
    .limit(1);
  const [deletion] = await db
    .select({ id: companyDeletionOperations.id })
    .from(companyDeletionOperations)
    .where(eq(companyDeletionOperations.companyId, agent.companyId))
    .limit(1);
  if (!company || company.status !== "active" || deletion)
    throw forbidden("Company execution is unavailable");
  await entitlementService(db).require(agent.companyId, "platform.access");
  const configured = agent.adapterConfig.url;
  if (
    typeof configured === "string" &&
    /^ws:\/\/127\.0\.0\.1:\d+\/cells\//.test(configured)
  ) {
    const match = configured.match(
      /^ws:\/\/127\.0\.0\.1:\d+\/cells\/([a-f0-9-]{36})\/([1-9][0-9]{0,18})$/i,
    );
    if (!match) throw forbidden("Invalid managed runtime endpoint");
    const [cell] = await db
      .select({ id: runtimeCells.id })
      .from(runtimeCells)
      .where(
        and(
          eq(runtimeCells.id, match[1]!),
          eq(runtimeCells.companyId, agent.companyId),
          eq(runtimeCells.generation, BigInt(match[2]!)),
          eq(runtimeCells.status, "HEALTHY"),
          isNull(runtimeCells.suspendedReason),
          isNull(runtimeCells.deletedAt),
        ),
      )
      .limit(1);
    if (!cell || !v6FeatureEnabled(settings, "hosted_openclaw_v6"))
      throw forbidden("Managed runtime admission is unavailable");
  }
}
