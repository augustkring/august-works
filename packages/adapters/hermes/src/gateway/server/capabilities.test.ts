import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCapabilities } from "./capabilities.js";

afterEach(() => vi.unstubAllGlobals());
const ctx = { companyId: "company", adapterType: "hermes_gateway", config: { apiBaseUrl: "http://127.0.0.1:8642", apiKey: "credential" } };
describe("Hermes deterministic capabilities", () => {
  it("reads only advertised inventories with protected, bounded requests", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer credential" } });
      const data = String(input).endsWith("/v1/capabilities")
        ? { version: "0.16", features: { sessions: true, skillsDiscovery: true, toolDiscovery: true } }
        : String(input).endsWith("/v1/skills") ? { skills: [{ id: "research", name: "Research" }] } : { tools: [{ id: "search", name: "Search" }] };
      return new Response(JSON.stringify(data));
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await discoverCapabilities(ctx)).toMatchObject({ provider: "hermes", version: "0.16", features: { sessions: true, cancellation: false, memoryScoping: false }, skills: [{ id: "research" }], tools: [{ id: "search" }] });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("fails closed on unsafe transport, unavailable metadata, malformed booleans and oversized responses", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(discoverCapabilities({ ...ctx, config: { ...ctx.config, apiBaseUrl: "http://remote.example" } })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(discoverCapabilities(ctx)).rejects.toThrow("404");
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ version: "1", features: { memoryScoping: "true" } })));
    await expect(discoverCapabilities(ctx)).rejects.toThrow("feature");
    fetcher.mockImplementation(async () => new Response(" ".repeat(1024 * 1024 + 1)));
    await expect(discoverCapabilities(ctx)).rejects.toThrow("limit");
  });
});
