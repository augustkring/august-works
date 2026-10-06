import { afterEach, expect, it, vi } from "vitest";
import { createAccountClient } from "./account-client";
import { createIssuesApi } from "./issues";

afterEach(() => { vi.unstubAllGlobals(); });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });

it("coalesces only within an account, even while another account's GET is pending", async () => {
  const replies: Array<(r: Response) => void> = [];
  const fetch = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => replies.push(resolve)));
  vi.stubGlobal("fetch", fetch);
  const a = createAccountClient("user:a"), b = createAccountClient("user:b");
  const first = a.get("/scope-fixture"), same = a.get("/scope-fixture"), other = b.get("/scope-fixture");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]![0]).toBe("/api/scope-fixture?expectedActorId=user%3Aa");
  expect(fetch.mock.calls[1]![0]).toBe("/api/scope-fixture?expectedActorId=user%3Ab");
  replies[0]!(json({ account: "a" })); replies[1]!(json({ account: "b" }));
  expect(await first).toEqual({ account: "a" }); expect(await same).toEqual({ account: "a" }); expect(await other).toEqual({ account: "b" });
});

it("preserves query parameters, mutation bodies, opt-in headers and the originally captured account", async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true })); vi.stubGlobal("fetch", fetch);
  const original = createAccountClient("user:original");
  await original.post("/review?workerId=worker&query=why?now", { decision: "accept" }, { headers: { "Idempotency-Key": "review-1" } });
  const [path, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
  const url = new URL(path, "http://localhost");
  expect(url.searchParams.get("workerId")).toBe("worker"); expect(url.searchParams.get("query")).toBe("why?now");
  expect(url.searchParams.get("expectedActorId")).toBe("user:original");
  expect(init.body).toBe(JSON.stringify({ decision: "accept" }));
  expect(new Headers(init.headers).get("Idempotency-Key")).toBe("review-1"); expect(init.credentials).toBe("include");
});

it("keeps account bindings on recursive Task pagination", async () => {
  const fetch = vi.fn(async (_url: string) => json([])); vi.stubGlobal("fetch", fetch);
  await createIssuesApi(createAccountClient("user:a")).listAll("company", {});
  expect(fetch.mock.calls[0]![0]).toContain("expectedActorId=user%3Aa");
});

it.each(["https://external.invalid/api", "//external.invalid/api", "/resource#hidden", "/resource?expectedActorId=user%3Aother"])("rejects unsafe or conflicting scoped paths: %s", path => {
  expect(() => createAccountClient("local-board").get(path)).toThrow();
});
