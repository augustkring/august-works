import { lockActivationSnapshot as lockSnapshot, assertActivationAccess as access, readActivationOwner as read } from "./activation-owner.js";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  companies,
  companyOnboardingRuns,
  agentPackageVersions,
  agentPackages,
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
import { assertV5Authorization } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { foundationService } from "../foundation/foundation-service.js";
import { packageReleaseBlockers } from "../agent-packages/package-policy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  activationFirstValueView,
  readActivationFirstValue,
} from "./activation-first-value.js";
import { activationFirstTaskView, readActivationFirstTask, readRecordedActivationFirstTask, assertActivationFirstTaskDispatch } from "./activation-first-task.js";
import { activationFirstTaskPreparationOptions, prepareActivationFirstTask } from "./activation-first-task-preparation.js";
import { activationFirstAgentView, firstAgentConfigurationHash, readFirstAgentCapabilityPin, hasOriginalFirstAgentPreparation } from "./activation-first-agent.js";
import { createPausedOnboardingAgent } from "./onboarding-agent.js";
import { readActivationRequiredAccess } from "./activation-connections.js";
import { logActivity } from "../activity-log.js";
import { orchestrationService } from "../orchestration/orchestration-service.js";
import { orchestrationRuntimeControl } from "../orchestration/orchestration-runtime-control.js";
import { withV7ActivityTransaction } from "../v7-mutations.js";

/** A presentation state machine on the existing onboarding owner. It never supplies
 * execution authority, grants, provider credentials, or synthetic first-value proof. */
