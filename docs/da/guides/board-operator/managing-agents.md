---
help_article_id: working-with-coworkers-da
title: Arbejd med Co-workers
summary: Tilføj en Co-worker, kontrollér dens status, og styr hvornår den kan modtage arbejde
audience: company-administrators
product_capability_refs: [V10-074, V10-075, V10-078, V10-103, V10-108]
screen_contract_refs: [SETTINGS-AGENTS-AI, AGENT-MONITOR, AGENT-CHANGE]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-29
review_trigger: Ændringer i Co-worker-opsætning, kontoforbindelser, status, pause eller opgavefordeling
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Agents.tsx, ui/src/components/AgentModelMigrationMonitor.tsx, server/src/services/agents/authoring-model-migration-monitor.ts, server/src/services/agents/authoring-tests.ts, ui/src/pages/AgentDetail.tsx, server/src/services/agents.ts, server/src/services/agents/authoring-publication.ts, server/src/services/experience/model-retirement-notices.ts, ui/src/components/AgentRuntimeCandidates.tsx, ui/src/components/AgentDraftPublication.tsx, ui/src/components/MandatoryProductNotices.tsx]
---

Blentera kalder virksomhedens arbejdere for **Co-workers**. Nogle af de nuværende skærmbilleder bruger stadig betegnelsen **Agent**. Find dem under virksomhedens område for agenter, og åbn en Co-worker for at gennemgå dens indstillinger, forbindelse og seneste arbejde.

## Tilføj eller opdatér en Co-worker

Brug tilføj-handlingen i agentområdet, og udfyld felterne for rolle, instruktioner og AI-forbindelse. De tilgængelige indstillinger afhænger af forbindelsen og din instans. Kontrollér, hvem der kan bruge en delt forbindelse, og hvilke handlinger der kræver gennemgang, før du gemmer. En gemt adgang kan senere kræve genforbindelse, hvis udbyderen udløber eller tilbagekalder adgangen.

Åbn Co-workerens detaljeside for at se dens status og seneste opgavekørsler. Læs den præcise fejl eller opsætningsbesked. En Co-worker, der er markeret som klar til at modtage arbejde, er ingen garanti for, at en bestemt kørsel hos en udbyder lykkes.

## Sæt fremtidigt arbejde på pause

Sæt en Co-worker på pause, hvis den ikke skal modtage nye planlagte eller tildelte opgaver. At sætte en Co-worker på pause og at stoppe en igangværende kørsel er to forskellige handlinger. Åbn den aktive opgave, og brug den aktuelle kørsels-handling dér. Se [Gennemgå godkendelser og stop arbejde](/da/guides/board-operator/approvals).

Når du tildeler arbejde, skal du gennemgå opgavens instruktioner, ejer og projekt. Opgavesiden viser dens aktuelle status og registrerede resultat. Co-workerens status alene bekræfter ikke, at opgaven er færdig.

Se [Personer og virksomhedsadgang](/da/guides/board-operator/org-structure) for virksomhedens medlemmer og deres adgang. Se [Genoptag afbrudt arbejde](/da/help/recovering-work), hvis en opgave ikke blev færdig.

## Gennemgå et modelskift

Hvis Action Needed viser, at en aktuel Agent-model skal migreres, skal du åbne agenten og gennemgå en erstatning via dens kladde og kvalificerede runtime-kandidat. Udgivelse af et modelskift kræver en persons gennemgang af den præcise kandidat og det bevarede testgrundlag. Tilbagerulning kræver også en aktuelt kvalificeret kandidat og gennemgang. Blentera erstatter ikke en udfaset model automatisk. Hvis kvalifikation eller det oprindelige testgrundlag mangler, skal en administrator afklare blokeringen før udgivelse.

Hvis Action Needed vedrører en anden modelafhængighed i virksomheden, skal du åbne meddelelsens supporthandling. Bed en administrator om at få en kvalificeret erstatning på plads.

Start en ny kladde fra den aktuelle Agent-version efter publiceringen. Kør hvert gemt scenarie igen, og få resultatet gennemgået uafhængigt. Under **Modelkontrol efter publicering** kan den person, der publicerede ændringen, registrere den aktuelle gennemgang, når alle scenarier er gennemgået. Et gennemgået scenarie, som ikke består, giver en hold-markering. Manglende eller ændret testgrundlag kræver en ny kontrol. Registreringen lader den aktuelle modelrouting fortsætte. Brug den separate pausefunktion, hvis arbejdet skal stoppe, og gennemgå en kvalificeret erstatning eller tilbagerulning, før du publicerer endnu et modelskift.
