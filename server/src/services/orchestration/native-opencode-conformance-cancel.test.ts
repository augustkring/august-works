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

// CONF15-P7. The reservation ledger persists a dispatch in two steps:
// `claimForDispatch` sets `dispatched`, then `recordWireDispatch` retains the
// exact receipt. Probe 6 polled between them, read a claimed row with no
// receipt as "not an exact wire", and never requested its cancel.
describe("CONF15-P7 cancellation wire gate across the two-step dispatch", () => {
  const companyId = "10000000-0000-4000-8000-000000000001";
  const planId = "10000000-0000-4000-8000-000000000002";
  const idempotencyKey = "opencode-conformance:10000000-0000-4000-8000-000000000003:10000000-0000-4000-8000-000000000004:nonce";
  const reservationId = "10000000-0000-4000-8000-000000000005";
  const requestHash = "b".repeat(64);
  const row = (status: string, providerWireReceipt: unknown = null) => ({ id: reservationId, planId,
    purpose: "provider_conformance", idempotencyKey, requestHash, status, providerWireReceipt });
  const receipt = (overrides: Record<string, unknown> = {}) => ({ version: 1, reservationId, requestHash, method: "POST",
    endpoint: "https://api.anthropic.com/v1/messages", bodySha256: "c".repeat(64), ...overrides });
  // The ledger shows each scripted row for `polls` reads, then the next; the last one stays.
  function scriptedLedger(script: Array<{ row: Record<string, unknown> | null; polls?: number }>) {
    let reads = 0;
    const query: { from: (...args: unknown[]) => unknown; where: (...args: unknown[]) => unknown;
      limit: (...args: unknown[]) => Promise<Record<string, unknown>[]> } = {} as never;
    query.from = () => query;
    query.where = () => query;
    query.limit = async () => {
      reads += 1;
      let seen = 0;
      for (const step of script) {
        seen += step.polls ?? Infinity;
        if (reads <= seen) return step.row ? [step.row] : [];
      }
      const last = script.at(-1)!.row;
      return last ? [last] : [];
    };
    return { db: { select: () => query } as unknown as Db, reads: () => reads };
  }
  // Ends the stream only after many polls, so a `false` before that means the
  // gate gave up by itself while the turn was still open.
  async function waitOn(script: Parameters<typeof scriptedLedger>[0], options: { signal?: AbortSignal; streamEndsAfter?: number } = {}) {
    const ledger = scriptedLedger(script);
    const cancel = vi.fn();
    const streamEndsAfter = options.streamEndsAfter ?? 200;
    const result = await waitForNativeOpenCodeConformanceWire({ db: ledger.db, companyId, planId, idempotencyKey,
      signal: options.signal ?? new AbortController().signal, streamEnded: () => ledger.reads() >= streamEndsAfter,
      delayMs: 0, pollMs: 0, cancel });
    await new Promise(resolve => setTimeout(resolve, 5));
    return { result, cancel, reads: ledger.reads(), streamEnded: ledger.reads() >= streamEndsAfter };
  }

  it("keeps waiting through the claimed row without a receipt and cancels after the exact receipt (regression)", async () => {
    const waited = await waitOn([{ row: null, polls: 2 }, { row: row("reserved"), polls: 3 }, { row: row("dispatched"), polls: 5 },
      { row: row("dispatched", receipt()) }]);
    expect(waited).toMatchObject({ result: true, reads: 11, streamEnded: false });
    expect(waited.cancel).toHaveBeenCalledOnce();
    // A dispatch whose outcome became unknown after its exact receipt still cancels.
    expect((await waitOn([{ row: row("dispatched"), polls: 2 }, { row: row("unknown", receipt()) }])).result).toBe(true);
  });

  it("never cancels on a receipt that is not the exact dispatched POST", async () => {
    for (const wrong of [receipt({ version: 2 }), receipt({ reservationId: "10000000-0000-4000-8000-000000000009" }),
      receipt({ requestHash: "d".repeat(64) }), receipt({ method: "GET" }),
      receipt({ endpoint: "https://api.anthropic.com/v1/other" }), receipt({ bodySha256: "not-a-digest" })]) {
      const waited = await waitOn([{ row: row("dispatched"), polls: 3 }, { row: row("dispatched", wrong) }]);
      expect(waited).toMatchObject({ result: false, streamEnded: false });
      expect(waited.cancel).not.toHaveBeenCalled();
    }
  });

  it("gives up without a cancel when a claimed dispatch settles without a receipt or after it completed", async () => {
    for (const settled of [row("unknown"), row("failed"), row("cancelled"), row("completed"),
      row("completed", receipt()), row("failed", receipt()), row("cancelled", receipt()), row("reserved", receipt())]) {
      const waited = await waitOn([{ row: row("dispatched"), polls: 3 }, { row: settled }]);
      expect(waited).toMatchObject({ result: false, streamEnded: false });
      expect(waited.reads).toBeLessThan(10);
      expect(waited.cancel).not.toHaveBeenCalled();
    }
  });

  it("stops waiting on a claimed row when the turn stream ends or the probe signal aborts", async () => {
    const ended = await waitOn([{ row: row("dispatched") }], { streamEndsAfter: 4 });
    expect(ended).toMatchObject({ result: false, streamEnded: true });
    expect(ended.cancel).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    const aborted = await waitOn([{ row: row("dispatched") }], { signal: controller.signal });
    expect(aborted).toMatchObject({ result: false, reads: 0 });
    expect(aborted.cancel).not.toHaveBeenCalled();
  });
});
