import { afterEach, describe, expect, it, vi } from "vitest";
import { accessApi } from "./access";

afterEach(() => vi.unstubAllGlobals());

describe("company member security suspension", () => {
  it("sends the selected reason bound to the captured Human session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ member: {}, ownerRecoveryRequired: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await accessApi.securitySuspendMember(
      "company-1",
      "member-1",
      { reasonCode: "suspected_compromise" },
      "user-1",
      "session-1",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("/api/companies/company-1/members/member-1/security-suspend");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ reasonCode: "suspected_compromise" });
    expect(headers.get("X-Blentera-Expected-User")).toBe("user-1");
    expect(headers.get("X-Blentera-Expected-Session")).toBe("session-1");
  });
});
