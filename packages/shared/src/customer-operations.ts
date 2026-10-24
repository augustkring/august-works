/** Customer projection only. Native domain owners authorize and perform work. */
export type CustomerOperationStatus =
  | "requested" | "admitted" | "running" | "verifying" | "paused"
  | "cancel_requested" | "cancelled" | "succeeded" | "failed" | "inconclusive";

export type CompanyImportJobState = "running" | "succeeded" | "failed" | "needs_reconciliation";

export interface CustomerOperationReceipt {
  id: string;
  operationType: "company_import";
  domain: "company_portability";
  domainOperationRef: string | null;
  status: CustomerOperationStatus;
  progressStage: string;
  attempt: number;
  unknownOutcome: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
