import { describe, expect, it } from "vitest";
import type { TrustDocument } from "@paperclipai/shared";
import { projectTrustAcceptanceNotices } from "./product-notices.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const document = {
  id: "00000000-0000-4000-8000-000000000002", documentId: "00000000-0000-4000-8000-000000000003",
  documentRevisionId: "00000000-0000-4000-8000-000000000004", title: "Current policy", version: "4", owner: "company owner",
  effectiveAt: "2026-10-28T00:00:00Z", evidenceRefs: [], customerVisibility: "public", ndaRequired: false,
  lastReviewedAt: "2026-10-28T00:00:00Z", nextReviewOrTrigger: null, expiresAt: null, supersededBy: null,
  materialChangeAction: "reacceptance", acceptanceRequired: true,
} satisfies TrustDocument;

describe("product notice projection", () => {
  it("projects mandatory visibility only from an exact current canonical acceptance requirement", () => {
    const [notice] = projectTrustAcceptanceNotices(companyId, [document], new Set(), false);
    expect(notice).toMatchObject({
      id: document.id,
      category: "policy_legal",
      affectedCompanyId: companyId,
      actionRequired: true,
      mandatoryVisibility: true,
      completion: { owner: "trust_document_acceptance", registryEntryId: document.id,
        documentRevisionId: document.documentRevisionId, version: document.version },
      contentPath: `/companies/${companyId}/trust/documents/${document.id}/content`,
      completionPath: `/companies/${companyId}/trust/acceptances`, canComplete: true,
    });
  });

  it("omits a canonically accepted version and ignores non-required rows", () => {
    const accepted = new Set([`acceptance\u0000${document.id}\u0000${document.documentRevisionId}\u0000${document.version}`]);
    expect(projectTrustAcceptanceNotices(companyId, [document], accepted, false)).toEqual([]);
    expect(projectTrustAcceptanceNotices(companyId, [{ ...document, materialChangeAction: "no_action", acceptanceRequired: false }], new Set(), false)).toEqual([]);
    expect(projectTrustAcceptanceNotices(companyId, [{ ...document, effectiveAt: null }], new Set(), false)).toEqual([]);
  });

  it("fails if generated content or acceptance links drift from canonical company scope", () => {
    expect(() => projectTrustAcceptanceNotices("not-a-company-id", [document], new Set(), false)).toThrow();
  });

  it("uses the canonical completion owner and admin role for the other material-change actions", () => {
    const noticeOnly = projectTrustAcceptanceNotices(companyId, [{ ...document, materialChangeAction: "notice", acceptanceRequired: false }], new Set(), false)[0]!;
    expect(noticeOnly.completion.owner).toBe("trust_document_notice_read");
    expect(noticeOnly.completionPath).toBe(`/companies/${companyId}/trust/notices/read`);
    const adminRequired = projectTrustAcceptanceNotices(companyId, [{ ...document, materialChangeAction: "customer_admin_acknowledgment", acceptanceRequired: false }], new Set(), false)[0]!;
    expect(adminRequired).toMatchObject({ canComplete: false, completion: { owner: "trust_document_admin_acknowledgment" },
      completionPath: `/companies/${companyId}/trust/admin-acknowledgments` });
    expect(projectTrustAcceptanceNotices(companyId, [{ ...document, materialChangeAction: "customer_admin_acknowledgment", acceptanceRequired: false }], new Set(), true)[0]?.canComplete).toBe(true);
  });

  it.each([
    ["notice", "notice_read", "trust_document_notice_read"],
    ["reacceptance", "acceptance", "trust_document_acceptance"],
    ["customer_admin_acknowledgment", "customer_admin_acknowledgment", "trust_document_admin_acknowledgment"],
  ] as const)("resolves %s only from an exact revision/version receipt", (mode, action, owner) => {
    const row = { ...document, materialChangeAction: mode, acceptanceRequired: mode === "reacceptance" };
    const exact = `${action}\u0000${row.id}\u0000${row.documentRevisionId}\u0000${row.version}`;
    expect(projectTrustAcceptanceNotices(companyId, [row], new Set(), true)[0]?.completion.owner).toBe(owner);
    expect(projectTrustAcceptanceNotices(companyId, [row], new Set([exact]), true)).toEqual([]);
    const staleRevision = `${action}\u0000${row.id}\u0000${"00000000-0000-4000-8000-000000000005"}\u0000${row.version}`;
    expect(projectTrustAcceptanceNotices(companyId, [row], new Set([staleRevision]), true)).toHaveLength(1);
    const staleVersion = `${action}\u0000${row.id}\u0000${row.documentRevisionId}\u0000old`;
    expect(projectTrustAcceptanceNotices(companyId, [row], new Set([staleVersion]), true)).toHaveLength(1);
  });
});
