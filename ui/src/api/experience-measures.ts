import { experienceMeasuresSchema } from "@paperclipai/shared";
import { api } from "./client";
export const experienceMeasuresApi = {
  async get(company: string, principal: string, signal?: AbortSignal) {
    const view = experienceMeasuresSchema.parse(await api.get(
      `/companies/${encodeURIComponent(company)}/experience/analytics?expectedUserId=${encodeURIComponent(principal)}`,
      { signal, cache: "no-store" },
    ));
    if (view.companyId !== company) throw new Error("Experience measurement context changed");
    return view;
  },
};
