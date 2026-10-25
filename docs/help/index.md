---
help_article_id: help-and-human-support
title: Help and human support
summary: Find guidance, view your cases, or contact a person directly
audience: company-members
product_capability_refs: [HELP-01, HELP-02, V10-038]
screen_contract_refs: [HELP-01, HELP-02]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-25
review_trigger: Help navigation, support intake, contacts, or recovery behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/App.tsx, ui/src/components/ExperienceUtilities.tsx, ui/src/pages/CustomerHelpCenter.tsx, ui/src/pages/CustomerSupportCases.tsx, ui/src/lib/help-navigation.ts, server/src/routes/customer-support.ts, server/src/services/experience/customer-support.ts, server/src/services/experience/support-cases.ts, packages/shared/src/customer-support.ts, packages/shared/src/customer-feedback.ts, packages/shared/src/product-identity.ts, packages/shared/src/support-diagnostics.ts, ui/src/api/search.ts, server/src/services/company-search.ts, server/src/routes/issues.ts, packages/shared/src/types/search.ts, ui/src/components/ExperienceCommandPalette.tsx, ui/src/pages/Search.tsx, packages/shared/src/validators/search.ts, server/src/services/experience/support-case-configuration.ts, server/src/services/experience/support-case-delivery.ts, server/src/services/experience/support-case-http-gateway.ts]
---

Open **Help** in the app to browse guidance, open support cases, or check the configured service status page. You can contact human support directly at [support@blentera.com](mailto:support@blentera.com). You do not need to converse with an assistant first.

Search product terms inside Help to find matching guidance. Help articles are available in English and Danish. Search uses your current display language. Open a result in a new tab to keep your work and the Help view available.

You can also find Help articles in the current command palette. Press **Ctrl+K** on Windows or Linux, or **⌘K** on Mac, and enter a topic. Choosing a Help article opens it in a new tab and returns focus to the control you used to open the palette. The existing Work view stays available.

When you open Help from signed-in work in the same company, close it to return to your original view. Do not put passwords, recovery codes, API keys, or other secrets in a support message. Review any diagnostic information before sharing it.

## Support cases

Choose **Support cases** to send a request or read an existing case. A saved case receipt confirms that the request was stored. It does not by itself confirm delivery to an external support provider or a response time. Follow the processing notice shown before sending; intake may be unavailable when that notice is not configured.

If a submission's result is unknown, keep the page's original request and use its recovery action. Reload checks for the saved receipt. Do not create another request solely because the response was interrupted.

If a saved case shows unknown delivery, keep its reference and contact support directly. An interrupted delivery attempt is not automatically sent again, because the provider may already have received it.

## Report a security or privacy concern

Use [security@blentera.com](mailto:security@blentera.com) for a security concern and [privacy@blentera.com](mailto:privacy@blentera.com) for a privacy request. Share only the information needed to explain the concern. Never send a credential to prove that you possess it.

## Import recovery

For a running or interrupted company import, follow [Importing and exporting companies](/guides/board-operator/importing-and-exporting). An unknown result needs reconciliation before another import can safely run.

## Technical documentation

The other documentation tabs cover native protocols, self-hosting, adapters, and developer APIs. Technical names such as Paperclip Runner, `paperclipai`, and `.paperclip.yaml` identify the underlying components and package formats.
