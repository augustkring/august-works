import type { PaperclipConfig } from "../config/schema.js";
import type { CheckResult } from "./index.js";
import { checkLlmProviderKey } from "../llm-provider-check.js";

export async function llmCheck(config: PaperclipConfig): Promise<CheckResult> {
  if (!config.llm) {
    return {
      name: "LLM provider",
      status: "pass",
      message: "No LLM provider configured (optional)",
    };
  }

  if (!config.llm.apiKey) {
    return {
      name: "LLM provider",
      status: "pass",
      message: `${config.llm.provider} configured but no API key set (optional)`,
    };
  }

  const result = await checkLlmProviderKey(config.llm.provider, config.llm.apiKey);
  if (result === "valid") {
    return {
      name: "LLM provider",
      status: "pass",
      message: `${config.llm.provider === "claude" ? "Claude" : "OpenAI"} API key is valid`,
    };
  }
  if (result === "invalid") {
    return {
      name: "LLM provider",
      status: "fail",
      message: `${config.llm.provider === "claude" ? "Claude" : "OpenAI"} API key is invalid (401/403)`,
      canRepair: false,
      repairHint: "Run `blentera configure --section llm`",
    };
  }
  {
    return {
      name: "LLM provider",
      status: "warn",
      message: "Could not verify the provider account",
    };
  }
}
