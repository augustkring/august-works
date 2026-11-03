# Public comment projection and redaction

All eight comment-redaction cases passed. The selected inline rendition assertion now uses the existing canonical public-comment projection hash, matching the actual public body/presentation/metadata contract instead of depending on JSON object insertion order. It still checks exact source versions, omitted private/deleted/foreign text, quarantine rendering and selected comment IDs. Production rendering, source capture and authorization are unchanged.

This is a focused pinned software receipt; final full-workspace verification remains separate. Raw logs and the snapshot reconstruction patch are losslessly compressed.
