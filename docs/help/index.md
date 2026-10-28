---
help_article_id: help-and-human-support
title: Help and human support
summary: Search guidance, optionally ask the Support Assistant, view cases, or contact a person
audience: company-members
product_capability_refs: [HELP-01, HELP-02, V10-038, V10-051, V10-059]
screen_contract_refs: [HELP-01, HELP-02]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-28
review_trigger: Help navigation, support intake, contacts, or recovery behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/components/ServiceHealth.tsx, packages/shared/src/service-health.ts, server/src/services/experience/service-health.ts, ui/src/App.tsx, ui/src/components/ExperienceUtilities.tsx, ui/src/pages/CustomerHelpCenter.tsx, ui/src/pages/CustomerSupportCases.tsx, ui/src/lib/help-navigation.ts, server/src/routes/customer-support.ts, server/src/services/experience/customer-support.ts, server/src/services/experience/support-cases.ts, packages/shared/src/customer-support.ts, packages/shared/src/customer-feedback.ts, packages/shared/src/product-identity.ts, packages/shared/src/support-diagnostics.ts, ui/src/api/search.ts, server/src/services/company-search.ts, server/src/routes/issues.ts, packages/shared/src/types/search.ts, ui/src/components/ExperienceCommandPalette.tsx, ui/src/pages/Search.tsx, packages/shared/src/validators/search.ts, server/src/services/experience/support-case-configuration.ts, server/src/services/experience/support-case-delivery.ts, server/src/services/experience/support-case-http-gateway.ts, server/src/routes/saas.ts, server/src/services/saas/support-case-operator.ts, ui/src/components/CustomerSupportAssistant.tsx, ui/src/components/CustomerSupportAssistant.test.tsx, server/src/services/orchestration/first-party-support-model-gateway.ts, server/src/services/orchestration/first-party-support-model-profiles.ts, server/src/services/experience/support-assistant-grounding.ts, server/src/services/orchestration/model-reservations.ts, server/src/services/agent-packages/execution-gate.ts, server/src/services/agent-packages/package-policy.ts, server/src/services/agent-packages/package-service.ts, server/src/saas-platform-config.ts, server/src/app.ts, server/src/services/company-search-help.generated.ts, packages/shared/src/agent-packages.ts, packages/shared/src/model-broker.ts, server/src/services/orchestration/read-only-model-transport.ts, ui/src/components/TrustGatedEvidence.tsx, server/src/services/trust-documents.ts, packages/shared/src/trust-documents.ts, ui/src/components/CustomerChangelog.tsx, ui/src/api/announcements.ts, server/src/routes/announcements.ts, server/src/services/announcement-feed.ts, packages/shared/src/announcements.ts]
---

Open **Help** in the app to browse guidance, open support cases, or check the configured service status page. You can contact human support directly at [support@blentera.com](mailto:support@blentera.com). You do not need to converse with an assistant first.

The public status page reports provider-confirmed service information. It does not establish whether your account is affected. For an account-specific problem, contact human support and include the non-secret message shown in the app.

Search product terms inside Help to find matching guidance. Help articles are available in English and Danish. Search uses your current display language. Open a result in a new tab to keep your work and the Help view available.

You can also find Help articles in the current command palette. Press **Ctrl+K** on Windows or Linux, or **⌘K** on Mac, and enter a topic. Choosing a Help article opens it in a new tab and returns focus to the control you used to open the palette. The existing Work view stays available.

When you open Help from signed-in work in the same company, close it to return to your original view. Do not put passwords, recovery codes, API keys, or other secrets in a support message. Review any diagnostic information before sharing it.

## Support cases

Choose **Support cases** to send a request or read an existing case. A saved case receipt confirms that the request was stored. It does not by itself confirm delivery to an external support provider or a response time. Follow the processing notice shown before sending; intake may be unavailable when that notice is not configured.

If a submission's result is unknown, keep the page's original request and use its recovery action. Reload checks for the saved receipt. Do not create another request solely because the response was interrupted.

If a saved case shows unknown delivery, keep its reference and contact support directly. An interrupted delivery attempt is not automatically sent again, because the provider may already have received it.

Open a case to read replies from support. **Waiting for you** shows what support needs from you. Replying to a resolved case reopens the same case. Replying to a closed case creates a linked follow-up and keeps the original history.

## Optional Support Assistant

Help may also show a **Support Assistant**. It is optional and may be unavailable when this deployment has no current operator-approved Help package, provider profile, or funding. Help search, support cases, and direct human contact remain available independently.

When the assistant is available, read its processing notice and privacy link before sending. If you agree, check the consent box and choose **Ask the assistant**. Your question and selected Help article excerpts are sent to Anthropic for a read-only response. Blentera funds this included feature; it does not use your AI connections. Do not include passwords, recovery codes, API keys, or other secrets.

The assistant can return only exact excerpts from approved, linked Help articles. It cannot write a new remedy, look up your account, task, case, or service status, or take an action. If the articles do not support an answer, it says it cannot verify one. For an account-specific question or a current incident, contact human support directly.

If a request has an unclear result, it is not automatically sent again. Keep the notice on screen and do not repeatedly submit the same question; use Help search or contact a person instead. The assistant is not a required step in support or recovery.

The assistant may also be unavailable when its approved model profile expires or is retired. It does not silently select another provider. Use Help search or human support while an administrator reviews a qualified replacement.

## Report a security or privacy concern

Use [security@blentera.com](mailto:security@blentera.com) for a security concern and [privacy@blentera.com](mailto:privacy@blentera.com) for a privacy request. Share only the information needed to explain the concern. Never send a credential to prove that you possess it.

## Import recovery

For a running or interrupted company import, follow [Importing and exporting companies](/guides/board-operator/importing-and-exporting). An unknown result needs reconciliation before another import can safely run.

## Technical documentation

The other documentation tabs cover native protocols, self-hosting, adapters, and developer APIs. Technical names such as Paperclip Runner, `paperclipai`, and `.paperclip.yaml` identify the underlying components and package formats.


## Trust and assurance

The Help view links to the [Blentera Trust Center](https://trust.blentera.com) for security, privacy, region/subprocessor, AI, accessibility and assurance information. Review the scope, version, review date and expiry of any evidence before relying on it. Product documentation is not proof of a deployment audit or certification. The [documentation overview](/trust/index) and [vulnerability disclosure policy](/trust/vulnerability-disclosure) are public guidance; contact a person for current deployment-specific or restricted evidence.

Where restricted evidence is available in Help, review its exact version and choose an expiry before granting access through the offered control. Access belongs to the named person and can expire or be revoked. Opening or sharing a link does not give another person access. If the deployment requires an NDA that has not been configured, contact a person to arrange the required review.

## Product changes

Help includes customer release notes with changes, affected audiences, required actions, documentation, and any stated rollback guidance or limitations. The recent publication window may be incomplete; the screen identifies missing configuration or unavailable notes. A note available only in the other language is labeled. Dismissing optional news does not remove these notes or complete an Action Needed requirement.
