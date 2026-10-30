import type { PreferredCoworkerPreference, SetPreferredCoworkerPreference, SidebarOrderPreference, UpsertSidebarOrderPreference } from "@paperclipai/shared";
import { api } from "./client";

export const sidebarPreferencesApi = {
  getCompanyOrder: () => api.get<SidebarOrderPreference>("/sidebar-preferences/me"),
  updateCompanyOrder: (data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>("/sidebar-preferences/me", data),
  getProjectOrder: (companyId: string) =>
    api.get<SidebarOrderPreference>(`/companies/${companyId}/sidebar-preferences/me`),
  updateProjectOrder: (companyId: string, data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>(`/companies/${companyId}/sidebar-preferences/me`, data),
  getPreferredCoworker: (companyId: string) =>
    api.get<PreferredCoworkerPreference>(`/companies/${companyId}/sidebar-preferences/preferred-coworker/me`),
  updatePreferredCoworker: (companyId: string, data: SetPreferredCoworkerPreference) =>
    api.put<PreferredCoworkerPreference>(`/companies/${companyId}/sidebar-preferences/preferred-coworker/me`, data),
};
