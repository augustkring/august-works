import { experienceObservationPreferenceSchema, experienceObservationPreferenceReceiptSchema, experienceObservationReceiptSchema, experienceObservationSummarySchema,
  type ExperienceObservation, type ExperienceObservationPreferenceCommand } from "@paperclipai/shared";
import { api } from "./client";
const path = (company: string, principal: string, suffix = "") =>
  `/companies/${encodeURIComponent(company)}/experience/observations${suffix}?expectedUserId=${encodeURIComponent(principal)}`;
export const experienceObservationsApi = {
  async summary(company: string, principal: string, signal?: AbortSignal) {
    const value = experienceObservationSummarySchema.parse(await api.get(path(company, principal, "/summary"), { signal, cache: "no-store" }));
    if (value.companyId !== company) throw new Error("Observation summary context changed");
    return value;
  },
  async get(company: string, principal: string, signal?: AbortSignal) {
    const value = experienceObservationPreferenceSchema.parse(await api.get(path(company, principal, "/preference"), { signal, cache: "no-store" }));
    if (value.companyId !== company) throw new Error("Observation context changed");
    return value;
  },
  async update(company: string, principal: string, input: ExperienceObservationPreferenceCommand) {
    const value = experienceObservationPreferenceReceiptSchema.parse(await api.post(path(company, principal, "/preference"), input));
    if (value.companyId !== company || value.requestId !== input.requestId) throw new Error("Observation command context changed");
    return value;
  },
  async record(company: string, principal: string, input: ExperienceObservation) {
    const value = experienceObservationReceiptSchema.parse(await api.post(path(company, principal), input));
    if (value.requestId !== input.requestId) throw new Error("Observation receipt changed");
    return value;
  },
};
