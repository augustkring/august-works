import type { ActivationConnectionReview } from "@paperclipai/shared";

// Match exact provider identifiers, never arbitrary English or customer text.
const googleScopeNames = [
  "gmail.readonly", "gmail.compose", "drive.readonly", "drive.file",
  "documents.readonly", "documents", "spreadsheets.readonly", "spreadsheets",
  "presentations.readonly", "presentations", "calendar.calendarlist.readonly",
  "calendar.readonly", "calendar.events.freebusy", "calendar.events.readonly", "calendar.events",
  "chat.spaces.readonly", "chat.messages.readonly", "chat.messages.create",
  "directory.readonly", "userinfo.profile", "contacts.readonly",
] as const;
const scopeKeys = new Map<string, string>(googleScopeNames.map(name =>
  [`https://www.googleapis.com/auth/${name}`, name.replaceAll(".", "_")]));
const writeToolNames = new Set(["create_draft", "copy_file", "create_file", "update_doc", "update_spreadsheet", "update_values", "update_formulas", "insert_dimension", "update_presentation", "create_event", "update_event", "delete_event", "respond_to_event", "send_message"]);
type Translate = (key: string, values?: Record<string, string>) => string;

export function activationPermissionStatements(review: ActivationConnectionReview, translate: Translate) {
  const text = (key: string, values?: Record<string, string>) => translate(`activation.connectionConsent.explanation.${key}`, values);
  const facts = review.explanation;
  const scopes = review.providerScopes.map(scope => {
    const key = scopeKeys.get(scope);
    return key ? `${text(`scopes.${key}`)} (${scope})` : text("unmappedScope", { scope });
  });
  const tools = facts.providerWriteTools.map(tool => writeToolNames.has(tool) ? `${text(`tools.${tool}`)} (${tool})` : tool);
  return {
    neededNow: [review.existingConnection
      ? text(review.existingConnection.needsValidation ? "retained" : "reuse", { provider: facts.providerName, connection: review.existingConnection.name, resource: facts.resource })
      : text("personal", { provider: facts.providerName, resource: facts.resource }), ...scopes],
    // The package author's purpose is content, not a translatable UI string.
    why: review.preview.why,
    usedBy: text("usedBy", { capability: facts.capabilityName }),
    canRead: [text("providerAccount"), ...scopes],
    canChange: [facts.providerWriteTools.length
      ? text("writeTools", { tools: tools.join(", ") }) : text("noWriteTools"), text("noBusinessChanges")],
    notRequested: [text("noOrganization"), text("noConsequentialAuthority")],
    automatic: [text("noExecution")],
    asksFirst: [text("separateDecision"), text("consequentialDecision")],
  };
}
