import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActivationConnectionConsentReceipt } from "@paperclipai/shared";
import { toolsApi } from "@/api/tools";
import { activationConnectionApi } from "@/api/activation-connections";
import { onboardingConnectionTools, type DeferredOnboardingConnection } from "./onboarding-connection-transport";

function fixture() {
  const connectionId = randomUUID();
  const context: DeferredOnboardingConnection = { companyId: randomUUID(), principal: "original-person", requestKey: randomUUID(),
    applicationId: randomUUID(), galleryKey: "gmail", methodKey: "paperclip-read", canUseAuthority: () => true,
    withAuthority: async operation => operation(), deferredAgentAccessLabel: "Agent access needs its own review and Safe Test" };
  const receipt: ActivationConnectionConsentReceipt = { id: randomUUID(), companyId: context.companyId, applicationId: context.applicationId,
    onboardingRunId: randomUUID(), packageVersionId: randomUUID(), requestKey: context.requestKey, status: "approved",
    reviewHash: "a".repeat(64), onboardingVersion: 1, connectionId: null, connectedAt: null, requestedAt: new Date().toISOString() };
  const original = { connectApp: vi.fn(), startOAuth: vi.fn(async () => ({ authorizationUrl: "https://accounts.google.com/fixture" })),
    putConnectionInstalls: vi.fn(), finishApp: vi.fn() } as unknown as typeof toolsApi;
  const consent = { receipt: vi.fn(async () => receipt), connect: vi.fn(async () => { throw new Error("Unknown allocation reply"); }) } as unknown as Pick<typeof activationConnectionApi, "receipt" | "connect">;
  return { context, receipt, connectionId, original, consent, tools: onboardingConnectionTools(context, original, consent) };
}
describe("Original onboarding connection transport", () => {
  it("reads the same Native receipt after an unknown reply and refuses a second allocation", async () => {
    const f = fixture(), input = { galleryKey: "gmail", connectionMethodKey: "paperclip-read", grantKind: "user" as const, applicationId: f.context.applicationId };
    await expect(f.tools.connectApp(f.context.companyId, input)).rejects.toThrow("Unknown allocation reply");
    expect(f.consent.connect).toHaveBeenCalledTimes(1); expect(f.original.connectApp).not.toHaveBeenCalled();
    f.receipt.status = "allocated"; f.receipt.connectionId = f.connectionId;
    await expect(f.tools.connectApp(f.context.companyId, input)).rejects.toThrow("Read the original allocation receipt");
    expect(f.consent.connect).toHaveBeenCalledTimes(1);
    await f.tools.startOAuth(f.connectionId, { asCurrentUser: true });
    expect(f.original.startOAuth).toHaveBeenCalledTimes(1);
    expect(f.consent.receipt).toHaveBeenCalledWith(f.context.companyId, f.context.principal, f.context.requestKey);
  });
  it("refuses identity broadening or Agent reach before any Original mutation", async () => {
    const f = fixture();
    await expect(f.tools.connectApp(f.context.companyId, { galleryKey: "gmail", connectionMethodKey: "paperclip-read", grantKind: "organization" })).rejects.toThrow("reviewed personal");
    f.receipt.status = "allocated"; f.receipt.connectionId = f.connectionId;
    await expect(f.tools.startOAuth(randomUUID(), { asCurrentUser: true })).rejects.toThrow("original connection receipt");
    await expect(f.tools.putConnectionInstalls(f.connectionId, [{ targetType: "company", targetId: f.context.companyId }])).rejects.toThrow("separate reviewed decision");
    await expect(f.tools.finishApp(f.context.companyId, f.connectionId, { access: "all_agents", enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [] })).rejects.toThrow("separate reviewed decision");
    expect(f.original.startOAuth).not.toHaveBeenCalled(); expect(f.original.putConnectionInstalls).not.toHaveBeenCalled(); expect(f.original.finishApp).not.toHaveBeenCalled();
    expect(f.consent.connect).not.toHaveBeenCalled();
  });
  it("rejects late acknowledgements across the host's original account epoch fence", async () => {
    const f = fixture(); let epoch = 0;
    f.context.withAuthority = async operation => { const before = epoch; const value = await operation(); if (before !== epoch) throw new Error("Account epoch changed"); return value; };
    f.receipt.status = "allocated"; f.receipt.connectionId = f.connectionId;
    let resolve!: (value: Awaited<ReturnType<typeof toolsApi.startOAuth>>) => void;
    vi.mocked(f.original.startOAuth).mockImplementation(() => new Promise(done => { resolve = done; }) as ReturnType<typeof toolsApi.startOAuth>);
    const acknowledgement = f.tools.startOAuth(f.connectionId, { asCurrentUser: true });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    epoch++; resolve({ connectionId: f.connectionId, provider: "google", authorizationUrl: "https://accounts.google.com/fixture", expiresAt: "2026-10-11T02:00:00Z" });
    await expect(acknowledgement).rejects.toThrow("Account epoch changed");
    expect(f.original.startOAuth).toHaveBeenCalledTimes(1);
  });
  it("reauthorizes only the exact connected personal row without calling another allocation owner", async () => {
    const f = fixture(); f.receipt.status = "connected"; f.receipt.connectionId = f.connectionId;
    f.receipt.connectedAt = "2026-10-11T01:00:00Z";
    await f.tools.startOAuth(f.connectionId, { asCurrentUser: true });
    expect(f.original.startOAuth).toHaveBeenCalledWith(f.connectionId, { asCurrentUser: true });
    expect(f.original.connectApp).not.toHaveBeenCalled(); expect(f.consent.connect).not.toHaveBeenCalled();
    f.receipt.status = "withdrawn";
    await expect(f.tools.startOAuth(f.connectionId, { asCurrentUser: true })).rejects.toThrow("original connection receipt");
    expect(f.original.startOAuth).toHaveBeenCalledTimes(1);
  });
  it("continues a retained allocated row through Original sign-in and finish without entering the allocator", async () => {
    const f = fixture(); f.receipt.status = "allocated"; f.receipt.connectionId = f.connectionId;
    f.context.connectionId = f.connectionId;
    await f.tools.startOAuth(f.connectionId, { asCurrentUser: true });
    await f.tools.finishApp(f.context.companyId, f.connectionId,
      { enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [], access: { agentIds: [] } });
    expect(f.original.startOAuth).toHaveBeenCalledWith(f.connectionId, { asCurrentUser: true });
    expect(f.original.finishApp).toHaveBeenCalledWith(f.context.companyId, f.connectionId,
      { enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [], access: { agentIds: [] } });
    expect(f.original.connectApp).not.toHaveBeenCalled(); expect(f.consent.connect).not.toHaveBeenCalled();
  });
});
