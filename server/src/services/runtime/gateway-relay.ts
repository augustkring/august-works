import { randomUUID } from "node:crypto";
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { runtimeRelayMessageSchema, runtimeSandboxExecRelayRequestSchema, type RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { forbidden } from "../../errors.js";

type Host = { id: string; credentialVersion: number };
type CellScope = {
  runtimeHostId: string;
  companyId: string;
  generation: string;
};
type Dependencies = {
  authenticateHost(proof: unknown, raw: Buffer): Promise<Host>;
  authorizeCell(
    cellId: string,
    generation: string,
    token: string,
  ): Promise<CellScope>;
  hostCurrent(host: Host): Promise<boolean>;
  cellCurrent(cellId: string, scope: CellScope): Promise<boolean>;
  authorizeExec?(input: { cellId: string; generation: string; request: RuntimeSandboxExecRelayRequest; capabilityToken: string }): Promise<CellScope>;
};
type Channel = {
  ws: WebSocket;
  opened: boolean;
  timer: ReturnType<typeof setTimeout>;
  scope: CellScope;
  cellId: string;
};
type Connection = { host: Host; ws: WebSocket; channels: Map<string, Channel> };
type ExecChannel = {
  cellId: string;
  scope: CellScope;
  timer: ReturnType<typeof setTimeout>;
  onOutput(stream: "stdout" | "stderr", chunk: Buffer): void | Promise<void>;
  resolve(value: { exitCode: number; timedOut: boolean }): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  abort?: () => void;
};

/** Outbound tunnels carry Gateway frames only for an authenticated host's current cells. */
export function runtimeGatewayRelay(deps: Dependencies) {
  const publicWs = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  const privateWs = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  const privateHttp = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const hosts = new Map<string, Connection>();
  const execChannels = new Map<string, ExecChannel>();
  let pending = 0,
    closed = false,
    checking = false;
  function send(ws: WebSocket, value: unknown) {
    const encoded = JSON.stringify(value);
    if (
      ws.readyState !== WebSocket.OPEN ||
      ws.bufferedAmount > 4 * 1024 * 1024 ||
      Buffer.byteLength(encoded) > 1024 * 1024
    ) {
      ws.close(1013);
      return false;
    }
    ws.send(JSON.stringify(value));
    return true;
  }
  let verifyTimer: ReturnType<typeof setInterval> | undefined;
  function startVerification() {
    if (verifyTimer || closed) return;
    verifyTimer = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      void (async () => {
        for (const connection of hosts.values()) {
          try {
            if (!(await deps.hostCurrent(connection.host))) {
              connection.ws.close(1008);
              continue;
            }
            for (const channel of connection.channels.values()) {
              try {
                if (!(await deps.cellCurrent(channel.cellId, channel.scope)))
                  channel.ws.close(1008);
              } catch {
                channel.ws.close(1008);
              }
            }
            for (const [id, channel] of execChannels) {
              if (channel.scope.runtimeHostId !== connection.host.id) continue;
              try {
                if (!(await deps.cellCurrent(channel.cellId, channel.scope)))
                  connection.ws.send(JSON.stringify({ type: "close", channelId: id }));
              } catch {
                connection.ws.send(JSON.stringify({ type: "close", channelId: id }));
              }
            }
          } catch {
            connection.ws.close(1011);
          }
        }
      })().finally(() => {
        checking = false;
      });
    }, 1000);
    verifyTimer.unref();
  }
  publicWs.on("connection", (ws) => {
    pending++;
    if (pending > 50) {
      pending--;
      ws.close(1013);
      return;
    }
    let connection: Connection | undefined;
    let queuedBytes = 0;
    let queue = Promise.resolve();
    const timer = setTimeout(() => {
      if (!connection) ws.close(1008);
    }, 5000);
    timer.unref();
    ws.on("error", () => ws.close());
    ws.on("message", (data, binary) => {
      if (
        binary ||
        queuedBytes + Buffer.byteLength(data.toString()) > 4 * 1024 * 1024
      ) {
        ws.close(1008);
        return;
      }
      const text = data.toString();
      queuedBytes += Buffer.byteLength(text);
      queue = queue
        .then(async () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const message = runtimeRelayMessageSchema.parse(JSON.parse(text));
          if (!connection) {
            if (message.type !== "hello") throw forbidden();
            const raw = Buffer.from(
              JSON.stringify({
                hostId: message.proof.hostId,
                epoch: message.proof.epoch,
              }),
            );
            const host = await deps.authenticateHost(message.proof, raw);
            if (hosts.has(host.id) || ws.readyState !== WebSocket.OPEN)
              throw forbidden();
            connection = { host, ws, channels: new Map() };
            hosts.set(host.id, connection);
            clearTimeout(timer);
            pending--;
            return;
          }
          if (message.type === "exec_output" || message.type === "exec_exit" || message.type === "exec_error") {
            const channel = execChannels.get(message.channelId);
            if (!channel || channel.scope.runtimeHostId !== connection.host.id) return;
            if (!(await deps.hostCurrent(connection.host)) || !(await deps.cellCurrent(channel.cellId, channel.scope))) {
              finishExec(message.channelId, new Error("sandbox_scope_changed"));
              return;
            }
            if (message.type === "exec_output") {
              try {
                await channel.onOutput(message.stream, Buffer.from(message.base64, "base64"));
              } catch (error) {
                send(connection.ws, { type: "close", channelId: message.channelId });
                finishExec(message.channelId, error instanceof Error ? error : new Error("sandbox_output_rejected"));
              }
            } else if (message.type === "exec_exit") {
              finishExec(message.channelId, undefined, { exitCode: message.exitCode, timedOut: message.timedOut });
            } else finishExec(message.channelId, new Error(message.code));
            return;
          }
          if (
            message.type !== "data" &&
            message.type !== "opened" &&
            message.type !== "close"
          )
            throw forbidden();
          const channel = connection.channels.get(message.channelId);
          if (!channel) return;
          if (message.type === "opened") {
            channel.opened = true;
            clearTimeout(channel.timer);
          } else if (message.type === "close") channel.ws.close(1000);
          else {
            if (!channel.opened) throw forbidden();
            if (channel.ws.bufferedAmount > 4 * 1024 * 1024)
              channel.ws.close(1013);
            else if (channel.ws.readyState === WebSocket.OPEN)
              channel.ws.send(message.text);
          }
        })
        .catch(() => {
          ws.close(1008);
        })
        .finally(() => {
          queuedBytes -= Buffer.byteLength(text);
        });
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (!connection) pending--;
      else {
        if (hosts.get(connection.host.id) === connection)
          hosts.delete(connection.host.id);
        for (const channel of connection.channels.values()) {
          clearTimeout(channel.timer);
          channel.ws.close(1011);
        }
        for (const [id, channel] of execChannels) {
          if (channel.scope.runtimeHostId === connection.host.id)
            finishExec(id, new Error("runtime_unavailable"));
        }
      }
    });
  });
  function finishExec(id: string, error?: Error, result?: { exitCode: number; timedOut: boolean }) {
    const channel = execChannels.get(id);
    if (!channel) return;
    clearTimeout(channel.timer);
    if (channel.signal && channel.abort) channel.signal.removeEventListener("abort", channel.abort);
    execChannels.delete(id);
    if (error) channel.reject(error);
    else if (result) channel.resolve(result);
    else channel.reject(new Error("exec_unknown"));
  }
  async function executeOpenShell(input: {
    cellId: string;
    generation: string;
    request: RuntimeSandboxExecRelayRequest;
    capabilityToken: string;
    signal?: AbortSignal;
    onOutput(stream: "stdout" | "stderr", chunk: Buffer): void | Promise<void>;
  }) {
    if (!deps.authorizeExec) throw forbidden("Run-scoped sandbox execution is unavailable");
    const request = runtimeSandboxExecRelayRequestSchema.parse(input.request);
    const scope = await deps.authorizeExec({ cellId: input.cellId, generation: input.generation, request, capabilityToken: input.capabilityToken });
    const connection = hosts.get(scope.runtimeHostId), deadlineAt = Date.parse(request.deadlineAt);
    if (!connection || connection.host.credentialVersion !== request.hostEpoch || scope.generation !== input.generation ||
      scope.companyId === "" || !(await deps.hostCurrent(connection.host)) || !(await deps.cellCurrent(input.cellId, scope)) ||
      !Number.isFinite(deadlineAt) || deadlineAt <= Date.now()) throw forbidden("Sandbox execution scope is stale");
    const channelId = randomUUID();
    return await new Promise<{ exitCode: number; timedOut: boolean }>((resolve, reject) => {
      const delay = Math.max(1, Math.min(60_000, deadlineAt - Date.now()));
      const channel: ExecChannel = {
        cellId: input.cellId,
        scope,
        timer: setTimeout(() => {
          send(connection.ws, { type: "close", channelId });
          finishExec(channelId, new Error("exec_timeout"));
        }, delay),
        onOutput: input.onOutput,
        resolve,
        reject,
        signal: input.signal,
      };
      channel.timer.unref();
      channel.abort = () => {
        send(connection.ws, { type: "close", channelId });
        finishExec(channelId, new Error("exec_unknown"));
      };
      execChannels.set(channelId, channel);
      input.signal?.addEventListener("abort", channel.abort, { once: true });
      const sent = send(connection.ws, {
        type: "exec_open", channelId, cellId: input.cellId, companyId: scope.companyId,
        generation: input.generation, capabilityToken: input.capabilityToken, request,
      });
      if (!sent) finishExec(channelId, new Error("runtime_unavailable"));
    });
  }
  privateHttp.on("upgrade", (req, socket, head) => {
    void (async () => {
      if (
        closed ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress ?? "",
        )
      )
        throw forbidden();
      const match = req.url?.match(
        /^\/cells\/([a-f0-9-]{36})\/([1-9][0-9]{0,18})$/i,
      );
      const token = req.headers["x-aw-relay-token"];
      if (
        !match ||
        typeof token !== "string" ||
        token.length > 128 ||
        req.headers.cookie
      )
        throw forbidden();
      const scope = await deps.authorizeCell(match[1]!, match[2]!, token);
      const host = hosts.get(scope.runtimeHostId);
      if (
        !host ||
        host.channels.size >= 200 ||
        !(await deps.hostCurrent(host.host))
      )
        throw forbidden();
      privateWs.handleUpgrade(req, socket, head, (ws) => {
        const channelId = randomUUID();
        const timer = setTimeout(() => ws.close(1011), 10000);
        timer.unref();
        host.channels.set(channelId, {
          ws,
          opened: false,
          timer,
          scope,
          cellId: match[1]!,
        });
        send(host.ws, {
          type: "open",
          channelId,
          cellId: match[1],
          companyId: scope.companyId,
          generation: scope.generation,
        });
        ws.on("error", () => ws.close());
        ws.on("message", (data, binary) => {
          if (binary) {
            ws.close(1003);
            return;
          }
          if (!host.channels.get(channelId)?.opened) {
            ws.close(1008);
            return;
          }
          send(host.ws, { type: "data", channelId, text: data.toString() });
        });
        ws.on("close", () => {
          clearTimeout(timer);
          host.channels.delete(channelId);
          send(host.ws, { type: "close", channelId });
        });
      });
    })().catch(() => {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
  });
  function attach(server: Server) {
    startVerification();
    server.on(
      "upgrade",
      (
        req: IncomingMessage & { paperclipWebSocketHandled?: boolean },
        socket,
        head,
      ) => {
        if (
          req.paperclipWebSocketHandled ||
          req.url !== "/api/internal/runtime/relay"
        )
          return;
        req.paperclipWebSocketHandled = true;
        if (closed || req.headers.cookie) {
          socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          return;
        }
        publicWs.handleUpgrade(req, socket, head, (ws) =>
          publicWs.emit("connection", ws, req),
        );
      },
    );
  }
  async function listen(port: number) {
    startVerification();
    await new Promise<void>((resolve, reject) => {
      privateHttp.once("error", reject);
      privateHttp.listen(port, "127.0.0.1", () => {
        privateHttp.off("error", reject);
        resolve();
      });
    });
    return (privateHttp.address() as AddressInfo).port;
  }
  async function stop() {
    closed = true;
    clearInterval(verifyTimer);
    for (const client of publicWs.clients) client.terminate();
    for (const client of privateWs.clients) client.terminate();
    for (const id of execChannels.keys()) finishExec(id, new Error("runtime_unavailable"));
    await new Promise<void>((resolve) => privateHttp.close(() => resolve()));
    publicWs.close();
    privateWs.close();
  }
  return { attach, listen, stop, executeOpenShell };
}
