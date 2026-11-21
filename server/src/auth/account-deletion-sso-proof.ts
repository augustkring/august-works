import { z } from "zod";

export const accountDeletionSsoChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  purpose: z.literal("account-deletion"),
  protocol: z.enum(["oidc", "saml"]),
  nativeFactorMethod: z.enum(["totp", "passkey"]).nullable(),
  state: z.enum(["created", "authorization_started", "callback_verified", "ready"]),
  userId: z.string().min(1),
  sourceSessionId: z.string().min(1),
  sourceSessionExpiresAt: z.iso.datetime().nullable(),
  authenticatorVersion: z.number().int().nonnegative(),
  providerId: z.string().min(1),
  policyId: z.string().uuid(),
  policyVersion: z.number().int().positive(),
  policyRevision: z.string().regex(/^[a-f0-9]{64}$/),
  companyId: z.string().uuid(),
  bindingId: z.string().uuid(),
  issuer: z.string().min(1),
  subject: z.string().min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  authorizationState: z.string().min(1).nullable(),
  idTokenNonce: z.string().min(16).nullable(),
  samlRequestId: z.string().min(1).nullable(),
  samlAssertionId: z.string().min(1).nullable(),
  samlIssuer: z.string().min(1).nullable(),
  samlSubject: z.string().min(1).nullable(),
  samlAuthnInstant: z.iso.datetime().nullable(),
  samlRecipient: z.string().url().nullable(),
  samlNotOnOrAfter: z.iso.datetime().nullable(),
  samlBinding: z.literal("post").nullable(),
  authTime: z.number().int().positive().nullable(),
  callbackSessionId: z.string().min(1).nullable(),
  proofSessionId: z.string().min(1).nullable(),
  nativeFactorSessionId: z.string().min(1).nullable(),
  nativeFactorAuthenticatorVersion: z.number().int().nonnegative().nullable(),
}).strict();

export type AccountDeletionSsoChallenge = z.infer<typeof accountDeletionSsoChallengeSchema>;

export function parseAccountDeletionSsoChallenge(value: string): AccountDeletionSsoChallenge | null {
  try {
    const parsed = accountDeletionSsoChallengeSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
