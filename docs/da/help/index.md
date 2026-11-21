---
help_article_id: help-and-human-support-da
title: Hjælp og menneskelig support
summary: Søg vejledning, spørg valgfrit Supportassistenten, se sager, eller kontakt en person
audience: company-members
product_capability_refs: [HELP-01, HELP-02, V10-038, V10-051, V10-059, V10-095]
screen_contract_refs: [HELP-01, HELP-02]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-28
review_trigger: Ændringer i Hjælp-navigation, supportindtag, kontaktoplysninger eller genopretning
security_or_privacy_sensitive: true
linked_source_files: [ui/src/components/ServiceHealth.tsx, packages/shared/src/service-health.ts, server/src/services/experience/service-health.ts, ui/src/App.tsx, ui/src/components/ExperienceUtilities.tsx, ui/src/pages/CustomerHelpCenter.tsx, ui/src/pages/CustomerSupportCases.tsx, ui/src/lib/help-navigation.ts, server/src/routes/customer-support.ts, server/src/services/experience/customer-support.ts, server/src/services/experience/support-cases.ts, packages/shared/src/customer-support.ts, packages/shared/src/customer-feedback.ts, packages/shared/src/product-identity.ts, packages/shared/src/support-diagnostics.ts, ui/src/api/search.ts, server/src/services/company-search.ts, server/src/routes/issues.ts, packages/shared/src/types/search.ts, ui/src/components/ExperienceCommandPalette.tsx, ui/src/pages/Search.tsx, packages/shared/src/validators/search.ts, server/src/services/experience/support-case-configuration.ts, server/src/services/experience/support-case-delivery.ts, server/src/services/experience/support-case-http-gateway.ts, server/src/routes/saas.ts, server/src/services/saas/support-case-operator.ts, ui/src/components/CustomerSupportAssistant.tsx, ui/src/components/CustomerSupportAssistant.test.tsx, server/src/services/orchestration/first-party-support-model-gateway.ts, server/src/services/orchestration/first-party-support-model-profiles.ts, server/src/services/experience/support-assistant-grounding.ts, server/src/services/orchestration/model-reservations.ts, server/src/services/agent-packages/execution-gate.ts, server/src/services/agent-packages/package-policy.ts, server/src/services/agent-packages/package-service.ts, server/src/saas-platform-config.ts, server/src/app.ts, server/src/services/company-search-help.generated.ts, packages/shared/src/agent-packages.ts, packages/shared/src/model-broker.ts, server/src/services/orchestration/read-only-model-transport.ts, ui/src/components/TrustGatedEvidence.tsx, server/src/services/trust-documents.ts, packages/shared/src/trust-documents.ts, ui/src/components/CustomerChangelog.tsx, ui/src/api/announcements.ts, server/src/routes/announcements.ts, server/src/services/announcement-feed.ts, packages/shared/src/announcements.ts]
---

Åbn **Hjælp / Support** i appen for at gennemse vejledning, åbne supportsager eller kontrollere den konfigurerede statusside. Du kan kontakte menneskelig support direkte på [support@blentera.com](mailto:support@blentera.com). Du behøver ikke først tale med en assistent.

Den offentlige statusside viser tjenesteoplysninger, som udbyderen har bekræftet. Den fastslår ikke, om din konto er berørt. Kontakt menneskelig support ved et problem med din konto, og medtag den viste besked fra appen uden hemmelige oplysninger.

Søg efter produktord i Hjælp for at finde relevant vejledning. Hjælpeartiklerne findes på dansk og engelsk. Søgningen bruger det aktuelle visningssprog. Når du åbner et resultat i en ny fane, forbliver arbejdet og Hjælp-visningen tilgængelige.

Du kan også finde hjælpeartikler i den aktuelle kommandopalette. Tryk **Ctrl+K** på Windows eller Linux eller **⌘K** på Mac, og skriv et emne. Når du vælger en hjælpeartikel, åbnes den i en ny fane, og fokus vender tilbage til den kontrol, du brugte til at åbne paletten. Den eksisterende Arbejde-visning forbliver tilgængelig.

Når du åbner Hjælp, mens du arbejder i samme virksomhed, kan du lukke den for at vende tilbage til den oprindelige visning. Skriv ikke adgangskoder, gendannelseskoder, API-nøgler eller andre hemmeligheder i en supportbesked. Gennemgå diagnosticeringsoplysninger, før du deler dem.

## Supportsager

Vælg **Mine supportsager** for at sende en anmodning eller læse en eksisterende sag. En gemt kvittering bekræfter, at anmodningen blev gemt. Den bekræfter ikke i sig selv levering til en ekstern supportudbyder eller svartid. Følg behandlingsbeskeden, der vises før afsendelse. Indsendelse kan være utilgængelig, hvis beskeden ikke er konfigureret.

Hvis resultatet af en indsendelse er ukendt, skal du beholde den oprindelige anmodning på siden og bruge dens genoprettelseshandling. Genindlæsning kontrollerer, om kvitteringen er gemt. Opret ikke en ny anmodning alene, fordi svaret blev afbrudt.

Hvis en gemt sag viser ukendt levering, skal du beholde sagsreferencen og kontakte support direkte. Et afbrudt leveringsforsøg sendes ikke automatisk igen, fordi udbyderen allerede kan have modtaget det.

