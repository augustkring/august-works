import { describe, expect, it } from "vitest";
import { nativeCommentProjectionHash } from "./canonical.js";

describe("native comment read projection hash", () => {
  it("normalizes absent JSON fields and Date projections before hashing", () => {
    expect(nativeCommentProjectionHash({ body: "history" }))
      .toBe(nativeCommentProjectionHash({ body: "history", presentation: null, metadata: null }));
    const date = new Date("2026-10-26T12:34:56.000Z");
    expect(nativeCommentProjectionHash({ body: "history", metadata: date }))
      .toBe(nativeCommentProjectionHash({ body: "history", metadata: date.toISOString() }));
  });
});
