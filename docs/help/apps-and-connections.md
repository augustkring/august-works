---
help_article_id: apps-and-connections
title: Connect or reconnect an app
summary: Connect an app, review its access, and restore a connection when asked
audience: company-administrators
product_capability_refs: [V10-109]
screen_contract_refs: [APPS, SETTINGS-APPS-DATA]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: App connection, provider authorization, credential renewal, or access review changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/apps/Connections.tsx, ui/src/pages/apps/AppNotConnected.tsx, ui/src/pages/apps/AppDetail.tsx, ui/src/pages/apps/app-detail/PermissionsPanel.tsx]
---

Open **Apps** or **Company settings → Apps and data** to view connections available to your company. The apps, sign-in methods, and controls shown depend on the current deployment.

## Connect an app

Choose the app and follow its connection flow. Before continuing, review the account or workspace being connected, who can use the connection, and the permissions or actions shown on screen. Finish any sign-in or provider consent in the provider’s own page, then return to Blentera and check the connection status.

A connection is permission to use the selected account and scope. It does not mean every possible action is enabled. Review the app’s permissions and action settings before asking a Co-worker to use it.

## Reconnect when access is unavailable

If a connection says **Reconnect** or **Reconnect required**, open that connection and use its reconnect action. Sign in to the same provider account and review the current access request. Some apps may ask you to replace credentials or choose a workspace again; the details vary by provider.

Check the connection status after returning. Do not paste passwords, API keys, or recovery codes into a task or support request. If reconnect is not available or the status remains unclear, contact [human support](/help/index) with the app name and the non-secret status shown on screen.
