import { toolsApi } from "@/api/tools";
import { activationConnectionApi } from "@/api/activation-connections";
import type { ActivationConnectionConsentReceipt, ConnectToolApp } from "@paperclipai/shared";

export type DeferredOnboardingConnection = {
  companyId: string; principal: string; requestKey: string;
  applicationId: string; galleryKey: string; methodKey: string;
  connectionId?: string; canUseAuthority: () => boolean;
  withAuthority: <T>(operation: () => Promise<T>) => Promise<T>;
  deferredAgentAccessLabel: string;
};

/** Transport fence around the original setup flow. The Native purpose and Apps
 * owners grant authority; this prevents stale UI responses or a lost reply from
 * starting another allocation. Ordinary Apps keep their original transport. */
export function onboardingConnectionTools(context: DeferredOnboardingConnection,
  original: typeof toolsApi = toolsApi,
  consent: Pick<typeof activationConnectionApi, "receipt" | "connect"> = activationConnectionApi): typeof toolsApi {
  function current() {
    if (!context.canUseAuthority()) throw new Error("Current onboarding connection access is unresolved");
  }
  async function receipt() {
    current();
    const value = await consent.receipt(context.companyId, context.principal, context.requestKey);
    current();
    if (value.companyId !== context.companyId || value.applicationId !== context.applicationId || value.requestKey !== context.requestKey)
      throw new Error("Original connection consent context changed");
    return value;
  }
  async function boundConnection(id: unknown): Promise<ActivationConnectionConsentReceipt> {
    const value = await receipt();
    if (!value.connectionId || value.connectionId !== id || !["allocated", "connected"].includes(value.status))
      throw new Error("Read the original connection receipt before continuing setup");
    return value;
  }
  return new Proxy(original, {
    get(target, key, receiver) {
      const operation = Reflect.get(target, key, receiver);
      if (typeof operation !== "function") return operation;
      return async (...args: unknown[]) => context.withAuthority(async () => {
        current();
        let result: unknown;
        if (key === "connectApp") {
          const input = args[1] as ConnectToolApp;
          if (args[0] !== context.companyId || input.galleryKey !== context.galleryKey || input.connectionMethodKey !== context.methodKey ||
              input.grantKind !== "user" || input.subjectAgentId || input.link || input.oauthClient || input.saveDraft || input.authMode ||
              input.vercelConnect || input.credentialSource === "vercel_connect" || input.reconnectConnectionId || input.resumeConnectionId ||
              (input.applicationId && input.applicationId !== context.applicationId) ||
              Object.keys(input.configValues ?? {}).length || Object.keys(input.credentialValues ?? {}).length)
            throw new Error("Setup must preserve the reviewed personal connection without Agent access");
          const originalReceipt = await receipt();
          if (originalReceipt.status !== "approved")
            throw new Error("Read the original allocation receipt; setup may already have started");
          result = await consent.connect(context.companyId, context.principal, context.requestKey);
        } else {
          if (key === "startOAuth") {
            await boundConnection(args[0]);
            if (!(args[1] as { asCurrentUser?: boolean })?.asCurrentUser)
              throw new Error("Provider sign-in must keep the original personal identity");
          }
          if (key === "finishApp" || key === "putConnectionInstalls" || key === "finalizeOAuthAccess") {
            if (args[0] !== context.companyId && key !== "putConnectionInstalls") throw new Error("Connection company changed");
            await boundConnection(key === "putConnectionInstalls" ? args[0] : args[1]);
            if (key === "putConnectionInstalls" && (!Array.isArray(args[1]) || args[1].length))
              throw new Error("Agent access requires a separate reviewed decision");
            if (key === "finishApp") {
              const input = args[2] as { access: "all_agents" | { agentIds: string[] } };
              if (input.access === "all_agents" || input.access.agentIds.length) throw new Error("Agent access requires a separate reviewed decision");
            }
            if (key === "finalizeOAuthAccess" && (args[2] as { grantKind?: string })?.grantKind !== "user")
              throw new Error("Provider sign-in must keep the original personal identity");
          }
          if (key === "startCloudConnectorEnrollment") throw new Error("Review connection availability before enrolling a provider");
          result = await Reflect.apply(operation, target, args);
        }
        current();
        return result;
      });
    },
  });
}
