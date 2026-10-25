---
help_article_id: export-and-delete-da
title: Eksportér data, eller anmod om sletning
summary: Forstå eksport af virksomhed, sletning af organisation og sletning af personlig konto
audience: company-administrators
product_capability_refs: [V10-116, V10-159]
screen_contract_refs: [SETTINGS-DATA-PRIVACY, SETTINGS-PEOPLE-ACCESS]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i eksportens omfang, kontosletning, organisationssletning eller opbevaring
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/CompanyExport.tsx, ui/src/pages/SaasDeletion.tsx, ui/src/pages/SaasAccount.tsx, server/src/services/saas/account-deletion.ts, server/src/services/saas/offboarding.ts, server/src/services/saas/company-purge.ts]
---

Blentera har særskilte handlinger til at eksportere en virksomhed, slette en organisation og slette din personlige konto. Kontrollér, hvilke data og hvilken identitet du mener, før du fortsætter.

## Eksportér virksomhedsdata

Åbn **Company settings → Export** for at vælge de filer, der skal med i virksomhedspakken. Gennemgå forhåndsvisningen og rapporten **Not included in this export**, før du henter pakken. En virksomhedseksport er en flytbar pakke, ikke en kopi af alle databaseposter eller data hos eksterne udbydere. Se [Importér og eksportér virksomheder](/da/guides/board-operator/importing-and-exporting) for pakkens aktuelle indhold og hjælp til importgenopretning.

## Anmod om sletning af organisation

Åbn **Company settings → Deletion** for at gennemgå anmodningen om at slette organisationen. Siden beder dig først eksportere organisationen, bekræfte dens navn og anerkende sletningen. Sletning stopper arbejdet og starter den viste afviklingsproces. Den kan ikke fortrydes.

Sletningen kan forblive i en opbevaringstilstand, mens administrerede sikkerhedskopier når deres slettefrist. Finansielle poster og en minimal kvittering for sletning kan blive gemt, hvor det kræves. Følg status og trin på sletningssiden. En indsendt anmodning beviser ikke, at den endelige sletning er gennemført.

## Anmod om sletning af personlig konto

Åbn **Company settings → Security** for at gennemgå sletning af din personlige konto. Formularen kræver din aktuelle adgangskode, teksten **DELETE MY ACCOUNT** og en bekræftelse af, at du har gemt de eksporter, du har brug for. Hvis anmodningen accepteres, viderestilles kontosiden og viser en kvittering, når den er tilgængelig.

Hvis en tidligere anmodning har et ukendt resultat, skal du bruge gendannelsen på kontosiden i stedet for at indsende en ny anmodning. Ved spørgsmål om privatliv kan du skrive til [privacy@blentera.com](mailto:privacy@blentera.com). Send ikke din adgangskode, gendannelseskode eller API-nøgle.
