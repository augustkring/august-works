import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";
import { ensureHermesDataHome, hermesDataHome } from "./presence-profile.js";

/** Official Hermes a382af23: managed_scope applies HERMES_MANAGED_DIR after
 * the user config, expanding credential references from the process only.
 * Keep credentials out of config bytes, prompts, persisted results and logs. */
export async function prepareHermesGovernedProfile(input: {
  config: Record<string, unknown>;
  servers: AdapterRuntimeMcpServer[];
  skills: Array<{ runtimeName: string; source: string }>;
}) {
  if (input.servers.length !== 1 || input.servers[0].name !== "paperclip-assigned")
    throw new Error("hermes_governed_gateway_required");
  await ensureHermesDataHome(input.config);
  const home = hermesDataHome(input.config);
  if (path.basename(path.dirname(home)) !== "profiles")
    throw new Error("hermes_governed_bridge_requires_isolated_presence");

  // This is the dedicated server-owned profile, never the operator's global
  // config. Preserve existing provider settings; refuse an unreviewed YAML or
  // extra MCP definition rather than guessing its effective authority.
  const configPath = path.join(home, "config.yaml");
  const configuredMcp = { blentera_run_0: {
    url: "${BLENTERA_HERMES_MCP_0_URL}", headers: { Authorization: "Bearer ${BLENTERA_HERMES_MCP_0_TOKEN}" },
  } };
  // Hermes' early discovery probe reads raw user config, before the managed
  // overlay. Keep the same nonsecret declaration here so that discovery runs.
  await fs.writeFile(configPath, JSON.stringify({ mcp_servers: configuredMcp }) + "\n", { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const handle = await fs.open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let configText: string;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("hermes_profile_config_invalid");
    configText = await handle.readFile("utf8");
  } finally { await handle.close(); }
  let local: Record<string, unknown>;
  try {
    local = JSON.parse(configText);
    if (!local || typeof local !== "object" || Array.isArray(local)) throw new Error();
  } catch { throw new Error("hermes_profile_config_requires_review: managed presence config must use JSON-compatible YAML"); }
  if (!isDeepStrictEqual(local.mcp_servers, configuredMcp))
    throw new Error("hermes_unmanaged_mcp_configuration");

  const known = new Map(input.skills.map(skill => [skill.runtimeName, path.resolve(skill.source)]));
  const skillsHome = path.join(home, "skills");
  for (const entry of await fs.readdir(skillsHome, { withFileTypes: true })) {
    // Hermes also discovers legacy flat .md files and frontmatter aliases.
    // Only the server's selected, reconciled inventory may enter this profile.
    if (entry.isFile() && !entry.name.endsWith(".md")) continue;
    const expected = known.get(entry.name);
    const target = path.join(skillsHome, entry.name);
    if (!expected || !entry.isSymbolicLink() || await fs.realpath(target) !== await fs.realpath(expected))
      throw new Error("hermes_unmanaged_skill_collision");
  }

  const environment: Record<string, string> = {};
  const mcp: Record<string, unknown> = {};
  const toolsets = ["skills"];
  input.servers.forEach((server, index) => {
    const url = new URL(server.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || !server.token || /[\r\n]/.test(server.token))
      throw new Error("hermes_gateway_binding_invalid");
    const name = `blentera_run_${index}`;
    const prefix = `BLENTERA_HERMES_MCP_${index}`;
    environment[`${prefix}_URL`] = url.href;
    environment[`${prefix}_TOKEN`] = server.token;
    mcp[name] = { url: `\${${prefix}_URL}`, headers: { Authorization: `Bearer \${${prefix}_TOKEN}` } };
    toolsets.push(name);
  });
  const policy = JSON.stringify({ mcp_servers: mcp,
    skills: { project_discovery: false, trusted_project_dirs: [], external_dirs: [], create_dir: null },
  }) + "\n";
  const directory = await fs.mkdtemp(path.join(home, ".blentera-managed-"));
  try {
    await fs.writeFile(path.join(directory, "config.yaml"), policy, { flag: "wx", mode: 0o400 });
    await fs.chmod(directory, 0o500);
  } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
  environment.HERMES_MANAGED_DIR = directory;
  const expectedMcp = Object.fromEntries(input.servers.map((server, index) => [
    `blentera_run_${index}`, { url: new URL(server.url).href, headers: { Authorization: `Bearer ${server.token}` } },
  ]));
  return { environment, toolsets: toolsets.join(","),
    assertEffectivePolicy(mcpOutput: string, skillsOutput: string) {
      // Probe the installed CLI before dispatch: older Hermes versions ignore
      // HERMES_MANAGED_DIR. A configured file alone is not effective delivery.
      let actualMcp: unknown;
      let skills: Record<string, unknown>;
      try { actualMcp = JSON.parse(mcpOutput); skills = JSON.parse(skillsOutput); }
      catch { throw new Error("hermes_effective_policy_unverified"); }
      if (!isDeepStrictEqual(actualMcp, expectedMcp) || !skills || skills.project_discovery !== false ||
          !isDeepStrictEqual(skills.external_dirs, []) || skills.create_dir !== null ||
          !isDeepStrictEqual(skills.trusted_project_dirs, []))
        throw new Error("hermes_effective_policy_mismatch");
      const platformDisabled = skills.platform_disabled && typeof skills.platform_disabled === "object"
        ? Object.values(skills.platform_disabled) : [];
      for (const disabled of [skills.disabled, ...platformDisabled])
        if ((Array.isArray(disabled) ? disabled : typeof disabled === "string" ? [disabled] : []).includes("blentera-platform"))
          throw new Error("hermes_required_skill_disabled");
    },
    policyDigest: `sha256:${createHash("sha256").update(policy).digest("hex")}`,
    async dispose() { await fs.chmod(directory, 0o700); await fs.rm(directory, { recursive: true, force: true }); },
  };
}
