import type {
  AutomationArtifact, AutomationArtifactDetail, CreateAutomationArtifact,
  AppendAutomationArtifactVersion, TransitionAutomationArtifactStatus,
} from "@paperclipai/shared";
import { api } from "./client";
const base = (companyId: string) => `/companies/${companyId}/automation-artifacts`;
export const automationArtifactsApi = {
  list: (companyId: string) => api.get<AutomationArtifact[]>(base(companyId)),
  get: (companyId: string, id: string) => api.get<AutomationArtifactDetail>(`${base(companyId)}/${id}`),
  create: (companyId: string, input: CreateAutomationArtifact) => api.post<AutomationArtifactDetail>(base(companyId), input),
  appendVersion: (companyId: string, id: string, input: AppendAutomationArtifactVersion) =>
    api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/versions`, input),
  evaluate: (companyId: string, id: string) => api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/evaluate`, {}),
  transition: (companyId: string, id: string, input: TransitionAutomationArtifactStatus) =>
    api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/status`, input),
  archive: (companyId: string, id: string, versionId: string) =>
    api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/archive`, { expectedLatestVersionId: versionId }),
};
