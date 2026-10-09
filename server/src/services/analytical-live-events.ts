import { and, eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { z } from "zod";
import type { AuthorizationActor } from "./authorization.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { heartbeatMemoryPayloadRetained } from "./memory/memory-privacy.js";
import { HttpError } from "../errors.js";

function uuid(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Recipient admission happens at delivery, using current credentials. The
 * persisted native run, never a provider's nested payload, owns its issue. */
export async function analyticalLiveEventForReader(db: Db, event: LiveEvent, actor: AuthorizationActor): Promise<LiveEvent> {
  const runId = uuid(event.payload.runId);
  let issueId = uuid(event.payload.issueId) ??
    (event.type === "activity.logged" && event.payload.entityType === "issue" ? uuid(event.payload.entityId) : null);
  try {
    if (runId) {
      const [run] = await db.select().from(heartbeatRuns).where(and(
        eq(heartbeatRuns.companyId, event.companyId), eq(heartbeatRuns.id, runId),
      )).limit(1);
      // A deleted run cannot authorize a previously queued output payload.
      if (!run) throw new HttpError(403, "Analytical source access is unavailable", { code: "analytical_source_access_lost" });
      issueId = run.nativeIssueId ?? (run.runtimeMode === "legacy" ? uuid(run.contextSnapshot?.issueId) : null);
      if (!await heartbeatMemoryPayloadRetained(db, event.companyId, runId)) {
        throw new HttpError(403, "Analytical source access is unavailable", { code: "analytical_source_access_lost" });
      }
      await assertAnalyticalContextPayloadAccess(db, event.companyId, actor, { runId });
    }
    // Review the whole conversation: later native turns can borrow prose from
    // an earlier turn before they have obtained their own analytical root.
    if (issueId) await assertAnalyticalContextPayloadAccess(db, event.companyId, actor, { issueId });
    return event;
  } catch (error) {
    if (!(error instanceof HttpError) || (error.details as { code?: unknown } | undefined)?.code !== "analytical_source_access_lost") throw error;
    return { id: event.id, companyId: event.companyId, createdAt: event.createdAt,
      type: "analytical.context.access_lost", payload: { runId, issueId, code: "analytical_source_access_lost" } };
  }
}
