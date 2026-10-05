import type {
  AIUseCaseView,
  UseCasePurpose,
  UseCaseAssessment,
  GovernanceProfileView,
  GovernanceDetail,
  OversightProfile,
  GovernanceEvidencePack,
  GovernanceObligation,
  GovernanceObligationView,
} from "@paperclipai/shared";
const actorPath = (path: string, userId?: string) =>
  userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
import { api } from "./client";
export const aiGovernanceApi = {
  targets: (companyId: string, userId?: string) =>
    api.get<
      Array<{
        id: string;
        title: string;
        identifier: string | null;
        assigneeAgentId: string;
      }>
    >(
      actorPath(
        `/companies/${companyId}/ai-use-case-deployment-targets`,
        userId,
      ),
    ),
  obligations: (companyId: string, userId?: string) =>
    api.get<GovernanceObligationView[]>(
      actorPath(`/companies/${companyId}/governance-obligations`, userId),
    ),
  obligation: (
    companyId: string,
    obligation: GovernanceObligation,
    userId?: string,
  ) =>
    api.post<GovernanceObligationView>(
      actorPath(`/companies/${companyId}/governance-obligations`, userId),
      obligation,
    ),
  evidencePack: (companyId: string, id: string, userId?: string) =>
    api.get<GovernanceEvidencePack>(
      actorPath(
        `/companies/${companyId}/ai-use-cases/${id}/evidence-pack`,
        userId,
      ),
    ),
  list: (companyId: string, userId?: string) =>
    api.get<AIUseCaseView[]>(
      actorPath(`/companies/${companyId}/ai-use-cases`, userId),
    ),
  detail: (companyId: string, id: string, userId?: string) =>
    api.get<GovernanceDetail>(
      actorPath(`/companies/${companyId}/ai-use-cases/${id}`, userId),
    ),
  profiles: (companyId: string, userId?: string) =>
    api.get<GovernanceProfileView[]>(
      actorPath(`/companies/${companyId}/human-oversight-profiles`, userId),
    ),
  oversight: (companyId: string, profile: OversightProfile, userId?: string) =>
    api.post<GovernanceProfileView>(
      actorPath(`/companies/${companyId}/human-oversight-profiles`, userId),
      profile,
    ),
  create: (
    companyId: string,
    key: string,
    purpose: UseCasePurpose,
    userId?: string,
  ) =>
    api.post<AIUseCaseView>(
      actorPath(`/companies/${companyId}/ai-use-cases`, userId),
      { key, purpose },
    ),
  update: (
    row: AIUseCaseView,
    purpose: UseCasePurpose,
    changeReason: string,
    userId?: string,
  ) =>
    api.patch<AIUseCaseView>(
      actorPath(`/companies/${row.companyId}/ai-use-cases/${row.id}`, userId),
      { expectedVersion: row.version, purpose, changeReason },
    ),
  assess: (
    row: AIUseCaseView,
    assessment: UseCaseAssessment,
    userId?: string,
  ) =>
    api.post(
      actorPath(
        `/companies/${row.companyId}/ai-use-cases/${row.id}/assessments`,
        userId,
      ),
      { ...assessment, expectedVersion: row.version },
    ),
  decide: (
    row: AIUseCaseView,
    action: "approve" | "suspend" | "retire",
    rationale: string,
    userId?: string,
  ) =>
    api.post<AIUseCaseView>(
      actorPath(
        `/companies/${row.companyId}/ai-use-cases/${row.id}/${action}`,
        userId,
      ),
      { expectedVersion: row.version, rationale },
    ),
  bind: (
    row: AIUseCaseView,
    issueId: string,
    agentId: string,
    userId?: string,
  ) =>
    api.post(
      actorPath(
        `/companies/${row.companyId}/ai-use-cases/${row.id}/deployments`,
        userId,
      ),
      { expectedVersion: row.version, issueId, agentId },
    ),
};
