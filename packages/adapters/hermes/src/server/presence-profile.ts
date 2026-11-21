import { createHash } from "node:crypto";
import os from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Hermes stores sessions, skills and its local Memory beneath HERMES_HOME.
 * Scope that state to a company presence; this is profile isolation, not an OS
 * sandbox or permission to publish local Memory into canonical Blentera Memory.
 * Official source: NousResearch/hermes-agent a382af23f4c067d23463b5781958684c2cda82bc. */
export function hermesPresenceConfig(config: Record<string, unknown>, identity: { companyId: string; agentId: string },
  isolationMode: "isolated_per_presence" | "shared_trusted_runtime" = "isolated_per_presence") {
  if (isolationMode === "shared_trusted_runtime") return config;
  if (!identity.companyId || !identity.agentId) throw new Error("hermes_presence_identity_required");
  const instance = process.env.PAPERCLIP_INSTANCE_ID || "default";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(instance)) throw new Error("hermes_instance_identity_invalid");
  const home = path.resolve(process.env.PAPERCLIP_HOME || path.join(os.homedir(), ".paperclip"), "instances", instance,
    // Hermes' CLI honors HERMES_HOME without consulting global active_profile
    // only when its immediate parent is named profiles (main._apply_profile_override).
    "runtime", "hermes-profiles", "profiles", createHash("sha256").update(JSON.stringify({ companyId: identity.companyId, agentId: identity.agentId })).digest("hex"));
  const env = object(config.env);
  for (const [key, expected] of Object.entries({ HERMES_HOME: home, HERMES_CONFIG: path.join(home, "config.yaml"), HERMES_ENV: path.join(home, ".env") })) {
    if (typeof env[key] === "string" && env[key] && path.resolve(env[key]) !== expected)
      throw new Error("hermes_profile_isolation_required: configure this presence's credentials or use an explicitly approved shared profile");
  }
  if (typeof env.HERMES_PROFILE === "string" && env.HERMES_PROFILE) throw new Error("hermes_named_profile_requires_explicit_binding");
  return { ...config, env: { ...env, HERMES_HOME: home, HERMES_CONFIG: path.join(home, "config.yaml"),
    HERMES_ENV: path.join(home, ".env"), HERMES_PROFILE: "" } };
}

export function hermesDataHome(config: Record<string, unknown>): string {
  const env = object(config.env);
  return typeof env.HERMES_HOME === "string" && env.HERMES_HOME ? path.resolve(env.HERMES_HOME)
    : path.join(typeof env.HOME === "string" && env.HOME ? path.resolve(env.HOME) : os.homedir(), ".hermes");
}
export const hermesProfileHash = (config: Record<string, unknown>) => createHash("sha256").update(hermesDataHome(config)).digest("hex");

/** Reject a redirected profile before Hermes or Skill reconciliation can write.
 * Fixed presence identity alone is insufficient when an ancestor is a link. */
export async function ensureHermesDataHome(config: Record<string, unknown>): Promise<void> {
  const home = hermesDataHome(config);
  let cursor = path.parse(home).root;
  for (const part of home.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat = await fs.lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!stat) {
      await fs.mkdir(cursor, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      stat = await fs.lstat(cursor);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("hermes_profile_directory_redirected");
  }
  await fs.chmod(home, 0o700);
}
