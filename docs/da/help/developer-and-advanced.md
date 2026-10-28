---
help_article_id: developer-and-advanced-da
title: Dokumentation for udviklere og avancerede brugere
summary: Find API-, CLI-, installations- og avancerede konfigurationsreferencer
audience: developers-and-instance-administrators
product_capability_refs: [V10-032, V10-092]
screen_contract_refs: [SETTINGS-ADVANCED-DEVELOPER]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-28
review_trigger: Ændringer eller flytning af API-, CLI-, installations- eller avanceret konfigurationsdokumentation
security_or_privacy_sensitive: true
linked_source_files: [server/src/routes/openapi.ts, server/src/routes/index.ts, cli/src/index.ts]
---

Brug den eksisterende engelske dokumentation til teknisk opsætning og integration:

- [API-oversigt](https://docs.blentera.com/api/overview), [godkendelse](https://docs.blentera.com/api/authentication) og [API-reference](https://docs.blentera.com/api/companies)
- [CLI-oversigt](https://docs.blentera.com/cli/overview) og [opsætningskommandoer](https://docs.blentera.com/cli/setup-commands)
- [Installationsmåder](https://docs.blentera.com/deploy/deployment-modes), [hemmeligheder](https://docs.blentera.com/deploy/secrets) og [miljøvariabler](https://docs.blentera.com/deploy/environment-variables)

API- og CLI-referencerne beskriver deres egne understøttede kommandoer og endpoints. Tilgængeligheden kan afhænge af din installation, aktiverede funktioner og aktuelle autorisation. Brug dokumentationen til den installerede version, og kontrollér den aktuelle side eller API-svar, før du gentager en skrivehandling efter et afbrudt svar.

Den primære CLI-kommando er `blentera`. For en version, der indeholder kommandoen, skal du følge [migrationsvejledningen](https://docs.blentera.com/cli/migration), før du opdaterer automatisering. Den midlertidige `paperclipai`-kommando bruger samme implementering og skriver en udfasningsmeddelelse til stderr. Kommandonavnet ændrer ikke dine gemte data eller rettigheder.

Ved hjælp til en kundeopgave skal du bruge [Hjælp og menneskelig support](/da/help/index) i stedet for at lægge private data eller adgangsoplysninger i en udviklerlog.
