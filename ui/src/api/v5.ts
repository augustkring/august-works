import type { AgentIdentity, AgentExecutionManifest, ExecutionManifestCapability, PlaybookSummary, PlaybookReviewResult, ProjectRoadmap, PortfolioCompanySummary, RolePackItem, CreatePlaybookInput, PlaybookDraftInput, UpdatePlaybookMetadataInput, ReviewPlaybookInput, ProjectPlaybookSkillInput, RoadmapProposalRequest, CreateMilestoneInput, CreateAgentIdentityInput, AddAgentPresenceInput, CreateExecutionScopeRequest } from "@paperclipai/shared";
import { api } from "./client";

export interface PlaybookDetail extends Omit<PlaybookSummary, "title" | "latestRevisionId"> {
  updatedAt: string;
  document: { title: string | null; latestBody: string; latestRevisionId: string; latestRevisionNumber: number };
  revisions: Array<{ id: string; revisionNumber: number; changeSummary: string | null; createdAt: string }>;
  proposals: Array<{ id: string; title: string; markdown: string; reason: string; status: string }>;
  links: Array<{ id: string; skillId: string; skillVersionId: string; playbookRevisionId: string; relationType: string; syncPolicy: string; drifted: boolean }>;
}
export interface RolePackSummary { id: string; key: string; name: string; description: string; publishedVersionId: string | null }
export interface RolePackDetail extends RolePackSummary { versions: Array<{ id: string; revisionNumber: number; summary: string; state: "draft" | "published" }> }
export interface IdentityPresence { id: string; name: string; status: string; homeCompanyId: string; agentId: string }
export interface ProviderPresence { provider: { id: string; providerType: string; providerAgentRef: string; isolationMode: string; status: string; capabilitySnapshot: { hash: string; version: string; features: Record<string, boolean> } | null }; runtime: { providerProfileRef: string; providerSessionNamespace: string; status: string; isolationAcknowledgedAt: string | null } }
export interface PortfolioRelease { id: string; companyId: string; assetType: "skill" | "playbook"; assetId: string; versionId: string; title: string; key: string; classification: string; hash: string; releaseNotes: string; createdAt: string }
export interface PortfolioSubscription { id: string; assetType: string; localSkillId: string | null; localPlaybookId: string | null; sourceCompanyId: string; pinnedSourceVersionId: string; mode: string; sourceAvailable: boolean; updateAvailable: boolean; availablePublicationId: string | null }
const company = (id: string) => `/companies/${encodeURIComponent(id)}`;
const playbook = (cid: string, id: string) => `${company(cid)}/playbooks/${encodeURIComponent(id)}`;
const roadmap = (cid: string, pid: string) => `${company(cid)}/projects/${encodeURIComponent(pid)}/roadmap`;
export const v5Api = {
  playbooks: (cid: string) => api.get<PlaybookSummary[]>(`${company(cid)}/playbooks`),
  playbook: (cid: string, id: string) => api.get<PlaybookDetail>(playbook(cid, id)),
  revision: (cid: string, id: string, rid: string) => api.get<{ id: string; title: string | null; body: string }>(`${playbook(cid, id)}/revisions/${encodeURIComponent(rid)}`),
  createPlaybook: (cid: string, input: CreatePlaybookInput) => api.post<{ id: string }>(`${company(cid)}/playbooks`, input),
  draftPlaybook: (cid: string, id: string, input: PlaybookDraftInput) => api.patch(`${playbook(cid, id)}/draft`, input),
  updatePlaybookMetadata: (cid: string, id: string, input: UpdatePlaybookMetadataInput) => api.patch(`${playbook(cid, id)}/metadata`, input),
  reviewPlaybook: (cid: string, id: string, input: ReviewPlaybookInput) => api.post<PlaybookReviewResult>(`${playbook(cid, id)}/review`, input),
  reviewPlaybookProposal: (cid: string, id: string, proposalId: string, accept: boolean, rationale: string) => api.post(`${playbook(cid, id)}/proposals/${encodeURIComponent(proposalId)}/review`, { accept, rationale }),
  projectSkill: (cid: string, id: string, input: ProjectPlaybookSkillInput) => api.post(`${playbook(cid, id)}/compile-skill-candidate`, input),
  roadmap: (cid: string, pid: string) => api.get<ProjectRoadmap>(roadmap(cid, pid)),
  planProposal: (cid: string, pid: string, input: RoadmapProposalRequest) => api.post(`${roadmap(cid, pid)}/proposals`, input),
  reviewPlan: (cid: string, pid: string, id: string, accept: boolean, rationale: string) => api.post(`${roadmap(cid, pid)}/proposals/${encodeURIComponent(id)}/review`, { accept, rationale }),
  baseline: (cid: string, pid: string, name: string) => api.post(`${roadmap(cid, pid)}/baselines`, { name }),
  milestone: (cid: string, pid: string, input: CreateMilestoneInput) => api.post(`${roadmap(cid, pid)}/milestones`, input),
  identities: (cid: string) => api.get<IdentityPresence[]>(`${company(cid)}/agent-identities`),
  createIdentity: (input: CreateAgentIdentityInput) => api.post<{ identity: AgentIdentity; presence: { id: string } }>(`${company(input.homeCompanyId)}/agent-identities`, input),
  addPresence: (cid: string, id: string, input: AddAgentPresenceInput) => api.post(`${company(cid)}/agent-identities/${encodeURIComponent(id)}/presences`, input),
  updateIdentity: (cid: string, id: string, status: AgentIdentity["status"]) => api.patch(`${company(cid)}/agent-identities/${encodeURIComponent(id)}`, { status }),
  rehomeIdentity: (cid: string, id: string, homeCompanyId: string) => api.post(`${company(cid)}/agent-identities/${encodeURIComponent(id)}/rehome`, { homeCompanyId }),
  provider: (cid: string, aid: string) => api.get<ProviderPresence | null>(`${company(cid)}/agents/${encodeURIComponent(aid)}/provider-binding`),
  execute: (cid: string, aid: string, input: CreateExecutionScopeRequest) => api.post(`${company(cid)}/agents/${encodeURIComponent(aid)}/runtime/execute`, input),
  manifest: (cid: string, rid: string) => api.get<{ id: string; hash: string; manifest: AgentExecutionManifest }>(`${company(cid)}/runs/${encodeURIComponent(rid)}/execution-manifest`),
  capabilities: (cid: string, query = "") => api.get<ExecutionManifestCapability[]>(`${company(cid)}/runtime/capabilities?q=${encodeURIComponent(query)}`),
  rolePacks: (cid: string) => api.get<RolePackSummary[]>(`${company(cid)}/role-packs`),
  rolePack: (cid: string, id: string) => api.get<RolePackDetail>(`${company(cid)}/role-packs/${encodeURIComponent(id)}`),
  roleVersion: (cid: string, id: string, vid: string) => api.get<{ id: string; state: "draft" | "published"; items: RolePackItem[] }>(`${company(cid)}/role-packs/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}`),
  roleCatalog: (cid: string) => api.get<Array<{ key: string; name: string; version: string; items: RolePackItem[] }>>(`${company(cid)}/role-packs/catalog`),
  portfolio: (companyIds: string[]) => api.post<{ companies: PortfolioCompanySummary[]; unavailableCompanyIds: string[] }>("/portfolio/summary", { companyIds }),
  releases: (cid: string) => api.get<PortfolioRelease[]>(`${company(cid)}/portfolio-capabilities`),
  subscriptions: (cid: string) => api.get<PortfolioSubscription[]>(`${company(cid)}/portfolio-capabilities/subscriptions`),
  install: (cid: string, publicationId: string, localKey: string, mode: "install" | "subscribe" | "fork") => api.post(`${company(cid)}/portfolio-capabilities/install`, { publicationId, localKey, mode }),
};
