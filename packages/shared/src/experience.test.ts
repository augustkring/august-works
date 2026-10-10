import { describe, expect, it } from "vitest";
import {
  experienceCardSchema,
  experienceModelSchema,
  experienceScreenContractSchema,
  experienceAdvancedLinkSchema,
  experienceDependencySchema,
  resolveExperienceProfile,
} from "./experience.js";
const companyId = "10000000-0000-4000-8000-000000000001";
it("requires a native page boundary to be an observed partial dependency", () => {
  const dependency = {
    domain: "attention",
    state: "partial",
    observedAt: "2026-10-09T00:00:00.000Z",
    reason: "more_items_available",
  };
  expect(experienceDependencySchema.safeParse(dependency).success).toBe(true);
  expect(
    experienceDependencySchema.safeParse({ ...dependency, state: "fresh" })
      .success,
  ).toBe(false);
  expect(
    experienceDependencySchema.safeParse({ ...dependency, observedAt: null })
      .success,
  ).toBe(false);
});
const source = {
  companyId,
  domain: "task",
  resourceId: "task-1",
  version: "4",
  observedAt: "2026-10-09T09:00:00.000Z",
};
const action = {
  id: "open",
  label: "Open task",
  operation: "open",
  href: "/tasks/task-1",
  criticality: "C1",
  source,
  requiresCurrentAuthorization: true,
};
const card = {
  id: "task-1",
  kind: "progress",
  title: "Prepare report",
  whyYou: null,
  consequence: null,
  source,
  freshness: "fresh",
  actions: [action],
  evidence: [],
};
describe("experience authority boundaries", () => {
  it("rejects mismatched Advanced destinations and foreign or generated links", () => {
    expect(
      experienceAdvancedLinkSchema.safeParse({
        id: "role_packs",
        href: "/role-packs",
      }).success,
    ).toBe(true);
    for (const href of [
      "/company/settings/instance/experimental",
      "//attacker.test",
      "/role-packs?token=secret",
    ])
      expect(
        experienceAdvancedLinkSchema.safeParse({ id: "role_packs", href })
          .success,
      ).toBe(false);
    expect(
      experienceAdvancedLinkSchema.safeParse({
        id: "generated_page",
        href: "/role-packs",
      }).success,
    ).toBe(false);
  });
  it("does not escalate presentation depth from a preference or unrecognized membership", () => {
    expect(
      resolveExperienceProfile({
        membershipRole: "viewer",
        canManageCompany: false,
        canManageSecurity: false,
        preferred: "security_admin",
      }),
    ).toBe("member");
    expect(
      resolveExperienceProfile({
        membershipRole: "operator",
        canManageCompany: false,
        canManageSecurity: false,
      }),
    ).toBe("member");
    expect(
      resolveExperienceProfile({
        membershipRole: "owner",
        canManageCompany: true,
        canManageSecurity: false,
        preferred: "member",
      }),
    ).toBe("member");
    expect(
      resolveExperienceProfile({
        membershipRole: "owner",
        canManageCompany: true,
        canManageSecurity: true,
      }),
    ).toBe("manager");
  });
  it("rejects cross-company sources and action payloads", () => {
    const foreign = {
      ...source,
      companyId: "20000000-0000-4000-8000-000000000002",
    };
    expect(
      experienceCardSchema.safeParse({
        ...card,
        actions: [{ ...action, source: foreign }],
      }).success,
    ).toBe(false);
    expect(
      experienceModelSchema.safeParse({
        companyId,
        profile: "member",
        generatedAt: source.observedAt,
        dependencies: [],
        needsYou: [{ ...card, source: foreign }],
        inProgress: [],
        done: [],
        watch: [],
      }).success,
    ).toBe(false);
  });
  it("rejects forged attributes, external destinations and effects on stale cards", () => {
    expect(
      experienceCardSchema.safeParse({ ...card, html: "<script>" }).success,
    ).toBe(false);
    expect(
      experienceCardSchema.safeParse({
        ...card,
        actions: [{ ...action, href: "//attacker.test" }],
      }).success,
    ).toBe(false);
    expect(
      experienceCardSchema.safeParse({
        ...card,
        freshness: "stale",
        actions: [{ ...action, operation: "approve" }],
      }).success,
    ).toBe(false);
    expect(
      experienceCardSchema.safeParse({ ...card, freshness: "stale" }).success,
    ).toBe(true);
  });
  it("does not accept incomplete screen contracts", () => {
    expect(
      experienceScreenContractSchema.safeParse({
        screenId: "ONB-01",
        customerOutcome: "Sign in",
      }).success,
    ).toBe(false);
  });
});
