# OpenShell RT-01 patch attribution

This is a private downstream patch based on NVIDIA/OpenShell v0.1.2, upstream commit `6648bd0c290efbc41ba131ee9831ee45cd431f94` from <https://github.com/NVIDIA/OpenShell>. The upstream project is distributed under Apache License 2.0; the complete upstream `LICENSE` is retained alongside the patch. The downstream patch is maintained by Blentera. NVIDIA has not reviewed or endorsed it.

The source includes identity-bound sandbox RPC/CLI paths, Docker writable-layer disk controls and configuration validation, and sandbox syscall-policy probe changes. The patch does not grant access to any live provider or host. See `metadata.json` and `source-pins.json`; the candidate is unqualified and profile admission remains closed.
