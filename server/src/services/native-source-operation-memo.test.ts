import { describe, expect, it } from "vitest";
import { nativeSourceOperationMemoized, nativeSourceOperationMemoOpen, openNativeSourceOperationMemo,
  retireNativeSourceOperationMemo, withNativeSourceOperationMemoSuspended } from "./native-source-operation-memo.js";

// MS1f stop 8. The per-operation memo is scoped to one transaction object and
// one outermost operation; it never survives an effect boundary, the final
// reader pass or the operation itself, and it never retains a refusal.
describe("Native source operation memo", () => {
  const counting = () => {
    let loads = 0;
    return { load: (value: unknown) => async () => { loads += 1; return value; }, get loads() { return loads; } };
  };

  it("reads once per operation and transaction, and never outside an operation", async () => {
    const tx = {}, other = {}, reads = counting();
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(1))).toBe(1);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(1))).toBe(1);
    expect(reads.loads).toBe(2);
    const close = openNativeSourceOperationMemo(tx);
    expect(nativeSourceOperationMemoOpen(tx)).toBe(true);
    expect(nativeSourceOperationMemoOpen(other)).toBe(false);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(2))).toBe(2);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(3))).toBe(2);
    expect(reads.loads).toBe(3);
    // Every key component and the family separate entries; another transaction never shares.
    expect(await nativeSourceOperationMemoized(tx, "f", "k2", reads.load(4))).toBe(4);
    expect(await nativeSourceOperationMemoized(tx, "g", "k", reads.load(5))).toBe(5);
    expect(await nativeSourceOperationMemoized(other, "f", "k", reads.load(6))).toBe(6);
    expect(reads.loads).toBe(6);
    // A nested opener reuses the outer operation and cannot close it.
    const nestedClose = openNativeSourceOperationMemo(tx);
    nestedClose();
    expect(nativeSourceOperationMemoOpen(tx)).toBe(true);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(7))).toBe(2);
    close();
    expect(nativeSourceOperationMemoOpen(tx)).toBe(false);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(8))).toBe(8);
    // The next operation starts empty.
    const again = openNativeSourceOperationMemo(tx);
    expect(nativeSourceOperationMemoOpen(tx)).toBe(true);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(9))).toBe(9);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load(10))).toBe(9);
    again();
  });

  it("never retains a refusal", async () => {
    const tx = {}, close = openNativeSourceOperationMemo(tx);
    let loads = 0;
    const refuse = async () => { loads += 1; throw new Error("refused"); };
    await expect(nativeSourceOperationMemoized(tx, "f", "k", refuse)).rejects.toThrow("refused");
    await expect(nativeSourceOperationMemoized(tx, "f", "k", refuse)).rejects.toThrow("refused");
    expect(loads).toBe(2);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", async () => "accepted")).toBe("accepted");
    close();
  });

  it("keeps a resolved value only when the caller's retention accepts it", async () => {
    const tx = {}, close = openNativeSourceOperationMemo(tx);
    let loads = 0;
    const absent = async () => { loads += 1; return null; };
    expect(await nativeSourceOperationMemoized(tx, "f", "k", absent, value => value !== null)).toBeNull();
    expect(await nativeSourceOperationMemoized(tx, "f", "k", absent, value => value !== null)).toBeNull();
    expect(loads).toBe(2);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", async () => "present", value => value !== null)).toBe("present");
    expect(await nativeSourceOperationMemoized(tx, "f", "k", async () => "unused", value => value !== null)).toBe("present");
    close();
  });

  it("retires at an effect boundary for the rest of the operation", async () => {
    const tx = {}, close = openNativeSourceOperationMemo(tx), reads = counting();
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load("before"))).toBe("before");
    retireNativeSourceOperationMemo(tx);
    expect(nativeSourceOperationMemoOpen(tx)).toBe(false);
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load("after"))).toBe("after");
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load("again"))).toBe("again");
    expect(reads.loads).toBe(3);
    close();
  });

  it("reads afresh during the final reader pass and resumes after it", async () => {
    const tx = {}, close = openNativeSourceOperationMemo(tx), reads = counting();
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load("first"))).toBe("first");
    await withNativeSourceOperationMemoSuspended(tx, async () => {
      expect(nativeSourceOperationMemoOpen(tx)).toBe(false);
      expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load("final"))).toBe("final");
      expect(await nativeSourceOperationMemoized(tx, "f", "k2", reads.load("final2"))).toBe("final2");
    });
    expect(reads.loads).toBe(3);
    expect(nativeSourceOperationMemoOpen(tx)).toBe(true);
    // Nothing read during the final pass was recorded.
    expect(await nativeSourceOperationMemoized(tx, "f", "k2", reads.load("later"))).toBe("later");
    expect(await nativeSourceOperationMemoized(tx, "f", "k", reads.load("unused"))).toBe("first");
    close();
  });

  it("stops recording at its bound", async () => {
    const tx = {}, close = openNativeSourceOperationMemo(tx);
    for (let index = 0; index < 4096; index += 1) await nativeSourceOperationMemoized(tx, "f", String(index), async () => index);
    let loads = 0;
    expect(await nativeSourceOperationMemoized(tx, "f", "over", async () => { loads += 1; return "a"; })).toBe("a");
    expect(await nativeSourceOperationMemoized(tx, "f", "over", async () => { loads += 1; return "b"; })).toBe("b");
    expect(loads).toBe(2);
    expect(await nativeSourceOperationMemoized(tx, "f", "0", async () => -1)).toBe(0);
    close();
  });
});
