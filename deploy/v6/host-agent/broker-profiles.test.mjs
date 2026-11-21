import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectInstalledBrokerProfiles, verifyBrokerProviderProfile } from "./broker-profiles.mjs";
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const profile = (model = false) => ({ id: model ? "operator-selected-model" : "operator-selected-app",
  credentials: [{ name: "token", env_vars: [model ? "PAPERCLIP_SANDBOX_MODEL_TOKEN" : "PAPERCLIP_SANDBOX_BROKER_TOKEN"],
    required: true, auth_style: "bearer", header_name: "Authorization" }],
  endpoints: [{ host: "platform.example.test", port: 443, protocol: "rest", enforcement: "enforce", path: "",
    rules: [{ allow: { method: "POST", path: model ? "/runtime-tools/model/v1/messages" : "/mcp/gateways/*" } }] }],
  binaries: [{ path: "/usr/bin/node" }] });
const select = value => ({ id: value.id, hash: hash(value), origin: "https://platform.example.test", binaries: ["/usr/bin/node"] });
const deadline = () => new Date(Date.now() + 10000).toISOString();
const inspect = (value, selected = select(value)) => inspectInstalledBrokerProfiles({ selection: { app: selected },
  cli: async args => { assert.deepEqual(args, ["profile", "describe", selected.id, "--output", "json"]); return value; }, deadlineAt: deadline() });

