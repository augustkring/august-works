import type { CreateProcessAnalysisDefinition, ProcessAnalysisDefinition, ProcessAnalysisDefinitionDetail, ProcessAnalysisDefinitionView,
  ProcessAnalysisRunView, ProcessAnalysisVersionView, PublishProcessAnalysisDefinition, RetireProcessAnalysisDefinition,
  ReviseProcessAnalysisDefinition, RunProcessAnalysis, CreateProcessFinding, ProcessFindingView, ProcessFindingTransitionView, TransitionProcessFinding } from "@paperclipai/shared";
import { api } from "./client";
function path(companyId: string, suffix: string, expectedUserId?: string) {
  return `/companies/${encodeURIComponent(companyId)}/process-definitions${suffix}${expectedUserId ? `?${new URLSearchParams({ expectedUserId })}` : ""}`;
}
const pin = (id: string) => `/${encodeURIComponent(id)}`;
export const processAnalysisApi = {
  list: (companyId: string, cursor?: string, expectedUserId?: string) => {
    const query = new URLSearchParams(); if (cursor) query.set("cursor", cursor); if (expectedUserId) query.set("expectedUserId", expectedUserId);
    return api.get<{ items: (ProcessAnalysisDefinitionView & { definition: ProcessAnalysisDefinition; nextReviewAt: string; expiresAt: string; reviewReason: string | null })[];
      nextCursor: string | null; coverage: "bounded_current_authorized_page" }>(`${path(companyId, "")}${query.size ? `?${query}` : ""}`, { cache: "no-store" });
  },
  detail: (companyId: string, id: string, expectedUserId?: string) => api.get<ProcessAnalysisDefinitionDetail>(path(companyId, pin(id), expectedUserId), { cache: "no-store" }),
  create: (companyId: string, input: CreateProcessAnalysisDefinition, expectedUserId?: string) => api.post<{ root: ProcessAnalysisDefinitionView; version: ProcessAnalysisVersionView }>(path(companyId, "", expectedUserId), input),
  revise: (companyId: string, id: string, input: ReviseProcessAnalysisDefinition, expectedUserId?: string) => api.post<ProcessAnalysisVersionView>(path(companyId, `${pin(id)}/versions`, expectedUserId), input),
  publish: (companyId: string, id: string, input: PublishProcessAnalysisDefinition, expectedUserId?: string) => api.post<ProcessAnalysisDefinitionView>(path(companyId, `${pin(id)}/publish`, expectedUserId), input),
  retire: (companyId: string, id: string, input: RetireProcessAnalysisDefinition, expectedUserId?: string) => api.post<ProcessAnalysisDefinitionView>(path(companyId, `${pin(id)}/retire`, expectedUserId), input),
  run: (companyId: string, id: string, input: RunProcessAnalysis, expectedUserId?: string) => api.post<ProcessAnalysisRunView>(path(companyId, `${pin(id)}/runs`, expectedUserId), input),
  getRun: (companyId: string, id: string, runId: string, expectedUserId?: string) => api.get<ProcessAnalysisRunView>(path(companyId, `${pin(id)}/runs/${encodeURIComponent(runId)}`, expectedUserId), { cache: "no-store" }),
  listRuns: (companyId:string,id:string,cursor?:string,expectedUserId?:string)=>{
    const query=new URLSearchParams();if(cursor) query.set("cursor",cursor);if(expectedUserId) query.set("expectedUserId",expectedUserId);
    return api.get<{items:ProcessAnalysisRunView[];nextCursor:string|null;coverage:"bounded_current_authorized_page"}>(`${path(companyId,`${pin(id)}/runs`)}${query.size ? `?${query}` : ""}`,{cache:"no-store"});
  },
  listFindings: (companyId: string, id: string, runId: string, cursor?: string, expectedUserId?: string) => {
    const query = new URLSearchParams(); if (cursor) query.set("cursor", cursor); if (expectedUserId) query.set("expectedUserId", expectedUserId);
    return api.get<{ items: ProcessFindingView[]; nextCursor: string | null }>(`${path(companyId, `${pin(id)}/runs/${encodeURIComponent(runId)}/findings`)}${query.size ? `?${query}` : ""}`, { cache: "no-store" });
  },
  createFinding: (companyId: string, id: string, runId: string, input: CreateProcessFinding, expectedUserId?: string) => api.post<ProcessFindingView>(path(companyId, `${pin(id)}/runs/${encodeURIComponent(runId)}/findings`, expectedUserId), input),
  findingDetail: (companyId: string, id: string, runId: string, findingId: string, expectedUserId?: string) => api.get<{ finding: ProcessFindingView; transitions: ProcessFindingTransitionView[]; hasMoreTransitions: boolean }>(path(companyId, `${pin(id)}/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}`, expectedUserId), { cache: "no-store" }),
  transitionFinding: (companyId: string, id: string, runId: string, findingId: string, input: TransitionProcessFinding, expectedUserId?: string) => api.post<ProcessFindingView>(path(companyId, `${pin(id)}/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}/transition`, expectedUserId), input),
};
