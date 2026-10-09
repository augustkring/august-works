import type { AssessProcessData, ProcessDataReadinessResult } from "@paperclipai/shared";
import { api } from "./client";
export const processDataReadinessApi = {
  assess: (companyId: string, input: AssessProcessData, expectedUserId?: string) =>
    api.post<ProcessDataReadinessResult>(`/companies/${encodeURIComponent(companyId)}/process-data-readiness${expectedUserId ? `?${new URLSearchParams({ expectedUserId })}` : ""}`,input),
};
