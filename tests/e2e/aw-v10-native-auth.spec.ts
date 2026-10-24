import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDb, closeRegisteredClients } from "../../packages/db/src/index.ts";
import { sql } from "../../server/node_modules/drizzle-orm/index.js";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const serverRequire = createRequire(path.resolve("server/package.json"));
const { base32 } = await import(pathToFileURL(serverRequire.resolve("@better-auth/utils/base32")).href);
const { createOTP } = await import(pathToFileURL(serverRequire.resolve("@better-auth/utils/otp")).href);
async function json(response: APIResponse) {
  expect(response.ok(), String(response.status())).toBe(true);
  return response.json();
}

// Built application, native bootstrap/company owners, real HTTP-only cookies,
// maintained OTP generation/verification and migrated PostgreSQL. The disposable
// private profile does not qualify SaaS mail, external IdP, physical authenticators or hosts.
test("native account settings complete and cancel real authenticator lifecycles", async ({ page, baseURL, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  let { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: false, isUserVerified: false, automaticPresenceSimulation: true,
  } });
  try {
  const config = process.env.PAPERCLIP_E2E_SERVER_CONFIG;
  if (!config || !baseURL) throw new Error("An isolated authenticated server is required");
  const password = "A quiet Blentera browser café passphrase 2026";
  const email = `native-factor-browser-${Date.now()}@test.invalid`;
  const signup = await json(await page.request.post("/api/auth/sign-up/email", { data: {
    name: "Disposable native authenticator reviewer", email, password,
  } }));
  const invitation = execFileSync("pnpm", ["--filter", "@paperclipai/db", "exec", "tsx",
    path.resolve("packages/db/scripts/create-auth-bootstrap-invite.ts"), "--config", config, "--base-url", baseURL],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const token = new URL(invitation).pathname.split("/").at(-1);
  await json(await page.request.post(`/api/invites/${token}/accept`, { data: { requestType: "human" } }));
  const company = await json(await page.request.post("/api/companies", { data: { name: "Disposable native authentication company" } }));
  const accountPath = `/${company.issuePrefix}/company/settings/security`;
  await page.goto(accountPath);
  const card = page.locator("section", { has: page.locator("#native-authenticator-heading") }).last();
  await expect(page.locator("#native-authenticator-heading")).toBeVisible();
  await page.locator("#native-authenticator-password").fill(password);
  await page.getByRole("button", { name: "Set up an authenticator", exact: true }).click();
  await expect(page.locator("#native-authenticator-setup-key")).toBeVisible();
  const setupKey = await page.locator("#native-authenticator-setup-key").inputValue();
  const rawSecret = new TextDecoder().decode(base32.decode(setupKey));
  let usedStep = -1;
  const code = async () => {
    usedStep = Math.max(Math.floor(Date.now()/30000), usedStep+1);
    return createOTP(rawSecret).hotp(usedStep);
  };
  await page.locator("#native-authenticator-enrollment-code").fill(await code());
  await page.getByRole("button", { name: "Verify and finish setup", exact: true }).click();
  const codes = page.getByRole("list", { name: "Save your recovery codes", exact: true });
  await expect(codes.getByRole("listitem")).toHaveCount(10);
  const initialCodes = await codes.getByRole("listitem").allTextContents();
  const security = () => page.request.get("/api/auth/security", { headers: { "X-Blentera-Expected-User": signup.user.id } }).then(json);
  expect((await security()).twoFactorEnabled).toBe(true);
  const firstSession = await json(await page.request.get("/api/auth/get-session"));
  await page.getByRole("button", { name: "I saved these codes", exact: true }).click();
  await expect(codes).toHaveCount(0);
  expect(await page.evaluate(values => [...Object.values(localStorage), ...Object.values(sessionStorage), JSON.stringify(history.state)]
    .some(value => values.some(secret => value.includes(secret))), [setupKey, ...initialCodes])).toBe(false);

  await page.locator("#native-authenticator-current-totp").fill(await code());
  await page.getByRole("button", { name: "Confirm my identity", exact: true }).click();
  await expect(card.getByRole("status").filter({ hasText: "Your identity was confirmed" })).toBeVisible();
  await expect(page.locator("#native-authenticator-heading")).toBeFocused();
  const confirmedSession = await json(await page.request.get("/api/auth/get-session"));
  expect(confirmedSession.user.id).toBe(signup.user.id);
  expect(confirmedSession.session.id).not.toBe(firstSession.session.id);

  await page.locator("#native-authenticator-current-password").fill(password);
  await page.locator("#native-authenticator-current-recovery").fill(initialCodes[0]!);
  await page.getByRole("button", { name: "Create new recovery codes", exact: true }).click();
  await expect(codes.getByRole("listitem")).toHaveCount(10);
  const replacementCodes = await codes.getByRole("listitem").allTextContents();
  expect(replacementCodes).not.toEqual(initialCodes);
  await page.getByRole("button", { name: "I saved these codes", exact: true }).click();
  await page.locator("#native-authenticator-current-password").fill(password);
  await page.locator("#native-authenticator-current-recovery").fill(replacementCodes[0]!);
  await page.getByRole("button", { name: "Turn off and sign out", exact: true }).click();
  await expect.poll(async () => (await page.request.get("/api/auth/get-session")).status()).toBe(401);
  await json(await page.request.post("/api/auth/sign-in/email", { data: { email, password } }));
  await page.goto(accountPath);
  await expect(page.locator("#native-authenticator-password")).toBeVisible();
  expect((await security()).twoFactorEnabled).toBe(false);
  await page.locator("#native-authenticator-password").fill(password);
  await page.getByRole("button", { name: "Set up an authenticator", exact: true }).click();
  await expect(page.locator("#native-authenticator-setup-key")).toBeVisible();
  await page.getByRole("button", { name: "Cancel setup", exact: true }).click();
  await expect(page.locator("#native-authenticator-setup-key")).toHaveCount(0);
  await expect(page.locator("#native-authenticator-password")).toHaveValue("");
  expect((await security()).twoFactorEnabled).toBe(false);
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
  const badRegistration = await unverifiedPasskey(page, "registration");
  expect(badRegistration.status).toBe(401);
  expect(badRegistration.replayStatus).toBe(401);
  expect(await json(await page.request.get("/api/auth/passkey/list-user-passkeys"))).toHaveLength(0);
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  ({ authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } }));
  await failedNativeSessionWrite(page, cdp, authenticatorId, config, signup.user.id, password);
  const firstKeyName = "Browser security key";
  await page.locator("#native-authenticator-password").fill(password);
  await page.locator("#native-passkey-name").fill(firstKeyName);
  const optionsRequest = page.waitForRequest(request => request.url().includes("/api/auth/passkey/generate-register-options"));
  await page.getByRole("button", { name: "Add a passkey", exact: true }).click();
  expect(new URL((await optionsRequest).url()).searchParams.has("name")).toBe(false);
  const keyName = page.getByRole("textbox", { name: "Passkey name", exact: true });
  await expect(keyName).toHaveCount(1);
  await expect(keyName).toHaveValue(firstKeyName);
  const beforeRejected = await json(await page.request.get("/api/auth/get-session"));
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
  const badAuthentication = await unverifiedPasskey(page, "authentication");
  expect(badAuthentication.status).toBe(401);
  expect(badAuthentication.replayStatus).toBe(401);
  expect((await json(await page.request.get("/api/auth/get-session"))).session.id).toBe(beforeRejected.session.id);
  expect(await json(await page.request.get("/api/auth/passkey/list-user-passkeys"))).toHaveLength(1);
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
  await page.getByRole("button", { name: "Confirm with a passkey", exact: true }).click();
  await expect(card.getByRole("status").filter({ hasText: "Your identity was confirmed" })).toBeVisible();
  await keyName.fill("Renamed browser key");
  const renameReply = page.waitForResponse(response => response.url().endsWith("/api/auth/passkey/update-passkey") && response.request().method()==="POST");
  await page.getByRole("button", { name: "Rename passkey", exact: true }).click();
  expect((await renameReply).status()).toBe(200);
  await expect.poll(async () => (await json(await page.request.get("/api/auth/passkey/list-user-passkeys")))[0].name).toBe("Renamed browser key");
  await json(await page.request.post("/api/auth/sign-out", { data: {} }));
  await page.goto(`/auth?next=${encodeURIComponent(accountPath)}`);
  await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
  await expect(page.locator("#native-authenticator-heading")).toBeVisible();
  expect((await json(await page.request.get("/api/auth/get-session"))).user.id).toBe(signup.user.id);
  await expect(keyName).toHaveValue("Renamed browser key");
  await page.getByRole("button", { name: "Remove and sign out", exact: true }).click();
  await expect.poll(async () => (await page.request.get("/api/auth/get-session")).status()).toBe(401);
  await json(await page.request.post("/api/auth/sign-in/email", { data: { email, password } }));
  expect(await json(await page.request.get("/api/auth/passkey/list-user-passkeys"))).toEqual([]);
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  }

});


