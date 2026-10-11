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
    // Absent on an older read owner: UI must treat it as unavailable.
    pausedWork: z.strictObject({
      status: z.enum(["none", "pending", "unavailable"]),
      pendingRuns: z.number().int().min(0).max(6).nullable(),
    }).optional(),
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
    if (view.pausedWork && (
      view.nativeStatus !== "paused" ||
      (view.pausedWork.status === "none" && view.pausedWork.pendingRuns !== 0) ||
      (view.pausedWork.status === "pending" && !(view.pausedWork.pendingRuns !== null && view.pausedWork.pendingRuns > 0)) ||
      (view.pausedWork.status === "unavailable" && view.pausedWork.pendingRuns !== null)
    )) ctx.addIssue({ code: "custom", message: "Paused work observation is inconsistent" });
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
