import {
  agentManagedRuntimeSetupCatalogSchema, agentManagedRuntimeSetupCommandSchema,
  agentManagedRuntimeSetupReviewInputSchema, agentManagedRuntimeSetupReviewSchema, agentManagedRuntimeSetupReceiptSchema,
  type AgentManagedRuntimeSetupCommand,
  agentRuntimeCandidateCatalogSchema, agentRuntimeCandidateCreateSchema, agentRuntimeCandidateViewSchema,
  agentRuntimeCandidateConformanceCommandSchema, agentRuntimeCandidateConformanceReviewSchema, agentRuntimeCandidateConformanceReceiptSchema,
  type AgentRuntimeCandidateCreate, type AgentRuntimeCandidateConformanceCommand,
  agentAuthoringDraftPageSchema,
  agentAuthoringDraftViewSchema,
  agentAuthoringReviewSchema,
  hireAgentCatalogSchema,
  hireAgentCapabilityStatusSchema,
  agentDraftAdmissionSchema,
  agentDraftPreparationReviewSchema,
  agentDraftRuntimeViewSchema,
  agentDraftTestReviewSchema,
  agentDraftTestViewSchema,
  agentDraftTestPacketSchema,
  agentDraftPublicationReviewSchema,
  agentDraftPublicationReceiptSchema,
  agentModelMigrationMonitorReviewSchema,
  agentModelMigrationMonitorReceiptSchema,
  agentModelMigrationMonitorCommandSchema,
  agentPackageSetupReviewSchema,
  agentPackageSetupReceiptSchema,
  type AgentPackageSetupCommand,
  type AgentDraftPublicationCommand,
  type AgentModelMigrationMonitorCommand,
  type AgentDraftTestCommand,
  type VerificationReviewInput,
  type AgentDraftPrepare,
  type AgentDraftSave,
} from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";
const root = (company: string) =>
  `/companies/${company}/agent-configuration-drafts`;
const scope = (path: string, principal: string) =>
  `${path}?expectedUserId=${encodeURIComponent(principal)}`;
