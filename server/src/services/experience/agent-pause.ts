import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { activityLog, agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentPauseCommandSchema, agentPauseReceiptSchema, agentPauseReviewSchema, v9FeatureEnabled, type AgentPauseReceipt } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { agentService } from "../agents.js";
import { heartbeatService } from "../heartbeat.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { withV5ActivityTransaction } from "../v5-mutations.js";
import { logActivity } from "../activity-log.js";
import { conflict, notFound, HttpError } from "../../errors.js";

/** Customer adapter over Original admission, stop and activity owners. */
export function agentPauseService(db: Db, cancel = (id: string, runIds: readonly string[]) => heartbeatService(db).cancelActiveForAgent(id, undefined, runIds)) {
  async function access(tx: Db, actor: AuthorizationActor, companyId: string, agentId: string, write = false) {
    const userId = v5HumanActorId(actor), current = { ...actor, ignoreInstanceAdmin: true };
    if (!v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(), "progressive_shell_v9")) throw notFound("Customer agent controls are unavailable");
    await assertV5Authorization(tx, current, companyId, "agent:read", { type: "agent", companyId, agentId });
    if (write) await assertV5Authorization(tx, current, companyId, "agents:configure", { type: "agent", companyId, agentId });
    const [agent] = await tx.select({ id: agents.id, companyId: agents.companyId, name: agents.name,
      status: agents.status, updatedAt: agents.updatedAt, pauseReason: agents.pauseReason }).from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("update");
    if (!agent) throw notFound("Agent not found");
    return { agent, userId };
  }
  async function source(tx: Db, actor: AuthorizationActor, companyId: string, agentId: string) {
    const current = await access(tx, actor, companyId, agentId, true);
    const runs = await tx.select({ id: heartbeatRuns.id, status: heartbeatRuns.status }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId),
        inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]))).orderBy(asc(heartbeatRuns.id)).limit(1001);
    if (runs.length > 1000) throw conflict("Pending work exceeds the bounded customer pause review");
    return { ...current, runs };
  }
  function review({ agent, runs }: Awaited<ReturnType<typeof source>>) {
    return agentPauseReviewSchema.parse({ companyId: agent.companyId, agentId: agent.id, name: agent.name,
      nativeStatus: agent.status, sourceToken: nativeSha256({ agent, runs }),
      canPause: !["paused", "pending_approval", "terminated"].includes(agent.status) });
  }
  async function recorded(tx: Db, requestId: string) {
    const [row] = await tx.select().from(activityLog).where(and(eq(activityLog.action, "agent.paused"),
      sql`${activityLog.details}->>'pauseRequestId'=${requestId}`)).limit(1);
    return row ?? null;
  }
  function receipt(row: typeof activityLog.$inferSelect): AgentPauseReceipt {
    return agentPauseReceiptSchema.parse({ companyId: row.companyId, agentId: row.entityId, requestId: row.details?.pauseRequestId,
      pendingWork: row.details?.pendingWork, acceptedAt: row.createdAt.toISOString(), admissionClosedAtAcceptance: true, workSettled: false });
  }
  return {
    review: (actor: AuthorizationActor, companyId: string, agentId: string) => db.transaction(async raw =>
      review(await source(raw as unknown as Db, actor, companyId, agentId))),
    receipt: (actor: AuthorizationActor, companyId: string, agentId: string, requestId: string) => db.transaction(async raw => {
      const tx = raw as unknown as Db, { userId } = await access(tx, actor, companyId, agentId), row = await recorded(tx, requestId);
      if (!row || row.companyId !== companyId || row.entityType !== "agent" || row.entityId !== agentId || row.actorType !== "user" || row.actorId !== userId) return null;
      return receipt(row);
    }),
    pause: async (actor: AuthorizationActor, companyId: string, agentId: string, raw: unknown) => {
      const input = agentPauseCommandSchema.parse(raw), userId = v5HumanActorId(actor), requestHash = nativeSha256({ companyId, agentId, userId, input });
      const result = await withV5ActivityTransaction(db, async (tx, publications) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`v9-agent-pause:${input.requestId}`},0))`);
        await access(tx, actor, companyId, agentId, true);
        const prior = await recorded(tx, input.requestId);
        if (prior) {
          if (prior.companyId !== companyId || prior.entityType !== "agent" || prior.entityId !== agentId || prior.actorType !== "user" ||
            prior.actorId !== userId || prior.details?.pauseRequestHash !== requestHash)
            throw conflict("This pause request has a different scope or decision", { code: "agent_pause_request_conflict" });
          return { receipt: receipt(prior), first: false, runIds: [] as string[] };
        }
        const snapshot = await source(tx, actor, companyId, agentId), current = review(snapshot), runIds = snapshot.runs.map(run => run.id);
        if (!current.canPause || current.sourceToken !== input.expectedSourceToken)
          throw conflict("Agent changed; review the current pause decision", { code: "agent_pause_source_changed" });
        await agentService(tx).pause(agentId);
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "agent.paused", entityType: "agent", entityId: agentId,
          details: { pendingWork: input.pendingWork, pauseRequestId: input.requestId, pauseRequestHash: requestHash, pauseRunIds: runIds } }, publications);
        await access(tx, actor, companyId, agentId, true);
        const row = await recorded(tx, input.requestId);
        if (!row) throw conflict("The Original pause receipt was not retained");
        return { receipt: receipt(row), first: true, runIds };
      });
      // Remote cancellation starts only after durable admission and audit.
      // Reads and replays never retry it or widen the confirmed run set.
      if (result.first && input.pendingWork === "cancel") {
        try { await cancel(agentId, result.runIds); }
        catch { throw new HttpError(502, "Pause is recorded; check the original receipt and current work", { code: "agent_pause_cancellation_unknown" }); }
      }
      return result.receipt;
    },
  };
}
