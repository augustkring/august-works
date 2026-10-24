import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type APIResponse } from "@playwright/test";

const serverRequire = createRequire(path.resolve("server/package.json"));
const { base32 } = await import(pathToFileURL(serverRequire.resolve("@better-auth/utils/base32")).href);
const { createOTP } = await import(pathToFileURL(serverRequire.resolve("@better-auth/utils/otp")).href);
async function json(response: APIResponse) {
  expect(response.ok(), String(response.status())).toBe(true);
  return response.json();
}

// Built application, native bootstrap/company owners, real HTTP-only cookies,
// maintained OTP generation/verification and migrated PostgreSQL. The disposable
// private profile does not qualify SaaS mail, external IdP, passkeys or hosts.
test("native account settings complete and cancel real authenticator lifecycles", async ({ page, baseURL }) => {
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
});
