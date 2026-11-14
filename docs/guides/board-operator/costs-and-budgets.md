---
help_article_id: billing-and-capacity
title: Billing and capacity
summary: Check subscription status, available capacity, usage, and payment options
audience: company-administrators
product_capability_refs: [V10-032]
screen_contract_refs: [SETTINGS-BILLING-CAPACITY]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Subscription status, prices, usage meters, payment portal, or capacity behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/SaasBilling.tsx, ui/src/api/saas.ts, server/src/routes/saas.ts, server/src/services/billing/billing.ts, server/src/services/billing/usage.ts]
---

Open **Company settings → Billing** to check the current subscription and capacity information for the selected company. Billing may be unavailable in some deployments; the page will say when it is not available.

## Understand what is billed

The billing page separates Blentera’s paid capacity and managed infrastructure from charges billed by your model or runtime provider. Check the provider’s own account for those separate charges. The page shows the current access state, subscription status, available plans, and usage details supported by your deployment.

If the page shows **Free Core**, read the displayed limits and availability there. If it shows grace or read-only access, follow the action shown on the billing page. When access is read-only, the page says you can view and export your work while changes are unavailable.

## Manage payment or cancel

Select **Manage payment and subscription** to open the payment provider’s portal. Review the current subscription and its terms there. If that subscription offers cancellation in the portal, complete it there and return to Blentera to check the status. A status such as **Cancels at the end of this period** appears only after the subscription state is reported back.

When checkout says the provider has not confirmed the result, do not create another checkout just to check. Follow the billing page’s reconciliation notice or contact [human support](/help/index). The page’s **Refresh subscription** action is available after a completed, expired, or failed checkout.

Account and organization deletion are separate from subscription changes. See [Export and deletion](/help/export-and-delete) before requesting either one.
