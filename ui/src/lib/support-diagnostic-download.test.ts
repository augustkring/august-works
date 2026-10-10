// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkflowSupportDiagnostic } from "@paperclipai/shared";
import { downloadWorkflowSupportDiagnostic } from "./support-diagnostic-download";
const report: WorkflowSupportDiagnostic = {
  schemaVersion: 1,
  surface: "workflow_run",
  companyId: "10000000-0000-4000-8000-000000000001",
  workflowId: "10000000-0000-4000-8000-000000000002",
  runId: "10000000-0000-4000-8000-000000000003",
  revisionId: "10000000-0000-4000-8000-000000000004",
  revisionNumber: 1,
  revisionState: "draft",
  runStatus: "failed",
  purpose: "test",
  sourceUpdatedAt: "2026-10-10T00:00:00.000Z",
  verification: "recorded_execution_only",
  traceSummary: { state: "unavailable" },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function urls() {
  const create = vi.fn(
    (_object: Blob | MediaSource) => "blob:local-support-report",
  );
  const revoke = vi.fn();
  const NativeURL = URL;
  class TestURL extends NativeURL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  }
  vi.stubGlobal("URL", TestURL);
  vi.stubGlobal("Blob", NodeBlob);
  return { create, revoke };
}
it("downloads only the inspected strict JSON with a fixed filename and releases the blob", async () => {
  const { create, revoke } = urls();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("august-works-support-diagnostic.json");
      expect(this.href).toBe("blob:local-support-report");
    });
  downloadWorkflowSupportDiagnostic(report);
  expect(click).toHaveBeenCalledTimes(1);
  const blob = create.mock.calls[0]![0] as unknown as NodeBlob;
  expect(blob.type).toBe("application/json");
  expect(JSON.parse(await blob.text())).toEqual(report);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:local-support-report");
  expect(document.querySelector("a")).toBeNull();
});
it("rejects extra customer content before creating any downloadable object", () => {
  const { create, revoke } = urls();
  expect(() =>
    downloadWorkflowSupportDiagnostic({
      ...report,
      rawLogs: "PRIVATE",
    } as WorkflowSupportDiagnostic),
  ).toThrow();
  expect(create).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
});
it("releases the blob even when the browser download action fails", () => {
  const { revoke } = urls();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    throw new Error("PRIVATE browser error");
  });
  expect(() => downloadWorkflowSupportDiagnostic(report)).toThrow();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:local-support-report");
});
