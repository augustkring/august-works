import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cardToBlockKit } from "@chat-adapter/slack";
import { cardToAdaptiveCard } from "@chat-adapter/teams";
import { projectSafeChatPublication } from "../chat-publication-projection.js";
import { safeCardForPublication } from "../chat-card-rendering.js";
import type { ExperienceChatCardContext } from "@paperclipai/shared";

const id = randomUUID(), companyId = randomUUID();
const context: ExperienceChatCardContext = { kind: "question", whyYou: "Svar venligst på spørgsmålet", consequence: "Afventer dit svar",
  evidence: ["pending"], freshness: "fresh", source: { domain: "attention", companyId, resourceId: id,
    version: "2026-10-13T10:00:00.000Z", observedAt: "2026-10-13T10:01:00.000Z" } };
const payload = (experience = context) => projectSafeChatPublication({ classification: "external", source: "issue_interaction",
  text: "Hvilken prioritet?", interaction: { id, card: { kind: "question", title: "Hvilken prioritet?", body: "Vælg et svar",
    experience, actions: [{ type: "callback", actionId: "pcq:test", label: "Høj" }] } } });

describe("V9 semantic content through the installed Slack and Teams adapters", () => {
  it.each(["slack", "microsoft-teams"] as const)("preserves semantic order, Source identity and Original actions on %s", provider => {
    const p = payload(), card = safeCardForPublication(p, provider)!;
    const rendered = JSON.stringify(provider === "slack" ? cardToBlockKit(card) : cardToAdaptiveCard(card));
    const labels = ["Hvilken prioritet?", "Svar venligst", "Vælg et svar", "Afventer dit svar", "pending", "Høj"];
    const positions = labels.map(label => rendered.indexOf(label));
    expect(positions.every(n => n >= 0)).toBe(true); expect(positions).toEqual([...positions].sort((a,b) => a-b));
    expect(rendered).toContain("pcq:test"); expect(p.card?.experience?.source).toEqual(context.source);
    expect(p.text).toContain(context.consequence); expect(p.text).toContain(context.whyYou);
    expect(rendered).not.toContain(companyId);
  });
  it("uses the Original sanitizer for semantic text and its plain fallback", () => {
    const p = payload({ ...context, whyYou: "@channel token: PRIVATE_CANARY", evidence: ["<analysis>PRIVATE_REASONING</analysis>Pending"] });
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain("PRIVATE_CANARY"); expect(serialized).not.toContain("PRIVATE_REASONING");
    expect(serialized).not.toContain("@channel");
  });
  it.each(["stale", "unavailable"] as const)("withholds callback actions for %s cards", freshness => {
    expect(() => payload({ ...context, freshness })).toThrow(/callback/);
  });
  it("refuses a different Original interaction or hidden metadata fields", () => {
    expect(() => payload({ ...context, source: { ...context.source, resourceId: randomUUID() } })).toThrow(/Original interaction/);
    expect(() => payload({ ...context, source: { ...context.source, version: "token: PRIVATE_VERSION" } })).toThrow(/Source version/);
    expect(() => payload({ ...context, rawPrompt: "PRIVATE" } as ExperienceChatCardContext)).toThrow();
  });
});
