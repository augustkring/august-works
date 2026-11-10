# Blentera CLI

The Blentera command-line client can onboard and configure an instance, diagnose its setup, and manage company work from a terminal. This package exposes `blentera` as its primary command; `paperclipai` remains as a deprecated compatibility alias for existing installations.

This source tree contains the V10 implementation, which is still in implementation and qualification. Available commands depend on the installed release and the instance's configuration. Use `blentera --help` to see the commands provided by your installation.

The CLI connects to a Blentera instance that you operate or have been given access to. Agent execution also depends on the configured adapters, credentials, and runtime environment. The CLI does not itself provide hosted compute, model-provider access, or a managed service.

For setup and current behavior, see the repository's [development guide](../doc/DEVELOPING.md), [CLI guide](../doc/CLI.md), and [V10 master build brief](../doc/reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md). The [upstream Paperclip repository](https://github.com/paperclipai/paperclip) is a developer source reference, not Blentera support or a product destination.

The package name and legacy command are retained for compatibility. Their names do not change the product identity. The MIT license and upstream copyright notices remain in [LICENSE](../LICENSE).
