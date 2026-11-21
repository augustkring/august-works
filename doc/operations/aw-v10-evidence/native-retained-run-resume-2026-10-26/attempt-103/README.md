# Retained metric source review attempt 103

The exact one-test browser case ran on the pinned snapshot and exited 1 after the idle predicate timed out. The provider successfully read task context/history, queried the metric, and emitted final/completed events. During retained metric-pin revalidation, the canonical metric service denied `assertAnalyticalReader` because its AsyncLocal reader permit was absent (`permit_binding`, `permitPresent:false`). This explains the earlier intermittent 403: the retained Context/analytical-root presence check occurred before privacy locks, while the root lookup occurred after locks, allowing a concurrent root to appear without entering the reader-permit wrapper.

The implementation fix moves both Context/root checks under the privacy locks and wraps source revalidation based on that same locked root set. This attempt predates the fix and is diagnostic evidence only.
