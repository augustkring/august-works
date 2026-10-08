import type { CrossProjectPlanningContext, CrossProjectPlanningProfile, ManagementSourceOptions, NativePlanningResult, PortfolioPlanningProfile, PortfolioPlanningPreview } from "@paperclipai/shared";
import { api } from "./client";
export type JointPlanningStatus = "proposed" | "under_review" | "accepted" | "rejected" | "cancelled";
export interface JointPlanningDetail { id: string; companyId: string; status: JointPlanningStatus; revision: number; context: CrossProjectPlanningContext; contextHash: string; reason: string; appliedRoadmapRefs: Array<{ projectId: string; proposalId: string }>; currentQualification: "current" | "needs_revalidation"; }
export interface JointPlanningPreview { snapshotHash: string; result: NativePlanningResult; runtimeMs: number; expiresAt: string; authority: "human_cross_project_roadmap_review_required"; }
export interface JointPlanningControls { items: Array<{ id: string; status: JointPlanningStatus; revision: number }>; nextCursor: string | null; coverage: "bounded_native_joint_proposal_metadata"; }
const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/adaptive-planning`;
const account = (path: string, userId?: string | null) => userId ? `${path}${path.includes("?") ? "&" : "?"}expectedUserId=${encodeURIComponent(userId)}` : path;
export const crossProjectPlanningApi = {
  sourceOptions: (companyId: string, q: string, userId?: string | null) => api.get<ManagementSourceOptions>(account(`${base(companyId)}/source-options?q=${encodeURIComponent(q)}`, userId), { cache: "no-store" }),
  preview: (companyId: string, profile: CrossProjectPlanningProfile, userId?: string | null) => api.post<JointPlanningPreview>(account(`${base(companyId)}/preview`, userId), profile),
  previewInitiatives: (companyId: string, profile: PortfolioPlanningProfile, userId?: string | null) => api.post<PortfolioPlanningPreview>(account(`${base(companyId)}/initiatives/preview`, userId), profile),
  propose: (companyId: string, profile: CrossProjectPlanningProfile, expectedSnapshotHash: string, reason: string, userId?: string | null) => api.post<Omit<JointPlanningDetail, "currentQualification">>(account(`${base(companyId)}/proposals`, userId), { profile, expectedSnapshotHash, reason }),
  controls: (companyId: string, cursor?: string, userId?: string | null) => api.get<JointPlanningControls>(account(`${base(companyId)}/controls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, userId), { cache: "no-store" }),
  detail: (companyId: string, id: string, userId?: string | null) => api.get<JointPlanningDetail>(account(`${base(companyId)}/proposals/${encodeURIComponent(id)}`, userId), { cache: "no-store" }),
  review: (companyId: string, id: string, expectedRevision: number, action: "begin_review" | "accept" | "reject" | "cancel", rationale: string, userId?: string | null) => api.post<Pick<JointPlanningDetail, "id" | "companyId" | "status" | "revision" | "appliedRoadmapRefs">>(account(`${base(companyId)}/proposals/${encodeURIComponent(id)}/review`, userId), { expectedRevision, action, rationale }),
};
