import http from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { APP_CSP, APP_MIME } from "./policy.mjs";
const directory = path.dirname(fileURLToPath(import.meta.url));
const permissions = "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), fullscreen=(), payment=()";
function respond(res, body, contentType, csp) {
  res.writeHead(200, { "Content-Type": contentType, "Content-Security-Policy": csp,
    "Permissions-Policy": permissions, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}
function listen(server, address) { return new Promise((resolve, reject) => {
  server.once("error", reject); server.listen(0, address, () => { server.off("error", reject); resolve(server.address().port); });
}); }
function close(server) { return new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); }
export async function startPoc() {
  let hostOrigin, sandboxOrigin, resource;
  const audit = { forbiddenRequests: 0, nonGetRequests: 0 };
  const scripts = Object.fromEntries(await Promise.all(["policy.mjs", "host.mjs", "proxy.mjs"].map(async file => [file, await readFile(path.join(directory, file), "utf8")])));
  function handler(side) { return (req, res) => {
    if (req.method !== "GET") { audit.nonGetRequests++; res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, "http://127.0.0.1");
    const csp = side === "host" ? `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src ${sandboxOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'`
      : APP_CSP.replace("frame-src 'none'", "frame-src 'self'");
    const file = url.pathname.slice(1);
    if (Object.hasOwn(scripts, file) && (side === "host" ? file !== "proxy.mjs" : file !== "host.mjs")) { respond(res, scripts[file], "text/javascript; charset=utf-8", csp); return; }
    if (side === "host" && url.pathname === "/config") { respond(res, JSON.stringify({ sandboxOrigin, resource: { ...resource, text: undefined, mimeType: undefined } }), "application/json", csp); return; }
    if (side === "host" && url.pathname === "/resource") { respond(res, JSON.stringify(resource), "application/json", csp); return; }
    if (side === "host" && url.pathname === "/") {
      respond(res, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AW MCP Apps C0 experiment</title><style>body{font:16px system-ui}button{min-height:44px}iframe{width:100%;height:560px;border:1px solid}</style></head><body><main><h1>AW anonymous MCP Apps experiment</h1><p>Experimental third-party panel. Synthetic data only. No AW connection or tool authority.</p><button id="open" disabled>Open isolated panel</button><button id="close" disabled>Close panel</button><p role="status">Panel closed</p><section id="panel" aria-label="Isolated app region"></section></main><script type="module" src="/host.mjs"></script></body></html>', "text/html; charset=utf-8", csp); return;
    }
    if (side === "sandbox" && url.pathname === "/proxy" && url.searchParams.get("host") === hostOrigin) {
      respond(res, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Isolated proxy</title><style>body{margin:0}iframe{width:100%;height:550px;border:0}</style></head><body><script type="module" src="/proxy.mjs"></script></body></html>', "text/html; charset=utf-8", csp); return;
    }
    if (url.pathname === "/forbidden") audit.forbiddenRequests++;
    res.writeHead(404, { "Cache-Control": "no-store" }); res.end();
  }; }
  const host = http.createServer(handler("host")), sandbox = http.createServer(handler("sandbox"));
  try {
    const hostPort = await listen(host, "127.0.0.1"); hostOrigin = `http://127.0.0.1:${hostPort}`;
    const sandboxPort = await listen(sandbox, "127.0.0.2"); sandboxOrigin = `http://127.0.0.2:${sandboxPort}`;
    const text = (await readFile(path.join(directory, "fixture.html"), "utf8")).replaceAll("__HOST_ORIGIN__", hostOrigin).replaceAll("__SANDBOX_ORIGIN__", sandboxOrigin);
    resource = { uri: "ui://aw-anonymous-poc/read-only", connectionId: "anonymous-c0-fixture", revision: "1", mimeType: APP_MIME, text, sha256: createHash("sha256").update(text).digest("hex") };
    return { hostOrigin, sandboxOrigin, audit, close: () => Promise.all([close(host), close(sandbox)]) };
  } catch (error) { await Promise.allSettled([close(host), close(sandbox)]); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const poc = await startPoc(); process.stdout.write(`${poc.hostOrigin}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await poc.close(); process.exit(0); });
}
