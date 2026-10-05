import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runtimeNetworkRules } from "./engine.mjs";

const exec = promisify(execFile);
const filename = fileURLToPath(import.meta.url);

if (process.argv.includes("--network-fixture")) {
  const namespace = "aw-cell-fixture";
  let gateway;
  const host = createServer((socket) => socket.end("host"));
  try {
    await exec("ip", ["netns", "add", namespace]);
    await exec("ip", [
      "link",
      "add",
      "aw-host",
      "type",
      "veth",
      "peer",
      "name",
      "aw-cell",
    ]);
    await exec("ip", ["link", "set", "aw-cell", "netns", namespace]);
    await exec("ip", ["addr", "add", "172.30.0.1/24", "dev", "aw-host"]);
    await exec("ip", ["link", "set", "aw-host", "up"]);
    await exec("ip", [
      "netns",
      "exec",
      namespace,
      "ip",
      "addr",
      "add",
      "172.30.0.2/24",
      "dev",
      "aw-cell",
    ]);
    await exec("ip", [
      "netns",
      "exec",
      namespace,
      "ip",
      "link",
      "set",
      "aw-cell",
      "up",
    ]);
    host.listen(18400, "0.0.0.0");
    await once(host, "listening");
    const probe = async () => {
      const { stdout } = await exec("ip", [
        "netns",
        "exec",
        namespace,
        process.execPath,
        "--input-type=module",
        "-e",
        `
        import {createConnection} from 'node:net';
        const socket=createConnection({host:'172.30.0.1',port:18400});
        socket.setTimeout(500);
        socket.on('data',()=>{process.stdout.write('reachable');socket.destroy();});
        socket.on('timeout',()=>{process.stdout.write('blocked');socket.destroy();});
        socket.on('error',()=>{process.stdout.write('blocked');socket.destroy();});
      `,
      ]);
      return stdout;
    };
    // Establish that the test network can reach the host before installing policy.
    assert.equal(await probe(), "reachable");
    await exec("iptables", ["-N", "DOCKER-USER"]);
    for (const rule of runtimeNetworkRules("172.30.0.0/24"))
      await exec("iptables", ["-I", ...rule]);
    assert.equal(await probe(), "blocked");

    gateway = spawn(
      "ip",
      [
        "netns",
        "exec",
        namespace,
        process.execPath,
        "--input-type=module",
        "-e",
        `
      import {createServer} from 'node:net';
      createServer(socket=>socket.end('gateway')).listen(18401,'0.0.0.0',()=>process.stdout.write('ready'));
    `,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await once(gateway.stdout, "data");
    const socket = createConnection({ host: "172.30.0.2", port: 18401 });
    socket.setTimeout(1000, () =>
      socket.destroy(Error("Gateway reply blocked")),
    );
    try {
      assert.equal((await once(socket, "data"))[0].toString(), "gateway");
    } finally {
      socket.destroy();
    }
  } finally {
    gateway?.kill();
    await new Promise((resolve) => host.close(resolve));
    await exec("ip", ["netns", "delete", namespace]);
  }
} else {
  test("kernel firewall denies new cell-to-host connections while allowing host-initiated Gateway replies", async () => {
    assert.equal(process.getuid(), 0, "Host network acceptance requires root");
    await exec(
      "unshare",
      [
        "--mount",
        "--net",
        "--fork",
        process.execPath,
        filename,
        "--network-fixture",
      ],
      { timeout: 15000 },
    );
  });
}
