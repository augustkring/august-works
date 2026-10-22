import { and, eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { z } from "zod";
import { canActorReadProjectPrivacy, type AuthorizationActor } from "./authorization.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { heartbeatMemoryPayloadRetained } from "./memory/memory-privacy.js";
import { HttpError } from "../errors.js";

function uuid(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Recipient admission happens at delivery, using current credentials. The
 * persisted native run, never a provider's nested payload, owns its issue. */
export async function analyticalLiveEventForReader(db: Db, event: LiveEvent, actor: AuthorizationActor): Promise<LiveEvent | null> {
  const runId = uuid(event.payload.runId);
  const issueIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const key of ["runId", "issueId", "projectId"] as const) {
    if (event.payload[key] == null) continue;
    const id = uuid(event.payload[key]);
    if (!id) return null;
    if (key === "issueId") issueIds.add(id);
    if (key === "projectId") projectIds.add(id);
  }
  if (event.type === "activity.logged" && ["issue", "project"].includes(String(event.payload.entityType))) {
    const id = uuid(event.payload.entityId);
    if (!id) return null;
    (event.payload.entityType === "issue" ? issueIds : projectIds).add(id);
  }
  try {
    if (runId) {
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
