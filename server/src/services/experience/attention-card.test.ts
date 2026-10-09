import { expect, it } from "vitest";
import { experienceCardSchema, type AttentionItem } from "@paperclipai/shared";
import { attentionExperienceCard } from "./attention-card.js";
const observedAt = "2026-10-09T00:00:00.000Z";
const item: AttentionItem = {
  id: "approval:bounded",
  companyId: "10000000-0000-4000-8000-000000000001",
  sourceKind: "approval",
  subject: {
    kind: "approval",
    id: "native-approval",
    companyId: "10000000-0000-4000-8000-000000000001",
    title: "Approve the bounded plan",
    identifier: null,
    status: "pending",
    href: null,
  },
  whyNow: "Approval is pending a board decision.",
  decisionVerbs: [],
  inlineResolvable: false,
  entryRule: "pending",
  exitRule: "decided",
  dedupKey: "approval:bounded",
  dismissalKey: "approval:bounded",
  dismissal: null,
  severity: "medium",
  rank: 1,
  activityAt: observedAt,
  createdAt: observedAt,
  updatedAt: observedAt,
  relatedIssue: null,
  project: null,
  workspace: null,
  expiresAt: null,
  ruleKey: null,
  originAgentName: null,
  queues: [],
  shelf: false,
  retentionDays: 30,
  keep: false,
  archivedAt: null,
  retentionVersion: 1,
  decideBy: null,
  decideByAttribution: null,
  snoozedUntil: null,
  detail: null,
  trainingExampleId: null,
};
it("projects pending approval consequences without granting an action or inventing a business impact", () => {
  const card = experienceCardSchema.parse(
    attentionExperienceCard(item, observedAt),
  );
  expect(card.kind).toBe("approval");
  expect(card.consequence).toContain("remains pending");
  expect(card.actions.map((action) => action.operation)).toEqual(["open"]);
  expect(card.actions[0]!.criticality).toBe("C3");
  expect(card.source.version).toBe(item.updatedAt);
});
it("uses only a native known blocked count and preserves uncertainty when it is absent", () => {
  const blocker = {
    ...item,
    sourceKind: "blocker_attention" as const,
    detail: {
      kind: "blocker" as const,
      blockingIssue: null,
      blockedTaskCount: 3,
      images: [],
    },
  };
  expect(attentionExperienceCard(blocker, observedAt).consequence).toBe(
    "3 linked tasks remain blocked.",
  );
  expect(
    attentionExperienceCard({ ...blocker, detail: null }, observedAt)
      .consequence,
  ).toContain("reports a blocker");
  expect(
    attentionExperienceCard({ ...blocker, detail: null }, observedAt)
      .consequence,
  ).not.toContain("0");
});
it.each([
  ["join_request", "permission"],
  ["failed_run", "recovery"],
  ["budget_alert", "warning"],
  ["agent_error_alert", "warning"],
] as const)("projects %s as %s rather than a decision", (sourceKind, kind) => {
  const card = attentionExperienceCard({ ...item, sourceKind }, observedAt);
  expect(card.kind).toBe(kind);
  expect(card.actions[0]!.criticality).toBe("C3");
  expect(card.consequence).toBeTruthy();
});
it("binds exact decision links and decision-relevant native deadlines", () => {
  const card = attentionExperienceCard(
    {
      ...item,
      sourceKind: "decision",
      subject: { ...item.subject, id: "native/id?other=1" },
      decideBy: "Tomorrow",
      expiresAt: "2026-10-10T00:00:00.000Z",
    },
    observedAt,
  );
  expect(card.actions[0]!.href).toBe(
    "/needs-you?decisionId=native%2Fid%3Fother%3D1",
  );
  expect(card.evidence).toContain("Decision due: Tomorrow");
  expect(card.evidence).toContain("Expires: 2026-10-10T00:00:00.000Z");
});
