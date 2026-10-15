import type {
  InstanceExperimentalSettingsWithManaged,
  InstanceGeneralSettings,
  InstanceSettings,
  PatchInstanceSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
} from "@paperclipai/shared";
import { api as defaultApi, detachInflightGet } from "./client";

export const createInstanceSettingsApi = (api: typeof defaultApi = defaultApi) => ({
  get: () =>
    api.get<InstanceSettings>("/instance/settings"),
  update: (patch: PatchInstanceSettings) =>
    api.patch<InstanceSettings>("/instance/settings", patch),
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettingsWithManaged>("/instance/settings/experimental", patch),
});

export const instanceSettingsApi = {
  ...createInstanceSettingsApi(),
  /** An account-bound directory cannot borrow a flag request from before its
   * current session check. Detach transport coalescing without aborting users. */
  getCurrentExperimental(signal?: AbortSignal) {
    const path = "/instance/settings/experimental";
    detachInflightGet(path);
    return defaultApi.get<InstanceExperimentalSettingsWithManaged>(path, { signal, cache: "no-store" });
  },
};
