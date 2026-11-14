import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareHermesGovernedProfile } from "./governed-profile.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-governed-profile-")); roots.push(root);
  const home = path.join(root, "profiles", "presence");
  const source = path.join(root, "immutable-platform");
  await fs.mkdir(source); await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: blentera-platform\n---\nFixture\n");
  await fs.mkdir(path.join(home, "skills"), { recursive: true });
  await fs.symlink(source, path.join(home, "skills", "blentera-platform"));
  return { home, config: { env: { HERMES_HOME: home } }, servers: [{ name: "paperclip-assigned", url: "https://example.test/api/mcp/run", token: "run-scoped-fixture-secret", connectionId: "assignment:fixture" }],
    skills: [{ runtimeName: "blentera-platform", source }] };
}

it("uses the native managed overlay and exact toolsets without persisting the bearer", async () => {
  const input = await fixture();
  const result = await prepareHermesGovernedProfile(input);
  try {
    const policy = await fs.readFile(path.join(result.environment.HERMES_MANAGED_DIR, "config.yaml"), "utf8");
    expect(policy).not.toContain(input.servers[0].token);
    expect(JSON.parse(policy)).toMatchObject({ skills: { project_discovery: false, external_dirs: [] },
      mcp_servers: { blentera_run_0: { url: "${BLENTERA_HERMES_MCP_0_URL}", headers: { Authorization: "Bearer ${BLENTERA_HERMES_MCP_0_TOKEN}" } } } });
    expect(result.toolsets).toBe("skills,blentera_run_0");
    expect(result.environment.BLENTERA_HERMES_MCP_0_TOKEN).toBe(input.servers[0].token);
    expect(result.policyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const effectiveSkills = { project_discovery: false, external_dirs: [], create_dir: null, trusted_project_dirs: [] };
    const effectiveMcp = { blentera_run_0: { url: input.servers[0].url, headers: { Authorization: `Bearer ${input.servers[0].token}` } } };
    expect(() => result.assertEffectivePolicy(JSON.stringify(effectiveMcp), JSON.stringify(effectiveSkills))).not.toThrow();
    expect(() => result.assertEffectivePolicy("{}", JSON.stringify(effectiveSkills))).toThrow("policy_mismatch");
    expect(() => result.assertEffectivePolicy(JSON.stringify(effectiveMcp), JSON.stringify({ ...effectiveSkills, disabled: ["blentera-platform"] }))).toThrow("skill_disabled");
  } finally { await result.dispose(); }
  await expect(fs.stat(result.environment.HERMES_MANAGED_DIR)).rejects.toMatchObject({ code: "ENOENT" });
});

it("refuses an unknown local Skill even if its directory has another name", async () => {
  const input = await fixture();
  await fs.mkdir(path.join(input.home, "skills", "innocent-name"));
  await fs.writeFile(path.join(input.home, "skills", "innocent-name", "SKILL.md"), "---\nname: blentera-platform\n---\nOverride\n");
  await expect(prepareHermesGovernedProfile(input)).rejects.toThrow("unmanaged_skill_collision");
});

it("refuses foreign MCP config and redirected config files without changing them", async () => {
  const input = await fixture();
  const configPath = path.join(input.home, "config.yaml");
  const foreign = JSON.stringify({ mcp_servers: { skills: { url: "https://foreign.test" } } });
  await fs.writeFile(configPath, foreign);
  await expect(prepareHermesGovernedProfile(input)).rejects.toThrow("unmanaged_mcp_configuration");
  expect(await fs.readFile(configPath, "utf8")).toBe(foreign);
  await fs.unlink(configPath); await fs.symlink(path.join(input.skills[0].source, "SKILL.md"), configPath);
  await expect(prepareHermesGovernedProfile(input)).rejects.toThrow();
});

it("refuses to claim delivery without the actual canonical run gateway", async () => {
  const input = await fixture();
  await expect(prepareHermesGovernedProfile({ ...input, servers: [] })).rejects.toThrow("governed_gateway_required");
});
