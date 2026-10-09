import {
  agentAuthoringDraftPageSchema,
  agentAuthoringDraftViewSchema,
  hireAgentCatalogSchema,
  hireAgentCapabilityStatusSchema,
  agentDraftAdmissionSchema,
  type AgentDraftSave,
  type AgentAuthoringReview,
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
  review: (
    company: string,
    principal: string,
    id: string,
    signal?: AbortSignal,
  ) =>
    api.get<AgentAuthoringReview>(
      scope(`${root(company)}/${id}/review`, principal),
      { signal, cache: "no-store" },
    ),
};
