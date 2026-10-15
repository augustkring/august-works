// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ActivationConnectionConsentReceipt, ActivationConnectionReview } from "@paperclipai/shared";
import { ActivationConnectionConsent } from "./ActivationConnectionConsent";
import { activationConnectionApi } from "../api/activation-connections";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
import { onboardingConsentAttemptKey } from "../features/connections/onboarding-consent-attempt";

const flow = vi.hoisted(() => vi.fn());
vi.mock("../features/connections/ConnectionSetupFlow", () => ({ ConnectionSetupFlow: (props: { onComplete: () => void }) => {
  flow(props); return <button onClick={() => props.onComplete()}>Finish original setup fixture</button>;
} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "10000000-0000-4000-8000-000000000001", runId = "20000000-0000-4000-8000-000000000001",
  packageVersionId = "30000000-0000-4000-8000-000000000001", applicationId = "40000000-0000-4000-8000-000000000001";
const review: ActivationConnectionReview = { companyId, onboardingRunId: runId, onboardingVersion: 1, packageVersionId,
  packageContentHash: "a".repeat(64), applicationId, applicationKey: "gmail", applicationName: "Original Gmail",
  galleryKey: "gmail", connectionMethodKey: "paperclip-read", methodHash: "b".repeat(64), providerScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  explanation: { providerName: "Gmail", resource: "https://gmailmcp.googleapis.com/mcp/v1", capabilityName: "Draft agent", providerWriteTools: [] },
  supersedesConsentId: null, existingConnection: null, scopeProfile: "gmail.read", grantKind: "user", deferAgentAccess: true, reviewHash: "c".repeat(64),
  preview: { neededNow: ["Personal account", "gmail.readonly"], why: "Prepare the original draft", usedBy: "No Agent access",
    canRead: ["Original provider scope"], canChange: ["No business changes"], notRequested: ["No deletion or spending"],
    automatic: ["No execution"], asksFirst: ["Agent actions require their own decision"] } };
const receipt = (requestKey: string): ActivationConnectionConsentReceipt => ({ id: "50000000-0000-4000-8000-000000000001",
  companyId, onboardingRunId: runId, packageVersionId, applicationId, requestKey, reviewHash: review.reviewHash,
  onboardingVersion: 1, status: "approved", connectionId: null, requestedAt: "2026-10-11T00:00:00Z", connectedAt: null });
let client: QueryClient, root: Root, container: HTMLDivElement;
const setupChanged = vi.fn();
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); container?.remove();
  sessionStorage.clear(); vi.restoreAllMocks(); flow.mockClear(); setupChanged.mockClear(); });
async function mount() {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("initiator"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><ActivationConnectionConsent companyId={companyId}
    principal="initiator" runId={runId} version={1} packageVersionId={packageVersionId} applicationKey="gmail"
    enabled canUseAuthority={() => true} onSetupChanged={setupChanged} /></QueryClientProvider>));
  await vi.waitFor(() => expect(container.querySelectorAll("dt")).toHaveLength(8));
}
const button = (key: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === i18n.t(key, { ns: "experience" }))!;
async function approve() {
  await act(async () => button("activation.connectionConsent.reviewDecision").click());
  expect(button("activation.connectionConsent.confirm").disabled).toBe(true);
  await act(async () => (document.querySelector('[role="alertdialog"] input') as HTMLInputElement).click());
  await act(async () => button("activation.connectionConsent.confirm").click());
}
function reads() { vi.spyOn(activationConnectionApi, "review").mockResolvedValue(review); return vi.spyOn(activationConnectionApi, "currentReceipt").mockResolvedValue(null); }

it("shows all eight fields and requires a separate C3 decision before the original personal setup", async () => {
  reads(); const post = vi.spyOn(activationConnectionApi, "approve").mockImplementation(async (_c, _u, _k, command) => receipt(command.requestKey));
  await mount(); expect(flow).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  expect(container.textContent).toContain("gmail.readonly"); await approve();
  await vi.waitFor(() => expect(button("activation.connectionConsent.providerSetup")).toBeDefined());
  expect(post.mock.calls[0]![3]).toEqual({ requestKey: expect.any(String), confirmConnectionAuthorization: true, expectedReviewHash: review.reviewHash });
  await act(async () => button("activation.connectionConsent.providerSetup").click());
  expect(flow.mock.calls.at(-1)?.[0].deferredOnboarding).toMatchObject({ principal: "initiator", applicationId,
    methodKey: "paperclip-read", requestKey: post.mock.calls[0]![3].requestKey });
});

