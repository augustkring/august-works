import { v7FeatureEnabled, v9FeatureEnabled, activationCommandSchema } from "@paperclipai/shared";
import { activationService } from "../services/saas/activation.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { z } from "zod";
import { Router, type Request } from "express";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  authSecurityEvents,
  authSessions,
  authUsers,
  companyMemberships,
  companyDeletionOperations,
  runtimeHosts,
  runtimeCapacityProfiles,
  runtimeVersionCatalog,
  supportSessions,
  deploymentRecords,
  platformSchedulerLeases,
  platformAdminAudit,
  type Db,
} from "@paperclipai/db";
import {
  BILLING_PRODUCTS,
  checkoutSchema,
  createSaasCompanySchema,
  runtimeCellBindingSchema,
  runtimeCellCreateSchema,
  runtimeOperationSchema,
  runtimeVersionCandidateSchema,
  runtimeVersionTransitionSchema,
  runtimeCapacityQualificationSchema,
  updateOnboardingSchema,
  type PermissionKey,
  type V6FeatureKey,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unauthorized } from "../errors.js";
import { accessService } from "../services/access.js";
import { logActivity } from "../services/activity-log.js";
import type { SaasPlatform } from "../services/saas/platform.js";
import { assertCompanyAccess } from "./authz.js";
import { publicJson } from "../services/saas/crypto.js";

