---
help_article_id: apps-and-connections-da
title: Tilslut eller genopret en appforbindelse
summary: Tilslut en app, gennemgå adgangen, og genopret forbindelsen, når du bliver bedt om det
audience: company-administrators
product_capability_refs: [V10-109]
screen_contract_refs: [APPS, SETTINGS-APPS-DATA]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i appforbindelser, udbydergodkendelse, fornyelse af adgang eller adgangskontrol
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/apps/Connections.tsx, ui/src/pages/apps/AppNotConnected.tsx, ui/src/pages/apps/AppDetail.tsx, ui/src/pages/apps/app-detail/PermissionsPanel.tsx, ui/src/components/JevSkillSuggestionSettings.tsx, server/src/routes/jev-decisions.ts, server/src/services/jev-skill-suggestions.ts]
---

Åbn **Apps** eller **Company settings → Apps and data** for at se de forbindelser, virksomheden kan bruge. Apps, loginmetoder og kontroller afhænger af den aktuelle installation.

## Tilslut en app

Vælg appen, og følg forbindelsesforløbet. Før du fortsætter, skal du kontrollere den konto eller arbejdsplads, der tilsluttes, hvem der kan bruge forbindelsen, og hvilke tilladelser eller handlinger der vises. Gennemfør login eller samtykke på udbyderens egen side. Vend derefter tilbage til Blentera og kontrollér forbindelsens status.

En forbindelse giver adgang til den valgte konto og det viste omfang. Det betyder ikke, at alle handlinger er slået til. Gennemgå appens tilladelser og handlingsindstillinger, før du beder en Co-worker om at bruge den.

## Genopret en forbindelse, når adgangen mangler

Hvis en forbindelse viser **Reconnect** eller **Reconnect required**, skal du åbne den og bruge handlingen til at genoprette forbindelsen. Log ind på den samme udbyderkonto, og gennemgå den aktuelle adgangsanmodning. Nogle apps kan bede dig om at erstatte adgangsoplysninger eller vælge en arbejdsplads igen. Detaljerne varierer mellem udbydere.

Kontrollér forbindelsens status, når du vender tilbage. Indsæt ikke adgangskoder, API-nøgler eller gendannelseskoder i en opgave eller supportanmodning. Hvis genforbindelse ikke er tilgængelig, eller status stadig er uklar, kan du kontakte [menneskelig support](/da/help/index) med appens navn og den ikke-hemmelige status, der vises.

## Valgfrie Jev-beslutninger om Skills

Virksomhedens forbindelsesadministratorer kan vælge en delt OpenRouter API-nøgle under **Virksomhedsindstillinger → Valgfrie Jev-forslag til Skills**. Jev er slået fra som standard. Når forbindelsen gemmes, starter baggrundskald ikke. Baggrundskontroller i skyggetilstand kræver både **Skyggevaluering** og den særskilte indstilling **Tillad baggrundskontroller i skyggetilstand**. Den native Skill-løsning er fortsat bestemmende, og påkrævede Skills ændres ikke.

Opsætningstesten sender kun en fast, harmløs prøve til den valgte OpenRouter-konto. Skærmen viser den aktuelle operatørkvalificerede profils nøjagtige valuta og maksimale pris, før du giver samtykke; OpenRouter fakturerer virksomhedens delte konto. Gennemgå meddelelsen, og giv udtrykkeligt samtykke for hver test. Et vellykket svar bekræfter kun forbindelsen; det kvalificerer eller aktiverer ikke Skill-forslag. Der kræves en aktuel operatørkvalificeret Jev-profil og virksomhedens behandlingspolitik. EU-begrænsede politikker blokerer denne OpenRouter-rute. Hvis udbyderens resultat er ukendt, skal du beholde testreferencen og afvente afstemning; en ny test kan medføre endnu en betaling.
