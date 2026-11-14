# Sandbox qualification report timestamps

Independently generated host reports can refresh observation times while retaining exactly the same target evidence. Compare every validated field except testedAt/expiresAt; require both the original and current expiry to remain valid through completion. Keep the earlier expiry in the result. Image, kernel, credential epoch, policy/control, and provenance changes still fail closed.

The private two-file overlay passed 51 selected policy/fault tests and the full server typecheck. Four added cases cover fresh timestamps, attempted renewal of an expired original, shortened current expiry, and expiry between the current read and the completion fence. Exact baseline plus overlay source pins, runnable check, logs, and verified restoration are in the archive. These fixture tests do not qualify a physical sandbox host.
