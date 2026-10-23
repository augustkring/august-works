import { and, eq } from "drizzle-orm";
import { heartbeatRuns, memoryObservations, memoryModels, learningCycles, type Db } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { z } from "zod";
import { canActorReadProjectPrivacy, type AuthorizationActor } from "./authorization.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { heartbeatMemoryPayloadRetained, canActorReadMemorySources } from "./memory/memory-privacy.js";
import { HttpError } from "../errors.js";

function uuid(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Native activity owners retain their own persisted source receipts. */
async function nativeActivitySourcesReadable(db: Db, event: LiveEvent, actor: AuthorizationActor): Promise<boolean> {
  if (event.type !== "activity.logged") return true;
  const entity = event.payload.entityType;
  if (!["memory_record", "memory_job", "memory_observation", "memory_model", "learning_cycle", "cognitive_memory_binding"].includes(String(entity))) return true;
  const id = uuid(event.payload.entityId);
  if (!id) return false;
  const companyId = event.companyId, deadline = performance.now() + 8000;
  const checkBudget = () => {
    if (performance.now() > deadline) throw new HttpError(409, "Native activity source review exceeded its budget");
  };
  try {
    checkBudget();
    if (entity === "memory_record") {
      if (["memory.deletion_ledger_restored", "memory.source_deleted", "memory.retention_policy_updated"].includes(String(event.payload.action))) {
        if (id !== companyId) return false;
        const { memoryService } = await import("./memory/memory-service.js");
        checkBudget();
        const { cognitiveMemoryActor } = await import("./memory/cognitive-memory.js");
        checkBudget();
        const policy = await memoryService(db).getRetentionPolicy(companyId, cognitiveMemoryActor(actor));
        checkBudget();
        return policy.canManage;
      }
      const readable = await canActorReadMemorySources(db, companyId, actor, id);
      checkBudget();
      return readable;
    }
    if (entity === "memory_job") {
      const { canActorReadMemoryJob } = await import("./memory/memory-jobs.js");
      checkBudget();
      const readable = await canActorReadMemoryJob(db, companyId, actor, id);
      checkBudget();
      return readable;
    }
    if (entity === "memory_observation") {
      const [row] = await db.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, companyId), eq(memoryObservations.id, id)));
      checkBudget();
      if (!row || row.erasedAt) return false;
      const { observationLineage } = await import("./memory/derived-memory.js");
      checkBudget();
      await observationLineage(db, actor, row, checkBudget);
    } else if (entity === "memory_model") {
      const [row] = await db.select().from(memoryModels).where(and(eq(memoryModels.companyId, companyId), eq(memoryModels.id, id)));
      checkBudget();
      if (!row || row.erasedAt) return false;
      const { modelLineage } = await import("./memory/derived-memory.js");
      checkBudget();
      await modelLineage(db, actor, row, checkBudget);
    } else if (entity === "learning_cycle") {
      const [row] = await db.select().from(learningCycles).where(and(eq(learningCycles.companyId, companyId), eq(learningCycles.id, id)));
      checkBudget();
      if (!row || row.erasedAt) return false;
      const { learningRoots } = await import("./learning/learning-service.js");
      checkBudget();
      await learningRoots(db, actor, row);
    } else if (entity === "cognitive_memory_binding") {
      const { canActorReadCognitiveBindingActivity } = await import("./memory/cognitive-memory.js");
      checkBudget();
      const details = event.payload.details;
      const operationId = details && typeof details === "object" && "operationId" in details ? details.operationId : undefined;
      const readable = await canActorReadCognitiveBindingActivity(db, companyId, actor, id, event.payload.action, operationId);
      checkBudget();
      return readable;
    }
    checkBudget();
    return true;
  } catch (error) {
    if (error instanceof HttpError && [403, 404, 409].includes(error.status)) return false;
    throw error;
  }
}

/** Recipient admission happens at delivery, using current credentials. The
 * persisted native run, never a provider's nested payload, owns its issue. */
export async function analyticalLiveEventForReader(db: Db, event: LiveEvent, actor: AuthorizationActor): Promise<LiveEvent | null> {
  const runIds = new Set<string>();
  const issueIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const key of ["runId", "issueId", "projectId"] as const) {
    if (event.payload[key] == null) continue;
    const id = uuid(event.payload[key]);
    if (!id) return null;
    if (key === "runId") runIds.add(id);
    if (key === "issueId") issueIds.add(id);
    if (key === "projectId") projectIds.add(id);
  }
  if (event.type === "activity.logged" && ["issue", "project", "heartbeat_run"].includes(String(event.payload.entityType))) {
    const id = uuid(event.payload.entityId);
    if (!id) return null;
    (event.payload.entityType === "issue" ? issueIds : event.payload.entityType === "project" ? projectIds : runIds).add(id);
  }
  try {
    if (!await nativeActivitySourcesReadable(db, event, actor)) return null;
    for (const runId of runIds) {
      const [run] = await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, event.companyId), eq(heartbeatRuns.id, runId),
      )).limit(1);
      // A deleted run cannot authorize a previously queued output payload.
      if (!run) throw new HttpError(403, "Analytical source access is unavailable", { code: "analytical_source_access_lost" });
      const boundIssueId = run.issueId ?? run.nativeIssueId ?? (run.runtimeMode === "legacy" ? uuid(run.contextSnapshot?.issueId) : null);
      if (boundIssueId) issueIds.add(boundIssueId);
      if (!await heartbeatMemoryPayloadRetained(db, event.companyId, runId)) {
        throw new HttpError(403, "Analytical source access is unavailable", { code: "analytical_source_access_lost" });
      }
      await assertAnalyticalContextPayloadAccess(db, event.companyId, actor, { runId });
    }
    // Review the whole conversation: later native turns can borrow prose from
    // an earlier turn before they have obtained their own analytical root.
    for (const issueId of issueIds) await assertAnalyticalContextPayloadAccess(db, event.companyId, actor, { issueId });
    for (const id of projectIds) {
      if (!await canActorReadProjectPrivacy(db, actor, { companyId: event.companyId, id })) return null;
    }
    return event;
  } catch (error) {
    if (!(error instanceof HttpError) || (error.details as { code?: unknown } | undefined)?.code !== "analytical_source_access_lost") throw error;
    // A company subscription is not evidence that this recipient has ever
    // seen the private source. Even its identity or a loss placeholder leaks.
    return null;
  }
}
