import { expect, it } from "vitest";
import type { WorkflowDetail } from "@paperclipai/shared";
import { workflowReviewBinding } from "./workflow-review-binding.js";
import { ExperienceOverloadError } from "./projection.js";

it("binds actual timestamps rather than treating Dates as empty objects", () => {
  const original = { updatedAt: new Date("2026-10-14T00:00:00Z") } as WorkflowDetail;
  expect(workflowReviewBinding(structuredClone(original))).toBe(workflowReviewBinding(original));
  expect(workflowReviewBinding({ ...original, updatedAt: new Date("2026-10-14T00:00:01Z") })).not.toBe(workflowReviewBinding(original));
});
it("bounds complete material without returning raw private fields", () => {
  const detail = { name: "PRIVATE", description: "x".repeat(262145), updatedAt: new Date() } as WorkflowDetail;
  expect(() => workflowReviewBinding(detail)).toThrow(ExperienceOverloadError);
  expect(() => workflowReviewBinding(detail)).not.toThrow(/PRIVATE|xxx/);
});
