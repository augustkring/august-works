export interface SaasProviderInventory {
  environment: "staging" | "production";
  observedAt: string;
  resourceCount: number;
  untrackedCount: number;
  mismatchCount: number;
  untracked: string[];
  mismatched: string[];
}
export interface SaasModelDependencyInventory {
  observedAt: string;
  truncated: boolean;
  unresolvedAgentBindings: number;
  coverage: {
    dependency: "agent_runtime" | "worker_qualification_profile" | "read_only_verifier" | "first_party_support" | "jev_skill_suggestion";
    configuration: "database_inventory" | "configured" | "unconfigured";
    entries: number;
    untracked: number;
    unresolved: number;
  }[];
  entries: {
    dependency: "agent_runtime" | "worker_qualification_profile" | "read_only_verifier" | "first_party_support" | "jev_skill_suggestion";
    companyId: string;
    agentId: string | null;
    runtimeAdapter: string | null;
    provider: string | null;
    model: string | null;
    modelVersionOrReleaseIdentity: string | null;
    lifecycleStatus: "candidate" | "qualifying" | "qualified" | "active" | "deprecated" | "migration_required" | "blocked" | "retired" | "untracked";
    lifecycleOwner: string | null;
    retirementAt: string | null;
    qualificationHash: string | null;
    regionOrRoutingProfile: string | null;
    dataUseProfile: string | null;
    supportedInputOutput: ("text" | "image" | "audio" | "video")[] | null;
    toolUseCapability: boolean | null;
    contextLimits: { inputTokensUpperBound: number; maxOutputTokens: number; maximumEnvelopeBytes: number | null } | null;
    costProfile: {
      currency: string;
      model: string;
      inputMinorPerMillion: number;
      outputMinorPerMillion: number;
      fixedMinor: number;
      expiresAt: string;
    } | null;
    rateLimits: { requestsPerMinute: number | null; tokensPerMinute: number | null } | null;
    runtimeAvailability: "not_assessed";
    bindingState: "unresolved" | "qualification_profile_unresolved" | "qualified_profile_bound" |
      "provider_model_configured" | "provider_model_unresolved" | "adapter_model_not_reported" |
      "configured_profile" | "configured_not_current_agent_runtime";
  }[];
}
export interface SaasOperationsSnapshot {
  environment: "staging" | "production";
  jobs: {
    jobKey: string;
    leaseUntil: string;
    lastSuccessAt: string | null;
    lastErrorCode: string | null;
  }[];
  queues: { domain: string; status: string; count: string }[];
  hosts: {
    id: string;
    status: string;
    region: string;
    lastHeartbeatAt: string | null;
    fencedAt: string | null;
    cpuTotalMillis: number;
    cpuReservedMillis: number;
  }[];
  profiles: {
    key: string;
    commercialProductKey: string;
    cpuMillis: number;
    memoryBytes: string;
    diskBytes: string;
    qualified: boolean;
  }[];
  versions: {
    imageDigest: string;
    providerVersion: string;
    stateFormat: string;
    status: string;
    approvedAt: string | null;
  }[];
  support: {
    id: string;
    companyId: string;
    scopes: string[];
    expiresAt: string;
  }[];
  deployments: {
    sourceSha: string;
    imageDigest: string;
    schemaVersion: string;
    environment: string;
    verificationResult: string;
    deployedAt: string;
  }[];
  modelDependencies: SaasModelDependencyInventory;
}
export interface SaasSupportStatus {
  companyId: string;
  runtimes: {
    id: string;
    status: string;
    lastHealthyAt: string | null;
    lastErrorCode: string | null;
    generation: string;
  }[];
}