test("actual controlled software CLI describes separately pinned App and model profiles without credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "host-profile-cli-"));
  try {
    const values = [profile(), profile(true)];
    const script = path.join(root, "cli.mjs");
    await writeFile(script, `const profiles=${JSON.stringify(values)};const args=process.argv.slice(2);if(args.length!==5||args[0]!=="profile"||args[1]!=="describe"||args[3]!=="--output"||args[4]!=="json")process.exit(3);const p=profiles.find(p=>p.id===args[2]);if(!p)process.exit(4);console.log(JSON.stringify(p));`);
    const calls = [];
    const cli = async (args, expires) => {
      assert.equal(expires, expiry); calls.push(args);
      const result = await promisify(execFile)(process.execPath, [script, ...args],
        { env: { PATH: "/usr/bin:/bin" }, timeout: 2000, maxBuffer: 65536 });
      return JSON.parse(result.stdout);
    };
    const expiry = deadline();
    const selection = { app: select(values[0]), model: select(values[1]) };
    const result = await inspectInstalledBrokerProfiles({ selection, cli, deadlineAt: expiry });
    assert.deepEqual(result, { credentialProfileDimensions: ["host", "port", "method", "path", "binary"],
      credentialBrokerProviderProfile: { id: values[0].id, hash: hash(values[0]), binaries: ["/usr/bin/node"] },
      modelBrokerProviderProfile: { id: values[1].id, hash: hash(values[1]), binaries: ["/usr/bin/node"] } });
    assert.equal(calls.length, 2);
    assert.equal("company" in result, false);
    assert.equal(JSON.stringify(result).includes("TOKEN"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("missing bootstrap selection advertises no runtime authority", async () => {
  assert.deepEqual(await inspectInstalledBrokerProfiles({ cli: () => assert.fail("no CLI"), deadlineAt: deadline() }),
    { credentialProfileDimensions: [] });
});
for (const [name, mutate] of [
  ["qualification ENV", p => p.credentials[0].env_vars = ["PAPERCLIP_SANDBOX_QUALIFICATION_TOKEN"]],
  ["model role in App slot", p => p.credentials[0].env_vars = ["PAPERCLIP_SANDBOX_MODEL_TOKEN"]],
  ["wrong origin host", p => p.endpoints[0].host = "elsewhere.example.test"],
  ["wrong port", p => p.endpoints[0].port = 444],
  ["wrong method", p => p.endpoints[0].rules[0].allow.method = "GET"],
  ["wrong path", p => p.endpoints[0].rules[0].allow.path = "/mcp/*"],
  ["unenforced endpoint", p => p.endpoints[0].enforcement = "observe"],
  ["uninspected credentials", p => p.endpoints[0].allow_uninspected_credentials = true],
  ["extra endpoint", p => p.endpoints.push(structuredClone(p.endpoints[0]))],
  ["extra allow rule", p => p.endpoints[0].rules.push({ allow: { method: "POST", path: "/*" } })],
  ["wrong auth header", p => p.credentials[0].header_name = "X-Key"],
  ["token grant", p => p.credentials[0].token_grant = {}],
  ["refresh hook", p => p.credentials[0].refresh = {}],
  ["optional credential", p => p.credentials[0].required = false],
  ["relative binary", p => p.binaries[0].path = "node"],
  ["traversal binary", p => p.binaries[0].path = "/usr/bin/../node"],
  ["extra binary", p => p.binaries.push({ path: "/usr/bin/python" })],
  ["duplicate binary", p => p.binaries.push({ path: "/usr/bin/node" })],
]) test(`rejects ${name} even with newly matching installed hash`, async () => {
  const value = profile(); mutate(value);
  await assert.rejects(inspect(value), /sandbox_operation_unsupported/);
});

test("profile drift is reobserved on every call and cannot self-baseline a new hash", async () => {
  const value = profile(), selected = select(value); let calls = 0;
  const cli = async () => { calls++; return value; };
  const options = { selection: { app: selected }, cli, deadlineAt: deadline() };
  await inspectInstalledBrokerProfiles(options);
  value.description = "changed installed bytes";
  await assert.rejects(inspectInstalledBrokerProfiles(options), /sandbox_operation_unsupported/);
  assert.equal(calls, 2);
});
for (const origin of ["http://platform.example.test", "https://platform.example.test/", "https://user@platform.example.test", "https://platform.example.test/path", "https://platform.example.test?x=1"])
  test(`rejects noncanonical platform origin ${origin}`, async () => {
    const value = profile(); await assert.rejects(inspect(value, { ...select(value), origin }), /sandbox_operation_unsupported/);
  });
test("unknown selectors and caller-shaped config are denied", async () => {
  for (const selection of [{}, { app: { ...select(profile()), trusted: true } }, { qualification: select(profile()) }])
    await assert.rejects(inspectInstalledBrokerProfiles({ selection, cli: async () => profile(), deadlineAt: deadline() }), /sandbox_operation_unsupported/);
});
test("expired current deadline denies before CLI observation", async () => {
  await assert.rejects(inspectInstalledBrokerProfiles({ selection: { app: select(profile()) }, deadlineAt: new Date(0).toISOString(), cli: () => assert.fail("no CLI") }), /sandbox_operation_unsupported/);
});
test("deadline expiring during CLI observation denies returned metadata", async () => {
  const value = profile();
  await assert.rejects(inspectInstalledBrokerProfiles({ selection: { app: select(value) }, deadlineAt: new Date(Date.now() + 25).toISOString(),
    cli: async () => { await new Promise(resolve => setTimeout(resolve, 40)); return value; } }), /sandbox_operation_unsupported/);
});
test("request-time validator enforces the same actual role and exact selected binary", () => {
  const value = profile();
  assert.equal(verifyBrokerProviderProfile({ profile: value, profileId: value.id, profileHash: hash(value),
    origin: "https://platform.example.test", expectedBinaries: ["/usr/bin/node"] }).origin.origin, "https://platform.example.test");
  assert.throws(() => verifyBrokerProviderProfile({ profile: value, profileId: value.id, profileHash: hash(value),
    origin: "https://platform.example.test", expectedBinaries: ["/usr/bin/python"] }), /sandbox_operation_unsupported/);
});
test("App role cannot occupy the model selector even with an exact installed pin", async () => {
  const value = profile();
  await assert.rejects(inspectInstalledBrokerProfiles({ selection: { model: select(value) },
    cli: async () => value, deadlineAt: deadline() }), /sandbox_operation_unsupported/);
});
test("unbound installed profile does not advertise binary enforcement", async () => {
  const value = profile(); value.binaries = [];
  const result = await inspect(value, { ...select(value), binaries: [] });
  assert.deepEqual(result.credentialProfileDimensions, ["host", "port", "method", "path"]);
  assert.equal("expiresAt" in result, false);
  assert.equal("testedAt" in result, false);
});
