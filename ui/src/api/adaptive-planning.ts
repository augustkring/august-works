import type { NativePlanningResult, ProjectPlanningContext, ProjectPlanningProfile, ProposeProjectPlanning } from "@paperclipai/shared";
import { api } from "./client";

const base = (companyId: string, projectId: string) => `/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/roadmap/planning`;
const account = (path: string, userId?: string | null) => userId ? `${path}${path.includes("?") ? "&" : "?"}expectedUserId=${encodeURIComponent(userId)}` : path;
export interface ProjectPlanningPreview {
  snapshotHash: string;
  result: NativePlanningResult;
  runtimeMs: number;
  capturedAt: string;
  expiresAt: string;
  authority: "human_roadmap_review_required";
}
export interface ProjectPlanningDetail {
  id: string;
  companyId: string;
  projectId: string;
  status: "pending" | "accepted" | "rejected" | "stale";
  reason: string;
  context: ProjectPlanningContext;
  contextHash: string;
  currentQualification: "current" | "needs_revalidation";
}
export interface ProjectPlanningControls {
  proposals: Array<{ id: string; status: ProjectPlanningDetail["status"] }>;
  hasMore: boolean;
  nextCursor: string | null;
}
export const adaptivePlanningApi = {
  preview: (companyId: string, projectId: string, profile: ProjectPlanningProfile, userId?: string | null) => api.post<ProjectPlanningPreview>(account(`${base(companyId, projectId)}/preview`, userId), profile),
  propose: (companyId: string, projectId: string, input: ProposeProjectPlanning, userId?: string | null) => api.post<Omit<ProjectPlanningDetail, "currentQualification">>(account(`${base(companyId, projectId)}/proposals`, userId), input),
  controls: (companyId: string, projectId: string, cursor?: string, userId?: string | null) => api.get<ProjectPlanningControls>(account(`${base(companyId, projectId)}/controls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, userId), { cache: "no-store" }),
  detail: (companyId: string, projectId: string, id: string, userId?: string | null) => api.get<ProjectPlanningDetail>(account(`${base(companyId, projectId)}/proposals/${encodeURIComponent(id)}`, userId), { cache: "no-store" }),
  review: (companyId: string, projectId: string, id: string, accept: boolean, rationale: string, userId?: string | null) => api.post<{ id: string; companyId: string; projectId: string; status: ProjectPlanningDetail["status"]; updatedAt: string }>(account(`${base(companyId, projectId)}/proposals/${encodeURIComponent(id)}/review`, userId), { accept, rationale }),
};
