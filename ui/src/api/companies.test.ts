import { afterEach, expect, it, vi } from "vitest";
import { companiesApi } from "./companies";

afterEach(() => vi.unstubAllGlobals());

it("keeps directory requests separate from navigation and previous accounts", async () => {
  let resolveOldDirectory!: (response: Response) => void;
  const oldDirectory = new Promise<Response>((resolve) => { resolveOldDirectory = resolve; });
  const fetchMock = vi.fn()
    .mockReturnValueOnce(oldDirectory)
    .mockResolvedValueOnce(Response.json([{ id: "member-company" }]))
    .mockResolvedValueOnce(Response.json([{ id: "directory-company" }]));
  vi.stubGlobal("fetch", fetchMock);
  const previousAccount = companiesApi.directory();
  const navigation = companiesApi.list();
  companiesApi.detachInflightDirectory();
  const currentDirectory = companiesApi.directory();
  try {
    await expect(navigation).resolves.toEqual([{ id: "member-company" }]);
    await expect(currentDirectory).resolves.toEqual([{ id: "directory-company" }]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/companies", "/api/companies?scope=accessible", "/api/companies",
    ]);
  } finally {
    resolveOldDirectory(Response.json([]));
    await previousAccount;
  }
});

it("requests navigable companies and detaches the same request when accounts change", async () => {
  let resolveOldRequest!: (response: Response) => void;
  const oldRequest = new Promise<Response>((resolve) => { resolveOldRequest = resolve; });
  const currentCompanies = [{ id: "current-company" }];
  const fetchMock = vi.fn()
    .mockReturnValueOnce(oldRequest)
    .mockResolvedValueOnce(Response.json(currentCompanies));
  vi.stubGlobal("fetch", fetchMock);

  const previousAccount = companiesApi.list();
  companiesApi.detachInflightList();
  const currentAccount = companiesApi.list();
  try {
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/companies?scope=accessible",
      "/api/companies?scope=accessible",
    ]);
    await expect(currentAccount).resolves.toEqual(currentCompanies);
  } finally {
    resolveOldRequest(Response.json([{ id: "previous-company" }]));
    await previousAccount;
  }
});

it("binds responsibility contact reads and writes to the captured Human session", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ securityContactUserId: null, supportIncidentContactUserId: null, eligibleUsers: [] }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  await companiesApi.responsibilityContacts("company-1", "human-1", "session-1", { signal: new AbortController().signal });
  await companiesApi.updateResponsibilityContacts("company-1", { securityContactUserId: "human-2", supportIncidentContactUserId: null },
    "human-1", "session-1");
  const readInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const writeInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/companies/company-1/responsibility-contacts", "/api/companies/company-1/responsibility-contacts",
  ]);
  expect(readInit.cache).toBe("no-store");
  expect(new Headers(readInit.headers).get("X-Blentera-Expected-User")).toBe("human-1");
  expect(new Headers(readInit.headers).get("X-Blentera-Expected-Session")).toBe("session-1");
  expect(new Headers(writeInit.headers).get("X-Blentera-Expected-User")).toBe("human-1");
  expect(new Headers(writeInit.headers).get("X-Blentera-Expected-Session")).toBe("session-1");
});

it("binds local trusted contact writes without inventing a session id", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ securityContactUserId: null, supportIncidentContactUserId: null, eligibleUsers: [] }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  await companiesApi.responsibilityContacts("company-1", "local-board", null);
  await companiesApi.updateResponsibilityContacts("company-1", { securityContactUserId: null, supportIncidentContactUserId: null },
    "local-board", null);
  const readInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const writeInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
  expect(new Headers(readInit.headers).get("X-Blentera-Expected-User")).toBe("local-board");
  expect(new Headers(readInit.headers).has("X-Blentera-Expected-Session")).toBe(false);
  expect(new Headers(writeInit.headers).get("X-Blentera-Expected-User")).toBe("local-board");
  expect(new Headers(writeInit.headers).has("X-Blentera-Expected-Session")).toBe(false);
});
