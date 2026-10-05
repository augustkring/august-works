import { randomUUID } from "node:crypto";
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { runtimeRelayMessageSchema } from "@paperclipai/shared";
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
};
type Channel = {
  ws: WebSocket;
  opened: boolean;
  timer: ReturnType<typeof setTimeout>;
  scope: CellScope;
  cellId: string;
};
type Connection = { host: Host; ws: WebSocket; channels: Map<string, Channel> };

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
  let pending = 0,
    closed = false,
    checking = false;
  function send(ws: WebSocket, value: unknown) {
    if (
      ws.readyState !== WebSocket.OPEN ||
      ws.bufferedAmount > 4 * 1024 * 1024
    ) {
      ws.close(1013);
      return false;
    }
    ws.send(JSON.stringify(value));
    return true;
  }
  const verifyTimer = setInterval(() => {
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
        } catch {
          connection.ws.close(1011);
        }
      }
    })().finally(() => {
      checking = false;
    });
  }, 1000);
  verifyTimer.unref();
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
      }
    });
  });
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
    await new Promise<void>((resolve) => privateHttp.close(() => resolve()));
    publicWs.close();
    privateWs.close();
  }
  return { attach, listen, stop };
}
