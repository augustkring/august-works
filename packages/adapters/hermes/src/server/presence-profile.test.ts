import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hermesPresenceConfig, hermesDataHome, hermesProfileHash, ensureHermesDataHome } from "./presence-profile.js";
import { sessionCodec } from "./index.js";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
describe("Hermes company presence profile", () => {
  it("scopes skills, sessions and local Memory by exact company and presence without config-dependent identity", () => {
    const identity = { companyId: "company-a", agentId: "worker" };
    const a = hermesPresenceConfig({}, identity);
    expect(hermesDataHome(a)).not.toBe(hermesDataHome(hermesPresenceConfig({}, { ...identity, companyId: "company-b" })));
    expect(hermesDataHome(a)).not.toBe(hermesDataHome(hermesPresenceConfig({}, { ...identity, agentId: "another" })));
    const extra = { ...identity, config: { model: "another" }, adapterType: "hermes_local" };
    expect(hermesProfileHash(a)).toBe(hermesProfileHash(hermesPresenceConfig({}, extra)));
    expect(a.env).toMatchObject({ HERMES_PROFILE: "", HERMES_HOME: hermesDataHome(a) });
    expect(path.basename(path.dirname(hermesDataHome(a)))).toBe("profiles");
  });
  it("retains the verified presence hash through the actual session codec", () => {
    const session = { sessionId: "retained-session", hermesProfileHash: "a".repeat(64) };
    expect(sessionCodec.deserialize(sessionCodec.serialize(session))).toEqual(session);
    expect(sessionCodec.deserialize({ ...session, hermesProfileHash: "unverified" })).toEqual({ sessionId: session.sessionId });
  });
  it("refuses a customer-selected foreign home unless the trusted binding explicitly selects shared trust", () => {
    const config = { env: { HERMES_HOME: "/another-presence", PRIVATE_PROVIDER_KEY: "test-fixture" } };
    expect(() => hermesPresenceConfig(config, { companyId: "a", agentId: "b" })).toThrow("hermes_profile_isolation_required");
    expect(hermesPresenceConfig(config, { companyId: "a", agentId: "b" }, "shared_trusted_runtime")).toBe(config);
    expect(() => hermesPresenceConfig({ env: { HERMES_PROFILE: "another" } }, { companyId: "a", agentId: "b" })).toThrow("explicit_binding");
  });
  it("refuses filesystem links that redirect profile state to another presence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-profile-")); dirs.push(root);
    await fs.mkdir(path.join(root, "another")); await fs.symlink(path.join(root, "another"), path.join(root, "redirected"));
    await expect(ensureHermesDataHome({ env: { HERMES_HOME: path.join(root, "redirected") } })).rejects.toThrow("redirected");
    expect(await fs.readdir(path.join(root, "another"))).toEqual([]);
  });
});
