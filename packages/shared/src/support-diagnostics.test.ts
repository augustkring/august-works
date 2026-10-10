import { describe, expect, it } from "vitest";
import {
  workflowSupportDiagnostic,
  workflowSupportDiagnosticSchema,
} from "./support-diagnostics.js";
import type { WorkflowRunExperience } from "./workflow-run-experience.js";
const companyId = "10000000-0000-4000-8000-000000000001";
const workflowId = "10000000-0000-4000-8000-000000000002";
const runId = "10000000-0000-4000-8000-000000000003";
const context = { companyId, workflowId, runId };
const view: WorkflowRunExperience = {
  companyId,
  workflowId,
  id: runId,
  revisionId: "10000000-0000-4000-8000-000000000004",
  revisionNumber: 2,
  revisionState: "superseded",
  status: "failed",
  purpose: "test",
  updatedAt: "2026-10-10T00:00:00.000Z",
  canRequestStop: false,
  stopReceipt: null,
  trace: {
    state: "available",
    attempts: [
      {
        id: "10000000-0000-4000-8000-000000000005",
        name: "PRIVATE customer task",
        operation: "PRIVATE operation description",
        attempt: 1,
        status: "failed",
        execution: "tool",
        approvalCheckpoint: false,
        payloadUnavailable: true,
        branchChoice: {
          state: "selected",
          nextStep: "PRIVATE selected branch",
        },
        waitingFor: [],
      },
    ],
  },
};
describe("customer-reviewed workflow support diagnostics", () => {
  it("exports only exact native references and status counts, with no customer text or success claim", () => {
    const report = workflowSupportDiagnostic(view, context)!;
    expect(report).toMatchObject({
      companyId,
      workflowId,
      runId,
      runStatus: "failed",
      purpose: "test",
      verification: "recorded_execution_only",
    });
    expect(report.traceSummary).toEqual({
      state: "available",
      totalAttempts: 1,
      attemptStatuses: [{ status: "failed", count: 1 }],
      payloadUnavailableCount: 1,
    });
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
    expect(report).not.toHaveProperty("canRequestStop");
    expect(report).not.toHaveProperty("stopReceipt");
    expect(workflowSupportDiagnosticSchema.parse(report)).toEqual(report);
  });
  it.each(["companyId", "workflowId", "runId"] as const)(
    "refuses a different %s binding",
    (key) => {
      expect(
        workflowSupportDiagnostic(view, {
          ...context,
          [key]: "10000000-0000-4000-8000-000000000099",
        }),
      ).toBeNull();
    },
  );
  it("keeps unavailable history distinct from actual empty history", () => {
    expect(
      workflowSupportDiagnostic(
        { ...view, trace: { state: "unavailable" } },
        context,
      )?.traceSummary,
    ).toEqual({ state: "unavailable" });
    expect(
      workflowSupportDiagnostic(
        { ...view, trace: { state: "available", attempts: [] } },
        context,
      )?.traceSummary,
    ).toEqual({
      state: "available",
      totalAttempts: 0,
      attemptStatuses: [],
      payloadUnavailableCount: 0,
    });
  });
  it("refuses duplicate IDs, oversized history, invalid identifiers and unexpected raw fields", () => {
    const trace = view.trace;
    if (trace.state !== "available") throw new Error("fixture trace missing");
    expect(
      workflowSupportDiagnostic(
        {
          ...view,
          trace: { ...trace, attempts: [trace.attempts[0], trace.attempts[0]] },
        },
        context,
      ),
    ).toBeNull();
    expect(
      workflowSupportDiagnostic(
        {
          ...view,
          trace: { ...trace, attempts: Array(501).fill(trace.attempts[0]) },
        },
        context,
      ),
    ).toBeNull();
    expect(
      workflowSupportDiagnostic(
        { ...view, companyId: "not-an-id" },
        { ...context, companyId: "not-an-id" },
      ),
    ).toBeNull();
    expect(
      workflowSupportDiagnostic(
        { ...view, rawLogs: "PRIVATE secret" },
        context,
      ),
    ).toBeNull();
  });
  it("rejects inconsistent count totals, duplicate statuses, and free-form content in the export", () => {
    const report = workflowSupportDiagnostic(view, context)!;
    expect(
      workflowSupportDiagnosticSchema.safeParse({
        ...report,
        rawError: "PRIVATE",
      }).success,
    ).toBe(false);
    expect(
      workflowSupportDiagnosticSchema.safeParse({
        ...report,
        traceSummary: {
          state: "available",
          totalAttempts: 2,
          attemptStatuses: [{ status: "failed", count: 1 }],
          payloadUnavailableCount: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      workflowSupportDiagnosticSchema.safeParse({
        ...report,
        traceSummary: {
          state: "available",
          totalAttempts: 2,
          attemptStatuses: [
            { status: "failed", count: 1 },
            { status: "failed", count: 1 },
          ],
          payloadUnavailableCount: 0,
        },
      }).success,
    ).toBe(false);
  });
});
