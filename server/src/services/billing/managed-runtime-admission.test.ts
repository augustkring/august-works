import { beforeEach, describe, expect, it, vi } from "vitest";

const commercial = vi.hoisted(() => ({ reason: null as string | null }));
vi.mock("../runtime/commercial.js", () => ({
  runtimeCommercialReason: vi.fn(async () => commercial.reason),
}));

const { assertManagedRuntimeCommercialAuthority } = await import("./managed-runtime-admission.js");

const CELL_ID = "11111111-1111-4111-8111-111111111111";
const BINDING_ID = "22222222-2222-4222-8222-222222222222";

/** Two ordered reads: the presence runtime binding, then its cell. */
function fakeDb(binding: Record<string, unknown> | null, cell: Record<string, unknown> | null) {
  const results = [binding ? [binding] : [], cell ? [cell] : []];
  return {
    select: () => {
      const rows = results.shift() ?? [];
      const chain = { from: () => chain, where: () => chain, limit: async () => rows };
      return chain;
    },
  } as never;
}

const binding = { providerBindingId: BINDING_ID, providerProfileRef: `aw:cell:${CELL_ID}:generation:1` };
const cell = (overrides: Record<string, unknown> = {}) => ({
  id: CELL_ID, companyId: "company-1", providerBindingId: BINDING_ID, generation: 1,
  status: "HEALTHY", suspendedReason: null, deletedAt: null, ...overrides,
});
const check = (row: Record<string, unknown>, options?: { acceptStoppedCell?: boolean }) =>
  assertManagedRuntimeCommercialAuthority(fakeDb(binding, row), "company-1", "agent-1", options);

describe("managed runtime commercial authority (APR-E2E-10)", () => {
  beforeEach(() => { commercial.reason = null; });

  it("admits a healthy cell for live and parked approved calls", async () => {
    await expect(check(cell())).resolves.toBeUndefined();
    await expect(check(cell(), { acceptStoppedCell: true })).resolves.toBeUndefined();
  });

  it("refuses a stopped cell for a live agent call", async () => {
    await expect(check(cell({ status: "STOPPED" }))).rejects.toMatchObject({ status: 403 });
  });

  it("admits a stopped, commercially current cell only for the parked approved execution", async () => {
    await expect(check(cell({ status: "STOPPED" }), { acceptStoppedCell: true })).resolves.toBeUndefined();
  });

  it.each([
    ["suspended", cell({ status: "STOPPED", suspendedReason: "billing_hold" })],
    ["deleted", cell({ status: "STOPPED", deletedAt: new Date() })],
    ["regenerated", cell({ status: "STOPPED", generation: 2 })],
    ["rebound to another provider binding", cell({ status: "STOPPED", providerBindingId: "33333333-3333-4333-8333-333333333333" })],
    ["failed", cell({ status: "FAILED" })],
    ["still being provisioned", cell({ status: "REQUESTED" })],
  ])("still refuses a %s cell for the parked approved execution", async (_label, row) => {
    await expect(check(row, { acceptStoppedCell: true })).rejects.toMatchObject({ status: 403 });
  });

  it("still refuses a stopped cell that is commercially blocked", async () => {
    commercial.reason = "commercial_access_expired";
    await expect(check(cell({ status: "STOPPED" }), { acceptStoppedCell: true })).rejects.toMatchObject({ status: 403 });
  });
});
