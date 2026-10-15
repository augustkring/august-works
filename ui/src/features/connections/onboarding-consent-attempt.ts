import { activationConnectionConsentCommandSchema, type ActivationConnectionConsentCommand } from "@paperclipai/shared";

/** Session-only immutable command identity. No preview, credentials or customer
 * text is stored. Reload may read a receipt; it never replays a mutation. */
export const onboardingConsentAttemptKey = (companyId: string, principal: string, runId: string, version: number, applicationKey: string) =>
  JSON.stringify(["aw-onboarding-purpose", companyId, principal, runId, version, applicationKey]);
export function readOnboardingConsentAttempt(storage: Pick<Storage, "getItem">, key: string) {
  try {
    const raw = storage.getItem(key);
    return raw ? activationConnectionConsentCommandSchema.parse(JSON.parse(raw)) : null;
  } catch { return null; }
}
export function saveOnboardingConsentAttempt(storage: Pick<Storage, "setItem">, key: string, command: ActivationConnectionConsentCommand) {
  storage.setItem(key, JSON.stringify(activationConnectionConsentCommandSchema.parse(command)));
}
