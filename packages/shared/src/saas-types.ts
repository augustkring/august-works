import type { CommercialAccess, EntitlementMap } from "./billing/catalog.js";
export interface SaasRuntimeBackupPolicy {
  enabled: boolean; allowBriefPause: boolean; intervalHours: number; version: number;
  phase: string; nextDueAt: string; lastSuccessAt: string | null; errorCode: string | null;
}
export interface SaasCapabilities {
  profile: "saas";
  signup: boolean;
  emailVerification: boolean;
  onboarding: boolean;
  billing: boolean;
  checkout: boolean;
  runtime: boolean;
  usage: boolean;
  support: boolean;
  deletion: boolean;
  notifications: boolean;
}
export interface SaasOnboarding {
  id: string;
  companyId: string;
  billingAccountId: string;
  currentStage: string;
  status: string;
  version: number;
  answers: Record<string, unknown>;
}
export interface SaasBillingState {
  billingAccountId: string;
  access: CommercialAccess;
  commercialState?: "FREE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED" | "READ_ONLY";
  freeCore?: { active: boolean; catalogVersion: string; paymentMethodRequired: false };
  entitlements: EntitlementMap;
  catalogVersion: string;
  validUntil: string;
  subscriptions: {
    id: string;
    status: string;
    productKeys: string[];
    currentPeriodEnd: string | null;
    graceUntil: string | null;
    cancelAtPeriodEnd: boolean;
  }[];
  products: { key: string; label: string }[];
  prices: { productKey: string; priceKey: string }[];
  modelBilling: "byok_separate";
}
export interface SaasCheckout {
  id: string;
  status: string;
  checkoutUrl: string | null;
  expiresAt: string;
}
export interface SaasUsage {
  periodStart: string;
  periodEnd: string;
  meters: { meterKey: string; quantity: string; unit: string }[];
  providerModelCosts: "byok_separate";
  storage?: {
    usedBytes: string;
    includedBytes: string;
    scope: "billing_account";
  };
}
export interface SaasSession {
  id: string;
  createdAt: string;
  expiresAt: string;
}
export interface SaasRuntimeCell {
  id: string;
  companyId: string;
  isolationMode: string;
  capacityProfile: string;
  imageDigest: string | null;
  generation: string;
  status: string;
  lastHealthyAt: string | null;
  lastErrorCode: string | null;
  deletedAt: string | null;
  suspendedReason?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
  modelConfigured?: boolean;
}
export interface SaasRuntimeOptions {
  profiles: {
    commercialProductKey?: string;
    key: string;
    cpuMillis: number;
    memoryBytes: string;
    diskBytes: string;
  }[];
  versions: { imageDigest: string; providerVersion: string }[];
  dedicatedGateway: boolean;
  dedicatedVm: boolean;
}
export interface SaasSupportSession {
  id: string;
  companyId: string;
  operatorUserId: string;
  approvedByUserId: string;
  scopes: string[];
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
export interface SaasDeletion {
  id: string;
  companyId: string;
  status: string;
  stage: string;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  evidence: Record<string, unknown>;
}

export interface SaasNotification {
  id: string;
  companyId: string;
  category: string;
  title: string;
  relativePath: string;
  createdAt: string;
  readAt: string | null;
}
export interface SaasNotificationPreference {
  category: "security" | "billing" | "runtime" | "approval" | "work_update";
  emailEnabled: boolean;
}

export interface SaasRuntimeBackup {
  id: string;
  generation: string;
  imageDigest: string;
  stateFormat: string;
  status: string;
  byteSize: string | null;
  createdAt: string;
  verifiedAt: string | null;
  retainUntil: string;
  verificationErrorCode?: string | null;
}
