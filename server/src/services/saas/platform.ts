import { runtimeCatalogService } from "../runtime/catalog.js";
import { accountDeletionService } from "./account-deletion.js";
import { secretService } from "../secrets.js";
import { runtimeBackupSchedule } from "../runtime/backup-schedule.js";
import {
  runtimeBackupRetention,
  runtimeBackupRetentionObjects,
} from "../runtime/backup-retention.js";
import { applicationStorageService } from "../billing/storage.js";
import { saasCostService } from "../billing/costs.js";
import { heartbeatService } from "../heartbeat.js";
import { createStorageService } from "../../storage/service.js";
import { runtimeCommercialService } from "../runtime/commercial.js";
import { notificationService } from "../notifications/notifications.js";
import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  authSecurityEvents,
  platformSchedulerLeases,
  type Db,
} from "@paperclipai/db";
import {
  v6FeatureEnabled,
  v6FeatureFlagsSchema,
  type PublicOriginConfig,
  type V6FeatureFlags,
  type V6FeatureKey,
} from "@paperclipai/shared";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { logger } from "../../middleware/logger.js";
import { billingService } from "../billing/billing.js";
import { paddleProvider } from "../billing/paddle-provider.js";
import { entitlementService } from "../billing/entitlements.js";
import { usageService } from "../billing/usage.js";
import { mailgunProvider } from "../notifications/mailgun-provider.js";
import { transactionalEmail } from "../notifications/transactional-email.js";
import { instanceSettingsService } from "../instance-settings.js";
import { saasInvitationService } from "./invitations.js";
import { saasOnboardingService } from "./onboarding.js";
import { saasOffboardingService } from "./offboarding.js";
import { companyObjectErasure } from "./object-erasure.js";
import { saasSupportService } from "./support.js";
import { runtimeFleetService } from "../runtime/fleet.js";
import { upcloudRuntimeProvider } from "../runtime/upcloud-provider.js";
import { configureRunLogStore } from "../run-log-store.js";
import { saasRunLogStore } from "./run-logs.js";
import { createS3StorageProvider } from "../../storage/s3-provider.js";
import { runtimeControlService } from "../runtime/control.js";
import { nativeSandboxHostTransport } from "../execution-sandbox/native-host-bridge.js";

