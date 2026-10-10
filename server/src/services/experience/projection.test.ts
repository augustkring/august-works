import { describe, expect, it } from "vitest";
import { composeExperience, ExperienceOverloadError } from "./projection.js";
const companyId = "10000000-0000-4000-8000-000000000001";
const source = {
  domain: "task" as const,
  companyId,
  resourceId: "one",
  version: "3",
  observedAt: "2026-10-09T00:00:00.000Z",
};
const card = {
  id: "one",
  kind: "progress" as const,
  title: "Current task",
  whyYou: null,
  consequence: null,
  source,
  freshness: "fresh" as const,
  actions: [],
  evidence: [],
};
describe("experience fan-in", () => {
  it("preserves a native page boundary as partial coverage rather than a complete empty queue", async () => {
    const model = await composeExperience({
      companyId,
      profile: "member",
      readers: [
        {
          domain: "attention",
          read: async () => ({
            needsYou: [],
            coverage: { state: "partial", reason: "more_items_available" },
          }),
        },
      ],
    });
    expect(model.needsYou).toEqual([]);
    expect(model.dependencies[0]).toMatchObject({
      domain: "attention",
      state: "partial",
      reason: "more_items_available",
    });
    expect(model.dependencies[0]!.observedAt).toBeTruthy();
  });
  it("retains healthy domains and truthfully reports failure without content in diagnostics", async () => {
    const model = await composeExperience({
      companyId,
      profile: "member",
      readers: [
        { domain: "tasks", read: async () => ({ inProgress: [card] }) },
        {
          domain: "attention",
          read: async () => {
            throw new Error("secret customer data");
          },
        },
      ],
    });
    expect(model.inProgress).toHaveLength(1);
    expect(model.dependencies.find((d) => d.domain === "attention")).toEqual({
      domain: "attention",
      state: "unavailable",
      observedAt: null,
      reason: "failure",
    });
    expect(JSON.stringify(model)).not.toContain("secret customer data");
  });
  it("bounds deadlines and discards late results", async () => {
    let resolve!: (value: { inProgress: (typeof card)[] }) => void;
    const late = new Promise<{ inProgress: (typeof card)[] }>((r) => {
      resolve = r;
    });
    const model = await composeExperience({
      companyId,
      profile: "member",
      deadlineMs: 5,
      readers: [{ domain: "tasks", read: () => late }],
    });
    expect(model.dependencies[0].reason).toBe("timeout");
    resolve({ inProgress: [card] });
    await late;
    await Promise.resolve();
    expect(model.inProgress).toEqual([]);
  });
  it("rejects excessive fanout and foreign source data", async () => {
    await expect(
      composeExperience({
        companyId,
        profile: "member",
        readers: Array.from({ length: 9 }, () => ({
          domain: "test",
          read: async () => ({}),
        })),
      }),
    ).rejects.toBeInstanceOf(ExperienceOverloadError);
    const model = await composeExperience({
      companyId,
      profile: "member",
      readers: [
        {
          domain: "tasks",
          read: async () => ({
            inProgress: [
              {
                ...card,
                source: {
                  ...source,
                  companyId: "20000000-0000-4000-8000-000000000002",
                },
              },
            ],
          }),
        },
      ],
    });
    expect(model.inProgress).toEqual([]);
    expect(model.dependencies[0].state).toBe("unavailable");
  });
  it("deduplicates overlapping native projections and does no work on an aborted request", async () => {
    const model = await composeExperience({
      companyId,
      profile: "member",
      readers: [
        { domain: "tasks", read: async () => ({ inProgress: [card, card] }) },
      ],
    });
    expect(model.inProgress).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await composeExperience({
      companyId,
      profile: "member",
      signal: controller.signal,
      readers: [
        {
          domain: "tasks",
          read: async () => {
            called = true;
            return {};
          },
        },
      ],
    });
    expect(called).toBe(false);
  });
});
