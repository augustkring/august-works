import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { configuredSupportCaseGateway } from "./support-case-http-gateway.js";

const policy = {
  schemaVersion: 1, policyVersion: "support-fixture", recipientName: "Fixture support",
  privacyNoticeUrl: "https://support.example.test/privacy", processingRegion: "eu",
  retentionTrigger: "after_last_customer_or_support_message", retentionDays: 30,
  backupMaxDays: 7, restoreLagDays: 1, deletionMarkerDays: 30, legalHoldPolicyId: "support-fixture",
};
const config = {
  AW_SUPPORT_CASE_GATEWAY_ENABLED: "true", AW_SUPPORT_CASE_GATEWAY_PROVIDER_KEY: "fixture-relay",
  AW_SUPPORT_CASE_GATEWAY_URL: "https://support.example.test/intake",
  AW_SUPPORT_CASE_GATEWAY_TOKEN: "fixture-credential-private-canary",
  AW_SUPPORT_CASE_DATA_POLICY_JSON: JSON.stringify(policy),
};
const message = () => ({
  companyId: randomUUID(), caseId: randomUUID(), eventId: randomUUID(), attemptId: randomUUID(),
  category: "other" as const, subject: "Customer-approved subject", kind: "request" as const,
  body: "Customer-approved message", customerStatus: "RECEIVED" as const,
  safeContext: null, createdAt: new Date().toISOString(),
});

describe("explicit support HTTP relay", () => {
  it("stays disabled without opt-in and rejects incomplete or unsafe configured destinations", () => {
    expect(configuredSupportCaseGateway({})).toBeNull();
    expect(configuredSupportCaseGateway({ ...config, AW_SUPPORT_CASE_GATEWAY_ENABLED: "false" })).toBeNull();
    for (const patch of [
      { AW_SUPPORT_CASE_GATEWAY_ENABLED: "yes" }, { AW_SUPPORT_CASE_GATEWAY_TOKEN: "" },
      { AW_SUPPORT_CASE_GATEWAY_TOKEN: "private\r\nheader-canary" },
      { AW_SUPPORT_CASE_GATEWAY_PROVIDER_KEY: "" }, { AW_SUPPORT_CASE_DATA_POLICY_JSON: undefined },
      ...["http://support.example.test/", "https://user:secret@support.example.test/", "https://support.example.test/?token=private",
        "https://support.example.test/#fragment", " https://support.example.test/"].map(AW_SUPPORT_CASE_GATEWAY_URL => ({ AW_SUPPORT_CASE_GATEWAY_URL })),
    ]) expect(() => configuredSupportCaseGateway({ ...config, ...patch })).toThrow("Invalid support case gateway configuration");
    expect(() => configuredSupportCaseGateway({ ...config, AW_SUPPORT_CASE_DATA_POLICY_JSON: "private invalid JSON" }))
      .toThrow("Invalid support case data policy configuration");
  });

  it("uses one fixed destination, no redirects, the native event key and the supplied abort signal", async () => {
    const input = message(), signal = new AbortController().signal;
    const ack = { eventId: input.eventId, attemptId: input.attemptId, providerMessageRef: "fixture-message" };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(ack, { status: 201 }));
    const configured = configuredSupportCaseGateway(config, transport)!;
    expect(configured.dataPolicy).toEqual(policy);
    expect(await configured.gateway.send(input, signal)).toEqual(ack);
    expect(transport).toHaveBeenCalledExactlyOnceWith(config.AW_SUPPORT_CASE_GATEWAY_URL, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${config.AW_SUPPORT_CASE_GATEWAY_TOKEN}`, "content-type": "application/json",
        accept: "application/json", "idempotency-key": input.eventId },
      body: JSON.stringify({ schema: "blentera.support-case-message.v1", ...input }),
    });
  });

  it("rejects missing, malformed, oversized and failed acknowledgements without leaking provider diagnostics", async () => {
    const input = message(), ack = { eventId: input.eventId, attemptId: input.attemptId, providerMessageRef: "fixture-message" };
    const responses = [new Response(null, { status: 202 }), new Response("private provider failure", { status: 500 }),
      new Response("not JSON"), Response.json({ ...ack, privateNote: "never expose this" }),
      Response.json({ ...ack, providerMessageRef: "invalid\nreference" }), new Response(" ".repeat(16385))];
    for (const response of responses) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(configuredSupportCaseGateway(config, transport)!.gateway.send(input, new AbortController().signal))
        .rejects.toThrow(/^Support case gateway acknowledgement unavailable$/);
    }
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error(config.AW_SUPPORT_CASE_GATEWAY_TOKEN));
    await expect(configuredSupportCaseGateway(config, transport)!.gateway.send(input, new AbortController().signal))
      .rejects.toThrow(/^Support case gateway acknowledgement unavailable$/);
  });
});