const candidatesPath = (company: string, draft: string, candidate?: string) => {
  uuid.parse(company); uuid.parse(draft);
  if (candidate !== undefined) uuid.parse(candidate);
  return `${root(company)}/${draft}/runtime-candidates${candidate ? `/${candidate}` : ""}`;
};
const uuid = agentRuntimeCandidateViewSchema.shape.id;
function candidateContext<T extends { companyId: string; draftId: string }>(value: T, company: string, draft: string) {
  if (value.companyId !== company || value.draftId !== draft) throw new Error("Runtime candidate context changed");
  return value;
}
export interface AgentAuthoringOptions {
  owners: Array<{ id: string; name: string }>;
  knowledge: Array<{ id: string; title: string; sensitivity: string; revision?: number }>;
  preferences?: Array<{ id: string; title: string; version: string; expiresAt: string; sensitivity: string }>;
  runtimes: Array<{ id: string }>;
}
export const agentAuthoringApi = {
  managedRuntimeCatalog: async (company: string, principal: string, draft: string, signal?: AbortSignal) => {
    uuid.parse(company); uuid.parse(draft);
    return candidateContext(agentManagedRuntimeSetupCatalogSchema.parse(await api.get(scope(`${root(company)}/${draft}/managed-runtime`, principal),
      { signal, cache: "no-store" })), company, draft);
  },
  latestManagedRuntimeReceipt: async (company: string, principal: string, draft: string, signal?: AbortSignal) => {
    uuid.parse(company); uuid.parse(draft);
    const result = agentManagedRuntimeSetupReceiptSchema.nullable().parse(await api.get(
      scope(`${root(company)}/${draft}/managed-runtime/requests`, principal), { signal, cache: "no-store" }));
    return result ? candidateContext(result, company, draft) : null;
  },
  managedRuntimeReview: async (company: string, principal: string, draft: string, raw: { capacityProfile: string; imageDigest: string }, signal?: AbortSignal) => {
    uuid.parse(company); uuid.parse(draft); const input = agentManagedRuntimeSetupReviewInputSchema.parse(raw);
    return candidateContext(agentManagedRuntimeSetupReviewSchema.parse(await api.get(
      scope(`${root(company)}/${draft}/managed-runtime/review`, principal) + `&${new URLSearchParams(input)}`, { signal, cache: "no-store" })), company, draft);
  },
  confirmManagedRuntime: async (company: string, principal: string, draft: string, raw: AgentManagedRuntimeSetupCommand) => {
    uuid.parse(company); uuid.parse(draft); const command = agentManagedRuntimeSetupCommandSchema.parse(raw);
    const result = candidateContext(agentManagedRuntimeSetupReceiptSchema.parse(await api.post(scope(`${root(company)}/${draft}/managed-runtime`, principal), command)), company, draft);
    if (result.requestId !== command.requestId) throw new Error("Managed provisioning request changed"); return result;
  },
  managedRuntimeReceipt: async (company: string, principal: string, draft: string, requestId: string, signal?: AbortSignal) => {
    uuid.parse(company); uuid.parse(draft); uuid.parse(requestId);
    const result = agentManagedRuntimeSetupReceiptSchema.nullable().parse(await api.get(
      scope(`${root(company)}/${draft}/managed-runtime/requests/${requestId}`, principal), { signal, cache: "no-store" }));
    if (!result) return null; candidateContext(result, company, draft);
    if (result.requestId !== requestId) throw new Error("Managed provisioning request changed"); return result;
  },
  packageSetupReview: async (company: string, principal: string, id: string, purposeId: string | null, signal?: AbortSignal) =>
    agentPackageSetupReviewSchema.parse(await api.get(scope(`${root(company)}/${id}/package-setup-review`, principal) +
      (purposeId ? `&purposeId=${encodeURIComponent(purposeId)}` : ""), { signal, cache: "no-store" })),
  packageSetupReceipt: async (company: string, principal: string, id: string, requestId: string, signal?: AbortSignal) => {
    const value = await api.get(scope(`${root(company)}/${id}/package-setup-receipt`, principal) + `&requestId=${encodeURIComponent(requestId)}`, { signal, cache: "no-store" });
    return value === null ? null : agentPackageSetupReceiptSchema.parse(value);
  },
  confirmPackageSetup: async (company: string, principal: string, id: string, command: AgentPackageSetupCommand) =>
    agentPackageSetupReceiptSchema.parse(await api.post(scope(`${root(company)}/${id}/package-setup`, principal), command)),
  publicationReview: async (company: string, principal: string, id: string, signal?: AbortSignal) =>
    agentDraftPublicationReviewSchema.parse(await api.get(scope(`${root(company)}/${id}/publication-review`, principal), { signal, cache: "no-store" })),
  publicationReceipt: async (company: string, principal: string, id: string, requestId?: string, signal?: AbortSignal) => {
    const result = await api.get(scope(`${root(company)}/${id}/publications${requestId ? `/${requestId}` : ""}`, principal), { signal, cache: "no-store" });
    return result === null ? null : agentDraftPublicationReceiptSchema.parse(result);
  },
  publish: async (company: string, principal: string, id: string, command: AgentDraftPublicationCommand) =>
    agentDraftPublicationReceiptSchema.parse(await api.post(scope(`${root(company)}/${id}/publish`, principal), command)),
  modelMigrationMonitorReview: async (company: string, principal: string, id: string, revisionId: string, signal?: AbortSignal) =>
    agentModelMigrationMonitorReviewSchema.parse(await api.get(scope(`${root(company)}/${id}/model-migrations/${revisionId}/monitor-review`, principal),
      { signal, cache: "no-store" })),
  currentModelMigrationMonitorReview: async (company: string, principal: string, id: string, signal?: AbortSignal) => {
    const value = await api.get(scope(`${root(company)}/${id}/model-migrations/current/monitor-review`, principal), { signal, cache: "no-store" });
    return value === null ? null : agentModelMigrationMonitorReviewSchema.parse(value);
  },
  modelMigrationMonitorReceipt: async (company: string, principal: string, id: string, revisionId: string, signal?: AbortSignal) => {
    const value = await api.get(scope(`${root(company)}/${id}/model-migrations/${revisionId}/monitor-receipt`, principal), { signal, cache: "no-store" });
    return value === null ? null : agentModelMigrationMonitorReceiptSchema.parse(value);
  },
  recordModelMigrationMonitor: async (company: string, principal: string, id: string, revisionId: string, raw: AgentModelMigrationMonitorCommand) => {
    const command = agentModelMigrationMonitorCommandSchema.parse(raw);
    const value = agentModelMigrationMonitorReceiptSchema.parse(await api.post(scope(`${root(company)}/${id}/model-migrations/${revisionId}/monitor`, principal), command));
    if (value.requestId !== command.requestId || value.migrationRevisionId !== revisionId) throw new Error("Model monitoring receipt changed");
    return value;
  },
  testVerificationPacket: async (company: string, principal: string, id: string, requestId: string, signal?: AbortSignal) =>
    agentDraftTestPacketSchema.parse(await api.get(scope(`${root(company)}/${id}/tests/${requestId}/verification-packet`, principal), { signal, cache: "no-store" })),
  verifyTest: async (company: string, principal: string, id: string, requestId: string, input: VerificationReviewInput) =>
    agentDraftTestViewSchema.parse(await api.post(scope(`${root(company)}/${id}/tests/${requestId}/verify`, principal), input)),
  testReview: async (company: string, principal: string, id: string, scenarioIndex: number, signal?: AbortSignal) =>
    agentDraftTestReviewSchema.parse(await api.get(scope(`${root(company)}/${id}/test-review`, principal) + `&scenarioIndex=${scenarioIndex}`, { signal, cache: "no-store" })),
  tests: async (company: string, principal: string, id: string, signal?: AbortSignal) => {
    const response = await api.get<unknown[]>(scope(`${root(company)}/${id}/tests`, principal), { signal, cache: "no-store" });
    return response.map(value => agentDraftTestViewSchema.parse(value));
  },
  testReceipt: async (company: string, principal: string, id: string, requestId: string, signal?: AbortSignal) => {
    const response = await api.get(scope(`${root(company)}/${id}/tests/${requestId}`, principal), { signal, cache: "no-store" });
    return response === null ? null : agentDraftTestViewSchema.parse(response);
  },
  startTest: async (company: string, principal: string, id: string, input: AgentDraftTestCommand) =>
    agentDraftTestViewSchema.parse(await api.post(scope(`${root(company)}/${id}/tests`, principal), input)),
  runtime: async (company: string, principal: string, id: string, signal?: AbortSignal) =>
    agentDraftRuntimeViewSchema.parse(await api.get(scope(`${root(company)}/${id}/runtime`, principal), { signal, cache: "no-store" })),
  runtimeCandidateCatalog: async (company: string, principal: string, draft: string, signal?: AbortSignal) =>
    candidateContext(agentRuntimeCandidateCatalogSchema.parse(await api.get(scope(candidatesPath(company, draft), principal),
      { signal, cache: "no-store" })), company, draft),
  createRuntimeCandidate: async (company: string, principal: string, draft: string, input: AgentRuntimeCandidateCreate) => {
    const command = agentRuntimeCandidateCreateSchema.parse(input);
    const value = candidateContext(agentRuntimeCandidateViewSchema.parse(await api.post(scope(candidatesPath(company, draft), principal), command)), company, draft);
    if (value.modelProfileId !== command.modelProfileId) throw new Error("Runtime candidate selector changed");
    return value;
  },
  runtimeCandidateCreationReceipt: async (company: string, principal: string, draft: string, request: string, signal?: AbortSignal) => {
    uuid.parse(request);
    const value = agentRuntimeCandidateViewSchema.nullable().parse(await api.get(scope(`${candidatesPath(company, draft)}/requests/${request}`, principal),
      { signal, cache: "no-store" }));
    return value ? candidateContext(value, company, draft) : null;
  },
  runtimeCandidate: async (company: string, principal: string, draft: string, candidate: string, signal?: AbortSignal) => {
    const value = candidateContext(agentRuntimeCandidateViewSchema.parse(await api.get(scope(candidatesPath(company, draft, candidate), principal),
      { signal, cache: "no-store" })), company, draft);
    if (value.id !== candidate) throw new Error("Runtime candidate identity changed");
    return value;
  },
  runtimeCandidateConformanceReview: async (company: string, principal: string, draft: string, candidate: string,
    input: { maximumCostCents: number; isolationPeer: { companyId: string; agentId: string } | null }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ maximumCostCents: String(input.maximumCostCents) });
    if (input.isolationPeer) { uuid.parse(input.isolationPeer.companyId); uuid.parse(input.isolationPeer.agentId);
      query.set("peerCompanyId", input.isolationPeer.companyId); query.set("peerAgentId", input.isolationPeer.agentId); }
    const value = candidateContext(agentRuntimeCandidateConformanceReviewSchema.parse(await api.get(
      scope(`${candidatesPath(company, draft, candidate)}/conformance-review`, principal) + `&${query}`, { signal, cache: "no-store" })), company, draft);
    if (value.candidateId !== candidate) throw new Error("Runtime qualification context changed");
    return value;
  },
  startRuntimeCandidateConformance: async (company: string, principal: string, draft: string, candidate: string,
    input: AgentRuntimeCandidateConformanceCommand) => {
    const command = agentRuntimeCandidateConformanceCommandSchema.parse(input);
    const value = candidateContext(agentRuntimeCandidateConformanceReceiptSchema.parse(await api.post(
      scope(`${candidatesPath(company, draft, candidate)}/conformance`, principal), command)), company, draft);
    if (value.candidateId !== candidate || value.requestId !== command.requestId) throw new Error("Runtime qualification receipt changed");
    return value;
  },
  runtimeCandidateConformanceReceipt: async (company: string, principal: string, draft: string, candidate: string, request: string, signal?: AbortSignal) => {
    uuid.parse(request);
    const value = agentRuntimeCandidateConformanceReceiptSchema.nullable().parse(await api.get(
      scope(`${candidatesPath(company, draft, candidate)}/conformance/requests/${request}`, principal), { signal, cache: "no-store" }));
    if (!value) return null;
    candidateContext(value, company, draft);
    if (value.candidateId !== candidate || value.requestId !== request) throw new Error("Runtime qualification receipt changed");
    return value;
  },
  preparationReview: async (company: string, principal: string, id: string, signal?: AbortSignal) =>
    agentDraftPreparationReviewSchema.parse(await api.get(scope(`${root(company)}/${id}/preparation-review`, principal),
      { signal, cache: "no-store" })),
  prepare: async (company: string, principal: string, id: string, input: AgentDraftPrepare) =>
    agentAuthoringDraftViewSchema.parse(await api.post(scope(`${root(company)}/${id}/prepare`, principal), input)),
  admission: async (
    company: string,
    principal: string,
    agentId: string,
    signal?: AbortSignal,
  ) => {
    const path = scope(`${root(company)}/admission`, principal) + `&agentId=${encodeURIComponent(agentId)}`;
    detachInflightGet(path);
    const result = agentDraftAdmissionSchema.parse(await api.get(path, { signal, cache: "no-store" }));
    if (result.companyId !== company || result.agentId !== agentId)
      throw new Error("Agent draft context changed");
    return result;
  },
  hireCapability: async (
    company: string,
    principal: string,
    id: string,
    signal?: AbortSignal,
  ) =>
    hireAgentCapabilityStatusSchema.parse(
      await api.get(
        scope(`${root(company)}/${id}/hire-capability`, principal),
        { signal, cache: "no-store" },
      ),
    ),
  hireCatalog: async (
    company: string,
    principal: string,
    signal?: AbortSignal,
  ) =>
    hireAgentCatalogSchema.parse(
      await api.get(scope(`${root(company)}/hire-catalog`, principal), {
        signal,
        cache: "no-store",
      }),
    ),
  list: async (
    company: string,
    principal: string,
    signal?: AbortSignal,
    before?: string,
  ) =>
    agentAuthoringDraftPageSchema.parse(
      await api.get(
        scope(root(company), principal) +
          (before ? `&before=${encodeURIComponent(before)}` : ""),
        { signal, cache: "no-store" },
      ),
    ),
  get: async (
    company: string,
    principal: string,
    id: string,
    signal?: AbortSignal,
  ) =>
    agentAuthoringDraftViewSchema.parse(
      await api.get(scope(`${root(company)}/${id}`, principal), {
        signal,
        cache: "no-store",
      }),
    ),
  options: (
    company: string,
    principal: string,
    agentId: string | null,
    signal?: AbortSignal,
  ) =>
    api.get<AgentAuthoringOptions>(
      scope(`${root(company)}/options`, principal) +
        (agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""),
      { signal, cache: "no-store" },
    ),
  create: async (
    company: string,
    principal: string,
    input: {
      requestId: string;
      agentId: string | null;
      packageVersionId?: string | null;
    },
  ) =>
    agentAuthoringDraftViewSchema.parse(
      await api.post(scope(root(company), principal), input),
    ),
  save: async (
    company: string,
    principal: string,
    id: string,
    input: AgentDraftSave,
  ) =>
    agentAuthoringDraftViewSchema.parse(
      await api.post(scope(`${root(company)}/${id}/save`, principal), input),
    ),
  discard: async (
    company: string,
    principal: string,
    id: string,
    input: { requestId: string; expectedVersion: number },
  ) =>
    agentAuthoringDraftViewSchema.parse(
      await api.post(scope(`${root(company)}/${id}/discard`, principal), input),
    ),
  review: async (
    company: string,
    principal: string,
    id: string,
    signal?: AbortSignal,
  ) =>
    agentAuthoringReviewSchema.parse(await api.get(
      scope(`${root(company)}/${id}/review`, principal),
      { signal, cache: "no-store" },
    )),
};
