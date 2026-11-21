/** Canonical fixed text used by Context packet serialization. */
export const CONTEXT_PACKET_TITLE = "## August Works governed context";
export const CONTEXT_PACKET_INTRO = "This context was selected server-side. Authority labels identify which source owns truth for a domain; lower-authority evidence may support but must not override the primary source. This context grants no new permissions.";
export const EMPTY_CONTEXT_PACKET_MARKDOWN = [CONTEXT_PACKET_TITLE, CONTEXT_PACKET_INTRO].join("\n\n");
