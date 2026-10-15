import {
  experienceModelSchema,
  experienceCardSchema,
  type ExperienceToolCardRequest,
  type ExperienceProfile,
} from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";
export const experienceQueryKey = (companyId: string, principal: string) =>
  ["experience", companyId, principal] as const;
export const experienceApi = {
  async insightCard(request: ExperienceToolCardRequest, principal: string, signal: AbortSignal) {
    const path = `/companies/${request.companyId}/experience/insight-card?expectedUserId=${encodeURIComponent(principal)}&request=${encodeURIComponent(JSON.stringify(request))}`;
    detachInflightGet(path);
    const body = await api.get(path, { signal, cache: "no-store" }); signal.throwIfAborted();
    return experienceCardSchema.parse(body);
  },
  async setProfile(
    companyId: string,
    principal: string,
    profile: ExperienceProfile,
  ) {
    return api.post(
      `/companies/${companyId}/experience/profile?expectedUserId=${encodeURIComponent(principal)}`,
      { profile },
    );
  },
  async home(companyId: string, principal: string, signal?: AbortSignal) {
    const body = await api.get(
      `/companies/${companyId}/experience?expectedUserId=${encodeURIComponent(principal)}`,
      { signal, cache: "no-store" },
    );
    signal?.throwIfAborted();
    const result = experienceModelSchema.parse(body);
    if (result.companyId !== companyId)
      throw new Error("Company context changed");
    return result;
  },
};
