import {
  workflowSupportDiagnosticSchema,
  type WorkflowSupportDiagnostic,
} from "@paperclipai/shared";

/** Called only by the explicit download control after preview. No network,
 * clipboard, persistent browser storage, resource name or user ID in filename. */
export function downloadWorkflowSupportDiagnostic(
  report: WorkflowSupportDiagnostic,
): void {
  const validated = workflowSupportDiagnosticSchema.parse(report);
  const blob = new Blob([JSON.stringify(validated, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = "august-works-support-diagnostic.json";
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
