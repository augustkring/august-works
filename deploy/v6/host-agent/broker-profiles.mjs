import { createHash } from "node:crypto";
import path from "node:path";

const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const fail = () => { throw new Error("sandbox_operation_unsupported"); };
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const validPath = value => typeof value === "string" && value.length <= 1024 && path.posix.isAbsolute(value) &&
  path.posix.normalize(value) === value && !/[\r\n\0]/.test(value) && value !== "/";
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const hashPattern = /^[a-f0-9]{64}$/;

/** Shared role validation for installed metadata and request-time provider use.
 * This proves installed profile structure, never Human/grant/qualification authority. */
export function verifyBrokerProviderProfile({ profile, profileId, profileHash, origin: rawOrigin, model = false, expectedBinaries = null }) {
  if (!idPattern.test(profileId ?? "") || !hashPattern.test(profileHash ?? "") ||
    !profile || profile.id !== profileId || digest(profile) !== profileHash ||
    !Array.isArray(profile.credentials) || profile.credentials.length !== 1 ||
    !Array.isArray(profile.endpoints) || profile.endpoints.length !== 1 ||
    !Array.isArray(profile.binaries) || profile.binaries.length > 32) fail();
  const actual = profile.binaries.map(value => value?.path).sort();
  if (profile.binaries.some(value => !exactKeys(value, ["path"]) || !validPath(value.path)) ||
    new Set(actual).size !== actual.length) fail();
  if (expectedBinaries !== null && (!Array.isArray(expectedBinaries) || expectedBinaries.length > 32 ||
    expectedBinaries.some(value => !validPath(value)) || new Set(expectedBinaries).size !== expectedBinaries.length ||
    JSON.stringify(actual) !== JSON.stringify([...expectedBinaries].sort()))) fail();
  const credential = profile.credentials[0];
  if (!exactKeys(credential, ["name", "env_vars", "required", "auth_style", "header_name"]) ||
    !idPattern.test(credential.name ?? "") || credential.required !== true || credential.auth_style !== "bearer" ||
    credential.header_name?.toLowerCase() !== "authorization" || !Array.isArray(credential.env_vars) ||
    credential.env_vars.length !== 1 || credential.env_vars[0] !==
      (model ? "PAPERCLIP_SANDBOX_MODEL_TOKEN" : "PAPERCLIP_SANDBOX_BROKER_TOKEN")) fail();
  let origin;
  try { origin = new URL(rawOrigin); } catch { fail(); }
  if (typeof rawOrigin !== "string" || origin.protocol !== "https:" || origin.origin !== rawOrigin ||
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) fail();
  const endpoint = profile.endpoints[0];
  // The CLI may omit an empty path; every other endpoint key must be known.
  const endpointKeys = endpoint?.path === undefined ? ["host", "port", "protocol", "enforcement", "rules"] :
    ["host", "port", "protocol", "enforcement", "rules", "path"];
  if (!exactKeys(endpoint, endpointKeys) || endpoint.host !== origin.hostname ||
    endpoint.port !== Number(origin.port || 443) || endpoint.protocol !== "rest" ||
    endpoint.enforcement !== "enforce" || (endpoint.path !== undefined && endpoint.path !== "") ||
    !Array.isArray(endpoint.rules) || endpoint.rules.length !== 1 ||
    !exactKeys(endpoint.rules[0], ["allow"]) || !exactKeys(endpoint.rules[0].allow, ["method", "path"]) ||
    endpoint.rules[0].allow.method !== "POST" || endpoint.rules[0].allow.path !==
      (model ? "/runtime-tools/model/v1/messages" : "/mcp/gateways/*")) fail();
  return { profile, origin };
}

/** No cache: actual installed CLI metadata is reobserved under the caller's
 * current bounded deadline. Missing selection advertises no runtime profile. */
export async function inspectInstalledBrokerProfiles({ selection, cli, deadlineAt }) {
  const result = { credentialProfileDimensions: [] };
  const current = () => { if (!Number.isFinite(Date.parse(deadlineAt)) || Date.parse(deadlineAt) <= Date.now()) fail(); };
  current();
  if (selection === undefined) return result;
  if (!selection || typeof selection !== "object" || Array.isArray(selection) ||
    Object.keys(selection).length === 0 || Object.keys(selection).some(key => !["app", "model"].includes(key))) fail();
  for (const role of ["app", "model"]) {
    if (selection[role] === undefined) continue;
    const selected = selection[role];
    if (!exactKeys(selected, ["id", "hash", "origin", "binaries"]) || !idPattern.test(selected.id ?? "") ||
      !hashPattern.test(selected.hash ?? "") || !Array.isArray(selected.binaries)) fail();
    current();
    const profile = await cli(["profile", "describe", selected.id, "--output", "json"], deadlineAt);
    current();
    verifyBrokerProviderProfile({ profile, profileId: selected.id, profileHash: selected.hash,
      origin: selected.origin, model: role === "model", expectedBinaries: selected.binaries });
    const binaries = profile.binaries.map(value => value.path).sort();
    result[role === "app" ? "credentialBrokerProviderProfile" : "modelBrokerProviderProfile"] = {
      id: profile.id, hash: digest(profile), binaries,
    };
    if (role === "app") result.credentialProfileDimensions = ["host", "port", "method", "path", ...(profile.binaries.length ? ["binary"] : [])];
  }
  return result;
}
