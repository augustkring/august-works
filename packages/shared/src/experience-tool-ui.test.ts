import { describe, expect, it } from "vitest";
import { experienceModelSchema, type ExperienceCard } from "./experience.js";
import {
  isExperienceCardToolName,
  parseExperienceToolCardRequest,
  resolveExperienceToolCard,
} from "./experience-tool-ui.js";
const companyId = "10000000-0000-4000-8000-000000000001";
const source = {
  companyId,
  domain: "task" as const,
  resourceId: "AW-1",
  version: "1",
  observedAt: "2026-10-10T10:00:00.000Z",
};
const card: ExperienceCard = {
  id: "card",
  kind: "progress",
  title: "<script>quoted customer text</script>",
  whyYou: null,
  consequence: null,
  source,
  freshness: "fresh",
  evidence: [],
  actions: [
    {
      id: "open",
      label: "View task",
      operation: "open",
      href: "/issues/AW-1",
      source,
      criticality: "C1",
      requiresCurrentAuthorization: true,
    },
  ],
};
const wire = {
  schemaVersion: 1,
  component: "TaskCard",
  companyId,
  cardId: "card",
  source: { companyId, domain: "task", resourceId: "AW-1", version: "1" },
};
function model(c = card) {
  return experienceModelSchema.parse({
    companyId,
    profile: "member",
    generatedAt: source.observedAt,
    dependencies: [],
    needsYou: [],
    inProgress: [c],
    done: [],
    watch: [],
  });
}
describe("Native card tool renderer boundary", () => {
  it("uses the exact current Native card instead of tool prose", () => {
    const current = model();
    expect(
      resolveExperienceToolCard(
        parseExperienceToolCardRequest(JSON.stringify(wire)),
        current,
      ),
    ).toBe(current.inProgress[0]);
  });
  it.each([
    { ...wire, title: "Invented success" },
    { ...wire, html: "<img onerror=sendSecrets()>" },
    { ...wire, component: "ArbitraryReact" },
    { ...wire, operation: "publish" },
    { ...wire, companyId: "10000000-0000-4000-8000-000000000099" },
  ])("rejects injected UI/control semantics or foreign scope %j", (input) =>
    expect(() => parseExperienceToolCardRequest(input)).toThrow(),
  );
  it("rejects excessive bytes, inherited/accessor/prototype values and circular objects without invoking an accessor", () => {
    expect(() => parseExperienceToolCardRequest(" ".repeat(8193))).toThrow();
    expect(() => parseExperienceToolCardRequest(Object.create(wire))).toThrow();
    expect(() =>
      parseExperienceToolCardRequest(JSON.parse('{"__proto__":{}}')),
    ).toThrow();
    let called = false;
    const getter = Object.defineProperty({}, "source", {
      get() {
        called = true;
        return wire.source;
      },
    });
    expect(() => parseExperienceToolCardRequest(getter)).toThrow();
    expect(called).toBe(false);
    const circular: Record<string, unknown> = {};
    circular.source = circular;
    expect(() => parseExperienceToolCardRequest(circular)).toThrow();
  });
  it.each([
    { ...card, freshness: "stale" as const },
    { ...card, source: { ...source, version: "2" } },
    { ...card, source: { ...source, resourceId: "AW-2" } },
    { ...card, kind: "approval" as const },
    {
      ...card,
      actions: [{ ...card.actions[0], operation: "approve" as const }],
    },
  ])("refuses stale, changed, mismatched or executable current cards %j", (c) =>
    expect(() =>
      resolveExperienceToolCard(parseExperienceToolCardRequest(wire), model(c)),
    ).toThrow(),
  );
  it("refuses an absent, ambiguous or foreign current view", () => {
    const request = parseExperienceToolCardRequest(wire);
    const current = model();
    expect(() =>
      resolveExperienceToolCard(request, { ...current, inProgress: [] }),
    ).toThrow();
    expect(() =>
      resolveExperienceToolCard(request, {
        ...current,
        done: [current.inProgress[0]],
      }),
    ).toThrow();
    expect(() =>
      resolveExperienceToolCard(request, { ...current, companyId: "foreign" }),
    ).toThrow();
  });
});

it("accepts only the two exact Native display tool names, never suffix matches", () => {
  expect(isExperienceCardToolName("aw_experience_card")).toBe(true);
  expect(isExperienceCardToolName("mcp__paperclip__aw_experience_card")).toBe(true);
  for (const name of ["mcp__attacker__aw_experience_card", "prefix_aw_experience_card", "aw_experience_card_extra", null])
    expect(isExperienceCardToolName(name)).toBe(false);
});
