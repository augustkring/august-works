import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { governanceObligationSchema, strategyExecutionLinkDefinitionSchema, type StrategyExecutionLinkDetail, type StrategyExecutionLinkList } from "@paperclipai/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StrategyExecutionWorkspace } from "@/pages/StrategyExecution";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const companyId = id(1), userId = "reviewer", goalId = id(2), projectId = id(3), documentId = id(4), revisionId = id(5), sectionId = id(6), policyId = id(7), linkId = id(8), versionId = id(9);
const createdAt = new Date(Date.now()-86400000).toISOString(), nextReviewAt = new Date(Date.now()+29*86400000).toISOString(), expiresAt = nextReviewAt;
const definition = strategyExecutionLinkDefinitionSchema.parse({ from: { type: "foundation_section", foundationDocumentId: documentId, approvedRevisionId: revisionId, sectionId, headingPath: ["Strategy","Customer focus"], contentHash: "a".repeat(64) }, to: { type: "goal", id: goalId }, relationship: "supports", rationale: "Improve delivery quality through an explicit evidence review before committing work.", contribution: { kind: "hypothesis", statement: "Earlier evidence review may reduce correction work while preserving human approval." }, ownerUserId: userId, reviewFrequencyDays: 30, retentionDays: 30, sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [policyId] });
const policy = governanceObligationSchema.parse({ framework: "company_policy", authority: "Sample board", citation: "Advisory strategy purpose", jurisdictionOrScope: "Company business objects", applicabilityFacts: "Review strategic relationships", applicabilityState: "applicable", effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: null, requiredControl: "Current native source authority", evidenceRequired: ["Native source pins"], controlRefs: ["Human approval"], nextReviewAt: "2099-01-01T00:00:00Z", reviewTrigger: "Purpose change", sourceVersionOrDate: "storybook/v1", sourceUrl: "https://example.test/policy", analyticalPurpose: { status: "approved", purpose: "management_intelligence", capabilities: ["strategy"], populationUnits: "business_objects", peopleImpact: "none", decisionBoundary: "advisory_only", maxRetentionDays: 30, permittedSensitivity: ["internal"], prohibitedUses: ["Employee ranking"], approvalRationale: "Sample approved advisory relationship review" } });
function Fixture({ state }: { state: "active" | "needs_review" | "proposed" | "empty" }) {
  const [client] = useState(() => {
    const query = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } } });
    const link = { id: linkId, companyId, status: state === "empty" ? "proposed" as const : state, revision: state === "proposed" ? 1 : 2, approvedVersionId: state === "proposed" ? null : versionId, createdAt, updatedAt: createdAt };
    const version = { id: versionId, companyId, linkId, revision: 1, definition, contentHash: "b".repeat(64), createdAt, nextReviewAt, expiresAt };
    const reviewReason = state === "needs_review" ? "The approved Foundation strategy changed; human review is required" : null;
    const detail: StrategyExecutionLinkDetail = { link, effectiveVersion: version, versions: [version], hasMoreVersions: false, reviewReason };
    const list: StrategyExecutionLinkList = { items: state === "empty" ? [] : [{ ...link, definition, reviewReason, nextReviewAt, expiresAt }], nextCursor: null, coverage: "bounded_current_authorized_page" };
    query.setQueryData(["strategy-links",companyId,userId], { pages: [list], pageParams: [undefined] });
    query.setQueryData(["strategy-links",companyId,userId,"detail",linkId], detail);
    query.setQueryData(["strategy-source-name",companyId,userId,definition.from], "Company strategy");
    query.setQueryData(["strategy-source-name",companyId,userId,definition.to], "Improve delivery outcomes");
    const sourceKey = ["strategy-sources",companyId,userId];
    query.setQueryData([...sourceKey,"goals"], [{ id: goalId, companyId, title: "Improve delivery outcomes" }]);
    query.setQueryData([...sourceKey,"projects"], [{ id: projectId, companyId, name: "Evidence review initiative" }]);
    const foundation = [{ sectionId, foundationDocumentId: documentId, foundationKey: "strategy", category: "strategy", documentType: "strategy", authorityLevel: "canonical", sensitivity: "internal", status: "approved", documentRevisionId: revisionId, revisionNumber: 1, title: "Company strategy", headingPath: ["Strategy","Customer focus"], contentHash: "a".repeat(64) }];
    for (const search of ["strategy","Strategy","Customer focus"]) query.setQueryData([...sourceKey,"foundation",search], foundation);
    query.setQueryData(["governance-obligations",companyId,userId], [{ id: policyId, obligation: policy }]);
    return query;
  });
  return <QueryClientProvider client={client}><StrategyExecutionWorkspace companyId={companyId} userId={userId} /></QueryClientProvider>;
}
// These query fixtures exercise operator presentation without a live company.
// Browser QA blocks API requests; fixture states never qualify human mutations.
const meta: Meta = { title: "Business Intelligence/Strategy execution", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;
export const Active: Story = { render: () => <Fixture state="active" /> };
export const NeedsReview: Story = { render: () => <Fixture state="needs_review" /> };
export const Proposed: Story = { render: () => <Fixture state="proposed" /> };
export const Operator: Story = { render: () => <Fixture state="empty" /> };
