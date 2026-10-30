---
help_article_id: apps-and-connections-da
title: Tilslut eller genopret en appforbindelse
summary: Tilslut en app, gennemgå adgangen, og genopret forbindelsen, når du bliver bedt om det
audience: company-administrators
product_capability_refs: [V10-074, V10-108, V10-109]
screen_contract_refs: [APPS, SETTINGS-APPS-DATA]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-29
review_trigger: Ændringer i appforbindelser, udbydergodkendelse, fornyelse af adgang eller adgangskontrol
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/apps/Connections.tsx, ui/src/pages/apps/AppNotConnected.tsx, ui/src/pages/apps/AppDetail.tsx, ui/src/pages/apps/app-detail/PermissionsPanel.tsx, ui/src/features/connections/ConnectionSetupFlow.tsx, packages/shared/src/app-definitions/slack.json, server/src/services/tool-access.ts, server/src/services/paperclip-cloud-connector.ts, ui/src/components/JevSkillSuggestionSettings.tsx, server/src/routes/jev-decisions.ts, server/src/services/jev-skill-suggestions.ts, server/src/services/tool-connection-lifecycle.ts, server/src/services/experience/connector-recovery.ts, ui/src/pages/apps/app-detail/IdentitiesSection.tsx]
---

Åbn **Apps** eller **Company settings → Apps and data** for at se de forbindelser, virksomheden kan bruge. Apps, loginmetoder og kontroller afhænger af den aktuelle installation.

## Tilslut en app

Vælg appen, og følg forbindelsesforløbet. Før du fortsætter, skal du kontrollere den konto eller arbejdsplads, der tilsluttes, hvem der kan bruge forbindelsen, og hvilke tilladelser eller handlinger der vises. Gennemfør login eller samtykke på udbyderens egen side. Vend derefter tilbage til Blentera og kontrollér forbindelsens status.

En forbindelse giver adgang til den valgte konto og det viste omfang. Det betyder ikke, at alle handlinger er slået til. Gennemgå appens tilladelser og handlingsindstillinger, før du beder en Co-worker om at bruge den.

Til Slack-agentværktøjer bruger standardvalget Blenteras administrerede Slack-app, når den er konfigureret på installationen. Gennemgå brugertilladelserne på opsætningsskærmen og på Slacks samtykkeside. Forbindelsen bruger som standard den indloggede persons Slack-konto. Hvis du udtrykkeligt vælger organisationsadgang, deles personens Slack-forbindelse med virksomheden; det opretter ikke en bot eller servicekonto. Hvis den administrerede mulighed ikke er tilgængelig, kan en forbindelsesadministrator bruge den avancerede mulighed til organisationens egen Slack OAuth-app. Den separate Slack-botapp bruges, når personer starter arbejde fra Slack.

## Genopret en forbindelse, når adgangen mangler

Hvis en forbindelse viser **Reconnect** eller **Reconnect required**, skal du åbne den og bruge handlingen til at genoprette forbindelsen. Log ind på den samme udbyderkonto, og gennemgå den aktuelle adgangsanmodning. Nogle apps kan bede dig om at erstatte adgangsoplysninger eller vælge en arbejdsplads igen. Detaljerne varierer mellem udbydere.

Hvis din Blentera-session ændres under login, skal du åbne forbindelsen igen og starte login forfra. Et samtykkelink fra en tidligere session kan ikke færdiggøre forbindelsen i en anden session.

Kontrollér forbindelsens status, når du vender tilbage. Indsæt ikke adgangskoder, API-nøgler eller gendannelseskoder i en opgave eller supportanmodning. Hvis genforbindelse ikke er tilgængelig, eller status stadig er uklar, kan du kontakte [menneskelig support](/da/help/index) med appens navn og den ikke-hemmelige status, der vises.

## Valgfrie Jev-beslutninger om Skills

Virksomhedens forbindelsesadministratorer kan vælge en delt OpenRouter API-nøgle under **Virksomhedsindstillinger → Valgfrie Jev-forslag til Skills**. Jev er slået fra som standard. Når forbindelsen gemmes, starter baggrundskald ikke. Baggrundskontroller i skyggetilstand kræver både **Skyggevaluering** og den særskilte indstilling **Tillad baggrundskontroller i skyggetilstand**. Den native Skill-løsning er fortsat bestemmende, og påkrævede Skills ændres ikke.

Opsætningstesten sender kun en fast, harmløs prøve til den valgte OpenRouter-konto. Skærmen viser den aktuelle operatørkvalificerede profils nøjagtige valuta og maksimale pris, før du giver samtykke; OpenRouter fakturerer virksomhedens delte konto. Gennemgå meddelelsen, og giv udtrykkeligt samtykke for hver test. Et vellykket svar bekræfter kun forbindelsen; det kvalificerer eller aktiverer ikke Skill-forslag. Der kræves en aktuel operatørkvalificeret Jev-profil og virksomhedens behandlingspolitik. EU-begrænsede politikker blokerer denne OpenRouter-rute. Hvis udbyderens resultat er ukendt, tilbageholdes det maksimale reserverede beløb. Behold testreferencen, og bed en administrator kontrollere betalingen, før du starter endnu en betalt test.

Hvis den valgte Jev-model er blokeret eller udgået, stopper opsætningstests og Skill-beslutninger. Se **Action Needed**, og bed en administrator om at få en kvalificeret erstatning på plads, før du prøver igen. En genoprettet appforbindelse kvalificerer ikke en erstatningsmodel.

## Kontrollér forbindelsens tilstand

Forbindelsens detaljer kan vise udløb for OAuth-adgangstoken og fornyelsestoken, når udbyderen har oplyst dem. Manglende oplysninger om udløb eller udfasning betyder, at de ikke er oplyst. Et udløbet adgangstoken kan kræve fornyelse; et udløbet fornyelsestoken kræver genforbindelse. GitHub-adgang afhænger også af en aktuel kontrol af adgangen til repositories og webhookens tilstand. Følg den aktuelle handling til genopretning, og kontrollér status bagefter. Når forbindelsen er genoprettet, kræver den ikke længere den handling.
