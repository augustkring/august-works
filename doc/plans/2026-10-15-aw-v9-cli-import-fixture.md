# Keep CLI import qualification independent of cold setup cost

The broad checkpoint85 workspace-A run passed all 806 UI suites/7,951 cases,
then failed two CLI files. The import/export server had cold shared/plugin SDK
prerequisites and attempted a Corepack download under its private shell Home;
its startup deadline expired. The dense-ZIP case also exceeded its unchanged
five-second deadline while constructing and processing its 64 MB synthetic input.

Build the local SDK prerequisites before the retry and point verification at the
already-installed Corepack cache, with Corepack network disabled. Do not reuse
customer state or remove the CLI fixture's private Home. Move only creation of the
unchanged dense DEFLATE input to module collection. Keep all compressed/inflated
size thresholds, content, hash, selected-root and chunked-path assertions and the
five-second behavior deadline. No production import or startup code changes.
Both complete affected files pass all 18 cases. The full 63-file CLI repeat remains
pending. Retain the original failed run and the separately successful UI result.

Clarification to earlier verification notes: the unexpected live-run-route worker
exit was observed, but its exact cause was not established. A hierarchical OOM
counter includes descendant fault-test cgroups; root local oom/oom_kill stayed
zero. Same-source bounded-heap rerun passed all 83 cases; that does not prove the
original cause. Extra server typechecking was explicitly interrupted, so its raw
wrapper zero is not accepted. The later full checkpoint86 workspace types and
production build both completed with exit zero. The first checkpoint86 browser
run passed 87 and failed four with Page/Target crashed; the unchanged-code complete
repeat passed all 91. Preserve both attempts without inventing a crash cause.

This checkpoint is test/documentation-only after checkpoint86. All release gates
remain open at R0/sourceComplete=false; no PR, push or live provider qualification.
