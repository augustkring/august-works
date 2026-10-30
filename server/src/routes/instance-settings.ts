import { eq } from "drizzle-orm";
import { Router, type Request } from "express";
import { authUsers, companies, type Db } from "@paperclipai/db";
import {
  type InstanceGeneralSettings,
  patchInstanceSettingsSchema,
  patchInstanceExperimentalSettingsSchema,
  patchInstanceGeneralSettingsSchema,
  startTaskDrainRequestSchema,
} from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import {
  cloudTenantPrimaryCompanyId,
  getCloudStackContext,
  isCloudManagedInstance,
} from "../services/cloud-instance.js";
import { getHiddenSettings } from "../services/settings-visibility.js";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  companyService,
  heartbeatService,
  instanceSettingsService,
  logActivity,
  publishActivity,
  type ActivityPublication,
} from "../services/index.js";
import { environmentService } from "../services/environments.js";
import { assertEnvironmentSelectionForCompany } from "./environment-selection.js";
import { assertBoardOrgAccess, getActorInfo } from "./authz.js";
import { assertConfiguredOperatorAuthentication } from "../auth/authenticator-assurance.js";

function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a)
      && Array.isArray(b)
      && a.length === b.length
      && a.every((value, i) => sameJsonValue(value, b[i]))
    );
  }
  const aKeys = Object.keys(a);
  const bKeys = new Set(Object.keys(b));
  return aKeys.length === bKeys.size && aKeys.every((key) =>
    bKeys.has(key) && sameJsonValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Floor writes to operator-hidden settings. Same-value writes pass so clients
 * that echo a full GET response keep working (the executionMode precedent);
 * only a write that would actually change a hidden setting is rejected.
 */
async function assertNoHiddenSettingChanges(
  body: Record<string, unknown>,
  getCurrent: () => Promise<object>,
  isHiddenField: (field: string) => boolean,
) {
  const hiddenKeys = Object.keys(body).filter(isHiddenField);
  if (hiddenKeys.length === 0) return;
  const current = (await getCurrent()) as Record<string, unknown>;
  for (const key of hiddenKeys) {
    if (sameJsonValue(body[key], current[key])) continue;
    throw forbidden(`${key} is managed by the hosting operator on this instance`, {
      code: "settings_operator_managed",
    });
  }
}

/**
 * Publish activity events for an already-committed mutation. The audit row
 * exists in the database no matter what happens here, so a publish failure
 * must not turn into a route error: that would report the mutation as
 * failed to the caller when it in fact succeeded. Log and swallow instead.
 */
function publishActivitiesBestEffort(publications: ActivityPublication[], action: string) {
  for (const publication of publications) {
    try {
      publishActivity(publication);
    } catch (err) {
      logger.error({ err, action, companyId: publication.companyId }, "failed to publish activity event");
    }
  }
}

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

// A task-drain start or stop reads the live drain state, writes an audit
// transaction, and only then mutates the process-local drain state. The
// audit write is an async gap: two overlapping requests can commit their
// transactions in one order but reach the in-memory mutation in the other
// order, so a stale transition would win, the audit log would not match the
// live state, and the response for the newer request would not match what
// actually ended up live. Run each request's whole read-audit-apply
// sequence through this queue so overlapping requests execute one at a
// time, in the order they enter it: audit order and apply order then always
// agree, and each response reports exactly the state its own request
// produced.
let taskDrainTransitionQueue: Promise<void> = Promise.resolve();

function withTaskDrainTransition<T>(run: () => Promise<T>): Promise<T> {
  const turn = taskDrainTransitionQueue.then(run);
  // Normalize to a settled void promise for the next caller in line, so a
  // rejected transition (a failed audit write, for example) cannot wedge
  // every later transition behind it.
  taskDrainTransitionQueue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

export function instanceSettingsRoutes(
  db: Db,
  options?: { deploymentProfile?: string; operatorUserIds?: readonly string[] },
) {
  const router = Router();
  const svc = instanceSettingsService(db);
  const environments = environmentService(db);
  const heartbeat = heartbeatService(db);
  async function assertCanManage(req: Request, requireRecent = true) {
    if (options?.deploymentProfile !== "saas") {
      assertCanManageInstanceSettings(req);
      return;
    }
    if (
      req.actor.type !== "board" || req.actor.source !== "session" ||
      !req.actor.userId || !options.operatorUserIds?.includes(req.actor.userId)
    ) throw forbidden("Named SaaS operator access required");
    const [user] = await db
      .select({ verified: authUsers.emailVerified })
      .from(authUsers)
      .where(eq(authUsers.id, req.actor.userId))
      .limit(1);
    if (!user?.verified) throw forbidden("Verified SaaS operator account required");
    await assertConfiguredOperatorAuthentication(db, req.actor, options.operatorUserIds ?? [], { requireRecent });
  }

  async function pinSaasOperatorMutation(tx: Pick<Db, "execute">, req: Request) {
    if (options?.deploymentProfile !== "saas") return;
    await assertConfiguredOperatorAuthentication(
      tx,
      req.actor,
      options.operatorUserIds ?? [],
      { requireRecent: true },
    );
  }

  async function assertCanRead(req: Request) {
    if (
      options?.deploymentProfile === "saas" && req.actor.type === "board" &&
      req.actor.userId && options.operatorUserIds?.includes(req.actor.userId)
    ) return assertCanManage(req, false);
    assertBoardOrgAccess(req);
  }

  async function withOperatorRead<T>(req: Request, read: (reader: Db) => T | Promise<T>): Promise<T> {
    if (options?.deploymentProfile !== "saas" || !req.actor.userId ||
        !options.operatorUserIds?.includes(req.actor.userId)) return read(db);
    return db.transaction(async tx => {
      await assertConfiguredOperatorAuthentication(tx, req.actor, options.operatorUserIds ?? [], { requireRecent: false });
      const result = await read(tx as unknown as Db);
      await assertConfiguredOperatorAuthentication(tx, req.actor, options.operatorUserIds ?? [], { requireRecent: false });
      return result;
    });
  }

  function canReadResourcePolicy(req: Request) {
    return options?.deploymentProfile === "saas"
      ? req.actor.type === "board" && req.actor.source === "session" && !!req.actor.userId && !!options.operatorUserIds?.includes(req.actor.userId)
      : req.actor.type === "board" && (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin === true);
  }
  function publicGeneral(req: Request, general: InstanceGeneralSettings): InstanceGeneralSettings {
    if (canReadResourcePolicy(req)) return general;
    const { resourceGovernance: _operatorOnly, ...visible } = general;
    return visible;
  }

  router.get("/instance/settings", async (req, res) => {
    await assertCanRead(req);
    const settings = await withOperatorRead(req, reader => instanceSettingsService(reader).get());
    res.json({ ...settings, general: publicGeneral(req, settings.general) });
  });

  router.patch(
    "/instance/settings",
    validate(patchInstanceSettingsSchema),
    async (req, res) => {
      await assertCanManage(req);
      if (Object.prototype.hasOwnProperty.call(req.body, "defaultEnvironmentId")) {
        await assertEnvironmentSelectionForCompany(
          environments,
          "instance",
          typeof req.body.defaultEnvironmentId === "string" ? req.body.defaultEnvironmentId : null,
        );
      }
      // An explicit tenant write of the instance default reclassifies its
      // attribution: whatever the default becomes — including a deliberate
      // re-selection of the managed sandbox row — it is tenant-chosen, so
      // the reconciliation stamp marker must not survive to let a later
      // managed-sandbox-only mode-off pass mistake the tenant's choice for a
      // stamp and revert it. The marker clear and the settings write commit
      // in ONE transaction, so no partial failure can desync attribution
      // from the default (neither a stale stamp on a tenant choice, nor a
      // reconciliation default that lost its marker and can never revert).
      const writesDefault = Object.prototype.hasOwnProperty.call(req.body, "defaultEnvironmentId");
      const managedSandbox = writesDefault
        ? await environments.findManagedSandboxEnvironment(undefined, { includeArchived: true })
        : null;
      const updated = await db.transaction(async (tx) => {
        await pinSaasOperatorMutation(tx, req);
        if (managedSandbox?.metadata?.managedDefaultStamped === true) {
          const { managedDefaultStamped: _cleared, ...remainingMetadata } = managedSandbox.metadata;
          await environments.update(managedSandbox.id, { metadata: remainingMetadata }, { db: tx });
        }
        const settings = await svc.update(req.body, { db: tx });
        await pinSaasOperatorMutation(tx, req);
        return settings;
      });
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "instance.settings.updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              defaultEnvironmentId: updated.defaultEnvironmentId,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated);
    },
  );

  router.get("/instance/settings/general", async (req, res) => {
    // General settings (e.g. feedbackDataSharingPreference) are readable by any
    // authenticated org member or instance admin. Only PATCH requires instance-admin.
    await assertCanRead(req);
    res.json(publicGeneral(req, await withOperatorRead(req, reader => instanceSettingsService(reader).getGeneral())));
  });

  router.patch(
    "/instance/settings/general",
    validate(patchInstanceGeneralSettingsSchema),
    async (req, res) => {
      await assertCanManage(req);
      // Floor: on cloud-managed instances the execution mode is pinned by the
      // platform (the execution-policy bootstrap writes it at boot). No
      // instance admin — including a computed owner-admin — may change it: a
      // forced provider switch would strand runs on a provider the platform
      // never provisioned. Same-value writes pass so settings forms that echo
      // the full general-settings object keep working. Absent and "any" both
      // mean unrestricted, so they compare equal.
      if (
        isCloudManagedInstance() &&
        Object.prototype.hasOwnProperty.call(req.body, "executionMode")
      ) {
        const current = await svc.getGeneral();
        if ((req.body.executionMode ?? "any") !== (current.executionMode ?? "any")) {
          throw forbidden("executionMode is platform-managed on cloud-managed instances", {
            code: "execution_mode_platform_managed",
          });
        }
      }
      const hidden = getHiddenSettings();
      await assertNoHiddenSettingChanges(
        req.body,
        () => svc.getGeneral(),
        (field) => hidden.has(`instance.general.${field}`),
      );
      const updated = options?.deploymentProfile === "saas" ? await db.transaction(async (tx) => {
        await pinSaasOperatorMutation(tx, req);
        const settings = await svc.updateGeneral(req.body, { db: tx });
        await pinSaasOperatorMutation(tx, req);
        return settings;
      }) : await svc.updateGeneral(req.body);
      const { resourceGovernance: _operatorResourcePolicy, ...auditableGeneral } = updated.general;
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "instance.settings.general_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              general: auditableGeneral,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.general);
    },
  );

  router.get("/instance/settings/experimental", async (req, res) => {
    // Experimental settings are readable by any authenticated org member
    // or instance admin. Updating them remains instance-admin only because
    // this payload includes instance-wide operational controls.
    await assertCanRead(req);
    res.json(await withOperatorRead(req, reader => instanceSettingsService(reader).getExperimental()));
  });

  router.patch(
    "/instance/settings/experimental",
    validate(patchInstanceExperimentalSettingsSchema),
    async (req, res) => {
      await assertCanManage(req);
      // Hiding the whole Experimental page floors every toggle; otherwise
      // only individually hidden keys are floored.
      const hidden = getHiddenSettings();
      await assertNoHiddenSettingChanges(
        req.body,
        () => svc.getExperimental(),
        (field) =>
          hidden.has("instance.experimental") || hidden.has(`instance.experimental.${field}`),
      );
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      const publications: ActivityPublication[] = [];
      const updated = await db.transaction(async (tx) => {
        await pinSaasOperatorMutation(tx, req);
        const settings = await svc.updateExperimental(req.body, { db: tx });
        await Promise.all(companyIds.map((companyId) =>
          logActivity(tx as unknown as Db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            agentApiKeyId: actor.agentApiKeyId,
            action: "instance.settings.experimental_updated",
            entityType: "instance_settings",
            entityId: settings.id,
            details: {
              experimental: settings.experimental,
              changedKeys: Object.keys(req.body).sort(),
            },
          }, publications),
        ));
        await pinSaasOperatorMutation(tx, req);
        return settings;
      });
      publishActivitiesBestEffort(publications, "instance.settings.experimental_updated");
      res.json(updated.experimental);
    },
  );

  router.get("/instance/task-drain", async (req, res) => {
    await assertCanRead(req);
    res.json(await withOperatorRead(req, () => heartbeat.getTaskDrainStatus()));
  });

  router.post(
    "/instance/task-drain",
    validate(startTaskDrainRequestSchema),
    async (req, res) => {
      await assertCanManage(req);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      const ttlMs = req.body.ttlMs ?? null;
      // The whole read-audit-apply sequence runs as one queued transition
      // (see withTaskDrainTransition above), so an overlapping start or
      // stop cannot commit its audit row, or apply its live state, out of
      // order against this one. computeTaskDrain runs inside the turn so
      // startedAt reflects the moment this request actually took effect,
      // not the moment it arrived and was queued behind another transition.
      const drain = await withTaskDrainTransition(async () => {
        const computed = heartbeat.computeTaskDrain({ ttlMs });
        // One transaction for every company's audit row, so a write that
        // succeeds for one company and fails for another never leaves a
        // partial activity history behind — either every company gets the
        // record, or none does. The drain mutation below runs only after
        // this transaction commits, so a failed write leaves the live
        // drain untouched and there is no partial state to roll back.
        const postCommitActivityPublications: ActivityPublication[] = [];
        await db.transaction(async (tx) => {
          await pinSaasOperatorMutation(tx, req);
          await Promise.all(
            companyIds.map((companyId) =>
              logActivity(tx as unknown as Db, {
                companyId,
                actorType: actor.actorType,
                actorId: actor.actorId,
                agentId: actor.agentId,
                runId: actor.runId,
                agentApiKeyId: actor.agentApiKeyId,
                action: "instance.task_drain.started",
                entityType: "instance_settings",
                entityId: "default",
                details: {
                  startedAt: computed.startedAt,
                  expiresAt: computed.expiresAt,
                },
              }, postCommitActivityPublications),
            ),
          );
          await pinSaasOperatorMutation(tx, req);
        });
        // The authenticated operator is pinned through the durable audit
        // commit. Applying process-local drain state is necessarily
        // post-commit; it cannot be atomic with the database session lock.
        heartbeat.applyTaskDrain(computed);
        // The audit record already committed, so a failure to publish it
        // here is not a reason to undo the drain: reverting the in-memory
        // state at this point would desync it from the committed row.
        // Swallow a publish failure so it cannot turn a committed mutation
        // into a false 500.
        publishActivitiesBestEffort(postCommitActivityPublications, "instance.task_drain.started");
        return computed;
      });
      res.json(drain);
    },
  );

  router.delete("/instance/task-drain", async (req, res) => {
    await assertCanManage(req);
    const actor = getActorInfo(req);
    const companyIds = await svc.listCompanyIds();
    // See the POST handler above for why the whole read-audit-apply
    // sequence runs inside withTaskDrainTransition: it queues this stop
    // behind any transition already in flight, so it cannot read a status
    // an overlapping request is about to make stale, and its audit row and
    // its live-state mutation always land in the same order as every other
    // queued transition.
    const wasActive = await withTaskDrainTransition(async () => {
      const priorStatus = heartbeat.getTaskDrainStatus();
      // Read wasActive once, here, and use this same value for the audit
      // detail and the response body below. A TTL that expires between two
      // separate reads would otherwise make the two values disagree.
      const wasActive = priorStatus.draining;
      // See the POST handler above for why this is one transaction, and why
      // the drain mutation runs only after it commits.
      const postCommitActivityPublications: ActivityPublication[] = [];
      await db.transaction(async (tx) => {
        await pinSaasOperatorMutation(tx, req);
        await Promise.all(
          companyIds.map((companyId) =>
            logActivity(tx as unknown as Db, {
              companyId,
              actorType: actor.actorType,
              actorId: actor.actorId,
              agentId: actor.agentId,
              runId: actor.runId,
              agentApiKeyId: actor.agentApiKeyId,
              action: "instance.task_drain.stopped",
              entityType: "instance_settings",
              entityId: "default",
              details: {
                wasActive,
              },
            }, postCommitActivityPublications),
          ),
        );
        await pinSaasOperatorMutation(tx, req);
      });
      // As on start, the audit commit is the durable authorization boundary;
      // the in-memory state change follows it and cannot share the DB lock.
      heartbeat.stopTaskDrain();
      // See the POST handler above for why a publish failure here is
      // swallowed instead of failing the route: the audit record already
      // committed, so a publish failure here must not undo a drain-stop
      // that is already correct in the database, and must not report the
      // stop as failed when it succeeded.
      publishActivitiesBestEffort(postCommitActivityPublications, "instance.task_drain.stopped");
      return wasActive;
    });
    res.json({ wasActive });
  });

  // Cloud lifecycle read-back: the harness answers a tenant's archive
  // doorbell by asking this instance what the Cloud-pinned primary
  // company's status actually is, so the shared-token doorbell can stay a
  // hint (see cloud-lifecycle-sync.ts). Reached by the harness with a
  // `lifecycle:read` Cloud control assertion. Instance-admin only for
  // humans: the response summarizes lifecycle state across EVERY company
  // on the instance, which a board member scoped to one company must not
  // be able to infer.
  router.get("/instance/lifecycle", async (req, res) => {
    await assertCanManage(req, false);
    const stackId = getCloudStackContext()?.stackId;
    if (!stackId) {
      res.status(404).json({ error: "not_cloud_managed" });
      return;
    }
    const primaryCompanyId = cloudTenantPrimaryCompanyId(stackId);
    const rows = await withOperatorRead(req, async reader => reader
      .select({ id: companies.id, status: companies.status })
      .from(companies));
    const primary = rows.find((row) => row.id === primaryCompanyId);
    res.json({
      primaryCompanyId,
      primaryCompanyStatus: primary?.status ?? "missing",
      otherUnarchivedCompanyCount: rows.filter(
        (row) => row.id !== primaryCompanyId && row.status !== "archived",
      ).length,
    });
  });

  // Cloud restore counterpart: "Resume organization" on a stack that was
  // archived because its primary company was archived must bring the
  // company back too, or the tenant's next doorbell would re-archive the
  // stack the customer just resumed. Idempotent: a primary company that is
  // not archived reports changed:false. Reached by the harness with a
  // `lifecycle:unarchive-primary` control assertion; instance admins hold
  // the same power through PATCH /api/companies/:id already.
  router.post("/instance/lifecycle/unarchive-primary", async (req, res) => {
    await assertCanManage(req);
    const stackId = getCloudStackContext()?.stackId;
    if (!stackId) {
      res.status(404).json({ error: "not_cloud_managed" });
      return;
    }
    const primaryCompanyId = cloudTenantPrimaryCompanyId(stackId);
    const companySvc = companyService(db);
    const existing = await companySvc.getById(primaryCompanyId);
    if (!existing) {
      res.status(404).json({ error: "primary_company_not_found" });
      return;
    }
    if (existing.status !== "archived") {
      res.json({ status: existing.status, changed: false });
      return;
    }
    // Attribution: only the harness's synthetic cloud_control actor logs
    // as the Cloud system identity; a human instance admin calling this
    // endpoint is recorded as themselves, exactly like an in-product
    // unarchive.
    const actor = req.actor.source === "cloud_control"
      ? { actorType: "system" as const, actorId: "paperclip-cloud", agentId: null, runId: null }
      : (() => {
          const info = getActorInfo(req);
          return {
            actorType: info.actorType,
            actorId: info.actorId,
            agentId: info.agentId,
            runId: info.runId,
          };
        })();
    const updated = await companySvc.update(primaryCompanyId, { status: "active" }, actor);
    res.json({ status: updated?.status ?? "active", changed: true });
  });

  return router;
}
