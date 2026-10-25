---
help_article_id: people-and-company-access-da
title: Virksomhedsindstillinger, personer og enterprise-identitet
summary: Angiv virksomhedsstandarder, gennemgå driftsforhold, og administrer medlems- og identitetsadgang
audience: company-administrators
product_capability_refs: [V10-159]
screen_contract_refs: [SETTINGS-PEOPLE-ACCESS]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i virksomhedsstandarder, enterprise-identitet eller driftsforhold, medlemmer, invitationer, adgangsanmodninger, roller, status eller omfordeling
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/CompanySettings.tsx, ui/src/components/AccountExperienceLanguageSelect.tsx, ui/src/components/routine-triggers/RoutineTriggers.tsx, ui/src/pages/Enterprise.tsx, server/src/services/enterprise/identity-policy.ts, server/src/services/routines.ts, ui/src/pages/CompanyAccess.tsx, ui/src/components/access/InvitesSection.tsx, ui/src/components/access/CompanySettingsNav.tsx]
---

Åbn **Company settings → Members** for at se, hvem der har adgang til den valgte virksomhed. De kontroller, du kan bruge, afhænger af din virksomhedsrolle og af, hvilke indstillinger instansadministratoren har gjort tilgængelige.

## Invitér, eller gennemgå en anmodning om adgang

Åbn fanen **Invites** for at oprette eller administrere en invitation, hvis den er tilgængelig for dig. Inviterede personer bruger invitationslinket til at blive medlem. De tilladte tilmeldingstyper og standardrollen vises i invitationens indstillinger. Nogle instanser har også et særskilt invitationslink fra hostingplatformen.

Hvis en anmodning om adgang kræver godkendelse, skal du gennemgå den under Members, før du godkender eller afviser den. En invitation eller anmodning om adgang er ikke det samme som aktiv virksomhedsadgang.

## Ændr et medlems adgang

Brug medlemmets redigeringshandling til at ændre den rolle eller status, siden tilbyder. Kontrollér den viste rolle og status, før du gemmer. Et suspenderet eller fjernet medlem kan miste adgangen til virksomhedens indhold og handlinger.

Før du fjerner et medlem, skal du gennemgå valgene for omfordeling. Siden kan vise opgaver, der er tildelt personen, og rutiner, som vedkommende ejer. Vælg, hvad der skal ske med dem, før du bekræfter fjernelsen. Kontrollér de nye ejere og statusser bagefter.

Virksomhedsmedlemskab er adskilt fra en Co-workers plads i teamet. Se [Arbejd med Co-workers](/da/guides/board-operator/managing-agents) for arbejderstatus og [Eksport og sletning](/da/help/export-and-delete) for sletning af konto eller virksomhed.

## Angiv virksomhedsstandarder

En autoriseret virksomhedsejer eller administrator kan vælge virksomhedens standardsprog og tidszone under **Company settings → General**. Dit udtrykkelige personlige sprogvalg har forrang. Virksomhedssproget bruges kun som reserve, når du ikke har et personligt valg, og det ændrer ikke andre personers gemte præferencer.

Virksomhedens tidszone bruges, når en ny rutineplan oprettes uden en udtrykkelig tidszone. En tidszone, der allerede er gemt på en plan, eller som vælges udtrykkeligt for en ny plan, bevares. En ændring af virksomhedsstandarden omskriver ikke eksisterende planer.

## Gennemgå enterprise-identitet og driftsforhold

En aktiv virksomhedsejer kan konfigurere identitetspolitikken under **Company settings → Enterprise**. Når politikken gemmes, oprettes eller opdateres et udkast; aktivering af identiteten kræver stadig særskilt platformskvalificering. Gennemgå og indtast aktuelle behandlingsregioner, udbyderoversigt, placering, opbevaringsbeskrivelse, kontraktdokumentation og begrænsninger fra virksomhedens og implementeringens registre. Formularen udfylder ikke antagede oplysninger. Hvis en værdi ikke er kontrolleret, skal den registreres som ukendt, hvor feltet tillader det, eller afklares før lagring. En gemt beskrivelse dokumenterer ikke, at en udbyder, region, opbevaringsforpligtelse eller dedikeret placering er uafhængigt verificeret.