export function saasPlatform(
  db: Db,
  config: SaasPlatformConfig,
  origins: PublicOriginConfig,
) {
  const email = transactionalEmail(
    db,
    config,
    origins,
    mailgunProvider(config),
  );
  const notifications = notificationService(db, email);
  const invitations = saasInvitationService(db, config, email);
  const billing = billingService(
    db,
    config.billing,
    paddleProvider(config.billing),
    notifications.notifyCompany,
  );
  const entitlements = entitlementService(db);
  const usage = usageService(db);
  const applicationStorageProvider = createS3StorageProvider({
    bucket: config.objects.bucket,
    region: config.objects.region,
    endpoint: config.objects.endpoint,
    prefix: process.env.PAPERCLIP_STORAGE_S3_PREFIX,
    forcePathStyle: true,
  });
  const storageAccounting = applicationStorageService(
    db,
    applicationStorageProvider,
  );
  const storage = createStorageService(
    applicationStorageProvider,
    storageAccounting.accounting,
  );
  const onboarding = saasOnboardingService(db);
  const accountDeletion = accountDeletionService(db, {
    removeSecret: (id) => secretService(db).remove(id),
    cancelRun: (id) =>
      heartbeatService(db).cancelRun(id, "Account deletion", {
        errorCode: "account_deletion",
      }),
  });
  const commercialRuntime = runtimeCommercialService(
    db,
    notifications.notifyCompany,
    (ids, reason) =>
      heartbeatService(db).cancelInvocationsForAgents(ids, reason),
  );
  const catalog = runtimeCatalogService(db, config);
  const costs = saasCostService(db, config);
  const runtime = runtimeControlService(
    db,
    config,
    notifications.notifyCompany,
  );
  const sandboxHosts = nativeSandboxHostTransport(db, { suspectSeconds: config.runtime.suspectSeconds });
  const backupRetention = config.backups
    ? runtimeBackupRetention(db, runtimeBackupRetentionObjects(config))
    : undefined;
  const backupSchedule = runtimeBackupSchedule(
    db,
    config,
    notifications.notifyCompany,
  );
  const fleet = runtimeFleetService(
    db,
    config,
    origins.primaryAppOrigin,
    config.upcloud ? upcloudRuntimeProvider(config) : undefined,
  );
  const offboarding = saasOffboardingService(
    db,
    billing,
    runtime,
    companyObjectErasure(db, config),
    config.upcloud
      ? (hostId) => fleet.requestRetire(hostId, "runtime-scheduler")
      : undefined,
  );
  const support = saasSupportService(db, config, notifications.notifyCompany);
  const logs = config.runLogs
    ? saasRunLogStore(
        db,
        createS3StorageProvider({
          bucket: process.env.RUN_LOG_S3_BUCKET!,
          region: process.env.RUN_LOG_S3_REGION!,
          endpoint: process.env.RUN_LOG_S3_ENDPOINT,
          forcePathStyle: true,
        }),
        config.runLogs,
        process.env.RUN_LOG_S3_PREFIX?.trim() || "run-logs",
      )
    : undefined;
  const owner = randomUUID();
  let stopped = false,
    active: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const runningJobs = new Map<string, Promise<void>>();
  async function flags(): Promise<Partial<V6FeatureFlags>> {
    return v6FeatureFlagsSchema.parse(
      await instanceSettingsService(db).getExperimental(),
    );
  }
  async function enabled(key: V6FeatureKey) {
    return v6FeatureEnabled(await flags(), key);
  }
  const jobs: {
    key: string;
    flag: V6FeatureKey;
    interval: number;
    run(): Promise<unknown>;
  }[] = [
    {
      key: "native-work-notifications",
      flag: "transactional_email_v6",
      interval: 2000,
      run: () => notifications.processWorkUpdate(),
    },
    ...(config.upcloud
      ? [
          {
            key: "runtime-provider-inventory",
            flag: "runtime_host_agent_v6" as const,
            interval: 3600000,
            run: () => fleet.observeProviderInventory(),
          },
          {
            key: "runtime-host-create",
            flag: "runtime_auto_host_scale_v6" as const,
            interval: 2000,
            run: () => fleet.processCreate(),
          },
          {
            key: "runtime-host-scale",
            flag: "runtime_auto_host_scale_v6" as const,
            interval: 30000,
            run: () => fleet.scaleOne(),
          },
          {
            key: "runtime-host-reconcile",
            flag: "runtime_host_agent_v6" as const,
            interval: 60000,
            run: () => fleet.reconcileCreates(),
          },
          {
            key: "runtime-host-retirement",
            flag: "runtime_host_agent_v6" as const,
            interval: 10000,
            run: () => fleet.processRetire(),
          },
          {
            key: "runtime-host-fence",
            flag: "runtime_host_agent_v6" as const,
            interval: 10000,
            run: () => fleet.processFence(),
          },
        ]
      : []),
    {
      key: "runtime-host-liveness",
      flag: "runtime_host_agent_v6",
      interval: 10000,
      run: () => fleet.observeLiveness(),
    },
    {
      key: "company-offboarding",
      flag: "saas_deployment_profile_v6",
      interval: 10000,
      run: () => offboarding.processOne(),
    },
    {
      key: "account-offboarding",
      flag: "saas_deployment_profile_v6",
      interval: 10000,
      run: () => accountDeletion.processOne(),
    },
    {
      key: "runtime-dispatch",
      flag: "saas_deployment_profile_v6",
      interval: 2000,
      run: async () =>
        runtime.dispatchOne(new Date(), await enabled("hosted_openclaw_v6")),
    },
    {
      key: "runtime-command-reconciliation",
      flag: "saas_deployment_profile_v6",
      interval: 10000,
      run: () => runtime.reconcileCommands(),
    },
    { key: "sandbox-host-command-reconciliation", flag: "saas_deployment_profile_v6", interval: 5000, run: () => sandboxHosts.reconcile() },
    {
      key: "runtime-backup-verification",
      flag: "runtime_host_agent_v6",
      interval: 10000,
      run: () => runtime.backups.verifyOne(),
    },
    {
      key: "runtime-backup-schedule",
      flag: "saas_deployment_profile_v6",
      interval: 10000,
      run: async () =>
        backupSchedule.tick(new Date(), await enabled("hosted_openclaw_v6")),
    },
    ...(backupRetention
      ? [
          {
            key: "runtime-backup-retention",
            flag: "saas_deployment_profile_v6" as const,
            interval: 10000,
            run: () => backupRetention.expireOne(),
          },
        ]
      : []),
    {
      key: "runtime-nonce-retention",
      flag: "runtime_host_agent_v6",
      interval: 60000,
      run: () => runtime.auth.pruneNonces(),
    },
    ...(logs
      ? [
          {
            key: "run-log-archive",
            flag: "saas_deployment_profile_v6" as const,
            interval: 2000,
            run: () => logs.flushOne(),
          },
        ]
      : []),
    {
      key: "email-delivery",
      flag: "transactional_email_v6",
      interval: 2000,
      run: () => email.processOne(owner),
    },
    {
      key: "runtime-commercial-reconciliation",
      flag: "billing_entitlements_v6",
      interval: 15000,
      run: () => commercialRuntime.reconcile(),
    },
    {
      key: "usage-daily-rebuild",
      flag: "billing_usage_v6",
      interval: 10000,
      run: () => usage.rebuildDirtyDays(),
    },
    {
      key: "application-storage-reconciliation",
      flag: "billing_usage_v6",
      interval: 2000,
      run: () => storageAccounting.reconcileOne(),
    },
    {
      key: "billing-webhook",
      flag: "billing_v6",
      interval: 2000,
      run: () => billing.processOne(owner),
    },
    {
      key: "billing-checkout",
      flag: "billing_checkout_v6",
      interval: 2000,
      run: () => billing.processCheckout(),
    },
    {
      key: "billing-checkout-reconciliation",
      flag: "billing_checkout_v6",
      interval: 60000,
      run: () => billing.reconcileCheckouts(),
    },
    {
      key: "billing-subscription-reconciliation",
      flag: "billing_v6",
      interval: 300000,
      run: () => billing.reconcileSubscriptions(),
    },
    {
      key: "auth-event-retention",
      flag: "transactional_email_v6",
      interval: 3600000,
      run: () =>
        db
          .delete(authSecurityEvents)
          .where(lt(authSecurityEvents.expiresAt, new Date())),
    },
  ];
  async function tick() {
    const settings = await flags();
    await Promise.all(
      jobs.map(async (job) => {
        if (
          stopped ||
          runningJobs.has(job.key) ||
          !v6FeatureEnabled(settings, job.flag)
        )
          return;
        const now = new Date();
        const occurrenceId = Math.floor(
          now.getTime() / job.interval,
        ).toString();
        const [lease] = await db
          .insert(platformSchedulerLeases)
          .values({
            jobKey: job.key,
            occurrenceId,
            owner,
            leaseUntil: new Date(now.getTime() + 120000),
          })
          .onConflictDoUpdate({
            target: platformSchedulerLeases.jobKey,
            set: {
              occurrenceId,
              owner,
              leaseUntil: new Date(now.getTime() + 120000),
            },
            setWhere: sql`${platformSchedulerLeases.leaseUntil} <= ${now.toISOString()}::timestamptz and ${platformSchedulerLeases.occurrenceId} <> ${occurrenceId}`,
          })
          .returning();
        if (!lease) return;
        const own = and(
          eq(platformSchedulerLeases.jobKey, job.key),
          eq(platformSchedulerLeases.owner, owner),
          eq(platformSchedulerLeases.occurrenceId, occurrenceId),
        );
        const task = (async () => {
          const renewal = setInterval(() => {
            void db
              .update(platformSchedulerLeases)
              .set({ leaseUntil: new Date(Date.now() + 120000) })
              .where(own)
              .catch(() =>
                logger.warn(
                  { jobKey: job.key },
                  "Scheduler lease renewal unavailable",
                ),
              );
          }, 30000);
          renewal.unref();
          try {
            await job.run();
            await db
              .update(platformSchedulerLeases)
              .set({
                lastSuccessAt: new Date(),
                lastErrorCode: null,
                leaseUntil: new Date(),
              })
              .where(own);
          } catch {
            await db
              .update(platformSchedulerLeases)
              .set({ lastErrorCode: "job_failed", leaseUntil: new Date() })
              .where(own);
            logger.warn(
              { jobKey: job.key },
              "SaaS platform job failed; durable domain work retained",
            );
          } finally {
            clearInterval(renewal);
          }
        })()
          .catch(() =>
            logger.warn(
              { jobKey: job.key },
              "SaaS job outcome awaits reconciliation",
            ),
          )
          .finally(() => {
            runningJobs.delete(job.key);
          });
        runningJobs.set(job.key, task);
      }),
    );
  }
  function configureLogs() {
    if (!logs) throw new Error("SaaS requires encrypted durable run logs");
    configureRunLogStore(logs);
  }
  function start() {
    if (timer) return;
    const run = () => {
      if (active || stopped) return;
      active = tick()
        .catch(() => logger.warn("SaaS scheduler unavailable"))
        .finally(() => {
          active = undefined;
        });
    };
    timer = setInterval(run, 2000);
    timer.unref();
    run();
  }
  async function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    await active;
    await Promise.all(runningJobs.values());
    await runtime.relay.stop();
  }
  return {
    sandboxHosts,
    backupSchedule,
    config,
    origins,
    email,
    billing,
    entitlements,
    usage,
    storage,
    storageAccounting,
    onboarding,
    runtime,
    catalog,
    costs,
    fleet,
    support,
    offboarding,
    accountDeletion,
    enabled,
    flags,
    notifications,
    invitations,
    configureLogs,
    start,
    stop,
  };
}
export type SaasPlatform = ReturnType<typeof saasPlatform>;
