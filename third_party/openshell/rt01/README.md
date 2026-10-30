# OpenShell RT-01 R5.1 source bundle

The cumulative patch is pinned against NVIDIA/OpenShell v0.1.2 commit `6648bd0c290efbc41ba131ee9831ee45cd431f94`. It combines the R4 identity-bound sandbox RPC/CLI changes, Docker disk-limit and syscall-probe changes, contradictory mount-mode rejection, and a real CLI transport test that rejects legacy fallback after identity RPC `UNIMPLEMENTED`. R5.1 corrects two test-only unsafe-call annotations.

`source-pins.json` binds the exact upstream source tree and patch. Dedicated workflow run 41044296826 on repository head `af29df32d734c89310613df68051f389a2915c92` passed source verification, formatting, compilation of the server, CLI, Docker driver and sandbox, and all 15 exact focused tests. The portable receipt at `doc/operations/aw-v10-evidence/openshell-rt01-runtime-guards-source-qualified-2026-10-30/` includes complete raw logs, source pins and checksums.

This is software qualification. Deployed gateway compatibility, physical Docker quota and target-host syscall enforcement remain unqualified. Profile admission remains closed.
