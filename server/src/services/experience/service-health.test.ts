import { afterEach, expect, it, vi } from "vitest";
import { PRODUCT_IDENTITY } from "@paperclipai/shared";
import { managedServiceHealth } from "./service-health.js";

const clock = Date.parse("2026-10-27T12:00:00Z");
function summary() {
  return { page: { url: PRODUCT_IDENTITY.statusOrigin, updated_at: "2026-10-27T11:00:00Z" },
    status: { indicator: "minor" }, components: [{ id: "app", name: "Blentera app", status: "degraded_performance" }],
    incidents: [{ id: "incident1", name: "Delayed Task updates", status: "investigating", updated_at: "2026-10-27T11:45:00Z", components: [{ id: "app" }] }],
    scheduled_maintenances: [{ id: "maintenance1", name: "Planned app maintenance", status: "scheduled", updated_at: "2026-10-27T11:45:00Z", components: [{ id: "app" }], scheduled_for: "2026-10-28T11:00:00Z", scheduled_until: "2026-10-28T12:00:00Z" }],
  };
}
function response(value: unknown) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
afterEach(() => { vi.useRealTimers(); });

it("projects only published customer communication and coalesces concurrent reads without tenant credentials", async () => {
  const fetch = vi.fn(async (_url: URL, _init: RequestInit) => response(summary()));
  const service = managedServiceHealth({ enabled: true, now: () => clock, fetch });
  const [first, second] = await Promise.all([service.read(), service.read()]);
  expect(first).toEqual(second);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0]?.[0])).toBe(`${PRODUCT_IDENTITY.statusOrigin}/api/v2/summary.json`);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", headers: { accept: "application/json" } });
  expect(first).toMatchObject({ state: "current", customerImpact: "unknown", indicator: "minor", components: [{ name: "Blentera app", status: "degraded_performance" }],
    incidents: [{ href: `${PRODUCT_IDENTITY.statusOrigin}/incidents/incident1`, status: "investigating" }], scheduledMaintenance: [{ status: "scheduled" }] });
  await service.read(); expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not reuse an old all-clear after the provider becomes unavailable", async () => {
  let time = clock;
  const source = summary(); source.status.indicator = "none"; source.incidents = []; source.scheduled_maintenances = []; source.components[0].status = "operational";
  const fetch = vi.fn().mockResolvedValueOnce(response(source)).mockResolvedValueOnce(new Response("down", { status: 503 }));
  const service = managedServiceHealth({ enabled: true, now: () => time, fetch });
  expect(await service.read()).toMatchObject({ state: "current", indicator: "none" });
  time += 30_001;
  expect(await service.read()).toEqual({ state: "unavailable", statusUrl: PRODUCT_IDENTITY.statusOrigin });
});

it("rejects foreign origins, internal topology, unknown references, impossible windows and oversized responses", async () => {
  const invalid = [
    { ...summary(), page: { url: "https://foreign.example", updated_at: "2026-10-27T11:00:00Z" } },
    { ...summary(), components: [{ id: "app", name: "Internal database node 7", status: "operational" }] },
    { ...summary(), incidents: [{ ...summary().incidents[0], components: [{ id: "other" }] }] },
    { ...summary(), scheduled_maintenances: [{ ...summary().scheduled_maintenances[0], scheduled_until: "2026-10-27T11:00:00Z" }] },
    { ...summary(), page: { url: PRODUCT_IDENTITY.statusOrigin, updated_at: "2030-01-01T00:00:00Z" } },
  ];
  for (const source of invalid) {
    const service = managedServiceHealth({ enabled: true, now: () => clock, fetch: async () => response(source) });
    expect(await service.read()).toMatchObject({ state: "unavailable" });
  }
  const service = managedServiceHealth({ enabled: true, now: () => clock,
    fetch: async () => new Response(" ".repeat(256 * 1024 + 1), { headers: { "content-type": "application/json" } }) });
  expect(await service.read()).toMatchObject({ state: "unavailable" });
});

it("does no provider work when unconfigured and bounds a stalled provider", async () => {
  const fetch = vi.fn(async () => response(summary()));
  expect(await managedServiceHealth({ enabled: false, fetch }).read()).toMatchObject({ state: "unconfigured" });
  expect(fetch).not.toHaveBeenCalled();
  vi.useFakeTimers();
  const stalled = managedServiceHealth({ enabled: true, fetch: async () => new Promise<Response>(() => {}) }).read();
  await vi.advanceTimersByTimeAsync(3001);
  expect(await stalled).toMatchObject({ state: "unavailable" });
});