export function saasRoutes(db: Db, platform: SaasPlatform) {
  const router = Router();
  async function user(req: Request) {
    if (
      req.actor.type !== "board" ||
      req.actor.source === "local_implicit" ||
      !req.actor.userId
    )
      throw unauthorized();
    const [row] = await db
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, req.actor.userId))
      .limit(1);
    if (!row) throw unauthorized();
    if (
      typeof req.query.expectedUserId === "string" &&
      req.query.expectedUserId !== row.id
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    return row;
  }
  async function company(
    req: Request,
    companyId: string,
    permission?: PermissionKey,
  ) {
    const actor = await user(req);
    assertCompanyAccess(req, companyId);
    const [membership] = await db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, actor.id),
          eq(companyMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) throw forbidden("Active company membership required");
    if (
      permission &&
      !(
        membership.membershipRole === "owner" ||
        membership.membershipRole === "admin" ||
        (await accessService(db).canUser(companyId, actor.id, permission))
      )
    )
      throw forbidden("Company permission required");
    return actor;
  }
  async function gate(key: V6FeatureKey) {
    if (!(await platform.enabled(key))) throw notFound();
  }
  router.use("/saas/internal", async (req, _res, next) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    if (!actor.emailVerified)
      throw forbidden("Verified operator account required");
    next();
  });
  router.get("/saas/capabilities", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      profile: "saas",
      enterpriseSso: v7FeatureEnabled(await instanceSettingsService(db).getExperimental(), "enterprise_identity_v7"),
      signup: await platform.enabled("saas_self_signup_v6"),
      emailVerification: await platform.enabled(
        "email_verification_required_v6",
      ),
      onboarding: await platform.enabled("server_onboarding_v6"),
      activationV9: v9FeatureEnabled(await instanceSettingsService(db).getExperimental(), "activation_v9"),
      billing: await platform.enabled("billing_v6"),
      checkout: await platform.enabled("billing_checkout_v6"),
      runtime: await platform.enabled("hosted_openclaw_v6"),
      usage: await platform.enabled("billing_usage_v6"),
      support: await platform.enabled("admin_support_v6"),
      deletion: await platform.enabled("company_deletion_v6"),
      notifications: await platform.enabled("transactional_email_v6"),
    });
  });
  router.post("/saas/companies", async (req, res) => {
    await gate("server_onboarding_v6");
    const actor = await user(req);
    const run = await platform.onboarding.create(
      actor.id,
      createSaasCompanySchema.parse(req.body),
    );
    res.status(201).json(run);
  });
  router.get("/companies/:companyId/onboarding", async (req, res) => {
    const companyId = String(req.params.companyId);
    await company(req, companyId);
    await gate("server_onboarding_v6");
    const run=await platform.onboarding.get(companyId);
    if(run.activationState)throw conflict("Continue in the current activation flow",{code:"ACTIVATION_FLOW_REQUIRED"});
    res.set("Cache-Control","private, no-store");
    res.json(run);
  });
  router.get("/companies/:companyId/activation", async (req,res) => {
    const companyId=z.uuid().parse(req.params.companyId);
    await company(req,companyId);
    res.set("Cache-Control","private, no-store");
    res.json(await activationService(db).get(req.actor,companyId));
  });
  router.post("/companies/:companyId/activation", async (req,res) => {
    const companyId=z.uuid().parse(req.params.companyId);
    await company(req,companyId);
    res.set("Cache-Control","private, no-store");
    res.json(await activationService(db).command(req.actor,companyId,activationCommandSchema.parse(req.body)));
  });
  router.patch("/companies/:companyId/onboarding", async (req, res) => {
    const companyId = String(req.params.companyId);
    const actor = await company(req, companyId, "billing:manage");
    await gate("server_onboarding_v6");
    res.json(
      await platform.onboarding.update(
        companyId,
        actor.id,
        updateOnboardingSchema.parse(req.body),
      ),
    );
  });
  router.post(
    "/companies/:companyId/onboarding/first-agent",
    async (req, res) => {
      const id = String(req.params.companyId),
        actor = await company(req, id, "agents:create");
      await gate("server_onboarding_v6");
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          name: z.string().trim().min(1).max(100),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(await platform.onboarding.firstAgent(id, actor.id, input));
    },
  );
  router.post(
    "/companies/:companyId/onboarding/starter-task",
    async (req, res) => {
      const id = String(req.params.companyId),
        actor = await company(req, id, "agents:configure");
      await gate("server_onboarding_v6");
      const input = z
        .object({ expectedVersion: z.number().int().positive() })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(
          await platform.onboarding.starterTask(
            id,
            actor.id,
            input.expectedVersion,
          ),
        );
    },
  );
  router.get("/companies/:companyId/notifications", async (req, res) => {
    const id = String(req.params.companyId),
      actor = await company(req, id);
    await gate("transactional_email_v6");
    res.json(await platform.notifications.list(id, actor.id));
  });
  router.get("/companies/:companyId/notifications/page", async (req, res) => {
    const id = String(req.params.companyId),
      actor = await company(req, id);
    await gate("transactional_email_v6");
    const input = z
      .object({
        cursor: z.string().max(256).optional(),
        unread: z.enum(["true", "false"]).optional(),
        expectedUserId: z.string().max(256).optional(),
      })
      .strict()
      .parse(req.query);
    res.json(
      await platform.notifications.listPage(
        id,
        actor.id,
        input.cursor ?? null,
        input.unread === "true",
      ),
    );
  });
  router.patch(
    "/companies/:companyId/notifications/preferences",
    async (req, res) => {
      const id = String(req.params.companyId),
        actor = await company(req, id);
      await gate("transactional_email_v6");
      res.json(
        await platform.notifications.updatePreference(id, actor.id, req.body),
      );
    },
  );
  router.patch(
    "/companies/:companyId/notifications/:notificationId",
    async (req, res) => {
      const id = String(req.params.companyId),
        actor = await company(req, id);
      await gate("transactional_email_v6");
      res.json(
        await platform.notifications.markRead(
          id,
          actor.id,
          String(req.params.notificationId),
        ),
      );
    },
  );
  router.get("/saas/account/notification-preferences", async (req, res) => {
    const actor = await user(req);
    await gate("transactional_email_v6");
    res.json(await platform.notifications.preferences(actor.id));
  });
  router.post("/companies/:companyId/saas-invitations", async (req, res) => {
    const companyId = String(req.params.companyId),
      actor = await company(req, companyId, "users:invite");
    await gate("transactional_email_v6");
    await platform.entitlements.require(companyId, "platform.access");
    res
      .status(202)
      .json(await platform.invitations.issue(companyId, actor.id, req.body));
  });
  router.get("/companies/:companyId/billing", async (req, res) => {
    const companyId = String(req.params.companyId);
    await company(req, companyId, "billing:view");
    await gate("billing_v6");
    const state = await platform.entitlements.resolve(companyId);
    res.json({
      ...state,
      products: Object.entries(BILLING_PRODUCTS).map(([key, product]) => ({
        key,
        label: product.label,
      })),
      prices: await platform.billing.catalog(),
      modelBilling: "byok_separate",
    });
  });
  router.post("/companies/:companyId/billing/checkout", async (req, res) => {
    const companyId = String(req.params.companyId);
    const actor = await company(req, companyId, "billing:manage");
    await gate("billing_checkout_v6");
    const result = await platform.billing.checkout(
      companyId,
      actor.id,
      checkoutSchema.parse(req.body),
    );
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: actor.id,
      action: "billing.checkout_requested",
      entityType: "billing_checkout",
      entityId: result.id,
    });
    res.status(202).json(result);
  });
  router.post("/companies/:companyId/billing/portal", async (req, res) => {
    const companyId = String(req.params.companyId);
    const actor = await company(req, companyId, "billing:manage");
    await gate("billing_v6");
    const url = await platform.billing.portal(companyId);
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: actor.id,
      action: "billing.portal_opened",
      entityType: "company",
      entityId: companyId,
    });
    res.set("Cache-Control", "no-store").json({ url });
  });
  router.get(
    "/companies/:companyId/billing/checkouts/:intentId",
    async (req, res) => {
      const companyId = String(req.params.companyId);
      await company(req, companyId, "billing:manage");
      await gate("billing_checkout_v6");
      res
        .set("Cache-Control", "no-store")
        .json(
          await platform.billing.checkoutStatus(
            companyId,
            String(req.params.intentId),
          ),
        );
    },
  );
  router.get("/companies/:companyId/usage", async (req, res) => {
    const companyId = String(req.params.companyId);
    await company(req, companyId, "billing:view");
    await gate("billing_usage_v6");
    const now = new Date();
    const start =
      typeof req.query.start === "string"
        ? new Date(req.query.start)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end =
      typeof req.query.end === "string" ? new Date(req.query.end) : now;
    res.json({
      ...(await platform.usage.summary(companyId, start, end)),
      storage: await platform.storageAccounting.summary(companyId),
    });
  });
  router.delete("/companies/:companyId", async (req, res) => {
    const companyId = String(req.params.companyId),
      actor = await company(req, companyId);
    await gate("company_deletion_v6");
    res
      .status(202)
      .json(await platform.offboarding.request(companyId, actor.id, req.body));
  });
  router.get("/companies/:companyId/deletion", async (req, res) => {
    const companyId = String(req.params.companyId),
      actor = await user(req),
      receipt = await platform.offboarding.get(companyId);
    if (receipt?.requestedByUserId !== actor.id) await company(req, companyId);
    res.json(receipt);
  });
  router.get("/companies/:companyId/support-sessions", async (req, res) => {
    const companyId = String(req.params.companyId),
      actor = await company(req, companyId);
    await gate("admin_support_v6");
    res.json(await platform.support.list(companyId, actor.id));
  });
  router.post("/companies/:companyId/support-sessions", async (req, res) => {
    const companyId = String(req.params.companyId),
      actor = await company(req, companyId);
    await gate("admin_support_v6");
    res
      .status(201)
      .json(await platform.support.approve(companyId, actor.id, req.body));
  });
  router.delete(
    "/companies/:companyId/support-sessions/:sessionId",
    async (req, res) => {
      const companyId = String(req.params.companyId),
        actor = await company(req, companyId);
      await gate("admin_support_v6");
      res.json(
        await platform.support.revoke(
          companyId,
          actor.id,
          String(req.params.sessionId),
        ),
      );
    },
  );
  router.get("/saas/internal/support/:sessionId/status", async (req, res) => {
    const actor = await user(req);
    await gate("admin_support_v6");
    res
      .set("Cache-Control", "no-store")
      .json(
        publicJson(
          await platform.support.status(String(req.params.sessionId), actor.id),
        ),
      );
  });
  router.post(
    "/saas/internal/support/:sessionId/overrides",
    async (req, res) => {
      const actor = await user(req);
      await gate("admin_support_v6");
      res
        .status(201)
        .json(
          await platform.support.override(
            String(req.params.sessionId),
            actor.id,
            req.body,
          ),
        );
    },
  );
  router.get("/saas/account/deletion-receipts", async (req, res) => {
    const actor = await user(req);
    res.set("Cache-Control", "no-store").json(
      await db
        .select({
          id: companyDeletionOperations.id,
          companyId: companyDeletionOperations.companyId,
          status: companyDeletionOperations.status,
          stage: companyDeletionOperations.stage,
          createdAt: companyDeletionOperations.createdAt,
          completedAt: companyDeletionOperations.completedAt,
        })
        .from(companyDeletionOperations)
        .where(eq(companyDeletionOperations.requestedByUserId, actor.id))
        .limit(100),
    );
  });
  router.post("/saas/account/deletion", async (req, res) => {
    const actor = await user(req);
    await gate("company_deletion_v6");
    res
      .status(202)
      .set("Cache-Control", "no-store")
      .json(await platform.accountDeletion.request(actor.id, req.body));
  });
  router.post(
    "/saas/internal/support/:sessionId/runtime-cells/:cellId/operations",
    async (req, res) => {
      const actor = await user(req);
      await gate("admin_support_v6");
      const input = runtimeOperationSchema.parse(req.body);
      if (!["stop", "backup", "rotate_gateway"].includes(input.action))
        await gate("hosted_openclaw_v6");
      res
        .status(202)
        .json(
          publicJson(
            await platform.support.runtimeAction(
              String(req.params.sessionId),
              actor.id,
              String(req.params.cellId),
              input,
            ),
          ),
        );
    },
  );
  router.get(
    "/saas/internal/support/:sessionId/runtime-cells/:cellId/backups",
    async (req, res) => {
      const actor = await user(req);
      await gate("admin_support_v6");
      res
        .set("Cache-Control", "no-store")
        .json(
          publicJson(
            await platform.support.backupStatus(
              String(req.params.sessionId),
              actor.id,
              String(req.params.cellId),
            ),
          ),
        );
    },
  );
  router.post("/saas/internal/runtime-versions", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("admin_support_v6");
    res
      .status(201)
      .json(
        await platform.catalog.candidate(
          actor.id,
          runtimeVersionCandidateSchema.parse(req.body),
        ),
      );
  });
  router.post("/saas/internal/runtime-versions/status", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("admin_support_v6");
    res.json(
      await platform.catalog.transition(
        actor.id,
        runtimeVersionTransitionSchema.parse(req.body),
      ),
    );
  });
  router.post("/saas/internal/runtime-capacity", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("admin_support_v6");
    res
      .status(201)
      .json(
        publicJson(
          await platform.catalog.qualifyCapacity(
            actor.id,
            runtimeCapacityQualificationSchema.parse(req.body),
          ),
        ),
      );
  });
  router.post(
    "/saas/internal/support/:sessionId/canary-runtime",
    async (req, res) => {
      const actor = await user(req);
      await gate("admin_support_v6");
      await gate("hosted_openclaw_v6");
      const input = runtimeCellCreateSchema.parse(req.body);
      if (input.isolationMode === "dedicated_agent_gateway")
        await gate("runtime_dedicated_gateway_v6");
      if (input.isolationMode === "dedicated_vm")
        await gate("runtime_dedicated_vm_v6");
      const result = await platform.support.canaryRuntime(
        String(req.params.sessionId),
        actor.id,
        input,
      );
      res
        .status(202)
        .json(
          publicJson({ cellId: result.cell.id, operation: result.operation }),
        );
    },
  );
  router.get("/saas/internal/operations", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("admin_support_v6");
    const [jobs, hosts, profiles, versions, support, deployments, queues] =
      await Promise.all([
        db
          .select({
            jobKey: platformSchedulerLeases.jobKey,
            leaseUntil: platformSchedulerLeases.leaseUntil,
            lastSuccessAt: platformSchedulerLeases.lastSuccessAt,
            lastErrorCode: platformSchedulerLeases.lastErrorCode,
          })
          .from(platformSchedulerLeases)
          .limit(100),
        db
          .select({
            id: runtimeHosts.id,
            status: runtimeHosts.status,
            region: runtimeHosts.region,
            lastHeartbeatAt: runtimeHosts.lastHeartbeatAt,
            fencedAt: runtimeHosts.fencedAt,
            cpuTotalMillis: runtimeHosts.cpuTotalMillis,
            cpuReservedMillis: runtimeHosts.cpuReservedMillis,
          })
          .from(runtimeHosts)
          .orderBy(desc(runtimeHosts.createdAt))
          .limit(200),
        db
          .select({
            key: runtimeCapacityProfiles.key,
            commercialProductKey: runtimeCapacityProfiles.commercialProductKey,
            cpuMillis: runtimeCapacityProfiles.cpuMillis,
            memoryBytes: runtimeCapacityProfiles.memoryBytes,
            diskBytes: runtimeCapacityProfiles.diskBytes,
            qualified: runtimeCapacityProfiles.qualified,
          })
          .from(runtimeCapacityProfiles)
          .limit(100),
        db
          .select({
            imageDigest: runtimeVersionCatalog.imageDigest,
            providerVersion: runtimeVersionCatalog.providerVersion,
            stateFormat: runtimeVersionCatalog.stateFormat,
            status: runtimeVersionCatalog.status,
            approvedAt: runtimeVersionCatalog.approvedAt,
          })
          .from(runtimeVersionCatalog)
          .orderBy(desc(runtimeVersionCatalog.createdAt))
          .limit(100),
        db
          .select({
            id: supportSessions.id,
            companyId: supportSessions.companyId,
            scopes: supportSessions.scopes,
            expiresAt: supportSessions.expiresAt,
          })
          .from(supportSessions)
          .where(
            and(
              eq(supportSessions.operatorUserId, actor.id),
              isNull(supportSessions.revokedAt),
              gt(supportSessions.expiresAt, new Date()),
            ),
          )
          .limit(100),
        db
          .select({
            sourceSha: deploymentRecords.sourceSha,
            imageDigest: deploymentRecords.imageDigest,
            schemaVersion: deploymentRecords.schemaVersion,
            environment: deploymentRecords.environment,
            verificationResult: deploymentRecords.verificationResult,
            deployedAt: deploymentRecords.deployedAt,
          })
          .from(deploymentRecords)
          .orderBy(desc(deploymentRecords.deployedAt))
          .limit(10),
        db.execute<{ domain: string; status: string; count: string }>(
          sql`select 'email' as domain,status,count(*)::text as count from email_deliveries group by status union all select 'billing_webhook',status,count(*)::text from billing_webhook_events group by status union all select 'checkout',status,count(*)::text from billing_checkout_intents group by status union all select 'runtime_operation',status,count(*)::text from runtime_operations group by status union all select 'provider_operation',status,count(*)::text from runtime_host_provider_operations group by status union all select 'deletion',status,count(*)::text from company_deletion_operations group by status union all select 'account_deletion',status,count(*)::text from account_deletion_operations group by status`,
        ),
      ]);
    res.set("Cache-Control", "no-store").json(
      publicJson({
        environment: platform.config.environment,
        jobs,
        hosts,
        profiles,
        versions,
        support,
        deployments,
        queues: Array.from(queues),
      }),
    );
  });
  router.get("/saas/internal/costs", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("admin_support_v6");
    res.set("Cache-Control", "no-store").json(await platform.costs.latest());
  });
  router.post("/saas/internal/costs", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("admin_support_v6");
    await gate("billing_usage_v6");
    res.status(201).json(await platform.costs.record(actor.id, req.body));
  });
  router.get("/saas/internal/fleet", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("runtime_host_agent_v6");
    res.set("Cache-Control", "no-store").json(
      publicJson({
        hosts: await db
          .select({
            id: runtimeHosts.id,
            status: runtimeHosts.status,
            region: runtimeHosts.region,
            lastHeartbeatAt: runtimeHosts.lastHeartbeatAt,
            fencedAt: runtimeHosts.fencedAt,
            retiredAt: runtimeHosts.retiredAt,
            cpuTotalMillis: runtimeHosts.cpuTotalMillis,
            cpuReservedMillis: runtimeHosts.cpuReservedMillis,
          })
          .from(runtimeHosts)
          .limit(200),
        versions: await db.select().from(runtimeVersionCatalog).limit(100),
      }),
    );
  });
  router.get("/saas/internal/fleet/inventory", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("admin_support_v6");
    const [report] = await db
      .select({
        observedAt: platformAdminAudit.createdAt,
        report: platformAdminAudit.safeDetails,
      })
      .from(platformAdminAudit)
      .where(
        and(
          eq(platformAdminAudit.action, "runtime.provider_inventory_observed"),
          eq(platformAdminAudit.resourceId, platform.config.environment),
        ),
      )
      .orderBy(desc(platformAdminAudit.createdAt))
      .limit(1);
    res.set("Cache-Control", "no-store").json(report ?? null);
  });
  router.post("/saas/internal/fleet/hosts", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("runtime_auto_host_scale_v6");
    const input = z
      .object({
        profileKey: z.string().min(1).max(100),
        companyId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    res
      .status(202)
      .json(
        publicJson(
          await platform.fleet.requestHost(
            input.profileKey,
            actor.id,
            input.companyId,
          ),
        ),
      );
  });
  router.post("/saas/internal/fleet/hosts/:hostId/drain", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("runtime_host_agent_v6");
    res.json(await platform.fleet.drain(String(req.params.hostId), actor.id));
  });
  router.post("/saas/internal/fleet/hosts/:hostId/fence", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("runtime_host_agent_v6");
    res
      .status(202)
      .json(
        await platform.fleet.requestFence(String(req.params.hostId), actor.id),
      );
  });
  router.post("/saas/internal/fleet/hosts/:hostId/retire", async (req, res) => {
    const actor = await user(req);
    platform.support.operator(actor.id);
    await gate("runtime_host_agent_v6");
    res
      .status(202)
      .json(
        await platform.fleet.requestRetire(String(req.params.hostId), actor.id),
      );
  });
  router.get("/saas/account/sessions", async (req, res) => {
    const actor = await user(req);
    const sessions = await db
      .select({
        id: authSessions.id,
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, actor.id),
          gt(authSessions.expiresAt, new Date()),
        ),
      );
    res.set("Cache-Control", "no-store").json(sessions);
  });
  router.get("/companies/:companyId/runtime-options", async (req, res) => {
    const companyId = String(req.params.companyId);
    await company(req, companyId, "runtime:manage");
    await gate("hosted_openclaw_v6");
    const profiles = await db
      .select({
        commercialProductKey: runtimeCapacityProfiles.commercialProductKey,
        key: runtimeCapacityProfiles.key,
        cpuMillis: runtimeCapacityProfiles.cpuMillis,
        memoryBytes: runtimeCapacityProfiles.memoryBytes,
        diskBytes: runtimeCapacityProfiles.diskBytes,
      })
      .from(runtimeCapacityProfiles)
      .where(eq(runtimeCapacityProfiles.qualified, true));
    const versions = await db
      .select({
        imageDigest: runtimeVersionCatalog.imageDigest,
        providerVersion: runtimeVersionCatalog.providerVersion,
      })
      .from(runtimeVersionCatalog)
      .where(eq(runtimeVersionCatalog.status, "approved"));
    res.json(
      publicJson({
        profiles,
        versions,
        dedicatedGateway: await platform.enabled(
          "runtime_dedicated_gateway_v6",
        ),
        dedicatedVm: await platform.enabled("runtime_dedicated_vm_v6"),
      }),
    );
  });
  router.put(
    "/companies/:companyId/runtime-cells/:cellId/model-provider",
    async (req, res) => {
      const companyId = String(req.params.companyId),
        actor = await company(req, companyId, "runtime:manage");
      await gate("hosted_openclaw_v6");
      res.json(
        await platform.runtime.configureModel(
          companyId,
          String(req.params.cellId),
          actor.id,
          req.body,
        ),
      );
    },
  );
  router.post(
    "/companies/:companyId/runtime-cells/:cellId/binding",
    async (req, res) => {
      const companyId = String(req.params.companyId);
      await company(req, companyId, "runtime:manage");
      await gate("hosted_openclaw_v6");
      const input = runtimeCellBindingSchema.parse(req.body);
      res
        .status(201)
        .json(
          await platform.runtime.bind(
            companyId,
            String(req.params.cellId),
            input.agentId,
            req.actor,
          ),
        );
    },
  );
  router.get(
    "/companies/:companyId/runtime-cells/:cellId/backups",
    async (req, res) => {
      const companyId = String(req.params.companyId);
      await company(req, companyId, "runtime:manage");
      await gate("hosted_openclaw_v6");
      res.json(
        publicJson(
          await platform.runtime.backups.list(
            companyId,
            String(req.params.cellId),
          ),
        ),
      );
    },
  );
  router.get("/companies/:companyId/runtime-cells", async (req, res) => {
    const companyId = String(req.params.companyId);
    await company(req, companyId);
    await gate("hosted_openclaw_v6");
    const cells = await platform.runtime.list(companyId);
    res.json(
      publicJson(
        cells.map((cell) => ({
          id: cell.id,
          companyId: cell.companyId,
          isolationMode: cell.isolationMode,
          capacityProfile: cell.capacityProfile,
          imageDigest: cell.activeImageDigest,
          generation: cell.generation,
          status: cell.status,
          lastHealthyAt: cell.lastHealthyAt,
          lastErrorCode: cell.lastErrorCode,
          suspendedReason: cell.suspendedReason,
          deletedAt: cell.deletedAt,
          modelProvider: cell.modelProvider,
          modelId: cell.modelId,
          modelConfigured: Boolean(cell.modelSecretRef),
        })),
      ),
    );
  });
  router.get(
    "/companies/:companyId/runtime-cells/:cellId/backup-policy",
    async (req, res) => {
      const companyId = String(req.params.companyId);
      await company(req, companyId, "runtime:manage");
      res.json(
        await platform.backupSchedule.get(companyId, String(req.params.cellId)),
      );
    },
  );
  router.put(
    "/companies/:companyId/runtime-cells/:cellId/backup-policy",
    async (req, res) => {
      const companyId = String(req.params.companyId),
        actor = await company(req, companyId, "runtime:manage");
      if (req.body?.enabled) await gate("hosted_openclaw_v6");
      res.json(
        await platform.backupSchedule.configure(
          companyId,
          String(req.params.cellId),
          actor.id,
          req.body,
        ),
      );
    },
  );
  router.post("/companies/:companyId/runtime-cells", async (req, res) => {
    const companyId = String(req.params.companyId);
    const actor = await company(req, companyId, "runtime:manage");
    await gate("hosted_openclaw_v6");
    const input = runtimeCellCreateSchema.parse(req.body);
    if (input.isolationMode === "dedicated_agent_gateway")
      await gate("runtime_dedicated_gateway_v6");
    if (input.isolationMode === "dedicated_vm")
      await gate("runtime_dedicated_vm_v6");
    const result = await platform.runtime.create(companyId, actor.id, input);
    res
      .status(202)
      .json(
        publicJson({ cellId: result.cell.id, operation: result.operation }),
      );
  });
  router.post(
    "/companies/:companyId/runtime-cells/:cellId/operations",
    async (req, res) => {
      const companyId = String(req.params.companyId);
      const actor = await company(req, companyId, "runtime:manage");
      const input = runtimeOperationSchema.parse(req.body);
      // Rollback retains stop/delete access even when new runtime admission is disabled.
      if (
        !["stop", "delete", "backup", "rotate_gateway"].includes(input.action)
      )
        await gate("hosted_openclaw_v6");
      res
        .status(202)
        .json(
          publicJson(
            await platform.runtime.request(
              companyId,
              String(req.params.cellId),
              actor.id,
              input,
            ),
          ),
        );
    },
  );
  router.delete("/saas/account/sessions/:sessionId", async (req, res) => {
    const actor = await user(req);
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(authSessions)
        .where(
          and(
            eq(authSessions.id, String(req.params.sessionId)),
            eq(authSessions.userId, actor.id),
          ),
        )
        .returning({ id: authSessions.id });
      if (!deleted) throw notFound();
      await tx.insert(authSecurityEvents).values({
        userId: actor.id,
        action: "sessions_revoked",
        expiresAt: new Date(Date.now() + 90 * 86400000),
      });
    });
    res.status(204).end();
  });
  return router;
}
