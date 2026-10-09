import type { CrossProjectPlanningProfile, ProjectRoadmap } from "@paperclipai/shared";
import type { JointPlanningControls, JointPlanningDetail, JointPlanningPreview } from "@/api/cross-project-planning";
import { planningFixture } from "./project-planning-fixtures";
// Cached synthetic presentation only; none of these bytes qualify native Sources.
export function jointPlanningFixture(stale = false) {
  const f = planningFixture(), projectId = "00000000-0000-4000-8000-000000002401", taskId = "00000000-0000-4000-8000-000000002402", id = "00000000-0000-4000-8000-000000002403";
  const first = { ...f.roadmap, projectName: "First project" };
  const second: ProjectRoadmap = { ...structuredClone(f.roadmap), projectId, projectName: "Second project", tasks: [{ ...f.roadmap.tasks[0], id: taskId, title: "Resolve native dependency", identifier: "SYN-2" }], dependencies: [] };
  const profile: CrossProjectPlanningProfile = { ...structuredClone(f.profile), projects: [first, second].map(source => ({ id: source.projectId, expectedUpdatedAt: source.projectUpdatedAt })), tasks: [...f.profile.tasks, { ...structuredClone(f.profile.tasks[0]), key: taskId }] };
  const result = { ...f.result, schedule: [...f.result.schedule, { taskKey: taskId, startDay: 2, endDay: 4 }], criticalPath: { taskKeys: [f.taskId, taskId], earliestCompletionDay: 4 } };
  const response: JointPlanningPreview = { ...f.response, result, authority: "human_cross_project_roadmap_review_required" };
  const detail: JointPlanningDetail = { id, companyId: f.companyId, status: "proposed", revision: 1, reason: "Human proposes this synthetic complete joint schedule for a separate review", contextHash: f.detail.contextHash, appliedRoadmapRefs: [], currentQualification: stale ? "needs_revalidation" : "current", context: { profile, sourceSnapshots: [f.detail.context.sourceSnapshot, { ...f.detail.context.sourceSnapshot, projectId, tasks: [{ ...f.detail.context.sourceSnapshot.tasks[0], id: taskId }], dependencies: [{ before: f.taskId, after: taskId }] }], evidence: [], snapshotHash: response.snapshotHash, result, capturedAt: f.response.capturedAt, expiresAt: response.expiresAt, authority: response.authority } };
  const controls: JointPlanningControls = { items: [{ id, status: "proposed", revision: 1 }], nextCursor: null, coverage: "bounded_native_joint_proposal_metadata" };
  const options = { items: [first, second].map(source => ({ title: source.projectName, source: { kind: "canonical" as const, reference: { type: "project" as const, id: source.projectId } } })), coverage: "bounded_authorized_native_choices" as const };
  return { ...f, id, projectId, taskId, sources: [first, second], profile, result, response, detail, controls, options };
}
