import type { FinishLearningCycleInput, LearningCycleView, LearningHypothesisView, LearningEvaluationView, LearningPolicyProposalView, LearningCycleInput, LearningHypothesisInput, LearningEvaluationInput, LearningChangeInput, LearningChange, ProposeLearningChange } from "@paperclipai/shared";
import { api } from "./client";
type Candidate = { id: string; hypothesisId: string; targetDomain: string; targetId: string; candidateId: string; invalidatedAt: string | null; erasedAt: string | null; promotionReceipt?: { domain: string; targetId: string; versionId: string } | null };
export const learningApi = {
  finish: (companyId: string, id: string, input: FinishLearningCycleInput) => api.post<LearningCycleView>(`/companies/${companyId}/learning/cycles/${id}/finish`, input),
  list: (companyId: string) => api.get<LearningCycleView[]>(`/companies/${companyId}/learning/cycles`),
  policies: (companyId: string) => api.get<LearningPolicyProposalView[]>(`/companies/${companyId}/learning/policy-proposals`),
  reviewPolicy: (companyId: string, id: string, input: { expectedVersion: number; decision: "accept" | "reject"; rationale: string; acknowledgeApprovalOrSecurityChange: boolean }) => api.post<LearningPolicyProposalView>(`/companies/${companyId}/learning/policy-proposals/${id}/review`, input),
  get: (companyId: string, id: string) => api.get<LearningCycleView & { hypotheses: LearningHypothesisView[]; evaluations: LearningEvaluationView[]; candidates: Candidate[] }>(`/companies/${companyId}/learning/cycles/${id}`),
  create: (companyId: string, input: LearningCycleInput) => api.post<LearningCycleView>(`/companies/${companyId}/learning/cycles`, input),
  prepare: (companyId: string, input: LearningChangeInput) => api.post<{ hash: string; change: LearningChange }>(`/companies/${companyId}/learning/prepare-change`, input),
  hypothesis: (companyId: string, id: string, input: LearningHypothesisInput) => api.post<LearningHypothesisView>(`/companies/${companyId}/learning/cycles/${id}/hypotheses`, input),
  evaluate: (companyId: string, id: string, input: LearningEvaluationInput) => api.post<LearningEvaluationView>(`/companies/${companyId}/learning/hypotheses/${id}/evaluations`, input),
  propose: (companyId: string, id: string, input: ProposeLearningChange) => api.post<Candidate>(`/companies/${companyId}/learning/hypotheses/${id}/propose-change`, input),
};
