import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStoredBoardCredential,
  loginBoardCli,
  readBoardAuthStore,
  removeStoredBoardCredential,
  setStoredBoardCredential,
} from "../client/board-auth.js";

function createTempAuthPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-auth-"));
  return path.join(dir, "auth.json");
}

describe("board auth store", () => {
  it("returns an empty store when the file does not exist", () => {
    const authPath = createTempAuthPath();
    expect(readBoardAuthStore(authPath)).toEqual({
      version: 1,
      credentials: {},
    });
  });

  it("stores and retrieves credentials by normalized api base", () => {
    const authPath = createTempAuthPath();
    setStoredBoardCredential({
      apiBase: "http://localhost:3100/",
      token: "token-123",
      userId: "user-1",
      storePath: authPath,
    });

    expect(getStoredBoardCredential("http://localhost:3100", authPath)).toMatchObject({
      apiBase: "http://localhost:3100",
      token: "token-123",
      userId: "user-1",
    });
  });

  it("removes stored credentials", () => {
    const authPath = createTempAuthPath();
    setStoredBoardCredential({
      apiBase: "http://localhost:3100",
      token: "token-123",
      storePath: authPath,
    });

    expect(removeStoredBoardCredential("http://localhost:3100", authPath)).toBe(true);
    expect(getStoredBoardCredential("http://localhost:3100", authPath)).toBeNull();
  });
});


