import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { request, type FullConfig } from "@playwright/test";

/** Bootstrap only the isolated instance through its original account/invite
 * owners. The saved cookies are real sessions. Email possession is a controlled
 * fixture boundary: the installed native issuer supplies its short-lived token,
 * and the real verification endpoint consumes it. No outbound email delivery is
 * qualified; no session, verification flag, grant or accepted request is seeded. */
export default async function bootstrapBrowserOwner(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  const serverConfig = process.env.PAPERCLIP_E2E_SERVER_CONFIG;
  const storagePath = process.env.PAPERCLIP_E2E_AUTH_STORAGE_STATE;
  if (!baseURL || !serverConfig || !storagePath)
    throw new Error("An isolated authenticated browser instance is required");
  const savedConfig = JSON.parse(readFileSync(serverConfig, "utf8"));
  if (savedConfig.server?.deploymentMode !== "authenticated")
    throw new Error("Browser product journeys require authenticated deployment mode");
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const assertOk = async (response: Awaited<ReturnType<typeof api.post>>, stage: string) => {
    if (!response.ok()) throw new Error(`Browser owner ${stage} failed (${response.status()})`);
  };
  try {
    await assertOk(await api.post("/api/auth/sign-up/email", { data: {
      name: "Browser product reviewer", email: "browser-product-owner@test.invalid",
      password: "Disposable browser product passphrase 2026!",
    } }), "signup");
    const invitation = execFileSync("pnpm", [
      "--filter", "@paperclipai/db", "exec", "tsx",
      path.resolve(import.meta.dirname, "../../../packages/db/scripts/create-auth-bootstrap-invite.ts"),
      "--config", serverConfig, "--base-url", baseURL,
    ], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
    const token = new URL(invitation).pathname.split("/").at(-1);
    if (!token) throw new Error("Browser bootstrap invitation was malformed");
    await assertOk(await api.post(`/api/invites/${token}/accept`, { data: { requestType: "human" } }), "claim");
    const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PAPERCLIP_AGENT_JWT_SECRET;
    if (!secret) throw new Error("The isolated browser instance has no authentication issuer");
    const serverRequire = createRequire(path.resolve(import.meta.dirname, "../../../server/package.json"));
    const { createEmailVerificationToken } = await import(pathToFileURL(serverRequire.resolve("better-auth/api")).href);
    const verificationToken = await createEmailVerificationToken(secret, "browser-product-owner@test.invalid", undefined, 300);
    const verification = await api.get(`/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`);
    await assertOk(verification, "email verification");
    if ((await verification.json())?.status !== true)
      throw new Error("Browser owner email verification did not complete");
    const session = await api.get("/api/auth/get-session");
    const current = session.ok() ? await session.json() : null;
    // The public session DTO intentionally omits the verification flag. The
    // native verifier above owns that state; private routes recheck it in DB.
    if (!current?.user?.id || current.user.email !== "browser-product-owner@test.invalid" || current.session?.localImplicit !== false)
      throw new Error("Browser bootstrap did not establish an actual Human session");
    await api.storageState({ path: storagePath });
    chmodSync(storagePath, 0o600);
  } finally {
    await api.dispose();
  }
}