// Deliberately request no UV in the browser, preserving the actual server
// challenge and signed WebAuthn payload. This exercises the server's verified
// UV guard even though the maintained provider itself allows UV=false. No
// HTTP responses, signatures or server verifier results are mocked.
async function unverifiedPasskey(page: Page, operation: "authentication" | "registration") {
  return page.evaluate(async kind => {
    const options = await (await fetch(`/api/auth/passkey/generate-${kind === "registration" ? "register" : "authenticate"}-options`)).json();
    let credential: PublicKeyCredential;
    if (kind === "registration") {
      options.authenticatorSelection = { ...options.authenticatorSelection, userVerification: "discouraged", residentKey: "discouraged", requireResidentKey: false };
      credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) }) as PublicKeyCredential;
    } else {
      options.userVerification = "discouraged";
      credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) }) as PublicKeyCredential;
    }
    const body = JSON.stringify({ response: credential.toJSON(), ...(kind === "registration" ? { name: "Rejected unverified key" } : {}) });
    const send = () => fetch(`/api/auth/passkey/verify-${kind}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body });
    return { credentialId: credential.id, status: (await send()).status, replayStatus: (await send()).status };
  }, operation);
}


async function failedNativeSessionWrite(page: Page, cdp: import("@playwright/test").CDPSession,
  authenticatorId: string, configPath: string, userId: string, password: string) {
  expect(configPath.startsWith(path.join(tmpdir(), "paperclip-e2e-home-"))).toBe(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const port = Number(pid.split("\n")[3]);
  expect(Number.isInteger(port) && port>0 && port<65536).toBe(true);
  const url = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`, db = createDb(url);
  try {
    const [{ version }] = await db.execute<{ version: number }>(sql`select authenticator_version as version from "user" where id=${userId}`);
    await db.execute(sql`create table aw_e2e_passkey_failure_owner (user_id text primary key, generation integer not null)`);
    await db.execute(sql`insert into aw_e2e_passkey_failure_owner values (${userId},${version})`);
    // PostgreSQL sequences survive transaction rollback: this proves the exact
    // replacement INSERT was reached after real provider verification/key write.
    await db.execute(sql`create sequence aw_e2e_passkey_failed_session`);
    await db.execute(sql`create function aw_e2e_reject_passkey_session() returns trigger language plpgsql as $$
      begin
        if exists(select 1 from aw_e2e_passkey_failure_owner f where f.user_id=NEW.user_id
          and NEW.authenticator_version>f.generation) then
          perform nextval('aw_e2e_passkey_failed_session');
          raise exception 'Injected native session write failure' using errcode='23514';
        end if;
        return NEW;
      end $$`);
    await db.execute(sql`create trigger aw_e2e_reject_passkey_session before insert on "session"
      for each row execute function aw_e2e_reject_passkey_session()`);
    const sent = page.waitForRequest(request => request.url().endsWith("/api/auth/passkey/verify-registration") && request.method()==="POST");
    const reply = page.waitForResponse(response => response.url().endsWith("/api/auth/passkey/verify-registration") && response.request().method()==="POST");
    await page.locator("#native-authenticator-password").fill(password);
    await page.locator("#native-passkey-name").fill("Uncommitted test key");
    await page.getByRole("button", { name: "Add a passkey", exact: true }).click();
    const submitted = (await sent).postDataJSON();
    expect((await reply).status()).toBe(500);
    await expect(page.getByRole("alert").filter({ hasText: "The security change could not be confirmed" })).toBeVisible();
    const [failed] = await db.execute<{ is_called: boolean; last_value: string }>(sql`select is_called,last_value from aw_e2e_passkey_failed_session`);
    expect(failed.is_called).toBe(true);
    expect(Number(failed.last_value)).toBe(1);
    expect(await db.execute(sql`select id from passkey where user_id=${userId}`)).toHaveLength(0);
    const [current] = await db.execute<{ version: number }>(sql`select authenticator_version as version from "user" where id=${userId}`);
    expect(current.version).toBe(version);
    const sessions = await db.execute<{ method: string; version: number }>(sql`select authentication_method as method,
      authenticator_version as version from "session" where user_id=${userId}`);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({ method: "password", version });
    expect((await page.request.post("/api/auth/passkey/verify-registration", { data: submitted })).status()).toBe(401);
    expect(await db.execute(sql`select id from verification where aw_native_verification_user_id(value)=${userId}`)).toHaveLength(0);
    await cdp.send("WebAuthn.removeCredential", { authenticatorId,
      credentialId: Buffer.from(submitted.response.id, "base64url").toString("base64") });
  } finally {
    await db.execute(sql`drop trigger if exists aw_e2e_reject_passkey_session on "session"`);
    await db.execute(sql`drop function if exists aw_e2e_reject_passkey_session()`);
    await db.execute(sql`drop sequence if exists aw_e2e_passkey_failed_session`);
    await db.execute(sql`drop table if exists aw_e2e_passkey_failure_owner`);
    await closeRegisteredClients(url);
  }
}
