import { describe, expect, it, vi } from "vitest";
import { classifyRisk } from "../services/tool-access.js";
import { COGNEE_STDIO_TEMPLATE, cogneeCloudUrl, callCogneeCloud } from "../services/cognee-connection.js";

describe("memory tool governance", () => {
  it.each([
    ["mem0", "add_memory", "write"], ["mem0", "search_memories", "read"],
    ["mem0", "delete_entities", "destructive"], ["zep", "add_memory_to_graph", "write"],
    ["supermemory", "add_memory", "destructive"], ["supermemory", "select-space", "write"],
    ["supermemory", "get_profile", "read"], ["cognee", "remember", "write"],
    ["cognee", "recall", "read"], ["cognee", "forget", "destructive"],
    ["honcho", "create_peer", "write"], ["honcho", "future_unknown_action", "write"],
  ])("classifies %s %s even with a misleading read hint", (provider, name, expected) => {
    expect(classifyRisk({ name, annotations: { readOnlyHint: true } }, provider)).toBe(expected);
  });
  it("keeps the approved Cognee bridge free of runtime package resolution", () => {
    expect(COGNEE_STDIO_TEMPLATE.command).toBeNull();
    expect(COGNEE_STDIO_TEMPLATE.args).toEqual([]);
    expect(COGNEE_STDIO_TEMPLATE.envKeys).toEqual(["COGNEE_BASE_URL", "COGNEE_API_KEY"]);
    expect(COGNEE_STDIO_TEMPLATE.tools.map(t => t.name)).toEqual(["remember", "recall", "forget"]);
  });
  it.each(["http://localhost", "https://evil.test", "https://tenant.aws.cognee.ai@evil.test", "https://tenant.aws.cognee.ai/other", "https://tenant.aws.cognee.ai?key=secret", "https://tenant.aws.cognee.ai:8443"])("rejects unreviewed Cognee URL %s", (url) => {
    expect(() => cogneeCloudUrl(url)).toThrow();
  });
  it("accepts the tenant API origin", () => expect(cogneeCloudUrl("https://tenant.aws.cognee.ai").origin).toBe("https://tenant.aws.cognee.ai"));
  it.each([
    ["remember", { data: "synthetic", dataset_name: "fixture" }],
    ["remember", { data: "synthetic", session_id: "session" }],
    ["recall", { query: "find", datasets: "one,two", search_type: "chunks" }],
    ["recall", { query: "find" }],
  ])("refuses unqualified model-capable %s before provider HTTP", async (tool, parameters) => {
    const request = vi.fn();
    await expect(callCogneeCloud({ baseUrl: "https://fixture.aws.cognee.ai", apiKey: "fixture", tool,
      parameters, request, signal: AbortSignal.timeout(1000) })).rejects.toMatchObject({ code: "configuration_incomplete" });
    expect(request).not.toHaveBeenCalled();
  });
  it("requires an explicit delete target and never falls back after a provider failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Cloud unavailable"));
    const input = { baseUrl: "https://fixture.aws.cognee.ai", apiKey: "key", tool: "forget", parameters: {}, request, signal: AbortSignal.timeout(1000) };
    await expect(callCogneeCloud(input)).rejects.toThrow("Specify a dataset");
    expect(request).not.toHaveBeenCalled();
    await expect(callCogneeCloud({ ...input, parameters: { dataset: "fixture" } })).rejects.toThrow("Cloud unavailable");
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({ dataset: "fixture", everything: false });
  });
});
