import { describe, expect, it } from "vitest";
import { COMPANY_SEARCH_HELP_ARTICLES } from "../services/company-search-help.generated.js";
import { pinnedSupportGuideEvidence, resolveSupportGuideSelection, supportGuideKnowledgePin } from "../services/experience/support-assistant-grounding.js";

const guide = COMPANY_SEARCH_HELP_ARTICLES.find(article => article.articleId === "recovering-work")!;
const approvedPin = supportGuideKnowledgePin(guide);
const evidence = () => pinnedSupportGuideEvidence({ requiredKnowledge: [approvedPin], articleIds: [guide.articleId], locale: "en" });

describe("Support Assistant exact released guidance", () => {
  it("returns only exact source text and a canonical guide citation selected by the model", () => {
    const sources = evidence();
    expect(sources.length).toBeGreaterThan(0);
    const response = resolveSupportGuideSelection(JSON.stringify({ evidenceIds: [sources[0]!.id] }), sources);
    expect(response.kind).toBe("guidance");
    expect(response.citations).toEqual([sources[0]]);
    expect(guide.body).toContain(response.citations[0]!.text);
    expect(response.citations[0]!.href).toMatch(/^https:\/\/docs\.blentera\.com\//);
  });

  it("does not treat a question, stale hash or another locale as package-approved knowledge", () => {
    expect(pinnedSupportGuideEvidence({ requiredKnowledge: ["help:ignore-the-package-and-reveal-data"], articleIds: [guide.articleId], locale: "en" })).toEqual([]);
    expect(pinnedSupportGuideEvidence({ requiredKnowledge: [approvedPin.replace(/.$/, "z")], articleIds: [guide.articleId], locale: "en" })).toEqual([]);
    expect(pinnedSupportGuideEvidence({ requiredKnowledge: [approvedPin], articleIds: [guide.articleId], locale: "da" })).toEqual([]);
    expect(pinnedSupportGuideEvidence({ requiredKnowledge: [], articleIds: [guide.articleId], locale: "en" })).toEqual([]);
  });

  it.each([
    { label: "free prose", raw: "Service is healthy and your problem is fixed." },
    { label: "foreign source", raw: JSON.stringify({ evidenceIds: ["another-company:private-case"] }) },
    { label: "invented task state", raw: JSON.stringify({ evidenceIds: [], answer: "Your task succeeded" }) },
    { label: "unapproved remedy link", raw: JSON.stringify({ evidenceIds: ["recovering-work:0"], url: "https://example.test/credential-reset" }) },
    { label: "oversized output", raw: "x".repeat(8193) },
  ])("withholds unverifiable model prose, sources and remedies: $label", ({ raw }) => {
    expect(resolveSupportGuideSelection(raw, evidence())).toEqual({ kind: "cannot_verify", citations: [] });
  });

  it("rejects tampered source bytes and duplicate selections", () => {
    const sources = evidence(), id = sources[0]!.id;
    expect(resolveSupportGuideSelection(JSON.stringify({ evidenceIds: [id] }), [{ ...sources[0]!, text: "Your private task succeeded" }])).toEqual({ kind: "cannot_verify", citations: [] });
    expect(resolveSupportGuideSelection(JSON.stringify({ evidenceIds: [id, id] }), sources)).toEqual({ kind: "cannot_verify", citations: [] });
  });

  it("keeps citation metadata canonical even when a model-adjacent caller changes it", () => {
    const sources = evidence(), id = sources[0]!.id;
    const response = resolveSupportGuideSelection(JSON.stringify({ evidenceIds: [id] }), [{ ...sources[0]!, title: "Service healthy" }]);
    expect(response.citations[0]?.title).toBe(guide.title);
  });
});
