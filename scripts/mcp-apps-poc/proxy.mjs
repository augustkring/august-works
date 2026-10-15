import { APP_CSP, DENIED_PERMISSIONS, distinctPocOrigins, parsePocRpc, stringifyPocMessage } from "./policy.mjs";
const host = new URL(location.href).searchParams.get("host");
const { hostOrigin } = distinctPocOrigins(host, location.origin);
let view;
window.addEventListener("message", event => {
  let rpc;
  try { rpc = parsePocRpc(stringifyPocMessage(event.data)); } catch { return; }
  if (event.source === parent && event.origin === hostOrigin) {
    if (rpc.method === "ui/notifications/sandbox-resource-ready" && !view) {
      if (typeof rpc.params?.html !== "string" || rpc.params.html.length > 64 * 1024) return;
      view = document.createElement("iframe"); view.title = "Read-only synthetic app";
      view.sandbox = "allow-scripts allow-same-origin"; view.allow = DENIED_PERMISSIONS;
      view.referrerPolicy = "no-referrer"; view.credentialless = true;
      // A host-owned first policy cannot be loosened by a later resource policy.
      view.srcdoc = rpc.params.html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${APP_CSP}">`);
      document.body.append(view); return;
    }
    if (view && !rpc.method?.startsWith("ui/notifications/sandbox-")) view.contentWindow.postMessage(rpc, location.origin);
  } else if (view && event.source === view.contentWindow && event.origin === location.origin && !rpc.method?.startsWith("ui/notifications/sandbox-")) {
    parent.postMessage(rpc, hostOrigin);
  }
});
parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" }, hostOrigin);
