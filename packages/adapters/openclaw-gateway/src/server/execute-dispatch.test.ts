import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocketState = vi.hoisted(() => ({
  connectionAttempts: 0,
  failConnectAttempts: 0,
  failAgentRequests: 0,
  events: [] as string[],
  messages: [] as string[],
  agentRequests: [] as Record<string, unknown>[],
  methods: null as string[] | null,
  holdRun: false,
  cancelled: false,
  waitReplies: [] as Array<() => void>,
  connections: [] as Record<string, unknown>[],
}));

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");

  class FakeWebSocket extends EventEmitter {
    static readonly OPEN = 1;
    readonly readyState = FakeWebSocket.OPEN;
    readonly attempt: number;

    constructor() {
      super();
      this.attempt = ++websocketState.connectionAttempts;
      websocketState.events.push(`construct:${this.attempt}`);
      queueMicrotask(() => {
        if (this.attempt <= websocketState.failConnectAttempts) {
          this.emit("error", new Error("ECONNREFUSED"));
          return;
        }
        this.emit("open");
        this.emit("message", JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "test-nonce" },
        }));
      });
    }

    send(payload: string) {
      const request = JSON.parse(payload) as { id: string; method: string; params?: { message?: string } };
      if (request.method === "agent") websocketState.messages.push(request.params?.message ?? "");
      if (request.method === "agent") websocketState.agentRequests.push(request.params ?? {});
      if (request.method === "connect") websocketState.connections.push(request.params ?? {});
      websocketState.events.push(`send:${request.method}`);
      if (request.method === "agent" && websocketState.failAgentRequests > 0) {
        websocketState.failAgentRequests--;
        queueMicrotask(() => {
          this.emit("close", 1006, Buffer.from("ECONNRESET"));
        });
        return;
      }
      if (request.method === "agent.wait" && websocketState.holdRun && !websocketState.cancelled) {
        websocketState.waitReplies.push(() => this.emit("message", JSON.stringify({ type: "res", id: request.id, ok: true, payload: { status: "cancelled" } })));
        return;
      }
      if (request.method === "chat.abort") { websocketState.cancelled = true; websocketState.waitReplies.forEach((reply) => reply()); }
      const responsePayload = request.method === "connect"
        ? { protocol: 4, server: { version: "fixture-1" }, ...(websocketState.methods ? { features: { methods: websocketState.methods } } : {}) }
        : request.method === "skills.status" ? { skills: [{ name: "fixture-skill", description: "Advertised fixture" }] }
        : request.method === "tools.catalog" ? { tools: [{ id: "fixture-tool", name: "Fixture tool" }] }
        : request.method === "agent" && websocketState.holdRun ? { status: "accepted", runId: "remote-run-1" }
        : request.method === "agent.wait" && websocketState.cancelled ? { status: "cancelled" }
        : { status: "ok", runId: "remote-run-1", summary: "done" };
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({
          type: "res",
          id: request.id,
          ok: true,
          payload: responsePayload,
        }));
      });
    }

    close() {}
  }

  return { WebSocket: FakeWebSocket };
});

import { execute, discoverCapabilities } from "./execute.js";

function createContext(input: {
  onDispatch?: () => void;
  onLog?: AdapterExecutionContext["onLog"];
} = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "OpenClaw Agent",
      adapterType: "openclaw_gateway",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config: {
      url: "ws://127.0.0.1:18789",
      disableDeviceAuth: true,
      timeoutSec: 1,
    },
    context: {
      issueId: "issue-1",
      taskId: "issue-1",
      wakeReason: "interaction_resolved",
    },
    onLog: input.onLog ?? (async () => {}),
    onDispatch: input.onDispatch,
  };
}

