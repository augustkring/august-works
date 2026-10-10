import { expect, it, vi, afterEach } from "vitest";
import { api } from "./client";
import { agentMonitorApi } from "./agent-monitor";
const company = "00000000-0000-4000-8000-000000000001",
  agentId = "00000000-0000-4000-8000-000000000002";
const view = {
  companyId: company,
  agentId,
  name: "Current agent",
  updatedAt: "2026-10-10T00:00:00Z",
  observedAt: "2026-10-10T00:00:00Z",
  nativeStatus: "idle",
  lifecycle: "active",
  pauseReason: null,
  lastHeartbeatAt: null,
  recent: { runs: [], hasMore: false },
};
afterEach(() => vi.restoreAllMocks());
it("binds private current reads to company, account and agent with abort/no-store", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(view);
  const signal = new AbortController().signal;
  expect(
    await agentMonitorApi.get(company, "current owner", agentId, signal),
  ).toEqual(view);
  expect(get).toHaveBeenCalledWith(
    expect.stringContaining("expectedUserId=current%20owner"),
    { signal, cache: "no-store" },
  );
});
it.each([
  { companyId: agentId },
  { agentId: company },
  { configuration: { secret: "private" } },
  { nativeStatus: "verified" },
  { lifecycle: "retired" },
  { pauseReason: "manual" },
])("rejects a foreign or malformed native view %j", async (change) => {
  vi.spyOn(api, "get").mockResolvedValue({ ...view, ...change });
  await expect(
    agentMonitorApi.get(company, "owner", agentId),
  ).rejects.toThrow();
});
