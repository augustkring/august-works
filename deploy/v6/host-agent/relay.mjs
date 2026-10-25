const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Machine-authenticated outbound tunnel; only the engine can resolve private cell endpoints. */
export function hostGatewayRelay({
  origin,
  proof,
  engine,
  openShell,
  WebSocketClass = WebSocket,
}) {
  let tunnel,
    stopped = false,
    reconnect,
    queue = Promise.resolve(),
    queuedBytes = 0;
  const channels = new Map();
  const execChannels = new Map();
  function send(value) {
    if (tunnel?.readyState !== 1 || tunnel.bufferedAmount > 4 * 1024 * 1024) {
      tunnel?.close(1013);
      return false;
    }
    tunnel.send(JSON.stringify(value));
    return true;
  }
  function connect() {
    if (stopped) return;
    const url = new URL("/api/internal/runtime/relay", origin);
    url.protocol = "wss:";
    const ws = (tunnel = new WebSocketClass(url));
    ws.addEventListener("open", () => {
      const raw = Buffer.from(
        JSON.stringify({ hostId: proof.hostId, epoch: proof.epoch }),
      );
      send({
        type: "hello",
        proof: proof.sign("WS", "/api/internal/runtime/relay", raw),
      });
    });
    ws.addEventListener("message", (event) => {
      if (
        typeof event.data !== "string" ||
        Buffer.byteLength(event.data) > 1024 * 1024 ||
        queuedBytes + Buffer.byteLength(event.data) > 4 * 1024 * 1024
      ) {
        ws.close(1008);
        return;
      }
      queuedBytes += Buffer.byteLength(event.data);
      queue = queue
        .then(async () => {
          if (ws !== tunnel || ws.readyState !== 1) return;
          const message = JSON.parse(event.data);
          if (!uuid.test(message.channelId)) throw new Error("invalid_channel");
          if (message.type === "exec_open") {
            if (!openShell || channels.has(message.channelId) || execChannels.has(message.channelId) ||
              !uuid.test(message.cellId) || !uuid.test(message.companyId) ||
              !/^[1-9][0-9]{0,18}$/.test(message.generation) ||
              typeof message.capabilityToken !== "string" || message.capabilityToken.length > 16384 ||
              !message.request || typeof message.request !== "object" || Array.isArray(message.request) ||
              Object.keys(message).sort().join(",") !== "capabilityToken,cellId,channelId,companyId,generation,request,type")
              throw new Error("invalid_exec_scope");
            const controller = new AbortController();
            execChannels.set(message.channelId, controller);
            void (async () => {
              try {
                const result = await openShell.executeStream({
                  scope: {
                    companyId: message.companyId,
                    cellId: message.cellId,
                    bindingId: message.request.bindingId,
                    cellGeneration: message.generation,
                    sandboxRef: message.request.sandboxRef,
                  },
                  request: message.request,
                  capabilityToken: message.capabilityToken,
                },
                async (stream, chunk) => {
                  for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
                    const part = chunk.subarray(offset, offset + 64 * 1024);
                    if (!send({ type: "exec_output", channelId: message.channelId, stream, base64: part.toString("base64") }))
                      throw new Error("exec_unknown");
                  }
                }, controller.signal);
                if (ws === tunnel && ws.readyState === 1)
                  send({ type: "exec_exit", channelId: message.channelId, exitCode: result.exitCode, timedOut: result.timedOut });
              } catch (error) {
                const code = ["policy_changed", "exec_rejected", "exec_timeout"].includes(error?.message)
                  ? error.message
                  : "exec_unknown";
                if (ws === tunnel && ws.readyState === 1) send({ type: "exec_error", channelId: message.channelId, code });
              } finally {
                execChannels.delete(message.channelId);
              }
            })();
            return;
          }
          if (message.type === "open") {
            if (
              channels.has(message.channelId) ||
              channels.size >= 200 ||
              !uuid.test(message.cellId) ||
              !uuid.test(message.companyId) ||
              !/^[1-9][0-9]{0,18}$/.test(message.generation)
            )
              throw new Error("invalid_cell_scope");
            let endpoint;
            try {
              endpoint = await engine.endpoint(
                message.cellId,
                message.generation,
                message.companyId,
              );
            } catch {
              send({ type: "close", channelId: message.channelId });
              return;
            }
            const gateway = new WebSocketClass(endpoint),
              timer = setTimeout(() => gateway.close(), 10000);
            timer.unref();
            channels.set(message.channelId, gateway);
            gateway.addEventListener("open", () => {
              clearTimeout(timer);
              send({ type: "opened", channelId: message.channelId });
            });
            gateway.addEventListener("message", (frame) => {
              if (
                typeof frame.data !== "string" ||
                Buffer.byteLength(frame.data) > 1024 * 1024
              ) {
                gateway.close(1003);
                return;
              }
              send({
                type: "data",
                channelId: message.channelId,
                text: frame.data,
              });
            });
            gateway.addEventListener("error", () => gateway.close());
            gateway.addEventListener("close", () => {
              clearTimeout(timer);
              channels.delete(message.channelId);
              send({ type: "close", channelId: message.channelId });
            });
          } else if (message.type === "data") {
            const gateway = channels.get(message.channelId);
            if (
              typeof message.text !== "string" ||
              Buffer.byteLength(message.text) > 1024 * 1024
            )
              throw new Error("invalid_frame");
            if (
              gateway?.readyState === 1 &&
              gateway.bufferedAmount <= 4 * 1024 * 1024
            )
              gateway.send(message.text);
            else {
              gateway?.close(1013);
              send({ type: "close", channelId: message.channelId });
            }
          } else if (message.type === "close") {
            channels.get(message.channelId)?.close();
            execChannels.get(message.channelId)?.abort();
          }
          else throw new Error("invalid_relay_message");
        })
        .catch(() => ws.close(1008))
        .finally(() => {
          queuedBytes -= Buffer.byteLength(event.data);
        });
    });
    ws.addEventListener("error", () => ws.close());
    ws.addEventListener("close", () => {
      if (ws !== tunnel) return;
      for (const gateway of channels.values()) gateway.close();
      channels.clear();
      for (const controller of execChannels.values()) controller.abort();
      execChannels.clear();
      if (!stopped) {
        reconnect = setTimeout(
          connect,
          2000 + Math.floor(Math.random() * 1000),
        );
        reconnect.unref();
      }
    });
  }
  function stop() {
    stopped = true;
    clearTimeout(reconnect);
    tunnel?.close();
    for (const gateway of channels.values()) gateway.close();
    channels.clear();
  }
  function start() {
    if (stopped) {
      stopped = false;
      connect();
    }
  }
  connect();
  return { stop, start };
}
