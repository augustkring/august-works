import { authSessionSchema, type AuthSession } from "@paperclipai/shared";

/** Full original get-session response for controlled UI fixtures. */
export function v9SessionFixture(userId: string, localImplicit = false): AuthSession {
  return authSessionSchema.parse({
    session: { id: `session-${userId}`, userId, localImplicit },
    user: { id: userId, email: `${userId}@example.test`, name: "Account fixture", image: null },
    sentryDsn: null,
  });
}
