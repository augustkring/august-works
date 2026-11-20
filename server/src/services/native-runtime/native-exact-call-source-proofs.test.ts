import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { nativePayloadSourceSetExactCallContext, nativeSourceGraphProofWorkProbeForTest,
  type NativeSourceGraphProofWorkProbe } from "../native-direct-input.js";
import { closeNativeExactCallSourceProofs, createNativeExactCallSourceProofStore, NATIVE_EXACT_CALL_SOURCE_PROOF_LIMIT,
  nativeExactCallSourceProofKey, readNativeExactCallSourceProof, recordNativeExactCallSourceProof } from "./native-exact-call-source-proofs.js";

// CONF15-W11. The same-Task Run 2 read after its first write walked identical
// source sets several times once a wake's ordinary plan read had turned graph
// proofs off for the rest of the call, and crossed the 2048-unit total-work
// bound. The bound stays. Inside one read call an identical validation (same
// source set, exact validation context and read scope) is validated once and a
// later use is not counted again. The memo never crosses calls and closes at
// the first effect boundary.

const company = "00000000-0000-4000-8000-0000000000c1";
const actor: AuthorizationActor = { type: "agent", source: "none", companyId: company,
  agentId: "00000000-0000-4000-8000-0000000000a1", runId: "00000000-0000-4000-8000-000000000101",
  onBehalfOfUserId: "00000000-0000-4000-8000-0000000000d1" };
const otherActor: AuthorizationActor = { ...actor, agentId: "00000000-0000-4000-8000-0000000000a2" };
const LIMIT_MESSAGE = "The Native source graph exceeds its total-work bound";

async function probe(run: (probe: NativeSourceGraphProofWorkProbe) => Promise<void>) {
  return (await nativeSourceGraphProofWorkProbeForTest({ companyId: company, actor, run })).work;
}

