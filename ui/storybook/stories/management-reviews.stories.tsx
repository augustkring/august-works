import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ManagementReviewWorkspace } from "@/pages/ManagementReviews";
import { ManagementReviewResult } from "@/components/ManagementReviewResult";
import { RoutineReviewTemplateWorkspace } from "@/components/RoutineManagementReviewEditor";
import { managementFixture, routineReviewFixture } from "./management-review-fixtures";
function Workspace({ stale = false, published = false, disabled = false }: { stale?: boolean; published?: boolean; disabled?: boolean }) {
  const f = managementFixture(stale, published), [client] = useState(() => { const q = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
    q.setQueryData(["management-review-controls", f.companyId, f.userId], { pages: [f.controls], pageParams: [undefined] }); q.setQueryData(["management-reviews", f.companyId, f.userId, "detail", f.id], f.review); q.setQueryData(["management-definition-sources", f.companyId, f.userId, "purpose"], [f.policy]); q.setQueryData(["management-definition-sources", f.companyId, f.userId, "options", "goal", "", ""], { items: [{ source: f.definition.sources[0].source, title: f.goal.title }], coverage: "bounded_authorized_native_choices" }); return q;
  });
  return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><ManagementReviewWorkspace companyId={f.companyId} userId={f.userId} enabled={!disabled} /></div></QueryClientProvider>;
}
function Predictive() {
  const f = managementFixture(), source = { key: "forecast", source: { kind: "analytical" as const, reference: { type: "forecast_run" as const, id: "00000000-0000-4000-8000-000000002304", specId: "00000000-0000-4000-8000-000000002305", versionId: "00000000-0000-4000-8000-000000002306", pointIndex: 0 } }, sourceHash: "e".repeat(64), capturedAt: f.review.createdAt, expiresAt: f.review.expiresAt, grade: "predictive" as const, facts: { predictedValue: 42, intervalLower: null, intervalUpper: null }, limitations: ["Synthetic cached forecast presentation; prediction is not a measured result. Intervals are unavailable."] };
  f.review.sources.push(source); f.review.packet.claims.push({ key: "claim_forecast", sourceKeys: [source.key], grade: source.grade, facts: source.facts, limitations: source.limitations });
  return <div className="mx-auto w-full max-w-3xl"><ManagementReviewResult review={f.review} /></div>;
}
function Comparison() {
  const f = managementFixture(), source = { ...f.review.sources[0], key: "actual", source: { kind: "analytical" as const, reference: { type: "metric_observation" as const, id: "00000000-0000-4000-8000-000000002307", metricId: "00000000-0000-4000-8000-000000002308", metricVersionId: "00000000-0000-4000-8000-000000002309" } }, grade: "native_observation" as const, facts: { value: 0.5 }, limitations: ["Synthetic cached numerical presentation; no collected business impact."] };
  const earlier = f.review.sources[0]; earlier.source = { kind: "analytical", reference: { type: "metric_observation", id: "00000000-0000-4000-8000-000000002310", metricId: "00000000-0000-4000-8000-000000002311", metricVersionId: "00000000-0000-4000-8000-000000002312" } }; earlier.grade = "native_observation"; earlier.facts = { value: 0.2 }; f.review.packet.claims[0] = { key: "claim_source_1", sourceKeys: ["source_1"], grade: earlier.grade, facts: earlier.facts, limitations: earlier.limitations }; f.review.definition.sources[0].source = earlier.source; f.review.definition.sources.push({ key: source.key, source: source.source }); f.review.definition.comparisons = [{ key: "native_change", kind: "metric_change", leftSourceKey: "source_1", rightSourceKey: "actual" }];
  f.review.sources.push(source); f.review.packet.claims.push({ key: "claim_actual", sourceKeys: [source.key], grade: source.grade, facts: source.facts, limitations: source.limitations }, { key: "comparison_native_change", sourceKeys: ["source_1", "actual"], grade: "native_observation", facts: { comparison: "two_cited_native_windows", status: "unknown", absoluteChange: null, relativeChangeFraction: null, reason: "observation_definition_mismatch" }, limitations: ["Incompatible native sources cannot establish a numerical change. Synthetic cached presentation only."] });
  return <div className="mx-auto w-full max-w-3xl"><ManagementReviewResult review={f.review} /></div>;
}
function GovernanceRisk() {
  const f = managementFixture(), source = f.review.sources[0], { analyticalPurpose, ...legalSource } = structuredClone(f.policy.obligation), obligation = { ...legalSource, framework: "sector_overlay" as const, citation: "Synthetic native control evidence review", applicabilityState: "uncertain" as const, nextReviewAt: "2026-10-01T00:00:00.000Z", evidenceRequired: ["Original declared retention review receipt", "Independent evidence of control effectiveness remains required"], controlRefs: ["Human-declared retention control", "Human-declared access review control"] };
  source.source = { kind: "governance_obligation", id: f.policy.id, contentHash: f.policy.obligationHash }; source.governance = { id: f.policy.id, contentHash: f.policy.obligationHash, obligation }; source.facts = { citation: obligation.citation, applicabilityState: "uncertain", nextReviewAt: obligation.nextReviewAt, reviewDue: true, currentRevision: true, controlEffectiveness: "not_verified", requiredControl: obligation.requiredControl }; source.limitations = ["Synthetic cached governance presentation only; no legal ruling or verified control effectiveness.", "Review-due legal evidence never grants analytical purpose approval."];
  f.review.definition.sources[0].source = source.source; f.review.packet.claims[0] = { key: "claim_source_1", sourceKeys: [source.key], grade: source.grade, facts: source.facts, limitations: source.limitations };
  return <div className="mx-auto w-full max-w-3xl"><ManagementReviewResult review={f.review} /></div>;
}
function OutcomeJudgments() {
  const f = managementFixture(), source = f.review.sources[0], judgment = { kind: "human_judgment" as const, assessment: "unknown" as const, explanation: "Human retains explicitly incomplete observed evidence", evidenceKeys: [] };
  source.source = { kind: "decision_outcome", decisionId: f.id, reviewId: f.id, revision: 3 }; source.grade = "native_outcome_review"; source.facts = { reviewStatus: "inconclusive", decisionProcessQuality: "supported", observedOutcome: "unknown", causalConfidence: "not_assessed", lessonSummary: "An observed result alone does not determine decision quality" }; source.limitations = ["Synthetic cached original outcome presentation only; no collected business impact or causal claim."];
  const receipt = { rationale: "Human reports the separate original outcome review", recordedBy: f.userId, recordedAt: f.review.createdAt, contextHash: "c".repeat(64), contentHash: "d".repeat(64), expiresAt: f.review.expiresAt, actualEvidence: [], comparisons: [], nativeExecution: { status: "succeeded", capturedAt: f.review.createdAt } };
  source.outcome = { id: f.id, companyId: f.companyId, decisionId: f.id, contextVersionId: f.id, contextHash: "c".repeat(64), optionId: "proceed", revision: 3, status: "inconclusive", reviewDueAt: f.review.createdAt, reviewedAt: f.review.createdAt, reviewedByUserId: f.userId, causalClaimRef: null, learningCycleId: null, receipts: [{ ...receipt, revision: 3, action: "finish", fromState: "in_review", toState: "inconclusive", assessment: { expectedRevision: 2, result: "inconclusive", lessonSummary: "An observed result alone does not determine decision quality", assessments: { decisionProcessQuality: { ...judgment, assessment: "supported" }, assumptionAccuracy: judgment, executionFidelity: judgment, externalChange: judgment, observedOutcome: judgment, causalConfidence: { assessment: "not_assessed", explanation: "No identified native causal estimate is available" } }, actualMetrics: [], metricOutcomes: [], qualitativeOutcomes: [], assumptionOutcomes: [] } }, { ...receipt, revision: 2, action: "begin", fromState: "scheduled", toState: "in_review", assessment: null }, { ...receipt, revision: 1, action: "schedule", fromState: null, toState: "scheduled", assessment: null }] };
  f.review.definition.sources[0].source = source.source; f.review.packet.claims[0] = { key: "claim_source_1", sourceKeys: [source.key], grade: source.grade, facts: source.facts, limitations: source.limitations };
  return <div className="mx-auto w-full max-w-3xl"><ManagementReviewResult review={f.review} /></div>;
}
const meta: Meta = { title: "Business Intelligence/Management reviews", parameters: { layout: "padded" } }; export default meta; type Story = StoryObj;
// Cached synthetic presentation; browser checks abort every API request.
export const Current: Story = { render: () => <Workspace /> };
export const Retained: Story = { render: () => <Workspace stale /> };
export const Published: Story = { render: () => <Workspace published /> };
export const Disabled: Story = { render: () => <Workspace disabled /> };
export const Prediction: Story = { render: () => <Predictive /> };
export const CitedComparison: Story = { render: () => <Comparison /> };
export const DeclaredGovernanceRisk: Story = { render: () => <GovernanceRisk /> };
export const OriginalOutcomeJudgments: Story = { render: () => <OutcomeJudgments /> };

function RoutineTemplate() {
  const f = routineReviewFixture(), [client] = useState(() => {
    const q = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
    q.setQueryData(["management-definition-sources", f.companyId, f.userId, "purpose"], [f.policy]);
    q.setQueryData(["management-definition-sources", f.companyId, f.userId, "options", "goal", "", ""], { items: [{ source: f.definition.sources[0].source, title: f.goal.title }], coverage: "bounded_authorized_native_choices" });
    q.setQueryData(["management-definition-sources", f.companyId, f.userId, "options", "metric", "", ""], { items: [{ source: f.metricSource, title: "Current published onboarding metric" }], coverage: "bounded_authorized_native_choices" });
    return q;
  });
  return <QueryClientProvider client={client}><div className="mx-auto w-full max-w-3xl"><RoutineReviewTemplateWorkspace routine={{ ...f.routine, managementReviewTemplate: f.template }} userId={f.userId} /></div></QueryClientProvider>;
}
export const RoutineReviewTemplate: Story = { render: () => <RoutineTemplate /> };
