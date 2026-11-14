import type { Db } from "@paperclipai/db";
import { describe, expect, it, vi } from "vitest";
import { nativeOpenCodeConformanceMemoryScopingPassed, waitForNativeOpenCodeConformanceWire } from "../native-opencode-conformance.js";
import { anthropicManagedMessagesCall } from "./read-only-model-transport.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("Native OpenCode conformance cancellation wire gate", () => {
  it("rejects memory-isolation proof when a peer or isolation turn did not complete", () => {
    const first = { sessionId: "primary-session" };
    const peerUnseen = { state: "completed" as const, output: "NONE", sessionId: "peer-session" };
    const peerWrite = { state: "completed" as const, output: "AW_PROBE_marker", sessionId: "peer-session" };
    const isolated = { state: "completed" as const, output: "AW_PROBE_marker", sessionId: "primary-session" };
    const proof = { first, peerUnseen, peerWrite, isolated, primaryProfileRef: "primary-profile", peerProfileRef: "peer-profile" };

    expect(nativeOpenCodeConformanceMemoryScopingPassed(proof)).toBe(true);
    expect(nativeOpenCodeConformanceMemoryScopingPassed({ ...proof, peerWrite: { ...peerWrite, state: "failed" } })).toBe(false);
    expect(nativeOpenCodeConformanceMemoryScopingPassed({ ...proof, isolated: { ...isolated, state: "cancelled" } })).toBe(false);
  });

  it("waits for the persisted exact POST receipt while the controlled provider response is held", async () => {
    const companyId = "10000000-0000-4000-8000-000000000001";
    const planId = "10000000-0000-4000-8000-000000000002";
    const idempotencyKey = "opencode-conformance:10000000-0000-4000-8000-000000000003:10000000-0000-4000-8000-000000000004:nonce";
    const reservationId = "10000000-0000-4000-8000-000000000005";
    const requestHash = "b".repeat(64);
    let ledger: Record<string, unknown> | null = { id: reservationId, planId, purpose: "provider_conformance",
      idempotencyKey, requestHash, status: "reserved", providerWireReceipt: null };
    const reservedObserved = deferred();
    const query: { from: (...args: unknown[]) => unknown; where: (...args: unknown[]) => unknown;
      limit: (...args: unknown[]) => Promise<Record<string, unknown>[]> } = {} as never;
    query.from = vi.fn(() => query);
    query.where = vi.fn(() => query);
    query.limit = vi.fn(async () => {
      if (ledger?.status === "reserved") reservedObserved.resolve();
      return ledger ? [ledger] : [];
    });
    const db = { select: vi.fn(() => query) } as unknown as Db;
    const signal = new AbortController().signal;
    const cancel = vi.fn();
    const fetchStarted = deferred();
    const releaseProviderResponse = deferred();
    let responseSettled = false;
    const fetch = vi.fn(async () => {
      fetchStarted.resolve();
      await releaseProviderResponse.promise;
      responseSettled = true;
      return new Response(JSON.stringify({ id: "msg-conformance-wire", type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn",
        content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    });
    const wireWait = waitForNativeOpenCodeConformanceWire({ db, companyId, planId, idempotencyKey, signal,
      streamEnded: () => false, delayMs: 0, pollMs: 1, cancel });
    let managedCall: Promise<unknown> | null = null;
    try {
      await reservedObserved.promise;
      expect(cancel).not.toHaveBeenCalled();
      managedCall = anthropicManagedMessagesCall({ model: "claude-test", max_tokens: 8, stream: true,
        messages: [{ role: "user", content: "synthetic conformance" }] },
      { model: "claude-test", maxOutputTokens: 8, maximumEnvelopeBytes: 4096, maximumInputTokens: 256 },
      "conformance-test-credential-012345", signal, {
        fetch: fetch as never,
        onWireDispatch: async wire => {
          expect(cancel).not.toHaveBeenCalled();
          ledger = { id: reservationId, planId, purpose: "provider_conformance", idempotencyKey, requestHash,
            status: "dispatched", providerWireReceipt: { version: 1, reservationId, requestHash,
              method: wire.method, endpoint: wire.endpoint, bodySha256: wire.bodySha256 } };
        },
      });
      await fetchStarted.promise;
      expect(await wireWait).toBe(true);
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(responseSettled).toBe(false);
      expect(fetch).toHaveBeenCalledOnce();
      releaseProviderResponse.resolve();
      await managedCall;
    } finally {
      releaseProviderResponse.resolve();
      await managedCall?.catch(() => undefined);
    }
  });
});