describe("CONF15-W11 exact call source proofs", () => {
  it("counts an identical validation once after graph proofs are off (regression)", async () => {
    const single = await probe(async call => {
      call.disableGraphProofs();
      await call.validate({ key: "set-a", units: 100 });
    });
    const twice = await probe(async call => {
      call.disableGraphProofs();
      await call.validate({ key: "set-a", units: 100 });
      await call.validate({ key: "set-a", units: 100 });
      await call.validate({ key: "set-a", units: 100 });
    });
    expect(single).toBe(101);
    expect(twice).toBe(single);
  });

  it("reuses an identical validation from another caller's proof map while graph proofs are on, without a charge", async () => {
    const work = await probe(async call => {
      await call.validate({ key: "set-a", units: 100, siblingProofs: new Map() });
      await call.validate({ key: "set-a", units: 100, siblingProofs: new Map() });
    });
    expect(work).toBe(101);
    // The existing same-map graph proof still charges its one unit.
    const sameMap = new Map();
    const graphProof = await probe(async call => {
      await call.validate({ key: "set-a", units: 100, siblingProofs: sameMap });
      await call.validate({ key: "set-a", units: 100, siblingProofs: sameMap });
    });
    expect(graphProof).toBe(102);
  });

  it("reuses a nested identical validation inside a distinct parent", async () => {
    const work = await probe(async call => {
      call.disableGraphProofs();
      await call.validate({ key: "retained-receipt", units: 400 });
      await call.validate({ key: "current-wake", units: 10, nested: () => call.validate({ key: "retained-receipt", units: 400 }) });
      await call.validate({ key: "dispatch", units: 10, nested: () => call.validate({ key: "retained-receipt", units: 400 }) });
    });
    // Each parent pays only for its own work; the reader set is already queued.
    expect(work).toBe(401 + 10 + 10);
  });

  it("still refuses a genuinely large distinct set at the bound", async () => {
    await expect(probe(async call => {
      call.disableGraphProofs();
      for (let index = 0; index < 21; index += 1) await call.validate({ key: `distinct-${index}`, units: 100 });
    })).rejects.toMatchObject({ status: 403, message: LIMIT_MESSAGE });
    // Repeating already-validated sets does not hide distinct ones from the bound.
    await expect(probe(async call => {
      call.disableGraphProofs();
      for (let index = 0; index < 21; index += 1) {
        await call.validate({ key: `distinct-${index}`, units: 100 });
        await call.validate({ key: `distinct-${index}`, units: 100 });
      }
    })).rejects.toMatchObject({ status: 403, message: LIMIT_MESSAGE });
    // A single distinct validation over the bound refuses too.
    await expect(probe(async call => call.validate({ key: "huge", units: 2049 })))
      .rejects.toMatchObject({ status: 403, message: LIMIT_MESSAGE });
  });

  it("never reuses a proof for a different context", async () => {
    const cover = { policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] };
    const otherCover = { ...cover, policy: { ...cover.policy, runIds: ["00000000-0000-4000-8000-000000000109"] } };
    const variants: Array<[string, Parameters<NativeSourceGraphProofWorkProbe["validate"]>[0]]> = [
      ["depth hint", { key: "set-a", units: 100, depthHint: 2 }],
      ["validated dispatch sources", { key: "set-a", units: 100, validatedDispatchSources: new Set(["marker-a"]) }],
      ["consumer cover", { key: "set-a", units: 100, consumerCover: otherCover }],
      ["reader scope (actor)", { key: "set-a", units: 100, actor: otherActor }],
      ["source key", { key: "set-b", units: 100 }],
    ];
    for (const [, variant] of variants) {
      const work = await probe(async call => {
        call.disableGraphProofs();
        await call.validate({ key: "set-a", units: 100, consumerCover: variant.consumerCover ? cover : undefined,
          validatedDispatchSources: variant.validatedDispatchSources ? new Set(["marker-b"]) : undefined });
        await call.validate(variant);
      });
      expect(work).toBeGreaterThanOrEqual(200);
    }
    // The same context in another order of the dispatch-source set is the same context.
    const reordered = await probe(async call => {
      call.disableGraphProofs();
      await call.validate({ key: "set-a", units: 100, validatedDispatchSources: new Set(["b", "a"]) });
      await call.validate({ key: "set-a", units: 100, validatedDispatchSources: new Set(["a", "b"]) });
    });
    expect(reordered).toBe(101);
  });

  it("does not leak across calls", async () => {
    const first = await probe(async call => { call.disableGraphProofs(); await call.validate({ key: "set-a", units: 100 }); });
    const second = await probe(async call => { call.disableGraphProofs(); await call.validate({ key: "set-a", units: 100 }); });
    expect(first).toBe(101);
    expect(second).toBe(101);
  });

  it("closes at an effect boundary and never records a validation that spans one", async () => {
    const after = await probe(async call => {
      await call.validate({ key: "set-a", units: 100 });
      await call.effectBoundary();
      await call.validate({ key: "set-a", units: 100 });
    });
    expect(after).toBe(201);
    const spanning = await probe(async call => {
      await call.validate({ key: "set-a", units: 100, nested: () => call.effectBoundary() });
      await call.validate({ key: "set-a", units: 100 });
    });
    expect(spanning).toBe(201);
  });

  it("retires the per-operation read memo at the same effect boundary (MS1f stop 8)", async () => {
    let observed: boolean[] = [];
    await probe(async call => {
      observed.push(call.operationMemoOpen());
      await call.validate({ key: "set-a", units: 10 });
      observed.push(call.operationMemoOpen());
      await call.effectBoundary();
      observed.push(call.operationMemoOpen());
      await call.validate({ key: "set-b", units: 10 });
      observed.push(call.operationMemoOpen());
    });
    expect(observed).toEqual([true, true, false, false]);
    // The next operation starts open again.
    observed = [];
    await probe(async call => { observed.push(call.operationMemoOpen()); });
    expect(observed).toEqual([true]);
  });

  it("does not memoize ineligible or incompatible validations", async () => {
    const project = [{ kind: "project", projectId: "00000000-0000-4000-8000-0000000000f1" }] as unknown as NativePayloadSourceInput[];
    const ineligible = await probe(async call => {
      await call.validate({ key: "set-p", units: 100, inputs: project });
      await call.validate({ key: "set-p", units: 100, inputs: project });
    });
    expect(ineligible).toBeGreaterThanOrEqual(200);
    const incompatible = await probe(async call => {
      await call.validate({ key: "set-a", units: 100, nested: async () => call.markProofsIncompatible() });
      await call.validate({ key: "set-a", units: 100 });
    });
    expect(incompatible).toBeGreaterThanOrEqual(200);
  });

  it("does not memoize a proof owner that passes no exact context", async () => {
    const work = await probe(async call => {
      call.disableGraphProofs();
      await call.validate({ key: "owner", units: 100, exactContext: false });
      await call.validate({ key: "owner", units: 100, exactContext: false });
    });
    expect(work).toBe(201);
  });

  it("schedules the current reader checks again on a reuse", async () => {
    await probe(async call => {
      call.disableGraphProofs();
      await call.validate({ key: "set-a", units: 10 });
      expect(call.takePendingReaderGroups()).toBe(1);
      await call.validate({ key: "set-a", units: 10 });
      expect(call.takePendingReaderGroups()).toBe(1);
    });
  });

  it("gives the parent of a reuse the reused proof's readers, descendants and mutable rows", async () => {
    await probe(async call => {
      call.disableGraphProofs();
      const child = { key: "c", units: 1, mutableRunRow: { id: "00000000-0000-4000-8000-000000000201", status: "succeeded" } };
      const reused = { key: "a", units: 1, nested: () => call.validate(child) };
      await call.validate(reused);
      await call.validate({ key: "p", units: 1, nested: () => call.validate(reused) });
      expect(call.exactProof({ key: "p", units: 1 })).toEqual({ readerSets: 3,
        mutableRows: [`run:${company}:00000000-0000-4000-8000-000000000201`], descendants: ["a", "c"] });
    });
  });

  it("walks again (and finds the cycle) when a proof's descendants are active", async () => {
    // x's proof has z as a descendant. Reached again while z (at another depth
    // hint, so not itself a memo hit) is active, x is walked and the cycle found.
    await expect(probe(async call => {
      call.disableGraphProofs();
      await call.validate({ key: "x", units: 1, nested: () => call.validate({ key: "z", units: 1 }) });
      await call.validate({ key: "z", units: 1, depthHint: 1, nested: () =>
        call.validate({ key: "x", units: 1, nested: () => call.validate({ key: "z", units: 1 }) }) });
    })).rejects.toMatchObject({ status: 403, message: "The Native source graph contains a cycle" });
  });
});