it("reloads an unknown immutable command without automatically replaying it or allocating another connection", async () => {
  reads(); const post = vi.spyOn(activationConnectionApi, "approve").mockRejectedValue(Error("Unknown response"));
  await mount(); await approve(); await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const command = post.mock.calls[0]![3];
  expect(JSON.parse(sessionStorage.getItem(onboardingConsentAttemptKey(companyId, "initiator", runId, 1, "gmail"))!)).toEqual(command);
  await act(async () => root.unmount()); client.clear(); container.remove(); await mount();
  expect(post).toHaveBeenCalledTimes(1); expect(flow).not.toHaveBeenCalled();
  post.mockImplementation(async () => receipt(command.requestKey)); await approve();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2)); expect(post.mock.calls[1]![3]).toEqual(command);
});

it("hides a late approval and the provider host when the original session becomes unresolved", async () => {
  reads(); let resolve!: (value: ActivationConnectionConsentReceipt) => void;
  const post = vi.spyOn(activationConnectionApi, "approve").mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await approve();
  await act(async () => { void client.invalidateQueries({ queryKey: ["auth", "session"], exact: true, refetchType: "none" }); });
  await act(async () => resolve(receipt(post.mock.calls[0]![3].requestKey)));
  await vi.waitFor(() => expect(container.querySelector("dl")).toBeNull());
  expect(flow).not.toHaveBeenCalled(); expect(setupChanged).not.toHaveBeenCalled();
});

it("reads Native completion after the original flow and keeps withdrawal as a separate explicit decision", async () => {
  const saved = { ...receipt("60000000-0000-4000-8000-000000000001"), status: "allocated" as const,
    connectionId: "70000000-0000-4000-8000-000000000001" };
  const current = reads().mockResolvedValue(saved), withdraw = vi.spyOn(activationConnectionApi, "withdraw").mockResolvedValue({ ...saved, status: "withdrawn" });
  await mount(); await act(async () => button("activation.connectionConsent.providerSetup").click());
  current.mockResolvedValue({ ...saved, status: "connected", connectedAt: "2026-10-11T01:00:00Z" });
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Finish original setup fixture")!.click());
  await vi.waitFor(() => expect(setupChanged).toHaveBeenCalledTimes(1)); expect(withdraw).not.toHaveBeenCalled();
  await act(async () => button("activation.connectionConsent.withdraw").click());
  await act(async () => (document.querySelector('[role="alertdialog"] input') as HTMLInputElement).click());
  await act(async () => button("activation.connectionConsent.confirm").click());
  await vi.waitFor(() => expect(withdraw).toHaveBeenCalledWith(companyId, "initiator", saved.requestKey, saved.reviewHash));
});


