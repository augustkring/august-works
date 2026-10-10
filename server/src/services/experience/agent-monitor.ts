import { and, desc, eq } from "drizzle-orm";
import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentMonitorSchema, v9FeatureEnabled } from "@paperclipai/shared";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import { conflict, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertAnalyticalContextPayloadAccess } from "../analytical-context-authority.js";

const agentFields = {
  id: agents.id,
  companyId: agents.companyId,
  name: agents.name,
  status: agents.status,
  pauseReason: agents.pauseReason,
  updatedAt: agents.updatedAt,
  lastHeartbeatAt: agents.lastHeartbeatAt,
};
const runFields = {
  id: heartbeatRuns.id,
  status: heartbeatRuns.status,
  createdAt: heartbeatRuns.createdAt,
  startedAt: heartbeatRuns.startedAt,
  finishedAt: heartbeatRuns.finishedAt,
};
/** Read through native authority and source owners; never return prompt/config/error prose. */
export async function readAgentMonitor(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
  agentId: string,
) {
  v5HumanActorId(actor);
  const current = { ...actor, ignoreInstanceAdmin: true };
  const started = performance.now();
  function budget() {
    if (performance.now() - started > 5000)
      throw conflict("Agent state could not be checked; reload", {
        code: "agent_monitor_stale",
      });
  }
  async function access() {
    budget();
    if (
      !v9FeatureEnabled(
        await instanceSettingsService(db).getExperimental(),
        "progressive_shell_v9",
      )
    )
      throw notFound("Agent customer monitoring is not enabled");
    await assertV5Authorization(db, current, companyId, "agent:read", {
      type: "agent",
      companyId,
      agentId,
    });
    budget();
  }
  async function agent() {
    const [row] = await db
      .select(agentFields)
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
    if (!row) throw notFound("Agent not found");
    return row;
  }
  async function runs() {
    return db
      .select(runFields)
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId),
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))
      .limit(7);
  }
  await access();
  const source = await agent(),
    recent = await runs();
  for (const run of recent.slice(0, 6)) {
    budget();
    await assertAnalyticalContextPayloadAccess(db, companyId, current, {
      runId: run.id,
    });
  }
  if (
    !isDeepStrictEqual(source, await agent()) ||
    !isDeepStrictEqual(recent, await runs())
  )
    throw conflict("Agent state changed; reload", {
      code: "agent_monitor_stale",
    });
  for (const run of recent.slice(0, 6)) {
    budget();
    await assertAnalyticalContextPayloadAccess(db, companyId, current, {
      runId: run.id,
    });
  }
  await access();
  const lifecycle =
    source.status === "terminated"
      ? "retired"
      : source.status === "paused"
        ? "paused"
        : source.status === "pending_approval"
          ? "pending_approval"
          : source.status === "error"
            ? "needs_attention"
            : "active";
  return agentMonitorSchema.parse({
    companyId,
    agentId,
    name: source.name.slice(0, 200),
    updatedAt: source.updatedAt.toISOString(),
    observedAt: new Date().toISOString(),
    nativeStatus: source.status,
    lifecycle,
    pauseReason:
      source.status !== "paused"
        ? null
        : ["manual", "budget", "system"].includes(source.pauseReason ?? "")
          ? source.pauseReason
          : "unknown",
    lastHeartbeatAt: source.lastHeartbeatAt?.toISOString() ?? null,
    recent: {
      hasMore: recent.length > 6,
      runs: recent.slice(0, 6).map((run) => ({
        ...run,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
    },
  });
}
