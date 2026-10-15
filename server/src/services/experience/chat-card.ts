import { experienceChatCardContextSchema, type ExperienceChatCardContext, type IssueThreadInteraction,
  type SafeExternalChatCard } from "@paperclipai/shared";

/** Derived only by the Native interaction publication owner. These fields do
 * not decide who may answer or change the existing callback identities. */
export function nativeInteractionExperience(interaction: IssueThreadInteraction, observedAt = new Date().toISOString()): ExperienceChatCardContext {
  return experienceChatCardContextSchema.parse({
    kind: interaction.kind === "ask_user_questions" ? "question" : "confirmation",
    source: { domain: "attention", companyId: interaction.companyId, resourceId: interaction.id,
      version: new Date(interaction.updatedAt).toISOString(), observedAt },
    freshness: "fresh",
    whyYou: interaction.status === "pending" ? "A response is needed for this request." : null,
    consequence: interaction.status === "pending" ? "This request stays pending until a response is recorded, or it is cancelled or expires." : null,
    evidence: [interaction.status],
  });
}

/** The same semantic content order is compiled by the installed Chat SDK to
 * Slack Block Kit and Teams Adaptive Cards. It also supplies text fallback. */
export function experienceChatCardBody(card: SafeExternalChatCard): string[] {
  return [card.experience?.whyYou, card.body, card.experience?.consequence,
    card.experience?.evidence.join("\n")].filter((part): part is string => !!part);
}