describe("CONF15-W11 exact call source proof store", () => {
  const proof = { descendants: new Set(["child"]), mutableSources: { compatible: true } };
  it("keys a proof by its source key, depth hint and exact context", () => {
    const base = nativeExactCallSourceProofKey("k", 0, { a: 1 });
    expect(nativeExactCallSourceProofKey("k", 0, { a: 1 })).toBe(base);
    expect(nativeExactCallSourceProofKey("k2", 0, { a: 1 })).not.toBe(base);
    expect(nativeExactCallSourceProofKey("k", 1, { a: 1 })).not.toBe(base);
    expect(nativeExactCallSourceProofKey("k", 0, { a: 2 })).not.toBe(base);
  });
  it("isolates owners, refuses after close and bounds each owner", () => {
    const store = createNativeExactCallSourceProofStore<{ compatible: boolean }, never>();
    const owner = {}, other = {};
    expect(recordNativeExactCallSourceProof(store, owner, "k", proof)).toBe(true);
    expect(readNativeExactCallSourceProof(store, owner, "k")).toBe(proof);
    expect(readNativeExactCallSourceProof(store, other, "k")).toBeUndefined();
    for (let index = 1; index < NATIVE_EXACT_CALL_SOURCE_PROOF_LIMIT; index += 1)
      expect(recordNativeExactCallSourceProof(store, owner, `k${index}`, proof)).toBe(true);
    expect(recordNativeExactCallSourceProof(store, owner, "one-too-many", proof)).toBe(false);
    expect(recordNativeExactCallSourceProof(store, owner, "k", proof)).toBe(true);
    expect(recordNativeExactCallSourceProof(store, other, "one-too-many", proof)).toBe(true);
    closeNativeExactCallSourceProofs(store);
    expect(readNativeExactCallSourceProof(store, owner, "k")).toBeUndefined();
    expect(recordNativeExactCallSourceProof(store, owner, "k", proof)).toBe(false);
    expect(readNativeExactCallSourceProof(store, owner, "k")).toBeUndefined();
  });
  it("wires the payload source-set validator, and only it, to the exact context", () => {
    const source = readFileSync(fileURLToPath(new URL("../native-direct-input.ts", import.meta.url)), "utf8");
    expect(source.match(/historicalDocumentDepthHint, true, nativePayloadSourceSetExactCallContext\(\{ validatedDispatchSources, consumerCover \}\)\);/g))
      .toHaveLength(1);
    const setValidator = source.slice(source.indexOf("async function assertNativePayloadSourceSetCurrentInScope("),
      source.indexOf("export function nativePayloadSourceSetExactCallContext("));
    expect(setValidator).toContain("nativePayloadSourceSetExactCallContext({ validatedDispatchSources, consumerCover })");
  });
  it("includes every outcome-changing set input in the payload source-set context", () => {
    const base = nativePayloadSourceSetExactCallContext({});
    expect(base).toEqual({ kind: "payload-source-set", requireReceiptMembership: true, validatedDispatchSources: null, consumerCover: null });
    expect(nativePayloadSourceSetExactCallContext({ validatedDispatchSources: new Set(["b", "a"]) }).validatedDispatchSources)
      .toEqual(["a", "b"]);
    const cover = { policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] };
    expect(nativePayloadSourceSetExactCallContext({ consumerCover: cover }).consumerCover).toBe(cover);
  });
});
