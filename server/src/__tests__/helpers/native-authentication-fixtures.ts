import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { authPasskeys, authSessions, authUsers, type Db } from "@paperclipai/db";

// Structural domain fixture only; actual WebAuthn ceremonies are covered by
// the native-auth browser suite. Do not use these bytes as a real credential.
export async function seedNativePasskeySession(db: Db, userId: string) {
  const now = new Date(), sessionId = randomUUID();
  await db.insert(authPasskeys).values({ id: randomUUID(), userId,
    publicKey: "structural-sandbox-fixture", credentialID: randomUUID(),
    counter: 0, deviceType: "singleDevice", backedUp: false, createdAt: now });
  const [user] = await db.select({ version: authUsers.authenticatorVersion }).from(authUsers).where(eq(authUsers.id, userId));
  await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(),
    createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 3600000),
    authenticationMethod: "passkey", authenticatedAt: now, authenticatorVersion: user!.version });
  return sessionId;
}
