/**
 * MS1f stop 8. A memo for deterministic reads inside ONE Native source
 * validation operation on ONE transaction. It is never a cross-request cache:
 *
 * - The outermost Native source read scope opens it for its own transaction
 *   object and closes it when that scope ends.
 * - The first effect boundary in the operation closes it for the rest of the
 *   operation, exactly as graph checkpoints are retired; reads after a
 *   same-transaction write always run again.
 * - A rejected read is never retained, so a refusal is always recomputed.
 *
 * Callers memoize only reads whose rows are share-locked in this transaction
 * (or that are pure functions of their inputs), keyed by every input that the
 * uncached read depends on.
 */
type NativeSourceOperationMemo = { open: boolean; suspended: number; entries: Map<string, Promise<unknown>> };

const operationMemos = new WeakMap<object, NativeSourceOperationMemo>();
const NATIVE_SOURCE_OPERATION_MEMO_BOUND = 4096;

/** Opens the memo for this transaction unless an outer operation already did.
 * Returns the close function for the opener (a no-op for a nested caller). */
export function openNativeSourceOperationMemo(db: object): () => void {
  if (operationMemos.has(db)) return () => {};
  const memo: NativeSourceOperationMemo = { open: true, suspended: 0, entries: new Map() };
  operationMemos.set(db, memo);
  return () => {
    memo.open = false;
    memo.entries.clear();
    if (operationMemos.get(db) === memo) operationMemos.delete(db);
  };
}

/** An effect boundary in this operation: nothing memoized before it is reused,
 * and nothing is memoized after it. */
export function retireNativeSourceOperationMemo(db: object): void {
  const memo = operationMemos.get(db);
  if (!memo) return;
  memo.open = false;
  memo.entries.clear();
}

/** The final current-reader pass of an operation always reads afresh: while
 * it runs nothing is reused or recorded. */
export async function withNativeSourceOperationMemoSuspended<T>(db: object, read: () => Promise<T>): Promise<T> {
  const memo = operationMemos.get(db);
  if (!memo) return read();
  memo.suspended += 1;
  try { return await read(); } finally { memo.suspended -= 1; }
}

export function nativeSourceOperationMemoOpen(db: object): boolean {
  const memo = operationMemos.get(db);
  return memo?.open === true && memo.suspended === 0;
}

export function nativeSourceOperationMemoized<T>(db: object, family: string, key: string, load: () => Promise<T>): Promise<T> {
  const memo = operationMemos.get(db);
  if (!memo?.open || memo.suspended > 0) return load();
  const entryKey = `${family}\u0000${key}`;
  const existing = memo.entries.get(entryKey) as Promise<T> | undefined;
  if (existing) return existing;
  if (memo.entries.size >= NATIVE_SOURCE_OPERATION_MEMO_BOUND) return load();
  const pending = load();
  memo.entries.set(entryKey, pending);
  pending.catch(() => { if (memo.entries.get(entryKey) === pending) memo.entries.delete(entryKey); });
  return pending;
}
