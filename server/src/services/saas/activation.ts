import { and, desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  authUsers,
  companies,
  companyMemberships,
  companyOnboardingRuns,
  agentPackageVersions,
  agentPackages,
  instanceSettings,
  type Db,
} from "@paperclipai/db";
import {
  activationCommandSchema,
  activationStateSchema,
  activationViewSchema,
  packageReleaseSchema,
  v9FeatureEnabled,
  v7FeatureEnabled,
  type ActivationState,
  type ActivationView,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { foundationService } from "../foundation/foundation-service.js";
import { packageReleaseBlockers } from "../agent-packages/package-policy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import {
  activationFirstValueView,
  readActivationFirstValue,
} from "./activation-first-value.js";
import { activationFirstTaskView, readActivationFirstTask, readRecordedActivationFirstTask, assertActivationFirstTaskDispatch } from "./activation-first-task.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { orchestrationRuntimeControl } from "../orchestration/orchestration-runtime-control.js";
import { withV7ActivityTransaction } from "../v7-mutations.js";

/** A presentation state machine on the existing onboarding owner. It never supplies
 * execution authority, grants, provider credentials, or synthetic first-value proof. */
export function activationService(db: Db) {
  async function lockSnapshot(tx: Db, companyId: string) {
    await tx.execute(
      sql`select set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`,
    );
    await lockAnalyticalCompany(tx, companyId);
    await lockMemoryPrivacy(tx, companyId);
    await tx
      .select({ key: instanceSettings.singletonKey })
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, "default"))
      .for("share");
  }
  async function access(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    write = false,
  ) {
    const userId = v5HumanActorId(actor);
    if (actor.source === "local_implicit")
      throw forbidden("A verified account is required for activation");
    await assertV5Authorization(
      tx,
      { ...actor, ignoreInstanceAdmin: true },
      companyId,
      "company_scope:read",
    );
    const membershipQuery = tx
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      );
    const [membership] = await (write
      ? membershipQuery.for("share")
      : membershipQuery);
    const userQuery = tx
      .select({ verified: authUsers.emailVerified })
      .from(authUsers)
      .where(eq(authUsers.id, userId));
    const [user] = await (write ? userQuery.for("share") : userQuery);
    if (!membership || !user?.verified)
      throw forbidden("Current verified company membership is required");
    return userId;
  }
  async function read(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    lock = false,
  ) {
    const userId = await access(tx, actor, companyId, lock);
    const q = tx
      .select()
      .from(companyOnboardingRuns)
      .where(eq(companyOnboardingRuns.companyId, companyId));
    const [run] = await (lock ? q.for("update") : q);
    if (!run?.activationState || run.createdByUserId !== userId)
      throw notFound("Activation not found");
    return {
      run,
      userId,
      state: activationStateSchema.parse(run.activationState),
    };
  }
  async function capabilities(tx: Db): Promise<ActivationView["capabilities"]> {
    if (
      !v7FeatureEnabled(
        await instanceSettingsService(tx).getExperimental(),
        "agent_packages_v7",
      )
    )
      return [];
    const rows = await tx
      .select({ version: agentPackageVersions, package: agentPackages })
      .from(agentPackageVersions)
      .innerJoin(
        agentPackages,
        eq(agentPackages.id, agentPackageVersions.packageId),
      )
      .where(
        and(
          eq(agentPackages.status, "active"),
          eq(agentPackageVersions.state, "published"),
        ),
      )
      .orderBy(agentPackages.key, desc(agentPackageVersions.createdAt))
      .limit(200);
    const seen = new Set<string>();
    const result: ActivationView["capabilities"] = [];
    for (const row of rows) {
      const parsed = packageReleaseSchema.safeParse(row.version.release);
      if (!parsed.success) continue;
      const release = parsed.data;
      // Only current independently qualified, draft-only customer capabilities enter the first-run path.
      if (
        release.manifest.audience !== "customer" ||
        release.manifest.maximumRisk !== "C1" ||
        release.manifest.actionClasses.some((a) => a !== "internal_draft") ||
        packageReleaseBlockers(release).length ||
        seen.has(row.package.id)
      )
        continue;
      seen.add(row.package.id);
      result.push({
        versionId: row.version.id,
        name: row.package.name,
        purpose: release.manifest.purpose,
        requiredConnections: release.manifest.requiredConnections,
        knownLimitations: release.manifest.knownLimitations,
      });
      if (result.length === 20) break;
    }
    return result;
  }
  async function view(tx: Db, actor: AuthorizationActor, companyId: string) {
    const [started] = await tx.execute(
      sql`select clock_timestamp() as observed_at`,
    );
    const { run, state, userId } = await read(tx, actor, companyId);
    const [company] = await tx
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId));
    if (!company) throw notFound("Company not found");
    const available = await capabilities(tx);
    const selected = available.find(
      (c) => c.versionId === state.packageVersionId,
    );
    const firstValue = await activationFirstValueView(
      tx,
      actor,
      companyId,
      {
        createdAt: run.createdAt,
        createdByUserId: userId,
        activationState: state,
      },
      !!selected,
    );
    const firstTask = await activationFirstTaskView(db, tx, actor, companyId, {
      createdAt: run.createdAt, createdByUserId: userId, activationState: state,
    });
    const blockers: ActivationView["blockers"] = [];
    if (!available.length || (state.packageVersionId && !selected))
      blockers.push("no_qualified_capability");
    if (state.step === "access" && selected?.requiredConnections.length)
      blockers.push("required_access_pending");
    if (
      ["review", "running", "result", "activated"].includes(state.step) &&
      firstValue.status !== "verified" && !firstTask.candidates.length && !firstTask.current
    )
      blockers.push("safe_execution_unqualified");
    // Do not return internal idempotency receipts to the presentation layer.
    const { receipts: _, ...publicState } = state;
    await access(tx, actor, companyId);
    const [finished] = await tx.execute(
      sql`select clock_timestamp() as observed_at`,
    );
    if (
      new Date(finished!.observed_at as string | Date).getTime() -
        new Date(started!.observed_at as string | Date).getTime() >
      5000
    )
      throw conflict("The current setup read exceeded its budget");
    return activationViewSchema.parse({
      runId: run.id,
      companyId,
      companyName: company.name,
      version: run.version,
      status: run.status,
      state: publicState,
      firstValue,
      firstTask,
      sources: [
        {
          id: "customer_context",
          status:
            state.discovery === "customer_context"
              ? "available"
              : "not_requested",
        },
        { id: "website", status: "not_requested" },
        { id: "connections", status: "not_connected" },
      ],
      capabilities: available,
      blockers,
    });
  }
  return {
    get: async (actor: AuthorizationActor, companyId: string) =>
      db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await access(txDb, actor, companyId);
        await lockSnapshot(txDb, companyId);
        await access(txDb, actor, companyId, true);
        const [company] = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("share");
        if (!company || company.status !== "active")
          throw forbidden("Company setup is unavailable");
        return view(txDb, actor, companyId);
      }),
    async command(actor: AuthorizationActor, companyId: string, raw: unknown) {
      const input = activationCommandSchema.parse(raw);
      const runtimeAction = await withV7ActivityTransaction(db, async (tx, publications) => {
        const txDb = tx as unknown as Db;
        await access(txDb, actor, companyId);
        await lockSnapshot(txDb, companyId);
        const [company] = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("update");
        if (!company || company.status !== "active")
          throw forbidden("Company setup is unavailable");
        const { run, state, userId } = await read(txDb, actor, companyId, true);
        const requestHash = nativeSha256(input);
        const receipt = state.receipts.find(
          (r) => r.requestId === input.requestId,
        );
        if (receipt) {
          if (receipt.requestHash !== requestHash)
            throw conflict("Request key has different content", {
              code: "ACTIVATION_REQUEST_CONFLICT",
            });
          return;
        }
        if (
          input.operation !== "stop_first_task" && !v9FeatureEnabled(
            await instanceSettingsService(txDb).getExperimental(),
            "activation_v9",
          )
        )
          throw notFound("Activation changes are not enabled");
        if (
          run.status !== "in_progress" ||
          run.version !== input.expectedVersion
        )
          throw conflict("Setup has changed. Refresh to continue.", {
            code: "ACTIVATION_VERSION_CONFLICT",
          });
        const next: ActivationState = { ...state };
        function requireStep(step: ActivationState["step"]) {
          if (state.step !== step)
            throw conflict("Continue at the current setup step", {
              code: "ACTIVATION_STEP_CONFLICT",
            });
        }
        switch (input.operation) {
          case "save_draft": {
            if (
              state.step === "intent" &&
              input.intent !== undefined &&
              input.companyPurpose === undefined
            )
              next.intent = input.intent;
            else if (
              state.step === "material_facts" &&
              input.companyPurpose !== undefined &&
              input.intent === undefined
            )
              next.companyPurpose = input.companyPurpose;
            else
              throw conflict("Only the current entered draft can be saved", {
                code: "ACTIVATION_STEP_CONFLICT",
              });
            break;
          }
          case "save_intent":
            requireStep("intent");
            next.intent = input.intent;
            next.step = "discovery_permission";
            break;
          case "build_customer_draft":
            requireStep("discovery_permission");
            next.discovery = "customer_context";
            next.step = "discovery_progress";
            break;
          case "continue_discovery":
            requireStep("discovery_progress");
            next.step = "material_facts";
            break;
          case "confirm_material_facts": {
            requireStep("material_facts");
            await assertV5Authorization(
              txDb,
              { ...actor, ignoreInstanceAdmin: true },
              companyId,
              "foundation:propose",
            );
            const foundation = foundationService(txDb),
              foundationActor = {
                principal: { type: "user" as const, userId },
              };
            const existing = await foundation.getByKey(companyId, "mission");
            if (existing) {
              if (existing.body !== input.companyPurpose) {
                if (existing.status !== "draft" || !existing.latestRevisionId)
                  throw conflict(
                    "Review the existing company purpose before replacing it",
                    { code: "MATERIAL_FACT_REVIEW_REQUIRED" },
                  );
                await foundation.updateDraft(
                  companyId,
                  existing.id,
                  {
                    baseRevisionId: existing.latestRevisionId,
                    body: input.companyPurpose,
                  },
                  foundationActor,
                );
              }
              next.missionFoundationId = existing.id;
            } else {
              const draft = await foundation.createDraft(
                companyId,
                {
                  foundationKey: "mission",
                  title: "Company purpose",
                  body: input.companyPurpose,
                  category: "company",
                  documentType: "mission",
                  ownerUserId: userId,
                },
                foundationActor,
              );
              next.missionFoundationId = draft.id;
            }
            next.companyPurpose = input.companyPurpose;
            next.step = "capability";
            break;
          }
          case "select_capability": {
            requireStep("capability");
            await assertV5Authorization(
              txDb,
              { ...actor, ignoreInstanceAdmin: true },
              companyId,
              "agents:create",
            );
            if (
              !(await capabilities(txDb)).some(
                (c) => c.versionId === input.packageVersionId,
              )
            )
              throw unprocessable("This capability is no longer qualified", {
                code: "CAPABILITY_UNAVAILABLE",
              });
            next.packageVersionId = input.packageVersionId;
            next.step = "access";
            break;
          }
          case "continue_access": {
            requireStep("access");
            const selected = (await capabilities(txDb)).find(
              (c) => c.versionId === state.packageVersionId,
            );
            if (!selected)
              throw conflict("Choose a current qualified capability", {
                code: "CAPABILITY_UNAVAILABLE",
              });
            if (selected.requiredConnections.length)
              throw conflict("Required access is not ready", {
                code: "REQUIRED_ACCESS_PENDING",
              });
            next.step = "review";
            break;
          }
          case "change_setup": {
            requireStep("review");
            if (state.firstValueAt || state.firstValueReceipt || state.firstTask)
              throw conflict("Review the recorded result through its original controls", {
                code: "FIRST_RESULT_ALREADY_RECORDED",
              });
            // This changes only the person's onboarding choice. Original
            // Foundation drafts, installations, grants and work keep their
            // own owners; selecting a capability again requires current admission.
            next.packageVersionId = null;
            next.step = "intent";
            break;
          }
          case "start_first_task": {
            requireStep("review");
            if (state.firstTask || state.firstValueReceipt) throw conflict("Read the existing first task before starting another");
            const candidate = await readActivationFirstTask(db, txDb, actor, companyId, {
              createdAt: run.createdAt, createdByUserId: userId, activationState: state,
            }, input.installationId, input.planId);
            if (candidate.planVersion !== input.expectedPlanVersion || candidate.installationHash !== input.expectedInstallationHash ||
              candidate.maximumModelCostMinor !== input.expectedMaximumModelCostMinor)
              throw conflict("First-run review changed; reload before starting");
            await orchestrationService(db).decideWithinTransaction(txDb, publications, actor, companyId, candidate.planId, {
              expectedVersion: input.expectedPlanVersion, action: "start", rationale: "The initiating human confirmed the bounded first internal draft.",
            });
            next.firstTask = { installationId: candidate.installationId, installationHash: candidate.installationHash,
              planId: candidate.planId, issueId: candidate.issueId };
            next.step = "running";
            break;
          }
          case "continue_first_task": {
            requireStep("running");
            await assertActivationFirstTaskDispatch(db, txDb, actor, companyId, {
              createdAt: run.createdAt, createdByUserId: userId, activationState: state,
            });
            break;
          }
          case "stop_first_task": {
            requireStep("running");
            const { plan } = await readRecordedActivationFirstTask(txDb, actor, companyId, {
              createdAt: run.createdAt, createdByUserId: userId, activationState: state,
            }, true);
            await orchestrationService(db).decideWithinTransaction(txDb, publications, actor, companyId, plan.id, {
              expectedVersion: input.expectedPlanVersion, action: "cancel", rationale: "The initiating human requested Stop for the first internal draft.",
            });
            break;
          }
          case "record_verified_result": {
            if (!["review", "running"].includes(state.step)) throw conflict("Continue at the current setup step");
            if (
              !(await capabilities(txDb)).some(
                (c) => c.versionId === state.packageVersionId,
              )
            )
              throw conflict("Choose a current qualified capability", {
                code: "CAPABILITY_UNAVAILABLE",
              });
            const result = await readActivationFirstValue(
              txDb,
              actor,
              companyId,
              {
                createdAt: run.createdAt,
                createdByUserId: userId,
                activationState: state,
              },
              input.installationId,
              input.verificationRunId,
            );
            if (state.firstTask && (state.firstTask.issueId !== result.issueId || state.firstTask.installationId !== result.installationId))
              throw conflict("Review the result of the recorded first task");
            next.firstValueReceipt = {
              installationId: result.installationId,
              verificationRunId: result.verificationRunId,
              issueId: result.issueId,
              runId: result.runId,
              resultHash: result.resultHash,
            };
            const [clock] = await tx.execute(
              sql`select clock_timestamp() as observed_at`,
            );
            next.firstValueAt = new Date(
              clock!.observed_at as string | Date,
            ).toISOString();
            next.step = "result";
            break;
          }
          case "complete_activation": {
            requireStep("result");
            const current = await activationFirstValueView(
              txDb,
              actor,
              companyId,
              {
                createdAt: run.createdAt,
                createdByUserId: userId,
                activationState: state,
              },
              false,
            );
            if (current.status !== "verified" || !state.firstValueAt)
              throw conflict(
                "Review current first-result evidence before completing setup",
              );
            next.step = "activated";
            break;
          }
        }
        next.receipts = [
          ...state.receipts,
          { requestId: input.requestId, requestHash },
        ].slice(-32);
        const parsed = activationStateSchema.parse(next);
        const [updated] = await tx
          .update(companyOnboardingRuns)
          .set({
            activationState: parsed,
            status: parsed.step === "activated" ? "completed" : run.status,
            completedAt:
              parsed.step === "activated"
                ? sql`clock_timestamp()`
                : run.completedAt,
            currentStage: `v9_${parsed.step}`,
            version: sql`${companyOnboardingRuns.version}+1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(companyOnboardingRuns.id, run.id),
              eq(companyOnboardingRuns.version, input.expectedVersion),
            ),
          )
          .returning({ id: companyOnboardingRuns.id });
        if (!updated)
          throw conflict("Setup changed", {
            code: "ACTIVATION_VERSION_CONFLICT",
          });
        await tx.insert(activityLog).values({
          companyId,
          actorType: "user",
          actorId: userId,
          action: "activation.step_completed",
          entityType: "onboarding",
          entityId: run.id,
          details: {
            from: state.step,
            to: parsed.step,
            version: run.version + 1,
          },
        });
        return input.operation === "start_first_task" || input.operation === "continue_first_task"
          ? { action: "dispatch" as const, planId: parsed.firstTask!.planId }
          : input.operation === "stop_first_task" ? { action: "stop" as const, planId: parsed.firstTask!.planId } : undefined;
      });
      // Commit the original plan, onboarding reference and audit before any
      // canonical dispatch. Receipt replay is read-only. A crash before dispatch
      // is recovered by a new explicit Continue action, with original wake keys.
      if (runtimeAction?.action === "dispatch") {
        await orchestrationRuntimeControl(db).dispatch(actor, companyId, runtimeAction.planId);
      }
      if (runtimeAction?.action === "stop") {
        // The original owner already persisted its safety cancellation outbox.
        // Delivery is performed by that owner; no second queue is introduced.
        await orchestrationRuntimeControl(db).stop(actor, companyId, runtimeAction.planId, "The initiating human requested Stop for the first internal draft.");
      }
      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await access(txDb, actor, companyId);
        await lockSnapshot(txDb, companyId);
        await access(txDb, actor, companyId, true);
        const [company] = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, companyId))
          .for("share");
        if (!company || company.status !== "active")
          throw forbidden("Company setup is unavailable");
        return view(txDb, actor, companyId);
      });
    },
  };
}
