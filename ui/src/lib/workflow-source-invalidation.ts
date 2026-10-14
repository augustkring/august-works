/** Workflow copies can depend on a private conversation, retained memory or
 * learned asset. Their Source IDs are deliberately absent from customer DTOs,
 * so re-read on relevant Native activity instead of trusting cached authority.
 * This only withholds client data; the Original server owners decide access. */
export function workflowReadSourceChanged(event: { type: string; payload: { action?: unknown; entityType?: unknown } }) {
  if (event.type === "analytical.context.access_lost") return true;
  if (event.type !== "activity.logged") return false;
  return /workflow|routine|agent|connection|tool|issue|conversation|permission|membership|role|privacy|erased|deleted|withdraw|memory|learning|knowledge|foundation|document|artifact|project|team|group|user|account|auth/i
    .test(`${typeof event.payload.entityType === "string" ? event.payload.entityType : ""}:${typeof event.payload.action === "string" ? event.payload.action : ""}`);
}
