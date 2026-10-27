# RT01 C0 lock-order follow-up attempt (r10)

This attempt captured the post-lock-order-change source snapshot (`sourceHead` recorded in `source-pins.json`), passed syntax validation, Runner TypeScript emit, and semantic catalog check (all exit 0), then began the five-case C0 suite.

The suite was intentionally stopped with exit 143 before a test case completed, so r10 has no C0 result. The targeted PostgreSQL lock-race regression is being run before another complete suite, as requested by the release owner. See the raw logs and `SHA256SUMS`.
