export interface SaasProviderInventory {
  environment: "staging" | "production";
  observedAt: string;
  resourceCount: number;
  untrackedCount: number;
  mismatchCount: number;
  untracked: string[];
  mismatched: string[];
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
