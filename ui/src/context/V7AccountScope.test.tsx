// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoundationBootstrap } from "@/pages/FoundationBootstrap";
import { DerivedMemory } from "@/pages/DerivedMemory";
import { queryKeys } from "@/lib/queryKeys";
import { useV7AccountScope, withV7AccountScope } from "./V7AccountScope";

const fixture = vi.hoisted(() => ({ userId: "a" as string | null, localImplicit: false, settled: true, failed: false, companyId: "company", breadcrumbs: vi.fn() }));
vi.mock("@/api/companies-query", () => ({ useAccountIdentity: () => fixture }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }) }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/router", () => ({ useParams: () => ({ bootstrapRunId: "run" }), Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, container: HTMLDivElement, client: QueryClient;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  Object.assign(fixture, { userId: "a", localImplicit: false, settled: true, failed: false, companyId: "company" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });
const render = (page: React.ReactNode) => act(async () => root.render(<QueryClientProvider client={client}>{page}</QueryClientProvider>));
async function input(value: string) {
  await act(async () => {
    const field = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("withholds a prior owner's cached discovery candidate from another member of the same company", async () => {
  const privateRun = { id: "run", companyId: "company", taskId: "task", status: "ready_for_review", version: 1, initialQuestions: [], sources: [], answers: {}, withheldCandidateCount: 0,
    candidates: [{ id: "candidate", title: "Private owner research", proposedContent: "Retained owner-only discovery content", claims: [], uncertainties: [], conflicts: [], materialQuestions: [] }] };
  client.setQueryData(["foundation-bootstrap", "company", "user:a", "run"], privateRun);
  client.setQueryData(["foundation-bootstrap", "company", "run"], privateRun);
  client.setQueryData(["bootstrap-agents", "company", "user:a"], []);
  const fetch = vi.fn(async (url: string) => url.includes("/agents?") ? response([]) : response({ error: "Discovery not found" }, 404));
  vi.stubGlobal("fetch", fetch);
  await render(<FoundationBootstrap />);
  expect(container.textContent).toContain("Retained owner-only discovery content");
  fixture.userId = "b";
  await render(<FoundationBootstrap />);
  expect(container.textContent).not.toContain("Retained owner-only discovery content");
  await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain("Discovery not found")); });
  expect(fetch.mock.calls.every(([url]) => url.includes("expectedActorId=user%3Ab"))).toBe(true);
  expect(client.getQueryData(["foundation-bootstrap", "company", "user:a", "run"])).toEqual(privateRun);
  expect(client.getQueryData(["foundation-bootstrap", "company", "user:b", "run"])).toBeUndefined();
});

