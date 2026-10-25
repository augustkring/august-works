import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { activityLog, agentExecutionManifests, agents, agentPresenceRuntimeBindings, agentProviderBindings, billingAccounts, companyMemberships, principalPermissionGrants, heartbeatRuns, issues, environmentLeases, runtimeCapacityProfiles, orchestrationPlans, orchestrationWorkerAttempts, runtimeCells, runtimeHosts, runtimeSandboxBindings, runtimePolicySnapshots, sandboxQualificationRuns, type Db } from "@paperclipai/db";
import { SANDBOX_CONTROLS, sandboxBindingCreateSchema, sandboxCapabilitySnapshotSchema, sandboxCompileSchema, type SandboxAdmissionInput, type SandboxBindingCreateInput, type SandboxCompileInput, type SandboxPosture } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { assertConfiguredOperatorAuthentication } from "../../auth/authenticator-assurance.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { agentRunWritesRevoked, assertAgentRunPolicyAllowed, assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import { agentProviderBindingService } from "../agent-provider-bindings.js";
import { capabilityResolverService } from "../capability-resolver.js";
import { compileSandboxPolicy } from "./policy-compiler.js";
import { runSandboxQualification } from "./qualification.js";
import { existingCellContainerBackend } from "./compatibility-backend.js";
import { SANDBOX_PROBE_CASES, type ExecutionSandboxBackend, type SandboxIdentity } from "./backend.js";
import { fenceSandboxAdmissionOutcome, releaseSandboxAdmissionClaim } from "./sandbox-guardian.js";
import { createToolGatewayService, type SandboxCredentialBrokerBinding } from "../tool-gateway.js";

