import { expect, it } from "vitest";
import {
  workflowPublicationCommandSchema,
  workflowPublicationReceiptSchema,
  workflowPublicationReviewSchema,
} from "./workflow-publication.js";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = {
  requestId: id(1),
  expectedWorkflowId: id(2),
  expectedUpdatedAt: "2026-10-10T00:00:00Z",
  expectedDraftRevisionId: id(3),
  expectedPublishedRevisionId: null,
  expectedTestRunId: id(4),
  acknowledgeInternalPublication: true,
};
it("requires the exact acknowledged native draft/test/publication tuple", () => {
  expect(workflowPublicationCommandSchema.parse(command)).toEqual(command);
  for (const change of [
    { acknowledgeInternalPublication: false },
    { expectedTestRunId: undefined },
    { publishMaterialActions: true },
    { expectedUpdatedAt: "now" },
  ])
    expect(
      workflowPublicationCommandSchema.safeParse({ ...command, ...change })
        .success,
    ).toBe(false);
});
it("refuses incomplete ready reviews and foreign receipts", () => {
  const view = {
    companyId: id(1),
    workflowId: id(2),
    updatedAt: command.expectedUpdatedAt,
    draftRevisionId: id(3),
    publishedRevisionId: null,
    draftVersion: 1,
    testedRunId: id(4),
    availability: "internal_ready",
    receipt: null,
  };
  expect(workflowPublicationReviewSchema.safeParse(view).success).toBe(true);
  expect(
    workflowPublicationReviewSchema.safeParse({ ...view, testedRunId: null })
      .success,
  ).toBe(false);
  expect(
    workflowPublicationReviewSchema.safeParse({
      ...view,
      receipt: {
        companyId: id(8),
        workflowId: id(2),
        requestId: id(5),
        revisionId: id(3),
        testRunId: id(4),
        disposition: "published",
      },
    }).success,
  ).toBe(false);
  expect(
    workflowPublicationReceiptSchema.safeParse({
      companyId: id(1),
      workflowId: id(2),
      requestId: id(5),
      revisionId: id(3),
      testRunId: id(4),
      disposition: "running",
    }).success,
  ).toBe(false);
});
