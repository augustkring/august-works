import { notificationChannelPreferenceViewSchema, notificationChannelPreferenceReceiptSchema,
  notificationChannelUpdateSchema, type NotificationChannelCategory, type NotificationChannelUpdate } from "@paperclipai/shared";
import { nativeSupportReviewSchema } from "@paperclipai/shared";
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
import { AuthApiError } from "./auth";
import { i18n } from "@/i18n";
const companyPath = (id: string) => "/companies/" + encodeURIComponent(id);
const scoped = (path: string, userId: string) =>
  path +
  (path.includes("?") ? "&" : "?") +
  "expectedUserId=" +
  encodeURIComponent(userId);
type SupportApprovalInput = {
  approvalId?: string;
  operatorUserId: string;
  reason: string;
  scopes: string[];
  expiresInMinutes: number;
};
function supportApprovalReceipt(
  row: SaasSupportSession,
  companyId: string,
  userId: string,
  frozen: SupportApprovalInput,
) {
  if (
    !row ||
    typeof row.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      row.id,
    ) ||
    (frozen.approvalId !== undefined &&
      row.id !== frozen.approvalId.toLowerCase()) ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    Date.parse(row.expiresAt) - Date.parse(row.createdAt) !==
      frozen.expiresInMinutes * 60000 ||
    row.companyId !== companyId ||
    row.approvedByUserId !== userId ||
    row.operatorUserId !== frozen.operatorUserId ||
    row.reason !== frozen.reason ||
    !Array.isArray(row.scopes) ||
    JSON.stringify([...row.scopes].sort()) !==
      JSON.stringify([...new Set(frozen.scopes)].sort())
  )
    throw new Error("Support acknowledgement could not be confirmed");
  return row;
}
export const saasApi = {
  costs: (userId: string, signal?: AbortSignal) =>
    api.get<SaasCostSnapshot | null>(scoped("/saas/internal/costs", userId), { signal, cache: "no-store" }),
  recordCosts: (userId: string, input: unknown) =>
    api.post<SaasCostSnapshot>(scoped("/saas/internal/costs", userId), input),
  providerInventory: (userId: string, signal?: AbortSignal) =>
    api.get<{ observedAt: string; report: SaasProviderInventory } | null>(
      scoped("/saas/internal/fleet/inventory", userId),
      { signal, cache: "no-store" },
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
    input: {
      name: string;
      idempotencyKey: string;
      activation?: { version: 9; website: string };
    },
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
    signal?: AbortSignal,
  ) =>
    api.get<{ items: SaasNotification[]; nextCursor: string | null }>(
      scoped(
        companyPath(companyId) +
          "/notifications/page?unread=true" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        userId,
      ),
      { signal, cache: "no-store" },
    ),
  readNotification: (companyId: string, userId: string, id: string) =>
    api.patch<SaasNotification>(
      scoped(
        companyPath(companyId) + "/notifications/" + encodeURIComponent(id),
        userId,
      ),
      {},
    ),
  notificationChannelPreference: async (companyId: string, userId: string, category: NotificationChannelCategory, signal?: AbortSignal) => {
    const value = notificationChannelPreferenceViewSchema.parse(await api.get<unknown>(
      scoped(companyPath(companyId) + "/notifications/channel-preferences/" + category, userId), { signal, cache: "no-store" }));
    if (value.companyId !== companyId || value.userId !== userId || value.category !== category) throw new Error("The current notification policy is unavailable");
    return value;
  },
  updateNotificationChannel: async (companyId: string, userId: string, category: NotificationChannelCategory, input: NotificationChannelUpdate) => {
    const command = notificationChannelUpdateSchema.parse(input);
    const value = notificationChannelPreferenceReceiptSchema.parse(await api.post<unknown>(
      scoped(companyPath(companyId) + "/notifications/channel-preferences/" + category, userId), command));
    if (value.companyId !== companyId || value.userId !== userId || value.category !== category || value.requestId !== command.requestId ||
      value.version !== command.expectedVersion + 1 || value.channel !== command.choice.channel)
      throw new Error("The Original notification preference receipt is unavailable");
    return value;
  },
  notificationChannelReceipt: async (companyId: string, userId: string, category: NotificationChannelCategory, requestId: string, signal?: AbortSignal) => {
    const value = notificationChannelPreferenceReceiptSchema.nullable().parse(await api.get<unknown>(
      scoped(companyPath(companyId) + "/notifications/channel-preferences/" + category + "/receipts/" + encodeURIComponent(requestId), userId), { signal, cache: "no-store" }));
    if (value && (value.companyId !== companyId || value.userId !== userId || value.category !== category || value.requestId !== requestId))
      throw new Error("The Original notification preference receipt is unavailable");
    return value;
  },
  notificationPreferences: (userId: string, signal?: AbortSignal) =>
    api.get<SaasNotificationPreference[]>(
      scoped("/saas/account/notification-preferences", userId),
      { signal, cache: "no-store" },
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
  supportSessions: async (
    companyId: string,
    userId: string,
    signal?: AbortSignal,
  ) => {
    const rows = await api.get<SaasSupportSession[]>(
      scoped(companyPath(companyId) + "/support-sessions", userId),
      { signal, cache: "no-store" },
    );
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || row.companyId !== companyId)
    )
      throw new Error("Support context changed");
    return rows;
  },
  prepareSupportApproval: async (
    companyId: string,
    userId: string,
    input: SupportApprovalInput,
  ) => {
    const frozen = { ...input, scopes: [...input.scopes], companyId };
    const receipt = nativeSupportReviewSchema.parse(
      await api.post(
        scoped(companyPath(companyId) + "/support-sessions/reviews", userId),
        frozen,
      ),
    );
    if (
      receipt.companyId !== companyId ||
      receipt.approvalId !== frozen.approvalId ||
      receipt.state !== "pending"
    )
      throw new Error("Original support review could not be confirmed");
    return receipt;
  },
  pendingSupportApproval: async (
    companyId: string,
    userId: string,
    signal?: AbortSignal,
  ) => {
    const receipt = nativeSupportReviewSchema
      .nullable()
      .parse(
        await api.get(
          scoped(
            companyPath(companyId) + "/support-sessions/pending-review",
            userId,
          ),
          { signal, cache: "no-store" },
        ),
      );
    if (
      receipt &&
      (receipt.companyId !== companyId || receipt.state !== "pending")
    )
      throw new Error("Original support review could not be confirmed");
    return receipt;
  },
  cancelSupportApproval: async (
    companyId: string,
    userId: string,
    approvalId: string,
  ) => {
    const receipt = nativeSupportReviewSchema.parse(
      await api.delete(
        scoped(
          companyPath(companyId) +
            "/support-sessions/reviews/" +
            encodeURIComponent(approvalId),
          userId,
        ),
      ),
    );
    if (
      receipt.companyId !== companyId ||
      receipt.approvalId !== approvalId ||
      receipt.state === "pending"
    )
      throw new Error("Original support cancellation could not be confirmed");
    return receipt;
  },
  originalSupportApproval: async (
    companyId: string,
    userId: string,
    approvalId: string,
    signal?: AbortSignal,
  ) => {
    const receipt = await api.get<SaasSupportSession>(
      scoped(
        companyPath(companyId) +
          "/support-sessions/" +
          encodeURIComponent(approvalId),
        userId,
      ),
      { signal, cache: "no-store" },
    );
    if (
      !receipt ||
      receipt.id !== approvalId ||
      receipt.companyId !== companyId ||
      receipt.approvedByUserId !== userId
    )
      throw new Error("Original support approval could not be confirmed");
    return receipt;
  },
  approveSupport: (
    companyId: string,
    userId: string,
    input: SupportApprovalInput,
  ) => {
    const frozen = { ...input, scopes: [...input.scopes], companyId };
    return api
      .post<SaasSupportSession>(
        scoped(companyPath(companyId) + "/support-sessions", userId),
        frozen,
      )
      .then((row) => supportApprovalReceipt(row, companyId, userId, frozen));
  },
  supportApproval: (
    companyId: string,
    userId: string,
    input: SupportApprovalInput,
    signal?: AbortSignal,
  ) => {
    const frozen = { ...input, scopes: [...input.scopes] };
    if (!frozen.approvalId)
      return Promise.reject(
        new Error("Original approval reference is unavailable"),
      );
    return api
      .get<SaasSupportSession>(
        scoped(
          companyPath(companyId) +
            "/support-sessions/" +
            encodeURIComponent(frozen.approvalId),
          userId,
        ),
        { signal, cache: "no-store" },
      )
      .then((row) => supportApprovalReceipt(row, companyId, userId, frozen));
  },
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
  deletionReceipts: (userId: string, signal?: AbortSignal) =>
    api.get<
      Pick<
        SaasDeletion,
        "id" | "companyId" | "status" | "stage" | "createdAt" | "completedAt"
      >[]
    >(scoped("/saas/account/deletion-receipts", userId), { signal, cache: "no-store" }),
  deleteAccount: (
    userId: string,
    input: {
      confirmation: "DELETE MY ACCOUNT";
      password?: string;
      reauthenticationProofId?: string;
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
  operations: (userId: string, signal?: AbortSignal) =>
    api.get<SaasOperationsSnapshot>(
      scoped("/saas/internal/operations", userId),
      { signal, cache: "no-store" },
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
  sessions: (userId: string, signal?: AbortSignal) =>
    api.get<SaasSession[]>(scoped("/saas/account/sessions", userId), { signal, cache: "no-store" }),
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
    headers: {
      "Content-Type": "application/json",
      "X-Blentera-Locale": i18n.resolvedLanguage === "da" ? "da" : "en",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    const code = typeof value?.code === "string" ? value.code
      : typeof value?.error?.code === "string" ? value.error.code
        : typeof value?.details?.code === "string" ? value.details.code : null;
    throw new AuthApiError(
      typeof value?.message === "string"
        ? value.message
        : "The request failed. Please try again.",
      response.status,
      value,
      code,
    );
  }
}
