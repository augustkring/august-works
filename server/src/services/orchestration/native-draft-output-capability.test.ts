import { describe, expect, it } from "vitest";
import { minimumNativeDraftToolActions, nativeDraftToolActionBudgetFits } from "./native-draft-output-capability.js";

const documents = (count: number) => Array.from({ length: count }, (_, index) => ({
  kind: "task_document", key: `document-${index}`,
}));

describe("qualified native draft output capabilities", () => {
  it.each([[1, 2], [2, 3], [16, 17]] as const)(
    "allows %i distinct OpenCode documents and reserves the existing baseline plus each write",
    (count, actions) => {
      expect(minimumNativeDraftToolActions("opencode", documents(count))).toBe(actions);
    },
  );

  it("rejects action budgets that cannot cover every required write", () => {
    const required = minimumNativeDraftToolActions("opencode", documents(2));
    expect(required).toBe(3);
    expect(nativeDraftToolActionBudgetFits(0, 2, required)).toBe(false);
    expect(nativeDraftToolActionBudgetFits(0, 3, required)).toBe(true);
    expect(nativeDraftToolActionBudgetFits(1, 3, required)).toBe(false);
  });

  it("keeps the text-only controller at exactly one output", () => {
    expect(minimumNativeDraftToolActions("aw_text_only", documents(1))).toBe(2);
    expect(() => minimumNativeDraftToolActions("aw_text_only", documents(2)))
      .toThrow("one declared canonical output");
  });

  it("rejects over-bound, duplicate-key, and non-document output contracts", () => {
    expect(() => minimumNativeDraftToolActions("opencode", documents(17))).toThrow();
    expect(() => minimumNativeDraftToolActions("opencode", [
      { kind: "task_document", key: "same" }, { kind: "task_document", key: "same" },
    ])).toThrow();
    expect(() => minimumNativeDraftToolActions("opencode", [
      { kind: "private_project", key: "project" },
    ])).toThrow();
  });
});
