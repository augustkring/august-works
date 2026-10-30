---
help_article_id: apps-and-connections
title: Connect or reconnect an app
summary: Connect an app, review its access, and restore a connection when asked
audience: company-administrators
product_capability_refs: [V10-074, V10-108, V10-109]
screen_contract_refs: [APPS, SETTINGS-APPS-DATA]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-29
review_trigger: App connection, provider authorization, credential renewal, or access review changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/apps/Connections.tsx, ui/src/pages/apps/AppNotConnected.tsx, ui/src/pages/apps/AppDetail.tsx, ui/src/pages/apps/app-detail/PermissionsPanel.tsx, ui/src/features/connections/ConnectionSetupFlow.tsx, packages/shared/src/app-definitions/slack.json, server/src/services/tool-access.ts, server/src/services/paperclip-cloud-connector.ts, ui/src/components/JevSkillSuggestionSettings.tsx, server/src/routes/jev-decisions.ts, server/src/services/jev-skill-suggestions.ts, server/src/services/tool-connection-lifecycle.ts, server/src/services/experience/connector-recovery.ts, ui/src/pages/apps/app-detail/IdentitiesSection.tsx]
---

Open **Apps** or **Company settings → Apps and data** to view connections available to your company. The apps, sign-in methods, and controls shown depend on the current deployment.

## Connect an app

Choose the app and follow its connection flow. Before continuing, review the account or workspace being connected, who can use the connection, and the permissions or actions shown on screen. Finish any sign-in or provider consent in the provider’s own page, then return to Blentera and check the connection status.

A connection is permission to use the selected account and scope. It does not mean every possible action is enabled. Review the app’s permissions and action settings before asking a Co-worker to use it.

For Slack agent tools, the standard option uses the Blentera-managed Slack app when the instance has it configured. Review the user permissions on the setup screen and on Slack’s consent page. The connection defaults to the signed-in person’s Slack account. If you explicitly choose organization access, that person’s Slack connection is shared with the company; this does not create a bot or service account. If the managed option is unavailable, a connection manager can use the advanced option for the organization’s own Slack OAuth app. The separate Slack bot app is used when people start work from Slack.

## Reconnect when access is unavailable

If a connection says **Reconnect** or **Reconnect required**, open that connection and use its reconnect action. Sign in to the same provider account and review the current access request. Some apps may ask you to replace credentials or choose a workspace again; the details vary by provider.

If your Blentera session changed during sign-in, reopen the connection and start sign-in again. A consent link from an earlier session cannot finish the connection in a different session.

Check the connection status after returning. Do not paste passwords, API keys, or recovery codes into a task or support request. If reconnect is not available or the status remains unclear, contact [human support](/help/index) with the app name and the non-secret status shown on screen.

## Optional Jev Skill decisions

Company connection managers can select a shared OpenRouter API-key connection under **Company settings → Optional Jev Skill suggestions**. Jev is off by default. Saving the connection does not start background requests. Background shadow checks require both **Shadow evaluation** and the separate **Allow background shadow checks** control. Native Skill resolution remains authoritative, and required Skills do not change.

The setup test sends only a fixed harmless sample to the selected OpenRouter account. The screen shows the current operator-qualified profile's exact currency and maximum charge before you consent; OpenRouter bills that shared company account. Review that disclosure and give explicit consent for each test. A successful response proves connectivity only; it does not qualify or enable Skill suggestions. A current operator-qualified Jev profile and company processing policy are required. EU-only processing policies block this OpenRouter route. If the provider outcome is unknown, the maximum reserved amount stays held. Keep the test reference and ask an administrator to verify the charge before another paid test.

If the selected Jev model is blocked or retired, setup tests and Skill decisions stop. Check **Action Needed** and ask an administrator to arrange a qualified replacement before trying again. Reconnecting the app does not qualify a replacement model.

## Check connection health

The connection detail can show OAuth access-token and refresh-token expiry when the provider has reported them. Missing expiry or deprecation information means it has not been reported. An expired access token may need refresh; an expired refresh token requires reconnecting. GitHub access also depends on a current repository-access check and webhook health. Follow the current repair action and check the status again afterward. A repaired connection no longer needs that action.
