import { z } from "zod";

export const accountDeletionSsoChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  purpose: z.literal("account-deletion"),
  state: z.enum(["created", "authorization_started", "callback_verified", "ready"]),
  userId: z.string().min(1),
  sourceSessionId: z.string().min(1),
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
  authTime: z.number().int().positive().nullable(),
  proofSessionId: z.string().min(1).nullable(),
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
