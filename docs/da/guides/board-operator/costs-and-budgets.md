---
help_article_id: billing-and-capacity-da
title: Fakturering og kapacitet
summary: Kontrollér abonnement, tilgængelig kapacitet, forbrug og betalingsmuligheder
audience: company-administrators
product_capability_refs: [V10-032]
screen_contract_refs: [SETTINGS-BILLING-CAPACITY]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i abonnementsstatus, priser, forbrugsmålere, betalingsportal eller kapacitet
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/SaasBilling.tsx, ui/src/api/saas.ts, server/src/routes/saas.ts, server/src/services/billing/billing.ts, server/src/services/billing/usage.ts]
---

Åbn **Company settings → Billing** for at kontrollere abonnements- og kapacitetsoplysningerne for den valgte virksomhed. Fakturering kan være utilgængelig i nogle installationer. Siden fortæller dig, hvis det er tilfældet.

## Forstå, hvad der faktureres

Faktureringssiden adskiller Blenteras betalte kapacitet og administrerede infrastruktur fra de gebyrer, din model- eller runtimeudbyder opkræver. Kontrollér de særskilte gebyrer på udbyderens egen konto. Siden viser den aktuelle adgangstilstand, abonnementsstatus, tilgængelige planer og de forbrugsdetaljer, som din installation understøtter.

Hvis siden viser **Free Core**, skal du læse de viste grænser og tilgængelighed dér. Hvis den viser en fristperiode eller skrivebeskyttet adgang, skal du følge handlingen på faktureringssiden. Ved skrivebeskyttet adgang fortæller siden, at du kan se og eksportere dit arbejde, mens ændringer ikke er tilgængelige.

## Administrér betaling, eller opsig

Vælg **Manage payment and subscription** for at åbne betalingsudbyderens portal. Gennemgå abonnementet og dets vilkår dér. Hvis abonnementet tilbyder opsigelse i portalen, skal du gennemføre den dér og vende tilbage til Blentera for at kontrollere status. En status som **Cancels at the end of this period** vises først, når abonnementsstatus er meldt tilbage.

Hvis betalingssiden siger, at udbyderen ikke har bekræftet resultatet, skal du ikke starte en ny betaling blot for at kontrollere. Følg afklaringsbeskeden på faktureringssiden, eller kontakt [menneskelig support](/da/help/index). Handlingen **Refresh subscription** er tilgængelig efter en gennemført, udløbet eller fejlet betaling.

Sletning af konto og organisation er adskilt fra abonnementsændringer. Se [Eksport og sletning](/da/help/export-and-delete), før du anmoder om en af delene.
