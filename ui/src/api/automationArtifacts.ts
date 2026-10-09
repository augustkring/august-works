import type {
  AutomationArtifact, AutomationArtifactDetail, CreateAutomationArtifact,
  AppendAutomationArtifactVersion, TransitionAutomationArtifactStatus,
} from "@paperclipai/shared";
import { api } from "./client";
const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/automation-artifacts`;
const account = (path: string, userId?: string | null) => userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
export const createAutomationArtifactsApi = (client:typeof api=api) => ({
  list: (companyId: string, userId?: string | null) => client.get<AutomationArtifact[]>(account(base(companyId), userId), { cache: "no-store" }),
  get: (companyId: string, id: string, userId?: string | null) => client.get<AutomationArtifactDetail>(account(`${base(companyId)}/${encodeURIComponent(id)}`, userId), { cache: "no-store" }),
  create: (companyId: string, input: CreateAutomationArtifact) => client.post<AutomationArtifactDetail>(base(companyId), input),
  appendVersion: (companyId: string, id: string, input: AppendAutomationArtifactVersion) =>
    client.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/versions`, input),
  evaluate: (companyId: string, id: string) => client.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/evaluate`, {}),
  transition: (companyId: string, id: string, input: TransitionAutomationArtifactStatus) =>
    client.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/status`, input),
  archive: (companyId: string, id: string, versionId: string) =>
    client.post<AutomationArtifactDetail>(`${base(companyId)}/${id}/archive`, { expectedLatestVersionId: versionId }),
});
export const automationArtifactsApi=createAutomationArtifactsApi();