it("explains an exact existing connection reuse and refreshes onboarding only on a confirmed Native connected receipt", async () => {
  reads(); vi.mocked(activationConnectionApi.review).mockResolvedValue({ ...review,
    supersedesConsentId: null, existingConnection: { id: "70000000-0000-4000-8000-000000000001", name: "Saved personal Gmail", setupHash: "d".repeat(64) } });
  const post = vi.spyOn(activationConnectionApi, "approve").mockImplementation(async (_c, _u, _k, command) => ({ ...receipt(command.requestKey),
    status: "connected", connectionId: "70000000-0000-4000-8000-000000000001", connectedAt: "2026-10-11T01:00:00Z" }));
  await mount(); expect(container.textContent).toContain("does not create another connection or repeat provider sign-in");
  expect(setupChanged).not.toHaveBeenCalled(); await approve();
  await vi.waitFor(() => expect(setupChanged).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledTimes(1); expect(flow).not.toHaveBeenCalled();
});

it("reconnects the exact already-connected personal purpose through the Original flow without approving or allocating again", async () => {
  const saved = { ...receipt("60000000-0000-4000-8000-000000000001"), status: "connected" as const,
    connectionId: "70000000-0000-4000-8000-000000000001", connectedAt: "2026-10-11T01:00:00Z" };
  reads().mockResolvedValue(saved);
  const approve = vi.spyOn(activationConnectionApi, "approve"), allocate = vi.spyOn(activationConnectionApi, "connect");
  await mount(); expect(flow).not.toHaveBeenCalled();
  expect(container.textContent).toContain("the personal connection needs current validation or reconnecting");
  await act(async () => button("activation.connectionConsent.reconnect").click());
  expect(flow.mock.calls.at(-1)?.[0].deferredOnboarding).toMatchObject({ connectionId: saved.connectionId,
    requestKey: saved.requestKey, principal: "initiator", methodKey: "paperclip-read" });
  expect(approve).not.toHaveBeenCalled(); expect(allocate).not.toHaveBeenCalled();
});

it("refetches the current successor review after withdrawal and requires a separate new explicit C3 command", async () => {
  const saved = { ...receipt("60000000-0000-4000-8000-000000000001"), status: "connected" as const,
    connectionId: "70000000-0000-4000-8000-000000000001", connectedAt: "2026-10-11T01:00:00Z" };
  reads().mockResolvedValue(saved);
  const successor = { ...review, supersedesConsentId: saved.id, reviewHash: "e".repeat(64),
    existingConnection: { id: saved.connectionId, name: "Retained personal Gmail", setupHash: "d".repeat(64) } };
  vi.mocked(activationConnectionApi.review).mockResolvedValueOnce(review).mockResolvedValue(successor);
  vi.spyOn(activationConnectionApi, "withdraw").mockResolvedValue({ ...saved, status: "withdrawn" });
  const post = vi.spyOn(activationConnectionApi, "approve").mockImplementation(async (_c, _u, _k, command) => ({ ...receipt(command.requestKey),
    id: "80000000-0000-4000-8000-000000000001", reviewHash: successor.reviewHash, status: "connected", connectionId: saved.connectionId,
    connectedAt: saved.connectedAt }));
  await mount(); await act(async () => button("activation.connectionConsent.withdraw").click());
  await act(async () => (document.querySelector('[role="alertdialog"] input') as HTMLInputElement).click());
  await act(async () => button("activation.connectionConsent.confirm").click());
  await vi.waitFor(() => expect(container.textContent).toContain("The earlier approval stays withdrawn"));
  expect(activationConnectionApi.review).toHaveBeenCalledTimes(2);
  expect(post).not.toHaveBeenCalled(); expect(flow).not.toHaveBeenCalled();
  await approve(); await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]![3].requestKey).not.toBe(saved.requestKey);
  expect(post.mock.calls[0]![3].expectedReviewHash).toBe(successor.reviewHash);
});

it("requires separate provider setup after retained-connection C3 without automatically opening or allocating anything", async () => {
  reads();
  const connectionId = "70000000-0000-4000-8000-000000000001";
  const retained = { ...review, supersedesConsentId: receipt("60000000-0000-4000-8000-000000000001").id,
    existingConnection: { id: connectionId, name: "Saved Gmail", setupHash: "d".repeat(64), needsValidation: true as const } };
  vi.mocked(activationConnectionApi.review).mockResolvedValue(retained);
  const post = vi.spyOn(activationConnectionApi, "approve").mockImplementation(async (_c, _u, _k, command) => ({ ...receipt(command.requestKey),
    status: "allocated", connectionId }));
  await mount();
  expect(container.textContent).toContain("Provider sign-in and current validation are still required before continuing");
  expect(container.textContent).not.toContain("does not create another connection or repeat provider sign-in");
  expect(flow).not.toHaveBeenCalled(); await approve();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(setupChanged).not.toHaveBeenCalled(); expect(flow).not.toHaveBeenCalled();
  await act(async () => button("activation.connectionConsent.providerSetup").click());
  expect(flow.mock.calls.at(-1)?.[0].deferredOnboarding).toMatchObject({ connectionId,
    requestKey: post.mock.calls[0]![3].requestKey, applicationId, methodKey: "paperclip-read" });
});

it("changes permission explanations to Danish without translating authored purpose or changing the pending C3 command", async () => {
  reads(); const post = vi.spyOn(activationConnectionApi, "approve").mockImplementation(async (_c, _u, _k, command) => receipt(command.requestKey));
  await mount();
  await act(async () => button("activation.connectionConsent.reviewDecision").click());
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.querySelectorAll("dt")).toHaveLength(8);
  expect(container.textContent).toContain("Læs e-mails (https://www.googleapis.com/auth/gmail.readonly)");
  expect(container.textContent).toContain("Personligt login til Gmail; ressource: https://gmailmcp.googleapis.com/mcp/v1");
  expect(container.textContent).toContain(review.preview.why);
  expect(container.textContent).toContain("ingen agent får adgang");
  expect(post).not.toHaveBeenCalled();
  await act(async () => (document.querySelector('[role="alertdialog"] input') as HTMLInputElement).click());
  await act(async () => button("activation.connectionConsent.confirm").click());
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]![3]).toMatchObject({ confirmConnectionAuthorization: true, expectedReviewHash: review.reviewHash });
});
