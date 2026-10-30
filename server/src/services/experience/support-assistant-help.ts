import type { Db } from "@paperclipai/db";
import { companySearchQuerySchema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { companySearchService } from "../company-search.js";
import { withCurrentTaskSourceRead } from "../task-source-read-scope.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { pinnedSupportGuideEvidence } from "./support-assistant-grounding.js";
import { v7HumanActorId } from "../v7-authorization.js";
import { conflict } from "../../errors.js";

/** The original Find/Help authorization and ranking owner supplies candidates.
 * The package's exact approved knowledge pins then restrict those candidates;
 * no customer or model-supplied article body enters the inference envelope. */
export async function searchAuthorizedSupportHelp(
  db: Db,
  actor: AuthorizationActor,
  input: { companyId: string; expectedUserId: string; question: string; locale: "en" | "da"; requiredKnowledge: readonly string[] },
): Promise<{ articleIds: string[]; authorityHash: string }> {
  if (v7HumanActorId(actor) !== input.expectedUserId) throw conflict("The current support account changed");
  return withCurrentTaskSourceRead(db, input.companyId, actor, async queryDb => {
    const result = await companySearchService(queryDb).search(input.companyId, companySearchQuerySchema.parse({
      q: input.question, scope: "help", locale: input.locale, limit: 4,
    }));
    const candidates = result.results.flatMap(hit => hit.type === "help" && hit.helpArticle ? [hit.helpArticle.articleId] : []);
    const evidence = pinnedSupportGuideEvidence({ requiredKnowledge: input.requiredKnowledge,
      articleIds: candidates, locale: input.locale });
    const articleIds = [...new Set(evidence.map(item => item.articleId))];
    return { articleIds, authorityHash: nativeSha256({ companyId: input.companyId,
      expectedUserId: input.expectedUserId, locale: input.locale, questionHash: nativeSha256(input.question),
      requiredKnowledge: [...input.requiredKnowledge].sort(), evidence }) };
  }, false);
}
