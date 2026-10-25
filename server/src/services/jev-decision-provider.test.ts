import { describe, expect, it, vi } from "vitest";
import { JEV_DECISION_MODEL, type JevDecisionRequest } from "@paperclipai/shared";
import { runJevDecision } from "./jev-decision-provider.js";

const request: JevDecisionRequest = {
  state: { intent: "review company capability suggestions", candidates: [{ id: "skill:review", version: "v1" }, { id: "skill:budget", version: "v2" }] },
  questions: { skill: { type: "choice", instructions: "Select the candidate most relevant to the stated task or abstain.", criteria: { "skill:review": "Review evidence", "skill:budget": "Manage budgets", none: "No suitable candidate" } } },
};
const response = { id: "decision-fixture", model: JEV_DECISION_MODEL, usage: { input_tokens: 123, output_tokens: 0, cost: 0.000005166 }, answers: {
  skill: { type: "choice", choice: "skill:review", confidence: 0.85, probabilities: { "skill:review": 0.9, "skill:budget": 0.05, none: 0.05 } },
} };

describe("optional Jev Decisions provider seam", () => {
  it("pins the OpenRouter alpha Decisions route and keeps the answer in memory", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    const result = await runJevDecision({ model: JEV_DECISION_MODEL, apiKey: "selected-connection-key", request, signal: new AbortController().signal }, { fetch: transport });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer selected-connection-key");
    expect(JSON.parse(String(options?.body)).model).toBe(JEV_DECISION_MODEL);
    expect(result.answers?.skill).toMatchObject({ type: "choice", choice: "skill:review", confidence: 0.85 });
    expect(result.receipt).toMatchObject({ costStatus: "reported", costAmount: "0.0005166", inputTokens: 123 });
  });

  it("does not retry, expose provider response text, or interpret invented candidates", async () => {
    const bad = { ...response, answers: { skill: { ...response.answers.skill, choice: "skill:invented" } } };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(bad));
    const result = await runJevDecision({ model: JEV_DECISION_MODEL, apiKey: "key", request, signal: new AbortController().signal }, { fetch: transport });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.answers).toBeUndefined();
    expect(result.receipt.costStatus).toBe("reported");
    const failure = await runJevDecision({ model: JEV_DECISION_MODEL, apiKey: "key", request, signal: new AbortController().signal }, {
      fetch: async () => Response.json({ error: { type: "server_error", message: "private prompt and key" } }, { status: 500 }),
    });
    expect(JSON.stringify(failure)).not.toContain("private prompt");
    expect(failure.receipt.costStatus).toBe("unpriced");
  });
});
