import type { LlmConfig } from "./config/schema.js";

export type LlmProviderCheck = "valid" | "invalid" | "unavailable";

/** Validate BYO credentials without making a billable inference request. */
export async function checkLlmProviderKey(
  provider: LlmConfig["provider"],
  apiKey: string,
  request: typeof fetch = fetch,
): Promise<LlmProviderCheck> {
  const endpoint = provider === "claude"
    ? "https://api.anthropic.com/v1/models?limit=1"
    : "https://api.openai.com/v1/models";
  let response: Response;
  try {
    response = await request(endpoint, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: provider === "claude"
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return "unavailable";
  }
  await response.body?.cancel().catch(() => {});
  if (response.ok) return "valid";
  if (response.status === 401 || response.status === 403) return "invalid";
  return "unavailable";
}
