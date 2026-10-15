import { Actions, Button, Card, CardText, LinkButton } from "chat";
import type { ChatProvider, SafeChatPublicationPayload } from "@paperclipai/shared";
import { isChatQuestionFormOpenActionId } from "./chat-question-forms.js";
import { experienceChatCardBody } from "./experience/chat-card.js";

export function safeCardForPublication(
  payload: SafeChatPublicationPayload,
  provider: ChatProvider,
) {
  if (!payload.card) return null;
  const children = [];
  for (const body of experienceChatCardBody(payload.card)) children.push(CardText(body));
  const actions = (payload.card.actions ?? []).map((action) =>
    action.type === "callback"
      ? Button({
          id: action.actionId,
          label: action.label,
          style: action.style ?? "default",
          // Telegram encodes both id and value into callback_data, whose hard
          // limit is 64 bytes. Its opaque action id resolves through the
          // durable token ledger, so repeating the interaction UUID is both
          // unnecessary and too large. Other adapters retain the value as a
          // defense-in-depth binding supported by their larger envelopes.
          value: provider === "telegram" ? undefined : payload.interactionId,
          actionType: isChatQuestionFormOpenActionId(action.actionId)
            ? "modal"
            : undefined,
        })
      : LinkButton({ label: action.label, url: action.url }),
  );
  if (actions.length) children.push(Actions(actions));
  return Card({ title: payload.card.title, children });
}
