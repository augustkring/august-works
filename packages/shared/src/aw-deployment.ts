/** Deployment ownership is independent of authentication and feature rollout. */
export const AW_DEPLOYMENT_PROFILES = ["local", "legacy_managed_stack", "saas"] as const;
export type AwDeploymentProfile = (typeof AW_DEPLOYMENT_PROFILES)[number];

export interface PublicOriginConfig {
  primaryAppOrigin: string;
  allowedAppOrigins: string[];
  legacyOrigins: string[];
}
