import { z } from "zod";
import { AGENT_STATUSES, HEARTBEAT_RUN_STATUSES } from "./constants.js";

/** Native scheduling and execution metadata; no readiness or business result claim. */
export const agentMonitorSchema = z
  .strictObject({
    companyId: z.uuid(),
    agentId: z.uuid(),
    name: z.string().min(1).max(200),
    updatedAt: z.iso.datetime(),
    observedAt: z.iso.datetime(),
    nativeStatus: z.enum(AGENT_STATUSES),
    lifecycle: z.enum([
      "active",
      "paused",
      "needs_attention",
      "pending_approval",
      "retired",
    ]),
    pauseReason: z.enum(["manual", "budget", "system", "unknown"]).nullable(),
    lastHeartbeatAt: z.iso.datetime().nullable(),
    recent: z.strictObject({
      runs: z
        .array(
          z.strictObject({
            id: z.uuid(),
            status: z.enum(HEARTBEAT_RUN_STATUSES),
            createdAt: z.iso.datetime(),
            startedAt: z.iso.datetime().nullable(),
            finishedAt: z.iso.datetime().nullable(),
          }),
        )
        .max(6),
      hasMore: z.boolean(),
    }),
  })
  .superRefine((view, ctx) => {
    const expected =
      view.nativeStatus === "terminated"
        ? "retired"
        : view.nativeStatus === "paused"
          ? "paused"
          : view.nativeStatus === "pending_approval"
            ? "pending_approval"
            : view.nativeStatus === "error"
              ? "needs_attention"
              : "active";
    if (
      view.lifecycle !== expected ||
      (view.nativeStatus === "paused") !== (view.pauseReason !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Native scheduling state binding changed",
      });
    if (
      new Set(view.recent.runs.map((run) => run.id)).size !==
      view.recent.runs.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate native run reference",
      });
  });
export type AgentMonitor = z.infer<typeof agentMonitorSchema>;
