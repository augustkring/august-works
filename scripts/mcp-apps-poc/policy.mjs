// Anonymous C0 protocol experiment only. No authenticated AW runtime imports.
export const SPEC_VERSION = "2026-01-26";
export const MAX_RESOURCE_BYTES = 64 * 1024;
export const MAX_RPC_BYTES = 8192;
export const APP_MIME = "text/html;profile=mcp-app";
export const APP_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data:; media-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const DENIED_PERMISSIONS = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'";
const encoder = new TextEncoder();
function refuse() { throw new Error("Sandbox input unavailable"); }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) refuse();
  return value;
}
function read(wire, maxBytes) {
  if (typeof wire !== "string" || wire.length > maxBytes || encoder.encode(wire).byteLength > maxBytes) refuse();
  try {
    return JSON.parse(wire, (key, value) => {
      if (["__proto__", "constructor", "prototype"].includes(key)) refuse();
      return value;
    });
  } catch { return refuse(); }
}
export function distinctPocOrigins(host, sandbox) {
  // This harness binds only two loopback IPs. It is deliberately not a
  // production-origin or registrable-domain admission policy.
  let h, s;
  try { h = new URL(host); s = new URL(sandbox); } catch { return refuse(); }
  if (h.origin !== host || s.origin !== sandbox || h.protocol !== "http:" || s.protocol !== "http:" ||
      h.hostname !== "127.0.0.1" || s.hostname !== "127.0.0.2" || h.origin === s.origin) refuse();
  return { hostOrigin: h.origin, sandboxOrigin: s.origin };
}
export function admitPocResource(wire, expected) {
  const resource = object(read(wire, MAX_RESOURCE_BYTES), ["uri", "mimeType", "text", "sha256", "connectionId", "revision"]);
  if (typeof resource.text !== "string" || encoder.encode(resource.text).byteLength > MAX_RESOURCE_BYTES ||
      resource.uri !== expected.uri || !/^ui:\/\/[^\s]{1,200}$/.test(resource.uri) || resource.mimeType !== APP_MIME ||
      resource.connectionId !== expected.connectionId || resource.revision !== expected.revision ||
      resource.sha256 !== expected.sha256 || !/^[a-f0-9]{64}$/.test(resource.sha256) ||
      !/^<!doctype html>/i.test(resource.text)) refuse();
  // Caller MUST independently verify SHA-256 of the exact text bytes before
  // forwarding HTML. Metadata equality is not a content-integrity check.
  return resource;
}
/** Inspect cloned postMessage data before serialization: no accessor invocation,
 * oversized strings, exotic objects or unbounded depth/node traversal. */
export function stringifyPocMessage(data) {
  let nodes = 0;
  function copy(value, depth) {
    if (++nodes > 256 || depth > 8) refuse();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) refuse(); return value; }
    if (typeof value === "string") { if (value.length > MAX_RPC_BYTES) refuse(); return value; }
    if (!value || typeof value !== "object") refuse();
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) refuse();
    const keys = Object.getOwnPropertyNames(value).filter(key => key !== "length");
    if (keys.length > 64) refuse();
    const result = Array.isArray(value) ? [] : Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (["__proto__", "constructor", "prototype"].includes(key) || key.length > 64 || !Object.hasOwn(descriptor, "value")) refuse();
      if (descriptor.enumerable) result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  const wire = JSON.stringify(copy(data, 0));
  if (encoder.encode(wire).byteLength > MAX_RPC_BYTES) refuse();
  return wire;
}
export function parsePocRpc(wire) {
  const rpc = object(read(wire, MAX_RPC_BYTES), ["jsonrpc", "id", "method", "params", "result", "error"]);
  if (rpc.jsonrpc !== "2.0") refuse();
  if (rpc.id !== undefined && !(typeof rpc.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(rpc.id) || Number.isSafeInteger(rpc.id) && rpc.id >= 0)) refuse();
  if (rpc.method !== undefined) {
    if (typeof rpc.method !== "string" || !/^[a-zA-Z0-9_/-]{1,100}$/.test(rpc.method) || "result" in rpc || "error" in rpc) refuse();
    if (rpc.params !== undefined) object(rpc.params, Object.keys(rpc.params ?? {}));
  } else if (rpc.id === undefined || ("result" in rpc) === ("error" in rpc) || "params" in rpc) refuse();
  return rpc;
}
export function rpcRefusal(id) {
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "This experimental host does not admit this operation" } };
}
