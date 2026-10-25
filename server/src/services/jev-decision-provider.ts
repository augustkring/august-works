import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { experimental_decide as decide, type Experimental_DecisionModel } from "ai";
import { type JevDecisionAnswer, type JevDecisionRequest } from "@paperclipai/shared";

export interface JevDecisionReceipt {
  inputTokens: number | null; outputTokens: number | null; providerRequestId: string | null;
  costCents: string | null; costStatus: "reported" | "estimated" | "unpriced";
  pricingProvenance: { source: "provider_reported" | "unknown"; evidence?: string };
}
export interface JevDecisionOutcome { noProviderWork?: boolean; answers?: Record<string, JevDecisionAnswer>; errorCode?: string; receipt: JevDecisionReceipt }
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const tokenCount = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647 ? v : null;
function usdToCents(value: number) {
  const units = BigInt(Math.round(value * 1_000_000_000));
  const digits = units.toString().padStart(8, "0");
  return `${digits.slice(0, -7)}.${digits.slice(-7)}`;
}
function rejectedResponseData(error: unknown) {
  const value = record(error);
  if (value.data) return record(value.data);
  if (record(value.cause).value) return record(record(value.cause).value);
  // SDK schema rejection may retain only responseBody. Read a bounded body in
  // memory for accounting; never forward it to the ledger, logger, or caller.
  if (typeof value.responseBody === "string" && value.responseBody.length <= 1_000_000) {
    try { return record(JSON.parse(value.responseBody)); } catch { /* Not valid JSON. */ }
  }
  return {};
}
export function decisionReceipt(result: unknown): JevDecisionReceipt {
  const value = record(result), usage = record(value.usage), metadata = record(value.providerMetadata);
  const response = record(value.response);
  const headers = record(response.headers);
  const inputTokens = tokenCount(usage.inputTokens), outputTokens = tokenCount(usage.outputTokens);
  const reported = record(record(metadata.openrouter).usage).cost;
  const base = { inputTokens, outputTokens, providerRequestId: typeof response.id === "string" ? response.id.slice(0, 250) : typeof headers["x-request-id"] === "string" ? headers["x-request-id"].slice(0, 250) : null };
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return { ...base, costCents: usdToCents(reported), costStatus: "reported", pricingProvenance: { source: "provider_reported" } };
  }
  // V1 uses the official default endpoint and bounded short text requests. Decisions has its own rate, not the chat model's rate.
  return { ...base, costCents: null, costStatus: "unpriced", pricingProvenance: { source: "unknown" } };
}
export async function runJevDecision(input: {
  model: string; apiKey: string; request: JevDecisionRequest; signal: AbortSignal;
}, options: { fetch?: typeof fetch } = {}): Promise<JevDecisionOutcome> {
  const native = createOpenRouter({ apiKey: input.apiKey, fetch: options.fetch }).evaluationModel(input.model);
  let receipt = decisionReceipt(null);
  // Capture only accounting metadata before SDK answer validation/refusal errors.
  const model: Exclude<Experimental_DecisionModel, string> = {
    specificationVersion: "v4", provider: native.provider, modelId: native.modelId, supportedQuestionTypes: native.supportedQuestionTypes,
    async doDecide(args) {
      // OpenRouter's EvaluationModel implements the SDK's legacy evaluation
      // entry point; the decision adapter supplies the v4 doDecide wrapper.
      const response = await native.doEvaluate(args);
      receipt = decisionReceipt(response);
      return { ...response, warnings: [] };
    },
  };
  try {
    const result = await decide({ model, ...input.request, maxRetries: 0, abortSignal: input.signal,
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false } });
    const metadata = record(result.providerMetadata);
    const answers = Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => {
      const confidence = record(record(record(metadata.openrouter).answers)[id]).confidence;
      return [id, { ...answer, ...(typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? { confidence } : {}) }];
    }));
    return { answers, receipt };
  } catch (error) {
    // Never expose provider error messages/bodies; they may contain inputs or credentials.
    const name = error instanceof Error ? error.name : "";
    const status = record(error).statusCode;
    // SDKs can reject refusals or malformed answers before normalized usage.
    // Keep only validated accounting fields, even in this failure path.
    const data = rejectedResponseData(error);
    const rawUsage = record(data.usage);
    if (receipt.costStatus === "unpriced") {
      receipt = decisionReceipt({ usage: { inputTokens: rawUsage.input_tokens, outputTokens: rawUsage.output_tokens },
        providerMetadata: { openrouter: { usage: { cost: rawUsage.cost } } },
        response: { id: data.id, headers: record(error).responseHeaders } });
    }
    const rawAnswers = Array.isArray(data.answers) ? data.answers : Object.values(record(data.answers));
    const refused = name.includes("Refusal") || record(data.error).type === "refusal" || rawAnswers.some(answer => record(answer).type === "refusal");
    const errorCode = input.signal.aborted ? "timeout" : refused ? "refused"
      : status === 401 || status === 403 ? "provider_auth_failed" : status === 429 ? "provider_rate_limited" : "provider_failed";
    // An explicit authentication/validation rejection occurs before model work.
    // Server errors and network failures remain unresolved: their charge is unknown.
    const noProviderWork = receipt.costStatus === "unpriced" && [400, 401, 403, 404, 422, 429].includes(Number(status));
    if (noProviderWork) receipt = { ...receipt, inputTokens: 0, outputTokens: 0, costCents: "0.0000000", costStatus: "estimated",
      pricingProvenance: { source: "unknown", evidence: `Provider rejected request before model work (HTTP ${status})` } };
    return { errorCode, receipt, noProviderWork };
  }
}
