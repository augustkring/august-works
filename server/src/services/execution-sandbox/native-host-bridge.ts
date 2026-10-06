import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  runtimeCells,
  runtimeHosts,
  runtimeHostCommands,
  runtimeSandboxBindings,
  type Db,
} from "@paperclipai/db";
import {
  SANDBOX_HOST_COMMAND,
  sandboxHostRequestSchema,
  sandboxHostReplySchema,
  sandboxHostCompletionSchema,
  type SandboxHostRequest,
} from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import {
  assertV7Authorization,
  assertV7Enabled,
  v7HumanActorId,
} from "../v7-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { equalDigest, randomToken, sha256 } from "../saas/crypto.js";
import { runtimeHostAuth } from "../runtime/host-auth.js";
import { hostVersionMeetsMinimum } from "../runtime/catalog.js";
import { conflict, forbidden } from "../../errors.js";
import type { OpenShellHostBridge } from "./openshell-backend.js";
import type { SandboxIdentity } from "./backend.js";

const safety = (action: string) =>
  ["stop", "destroy", "revoke_providers"].includes(action);
/** Reuses the native durable host-command lane and host signature/epoch. No
 * browser, Task body or model response can provide a transport or attestation. */
export function nativeSandboxHostTransport(
  db: Db,
  options: { suspectSeconds?: number; timeoutMs?: number } = {},
) {
  const auth = runtimeHostAuth(db);
  async function current(
    tx: Db,
    request: SandboxHostRequest,
    hostId: string,
    now: Date,
  ) {
    const [host] = await tx
      .select()
      .from(runtimeHosts)
      .where(eq(runtimeHosts.id, hostId))
      .for("no key update");
    // Use the native cell before binding lock order used by invalidation.
    const [cell] = await tx
      .select()
      .from(runtimeCells)
      .where(
        and(
          eq(runtimeCells.companyId, request.scope.companyId),
          eq(runtimeCells.id, request.scope.cellId),
        ),
      )
      .for("share");
    const [binding] = await tx
      .select()
      .from(runtimeSandboxBindings)
      .where(
        and(
          eq(runtimeSandboxBindings.companyId, request.scope.companyId),
          eq(runtimeSandboxBindings.id, request.scope.bindingId),
        ),
      )
      .for("share");
    if (
      !cell ||
      cell.deletedAt ||
      cell.runtimeHostId !== hostId ||
      cell.generation.toString() !== request.scope.cellGeneration ||
      (cell.activeImageDigest ?? cell.desiredImageDigest) !==
        request.imageDigest ||
      !binding ||
      binding.runtimeCellId !== cell.id ||
      binding.cellGeneration !== request.scope.cellGeneration ||
      binding.backend !== "openshell" ||
      ["deleted"].includes(binding.status) ||
      (!safety(request.action) && binding.status === "quarantined") ||
      !host ||
      host.credentialVersion !== request.hostEpoch ||
      !host.publicKeyPem ||
      !hostVersionMeetsMinimum(host.hostAgentVersion, "6.0.2") ||
      host.credentialRevokedAt ||
      host.fencedAt ||
      host.retiredAt ||
      !["READY", "DRAINING"].includes(host.status) ||
      !host.lastHeartbeatAt ||
      host.lastHeartbeatAt.getTime() <
        now.getTime() - (options.suspectSeconds ?? 90) * 1000
    )
      throw conflict("Native sandbox host scope changed", {
        code: "sandbox_scope_changed",
      });
    if (!safety(request.action)) {
      await assertV7Enabled(tx, "sandbox_abstraction_v7");
      await assertV7Enabled(tx, "openshell_v7");
      const actor: AuthorizationActor = {
        type: "board",
        source: "session",
        userId: request.requesterUserId,
      };
      await assertV7Authorization(
        tx,
        actor,
        request.scope.companyId,
        "runtime:manage",
      );
    }
    return { cell, binding, host };
  }
  async function invoke(
    actor: AuthorizationActor,
    scope: SandboxIdentity,
    action: SandboxHostRequest["action"],
    probe?: SandboxHostRequest["probe"],
    idempotencyKey: string = randomUUID(),
  ) {
    scope = {
      companyId: scope.companyId,
      bindingId: scope.bindingId,
      cellId: scope.cellId,
      cellGeneration: scope.cellGeneration,
      sandboxRef: scope.sandboxRef,
    };
    const userId = v7HumanActorId(actor),
      now = new Date();
    const queued = await withV7ActivityTransaction(
      db,
      async (tx, publications) => {
        await assertV7Authorization(
          tx,
          actor,
          scope.companyId,
          "runtime:manage",
        );
        const [cell] = await tx
          .select()
          .from(runtimeCells)
          .where(
            and(
              eq(runtimeCells.companyId, scope.companyId),
              eq(runtimeCells.id, scope.cellId),
            ),
          )
          .for("share");
        const [host] = cell?.runtimeHostId
          ? await tx
              .select()
              .from(runtimeHosts)
              .where(eq(runtimeHosts.id, cell.runtimeHostId))
          : [];
        if (!cell || !host)
          throw conflict("An enrolled native host is required");
        const request = sandboxHostRequestSchema.parse({
          version: 1,
          scope,
          action,
          ...(probe ? { probe } : {}),
          hostEpoch: host.credentialVersion,
          imageDigest: cell.activeImageDigest ?? cell.desiredImageDigest,
          requesterUserId: userId,
        });
        await current(tx, request, host.id, now);
        const key = `v7-openshell:${nativeSha256({ scope, action, idempotencyKey })}`;
        const [existing] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(eq(runtimeHostCommands.idempotencyKey, key));
        if (existing) {
          if (nativeSha256(existing.payload) !== nativeSha256(request))
            throw conflict(
              "Sandbox operation key belongs to different immutable inputs",
            );
          return existing;
        }
        const active = await tx
          .select({ id: runtimeHostCommands.id })
          .from(runtimeHostCommands)
          .where(
            and(
              eq(runtimeHostCommands.runtimeHostId, host.id),
              eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
              inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
              gt(runtimeHostCommands.deadlineAt, now),
            ),
          )
          .limit(100);
        if (active.length >= 100)
          throw conflict("Native sandbox command capacity is occupied");
        const [command] = await tx
          .insert(runtimeHostCommands)
          .values({
            runtimeHostId: host.id,
            companyId: scope.companyId,
            runtimeCellId: scope.cellId,
            cellGeneration: BigInt(scope.cellGeneration),
            commandType: SANDBOX_HOST_COMMAND,
            idempotencyKey: key,
            payload: request,
            deadlineAt: new Date(
              now.getTime() + Math.min(30000, options.timeoutMs ?? 20000),
            ),
          })
          .onConflictDoNothing()
          .returning();
        if (!command)
          throw conflict(
            "Concurrent sandbox request; retry the same operation key",
          );
        await logActivity(
          tx,
          {
            companyId: scope.companyId,
            actorType: "user",
            actorId: userId,
            action: "sandbox.host_command_requested",
            entityType: "runtime_sandbox",
            entityId: scope.bindingId,
            details: {
              commandId: command.id,
              action,
              generation: scope.cellGeneration,
            },
          },
          publications,
        );
        return command;
      },
    );
    while (true) {
      const [record] = await db
        .select()
        .from(runtimeHostCommands)
        .where(eq(runtimeHostCommands.id, queued.id));
      if (!record) throw conflict("Native sandbox receipt unavailable");
      if (record.status === "SUCCEEDED") {
        return db.transaction(async (tx) => {
          await current(
            tx as unknown as Db,
            sandboxHostRequestSchema.parse(record.payload),
            record.runtimeHostId,
            new Date(),
          );
          const reply = sandboxHostReplySchema.parse(record.safeResult);
          if (reply.action !== action)
            throw conflict("Native sandbox reply action changed");
          return { commandId: record.id, reply };
        });
      }
      if (
        ["FAILED", "CANCELED", "EXPIRED"].includes(record.status) ||
        record.deadlineAt <= new Date()
      )
        throw conflict("Native sandbox operation requires reconciliation", {
          code: record.errorCode ?? "sandbox_host_unavailable",
          commandId: record.id,
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return {
    bridge(actor: AuthorizationActor): OpenShellHostBridge {
      return {
        capabilities: async (scope) => {
          const { reply } = await invoke(actor, scope, "capabilities");
          if (reply.action !== "capabilities")
            throw conflict("Native sandbox reply action changed");
          return reply.capabilities;
        },
        prepare: async (scope) => {
          const { reply } = await invoke(actor, scope, "prepare");
          if (reply.action !== "prepare")
            throw conflict("Native sandbox reply action changed");
          return {
            ...scope,
            backendVersion: reply.backendVersion,
            imageDigest: reply.imageDigest,
          };
        },
        inspect: async (scope) => {
          const { reply } = await invoke(actor, scope, "inspect");
          if (reply.action !== "inspect")
            throw conflict("Native sandbox reply action changed");
          const { action: _, ...observation } = reply;
          return observation;
        },
        effectivePolicy: async (scope) => {
          const { reply } = await invoke(actor, scope, "effective_policy");
          if (reply.action !== "effective_policy")
            throw conflict("Native sandbox reply action changed");
          return reply.document;
        },
        // Physical admission remains closed until the complete outer controls
        // and credential broker can be observed, not asserted in a host file.
        apply: async () => {
          throw conflict("Complete physical policy admission is not qualified");
        },
        start: async () => {
          throw conflict(
            "Complete physical workload admission is not qualified",
          );
        },
        revokeProviders: async (scope) => {
          await invoke(actor, scope, "revoke_providers");
        },
        stop: async (scope) => ({
          operationId: (
            await invoke(actor, scope, "stop", undefined, scope.idempotencyKey)
          ).commandId,
        }),
        destroy: async (scope) => ({
          operationId: (
            await invoke(
              actor,
              scope,
              "destroy",
              undefined,
              scope.idempotencyKey,
            )
          ).commandId,
        }),
        probe: async (scope) => {
          const { reply } = await invoke(actor, scope, "probe", scope.test);
          if (reply.action !== "probe")
            throw conflict("Native sandbox reply action changed");
          return {
            verdict: reply.verdict,
            observationHash: reply.observationHash,
          };
        },
      };
    },
    async claim(hostId: string, now = new Date()) {
      return db.transaction(async (transaction) => {
        const tx = transaction as unknown as Db;
        const [command] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(
            and(
              eq(runtimeHostCommands.runtimeHostId, hostId),
              eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
              or(
                eq(runtimeHostCommands.status, "PENDING"),
                and(
                  eq(runtimeHostCommands.status, "CLAIMED"),
                  lte(runtimeHostCommands.leaseUntil, now),
                ),
              ),
              gt(runtimeHostCommands.deadlineAt, now),
              lt(runtimeHostCommands.attempt, 3),
            ),
          )
          .orderBy(runtimeHostCommands.createdAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (!command) return null;
        const request = sandboxHostRequestSchema.parse(command.payload);
        let host;
        try {
          ({ host } = await current(tx, request, hostId, now));
        } catch {
          await tx
            .update(runtimeHostCommands)
            .set({
              status: "CANCELED",
              errorCode: "sandbox_scope_changed",
              completedAt: now,
            })
            .where(eq(runtimeHostCommands.id, command.id));
          return null;
        }
        const claimToken = randomToken();
        await tx
          .update(runtimeHostCommands)
          .set({
            status: "CLAIMED",
            claimTokenHash: sha256(claimToken),
            attempt: command.attempt + 1,
            leaseUntil: new Date(
              Math.min(command.deadlineAt.getTime(), now.getTime() + 15000),
            ),
          })
          .where(eq(runtimeHostCommands.id, command.id));
        return {
          id: command.id,
          deadlineAt: command.deadlineAt,
          envelope: auth.protectCommand(host, command.id, {
            ...request,
            claimToken,
          }),
        };
      });
    },
    async complete(
      hostId: string,
      commandId: string,
      raw: unknown,
      now = new Date(),
    ) {
      const input = sandboxHostCompletionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const [command] = await tx
          .select()
          .from(runtimeHostCommands)
          .where(
            and(
              eq(runtimeHostCommands.id, commandId),
              eq(runtimeHostCommands.runtimeHostId, hostId),
              eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
            ),
          )
          .for("update");
        if (
          !command ||
          !command.claimTokenHash ||
          !equalDigest(command.claimTokenHash, sha256(input.claimToken)) ||
          command.cellGeneration?.toString() !== input.generation
        )
          throw forbidden("Native sandbox claim mismatch");
        const request = sandboxHostRequestSchema.parse(command.payload);
        await current(tx, request, hostId, now);
        if (input.reply && input.reply.action !== request.action)
          throw forbidden("Native sandbox action mismatch");
        if (["SUCCEEDED", "FAILED"].includes(command.status)) {
          if (
            nativeSha256(command.safeResult) !== nativeSha256(input.reply) ||
            command.errorCode !== input.errorCode
          )
            throw conflict("Native sandbox receipt is immutable");
          return { recorded: true };
        }
        if (
          command.status !== "CLAIMED" ||
          command.deadlineAt <= now ||
          !command.leaseUntil ||
          command.leaseUntil <= now
        )
          throw conflict("Native sandbox lease expired");
        await tx
          .update(runtimeHostCommands)
          .set({
            status: input.success ? "SUCCEEDED" : "FAILED",
            safeResult: input.reply,
            errorCode: input.errorCode,
            completedAt: now,
            leaseUntil: null,
          })
          .where(eq(runtimeHostCommands.id, command.id));
        await logActivity(
          tx,
          {
            companyId: request.scope.companyId,
            actorType: "system",
            actorId: `runtime-host:${hostId}`,
            action: "sandbox.host_command_recorded",
            entityType: "runtime_sandbox",
            entityId: request.scope.bindingId,
            details: {
              commandId,
              action: request.action,
              generation: input.generation,
              success: input.success,
              errorCode: input.errorCode,
            },
          },
          publications,
        );
        return { recorded: true };
      });
    },
    async reconcile(now = new Date()) {
      const rows = await db
        .update(runtimeHostCommands)
        .set({
          status: "EXPIRED",
          errorCode: "sandbox_host_unavailable",
          completedAt: now,
        })
        .where(
          and(
            eq(runtimeHostCommands.commandType, SANDBOX_HOST_COMMAND),
            inArray(runtimeHostCommands.status, ["PENDING", "CLAIMED"]),
            or(
              lte(runtimeHostCommands.deadlineAt, now),
              and(
                sql`${runtimeHostCommands.attempt} >= 3`,
                lte(runtimeHostCommands.leaseUntil, now),
              ),
            ),
          ),
        )
        .returning({ id: runtimeHostCommands.id });
      return rows.length;
    },
  };
}
