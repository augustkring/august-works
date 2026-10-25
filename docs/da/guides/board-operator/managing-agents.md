---
help_article_id: working-with-coworkers-da
title: Arbejd med Co-workers
summary: Tilføj en Co-worker, kontrollér dens status, og styr hvornår den kan modtage arbejde
audience: company-administrators
product_capability_refs: [V10-103]
screen_contract_refs: [SETTINGS-AGENTS-AI, AGENT-MONITOR, AGENT-CHANGE]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i Co-worker-opsætning, kontoforbindelser, status, pause eller opgavefordeling
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Agents.tsx, ui/src/pages/AgentDetail.tsx, server/src/services/agents.ts]
---

Blentera kalder virksomhedens arbejdere for **Co-workers**. Nogle af de nuværende skærmbilleder bruger stadig betegnelsen **Agent**. Find dem under virksomhedens område for agenter, og åbn en Co-worker for at gennemgå dens indstillinger, forbindelse og seneste arbejde.

## Tilføj eller opdatér en Co-worker

Brug tilføj-handlingen i agentområdet, og udfyld felterne for rolle, instruktioner og AI-forbindelse. De tilgængelige indstillinger afhænger af forbindelsen og din instans. Kontrollér, hvem der kan bruge en delt forbindelse, og hvilke handlinger der kræver gennemgang, før du gemmer. En gemt adgang kan senere kræve genforbindelse, hvis udbyderen udløber eller tilbagekalder adgangen.

Åbn Co-workerens detaljeside for at se dens status og seneste opgavekørsler. Læs den præcise fejl eller opsætningsbesked. En Co-worker, der er markeret som klar til at modtage arbejde, er ingen garanti for, at en bestemt kørsel hos en udbyder lykkes.

## Sæt fremtidigt arbejde på pause

Sæt en Co-worker på pause, hvis den ikke skal modtage nye planlagte eller tildelte opgaver. At sætte en Co-worker på pause og at stoppe en igangværende kørsel er to forskellige handlinger. Åbn den aktive opgave, og brug den aktuelle kørsels-handling dér. Se [Gennemgå godkendelser og stop arbejde](/da/guides/board-operator/approvals).

Når du tildeler arbejde, skal du gennemgå opgavens instruktioner, ejer og projekt. Opgavesiden viser dens aktuelle status og registrerede resultat. Co-workerens status alene bekræfter ikke, at opgaven er færdig.

Se [Personer og virksomhedsadgang](/da/guides/board-operator/org-structure) for virksomhedens medlemmer og deres adgang. Se [Genoptag afbrudt arbejde](/da/help/recovering-work), hvis en opgave ikke blev færdig.
