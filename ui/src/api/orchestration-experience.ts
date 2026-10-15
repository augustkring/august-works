import { orchestrationExperienceSchema } from "@paperclipai/shared";
import { api } from "./client";

export async function getOrchestrationExperience(company: string, principal: string, signal?: AbortSignal) {
  orchestrationExperienceSchema.shape.companyId.parse(company);
  const query = new URLSearchParams({ expectedUserId: principal });
  const value = orchestrationExperienceSchema.parse(await api.get(`/companies/${company}/experience/orchestration?${query}`, { signal, cache: "no-store" }));
  signal?.throwIfAborted();
  if (value.companyId !== company) throw new Error("Current work status scope changed");
  return value;
}
