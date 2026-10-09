import {
  experienceModelSchema,
  type ExperienceProfile,
} from "@paperclipai/shared";
import { api } from "./client";
export const experienceQueryKey = (companyId: string, principal: string) =>
  ["experience", companyId, principal] as const;
export const experienceApi = {
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
    return experienceModelSchema.parse(
      await api.get(
        `/companies/${companyId}/experience?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
    );
  },
};
