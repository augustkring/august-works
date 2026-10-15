import { describe, expect, it } from "vitest";
import { agentMonitorSchema } from "./agent-monitor.js";
const paused = {
  companyId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  name: "Original agent", nativeStatus: "paused", lifecycle: "paused", pauseReason: "manual",
  updatedAt: "2026-10-11T00:00:00Z", observedAt: "2026-10-11T00:00:00Z", lastHeartbeatAt: null,
  recent: { runs: [], hasMore: false },
};
describe("paused native work observation", () => {
  it("accepts an older owner without an observation and preserves explicit unavailability", () => {
    expect(agentMonitorSchema.parse(paused).pausedWork).toBeUndefined();
    expect(agentMonitorSchema.parse({ ...paused, pausedWork: { status: "unavailable", pendingRuns: null } }).pausedWork?.pendingRuns).toBeNull();
  });
  it.each([
    { status: "none", pendingRuns: 1 },
    { status: "none", pendingRuns: null },
    { status: "pending", pendingRuns: 0 },
    { status: "pending", pendingRuns: null },
    { status: "unavailable", pendingRuns: 0 },
    { status: "pending", pendingRuns: 7 },
    { status: "none", pendingRuns: 0, remoteStopped: true },
  ])("rejects false settlement or fabricated remote proof %j", pausedWork => {
    expect(agentMonitorSchema.safeParse({ ...paused, pausedWork }).success).toBe(false);
  });
  it("does not carry a paused observation into a different scheduling state", () => {
    expect(agentMonitorSchema.safeParse({ ...paused, nativeStatus: "idle", lifecycle: "active", pauseReason: null,
      pausedWork: { status: "none", pendingRuns: 0 } }).success).toBe(false);
  });
});
