---
help_article_id: preview-and-known-limits
title: Preview features and known limits
summary: Understand preview and experimental labels and find the current feature status
audience: company-members
product_capability_refs: [V10-015, V10-017, V10-032]
screen_contract_refs: [SETTINGS-ADVANCED-DEVELOPER]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Feature maturity labels, experimental settings, availability, or public release information changes
security_or_privacy_sensitive: false
linked_source_files: [ui/src/pages/InstanceExperimentalSettings.tsx, ui/src/hooks/useSaasCapabilities.ts, packages/shared/src/v9-feature-flags.ts]
---

Feature availability can differ by deployment and company. A feature marked **Preview** or **Experimental** is still changing. The Experimental settings page says experimental features may break; do not make a critical process depend on one unless your team accepts that risk.

## Check whether a feature is available

Look for the feature in the app and read its current label and setup notice. If it is missing, ask your instance administrator whether it is enabled for your deployment. Do not assume that a feature exists because it appears in an API or developer reference.

An experimental setting is controlled at the instance level when the control is visible. Ask the instance administrator before changing it. Before disabling a setting related to a running integration, check that feature’s own guidance and current status.

## Release information and service incidents

This Help Center does not currently provide a complete release-by-release feature history. Use the feature’s current screen and its linked guidance for availability and limits. Open [Help and human support](/help/index) to ask about a specific product limitation. If Help shows a configured service status page, check it for reported service incidents; it does not describe every feature limitation.
