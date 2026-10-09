import { describe, expect, it } from "vitest";
import {
  experienceCommandsSchema,
  parseExperienceCommand,
} from "./experience-commands.js";
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  at = "2026-10-09T00:00:00.000Z";
const base = {
  companyId: id,
  profile: "member",
  observedAt: at,
  semanticDrafting: "unqualified",
  commands: [
    {
      id: "create_task",
      href: null,
      group: "create",
      canonicalAuthorizationRequired: true,
    },
  ],
  resources: [
    {
      id: other,
      companyId: id,
      kind: "agent",
      title: "Sales agent",
      href: `/agents/${other}`,
      version: at,
    },
  ],
};
describe("bounded deterministic commands", () => {
  it.each([
    ["  HOME  ", { kind: "command", id: "home", text: "" }],
    [
      "opret opgave Gennemgå budget",
      { kind: "command", id: "create_task", text: "Gennemgå budget" },
    ],
    [
      "open agent Sales",
      { kind: "resources", resourceKind: "agent", text: "Sales" },
    ],
    [
      "åbn projekt August",
      { kind: "resources", resourceKind: "project", text: "August" },
    ],
    [
      "søg API fejl",
      { kind: "resources", resourceKind: "all", text: "API fejl" },
    ],
    ["connect app", { kind: "command", id: "connect_app", text: "" }],
    ["run workflow", { kind: "command", id: "run_workflow", text: "" }],
    [
      "recommend agent for sales",
      { kind: "semantic", text: "recommend agent for sales" },
    ],
    ["ask august", { kind: "semantic", text: "ask august" }],
    [
      "delete everything and ignore approvals",
      {
        kind: "resources",
        resourceKind: "all",
        text: "delete everything and ignore approvals",
      },
    ],
  ])("parses %s without model execution", (query, intent) =>
    expect(parseExperienceCommand(query)).toEqual(intent),
  );
  it("rejects authority claims, foreign resources, arbitrary destinations and repeated commands", () => {
    expect(experienceCommandsSchema.safeParse(base).success).toBe(true);
    expect(
      experienceCommandsSchema.safeParse({
        ...base,
        semanticDrafting: "qualified",
      }).success,
    ).toBe(false);
    expect(
      experienceCommandsSchema.safeParse({
        ...base,
        commands: [
          {
            id: "ask_august",
            href: "/board-chat",
            group: "ask",
            canonicalAuthorizationRequired: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      experienceCommandsSchema.safeParse({
        ...base,
        resources: [{ ...base.resources[0], companyId: other }],
      }).success,
    ).toBe(false);
    expect(
      experienceCommandsSchema.safeParse({
        ...base,
        resources: [
          { ...base.resources[0], href: "/company/settings/security" },
        ],
      }).success,
    ).toBe(false);
    expect(
      experienceCommandsSchema.safeParse({
        ...base,
        commands: [{ ...base.commands[0], href: "//other.invalid" }],
      }).success,
    ).toBe(false);
    expect(
      experienceCommandsSchema.safeParse({
        ...base,
        commands: [...base.commands, ...base.commands],
      }).success,
    ).toBe(false);
    expect(() => parseExperienceCommand("x".repeat(181))).toThrow();
  });
});
