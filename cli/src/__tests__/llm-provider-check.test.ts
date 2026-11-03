import { describe, expect, it } from "vitest";
import { checkLlmProviderKey } from "../llm-provider-check.js";

describe("BYO LLM credential check", () => {
  it("uses the non-inference Anthropic model inventory endpoint", async () => {
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const request: typeof fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    };
    await expect(checkLlmProviderKey("claude", "secret", request)).resolves.toBe("valid");
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: {
      "x-api-key": "secret", "anthropic-version": "2023-06-01",
    } });
    expect(init).not.toHaveProperty("body");
  });

  it.each([[401, "invalid"], [403, "invalid"], [429, "unavailable"], [503, "unavailable"], [200, "valid"]] as const)(
    "maps provider status %i without sending inference",
    async (status, expected) => {
      let calls = 0;
      const request: typeof fetch = async () => {
        calls++;
        return new Response("", { status });
      };
      await expect(checkLlmProviderKey("claude", "secret", request)).resolves.toBe(expected);
      expect(calls).toBe(1);
    },
  );

  it("does not follow redirects or retry transport failures", async () => {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls++;
      throw new Error("network failure");
    };
    await expect(checkLlmProviderKey("claude", "secret", request)).resolves.toBe("unavailable");
    expect(calls).toBe(1);
  });
});
