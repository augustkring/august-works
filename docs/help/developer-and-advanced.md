---
help_article_id: developer-and-advanced
title: Developer and advanced documentation
summary: Find the API, CLI, deployment, and advanced configuration references
audience: developers-and-instance-administrators
product_capability_refs: [V10-032, V10-092]
screen_contract_refs: [SETTINGS-ADVANCED-DEVELOPER]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-28
review_trigger: API, CLI, deployment, or advanced configuration documentation moves or changes
security_or_privacy_sensitive: true
linked_source_files: [server/src/routes/openapi.ts, server/src/routes/index.ts, cli/src/index.ts]
---

For technical setup and integration details, use the existing documentation references:

- [API overview](/api/overview), [authentication](/api/authentication), and [API reference](/api/companies)
- [CLI overview](/cli/overview) and [setup commands](/cli/setup-commands)
- [Deployment modes](/deploy/deployment-modes), [secrets](/deploy/secrets), and [environment variables](/deploy/environment-variables)

The API and CLI references describe their own supported commands and endpoints. Availability can depend on your deployment, enabled features, and current authorization. Use the documentation for your installed version and review the current screen or API response before repeating a write after an interrupted request.

The canonical CLI command is `blentera`. For a release that includes it, follow the [command migration guide](/cli/migration) before updating automation. The temporary `paperclipai` command uses the same implementation and writes a deprecation notice to stderr. Command naming does not change your stored state or permissions.

For help with a customer task, use [Help and human support](/help/index) instead of placing private data or credentials in a developer log.
