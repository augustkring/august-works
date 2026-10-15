import { performance } from "node:perf_hooks";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLog, companyOnboardingRuns, instanceSettings, type Db } from "@paperclipai/db";
import { ACTIVATION_MEASUREMENT_CONTRACT, ACTIVATION_STEPS, experienceDurationBucket,
  experienceSetupBucket, experienceMeasuresSchema, v9FeatureEnabled } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { v5HumanActorId } from "../v5-authorization.js";
import { activationService } from "../saas/activation.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { instanceSettingsService } from "../instance-settings.js";

const setupReceipt = z.strictObject({ from: z.enum(ACTIVATION_STEPS), to: z.enum(ACTIVATION_STEPS), version: z.number().int().min(2) });

/** Read through the original activation/verification owner in one authorized
 * snapshot. This observes metadata; it creates no events, dataset or export. */
export async function readExperienceMeasures(db: Db, actor: AuthorizationActor, companyId: string) {
  const userId = v5HumanActorId(actor);
  if (actor.source === "local_implicit") throw forbidden("A verified account is required for activation measures");
  const current = { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true };
  const started = performance.now();
  function budget() {
    if (performance.now() - started > 5000)
      throw conflict("Experience measurement source changed; reload", { code: "experience_measurement_stale" });
  }
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await tx.execute(sql`select set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`);
    await lockAnalyticalCompany(tx, companyId);
    await lockMemoryPrivacy(tx, companyId);
    await tx.select({ key: instanceSettings.singletonKey }).from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, "default")).for("share");
    async function flags() {
      budget();
      const experimental = await instanceSettingsService(tx).getExperimental();
      if (!v9FeatureEnabled(experimental, "experience_analytics_v9") || !v9FeatureEnabled(experimental, "activation_v9"))
        throw notFound("Experience measures are unavailable");
    }
    await flags();
    const [run] = await tx.select().from(companyOnboardingRuns).where(and(
      eq(companyOnboardingRuns.companyId, companyId), eq(companyOnboardingRuns.createdByUserId, userId),
    )).for("share");
    if (!run) throw notFound("Activation measures are unavailable");
    // This original owner repeats verified-account, active-company, membership,
    // current authority, independent result and source/privacy checks.
    const view = await activationService(tx).get(current, companyId);
    const firstValue = view.firstValue;
    if (!firstValue) throw notFound("Current first-value measurement source is unavailable");
    budget();
    let creationToVerificationBucket: ReturnType<typeof experienceDurationBucket> | null = null;
    let recordedSetupChangesBucket: ReturnType<typeof experienceSetupBucket> | null = null;
    let setupWindow: "complete" | "bounded" | "not_applicable" = "not_applicable";
    if (firstValue.status === "verified") {
      const verifiedAt = new Date(firstValue.result!.verifiedAt);
      creationToVerificationBucket = experienceDurationBucket(verifiedAt.getTime() - run.createdAt.getTime());
      const receipts = await tx.select({ details: activityLog.details }).from(activityLog).where(and(
        eq(activityLog.companyId, companyId), eq(activityLog.actorType, "user"), eq(activityLog.actorId, userId),
        eq(activityLog.action, "activation.step_completed"), eq(activityLog.entityType, "onboarding"),
        eq(activityLog.entityId, run.id), gte(activityLog.createdAt, run.createdAt), lte(activityLog.createdAt, verifiedAt),
      )).orderBy(asc(activityLog.createdAt), asc(activityLog.id)).limit(129).for("share");
      if (receipts.length > 128) setupWindow = "bounded";
      else {
        const versions = receipts.map((row) => setupReceipt.extend({ version: z.number().int().min(2).max(run.version) }).parse(row.details).version);
        if (new Set(versions).size !== versions.length)
          throw conflict("Original setup receipt bindings are unavailable");
        setupWindow = "complete";
        recordedSetupChangesBucket = experienceSetupBucket(receipts.length);
      }
    }
    await flags();
    const [clock] = await tx.execute<{ observed_at: Date }>(sql`select clock_timestamp() as observed_at`);
    budget();
    if (!clock) throw notFound("Experience observation is unavailable");
    return experienceMeasuresSchema.parse({ companyId, contractId: ACTIVATION_MEASUREMENT_CONTRACT.id,
      observedAt: new Date(clock.observed_at).toISOString(), status: firstValue.status,
      creationToVerificationBucket, recordedSetupChangesBucket, setupWindow, usableBaseline: "unavailable" });
  });
}
