import { z } from "zod";
import { companySearchHelpHref } from "../company-search.js";
import { COMPANY_SEARCH_HELP_ARTICLES, type CompanySearchHelpArticle } from "../company-search-help.generated.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

export type SupportGuideEvidence = {
  id: string;
  articleId: string;
  title: string;
  href: string;
  locale: "en" | "da";
  sourceHash: string;
  text: string;
  maturity: "preview" | "ga";
  lastVerifiedAt: string;
};

/** A content pin, not approval. The original published package owner must
 * approve this exact pin before a support invocation may retrieve it. */
export function supportGuideKnowledgePin(article: CompanySearchHelpArticle): string {
  return `help:${article.articleId}:${nativeSha256(article)}`;
}

/** IDs are supplied by the original authorized Help search owner. Neither a
 * customer question nor model output can add knowledge to the package. */
export function pinnedSupportGuideEvidence(input: {
  requiredKnowledge: readonly string[];
  articleIds: readonly string[];
  locale: "en" | "da";
}): SupportGuideEvidence[] {
  const corpus = new Map(COMPANY_SEARCH_HELP_ARTICLES.map(article => [supportGuideKnowledgePin(article), article]));
  if (!input.requiredKnowledge.length || input.requiredKnowledge.length > 30 ||
    new Set(input.requiredKnowledge).size !== input.requiredKnowledge.length ||
    input.requiredKnowledge.some(pin => !corpus.has(pin))) return [];
  const approved = new Map(input.requiredKnowledge.map(pin => {
    const article = corpus.get(pin)!;
    return [article.articleId, article] as const;
  }));
  const evidence: SupportGuideEvidence[] = [];
  let remainingCharacters = 12_000;
  const segmenter = new Intl.Segmenter(input.locale, { granularity: "sentence" });
  for (const id of [...new Set(input.articleIds)].slice(0, 4)) {
    const article = approved.get(id);
    if (!article || article.locale !== input.locale || !article.applicableProductVersions.includes("V10")) continue;
    const href = companySearchHelpHref(article.slug);
    if (!href) continue;
    let pending = "", index = 0;
    const append = () => {
      const text = pending.trim();
      pending = "";
      if (!text || text.length > remainingCharacters) return false;
      evidence.push({ id: `${article.articleId}:${index++}`, articleId: article.articleId,
        title: article.title, href, locale: input.locale, sourceHash: nativeSha256(article), text,
        maturity: article.maturity, lastVerifiedAt: article.lastVerifiedAt });
      remainingCharacters -= text.length;
      return true;
    };
    for (const { segment } of segmenter.segment(article.body)) {
      if (segment.length > 900) { append(); continue; }
      if (pending.length + segment.length > 900 && !append()) break;
      pending += segment;
    }
    append();
    if (!remainingCharacters) break;
  }
  return evidence;
}

const selectionSchema = z.object({ evidenceIds: z.array(z.string().min(1).max(150)).max(3) }).strict();

export type GroundedSupportGuidance =
  | { kind: "cannot_verify"; citations: [] }
  | { kind: "guidance"; citations: SupportGuideEvidence[] };

/** The model selects released evidence; it cannot supply prose, current
 * product-state claims, links, remedies, or executable actions. Displayed text
 * always comes from the exact approved guide snapshot. */
export function resolveSupportGuideSelection(raw: string, evidence: readonly SupportGuideEvidence[]): GroundedSupportGuidance {
  const unavailable: GroundedSupportGuidance = { kind: "cannot_verify", citations: [] };
  if (Buffer.byteLength(raw, "utf8") > 8_192) return unavailable;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return unavailable; }
  const parsed = selectionSchema.safeParse(value);
  if (!parsed.success || !parsed.data.evidenceIds.length ||
    new Set(parsed.data.evidenceIds).size !== parsed.data.evidenceIds.length) return unavailable;
  const byId = new Map(evidence.map(item => [item.id, item]));
  if (byId.size !== evidence.length) return unavailable;
  const citations: SupportGuideEvidence[] = [];
  for (const id of parsed.data.evidenceIds) {
    const item = byId.get(id);
    const current = item && COMPANY_SEARCH_HELP_ARTICLES.find(article => article.articleId === item.articleId &&
      article.locale === item.locale && nativeSha256(article) === item.sourceHash);
    if (!item || !current || !current.body.includes(item.text) || item.href !== companySearchHelpHref(current.slug)) return unavailable;
    citations.push({ ...item, title: current.title, maturity: current.maturity, lastVerifiedAt: current.lastVerifiedAt });
  }
  return { kind: "guidance", citations };
}
