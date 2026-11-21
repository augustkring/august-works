import { nativeSha256 } from "./canonical.js";

/**
 * CONF15-W11. Exact source validations completed inside ONE Native source read
 * call (one read ancestry, the owner of its total-work counter).
 *
 * The Native source graph keeps its total-work bound (2048 units). Inside one
 * call, an identical validation (the same source set and the exact same
 * validation context, in the same read scope) is validated once; a later use
 * reuses that completed proof and is not counted again. Distinct validations
 * are still counted and still refuse at the bound.
 *
 * Lifetime: the store is created with its read ancestry and is never shared,
 * so a proof cannot cross calls, Runs, transactions or companies. Proofs are
 * owned by the exact read scope object (its context, actor and database
 * handle), so another actor or reader context in the same ancestry never reads
 * them. The first effect boundary closes the store for the rest of the call:
 * nothing recorded before it is read after it, and nothing is recorded after it.
 */
export const NATIVE_EXACT_CALL_SOURCE_PROOF_LIMIT = 512;

export interface NativeExactCallSourceProof<TMutable, TReaders> {
  readonly descendants: ReadonlySet<string>;
  readonly mutableSources: TMutable;
  readonly readerSets?: TReaders;
}

export interface NativeExactCallSourceProofStore<TMutable = unknown, TReaders = unknown> {
  closed: boolean;
  readonly byOwner: Map<object, Map<string, NativeExactCallSourceProof<TMutable, TReaders>>>;
}

export function createNativeExactCallSourceProofStore<TMutable, TReaders>(): NativeExactCallSourceProofStore<TMutable, TReaders> {
  return { closed: false, byOwner: new Map() };
}

/** The exact identity of one validation: its source key, its document depth
 * hint, and every remaining input that can change its outcome. */
export function nativeExactCallSourceProofKey(sourceKey: string, depthHint: number, context: unknown): string {
  return nativeSha256({ phase: "native-exact-call-source-proof", sourceKey, depthHint, context: context ?? null });
}

/** Close the store at an effect boundary. It stays closed for this call. */
export function closeNativeExactCallSourceProofs(store: NativeExactCallSourceProofStore<unknown, unknown>): void {
  store.closed = true;
  store.byOwner.clear();
}

export function readNativeExactCallSourceProof<TMutable, TReaders>(store: NativeExactCallSourceProofStore<TMutable, TReaders>,
  owner: object, key: string): NativeExactCallSourceProof<TMutable, TReaders> | undefined {
  if (store.closed) return undefined;
  return store.byOwner.get(owner)?.get(key);
}

/** Record a completed validation. Refused once the store is closed (so a
 * validation that spans an effect boundary is never recorded) or past the
 * per-owner bound (the next identical use then validates again). */
export function recordNativeExactCallSourceProof<TMutable, TReaders>(store: NativeExactCallSourceProofStore<TMutable, TReaders>,
  owner: object, key: string, proof: NativeExactCallSourceProof<TMutable, TReaders>): boolean {
  if (store.closed) return false;
  let proofs = store.byOwner.get(owner);
  if (!proofs) {
    proofs = new Map();
    store.byOwner.set(owner, proofs);
  }
  if (!proofs.has(key) && proofs.size >= NATIVE_EXACT_CALL_SOURCE_PROOF_LIMIT) return false;
  proofs.set(key, proof);
  return true;
}