type Binding = typeof runtimeSandboxBindings.$inferSelect;
function sandboxCapabilityFacts(value: ReturnType<typeof sandboxCapabilitySnapshotSchema.parse>) {
  const { testedAt: _testedAt, expiresAt: _expiresAt, qualificationHash: _qualificationHash, ...facts } = value;
  return facts;
}
export function executionSandboxService(db: Db, options: {
  operatorUserIds?: readonly string[];
  credentialBrokerOrigin?: string | null;
  runtimeSuspectSeconds?: number;
  backendFor?: (binding: Binding, actor: AuthorizationActor) => ExecutionSandboxBackend | undefined;
  nativeOperation?: (companyId: string, cellId: string, userId: string, action: "stop" | "delete", idempotencyKey: string) => Promise<{ id: string }>;
  assertRuntimeStartAdmission?: (tx: Db, input: { actor: AuthorizationActor; companyId: string; cellId: string; userId: string }) => Promise<unknown>;
  recordRuntimeWorkloadState?: (tx: Db, input: { action: "start" | "stop"; companyId: string; cellId: string; bindingId: string; generation: string; hostCommandId: string; claimKey: string; policySnapshotId: string; executionManifestId: string; executionManifestHash: string; policyHash: string; userId: string; idempotencyKey?: string }) => Promise<unknown>;
} = {}) {
  async function access(tx: Db, actor: AuthorizationActor, companyId: string, mutate = false) {
    if (mutate) await assertConfiguredOperatorAuthentication(tx, actor, options.operatorUserIds ?? []);
    v7HumanActorId(actor); await assertV7Authorization(tx, actor, companyId, mutate ? "runtime:manage" : "company_scope:read");
  }
  async function cell(tx: Db, companyId: string, id: string) {
    const [row] = await tx.select().from(runtimeCells).where(and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, id))).for("share");
    if (!row || row.deletedAt) throw notFound("Runtime cell is unavailable"); return row;
  }
  async function binding(tx: Db, actor: AuthorizationActor, companyId: string, id: string, lock = false) {
    await access(tx, actor, companyId);
    const query = tx.select().from(runtimeSandboxBindings).where(and(eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, id)));
    const [row] = await (lock ? query.for("update") : query); if (!row) throw notFound("Sandbox binding not found"); return row;
  }
  function identity(row: Binding): SandboxIdentity { return { companyId: row.companyId, bindingId: row.id, cellId: row.runtimeCellId, cellGeneration: row.cellGeneration, sandboxRef: row.sandboxRef ?? (row.backend === "openshell" ? `aw-v7-${row.id}` : `cell:${row.runtimeCellId}:${row.cellGeneration}`) }; }
  function backend(row: Binding, actor: AuthorizationActor) {
    const selected = options.backendFor?.(row, actor);
    if (selected) { if (selected.backend !== row.backend) throw conflict("Registered backend does not match the immutable binding"); return selected; }
    if (row.backend !== "existing_cell_container") return null;
    return existingCellContainerBackend({
      inspect: async scope => {
        const current = await cell(db, scope.companyId, scope.cellId);
        const [host] = current.runtimeHostId ? await db.select().from(runtimeHosts).where(eq(runtimeHosts.id, current.runtimeHostId)) : [];
        return { generation: current.generation.toString(), imageDigest: current.activeImageDigest ?? current.desiredImageDigest, state: current.status === "HEALTHY" ? "running" as const : current.status === "STOPPED" ? "stopped" as const : current.status === "FAILED" ? "failed" as const : "unknown" as const, backendVersion: host?.hostAgentVersion ?? "unplaced_v6_cell" };
      },
      stop: async (scope, key) => { if (!options.nativeOperation) throw forbidden("Native runtime control is unavailable"); const result = await options.nativeOperation(scope.companyId, scope.cellId, v7HumanActorId(actor), "stop", key); return { operationId: result.id }; },
      destroy: async (scope, key) => { if (!options.nativeOperation) throw forbidden("Native runtime control is unavailable"); const result = await options.nativeOperation(scope.companyId, scope.cellId, v7HumanActorId(actor), "delete", key); return { operationId: result.id }; },
    });
  }
  async function authority(tx: Db, companyId: string, manifestId: string, actor: AuthorizationActor) {
    const [record] = await tx.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.id, manifestId))).for("share");
    if (!record) throw notFound("Execution manifest not found");
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, record.runId), eq(heartbeatRuns.agentId, record.agentId))).for("share");
    if (!run || run.status !== "running" || !run.nativeIssueId || !run.responsibleUserId || run.responsibleUserId !== record.manifest.responsibleUserId) throw conflict("A current owned native execution manifest is required");
    // Policy compilation and cold-start admission happen while the original
    // runtime cell is STOPPED. Run provenance remains mandatory, but the
    // HEALTHY-cell requirement for ordinary Task writes would deadlock this
    // start lifecycle. The native runtime start-admission owner is checked
    // immediately before host I/O in admit(); normal writes keep the stricter
    // assertAgentRunWriteAllowed gate.
    await assertAgentRunPolicyAllowed(tx, companyId, { agentId: record.agentId, runId: run.id });
    const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, run.nativeIssueId))).for("share");
    if (!task || task.hiddenAt || task.assigneeAgentId !== record.agentId) throw conflict("Execution Task changed its current owner");
    await assertV7Authorization(tx, actor, companyId, "issue:read", { type: "issue", companyId, issueId: task.id, projectId: task.projectId });
    const worker: AuthorizationActor = { type: "agent", companyId, agentId: record.agentId, runId: run.id, onBehalfOfUserId: run.responsibleUserId };
    await assertV7Authorization(tx, worker, companyId, "issue:read", { type: "issue", companyId, issueId: task.id, projectId: task.projectId });
    const memberships = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, run.responsibleUserId)));
    const grants = await tx.select().from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), inArray(principalPermissionGrants.principalId, [record.agentId, run.responsibleUserId]))).orderBy(principalPermissionGrants.id);
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, record.agentId)));
    const [runtime] = await tx.select().from(agentPresenceRuntimeBindings).where(and(eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, record.agentId)));
    const [provider] = runtime ? await tx.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, runtime.providerBindingId)) : [];
    const pin = record.manifest.providers.find(p => p.companyId === companyId && p.agentId === record.agentId);
    if (!runtime || runtime.status !== "active" || !provider || provider.status !== "active" || !pin || provider.id !== pin.providerBindingId || provider.capabilitySnapshotHash !== pin.snapshotHash || runtime.providerProfileRef !== pin.profileRef) throw conflict("Execution provider qualification changed");
    await agentProviderBindingService(tx).assertRuntime(companyId, record.agentId);
    const currentCapabilities = await capabilityResolverService(tx).search(worker, companyId, "");
    // Projection never grants broker credentials from an inventory pin. Direct
    // credential bindings stay closed until the native broker is qualified.
    return { record, task, run, agent, runtime, currentCapabilities, authorityHash: nativeSha256(JSON.parse(JSON.stringify({ manifest: record.hash, memberships, grants, agentPermissions: agent?.permissions, runtimeId: runtime.id, providerId: provider.id, providerSnapshot: provider.capabilitySnapshotHash, profile: runtime.providerProfileRef, currentCapabilities, configurationHash: runtime.qualifiedConfigurationHash, conformanceHash: runtime.conformanceSnapshotHash }))) };
  }
  async function assertTaskExecutionContext(tx: Db, input: { companyId: string; runId: string; leaseId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const [lease] = await tx.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.id, input.leaseId),
      eq(environmentLeases.heartbeatRunId, input.runId), eq(environmentLeases.status, "active"),
    )).for("share");
    if (!lease || !lease.expiresAt || lease.expiresAt <= now) throw conflict("Current native environment lease is required");
    const [run] = await tx.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
    )).for("share");
    if (!run || run.status !== "running" || !run.startedAt || !run.agentId || !run.nativeIssueId || !run.responsibleUserId || agentRunWritesRevoked(run))
      throw conflict("Current active native Task run is required");
    const [manifest] = await tx.select().from(agentExecutionManifests).where(and(
      eq(agentExecutionManifests.companyId, input.companyId), eq(agentExecutionManifests.runId, run.id), eq(agentExecutionManifests.agentId, run.agentId),
    )).for("share");
    if (!manifest) throw conflict("Current execution manifest is required");
    await assertAgentRunWriteAllowed(tx, input.companyId, { agentId: run.agentId, runId: run.id });
    const worker: AuthorizationActor = { type: "agent", companyId: input.companyId, agentId: run.agentId, runId: run.id, onBehalfOfUserId: run.responsibleUserId };
    const source = await authority(tx, input.companyId, manifest.id, worker);
    if (source.record.hash !== manifest.hash || source.task.hiddenAt || source.task.assigneeAgentId !== run.agentId || source.task.executionRunId !== run.id)
      throw conflict("Task or manifest binding changed before sandbox execution");
    const cellRef = /^aw:cell:([0-9a-f-]{36}):generation:([1-9][0-9]{0,18})$/i.exec(source.runtime.providerProfileRef);
    if (!cellRef) return null;
    const [cellRow] = await tx.select().from(runtimeCells).where(and(
      eq(runtimeCells.companyId, input.companyId), eq(runtimeCells.id, cellRef[1]!), eq(runtimeCells.generation, BigInt(cellRef[2]!)),
      eq(runtimeCells.status, "HEALTHY"), isNull(runtimeCells.deletedAt),
    )).for("update");
    if (!cellRow?.runtimeHostId || cellRow.suspendedReason) throw conflict("Current managed runtime cell is unavailable");
    const [sandboxBinding] = await tx.select().from(runtimeSandboxBindings).where(and(
      eq(runtimeSandboxBindings.companyId, input.companyId), eq(runtimeSandboxBindings.runtimeCellId, cellRow.id),
      eq(runtimeSandboxBindings.cellGeneration, cellRef[2]!), eq(runtimeSandboxBindings.status, "running"),
    )).for("share");
    if (!sandboxBinding || sandboxBinding.backend !== "openshell" || !sandboxBinding.capabilitySnapshot || !sandboxBinding.capabilitySnapshotHash)
      throw conflict("Current running OpenShell admission is required for sandbox execution");
    const capability = sandboxCapabilitySnapshotSchema.parse(sandboxBinding.capabilitySnapshot);
    if (capability.expiresAt <= now.toISOString() || capability.sandboxImageDigest !== (cellRow.activeImageDigest ?? cellRow.desiredImageDigest))
      throw conflict("OpenShell qualification expired or image changed");
    const [qualification] = sandboxBinding.qualificationRunId ? await tx.select().from(sandboxQualificationRuns).where(and(
      eq(sandboxQualificationRuns.companyId, input.companyId), eq(sandboxQualificationRuns.bindingId, sandboxBinding.id),
      eq(sandboxQualificationRuns.id, sandboxBinding.qualificationRunId), eq(sandboxQualificationRuns.status, "passed"),
    )).for("share") : [];
    if (!qualification || qualification.evidenceKind !== "protected_host_report" || qualification.reportHash !== capability.qualificationHash ||
      qualification.results.length !== SANDBOX_PROBE_CASES.length || SANDBOX_PROBE_CASES.some(test => {
        const matches = qualification.results.filter(result => result.caseId === test.caseId);
        return matches.length !== 1 || matches[0]?.control !== test.control || matches[0]?.verdict !== "pass" || !/^[a-f0-9]{64}$/.test(matches[0]?.observationHash ?? "");
      })) throw conflict("Current protected-host qualification is incomplete");
    const [policy] = await tx.select().from(runtimePolicySnapshots).where(and(
      eq(runtimePolicySnapshots.companyId, input.companyId), eq(runtimePolicySnapshots.bindingId, sandboxBinding.id),
      eq(runtimePolicySnapshots.executionManifestId, manifest.id),
    )).orderBy(desc(runtimePolicySnapshots.policyVersion)).limit(1).for("share");
    const credentials = policy?.compilation.compiledPolicy.credentials;
    const brokerDimensions = ["company", "presence", "host", "port", "method", "path", "expiry", "revocation"] as const;
    if (!policy || policy.status !== "qualified" || policy.expiresAt <= now || policy.authorityHash !== source.authorityHash ||
      policy.capabilitySnapshotHash !== sandboxBinding.capabilitySnapshotHash || !credentials ||
      credentials.mode === "legacy_injected" || (credentials.mode === "none" && credentials.bindings.length !== 0) ||
      (credentials.mode === "brokered" && (!credentials.bindings.length || brokerDimensions.some(dimension => !capability.credentialBindingDimensions.includes(dimension)))) ||
      policy.compilation.sourcePolicyRefs.find(ref => ref.startsWith("manifest:")) !== `manifest:${manifest.id}:${manifest.hash}`)
      throw conflict("Current unexpired OpenShell policy is not bound to this exact Task manifest");
    const [host] = await tx.select().from(runtimeHosts).where(and(
      eq(runtimeHosts.id, cellRow.runtimeHostId), isNull(runtimeHosts.fencedAt), isNull(runtimeHosts.credentialRevokedAt), isNull(runtimeHosts.retiredAt),
      inArray(runtimeHosts.status, ["READY", "DRAINING"]), gt(runtimeHosts.lastHeartbeatAt, new Date(now.getTime() - (options.runtimeSuspectSeconds ?? 90) * 1000)),
    )).for("share");
    if (!host) throw conflict("Current qualified OpenShell host is unavailable");
    const [attempt] = await tx.select().from(orchestrationWorkerAttempts).where(and(
      eq(orchestrationWorkerAttempts.companyId, input.companyId), eq(orchestrationWorkerAttempts.runId, run.id),
    )).for("share");
    let planDeadline = Number.POSITIVE_INFINITY;
    if (attempt) {
      const [plan] = await tx.select().from(orchestrationPlans).where(and(
        eq(orchestrationPlans.companyId, input.companyId), eq(orchestrationPlans.id, attempt.planId), eq(orchestrationPlans.status, "running"),
      )).for("share");
      if (!plan || attempt.status !== "running" || attempt.executionManifestId !== manifest.id || !plan.startedAt)
        throw conflict("Current orchestration attempt is unavailable");
      planDeadline = plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000;
    }
    const deadlineAt = new Date(Math.min(policy.expiresAt.getTime(), lease.expiresAt.getTime(), run.executionControlDeadlineAt?.getTime() ?? Number.POSITIVE_INFINITY, run.startedAt.getTime() + policy.compilation.compiledPolicy.resources.wallClockSeconds * 1000, planDeadline));
    if (deadlineAt <= now) throw conflict("Original Task or policy execution deadline expired");
    return { lease, run, manifest, source, sandboxBinding, capability, policy, cell: cellRow, host, attempt, deadlineAt };
  }
  async function admissionContext(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    id: string,
    policySnapshotId: string,
    expectedVersion?: number,
    claimKey?: string,
  ) {
    await assertConfiguredOperatorAuthentication(
      tx,
      actor,
      options.operatorUserIds ?? [],
      { requireRecent: true },
    );
    await assertV7Enabled(tx, "sandbox_abstraction_v7");
    await assertV7Enabled(tx, "openshell_v7");
    await access(tx, actor, companyId, true);
    const row = await binding(tx, actor, companyId, id, true);
    if (expectedVersion !== undefined && row.status === "ready" && row.version !== expectedVersion)
      throw conflict("Sandbox changed; refresh before admission");
    if (row.backend !== "openshell" || !["ready", "admitting", "running"].includes(row.status))
      throw conflict("Only a currently qualified OpenShell binding can admit work");
    const currentCell = await cell(tx, companyId, row.runtimeCellId);
    const imageDigest = currentCell.activeImageDigest ?? currentCell.desiredImageDigest;
    if (
      currentCell.status !== "STOPPED" ||
      currentCell.generation.toString() !== row.cellGeneration ||
      row.capabilitySnapshotHash === null ||
      row.capabilitySnapshot?.sandboxImageDigest !== imageDigest
    )
      throw conflict("Current stopped runtime generation and image qualification are required");
    const [snapshot] = await tx
      .select()
      .from(runtimePolicySnapshots)
      .where(
        and(
          eq(runtimePolicySnapshots.companyId, companyId),
          eq(runtimePolicySnapshots.bindingId, id),
          eq(runtimePolicySnapshots.id, policySnapshotId),
        ),
      )
      .for("share");
    if (
      !snapshot ||
      snapshot.status !== "qualified" ||
      snapshot.expiresAt <= new Date() ||
      snapshot.capabilitySnapshotHash !== row.capabilitySnapshotHash ||
      snapshot.runtimeCellId !== row.runtimeCellId ||
      snapshot.compilation.proverResult !== "pass" ||
      snapshot.compilation.boundaryPolicyHash !== row.boundaryPolicyHash ||
      snapshot.compilation.compiledPolicy.credentials.mode !== "none" ||
      snapshot.compilation.compiledPolicy.credentials.bindings.length !== 0
    )
      throw conflict("An unexpired qualified policy bound to the current runtime is required");
    const capability = sandboxCapabilitySnapshotSchema.parse(row.capabilitySnapshot);
    if (
      capability.evidenceKind !== "protected_host_report" ||
      capability.backend !== "openshell" ||
      capability.expiresAt <= new Date().toISOString() ||
      capability.qualificationHash.length !== 64 ||
      !SANDBOX_CONTROLS.every((control) => capability[control])
    )
      throw conflict("A complete current protected-host qualification is required");
    const [qualification] = row.qualificationRunId
      ? await tx
          .select()
          .from(sandboxQualificationRuns)
          .where(
            and(
              eq(sandboxQualificationRuns.companyId, companyId),
              eq(sandboxQualificationRuns.bindingId, id),
              eq(sandboxQualificationRuns.id, row.qualificationRunId),
            ),
          )
          .for("share")
      : [];
    if (
      !qualification ||
      qualification.status !== "passed" ||
      qualification.evidenceKind !== "protected_host_report" ||
      qualification.reportHash !== capability.qualificationHash ||
      qualification.suiteVersion !== "aw-v7-boundary-1" ||
      !Array.isArray(qualification.results) ||
      qualification.results.length !== SANDBOX_PROBE_CASES.length ||
      SANDBOX_PROBE_CASES.some((test) => {
        const matches = qualification.results.filter((result) => result.caseId === test.caseId);
        return matches.length !== 1 || matches[0]?.control !== test.control || matches[0]?.verdict !== "pass" || !/^[a-f0-9]{64}$/.test(matches[0]?.observationHash ?? "");
      })
    )
      throw conflict("The current protected-host qualification suite is incomplete");
    const source = await authority(tx, companyId, snapshot.executionManifestId, actor);
    if (
      source.authorityHash !== snapshot.authorityHash ||
      source.record.id !== snapshot.executionManifestId ||
      source.record.hash !== snapshot.compilation.sourcePolicyRefs
        .find((ref) => ref.startsWith("manifest:"))
        ?.split(":")[2]
    )
      throw conflict("Original execution manifest or principal authority changed");
    if (source.record.manifest.executionScope.delegatedScopes.some((scope) => scope.companyId !== companyId))
      throw conflict("Delegated execution needs a qualified compound sandbox envelope");
    const [attempt] = await tx
      .select()
      .from(orchestrationWorkerAttempts)
      .where(
        and(
          eq(orchestrationWorkerAttempts.companyId, companyId),
          eq(orchestrationWorkerAttempts.executionManifestId, source.record.id),
        ),
      )
      .for("share");
    if (attempt) {
      const [plan] = await tx
        .select()
        .from(orchestrationPlans)
        .where(
          and(
            eq(orchestrationPlans.companyId, companyId),
            eq(orchestrationPlans.id, attempt.planId),
          ),
        )
        .for("share");
      const runStartedAt = source.run.startedAt ?? source.run.createdAt;
      const planDeadline = plan?.startedAt
        ? plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000
        : Number.POSITIVE_INFINITY;
      const originalDeadline = new Date(
        Math.min(
          runStartedAt.getTime() + snapshot.compilation.compiledPolicy.resources.wallClockSeconds * 1000,
          planDeadline,
        ),
      );
      if (
        attempt.status !== "running" ||
        attempt.runId !== source.run.id ||
        attempt.executionManifestId !== source.record.id ||
        !plan ||
        plan.status !== "running" ||
        plan.erasedAt ||
        originalDeadline.getTime() <= Date.now() ||
        snapshot.expiresAt.getTime() > originalDeadline.getTime()
      )
        throw conflict("Original worker attempt or wall-clock budget is no longer current");
    }
    const selected = backend(row, actor);
    if (!selected || selected.evidenceKind !== "protected_host_report")
      throw conflict("A protected physical OpenShell backend is required");
    let claimEvent: typeof activityLog.$inferSelect | null = null;
    if (["admitting", "running"].includes(row.status) || claimKey) {
      if (!claimKey) throw conflict("An exact durable admission claim is required");
      const [record] = await tx
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            eq(activityLog.entityType, "runtime_sandbox"),
            eq(activityLog.entityId, id),
            eq(activityLog.action, "sandbox.admission_claimed"),
            sql`${activityLog.details}->>'claimKey' = ${claimKey}`,
            sql`${activityLog.details}->>'generation' = ${row.cellGeneration}`,
            sql`${activityLog.details}->>'policySnapshotId' = ${snapshot.id}`,
            sql`${activityLog.details}->>'executionManifestId' = ${source.record.id}`,
            sql`${activityLog.details}->>'executionManifestHash' = ${source.record.hash}`,
            sql`${activityLog.details}->>'policyHash' = ${snapshot.policyHash}`,
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(1);
      if (!record) throw conflict("This sandbox admission has no matching durable claim");
      if (record.actorId !== v7HumanActorId(actor))
        throw conflict("Only the original operator can resume this sandbox admission claim");
      claimEvent = record;
      if (expectedVersion !== undefined && row.status === "admitting") {
        const details = record.details as Record<string, unknown>;
        if (expectedVersion !== details.expectedVersion && expectedVersion !== details.claimVersion)
          throw conflict("Sandbox admission claim version changed");
      }
    } else if (row.status !== "ready") {
      throw conflict("Sandbox is already reserved for another admission");
    }
    return { row, currentCell, imageDigest, snapshot, capability, source, selected, claimEvent };
  }
  return {
    assertTaskExecutionContext,
    posture: async (actor: AuthorizationActor, companyId: string, cellId: string): Promise<SandboxPosture> => {
      await access(db, actor, companyId); const current = await cell(db, companyId, cellId);
      const [row] = await db.select().from(runtimeSandboxBindings).where(and(eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.runtimeCellId, cellId))).orderBy(desc(runtimeSandboxBindings.createdAt)).limit(1);
      const fresh = row?.capabilitySnapshot && new Date(row.capabilitySnapshot.expiresAt) > new Date() && row.capabilitySnapshot.sandboxImageDigest === (current.activeImageDigest ?? current.desiredImageDigest);
      return { runtimeCellId: cellId, generation: current.generation.toString(), state: !row ? "legacy_boundary" : row.cellGeneration !== current.generation.toString() || row.status === "quarantined" || row.status === "degraded" || row.status === "failed" ? "quarantined" : ["ready", "running"].includes(row.status) && fresh ? "backend_qualified" : "awaiting_qualification", profile: row?.profile ?? null, executionEnforced: false };
    },
    list: async (actor: AuthorizationActor, companyId: string) => db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await assertConfiguredOperatorAuthentication(tx, actor, options.operatorUserIds ?? [], { requireRecent: false });
      await access(tx, actor, companyId);
      await assertV7Enabled(tx, "sandbox_abstraction_v7");
      return tx.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.companyId, companyId)).orderBy(desc(runtimeSandboxBindings.createdAt)).limit(100);
    }),
    get: async (actor: AuthorizationActor, companyId: string, id: string) => db.transaction(async transaction => {
      const tx = transaction as unknown as Db;
      await assertConfiguredOperatorAuthentication(tx, actor, options.operatorUserIds ?? [], { requireRecent: false });
      await access(tx, actor, companyId);
      const row = await binding(tx, actor, companyId, id);
      const policies = await tx.select().from(runtimePolicySnapshots).where(and(eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.bindingId, id))).orderBy(desc(runtimePolicySnapshots.policyVersion)).limit(20);
      for (const policy of policies) { const [manifest] = await tx.select().from(agentExecutionManifests).where(and(eq(agentExecutionManifests.companyId, companyId), eq(agentExecutionManifests.id, policy.executionManifestId))); if (manifest?.manifest.executionScope.delegatedScopes.some(scope => scope.companyId !== companyId)) throw forbidden("Delegated sandbox policy requires a separately qualified scope envelope"); }
      const qualifications = await tx.select().from(sandboxQualificationRuns).where(and(eq(sandboxQualificationRuns.companyId, companyId), eq(sandboxQualificationRuns.bindingId, id))).orderBy(desc(sandboxQualificationRuns.completedAt)).limit(20);
      return { binding: row, policies, qualifications };
    }),
    create: async (actor: AuthorizationActor, companyId: string, raw: SandboxBindingCreateInput) => {
      const input = sandboxBindingCreateSchema.parse(raw); await assertV7Enabled(db, "sandbox_abstraction_v7"); await access(db, actor, companyId, true);
      if (input.profile !== input.boundaryPolicy.profile) throw conflict("Binding and boundary assurance profiles must agree");
      if (input.backend === "openshell") await assertV7Enabled(db, "openshell_v7");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const current = await cell(tx, companyId, input.runtimeCellId);
        if (current.status !== "STOPPED") throw conflict("Create a sandbox binding only on a stopped runtime cell");
        if (current.generation.toString() !== input.expectedCellGeneration) throw conflict("Runtime generation changed");
        await access(tx, actor, companyId, true);
        const [row] = await tx.insert(runtimeSandboxBindings).values({ companyId, runtimeCellId: current.id, cellGeneration: current.generation.toString(), backend: input.backend, profile: input.profile, boundaryPolicy: input.boundaryPolicy, boundaryPolicyHash: nativeSha256(input.boundaryPolicy), createdByUserId: v7HumanActorId(actor) }).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "sandbox.binding_requested", entityType: "runtime_sandbox", entityId: row!.id, details: { runtimeCellId: current.id, backend: input.backend, profile: input.profile, boundaryPolicyHash: row!.boundaryPolicyHash } }, publications); return row!;
      });
    },
    qualify: async (actor: AuthorizationActor, companyId: string, id: string, expectedVersion: number) => {
      await assertV7Enabled(db, "sandbox_abstraction_v7"); await access(db, actor, companyId, true);
      const initial = await binding(db, actor, companyId, id), selected = backend(initial, actor);
      if (!selected) throw conflict("The requested backend is not installed; the binding remains unqualified");
      const current = await cell(db, companyId, initial.runtimeCellId);
      if (initial.version !== expectedVersion || current.generation.toString() !== initial.cellGeneration || current.status !== "STOPPED") throw conflict("Qualification requires the current stopped cell, without disrupting a running workload");
      const startedAt = new Date(), report = await runSandboxQualification(selected, identity(initial), startedAt);
      // Host I/O stays outside the binding-row transaction: the native host
      // command owner takes a shared binding lock while awaiting its receipt.
      // Holding an update lock here would deadlock qualification against its
      // own prepare command.
      const prepared = report.capabilities
        ? await selected.prepareSandbox(identity(initial))
        : { backendVersion: "unqualified", imageDigest: `cell:${current.id}:${initial.cellGeneration}` };
      if (report.capabilities && (
        report.capabilities.sandboxImageDigest !== prepared.imageDigest ||
        report.capabilities.backendVersion !== prepared.backendVersion ||
        new Date(report.capabilities.expiresAt) <= new Date()
      )) throw conflict("Observed backend image or qualification changed during preparation");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const row = await binding(tx, actor, companyId, id, true); await access(tx, actor, companyId, true); const currentCell = await cell(tx, companyId, row.runtimeCellId);
        if (row.version !== expectedVersion || row.version !== initial.version || row.cellGeneration !== initial.cellGeneration || row.boundaryPolicyHash !== initial.boundaryPolicyHash || row.backend !== initial.backend || currentCell.generation.toString() !== initial.cellGeneration || currentCell.status !== "STOPPED" || (currentCell.activeImageDigest ?? currentCell.desiredImageDigest) !== (current.activeImageDigest ?? current.desiredImageDigest)) throw conflict("Runtime changed during qualification");
        // An unavailable host qualification must remain a retained inconclusive
        // report. Do not turn a configured image into preparation evidence.
        await access(tx, actor, companyId, true);
        const [run] = await tx.insert(sandboxQualificationRuns).values({ companyId, bindingId: id, backend: row.backend, backendVersion: prepared.backendVersion, hostOrImageRef: prepared.imageDigest, kernelVersion: report.capabilities?.hostKernelVersion ?? null, suiteVersion: report.suiteVersion, evidenceKind: selected.evidenceKind, status: report.status, results: report.results, exceptions: report.exceptions, reportHash: report.reportHash, startedAt, completedAt: new Date() }).returning();
        const [updated] = await tx.update(runtimeSandboxBindings).set({ qualificationRunId: run!.id, capabilitySnapshot: report.capabilities, capabilitySnapshotHash: report.capabilities ? nativeSha256(report.capabilities) : null, status: report.status === "passed" && report.capabilities && selected.evidenceKind === "protected_host_report" ? "ready" : report.status === "failed" ? "failed" : "requested", version: row.version + 1, updatedAt: new Date() }).where(eq(runtimeSandboxBindings.id, id)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "sandbox.qualification_recorded", entityType: "runtime_sandbox", entityId: id, details: { qualificationRunId: run!.id, status: report.status, evidenceKind: selected.evidenceKind } }, publications); return updated!;
      });
    },
    reconcile: async (actor: AuthorizationActor, companyId: string, id: string, expectedVersion: number) => {
      await access(db, actor, companyId, true);
      const initial = await binding(db, actor, companyId, id), selected = backend(initial, actor);
      const observed = selected ? await selected.inspectWorkload(identity(initial)).catch(() => null) : null;
      const result = await withV7ActivityTransaction(db, async (tx, publications) => {
        const row = await binding(tx, actor, companyId, id, true); await access(tx, actor, companyId, true);
        const current = await cell(tx, companyId, row.runtimeCellId);
        if (row.version !== expectedVersion) throw conflict("Sandbox changed during reconciliation");
        const fresh = row.capabilitySnapshot && new Date(row.capabilitySnapshot.expiresAt) > new Date();
        // Compilation is not proof that a policy has been physically applied.
        // Until the host adapter supplies applied-policy evidence, fail closed.
        const unsafe = !observed || !observed.controlsHealthy || observed.generation !== row.cellGeneration || observed.imageDigest !== (current.activeImageDigest ?? current.desiredImageDigest) || !fresh || current.generation.toString() !== row.cellGeneration;
        const [updated] = await tx.update(runtimeSandboxBindings).set({ status: unsafe ? "quarantined" : row.status, version: row.version + 1, updatedAt: new Date() }).where(eq(runtimeSandboxBindings.id, id)).returning();
        if (unsafe) await tx.update(runtimePolicySnapshots).set({ status: "revoked" }).where(and(eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.bindingId, id), inArray(runtimePolicySnapshots.status, ["draft", "qualified"])));
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "sandbox.reconciled", entityType: "runtime_sandbox", entityId: id, details: { status: updated!.status, boundaryObserved: !!observed, safe: !unsafe } }, publications);
        return { binding: updated!, stopRequired: unsafe && ["HEALTHY", "DEGRADED", "FAILED"].includes(current.status) };
      });
      if (result.stopRequired) {
        if (!options.nativeOperation) throw conflict("Sandbox quarantined; native Stop control is unavailable");
        await options.nativeOperation(companyId, initial.runtimeCellId, v7HumanActorId(actor), "stop", `v7-sandbox-quarantine:${id}:${initial.cellGeneration}`);
      }
      return result.binding;
    },
    compile: async (actor: AuthorizationActor, companyId: string, id: string, raw: SandboxCompileInput) => {
      const input = sandboxCompileSchema.parse(raw); await assertV7Enabled(db, "sandbox_abstraction_v7"); await access(db, actor, companyId, true);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const row = await binding(tx, actor, companyId, id, true); await access(tx, actor, companyId, true); const current = await cell(tx, companyId, row.runtimeCellId);
        if (row.version !== input.expectedVersion || current.generation.toString() !== row.cellGeneration) throw conflict("Runtime binding changed; refresh before compiling");
        const source = await authority(tx, companyId, input.executionManifestId, actor);
        if (source.record.manifest.executionScope.delegatedScopes.some(scope => scope.companyId !== companyId)) throw conflict("Delegated execution needs a qualified compound sandbox envelope");
        if (current.dedicatedAgentId && current.dedicatedAgentId !== source.record.agentId) throw conflict("Manifest belongs to another dedicated runtime presence");
        if (current.providerBindingId !== source.runtime.providerBindingId || source.runtime.providerProfileRef !== `aw:cell:${current.id}:generation:${row.cellGeneration}`) throw conflict("Execution presence is not bound to this exact runtime cell generation");
        const [capacity] = await tx.select().from(runtimeCapacityProfiles).where(eq(runtimeCapacityProfiles.key, current.capacityProfile));
        if (!capacity || input.candidatePolicy.resources.cpuMillis > capacity.cpuMillis || BigInt(input.candidatePolicy.resources.memoryBytes) > capacity.memoryBytes || BigInt(input.candidatePolicy.resources.diskBytes) > capacity.diskBytes || input.candidatePolicy.resources.pidsLimit > capacity.pidsLimit) throw conflict("Policy exceeds the native runtime capacity envelope");
        const [attempt] = await tx.select().from(orchestrationWorkerAttempts).where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.executionManifestId, source.record.id)));
        const [plan] = attempt ? await tx.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.id, attempt.planId))) : [];
        const riskFloor = Math.max(...source.record.manifest.capabilities.map(capability => Number(capability.risk.slice(1))), plan ? Number(plan.riskClass.slice(1)) : 0);
        if (Number(input.candidatePolicy.riskClass.slice(1)) < riskFloor) throw conflict("Policy cannot lower the execution's current risk class");
        if (row.capabilitySnapshot && (row.capabilitySnapshot.sandboxImageDigest !== (current.activeImageDigest ?? current.desiredImageDigest) || row.capabilitySnapshot.backend !== row.backend)) throw conflict("Runtime image or backend changed; repeat qualification");
        const refs = [`manifest:${source.record.id}:${source.record.hash}`, `cell:${current.id}:${row.cellGeneration}`, `boundary:${row.boundaryPolicyHash}`, `authority:${source.authorityHash}`];
        let authorizedConnectionGrantHashes: Record<string, string> = {};
        let credentialBrokerBindings: SandboxCredentialBrokerBinding[] = [];
        if (input.candidatePolicy.credentials.mode === "brokered") {
          const broker = await createToolGatewayService(tx as unknown as Db).resolveSandboxCredentialBrokerBindings({
            companyId, agentId: source.record.agentId, runId: source.run.id,
            responsibleUserId: source.run.responsibleUserId!, presenceId: source.runtime.id,
            bindings: input.candidatePolicy.credentials.bindings,
          });
          authorizedConnectionGrantHashes = broker.authorizedConnectionGrantHashes;
          credentialBrokerBindings = broker.bindings;
          for (const [connectionId, grantHash] of Object.entries(authorizedConnectionGrantHashes)) refs.push(`credential-grant:${connectionId}:${grantHash}`);
          for (const brokerBinding of credentialBrokerBindings) refs.push(`credential-broker-route:${brokerBinding.gatewayPublicId}:${brokerBinding.endpointPath}`);
        }
        const compilation = compileSandboxPolicy({ boundary: row.boundaryPolicy, candidate: input.candidatePolicy, capabilities: row.capabilitySnapshot, authorizedConnectionGrantHashes, credentialBrokerOrigin: options.credentialBrokerOrigin, credentialBrokerBindings, sourcePolicyRefs: refs });
        const [latest] = await tx.select().from(runtimePolicySnapshots).where(and(eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.bindingId, id))).orderBy(desc(runtimePolicySnapshots.policyVersion)).limit(1);
        if (latest?.status === "qualified") await tx.update(runtimePolicySnapshots).set({ status: "superseded" }).where(eq(runtimePolicySnapshots.id, latest.id));
        const expiresAt = new Date(Math.min((source.run.startedAt?.getTime() ?? source.run.createdAt.getTime()) + compilation.compiledPolicy.resources.wallClockSeconds * 1000, plan?.startedAt ? plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000 : Infinity));
        const [snapshot] = await tx.insert(runtimePolicySnapshots).values({ companyId, bindingId: id, runtimeCellId: current.id, agentId: source.record.agentId, executionManifestId: source.record.id, policyVersion: (latest?.policyVersion ?? 0) + 1, policyHash: nativeSha256(compilation), capabilitySnapshotHash: row.capabilitySnapshotHash, compilation, authorityHash: source.authorityHash, sourcePolicyRefs: refs, status: compilation.proverResult === "pass" && row.status === "ready" && expiresAt > new Date() ? "qualified" : "draft", expiresAt }).returning();
        await tx.update(runtimeSandboxBindings).set({ version: row.version + 1, updatedAt: new Date() }).where(eq(runtimeSandboxBindings.id, id));
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "sandbox.policy_compiled", entityType: "runtime_sandbox", entityId: id, details: { policySnapshotId: snapshot!.id, proverResult: compilation.proverResult, policyHash: snapshot!.policyHash } }, publications); return snapshot!;
      });
    },
    stop: async (actor: AuthorizationActor, companyId: string, id: string, idempotencyKey: string) => {
      const initial = await withV7ActivityTransaction(db, async (tx, publications) => {
        await assertV7Authorization(tx, actor, companyId, "runtime:manage");
        const unlocked = await binding(tx, actor, companyId, id);
        const unlockedCell = await cell(tx, companyId, unlocked.runtimeCellId);
        await tx.select({ id: billingAccounts.id }).from(billingAccounts).where(eq(billingAccounts.id, unlockedCell.billingAccountId)).for("update");
        await tx.select({ id: runtimeCells.id }).from(runtimeCells).where(and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, unlocked.runtimeCellId))).for("update");
        const row = await binding(tx, actor, companyId, id, true);
        const currentCell = await cell(tx, companyId, row.runtimeCellId);
        if (currentCell.generation.toString() !== row.cellGeneration)
          throw conflict("Sandbox generation changed before Stop");
        if (!["admitting", "running", "stopping", "quarantined"].includes(row.status))
          throw conflict("Sandbox has no active workload to stop");
        const [claim] = await tx.select().from(activityLog).where(and(
          eq(activityLog.companyId, companyId), eq(activityLog.entityType, "runtime_sandbox"),
          eq(activityLog.entityId, id), eq(activityLog.action, "sandbox.admission_claimed"),
        )).orderBy(desc(activityLog.createdAt), desc(activityLog.id)).limit(1);
        const details = claim?.details as Record<string, unknown> | undefined;
        if (typeof details?.claimKey !== "string" || typeof details.policySnapshotId !== "string")
          throw conflict("Sandbox has no exact admission claim to stop");
        const [stopping] = await tx.update(runtimeSandboxBindings).set({ status: "stopping", version: row.version + 1, updatedAt: new Date() }).where(and(
          eq(runtimeSandboxBindings.id, id), eq(runtimeSandboxBindings.version, row.version),
        )).returning();
        if (!stopping) throw conflict("Sandbox changed before its Stop claim was recorded");
        await logActivity(tx, {
          companyId, actorType: "user", actorId: v7HumanActorId(actor),
          action: "sandbox.workload_stop_claimed", entityType: "runtime_sandbox", entityId: id,
          details: { generation: row.cellGeneration, policySnapshotId: details.policySnapshotId, claimKey: details.claimKey, idempotencyKey },
        }, publications);
        return {
          row: stopping,
          claimKey: details.claimKey,
          policySnapshotId: details.policySnapshotId,
          executionManifestId: details.executionManifestId,
          executionManifestHash: details.executionManifestHash,
          policyHash: details.policyHash,
        };
      });
      const selected = backend(initial.row, actor);
      const scope = identity(initial.row), key = `v7-sandbox-user-stop:${id}:${initial.row.cellGeneration}:${idempotencyKey}`;
      let stopConfirmed = false, operationId: string | null = null;
      try {
        if (!selected || selected.backend !== "openshell")
          throw conflict("The bound OpenShell safety owner is unavailable");
        const stopped = await selected.stopWorkload({ ...scope, idempotencyKey: key });
        operationId = stopped.operationId;
        const observation = await selected.inspectWorkload(scope);
        stopConfirmed = observation.state === "stopped" && observation.generation === scope.cellGeneration && observation.imageDigest === initial.row.capabilitySnapshot?.sandboxImageDigest;
        if (!stopConfirmed) throw conflict("Sandbox Stop did not independently confirm the exact workload stopped");
        const stoppedBinding = await withV7ActivityTransaction(db, async (tx, publications) => {
          await tx.select({ id: runtimeCells.id }).from(runtimeCells).where(and(eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, scope.cellId))).for("update");
          const [current] = await tx.select().from(runtimeSandboxBindings).where(and(
            eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, id),
            eq(runtimeSandboxBindings.cellGeneration, scope.cellGeneration),
            inArray(runtimeSandboxBindings.status, ["admitting", "running", "stopping", "quarantined"]),
          )).for("update");
          if (!current) throw conflict("Sandbox changed while Stop was completing");
          await assertV7Authorization(tx, actor, companyId, "runtime:manage");
          if (!options.recordRuntimeWorkloadState || typeof initial.executionManifestId !== "string" || typeof initial.executionManifestHash !== "string" || typeof initial.policyHash !== "string")
            throw conflict("Original runtime state owner or exact admission claim is unavailable");
          await options.recordRuntimeWorkloadState(tx, {
            action: "stop", companyId, cellId: scope.cellId, bindingId: id,
            generation: scope.cellGeneration, hostCommandId: operationId!,
            claimKey: initial.claimKey, policySnapshotId: initial.policySnapshotId,
            executionManifestId: initial.executionManifestId,
            executionManifestHash: initial.executionManifestHash,
            policyHash: initial.policyHash, userId: v7HumanActorId(actor),
            idempotencyKey,
          });
          const [updated] = await tx.update(runtimeSandboxBindings).set({ status: "stopped", version: current.version + 1, updatedAt: new Date() }).where(and(
            eq(runtimeSandboxBindings.id, id), eq(runtimeSandboxBindings.version, current.version),
          )).returning();
          if (!updated) throw conflict("Sandbox changed while recording Stop");
          await tx.update(runtimePolicySnapshots).set({ status: "revoked" }).where(and(
            eq(runtimePolicySnapshots.companyId, companyId), eq(runtimePolicySnapshots.bindingId, id),
            inArray(runtimePolicySnapshots.status, ["draft", "qualified"]),
          ));
          await logActivity(tx, {
            companyId, actorType: "user", actorId: v7HumanActorId(actor),
            action: "sandbox.workload_stopped", entityType: "runtime_sandbox", entityId: id,
            details: { cellId: scope.cellId, generation: scope.cellGeneration, policySnapshotId: initial.policySnapshotId, claimKey: initial.claimKey, idempotencyKey, operationId, stopConfirmed: true },
          }, publications);
          return updated!;
        });
        return { binding: stoppedBinding, operationId, stopConfirmed: true as const };
      } catch (error) {
        const fenced = await fenceSandboxAdmissionOutcome(db, {
          companyId, bindingId: id, cellId: scope.cellId, generation: scope.cellGeneration,
          policySnapshotId: initial.policySnapshotId, claimKey: initial.claimKey,
          operationKeys: [key], stopConfirmed,
        });
        if (!fenced) throw conflict("Sandbox Stop outcome could not be persisted; keep the workload fenced", { code: "sandbox_quarantine_persistence_failed" });
        if (!stopConfirmed) throw conflict("Sandbox Stop outcome is unknown; keep the workload quarantined until confirmed", { code: "sandbox_stop_unconfirmed" });
        throw error;
      }
    },
    admit: async (
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      input: SandboxAdmissionInput,
    ) => {
      const claimKey = `v7-sandbox-admission:${id}:${(await binding(db, actor, companyId, id)).cellGeneration}:${input.policySnapshotId}`;
      const initial = await withV7ActivityTransaction(db, async (tx, publications) => {
        const [candidate] = await tx.select({ runtimeCellId: runtimeSandboxBindings.runtimeCellId }).from(runtimeSandboxBindings).where(and(
          eq(runtimeSandboxBindings.companyId, companyId), eq(runtimeSandboxBindings.id, id),
        ));
        if (!candidate) throw notFound("Sandbox binding not found");
        const [unlockedCell] = await tx.select({ billingAccountId: runtimeCells.billingAccountId }).from(runtimeCells).where(and(
          eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, candidate.runtimeCellId),
        ));
        if (!unlockedCell) throw notFound("Runtime cell not found");
        await tx.select({ id: billingAccounts.id }).from(billingAccounts).where(eq(billingAccounts.id, unlockedCell.billingAccountId)).for("update");
        await tx.select({ id: runtimeCells.id }).from(runtimeCells).where(and(
          eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, candidate.runtimeCellId),
        )).for("update");
        const [current] = await tx
          .select()
          .from(runtimeSandboxBindings)
          .where(
            and(
              eq(runtimeSandboxBindings.companyId, companyId),
              eq(runtimeSandboxBindings.id, id),
            ),
          )
          .for("update");
        if (!current) throw notFound("Sandbox binding not found");
        if (current.status === "admitting") {
          const resumed = await admissionContext(
            tx,
            actor,
            companyId,
            id,
            input.policySnapshotId,
            input.expectedVersion,
            claimKey,
          );
          if (!options.assertRuntimeStartAdmission) throw conflict("Original runtime start admission owner is unavailable");
          await options.assertRuntimeStartAdmission(tx, { actor, companyId, cellId: resumed.row.runtimeCellId, userId: v7HumanActorId(actor) });
          return {
            ...resumed,
            claimKey,
            claimVersion: current.version,
            claimReplay: true as const,
            claimCompleted: false as const,
          };
        }
        if (current.status === "ready" || current.status === "running") {
          const [priorClaim] = await tx
            .select({ id: activityLog.id })
            .from(activityLog)
            .where(
              and(
                eq(activityLog.companyId, companyId),
                eq(activityLog.entityType, "runtime_sandbox"),
                eq(activityLog.entityId, id),
                eq(activityLog.action, "sandbox.admission_claimed"),
                sql`${activityLog.details}->>'claimKey' = ${claimKey}`,
              ),
            )
            .limit(1);
          if (priorClaim) {
            const completed = await admissionContext(
              tx,
              actor,
              companyId,
              id,
              input.policySnapshotId,
              undefined,
              claimKey,
            );
            const [successEvent] = await tx
              .select()
              .from(activityLog)
              .where(
                and(
                  eq(activityLog.companyId, companyId),
                  eq(activityLog.entityType, "runtime_sandbox"),
                  eq(activityLog.entityId, id),
                  eq(activityLog.action, "sandbox.workload_started"),
                  sql`${activityLog.details}->>'claimKey' = ${claimKey}`,
                ),
              )
              .orderBy(desc(activityLog.createdAt))
              .limit(1);
            if (successEvent) {
              const claimDetails = completed.claimEvent?.details as Record<string, unknown> | undefined;
              const successDetails = successEvent.details as Record<string, unknown>;
              if (![claimDetails?.expectedVersion, claimDetails?.claimVersion, successDetails.finalVersion].includes(input.expectedVersion))
                throw conflict("Sandbox replay does not match the completed admission version");
              return {
                ...completed,
                claimKey,
                claimVersion: Number(claimDetails?.claimVersion),
                claimReplay: true as const,
                claimCompleted: true as const,
                successEvent,
              };
            }
          }
        }
        const ready = await admissionContext(
          tx,
          actor,
          companyId,
          id,
          input.policySnapshotId,
          input.expectedVersion,
        );
        if (!options.assertRuntimeStartAdmission) throw conflict("Original runtime start admission owner is unavailable");
        await options.assertRuntimeStartAdmission(tx, { actor, companyId, cellId: ready.row.runtimeCellId, userId: v7HumanActorId(actor) });
        const [claimed] = await tx
          .update(runtimeSandboxBindings)
          .set({ status: "admitting", version: ready.row.version + 1, updatedAt: new Date() })
          .where(
            and(
              eq(runtimeSandboxBindings.companyId, companyId),
              eq(runtimeSandboxBindings.id, id),
              eq(runtimeSandboxBindings.version, ready.row.version),
              eq(runtimeSandboxBindings.status, "ready"),
            ),
          )
          .returning();
        if (!claimed) throw conflict("Another sandbox admission claimed this generation");
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: v7HumanActorId(actor),
            action: "sandbox.admission_claimed",
            entityType: "runtime_sandbox",
            entityId: id,
            details: {
              claimKey,
              expectedVersion: ready.row.version,
              claimVersion: claimed.version,
              generation: ready.row.cellGeneration,
              policySnapshotId: ready.snapshot.id,
              executionManifestId: ready.source.record.id,
              executionManifestHash: ready.source.record.hash,
              policyHash: ready.snapshot.policyHash,
            },
          },
          publications,
        );
        return {
          ...ready,
          row: claimed,
          claimKey,
          claimVersion: claimed.version,
          claimReplay: false as const,
          claimCompleted: false as const,
        };
      });
      const scope = identity(initial.row);
      const selected = initial.selected;
      const policyHash = nativeSha256(initial.snapshot.compilation);
      const applyKey = `v7-sandbox-policy:${id}:${scope.cellGeneration}:${policyHash}`;
      const startKey = `v7-sandbox-start:${id}:${scope.cellGeneration}:${initial.snapshot.id}`;
      let effectAttempted = false;
      const finishedDuplicate = async (successEvent: typeof activityLog.$inferSelect) => {
        const current = await db.transaction((transaction) =>
          admissionContext(
            transaction as unknown as Db,
            actor,
            companyId,
            id,
            initial.snapshot.id,
            undefined,
            claimKey,
          ),
        );
        const observation = await selected.inspectWorkload(scope);
        if (
          observation.state !== "running" ||
          !observation.controlsHealthy ||
          observation.generation !== scope.cellGeneration ||
          observation.imageDigest !== initial.imageDigest ||
          observation.policyHash !== policyHash
        )
          throw conflict("Completed admission no longer has its exact running workload observation");
        const details = successEvent.details as Record<string, unknown>;
        return {
          binding: current.row,
          policySnapshotId: initial.snapshot.id,
          operationId: String(details.operationId),
          observation,
          duplicate: true,
        };
      };
      if (initial.claimReplay && initial.claimCompleted)
        return finishedDuplicate(initial.successEvent);
      const stopAndConfirm = async () => {
        try {
          await selected.stopWorkload({
            ...scope,
            idempotencyKey: `v7-sandbox-admission-contain:${id}:${scope.cellGeneration}:${initial.snapshot.id}`,
          });
          const stopped = await selected.inspectWorkload(scope);
          return (
            stopped.state === "stopped" &&
            stopped.generation === scope.cellGeneration &&
            stopped.imageDigest === initial.imageDigest
          );
        } catch {
          return false;
        }
      };
      try {
        const currentCapabilities = sandboxCapabilitySnapshotSchema.safeParse(
          await selected.capabilities(),
        );
        if (
          !currentCapabilities.success ||
          currentCapabilities.data.evidenceKind !== "protected_host_report" ||
          new Date(currentCapabilities.data.testedAt) > new Date() ||
          new Date(currentCapabilities.data.expiresAt) <= new Date() ||
          !initial.row.capabilitySnapshot ||
          nativeSha256(sandboxCapabilityFacts(currentCapabilities.data)) !==
            nativeSha256(sandboxCapabilityFacts(sandboxCapabilitySnapshotSchema.parse(initial.row.capabilitySnapshot)))
        )
          throw conflict("Current protected-host capability snapshot changed");
        const prepared = await selected.prepareSandbox(scope);
        if (
          prepared.companyId !== scope.companyId ||
          prepared.bindingId !== scope.bindingId ||
          prepared.cellId !== scope.cellId ||
          prepared.cellGeneration !== scope.cellGeneration ||
          prepared.sandboxRef !== scope.sandboxRef ||
          prepared.backendVersion !== initial.capability.backendVersion ||
          prepared.imageDigest !== initial.imageDigest
        )
          throw conflict("Prepared workload does not match the qualified immutable runtime");
        const before = await selected.inspectWorkload(scope);
        const resumedRunning = initial.claimReplay &&
          before.state === "running" &&
          before.controlsHealthy &&
          before.policyHash === policyHash;
        if (before.generation !== scope.cellGeneration || before.imageDigest !== initial.imageDigest ||
          (before.state !== "stopped" && !resumedRunning))
          throw conflict("Admission requires the exact stopped workload generation");
        if (!resumedRunning) {
          effectAttempted = true;
          const applied = await selected.applyPolicy({
            ...scope,
            policy: initial.snapshot.compilation,
            currentStaticFingerprint: null,
            expiresAt: initial.snapshot.expiresAt.toISOString(),
          });
          if (applied.requiresRecreate) {
            // The host explicitly observed a static-control mismatch before
            // mutation; this is a named pre-effect rejection, not an unknown run.
            effectAttempted = false;
            throw conflict(
              "Static OpenShell policy controls require sandbox replacement before admission",
              { code: "sandbox_recreate_required" },
            );
          }
          if (
            !applied.applied ||
            applied.observedPolicyHash !== policyHash ||
            applied.unsupportedFeatures.length
          ) {
            if (!applied.applied) effectAttempted = false;
            throw conflict("Physical policy application was not observed exactly");
          }
        }
        await db.transaction((transaction) =>
          admissionContext(
            transaction as unknown as Db,
            actor,
            companyId,
            id,
            initial.snapshot.id,
            undefined,
            claimKey,
          ),
        );
        effectAttempted = true;
        const started = await selected.startWorkload({
          ...scope,
          policy: initial.snapshot.compilation,
          expiresAt: initial.snapshot.expiresAt.toISOString(),
          idempotencyKey: startKey,
        });
        const observation = await selected.inspectWorkload(scope);
        if (
          observation.state !== "running" ||
          !observation.controlsHealthy ||
          observation.generation !== scope.cellGeneration ||
          observation.imageDigest !== initial.imageDigest ||
          observation.policyHash !== policyHash
        )
          throw conflict("Running workload state is not independently observed");
        const completion = await withV7ActivityTransaction(db, async (tx, publications) => {
          // Keep the original runtime owner's billing-account → cell →
          // binding lock order while committing the verified host receipt.
          const [cellOwner] = await tx.select({ billingAccountId: runtimeCells.billingAccountId }).from(runtimeCells).where(and(
            eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, scope.cellId),
          ));
          if (!cellOwner) throw conflict("Runtime cell disappeared before sandbox start was recorded");
          await tx.select({ id: billingAccounts.id }).from(billingAccounts).where(eq(billingAccounts.id, cellOwner.billingAccountId)).for("update");
          await tx.select({ id: runtimeCells.id }).from(runtimeCells).where(and(
            eq(runtimeCells.companyId, companyId), eq(runtimeCells.id, scope.cellId),
          )).for("update");
          const current = await admissionContext(
            tx,
            actor,
            companyId,
            id,
            initial.snapshot.id,
            undefined,
            claimKey,
          );
          if (current.row.version < initial.claimVersion)
            throw conflict("Sandbox admission version moved backwards");
          if (current.row.version === initial.claimVersion && current.row.status === "admitting") {
            if (!options.recordRuntimeWorkloadState)
              throw conflict("Original runtime state owner is unavailable");
            await options.recordRuntimeWorkloadState(tx, {
              action: "start", companyId, cellId: scope.cellId, bindingId: id,
              generation: scope.cellGeneration, hostCommandId: started.operationId,
              claimKey, policySnapshotId: initial.snapshot.id,
              executionManifestId: current.source.record.id,
              executionManifestHash: current.source.record.hash,
              policyHash, userId: v7HumanActorId(actor),
            });
            const [updated] = await tx
              .update(runtimeSandboxBindings)
              .set({ status: "running", version: current.row.version + 1, updatedAt: new Date() })
              .where(
                and(
                  eq(runtimeSandboxBindings.companyId, companyId),
                  eq(runtimeSandboxBindings.id, id),
                  eq(runtimeSandboxBindings.version, current.row.version),
                  eq(runtimeSandboxBindings.status, "admitting"),
                ),
              )
              .returning();
            if (!updated) throw conflict("Sandbox changed while recording admission");
            await logActivity(
              tx,
              {
                companyId,
                actorType: "user",
                actorId: v7HumanActorId(actor),
                action: "sandbox.workload_started",
                entityType: "runtime_sandbox",
                entityId: id,
                details: {
                  claimKey,
                  policySnapshotId: initial.snapshot.id,
                  operationId: started.operationId,
                  generation: scope.cellGeneration,
                  executionManifestId: current.source.record.id,
                  executionManifestHash: current.source.record.hash,
                  policyHash,
                  finalVersion: updated.version,
                },
              },
              publications,
            );
            return { binding: updated, duplicate: false };
          }
          if (current.row.status !== "running")
            throw conflict("Sandbox admission claim changed before completion");
          const [durableAdmission] = await tx
            .select({ id: activityLog.id })
            .from(activityLog)
            .where(
              and(
                eq(activityLog.companyId, companyId),
                eq(activityLog.entityType, "runtime_sandbox"),
                eq(activityLog.entityId, id),
                eq(activityLog.action, "sandbox.workload_started"),
                sql`${activityLog.details}->>'claimKey' = ${claimKey}`,
                sql`${activityLog.details}->>'operationId' = ${started.operationId}`,
                sql`${activityLog.details}->>'policySnapshotId' = ${initial.snapshot.id}`,
                sql`${activityLog.details}->>'generation' = ${scope.cellGeneration}`,
                sql`${activityLog.details}->>'executionManifestId' = ${current.source.record.id}`,
                sql`${activityLog.details}->>'executionManifestHash' = ${current.source.record.hash}`,
                sql`${activityLog.details}->>'policyHash' = ${policyHash}`,
              ),
            )
            .limit(1);
          if (!durableAdmission)
            throw conflict("Sandbox version changed without this admission's durable success receipt");
          return { binding: current.row, duplicate: true };
        });
        effectAttempted = false;
        return {
          binding: completion.binding,
          policySnapshotId: initial.snapshot.id,
          operationId: started.operationId,
          observation,
          duplicate: completion.duplicate,
        };
      } catch (error) {
        if (effectAttempted) {
          const stopConfirmed = await stopAndConfirm();
          const fenced = await fenceSandboxAdmissionOutcome(db, {
            companyId,
            bindingId: id,
            cellId: scope.cellId,
            generation: scope.cellGeneration,
            policySnapshotId: initial.snapshot.id,
            claimKey,
            operationKeys: [applyKey, startKey],
            stopConfirmed,
          });
          if (!fenced)
            throw conflict(
              "Sandbox admission failed and its original generation could not be safety fenced",
              { code: "sandbox_quarantine_persistence_failed" },
            );
          if (!stopConfirmed)
            throw conflict(
              "Sandbox admission outcome is unknown; the binding is quarantined until host stop is confirmed",
              { code: "sandbox_stop_unconfirmed" },
            );
        } else if (!initial.claimReplay) {
          const [concurrentSuccess] = await db
            .select()
            .from(activityLog)
            .where(
              and(
                eq(activityLog.companyId, companyId),
                eq(activityLog.entityType, "runtime_sandbox"),
                eq(activityLog.entityId, id),
                eq(activityLog.action, "sandbox.workload_started"),
                sql`${activityLog.details}->>'claimKey' = ${claimKey}`,
                sql`${activityLog.details}->>'generation' = ${scope.cellGeneration}`,
                sql`${activityLog.details}->>'policySnapshotId' = ${initial.snapshot.id}`,
                sql`${activityLog.details}->>'executionManifestId' = ${initial.source.record.id}`,
                sql`${activityLog.details}->>'executionManifestHash' = ${initial.source.record.hash}`,
                sql`${activityLog.details}->>'policyHash' = ${policyHash}`,
              ),
            )
            .orderBy(desc(activityLog.createdAt))
            .limit(1);
          if (concurrentSuccess) return finishedDuplicate(concurrentSuccess);
          const released = await releaseSandboxAdmissionClaim(db, {
            companyId,
            bindingId: id,
            cellId: scope.cellId,
            generation: scope.cellGeneration,
            policySnapshotId: initial.snapshot.id,
            claimKey,
            applyKey,
            startKey,
            reason: "pre_effect_rejection",
          });
          if (!released) {
            const stopConfirmed = await stopAndConfirm();
            const fenced = await fenceSandboxAdmissionOutcome(db, {
              companyId,
              bindingId: id,
              cellId: scope.cellId,
              generation: scope.cellGeneration,
              policySnapshotId: initial.snapshot.id,
              claimKey,
              operationKeys: [applyKey, startKey],
              stopConfirmed,
            });
            if (!fenced)
              throw conflict("Sandbox admission claim could not be released or safety fenced", {
                code: "sandbox_quarantine_persistence_failed",
              });
            if (!stopConfirmed)
              throw conflict("Sandbox admission outcome is unknown; the binding is quarantined until host stop is confirmed", {
                code: "sandbox_stop_unconfirmed",
              });
          }
        }
        throw error;
      }
    },
  };
}
