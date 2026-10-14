import { admitPocResource, distinctPocOrigins, parsePocRpc, stringifyPocMessage, rpcRefusal, SPEC_VERSION, DENIED_PERMISSIONS } from "./policy.mjs";
const status = document.querySelector('[role="status"]');
const open = document.querySelector("#open"), close = document.querySelector("#close");
const config = await (await fetch("/config", { credentials: "omit", cache: "no-store" })).json();
const origins = distinctPocOrigins(location.origin, config.sandboxOrigin);
let frame, state = "closed", count = 0, deadline, generation = 0, resourceText;
const audit = [];
const auditedMethods = new Set(["ui/initialize", "tools/call", "tools/list", "resources/read", "ui/open-link", "ui/message", "ui/request-display-mode", "ui/notifications/size-changed"]);
// Fixed event codes and method names only. Never retain app params/results/HTML.
window.pocAudit = audit;
function record(code, method) { if (audit.length < 64) audit.push({ code, ...(method ? { method: auditedMethods.has(method) ? method : "unsupported" } : {}) }); }
function stop(message = "Panel closed") {
  generation++; resourceText = undefined; clearTimeout(deadline); frame?.remove(); frame = undefined; state = "closed";
  status.textContent = message; close.disabled = true; open.disabled = false;
}
close.onclick = () => {
  if (state !== "ready") { stop(); open.focus(); return; }
  state = "closing";
  frame.contentWindow.postMessage({ jsonrpc: "2.0", id: `teardown-${generation}`, method: "ui/resource-teardown", params: {} }, origins.sandboxOrigin);
  deadline = setTimeout(() => { stop(); open.focus(); }, 150);
};
open.onclick = async () => {
  if (state !== "closed") return;
  const epoch = ++generation;
  state = "loading"; open.disabled = true; close.disabled = false; count = 0;
  try {
    const resource = admitPocResource(await (await fetch("/resource", { credentials: "omit", cache: "no-store" })).text(), config.resource);
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resource.text));
    const hash = [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
    if (epoch !== generation) return;
    if (hash !== resource.sha256 || state !== "loading" || !("credentialless" in HTMLIFrameElement.prototype)) throw Error();
    frame = document.createElement("iframe"); frame.title = "Experimental third-party panel";
    frame.sandbox = "allow-scripts allow-same-origin"; frame.allow = DENIED_PERMISSIONS;
    frame.referrerPolicy = "no-referrer"; frame.credentialless = true;
    frame.src = `${origins.sandboxOrigin}/proxy?host=${encodeURIComponent(origins.hostOrigin)}`;
    frame.onload = () => { if (state === "loading") status.textContent = "Loading isolated panel"; };
    document.querySelector("#panel").append(frame);
    deadline = setTimeout(() => stop("Panel unavailable; you can open it again"), 5000);
    resourceText = resource.text;
  } catch { if (epoch === generation) stop("Panel unavailable; you can open it again"); }
};
window.addEventListener("message", event => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== origins.sandboxOrigin) { record("wrong_peer"); return; }
  if (++count > 40) { record("budget_exhausted"); stop("Panel unavailable; you can open it again"); return; }
  let rpc;
  try { rpc = parsePocRpc(stringifyPocMessage(event.data)); } catch { record("malformed"); return; }
  if (state === "closing" && rpc.id === `teardown-${generation}` && rpc.method === undefined) { stop(); open.focus(); return; }
  if (rpc.method === "ui/notifications/sandbox-proxy-ready" && state === "loading" && rpc.id === undefined) {
    state = "initializing";
    frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-resource-ready", params: { html: resourceText } }, origins.sandboxOrigin);
    return;
  }
  if (rpc.method === "ui/initialize" && state === "initializing" && rpc.id !== undefined &&
      rpc.params?.protocolVersion === SPEC_VERSION && rpc.params?.appInfo?.name === "AW anonymous fixture" &&
      rpc.params?.appInfo?.version === "1.0" && JSON.stringify(rpc.params?.appCapabilities) === "{}" &&
      Object.keys(rpc.params).every(key => ["protocolVersion", "appInfo", "appCapabilities"].includes(key))) {
    state = "awaiting_initialized";
    frame.contentWindow.postMessage({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: SPEC_VERSION,
      hostInfo: { name: "AW anonymous C0 experiment", version: "1.0" }, hostCapabilities: {},
      hostContext: { theme: "light", displayMode: "inline", locale: "en" } } }, origins.sandboxOrigin);
    record("initialized_response"); return;
  }
  if (rpc.method === "ui/notifications/initialized" && state === "awaiting_initialized" && rpc.id === undefined) {
    state = "ready"; clearTimeout(deadline); status.textContent = "Isolated panel ready; no tools or permissions granted"; record("ready");
    frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } }, origins.sandboxOrigin);
    frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "Synthetic read-only fixture; no business result" }] } }, origins.sandboxOrigin);
    return;
  }
  if (typeof rpc.method === "string") {
    record("operation_refused", rpc.method);
    if (rpc.id !== undefined) frame.contentWindow.postMessage(rpcRefusal(rpc.id), origins.sandboxOrigin);
  }
});

open.disabled = false;