Åbn en sag for at læse svar fra support. **Afventer dit svar** viser, hvad support har brug for fra dig. Et svar på en løst sag genåbner den samme sag. Et svar på en afsluttet sag opretter en tilknyttet opfølgning og bevarer den oprindelige historik.

Hvis du allerede har en opgave til opfølgning, kan du knytte den til sagen, når du har adgang til begge. Supportbeskederne bliver i sagen. Beskriv din undersøgelse og det korrigerende arbejde i opgaven. Åbn **Beslutninger** for at finde en relateret beslutning og bruge dens kontroller til evaluering af resultatet. En afsluttet evaluering eller en evaluering uden en sikker konklusion kan fortsætte til Learning gennem disse kontroller.

## Valgfri Supportassistent

Hjælp kan også vise en **Supportassistent**. Den er valgfri og kan være utilgængelig, hvis denne installation ikke har en aktuel operatørgodkendt Hjælp-pakke, udbyderprofil eller finansiering. Hjælpesøgning, supportsager og direkte menneskelig kontakt fungerer uafhængigt.

Når assistenten er tilgængelig, skal du læse behandlingsmeddelelsen og privatlivslinket, før du sender noget. Hvis du accepterer, skal du markere samtykkefeltet og vælge **Spørg assistenten**. Dit spørgsmål og udvalgte uddrag fra Hjælp-artikler sendes til Anthropic for et læsebaseret svar. Blentera betaler for denne inkluderede funktion; den bruger ikke dine AI-forbindelser. Medtag ikke adgangskoder, gendannelseskoder, API-nøgler eller andre hemmeligheder.

Assistenten kan kun returnere præcise uddrag fra godkendte, tilknyttede Hjælp-artikler. Den kan ikke skrive nye løsninger, slå din konto, opgave, sag eller tjenestestatus op eller udføre handlinger. Hvis artiklerne ikke underbygger et svar, oplyser den, at svaret ikke kan bekræftes. Kontakt menneskelig support direkte ved spørgsmål om din konto eller en aktuel hændelse.

Hvis resultatet af en anmodning er uklart, sendes den ikke automatisk igen. Behold meddelelsen på skærmen, og indsend ikke det samme spørgsmål gentagne gange; brug i stedet Hjælpesøgning eller kontakt en person. Assistenten er ikke et påkrævet trin for support eller genopretning.

Assistenten kan også være utilgængelig, når dens godkendte modelprofil udløber eller udfases. Den vælger ikke automatisk en anden udbyder. Brug Hjælpesøgning eller menneskelig support, mens en administrator gennemgår en kvalificeret erstatning.

## Indberet et sikkerheds- eller privatlivsproblem

Brug [security@blentera.com](mailto:security@blentera.com) ved sikkerhedsproblemer og [privacy@blentera.com](mailto:privacy@blentera.com) ved privatlivsanmodninger. Del kun de oplysninger, der er nødvendige for at forklare problemet. Send aldrig en adgangsoplysning for at bevise, at den tilhører dig.

## Genopretning af import

Ved en kørende eller afbrudt virksomhedsimport skal du følge [Importér og eksportér virksomheder](/da/guides/board-operator/importing-and-exporting). Hvis resultatet er ukendt, skal det afklares, før det er sikkert at starte en ny import.

## Teknisk dokumentation

De øvrige dokumentationsfaner dækker native protokoller, selvhosting, adaptere og udvikler-API'er. Tekniske navne som Paperclip Runner, paperclipai og .paperclip.yaml identificerer de underliggende komponenter og pakkeformater.


## Tillid og dokumentation

Hjælp-visningen linker til [Blenteras Trust Center](https://trust.blentera.com) med oplysninger om sikkerhed, privatliv, regioner og underdatabehandlere, AI, tilgængelighed og dokumentation. Kontroller omfang, version, gennemgangsdato og udløb, før du baserer en beslutning på materialet. Produktdokumentation beviser ikke en driftsrevision eller certificering. [Oversigten](/da/trust/index) og [politikken for sårbarhedsrapporter](/da/trust/vulnerability-disclosure) er offentlig vejledning. Kontakt en person for aktuel dokumentation om en bestemt installation eller begrænset materiale.

Når begrænset dokumentation er tilgængelig i Hjælp, skal du gennemgå den præcise version og vælge et udløbstidspunkt, før du giver adgang med den viste kontrol. Adgangen tilhører den angivne person og kan udløbe eller tilbagekaldes. At åbne eller dele et link giver ikke en anden person adgang. Hvis installationen kræver en NDA, som ikke er konfigureret, skal du kontakte en person for at få den nødvendige gennemgang på plads.

## Produktændringer

Hjælp viser kundenoter med ændringer, berørte brugere, nødvendige handlinger, dokumentation og eventuelle oplysninger om tilbagerulning eller begrænsninger. Den seneste udgivelsesperiode kan være ufuldstændig; siden viser manglende konfiguration eller utilgængelige noter. En note på det andet sprog er markeret. Hvis du afviser valgfrie nyheder, fjerner det ikke disse noter og afslutter ikke en nødvendig handling.