describe("board CLI polling backoff", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function harness(statuses: Array<{ status: number; body: unknown; retryAfter?: string }>, expiresIn = 10_000) {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const authPath = createTempAuthPath();
    const created = { id: "12345678-1234-4123-8123-123456789abc", token: "synthetic-challenge-capability",
      boardApiToken: "synthetic-board-token", approvalPath: "/cli-auth/approve", approvalUrl: null,
      pollPath: "/cli-auth/challenges/12345678-1234-4123-8123-123456789abc",
      expiresAt: new Date(Date.now() + expiresIn).toISOString(), suggestedPollIntervalMs: 1000 };
    let creates = 0, polls = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") { creates++; return new Response(JSON.stringify(created), { status: 201 }); }
      if (String(url).endsWith("/cli-auth/me")) return new Response(JSON.stringify({ userId: "synthetic-user" }));
      polls++;
      const next = statuses.shift();
      if (!next) throw new Error("Unexpected additional poll");
      return new Response(JSON.stringify(next.body), { status: next.status,
        headers: next.retryAfter === undefined ? undefined : { "Retry-After": next.retryAfter } });
    });
    vi.stubGlobal("fetch", fetcher);
    const outcome = loginBoardCli({ apiBase: "https://cli.example.invalid", requestedAccess: "board", storePath: authPath,
      openBrowser: false, print: false }).then(value => ({ value }), error => ({ error }));
    return { authPath, created, outcome, counts: () => ({ creates, polls }), cleanup: () => fs.rmSync(path.dirname(authPath), { recursive: true, force: true }) };
  }

  it("waits for numeric Retry-After and persists the original approved key", async () => {
    const f = harness([{ status: 429, body: { error: "Rate limited" }, retryAfter: "2" }, { status: 200, body: { status: "approved" } }]);
    try {
      await vi.advanceTimersByTimeAsync(1999);
      expect(f.counts()).toEqual({ creates: 1, polls: 1 });
      expect(getStoredBoardCredential("https://cli.example.invalid", f.authPath)).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(await f.outcome).toHaveProperty("value.token", f.created.boardApiToken);
      expect(getStoredBoardCredential("https://cli.example.invalid", f.authPath)?.token).toBe(f.created.boardApiToken);
      expect(f.counts()).toEqual({ creates: 1, polls: 2 });
    } finally { f.cleanup(); }
  });

  it.each([undefined, "not-a-time", "-1", "0"])("uses normal polling when Retry-After is %s", async retryAfter => {
    const f = harness([{ status: 429, body: { error: "Rate limited" }, retryAfter }, { status: 200, body: { status: "approved" } }]);
    try {
      await vi.advanceTimersByTimeAsync(999); expect(f.counts()).toEqual({ creates: 1, polls: 1 });
      await vi.advanceTimersByTimeAsync(1); expect(await f.outcome).toHaveProperty("value.token", f.created.boardApiToken);
      expect(f.counts()).toEqual({ creates: 1, polls: 2 });
    } finally { f.cleanup(); }
  });

  it("honors an HTTP-date Retry-After", async () => {
    const f = harness([{ status: 429, body: { error: "Rate limited" }, retryAfter: "Thu, 01 Jan 2026 00:00:02 GMT" },
      { status: 200, body: { status: "approved" } }]);
    try { await vi.advanceTimersByTimeAsync(2000); expect(await f.outcome).toHaveProperty("value.token", f.created.boardApiToken); }
    finally { f.cleanup(); }
  });

  it("never extends the original challenge deadline for a long Retry-After", async () => {
    const f = harness([{ status: 429, body: { error: "Rate limited" }, retryAfter: "3600" }], 1500);
    try {
      await vi.advanceTimersByTimeAsync(1500);
      expect(await f.outcome).toHaveProperty("error.message", "CLI auth challenge expired before approval.");
      expect(f.counts()).toEqual({ creates: 1, polls: 1 });
      expect(getStoredBoardCredential("https://cli.example.invalid", f.authPath)).toBeNull();
    } finally { f.cleanup(); }
  });

  it.each(["cancelled", "expired"])("preserves %s after a rate-limit wait", async status => {
    const f = harness([{ status: 429, body: { error: "Rate limited" }, retryAfter: "1" }, { status: 200, body: { status } }]);
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(await f.outcome).toHaveProperty("error.message", status === "cancelled" ? "CLI auth challenge was cancelled." : "CLI auth challenge expired before approval.");
      expect(f.counts()).toEqual({ creates: 1, polls: 2 });
      expect(getStoredBoardCredential("https://cli.example.invalid", f.authPath)).toBeNull();
    } finally { f.cleanup(); }
  });

  it("does not retry other HTTP failures", async () => {
    const f = harness([{ status: 503, body: { error: "Unavailable" } }]);
    try { expect(await f.outcome).toHaveProperty("error.message", "Unavailable"); expect(f.counts()).toEqual({ creates: 1, polls: 1 }); }
    finally { f.cleanup(); }
  });

  it("keeps raw secret and content arguments out of the persisted default challenge command", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "paperclipai", "secrets", "rotate", "secret-id", "--value", "synthetic-secret-canary", "--description=private-work-canary"];
    const f = harness([{ status: 200, body: { status: "approved" } }]);
    try {
      expect(await f.outcome).toHaveProperty("value.token", f.created.boardApiToken);
      const create = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
      const body = JSON.parse(String(create?.[1]?.body));
      expect(body.command).toBe("paperclipai");
      expect(JSON.stringify(body)).not.toContain("synthetic-secret-canary");
      expect(JSON.stringify(body)).not.toContain("private-work-canary");
    } finally { process.argv = originalArgv; f.cleanup(); }
  });

  it("uses the exact consented key metadata and preserves explicit expiration semantics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
    const authPath = createTempAuthPath();
    const expiresAt = new Date("2026-11-07T12:00:00.000Z");
    const approvedKey = {
      id: "approved-key-id", name: "human-approved-label", createdAt: "2026-10-24T12:00:00.000Z",
      lastUsedAt: null, revokedAt: null, expiresAt: expiresAt.toISOString(),
    };
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/cli-auth/challenges") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ keyName: approvedKey.name, keyExpiresAt: expiresAt.toISOString() });
        return new Response(JSON.stringify({ id: "challenge-id", token: "challenge-secret", boardApiToken: "approved-board-token",
          approvalPath: "/cli-auth/challenge-id", approvalUrl: null, pollPath: "/cli-auth/challenges/challenge-id",
          expiresAt: new Date(Date.now() + 60_000).toISOString(), suggestedPollIntervalMs: 500,
          keyName: approvedKey.name, keyExpiresAt: expiresAt.toISOString() }), { status: 201 });
      }
      if (parsed.pathname.endsWith("/cli-auth/challenges/challenge-id")) return new Response(JSON.stringify({ status: "approved" }));
      if (parsed.pathname.endsWith("/cli-auth/me")) return new Response(JSON.stringify({ userId: "approved-user", keyId: approvedKey.id }));
      if (parsed.pathname.endsWith("/board-api-keys")) return new Response(JSON.stringify([approvedKey]));
      throw new Error(`Unexpected ${init?.method ?? "GET"} ${parsed.pathname}`);
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const login = await loginBoardCli({ apiBase: "https://cli.example.invalid", requestedAccess: "board",
        keyName: approvedKey.name, keyExpiresAt: expiresAt, includeKeyMetadata: true,
        storePath: authPath, openBrowser: false, print: false });
      expect(login.key).toEqual({ ...approvedKey, token: "approved-board-token" });
      expect(login.token).toBe("approved-board-token");
      expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        "/api/cli-auth/challenges", "/api/cli-auth/challenges/challenge-id", "/api/cli-auth/me", "/api/board-api-keys",
      ]);
      expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get("authorization")).toBe("Bearer approved-board-token");
      expect(getStoredBoardCredential("https://cli.example.invalid", authPath)?.token).toBe("approved-board-token");
    } finally {
      fs.rmSync(path.dirname(authPath), { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it.each([
    ["missing key id", [{ id: "different-key-id", name: "requested-label", createdAt: "2026-10-24T12:00:00.000Z",
      lastUsedAt: null, revokedAt: null, expiresAt: "2026-11-07T12:00:00.000Z" }], "Approved CLI key metadata is unavailable."],
    ["wrong name", [{ id: "approved-key-id", name: "other-label", createdAt: "2026-10-24T12:00:00.000Z",
      lastUsedAt: null, revokedAt: null, expiresAt: "2026-11-07T12:00:00.000Z" }], "Approved CLI key name did not match the requested name."],
    ["wrong expiration", [{ id: "approved-key-id", name: "requested-label", createdAt: "2026-10-24T12:00:00.000Z",
      lastUsedAt: null, revokedAt: null, expiresAt: "2026-11-08T12:00:00.000Z" }], "Approved CLI key expiration did not match the requested expiration."],
  ] as const)("rejects approved metadata with %s without storing the credential", async (_case, keys, message) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
    const authPath = createTempAuthPath();
    const expiresAt = new Date("2026-11-07T12:00:00.000Z");
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith("/cli-auth/challenges") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "challenge-id", token: "challenge-secret", boardApiToken: "approved-board-token",
          approvalPath: "/cli-auth/challenge-id", approvalUrl: null, pollPath: "/cli-auth/challenges/challenge-id",
          expiresAt: new Date(Date.now() + 60_000).toISOString(), suggestedPollIntervalMs: 500,
          keyName: "requested-label", keyExpiresAt: expiresAt.toISOString() }), { status: 201 });
      }
      if (parsed.pathname.endsWith("/cli-auth/challenges/challenge-id")) return new Response(JSON.stringify({ status: "approved" }));
      if (parsed.pathname.endsWith("/cli-auth/me")) return new Response(JSON.stringify({ userId: "approved-user", keyId: "approved-key-id" }));
      if (parsed.pathname.endsWith("/board-api-keys")) return new Response(JSON.stringify(keys));
      throw new Error(`Unexpected ${init?.method ?? "GET"} ${parsed.pathname}`);
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(loginBoardCli({ apiBase: "https://cli.example.invalid", requestedAccess: "board",
        keyName: "requested-label", keyExpiresAt: expiresAt, includeKeyMetadata: true,
        storePath: authPath, openBrowser: false, print: false })).rejects.toThrow(message);
      expect(getStoredBoardCredential("https://cli.example.invalid", authPath)).toBeNull();
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
      expect(fetcher.mock.calls.some(([url, init]) => new URL(String(url)).pathname === "/api/board-api-keys" && init?.method === "POST"))
        .toBe(false);
    } finally {
      fs.rmSync(path.dirname(authPath), { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it("omits an undefined expiration and rejects a server that strips requested key settings", async () => {
    vi.useFakeTimers();
    const authPath = createTempAuthPath();
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty("keyExpiresAt");
      return new Response(JSON.stringify({ id: "challenge-id", token: "challenge-secret", boardApiToken: "pending-token",
        approvalPath: "/cli-auth/challenge-id", approvalUrl: null, pollPath: "/cli-auth/challenges/challenge-id",
        expiresAt: new Date(Date.now() + 60_000).toISOString(), suggestedPollIntervalMs: 500,
        keyName: "different-name", keyExpiresAt: null }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(loginBoardCli({ apiBase: "https://cli.example.invalid", requestedAccess: "board",
        keyName: "requested-name", storePath: authPath, openBrowser: false, print: false }))
        .rejects.toThrow("CLI auth challenge did not preserve the requested key name.");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(getStoredBoardCredential("https://cli.example.invalid", authPath)).toBeNull();
    } finally {
      fs.rmSync(path.dirname(authPath), { recursive: true, force: true });
      vi.useRealTimers();
    }
  });

  it("serializes an explicit non-expiring request as null", async () => {
    vi.useFakeTimers();
    const authPath = createTempAuthPath();
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({ keyName: "never-expiring", keyExpiresAt: null });
        return new Response(JSON.stringify({ id: "challenge-id", token: "challenge-secret", boardApiToken: "pending-token",
          approvalPath: "/cli-auth/challenge-id", approvalUrl: null, pollPath: "/cli-auth/challenges/challenge-id",
          expiresAt: new Date(Date.now() + 60_000).toISOString(), suggestedPollIntervalMs: 500,
          keyName: "never-expiring", keyExpiresAt: null }), { status: 201 });
      }
      return new Response(JSON.stringify({ status: "cancelled" }));
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(loginBoardCli({ apiBase: "https://cli.example.invalid", requestedAccess: "board",
        keyName: "never-expiring", keyExpiresAt: null, storePath: authPath,
        openBrowser: false, print: false })).rejects.toThrow("CLI auth challenge was cancelled.");
    } finally {
      fs.rmSync(path.dirname(authPath), { recursive: true, force: true });
      vi.useRealTimers();
    }
  });
});
