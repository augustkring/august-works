# Connection review immediate-result diagnostic attempt 017

The fresh list gate selected exactly one approve journey. Playwright passed (1 test; test and lock exits 0). However, this diagnostic inserted an extra `GET /api/issues/:id/interactions` immediately after the UI click. That read observed the interaction as still `pending` and may have changed scheduling before the continuation assertion. Therefore this is not treated as a clean confirmation of the original CI failure fix; a follow-up removes the diagnostic request and reruns the exact approve path without timing interference.