describe("openclaw_gateway execute dispatch boundary", () => {
  beforeEach(() => {
    websocketState.connectionAttempts = 0;
    websocketState.failConnectAttempts = 0;
    websocketState.failAgentRequests = 0;
    websocketState.events = [];
    websocketState.messages = [];
    websocketState.agentRequests = [];
    websocketState.methods = null;
    websocketState.holdRun = false;
    websocketState.cancelled = false;
    websocketState.waitReplies = [];
    websocketState.connections = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes a V5 presence through its pinned provider agent and namespace instead of legacy configuration", async () => {
    const ctx = createContext();
    ctx.config.agentId = "legacy-agent";
    ctx.config.sessionKey = "shared-legacy-session";
    ctx.providerRuntime = { providerBindingId: "binding-1", providerAgentRef: "presence-provider", providerProfileRef: "presence-profile", sessionNamespace: "aw:company-1:agent-1", isolationMode: "isolated_per_presence", capabilitySnapshotHash: "capabilities-1" };
    expect((await execute(ctx)).exitCode).toBe(0);
    expect(websocketState.agentRequests[0]).toMatchObject({ agentId: "presence-provider", sessionKey: "agent:presence-provider:aw:company-1:agent-1:issue:issue-1" });
  });

  it("discovers read-only method and inventory advertisements without issuing provider work or claiming isolation", async () => {
    websocketState.methods = ["agent", "agent.wait", "chat.abort", "skills.status", "tools.catalog"];
    const ctx = createContext(), result = await discoverCapabilities({ companyId: ctx.agent.companyId, adapterType: "openclaw_gateway", config: ctx.config });
    expect(result).toMatchObject({ provider: "openclaw", version: "fixture-1", features: { sessions: true, cancellation: true, skillsDiscovery: true, toolDiscovery: true, memoryScoping: false, steering: false }, skills: [{ id: "fixture-skill" }], tools: [{ id: "fixture-tool" }] });
    expect(websocketState.connections[0]?.scopes).toEqual(["operator.read"]);
    expect(websocketState.agentRequests).toHaveLength(0);
    await expect(discoverCapabilities({ companyId: ctx.agent.companyId, adapterType: "openclaw_gateway", config: { ...ctx.config, url: "ws://provider.test" } })).rejects.toThrow("secure gateway");
  });

  it("confirms a dispatched provider cancellation through its terminal wait result", async () => {
    websocketState.methods = ["agent", "agent.wait", "chat.abort"];
    websocketState.holdRun = true;
    const ctx = createContext(), controller = new AbortController();
    ctx.signal = controller.signal;
    ctx.onCancellationReady = vi.fn(async () => {});
    ctx.onDispatch = () => queueMicrotask(() => controller.abort());
    expect(await execute(ctx)).toMatchObject({ errorCode: "cancelled", resultJson: { status: "cancelled" } });
    expect(ctx.onCancellationReady).toHaveBeenCalledOnce();
    expect(websocketState.events).toContain("send:chat.abort");
  });

  it.each([false, true])("sends conversation policy without the issue-completion workflow (resumed=%s)", async (resumed) => {
    const ctx = createContext();
    const directive = "Chat directive: clarify goals and hand plans off to project tasks.";
    ctx.context = {
      ...ctx.context,
      conversationMode: true,
      paperclipTaskMarkdown: directive,
      paperclipTaskMarkdownCompact: directive,
      paperclipWake: {
        reason: "issue_commented",
        issue: { id: "issue-1", workMode: "planning", status: "in_progress" },
        interactionKind: "request_confirmation",
        interactionStatus: "accepted",
      },
    };
    if (resumed) ctx.runtime.sessionId = "prior-session";
    const result = await execute(ctx);
    expect(result.exitCode).toBe(0);
    expect(websocketState.messages).toHaveLength(1);
    const prompt = websocketState.messages[0]!;
    expect(prompt).toContain(directive);
    expect(prompt).toContain("X-Paperclip-Run-Id");
    expect(prompt).not.toContain("Execution contract:");
    expect(prompt).not.toContain("Create child issues");
    expect(prompt).not.toContain('"status":"done"');
    expect(prompt).not.toContain("GET /api/issues/{issueId}/comments");
  });

  it("reports dispatch after transport setup and before the remote agent request", async () => {
    const onDispatch = vi.fn(() => {
      websocketState.events.push("dispatch");
    });

    const result = await execute(createContext({ onDispatch }));

    expect(result).toMatchObject({ exitCode: 0 });
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(websocketState.events).toEqual([
      "construct:1",
      "send:connect",
      "dispatch",
      "send:agent",
    ]);
  });

  it("retains the continuation gate through transient connection backoff", async () => {
    vi.useFakeTimers();
    websocketState.failConnectAttempts = 1;
    let resolveBackoff!: () => void;
    const backoffReached = new Promise<void>((resolve) => {
      resolveBackoff = resolve;
    });
    let resolveAuthorityChange!: () => void;
    const authorityChange = new Promise<void>((resolve) => {
      resolveAuthorityChange = resolve;
    });
    const onDispatch = vi.fn(resolveAuthorityChange);
    const resultPromise = execute(createContext({
      onDispatch,
      onLog: async (_stream, chunk) => {
        if (chunk.includes("transient error, retry")) resolveBackoff();
      },
    }));

    await backoffReached;
    expect(websocketState.connectionAttempts).toBe(1);
    expect(onDispatch).not.toHaveBeenCalled();

    let authorityChangeSettled = false;
    void authorityChange.then(() => {
      authorityChangeSettled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(authorityChangeSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;
    await authorityChange;

    expect(result).toMatchObject({ exitCode: 0 });
    expect(websocketState.connectionAttempts).toBe(2);
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(authorityChangeSettled).toBe(true);
  });

  it("does not retry after the remote-work boundary has been crossed", async () => {
    websocketState.failAgentRequests = 1;
    const onDispatch = vi.fn();

    const result = await execute(createContext({ onDispatch }));

    expect(result).toMatchObject({
      exitCode: 1,
      errorCode: "openclaw_gateway_request_failed",
    });
    expect(websocketState.connectionAttempts).toBe(1);
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });
});
