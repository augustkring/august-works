import { AW_DEPLOYMENT_PROFILES, type AwDeploymentProfile } from "@paperclipai/shared/aw-deployment";

type DeploymentEnv = Record<string, string | undefined>;

export function hasLegacyManagedSignal(env: DeploymentEnv): boolean {
  return Boolean(env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN?.trim()) || env.PAPERCLIP_MANAGED_CONFIG !== undefined;
}

export function resolveAwDeploymentProfile(env: DeploymentEnv = process.env): AwDeploymentProfile {
  const explicit = env.AW_DEPLOYMENT_PROFILE?.trim();
  if (!explicit) return hasLegacyManagedSignal(env) ? "legacy_managed_stack" : "local";
  if (!AW_DEPLOYMENT_PROFILES.includes(explicit as AwDeploymentProfile)) {
    throw new Error("AW_DEPLOYMENT_PROFILE must be local, legacy_managed_stack or saas");
  }
  if (explicit !== "legacy_managed_stack" && hasLegacyManagedSignal(env)) {
    throw new Error("Remove legacy Cloud credentials/config before selecting a local or SaaS profile");
  }
  return explicit as AwDeploymentProfile;
}

export function isSaasDeployment(env: DeploymentEnv = process.env): boolean {
  return resolveAwDeploymentProfile(env) === "saas";
}

