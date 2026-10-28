import {
  trustAcceptanceNoticeProjectionSchema,
  trustAcceptanceNoticeListSchema,
  type TrustAcceptanceNoticeProjection,
  type TrustDocument,
} from "@paperclipai/shared";

export type CompletedTrustActions = ReadonlySet<string>;

/** Project only current owner-declared material-change actions. Completion is
 * compared against the canonical immutable receipt for the exact revision and version. */
export function projectTrustAcceptanceNotices(
  companyId: string,
  requirements: readonly TrustDocument[],
  completed: CompletedTrustActions,
  canAdminAcknowledge: boolean,
): TrustAcceptanceNoticeProjection[] {
  const notices = requirements.flatMap(document => {
    const mode = document.materialChangeAction;
    if (mode === "no_action" || !document.effectiveAt) return [];
    const owner = mode === "notice" ? "trust_document_notice_read"
      : mode === "reacceptance" ? "trust_document_acceptance" : "trust_document_admin_acknowledgment";
    const action = mode === "notice" ? "notice_read" : mode === "reacceptance" ? "acceptance" : "customer_admin_acknowledgment";
    const key = `${action}\u0000${document.id}\u0000${document.documentRevisionId}\u0000${document.version}`;
    if (completed.has(key)) return [];
    const title = document.title?.trim() || "A current public document requires review";
    const completionPath = mode === "notice" ? `/companies/${companyId}/trust/notices/read`
      : mode === "reacceptance" ? `/companies/${companyId}/trust/acceptances`
        : `/companies/${companyId}/trust/admin-acknowledgments`;
    return [trustAcceptanceNoticeProjectionSchema.parse({
      id: document.id,
      category: "policy_legal",
      title,
      summary: mode === "notice" ? `Review the current version (${document.version}) and mark the notice as read.`
        : mode === "reacceptance" ? `Review and accept the current version (${document.version}).`
          : `Review the current version (${document.version}); a company owner or admin must acknowledge it.`,
      affectedCompanyId: companyId,
      effectiveAt: document.effectiveAt,
      customerImpact: mode === "notice" ? `${title} requires a recorded read receipt.`
        : mode === "reacceptance" ? `Your company requires acceptance of ${title}.`
          : `A company owner or admin must acknowledge ${title}.`,
      actionRequired: true,
      actionDeadline: null,
      mandatoryVisibility: true,
      canComplete: mode !== "customer_admin_acknowledgment" || canAdminAcknowledge,
      completion: { owner, registryEntryId: document.id,
        documentRevisionId: document.documentRevisionId, version: document.version },
      contentPath: `/companies/${companyId}/trust/documents/${document.id}/content`,
      completionPath,
    })];
  });
  return trustAcceptanceNoticeListSchema.parse({ configured: requirements.some(row => row.materialChangeAction !== "no_action"), notices }).notices;
}
