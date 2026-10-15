import { performance } from "node:perf_hooks";
import { and, eq, gt, sql } from "drizzle-orm";
import { authUsers, companies, companyMemberships, instanceSettings, experienceObservationPreferences as preferences,
  experienceObservationCommands as commands, experienceObservations as observations, type Db } from "@paperclipai/db";
import { EXPERIENCE_OBSERVATION_CONTRACT_ID, EXPERIENCE_OBSERVATION_DAILY_LIMIT, EXPERIENCE_OBSERVATION_RETENTION_DAYS,
  experienceObservationSchema, experienceObservationPreferenceCommandSchema, experienceObservationPreferenceSchema,
  experienceObservationPreferenceReceiptSchema, experienceObservationSummarySchema, v9FeatureEnabled } from "@paperclipai/shared";
import { conflict, forbidden, notFound, tooManyRequests } from "../../errors.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { logActivity, publishActivity, type ActivityPublication } from "../activity-log.js";

/** A separate optional local purpose. No Paperclip telemetry client, provider,
 * task writer or model is reachable from this owner. */
export function experienceObservationService(db: Db) {
  async function scoped<T>(actor: AuthorizationActor, companyId: string, operation: (tx: Db, userId: string) => Promise<T>) {
    const userId = v5HumanActorId(actor);
    if (actor.source === "local_implicit") throw forbidden("An authenticated personal account is required");
    const started = performance.now();
    return db.transaction(async raw => {
      const tx = raw as unknown as Db;
      await tx.execute(sql`select set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`);
      await lockAnalyticalCompany(tx, companyId);
      await lockMemoryPrivacy(tx, companyId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`experience-observations:${companyId}:${userId}`},0))`);
      const [user] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
      if (!user) throw forbidden("Current personal account is unavailable");
      const result = await operation(tx, userId);
      if (performance.now() - started > 5000) throw conflict("Observation state changed; check current preferences");
      return result;
    });
  }
  async function member(tx: Db, actor: AuthorizationActor, companyId: string, userId: string) {
    const [current] = await tx.select({ id: companyMemberships.id }).from(companyMemberships)
      .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
      .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"), eq(authUsers.emailVerified, true),
        sql`${companies.status} <> 'archived'`)).for("share");
    if (!current) return false;
    try {
      await assertV5Authorization(tx, { ...actor, isInstanceAdmin: false, ignoreInstanceAdmin: true }, companyId, "company_scope:read");
      return true;
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 403) return false;
      throw error;
    }
  }
  async function available(tx: Db) {
    const [row] = await tx.select({ key: instanceSettings.singletonKey }).from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, "default")).for("share");
    return Boolean(row) && v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "experience_analytics_v9");
  }
  const own = (companyId: string, userId: string) => and(eq(preferences.companyId, companyId), eq(preferences.userId, userId));
  async function get(actor: AuthorizationActor, companyId: string) {
    return scoped(actor, companyId, async (tx, userId) => {
      const [row] = await tx.select().from(preferences).where(own(companyId, userId)).for("share");
      // Own choice/withdrawal remains inspectable after company access or rollout
      // withdrawal. This grants no read of company observations or other users.
      const collectionAvailable = await member(tx, actor, companyId, userId) && await available(tx);
      return experienceObservationPreferenceSchema.parse({ companyId, contractId: EXPERIENCE_OBSERVATION_CONTRACT_ID,
        enabled: row?.enabled ?? false, version: row?.version ?? 0, collectionAvailable,
        retentionDays: EXPERIENCE_OBSERVATION_RETENTION_DAYS, dailyLimit: EXPERIENCE_OBSERVATION_DAILY_LIMIT,
        lastRequestId: row?.lastRequestId ?? null });
    });
  }
  async function update(actor: AuthorizationActor, companyId: string, raw: unknown) {
    const input = experienceObservationPreferenceCommandSchema.parse(raw), publications: ActivityPublication[] = [];
    const result = await scoped(actor, companyId, async (tx, userId) => {
      const requestHash = nativeSha256(input);
      const [prior] = await tx.select().from(commands).where(and(eq(commands.companyId, companyId), eq(commands.userId, userId), eq(commands.requestId, input.requestId)));
      if (prior) {
        const [active] = await tx.select({ id: commands.requestId }).from(commands).where(and(eq(commands.companyId, companyId), eq(commands.userId, userId),
          eq(commands.requestId, input.requestId), gt(commands.expiresAt, sql`clock_timestamp()`)));
        if (!active || prior.requestHash !== requestHash) throw conflict("Original preference command is unavailable; check current preferences");
        return experienceObservationPreferenceReceiptSchema.parse(prior.receipt);
      }
      const [row] = await tx.select().from(preferences).where(own(companyId, userId)).for("update");
      const currentMember = await member(tx, actor, companyId, userId);
      if (input.enabled) {
        if (!currentMember) throw forbidden("Current verified company membership is required");
        if (!await available(tx)) throw notFound("Experience observations are unavailable");
        if ((row?.version ?? 0) !== input.expectedVersion) throw conflict("Check the current preference before enabling observations");
      } else if (!row && !currentMember) throw notFound("Own observation preference is unavailable");
      const version = (row?.version ?? 0) + 1;
      if (version > 2147483647) throw conflict("Observation preference version is exhausted");
      if (row) await tx.update(preferences).set({ enabled: input.enabled, version, lastRequestId: input.requestId, updatedAt: sql`clock_timestamp()` }).where(own(companyId, userId));
      else await tx.insert(preferences).values({ companyId, userId, enabled: input.enabled, version, lastRequestId: input.requestId });
      if (!input.enabled) await tx.delete(observations).where(and(eq(observations.companyId, companyId), eq(observations.userId, userId)));
      const receipt = experienceObservationPreferenceReceiptSchema.parse({ companyId, requestId: input.requestId, enabled: input.enabled, version, observationsErased: !input.enabled });
      await tx.insert(commands).values({ companyId, userId, requestId: input.requestId, requestHash, receipt });
      await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "experience_observation_preference.updated",
        entityType: "experience_observation_preference", entityId: userId, details: {} }, publications);
      return receipt;
    });
    for (const publication of publications) publishActivity(publication);
    return result;
  }
  async function record(actor: AuthorizationActor, companyId: string, raw: unknown) {
    const input = experienceObservationSchema.parse(raw);
    return scoped(actor, companyId, async (tx, userId) => {
      if (!await member(tx, actor, companyId, userId)) throw forbidden("Current verified company membership is required");
      if (!await available(tx)) throw notFound("Experience observations are unavailable");
      const [pref] = await tx.select().from(preferences).where(own(companyId, userId)).for("update");
      if (!pref?.enabled || pref.version !== input.preferenceVersion) throw conflict("Current observation choice is unavailable");
      const binding = and(eq(observations.companyId, companyId), eq(observations.userId, userId), eq(observations.requestId, input.requestId));
      const requestHash = nativeSha256(input);
      const [prior] = await tx.select({ requestHash: observations.requestHash }).from(observations).where(and(binding, gt(observations.expiresAt, sql`clock_timestamp()`)));
      if (prior) {
        if (prior.requestHash !== requestHash) throw conflict("Observation request identity changed");
        return { requestId: input.requestId, status: "duplicate" as const };
      }
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(observations).where(and(
        eq(observations.companyId, companyId), eq(observations.userId, userId), gt(observations.createdAt, sql`clock_timestamp() - interval '1 day'`)));
      if ((count?.value ?? 0) >= EXPERIENCE_OBSERVATION_DAILY_LIMIT) throw tooManyRequests("Local observation sampling limit reached");
      await tx.delete(observations).where(and(binding, sql`${observations.expiresAt} <= clock_timestamp()`));
      await tx.insert(observations).values({ ...input, companyId, userId, requestHash });
      // Passive observations are not copied into the operational Activity Log.
      // Its independent retention must not retain an erased observation stream.
      return { requestId: input.requestId, status: "recorded" as const };
    });
  }
  async function summary(actor: AuthorizationActor, companyId: string) {
    return scoped(actor, companyId, async (tx, userId) => {
      if (!await member(tx, actor, companyId, userId)) throw forbidden("Current verified company membership is required");
      const counts = await tx.select({ kind: observations.kind, surface: observations.surface, variant: observations.variant,
        step: observations.step, durationBucket: observations.durationBucket, count: sql<number>`count(*)::int` }).from(observations)
        .where(and(eq(observations.companyId, companyId), eq(observations.userId, userId), gt(observations.expiresAt, sql`clock_timestamp()`)))
        .groupBy(observations.kind, observations.surface, observations.variant, observations.step, observations.durationBucket)
        .orderBy(observations.kind, observations.surface, observations.variant, observations.step, observations.durationBucket).limit(2000);
      const [clock] = await tx.execute<{ at: Date }>(sql`select clock_timestamp() as at`);
      return experienceObservationSummarySchema.parse({ companyId, contractId: EXPERIENCE_OBSERVATION_CONTRACT_ID,
        observedAt: new Date(clock!.at).toISOString(), coverage: "opt_in_observations_only", retentionDays: EXPERIENCE_OBSERVATION_RETENTION_DAYS, counts });
    });
  }
  return { get, update, record, summary };
}

/** No rollout gate: expired data remains expired after rollback or opt-out. */
export async function eraseExpiredExperienceObservations(db: Db) {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`);
    const events = await tx.execute(sql`with expired as (select company_id,user_id,request_id from experience_observations
      where expires_at <= clock_timestamp() order by expires_at limit 512 for update skip locked)
      delete from experience_observations e using expired x where e.company_id=x.company_id and e.user_id=x.user_id and e.request_id=x.request_id returning e.request_id`);
    const receipts = await tx.execute(sql`with expired as (select company_id,user_id,request_id from experience_observation_commands
      where expires_at <= clock_timestamp() order by expires_at limit 512 for update skip locked)
      delete from experience_observation_commands e using expired x where e.company_id=x.company_id and e.user_id=x.user_id and e.request_id=x.request_id returning e.request_id`);
    return { observationsErased: events.length, commandReceiptsErased: receipts.length };
  });
}
