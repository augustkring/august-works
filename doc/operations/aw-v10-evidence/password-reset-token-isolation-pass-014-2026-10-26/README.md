# Password reset token-isolation regression attempt 014

The fresh Playwright list gate selected exactly one test, and the test exit sidecar is `0`: `a different reset link cannot inherit the old password or its late acknowledgement` passed. This validates the label-prefix selector and the full existing token-change, password-clearing, stale acknowledgement, and no-storage assertions.

The outer shell wrapper emitted `exit: : numeric argument required` after Playwright had passed because its lock-exit receipt command placed an `rc=$?` token as an argument to the inner `bash` command. That wrapper error did not change the child Playwright test exit sidecar, which is preserved as `test-exit.txt`.
