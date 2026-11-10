import { modelProviderWireReceiptSchema } from "@paperclipai/shared";

/** Exact persisted Native Text charge binding used by both explicit admission
 * and continuation-source capture. Hash domains are intentionally distinct:
 * the intent records inputHash; the provider receipt records requestHash. */
export function isExactUnknownNativeTextCharge(input: {
  run: { id: string; companyId: string; agentId: string; nativeIssueId: string | null; runtimeMode: string | null; driverKind: string | null };
  issueId: string; actionCause: string; actionEvidence: Record<string, unknown>;
  reservation: { id: string; companyId: string; purpose: string; status: string; workerAttemptId: string | null;
    planId: string | null; requestHash: string; inputHash: string; providerWireReceipt: unknown };
  binding: { runId: string | null; agentId: string | null; planIssueId: string; workerIssueId: string; workerAgentId: string | null };
  wireIntents: unknown;
  expectedReplay?: "blocked" | "explicit_user_continuation";
}): boolean {
  const automaticRecovery = input.actionEvidence.automaticRecovery;
  const wire = modelProviderWireReceiptSchema.safeParse(input.reservation.providerWireReceipt);
  if (input.run.runtimeMode !== "native" || input.run.driverKind !== "aw_text_messages" ||
      input.run.nativeIssueId !== input.issueId || input.actionCause !== "uncertain_provider_action" ||
      input.actionEvidence.runId !== input.run.id || input.actionEvidence.modelReservationId !== input.reservation.id ||
      !automaticRecovery || typeof automaticRecovery !== "object" || Array.isArray(automaticRecovery) ||
      (automaticRecovery as Record<string, unknown>).replay !== (input.expectedReplay ?? "blocked") ||
      input.reservation.companyId !== input.run.companyId || input.reservation.purpose !== "worker_model" ||
      input.reservation.status !== "unknown" || input.reservation.workerAttemptId === null || input.reservation.planId === null ||
      !wire.success || wire.data.reservationId !== input.reservation.id || wire.data.requestHash !== input.reservation.requestHash ||
      input.binding.runId !== input.run.id || input.binding.agentId !== input.run.agentId ||
      input.binding.workerAgentId !== input.run.agentId || input.binding.planIssueId !== input.issueId ||
      input.binding.workerIssueId !== input.issueId || !Array.isArray(input.wireIntents)) return false;
  return input.wireIntents.some(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const intent = value as Record<string, unknown>;
    return intent.reservationId === input.reservation.id && intent.requestHash === input.reservation.inputHash &&
      intent.wireBodyHash === wire.data.bodySha256 && intent.method === wire.data.method &&
      intent.endpoint === wire.data.endpoint && intent.modelPurpose === "worker_model";
  });
}
