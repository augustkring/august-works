---
help_article_id: preview-and-known-limits-da
title: Forhåndsvisning, eksperimenter og kendte begrænsninger
summary: Forstå mærkater for forhåndsvisning og eksperimenter, og find aktuel status
audience: company-members
product_capability_refs: [V10-015, V10-017, V10-032]
screen_contract_refs: [SETTINGS-ADVANCED-DEVELOPER]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-28
review_trigger: Ændringer i modenhedsmærkater, eksperimentelle indstillinger, tilgængelighed eller udgivelsesoplysninger
security_or_privacy_sensitive: false
linked_source_files: [ui/src/pages/InstanceExperimentalSettings.tsx, ui/src/hooks/useSaasCapabilities.ts, packages/shared/src/v9-feature-flags.ts, packages/shared/src/feature-catalog.ts]
---

Funktioners tilgængelighed kan variere mellem installationer og virksomheder. En funktion markeret **Preview** eller **Experimental** er stadig under udvikling. Siden for eksperimentelle indstillinger siger, at eksperimentelle funktioner kan gå i stykker. Gør ikke en sådan funktion kritisk for en proces, medmindre dit team accepterer risikoen.

## Kontrollér, om en funktion er tilgængelig

Se efter funktionen i appen, og læs dens aktuelle mærkat og opsætningsbesked. Hvis du ikke kan se den, skal du spørge instansadministratoren, om den er slået til for din installation. Gå ikke ud fra, at en funktion findes, blot fordi den står i en API- eller udviklerreference.

En eksperimentel indstilling styres på instansniveau, når kontrollen vises. Spørg instansadministratoren, før du ændrer den. Før du slår en indstilling fra, hvis den vedrører en kørende integration, skal du kontrollere funktionens egen vejledning og aktuelle status.

## Udgivelsesoplysninger og servicehændelser

Dette Hjælp-center har endnu ikke en komplet historik over funktioner fra udgivelse til udgivelse. Brug funktionens aktuelle skærmbillede og tilknyttede vejledning til at se tilgængelighed og begrænsninger. Åbn [Hjælp og menneskelig support](/da/help/index) for at spørge til en konkret produktbegrænsning. Hvis Hjælp viser en konfigureret statusside, kan du kontrollere anmeldte servicehændelser dér. Den beskriver ikke alle funktionsbegrænsninger.

Interne og udfasede funktioner kan ikke aktiveres til ny brug via en gammel gemt eksperimentel indstilling. Funktionens aktuelle livscyklusstatus bestemmer tilgængeligheden. Bed administratoren om den understøttede erstatning eller migrationsvejledning, der vises for funktionen.
