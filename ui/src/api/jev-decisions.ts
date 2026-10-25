import type { JevDecisionSettings, JevDecisionSettingsUpdate } from "@paperclipai/shared";
import { api } from "./client";

export interface JevDecisionConnectionChoice { id: string; grantId: string; name: string; status: string; model: string }
export interface JevDecisionSetupTestResult { status: string; model: string; inputTokens: number | null; outputTokens: number | null; costCents: string | null; costStatus: "reported" | "estimated" | "unpriced"; errorCode: string | null }
export interface JevDecisionHistoryEntry { id: string; model: string; status: string; reservedCostCents: string; actualCostCents: string | null; costStatus: "reported" | "estimated" | "unpriced"; currency: string; inputTokens: number | null; outputTokens: number | null; createdAt: string; completedAt: string | null }
export interface JevDecisionTestProfile { profileHash: string; costCapMinor: number; currency: string }
export const jevDecisionApi = {
  get: (companyId: string) => api.get<{ settings: JevDecisionSettings; choices: JevDecisionConnectionChoice[]; suggestionsQualified: boolean; testProfile: JevDecisionTestProfile | null }>(`/companies/${companyId}/jev-decisions`),
  update: (companyId: string, settings: JevDecisionSettingsUpdate) => api.put<{ settings: JevDecisionSettings; suggestionsQualified: boolean }>(`/companies/${companyId}/jev-decisions`, settings),
  setupTest: (companyId: string, input: { connectionId: string; grantId: string; profileHash: string; requestId: string }) => api.post<JevDecisionSetupTestResult>(`/companies/${companyId}/jev-decisions/test`, { disclosedPaidTestConsent: true, ...input }),
  history: (companyId: string) => api.get<JevDecisionHistoryEntry[]>(`/companies/${companyId}/jev-decisions/history`),
};
