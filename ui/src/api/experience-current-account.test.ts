import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { experienceApi } from "./experience";
import { getExperienceCommands } from "./experience-commands";
const company = "10000000-0000-4000-8000-000000000001";
const foreignCompany = "10000000-0000-4000-8000-000000000002";
const observedAt = "2026-10-10T10:00:00.000Z";
const home = {
  companyId: company,
  profile: "member",
  generatedAt: observedAt,
  dependencies: [],
  needsYou: [],
  inProgress: [],
  done: [],
  watch: [],
};
const commands = {
  companyId: company,
  profile: "member",
  observedAt,
  commands: [],
  resources: [],
  semanticDrafting: "unqualified",
};
afterEach(() => vi.restoreAllMocks());
describe.each([
  [
    "Home",
    home,
    (signal?: AbortSignal) =>
      experienceApi.home(company, "private member", signal),
  ],
  [
    "Commands",
    commands,
    (signal?: AbortSignal) =>
      getExperienceCommands(
        company,
        "private member",
        "agent PRIVATE-QUERY",
        signal,
      ),
  ],
] as const)("%s private current-account client", (_name, view, read) => {
  it("binds the explicit account and uncached request", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(view);
    const controller = new AbortController();
    await expect(read(controller.signal)).resolves.toEqual(view);
    expect(
      new URL(
        get.mock.calls[0]![0],
        "https://fixture.invalid",
      ).searchParams.get("expectedUserId"),
    ).toBe("private member");
    expect(get.mock.calls[0]![1]).toEqual({
      signal: controller.signal,
      cache: "no-store",
    });
  });
  it("refuses foreign-tenant response data", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...view,
      companyId: foreignCompany,
    });
    await expect(read()).rejects.toThrow(/company|Company/);
  });
  it("cannot return a late private body after the owner request was cancelled", async () => {
    let resolve!: (value: unknown) => void;
    vi.spyOn(api, "get").mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const controller = new AbortController();
    const pending = read(controller.signal);
    controller.abort();
    resolve(view);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
