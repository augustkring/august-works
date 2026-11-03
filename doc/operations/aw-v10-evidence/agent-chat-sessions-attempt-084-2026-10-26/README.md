# Authenticated chat recovery attempt 084

The focused authenticated/private/lan Playwright selector listed exactly one test. It ran with the exact-byte conversation replay closure change present in the source pin and failed before the test reached its source-receipt assertions. The second idle wait timed out after the metric provider emitted a successful query result, final item, and `turn_completed`; the run logged `native_session_cleanup_quarantined`, with a generic finalization warning. This run establishes neither receipt success nor a clean finalization.

The provider event log contains only event names, tool names, bounded result shapes, and process IDs. Source pins and numeric exits are retained. Browser trace/screenshot files are intentionally excluded because they can retain authenticated state.
