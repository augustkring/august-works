import type { JevDecisionSettings, JevDecisionSettingsUpdate } from "@paperclipai/shared";
import { api } from "./client";

export interface JevDecisionConnectionChoice { id: string; grantId: string; name: string; status: string; model: string }
export const jevDecisionApi = {
  get: (companyId: string) => api.get<{ settings: JevDecisionSettings; choices: JevDecisionConnectionChoice[]; suggestionsQualified: boolean }>(`/companies/${companyId}/jev-decisions`),
  update: (companyId: string, settings: JevDecisionSettingsUpdate) => api.put<{ settings: JevDecisionSettings; suggestionsQualified: boolean }>(`/companies/${companyId}/jev-decisions`, settings),
};
