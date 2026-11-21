import { readSupportCaseDataPolicy } from "./support-case-configuration.js";
import { supportCaseGatewayAcknowledgementSchema, type SupportCaseGateway } from "./support-case-delivery.js";

/** Explicit operator-owned relay, disabled by default. The native delivery
 * owner validates authority and exact attempt identity; HTTP success alone
 * does not establish a delivered customer receipt. */
export function configuredSupportCaseGateway(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch,
) {
  const enabled = env.AW_SUPPORT_CASE_GATEWAY_ENABLED;
  if (enabled === undefined || enabled === "false") return null;
  const invalid = () => new Error("Invalid support case gateway configuration");
  if (enabled !== "true") throw invalid();
  const providerKey = env.AW_SUPPORT_CASE_GATEWAY_PROVIDER_KEY ?? "";
  const endpoint = env.AW_SUPPORT_CASE_GATEWAY_URL ?? "";
  const token = env.AW_SUPPORT_CASE_GATEWAY_TOKEN ?? "";
  let target: URL;
  try { target = new URL(endpoint); } catch { throw invalid(); }
  if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(providerKey) ||
    !/^[\x21-\x7e]{16,4096}$/.test(token) ||
    target.protocol !== "https:" || target.username || target.password || target.search || target.hash ||
    /[\s\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(endpoint)) throw invalid();
  const dataPolicy = readSupportCaseDataPolicy(env);
  if (!dataPolicy) throw invalid();
  const gateway: SupportCaseGateway = {
    providerKey,
    async send(message, signal) {
      try {
        const response = await fetchImpl(target.href, {
          method: "POST", redirect: "error", signal,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
            accept: "application/json", "idempotency-key": message.eventId },
          body: JSON.stringify({ schema: "blentera.support-case-message.v1", ...message }),
        });
        if (![200, 201].includes(response.status)) {
          await response.body?.cancel();
          throw Error();
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 16384) throw Error();
            chunks.push(part.value);
          }
          return supportCaseGatewayAcknowledgementSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch {
        // Never surface credentials, customer content or provider diagnostics.
        throw Error("Support case gateway acknowledgement unavailable");
      }
    },
  };
  return { gateway, dataPolicy };
}
