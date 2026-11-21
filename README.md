# Blentera

Blentera is an open-source control plane for organizing and supervising work by AI agents. It gives people a shared place to set company goals, assign work, coordinate agents, review outcomes, and manage budgets and approvals.

This repository contains the Blentera V10 product implementation, built on upstream Paperclip. V10 is still in implementation and qualification: this source tree is not evidence that every capability is complete, generally available, or hosted by Blentera. The V10 brief records the intended product and the remaining implementation and qualification gates.

## Current product profile

The current application provides a self-hostable Node.js service and React interface for managing companies, agents, projects, issues, schedules, execution, budgets, approvals, and activity. Agent execution depends on configured adapters, credentials, and the operator's runtime environment. The operator remains responsible for reviewing consequential work and configuring deployment, access, and provider integrations.

The V10 product direction extends this foundation with outcome-led work, governed context and knowledge, supervision, recovery, help, support, status, trust, and lifecycle controls. Those target capabilities should be treated as available only when their implementation and release evidence says so. Do not infer hosted service, provider coverage, security certification, service levels, or launch readiness from the roadmap or source code alone.

## Working with this source tree

Use the repository's [development guide](doc/DEVELOPING.md), [product documentation](doc/PRODUCT.md), and [implementation specification](doc/SPEC-implementation.md) for setup and current behavior. The [V10 master build brief](doc/reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md) is the product target and records open qualification gates. Public user help is in [`docs/help`](docs/help/index.md).

The executable package and CLI retain the `paperclipai` compatibility command and related package, API, environment, and protocol identifiers. The command is deprecated in favor of `blentera`; these names do not change the customer-facing product.

## Upstream developer references

The upstream GitHub repository, its community channels, and its published site below belong to the upstream project; they are not Blentera support, documentation, or community destinations.

- [Upstream repository](https://github.com/paperclipai/paperclip)
- [Upstream documentation](https://docs.paperclip.ing)
- [Upstream community](https://discord.gg/m4HZY7xNG3)
- [Upstream project site](https://paperclip.ing)

The original MIT license and required copyright notices are retained in [LICENSE](LICENSE) and the source files. See those notices for attribution and redistribution terms.
