import type {
  AutomationArtifact, AutomationArtifactDetail, CreateAutomationArtifact,
  AppendAutomationArtifactVersion, TransitionAutomationArtifactStatus,
} from "@paperclipai/shared";
import { api } from "./client";
const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/automation-artifacts`;
const account = (path: string, userId?: string | null) => userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
export const automationArtifactsApi = {
  list: (companyId: string, userId?: string | null) => api.get<AutomationArtifact[]>(account(base(companyId), userId), { cache: "no-store" }),
  get: (companyId: string, id: string, userId?: string | null) => api.get<AutomationArtifactDetail>(account(`${base(companyId)}/${encodeURIComponent(id)}`, userId), { cache: "no-store" }),
  create: (companyId: string, input: CreateAutomationArtifact) => api.post<AutomationArtifactDetail>(base(companyId), input),
  appendVersion: (companyId: string, id: string, input: AppendAutomationArtifactVersion) =>
    api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/versions`, input),
  evaluate: (companyId: string, id: string) => api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/evaluate`, {}),
  transition: (companyId: string, id: string, input: TransitionAutomationArtifactStatus) =>
    api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/status`, input),
  archive: (companyId: string, id: string, versionId: string) =>
    api.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/archive`, { expectedLatestVersionId: versionId }),
};
