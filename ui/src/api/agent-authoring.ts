import {
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
  agentPackageSetupReviewSchema,
  agentPackageSetupReceiptSchema,
  type AgentPackageSetupCommand,
  type AgentDraftPublicationCommand,
  type AgentDraftTestCommand,
  type VerificationReviewInput,
  type AgentDraftPrepare,
  type AgentDraftSave,
} from "@paperclipai/shared";
import { api } from "./client";
const root = (company: string) =>
  `/companies/${company}/agent-configuration-drafts`;
const scope = (path: string, principal: string) =>
  `${path}?expectedUserId=${encodeURIComponent(principal)}`;
export interface AgentAuthoringOptions {
  owners: Array<{ id: string; name: string }>;
  knowledge: Array<{ id: string; title: string; sensitivity: string }>;
  runtimes: Array<{ id: string }>;
}
export const agentAuthoringApi = {
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
    const result = agentDraftAdmissionSchema.parse(
      await api.get(
        scope(`${root(company)}/admission`, principal) +
          `&agentId=${encodeURIComponent(agentId)}`,
        { signal, cache: "no-store" },
      ),
    );
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