export function activationService(db: Db) {
  async function capabilities(tx: Db, selectedVersionId: string | null = null): Promise<ActivationView["capabilities"]> {
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
    // A bounded discovery page is not the owner of an already-selected pin.
    // Read that exact original version under the same qualification rules and
    // locks; then retain it within the existing twenty-choice display bound.
    const selectedRows = selectedVersionId ? await tx.select({ version: agentPackageVersions, package: agentPackages })
      .from(agentPackageVersions).innerJoin(agentPackages, eq(agentPackages.id, agentPackageVersions.packageId))
      .where(and(eq(agentPackageVersions.id, selectedVersionId), eq(agentPackageVersions.state, "published"), eq(agentPackages.status, "active")))
      .limit(1).for("share") : [];
    const seen = new Set<string>();
    const result: ActivationView["capabilities"] = [];
    for (const row of [...selectedRows, ...rows]) {
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
    const available = await capabilities(tx, state.packageVersionId);
    const selected = available.find(
      (c) => c.versionId === state.packageVersionId,
    );
    const requiredAccess = selected ? await readActivationRequiredAccess(tx, actor, companyId, selected.requiredConnections, { runId: run.id, version: run.version, packageVersionId: selected.versionId, step: state.step }) : [];
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
    if (selected && v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "activation_v9"))
      firstTask.preparationOptions = await activationFirstTaskPreparationOptions(db, tx, actor, companyId, {
        id: run.id, createdAt: run.createdAt, createdByUserId: userId, activationState: state,
      });
    const selectedPin = selected ? await readFirstAgentCapabilityPin(tx, selected.versionId) : null;
    const originalAgentPreparation = selected ? await hasOriginalFirstAgentPreparation(tx, companyId, selected.versionId, run.answers) : true;
    const firstAgent = await activationFirstAgentView(tx, actor, companyId, state,
      !!selectedPin && !originalAgentPreparation && state.step === "review" && !state.firstTask && !state.preparedFirstTask && !state.firstValueReceipt &&
      !firstTask.current && !firstTask.candidates.length && !firstTask.preparationOptions.length &&
      v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "activation_v9"), selectedPin?.hash ?? null);
    const blockers: ActivationView["blockers"] = [];
    if (!available.length || (state.packageVersionId && !selected))
      blockers.push("no_qualified_capability");
    if (state.step === "access" && requiredAccess.some(row => row.status !== "recorded"))
      blockers.push("required_access_pending");
    if (
      ["review", "running", "result", "activated"].includes(state.step) &&
      firstValue.status !== "verified" && !firstTask.candidates.length && !firstTask.preparationOptions.length && !firstTask.current
    )
      blockers.push("safe_execution_unqualified");
    // Do not return internal idempotency receipts to the presentation layer.
    const { receipts: _, firstAgent: _preparedAgent, ...publicState } = state;
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
      firstAgent,
      requiredAccess,
      sources: [
        {
          id: "customer_context",
          status:
            state.discovery === "customer_context"
              ? "available"
              : "not_requested",
        },
        { id: "website", status: "not_requested" },
        { id: "connections", status: requiredAccess.length && requiredAccess.every(row => row.status === "recorded") ? "available" : "not_connected" },
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
          case "reselect_capability": {
            requireStep("access");
            if (state.firstAgent || state.firstTask || state.preparedFirstTask || state.firstValueReceipt || state.firstValueAt)
              throw conflict("Continue the existing preparation through its original controls", { code: "FIRST_PREPARATION_EXISTS" });
            next.packageVersionId = null;
            next.step = "capability";
            break;
          }
          case "continue_access": {
            requireStep("access");
            const selected = (await capabilities(txDb, state.packageVersionId)).find(
              (c) => c.versionId === state.packageVersionId,
            );
            if (!selected)
              throw conflict("Choose a current qualified capability", {
                code: "CAPABILITY_UNAVAILABLE",
              });
            if (!await readFirstAgentCapabilityPin(txDb, selected.versionId))
              throw conflict("Choose a current qualified capability", { code: "CAPABILITY_UNAVAILABLE" });
            const required = await readActivationRequiredAccess(txDb, actor, companyId, selected.requiredConnections, { runId: run.id, version: run.version, packageVersionId: selected.versionId, step: state.step });
            if (required.some(row => row.status !== "recorded"))
              throw conflict("Required connection setup needs review", {
                code: "REQUIRED_ACCESS_PENDING",
              });
            next.step = "review";
            break;
          }
          case "prepare_first_agent": {
            requireStep("review");
            if (state.firstAgent || state.firstTask || state.preparedFirstTask || state.firstValueReceipt || state.firstValueAt)
              throw conflict("Continue the existing preparation through its original controls", { code: "FIRST_PREPARATION_EXISTS" });
            await assertV5Authorization(txDb, { ...actor, ignoreInstanceAdmin: true }, companyId, "agents:create");
            const selected = (await capabilities(txDb, state.packageVersionId)).find(c => c.versionId === state.packageVersionId);
            if (!selected) throw conflict("Choose a current qualified capability", { code: "CAPABILITY_UNAVAILABLE" });
            if (await hasOriginalFirstAgentPreparation(txDb, companyId, selected.versionId, run.answers))
              throw conflict("Continue the existing original agent or installed capability", { code: "FIRST_PREPARATION_EXISTS" });
            const original = { id: run.id, createdAt: run.createdAt, createdByUserId: userId, activationState: state };
            const tasks = await activationFirstTaskView(db, txDb, actor, companyId, original);
            const options = await activationFirstTaskPreparationOptions(db, txDb, actor, companyId, original);
            if (tasks.current || tasks.candidates.length || options.length)
              throw conflict("Use the existing first-task preparation instead of creating another agent", { code: "FIRST_PREPARATION_EXISTS" });
            const pin = await readFirstAgentCapabilityPin(txDb, selected.versionId);
            if (!pin) throw conflict("The selected capability is unavailable");
            const name = Array.from(pin.name.trim()).slice(0, 80).join("");
            if (!name) throw conflict("The selected capability has no current agent name");
            const { agent, approvalId } = await createPausedOnboardingAgent(txDb, companyId, userId, name, "general");
            next.firstAgent = { agentId: agent.id, packageVersionId: selected.versionId, packageContentHash: pin.hash,
              configurationHash: await firstAgentConfigurationHash(txDb, companyId, agent.id), approvalId };
            await logActivity(txDb, { companyId, actorType: "user", actorId: userId, action: "agent.hire_created",
              entityType: "agent", entityId: agent.id, details: { approvalId, onboardingRunId: run.id, preparationOnly: true } }, publications);
            break;
          }
          case "change_setup": {
            requireStep("review");
            if (state.firstAgent) throw conflict("Review the prepared agent through its original controls before changing setup", { code: "FIRST_PREPARATION_EXISTS" });
            if (state.firstValueAt || state.firstValueReceipt || state.firstTask)
              throw conflict("Review the recorded result through its original controls", {
                code: "FIRST_RESULT_ALREADY_RECORDED",
              });
            if (state.preparedFirstTask) {
              const prepared = await orchestrationService(txDb).get(actor, companyId, state.preparedFirstTask.planId, true);
              if (prepared.issueId !== state.preparedFirstTask.issueId || prepared.createdBy !== userId || prepared.erasedAt ||
                !["draft", "ready"].includes(prepared.status) || prepared.attempts.length)
                throw conflict("Review the changed prepared Task through its original controls");
              await orchestrationService(db).decideWithinTransaction(txDb, publications, actor, companyId, prepared.id, {
                expectedVersion: prepared.version, action: "cancel", rationale: "The initiating human changed the first-task setup before any execution.",
              });
              delete next.preparedFirstTask;
            }
            // This changes only the person's onboarding choice. Original
            // Foundation drafts, installations, grants and work keep their
            // own owners; selecting a capability again requires current admission.
            next.packageVersionId = null;
            next.step = "intent";
            break;
          }
          case "prepare_first_task": {
            requireStep("review");
            next.preparedFirstTask = await prepareActivationFirstTask(db, txDb, publications, actor, companyId, {
              id: run.id, createdAt: run.createdAt, createdByUserId: userId, activationState: state,
            }, input);
            break;
          }
          case "start_first_task": {
            requireStep("review");
            if (state.preparedFirstTask && (state.preparedFirstTask.installationId !== input.installationId || state.preparedFirstTask.planId !== input.planId))
              throw conflict("Review the exact first draft prepared for this setup");
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
              !(await capabilities(txDb, state.packageVersionId)).some(
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
            const firstReference = state.firstTask ?? state.preparedFirstTask;
            if (firstReference && (firstReference.issueId !== result.issueId || firstReference.installationId !== result.installationId))
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