it("does not reuse old accepted Memory or form content when the account changes", async () => {
  client.setQueryData(["derived-flags", "user:a"], {});
  client.setQueryData(["derived-source-memory", "company", "user:a"], [{ id: "record", title: "Owner's retained evidence", content: "Private research", scopeType: "company", reviewState: "accepted", retentionState: "active" }]);
  client.setQueryData(["derived-observations", "company", "user:a"], []);
  const fetch = vi.fn(async (url: string) => response(url.includes("/instance/") ? {} : [])); vi.stubGlobal("fetch", fetch);
  await render(<DerivedMemory />);
  expect(container.textContent).toContain("Owner's retained evidence");
  await act(async () => {
    const textarea = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Unsubmitted owner draft");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  fixture.userId = "b";
  await render(<DerivedMemory />);
  expect(container.textContent).not.toContain("Owner's retained evidence");
  expect(container.querySelector("textarea")?.value).toBe("");
  await act(async () => { await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); });
  expect(fetch.mock.calls.every(([url]) => url.includes("expectedActorId=user%3Ab"))).toBe(true);
});

function Probe() {
  const { principalId, cognitiveMemoryApi } = useV7AccountScope();
  const [draft, setDraft] = useState("");
  const mutation = useMutation({ mutationFn: () => cognitiveMemoryApi.reconcile(fixture.companyId, "binding") });
  return <div><p>{principalId}</p><input value={draft} onChange={event => setDraft(event.target.value)} /><button onClick={() => mutation.mutate()}>Reconcile</button>{mutation.data ? <p>{mutation.data.status}</p> : null}</div>;
}
const ScopedProbe = withV7AccountScope(Probe);

it("isolates a late mutation result and resets forms without discarding the QueryClient", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn((_url: string) => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
  await render(<ScopedProbe />); await input("Old account draft");
  await act(async () => container.querySelector("button")!.click());
  fixture.userId = "b";
  await render(<ScopedProbe />);
  expect(container.querySelector("input")!.value).toBe("");
  await act(async () => { finish(response({ status: "Old account result", count: 7 })); await Promise.resolve(); });
  expect(container.textContent).not.toContain("Old account result");
  expect(fetch.mock.calls[0]![0]).toContain("expectedActorId=user%3Aa");
});

it("resets account form state synchronously when the selected company changes", async () => {
  await render(<ScopedProbe />); await input("Company A draft");
  fixture.companyId = "other"; await render(<ScopedProbe />);
  expect(container.querySelector("input")!.value).toBe("");
});

it.each([{ settled: false, failed: false, expected: "Verifying your account" }, { settled: false, failed: true, expected: "Unable to verify your account" }])("hides account state while identity is unresolved: $expected", async state => {
  await render(<ScopedProbe />); await input("Sensitive unsaved draft");
  Object.assign(fixture, state); await render(<ScopedProbe />);
  expect(container.textContent).toContain(state.expected);
  expect(container.querySelector("input")).toBeNull();
});

it("hides a previously settled account during revalidation while retaining its draft if the account stays the same", async () => {
  await render(<ScopedProbe />); await input("Sensitive unsaved draft");
  let resolve!: (value: null) => void;
  let pending!: Promise<null>;
  await act(async () => {
    pending = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => new Promise<null>(finish => { resolve = finish; }) });
  });
  try {
    await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain("Verifying your account")); });
    expect(container.querySelector("input")!.closest('[style*="display: none"]')).not.toBeNull();
  } finally {
    await act(async () => { resolve(null); await pending; });
  }
  await act(async () => { await vi.waitFor(() => expect(container.querySelector("input")!.closest('[style*="display: none"]')).toBeNull()); });
  expect(container.querySelector("input")!.value).toBe("Sensitive unsaved draft");
});

it("preserves local trusted mode only after a successful public health answer", async () => {
  fixture.userId = null;
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", () => new Promise<Response>(resolve => { finish = resolve; }));
  await render(<ScopedProbe />); expect(container.querySelector("input")).toBeNull();
  await act(async () => { finish(response({ status: "ok", deploymentMode: "local_trusted" })); });
  await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain("local-board")); });
  expect(container.querySelector("input")).not.toBeNull();
});

it("does not treat a signed-out authenticated session as local board authority", async () => {
  fixture.userId = null;
  client.setQueryData(queryKeys.health, { status: "ok", deploymentMode: "authenticated" });
  await render(<ScopedProbe />);
  expect(container.textContent).toContain("Sign in to continue");
  expect(container.querySelector("input")).toBeNull();
});


it("uses current local provenance rather than the persisted profile ID and remounts when provenance changes", async () => {
  fixture.userId = "local-board";
  fixture.localImplicit = true;
  const fetch = vi.fn(async (_url: string) => response({ status: "done", count: 0 })); vi.stubGlobal("fetch", fetch);
  await render(<ScopedProbe />); await input("Local operator draft");
  await act(async () => container.querySelector("button")!.click());
  expect(fetch.mock.calls[0]![0]).toContain("expectedActorId=local-board");
  fixture.localImplicit = false;
  await render(<ScopedProbe />);
  expect(container.querySelector("input")!.value).toBe("");
  await act(async () => container.querySelector("button")!.click());
  expect(fetch.mock.calls[1]![0]).toContain("expectedActorId=user%3Alocal-board");
});
