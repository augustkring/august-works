import { experienceCommandsSchema } from "@paperclipai/shared";
import { api } from "./client";
export const experienceCommandsKey = (companyId: string, principal: string) =>
  ["experience-commands", companyId, principal] as const;
export async function getExperienceCommands(
  companyId: string,
  principal: string,
  query: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ expectedUserId: principal, q: query });
  const result = experienceCommandsSchema.parse(
    await api.get(`/companies/${companyId}/experience/commands?${params}`, {
      signal,
      cache: "no-store",
    }),
  );
  if (result.companyId !== companyId)
    throw new Error("Command company changed");
  return result;
}
