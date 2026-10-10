import type {
  RuntimeVersionCandidate,
  RuntimeVersionTransition,
  RuntimeCapacityQualification,
  SaasOperationsSnapshot,
  SaasProviderInventory,
  SaasCostSnapshot,
  SaasSupportStatus,
  SaasRuntimeBackup,
  SaasRuntimeBackupPolicy,
  SaasNotification,
  SaasNotificationPreference,
  SaasRuntimeCell,
  SaasRuntimeOptions,
  SaasSupportSession,
  SaasDeletion,
  SaasBillingState,
  SaasCapabilities,
  SaasCheckout,
  SaasOnboarding,
  SaasSession,
  SaasUsage,
} from "@paperclipai/shared";
import { api, ApiError } from "./client";
const companyPath = (id: string) => "/companies/" + encodeURIComponent(id);
const scoped = (path: string, userId: string) =>
  path +
  (path.includes("?") ? "&" : "?") +
  "expectedUserId=" +
  encodeURIComponent(userId);
export const saasApi = {
  costs: (userId: string) =>
    api.get<SaasCostSnapshot | null>(scoped("/saas/internal/costs", userId)),
  recordCosts: (userId: string, input: unknown) =>
    api.post<SaasCostSnapshot>(scoped("/saas/internal/costs", userId), input),
  providerInventory: (userId: string) =>
    api.get<{ observedAt: string; report: SaasProviderInventory } | null>(
      scoped("/saas/internal/fleet/inventory", userId),
    ),
  backupPolicy: (companyId: string, userId: string, cellId: string) =>
    api.get<SaasRuntimeBackupPolicy | null>(
      scoped(
        companyPath(companyId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/backup-policy",
        userId,
      ),
    ),
  configureBackupPolicy: (
    companyId: string,
    userId: string,
    cellId: string,
    input: {
      enabled: boolean;
      allowBriefPause: boolean;
      intervalHours: number;
      expectedVersion: number;
    },
  ) =>
    api.put<SaasRuntimeBackupPolicy>(
      scoped(
        companyPath(companyId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/backup-policy",
        userId,
      ),
      input,
    ),
  capabilities: async (): Promise<SaasCapabilities | null> => {
    try {
      return await api.get<SaasCapabilities>("/saas/capabilities");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  createCompany: (
    userId: string,
    input: { name: string; idempotencyKey: string; activation?:{version:9;website:string} },
  ) => api.post<SaasOnboarding>(scoped("/saas/companies", userId), input),
  onboarding: (companyId: string, userId: string) =>
    api.get<SaasOnboarding>(
      scoped(companyPath(companyId) + "/onboarding", userId),
    ),
  updateOnboarding: (
    companyId: string,
    userId: string,
    input: {
      expectedVersion: number;
      stage: string;
      answers: Record<string, unknown>;
    },
  ) =>
    api.patch<SaasOnboarding>(
      scoped(companyPath(companyId) + "/onboarding", userId),
      input,
    ),
  firstAgent: (
    companyId: string,
    userId: string,
    input: { expectedVersion: number; name: string },
  ) =>
    api.post<{ agentId: string; approvalId: string | null }>(
      scoped(companyPath(companyId) + "/onboarding/first-agent", userId),
      input,
    ),
  starterTask: (companyId: string, userId: string, expectedVersion: number) =>
    api.post<{ issueId: string }>(
      scoped(companyPath(companyId) + "/onboarding/starter-task", userId),
      { expectedVersion },
    ),
  billing: (companyId: string, userId: string) =>
    api.get<SaasBillingState>(
      scoped(companyPath(companyId) + "/billing", userId),
    ),
  checkout: (
    companyId: string,
    userId: string,
    input: { productKey: string; priceKey: string; idempotencyKey: string },
  ) =>
    api.post<SaasCheckout>(
      scoped(companyPath(companyId) + "/billing/checkout", userId),
      input,
    ),
  checkoutStatus: (companyId: string, intentId: string, userId: string) =>
    api.get<SaasCheckout>(
      scoped(
        companyPath(companyId) +
          "/billing/checkouts/" +
          encodeURIComponent(intentId),
        userId,
      ),
    ),
  portal: (companyId: string, userId: string) =>
    api.post<{ url: string }>(
      scoped(companyPath(companyId) + "/billing/portal", userId),
      {},
    ),
  usage: (companyId: string, userId: string) =>
    api.get<SaasUsage>(scoped(companyPath(companyId) + "/usage", userId)),
  runtimes: (companyId: string, userId: string) =>
    api.get<SaasRuntimeCell[]>(
      scoped(companyPath(companyId) + "/runtime-cells", userId),
    ),
  runtimeOptions: (companyId: string, userId: string) =>
    api.get<SaasRuntimeOptions>(
      scoped(companyPath(companyId) + "/runtime-options", userId),
    ),
  createRuntime: (
    companyId: string,
    userId: string,
    input: {
      capacityProfile: string;
      imageDigest: string;
      isolationMode: string;
      dedicatedAgentId?: string;
      idempotencyKey: string;
    },
  ) =>
    api.post<{ cellId: string; operation: unknown }>(
      scoped(companyPath(companyId) + "/runtime-cells", userId),
      input,
    ),
  runtimeBackups: (companyId: string, userId: string, cellId: string) =>
    api.get<SaasRuntimeBackup[]>(
      scoped(
        companyPath(companyId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/backups",
        userId,
      ),
    ),
  runtimeOperation: (
    companyId: string,
    userId: string,
    cellId: string,
    input: {
      action: string;
      idempotencyKey: string;
      imageDigest?: string;
      backupId?: string;
    },
  ) =>
    api.post(
      scoped(
        companyPath(companyId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/operations",
        userId,
      ),
      input,
    ),
  configureRuntimeModel: (
    companyId: string,
    userId: string,
    cellId: string,
    input: {
      provider: "openai" | "anthropic" | "openrouter";
      modelId: string;
      secretId: string;
    },
  ) =>
    api.put(
      scoped(
        companyPath(companyId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/model-provider",
        userId,
      ),
      input,
    ),
  bindRuntime: (
    companyId: string,
    userId: string,
    cellId: string,
    agentId: string,
  ) =>
    api.post(
      scoped(
        companyPath(companyId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/binding",
        userId,
      ),
      { agentId },
    ),
  notifications: (companyId: string, userId: string) =>
    api.get<SaasNotification[]>(
      scoped(companyPath(companyId) + "/notifications", userId),
    ),
  notificationsPage: (
    companyId: string,
    userId: string,
    cursor: string | null,
  ) =>
    api.get<{ items: SaasNotification[]; nextCursor: string | null }>(
      scoped(
        companyPath(companyId) +
          "/notifications/page?unread=true" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        userId,
      ),
    ),
  readNotification: (companyId: string, userId: string, id: string) =>
    api.patch<SaasNotification>(
      scoped(
        companyPath(companyId) + "/notifications/" + encodeURIComponent(id),
        userId,
      ),
      {},
    ),
  notificationPreferences: (userId: string) =>
    api.get<SaasNotificationPreference[]>(
      scoped("/saas/account/notification-preferences", userId),
    ),
  updateNotificationPreference: (
    companyId: string,
    userId: string,
    input: SaasNotificationPreference,
  ) =>
    api.patch<SaasNotificationPreference>(
      scoped(companyPath(companyId) + "/notifications/preferences", userId),
      input,
    ),
  invite: (
    companyId: string,
    userId: string,
    input: { email: string; role: string; idempotencyKey: string },
  ) =>
    api.post<{ id: string; status: string; expiresAt: string }>(
      scoped(companyPath(companyId) + "/saas-invitations", userId),
      input,
    ),
  supportSessions: (companyId: string, userId: string) =>
    api.get<SaasSupportSession[]>(
      scoped(companyPath(companyId) + "/support-sessions", userId),
    ),
  approveSupport: (
    companyId: string,
    userId: string,
    input: {
      operatorUserId: string;
      reason: string;
      scopes: string[];
      expiresInMinutes: number;
    },
  ) =>
    api.post<SaasSupportSession>(
      scoped(companyPath(companyId) + "/support-sessions", userId),
      { companyId, ...input },
    ),
  revokeSupport: (companyId: string, userId: string, id: string) =>
    api.delete(
      scoped(
        companyPath(companyId) + "/support-sessions/" + encodeURIComponent(id),
        userId,
      ),
    ),
  deletion: (companyId: string, userId: string) =>
    api.get<SaasDeletion | null>(
      scoped(companyPath(companyId) + "/deletion", userId),
    ),
  deleteCompany: (
    companyId: string,
    userId: string,
    input: {
      confirmation: string;
      acknowledgeExport: true;
      idempotencyKey: string;
    },
  ) => api.delete<SaasDeletion>(scoped(companyPath(companyId), userId), input),
  deletionReceipts: (userId: string) =>
    api.get<
      Pick<
        SaasDeletion,
        "id" | "companyId" | "status" | "stage" | "createdAt" | "completedAt"
      >[]
    >(scoped("/saas/account/deletion-receipts", userId)),
  deleteAccount: (
    userId: string,
    input: {
      confirmation: "DELETE MY ACCOUNT";
      password: string;
      acknowledgeExport: true;
      idempotencyKey: string;
    },
  ) =>
    api.post<{
      id: string;
      status: string;
      createdAt: string;
      completedAt: string | null;
    }>(scoped("/saas/account/deletion", userId), input),
  operations: (userId: string) =>
    api.get<SaasOperationsSnapshot>(
      scoped("/saas/internal/operations", userId),
    ),
  registerRuntimeVersion: (userId: string, input: RuntimeVersionCandidate) =>
    api.post(scoped("/saas/internal/runtime-versions", userId), input),
  transitionRuntimeVersion: (userId: string, input: RuntimeVersionTransition) =>
    api.post(scoped("/saas/internal/runtime-versions/status", userId), input),
  qualifyRuntimeCapacity: (
    userId: string,
    input: RuntimeCapacityQualification,
  ) => api.post(scoped("/saas/internal/runtime-capacity", userId), input),
  canaryRuntime: (
    sessionId: string,
    userId: string,
    input: {
      capacityProfile: string;
      imageDigest: string;
      isolationMode: string;
      idempotencyKey: string;
    },
  ) =>
    api.post<{ cellId: string }>(
      scoped(
        "/saas/internal/support/" +
          encodeURIComponent(sessionId) +
          "/canary-runtime",
        userId,
      ),
      input,
    ),
  supportStatus: (sessionId: string, userId: string) =>
    api.get<SaasSupportStatus>(
      scoped(
        "/saas/internal/support/" + encodeURIComponent(sessionId) + "/status",
        userId,
      ),
    ),
  supportRuntimeAction: (
    sessionId: string,
    userId: string,
    cellId: string,
    input: { action: string; idempotencyKey: string; backupId?: string },
  ) =>
    api.post(
      scoped(
        "/saas/internal/support/" +
          encodeURIComponent(sessionId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/operations",
        userId,
      ),
      input,
    ),
  supportBackups: (sessionId: string, userId: string, cellId: string) =>
    api.get<SaasRuntimeBackup[]>(
      scoped(
        "/saas/internal/support/" +
          encodeURIComponent(sessionId) +
          "/runtime-cells/" +
          encodeURIComponent(cellId) +
          "/backups",
        userId,
      ),
    ),
  fleetAction: (
    userId: string,
    hostId: string,
    action: "drain" | "fence" | "retire",
  ) =>
    api.post(
      scoped(
        "/saas/internal/fleet/hosts/" +
          encodeURIComponent(hostId) +
          "/" +
          action,
        userId,
      ),
      {},
    ),
  sessions: (userId: string) =>
    api.get<SaasSession[]>(scoped("/saas/account/sessions", userId)),
  revokeSession: (id: string, userId: string) =>
    api.delete<void>(
      scoped("/saas/account/sessions/" + encodeURIComponent(id), userId),
    ),
};
export async function saasAuthAction(
  path: "request-password-reset" | "reset-password" | "send-verification-email",
  input: Record<string, string>,
) {
  const response = await fetch("/api/auth/" + path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw new Error(
      typeof value?.message === "string"
        ? value.message
        : "The request failed. Please try again.",
    );
  }
}
