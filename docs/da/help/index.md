---
help_article_id: help-and-human-support-da
title: Hjælp og menneskelig support
summary: Find vejledning, se dine sager, eller kontakt en person direkte
audience: company-members
product_capability_refs: [HELP-01, HELP-02, V10-038]
screen_contract_refs: [HELP-01, HELP-02]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i Hjælp-navigation, supportindtag, kontaktoplysninger eller genopretning
security_or_privacy_sensitive: true
linked_source_files: [ui/src/App.tsx, ui/src/components/ExperienceUtilities.tsx, ui/src/pages/CustomerHelpCenter.tsx, ui/src/pages/CustomerSupportCases.tsx, ui/src/lib/help-navigation.ts, server/src/routes/customer-support.ts, server/src/services/experience/customer-support.ts, server/src/services/experience/support-cases.ts, packages/shared/src/customer-support.ts, packages/shared/src/customer-feedback.ts, packages/shared/src/product-identity.ts, packages/shared/src/support-diagnostics.ts, ui/src/api/search.ts, server/src/services/company-search.ts, server/src/routes/issues.ts, packages/shared/src/types/search.ts, ui/src/components/ExperienceCommandPalette.tsx, ui/src/pages/Search.tsx, packages/shared/src/validators/search.ts]
---

Åbn **Hjælp / Support** i appen for at gennemse vejledning, åbne supportsager eller kontrollere den konfigurerede statusside. Du kan kontakte menneskelig support direkte på [support@blentera.com](mailto:support@blentera.com). Du behøver ikke først tale med en assistent.

Søg efter produktord i Hjælp for at finde relevant vejledning. Hjælpeartiklerne findes på dansk og engelsk. Søgningen bruger det aktuelle visningssprog. Når du åbner et resultat i en ny fane, forbliver arbejdet og Hjælp-visningen tilgængelige.

Du kan også finde hjælpeartikler i den aktuelle kommandopalette. Tryk **Ctrl+K** på Windows eller Linux eller **⌘K** på Mac, og skriv et emne. Når du vælger en hjælpeartikel, åbnes den i en ny fane, og fokus vender tilbage til den kontrol, du brugte til at åbne paletten. Den eksisterende Arbejde-visning forbliver tilgængelig.

Når du åbner Hjælp, mens du arbejder i samme virksomhed, kan du lukke den for at vende tilbage til den oprindelige visning. Skriv ikke adgangskoder, gendannelseskoder, API-nøgler eller andre hemmeligheder i en supportbesked. Gennemgå diagnosticeringsoplysninger, før du deler dem.

## Supportsager

Vælg **Mine supportsager** for at sende en anmodning eller læse en eksisterende sag. En gemt kvittering bekræfter, at anmodningen blev gemt. Den bekræfter ikke i sig selv levering til en ekstern supportudbyder eller svartid. Følg behandlingsbeskeden, der vises før afsendelse. Indsendelse kan være utilgængelig, hvis beskeden ikke er konfigureret.

Hvis resultatet af en indsendelse er ukendt, skal du beholde den oprindelige anmodning på siden og bruge dens genoprettelseshandling. Genindlæsning kontrollerer, om kvitteringen er gemt. Opret ikke en ny anmodning alene, fordi svaret blev afbrudt.

Hvis en gemt sag viser ukendt levering, skal du beholde sagsreferencen og kontakte support direkte. Et afbrudt leveringsforsøg sendes ikke automatisk igen, fordi udbyderen allerede kan have modtaget det.

## Indberet et sikkerheds- eller privatlivsproblem

Brug [security@blentera.com](mailto:security@blentera.com) ved sikkerhedsproblemer og [privacy@blentera.com](mailto:privacy@blentera.com) ved privatlivsanmodninger. Del kun de oplysninger, der er nødvendige for at forklare problemet. Send aldrig en adgangsoplysning for at bevise, at den tilhører dig.

## Genopretning af import

Ved en kørende eller afbrudt virksomhedsimport skal du følge [Importér og eksportér virksomheder](/da/guides/board-operator/importing-and-exporting). Hvis resultatet er ukendt, skal det afklares, før det er sikkert at starte en ny import.

## Teknisk dokumentation

De øvrige dokumentationsfaner dækker native protokoller, selvhosting, adaptere og udvikler-API'er. Tekniske navne som Paperclip Runner, paperclipai og .paperclip.yaml identificerer de underliggende komponenter og pakkeformater.
