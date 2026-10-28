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
last_verified_at: 2026-10-28
review_trigger: Ændringer i eksport, sletning, opbevaring, privat Memory-deling eller kildeadgang
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/CompanyExport.tsx, ui/src/pages/SaasDeletion.tsx, ui/src/pages/SaasAccount.tsx, server/src/services/saas/account-deletion.ts, server/src/services/saas/offboarding.ts, server/src/services/saas/company-purge.ts, ui/src/pages/Memory.tsx, server/src/routes/memory.ts, server/src/services/memory/memory-service.ts, server/src/services/memory/memory-privacy.ts, server/src/services/memory/memory-jobs.ts, server/src/services/native-runtime/runtime-asset-retention.ts, server/src/services/native-local-process-stop.ts, server/src/services/heartbeat.ts]
---

Blentera har særskilte handlinger til at eksportere en virksomhed, slette en organisation og slette din personlige konto. Kontrollér, hvilke data og hvilken identitet du mener, før du fortsætter.

## Eksportér virksomhedsdata

Åbn **Company settings → Export** for at vælge de filer, der skal med i virksomhedspakken. Du kan særskilt inkludere de supportsager, du aktuelt kan se; arkivet indeholder den kundesynlige historik, men ikke interne noter eller adgangstilladelser, og det gendanner ikke aktive sager. Gennemgå forhåndsvisningen og rapporten **Not included in this export**, før du henter pakken. En virksomhedseksport er en flytbar pakke, ikke en kopi af alle databaseposter eller data hos eksterne udbydere. Se [Importér og eksportér virksomheder](/da/guides/board-operator/importing-and-exporting) for pakkens aktuelle indhold og hjælp til importgenopretning.

## Anmod om sletning af organisation

Åbn **Company settings → Deletion** for at gennemgå anmodningen om at slette organisationen. Siden beder dig først eksportere organisationen, bekræfte dens navn og anerkende sletningen. Sletning stopper arbejdet og starter den viste afviklingsproces. Den kan ikke fortrydes.

Sletningen kan forblive i en opbevaringstilstand, mens administrerede sikkerhedskopier når deres slettefrist. Finansielle poster og en minimal kvittering for sletning kan blive gemt, hvor det kræves. Følg status og trin på sletningssiden. En indsendt anmodning beviser ikke, at den endelige sletning er gennemført.

## Anmod om sletning af personlig konto

Åbn **Company settings → Security** for at gennemgå sletning af din personlige konto. Indtast **DELETE MY ACCOUNT**, og bekræft, at du har gemt de eksporter, du har brug for. Hvis du bruger en adgangskode, skal du bekræfte din aktuelle adgangskode. Hvis du får tilbudt bekræftelse gennem virksomhedens login, skal du vende tilbage fra identitetsudbyderen og gennemgå anmodningen, før du sender den. Hvis din konto kræver yderligere godkendelse, skal du bekræfte den seneste faktor, når du bliver bedt om det. Hvis anmodningen accepteres, viderestilles kontosiden og viser en kvittering, når den er tilgængelig.

Hvis en tidligere anmodning har et ukendt resultat, skal du bruge gendannelsen på kontosiden i stedet for at indsende en ny anmodning. Ved spørgsmål om privatliv kan du skrive til [privacy@blentera.com](mailto:privacy@blentera.com). Send ikke din adgangskode, gendannelseskode eller API-nøgle.


## Gennemgå deling af privat Memory (preview)

Når Memory er slået til, viser et forslag om privat deling det præcise indhold og destinationen. Gennemgå begge dele, før du vælger **Godkend og del**. Kun den oprindelige ejer kan godkende delingen fra sin aktuelle konto. Almindelig gennemgang af Memory udvider ikke adgangen til private kilder.

Den private original forbliver privat. Modtagere skal fortsat have aktuel adgang til destinationen og de bevarede kilder. Deling af Memory offentliggør ikke en underliggende privat opgave. En delt kopi kan blive utilgængelig, hvis kilden ændres, udløber, trækkes tilbage eller slettes. Et gemt resultat kan også miste tekst, det har kopieret fra en kilde, når kilden slettes. Det sletter ikke en selvstændig opgave eller et dokument skrevet af en person, blot fordi resultatet er knyttet til det. Sletning af den delte kopi sletter ikke den private original.

Når du føjer kilder til et eksisterende, menneskeskabt Memory-element, kontrollerer Blentera din aktuelle konto og alle tidligere og nye opgavekilder igen. Hvis en kilde ikke længere er aktuel eller tilgængelig, afvises opdateringen, og de eksisterende kildebegrænsninger bevares.

Hvis du vælger **Forget permanently**, slettes det valgte Memory-indhold og dets afledte rettelses- og delingsposter. Hvis Memory stammer fra en administreret OpenCode-kørsel, sætter Blentera også afviklingens app-administrerede runtimefiler i kø til sletning. Filoprydningen venter, indtil Native har bekræftet, at kørslen er stoppet. Handlingen omfatter ikke data hos eksterne udbydere uden for Blenteras administrerede runtime-lager.

Oprydning af administrerede filer afventer, indtil stop af processen og fjernelse fra lageret kan bekræftes. Hvis oprydningen fortsat afventer, skal du kontakte menneskelig support med den gemte kvittering. Sletning af Memory bekræfter ikke, at data hos en udbyder er fjernet.
