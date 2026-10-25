---
help_article_id: recovering-work-da
title: Genoptag afbrudt arbejde
summary: Kontrollér opgavens aktuelle status, og brug den viste næste handling sikkert
audience: company-members
product_capability_refs: [V10-161]
screen_contract_refs: [WORK]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i opgavekørselsstatus, planlagt nyt forsøg, stop, fortsættelse eller genopretning
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/IssueDetail.tsx, ui/src/components/IssueBlockedNotice.tsx, ui/src/lib/wait-for-stopped-runs.ts, server/src/services/issue-recovery-actions.ts, server/src/services/issues.ts, server/src/services/routines.ts, server/src/services/scheduled-work.ts, server/src/routes/issues.ts, server/src/services/execution-workspaces.ts, server/src/services/heartbeat.ts, server/src/services/workspace-runtime.ts, server/src/services/managed-repository-checkout.ts, server/src/services/git-credentials.ts]
---

Når en opgave ikke længere gør fremskridt, skal du åbne den oprindelige opgave og kontrollere dens aktuelle status, aktivitet, kørselsoversigt og besked om næste trin. Et fejlslagent svar i browseren betyder ikke altid, at opgaven fejlede. Serveren kan have accepteret den oprindelige handling.

## Kontrollér, før du prøver igen

Læs den seneste kørsel og eventuelle blokeringer eller genoprettelsesbeskeder. Løs den nævnte forbindelse, godkendelse, ejer eller anden forudsætning, hvis du kan. Brug kun handlingen til et nyt forsøg, hvis den vises for den pågældende opgave og aktuelle status. Hvis der ikke vises en sådan handling, skal du bede opgavens ejer eller en administrator gennemgå kørslen, før du opretter erstatningsarbejde.

Hvis et planlagt nyt forsøg vises, skal du kun bruge opgavens **Retry now**, hvis du vil fremrykke det eksisterende forsøg. Handlingen opretter ikke en separat opgave. Kontrollér status igen, når handlingen er færdig.

Hvis en Co-workers opdatering afvises, fordi adgangen til dens begrænsede kilder ikke kan bevares, forbliver opgavens eksisterende indhold uændret. Behold den oprindelige opgave, og bed dens ejer eller [menneskelig support](/da/help/index) gennemgå afvisningen, før du gentager opdateringen.

En planlagt kørsel kan blive sprunget over, hvis de gemte kilder ikke længere er tilgængelige for den ansvarlige person. Bed kildens ejer gennemgå adgangen, før du ændrer tidsplanen eller forsøger igen.

## Kontrollér adgangen til det gemte arbejdsområde

Hvis en opgave ikke kan genåbne sit gemte arbejdsområde, skal du bede en projektejer kontrollere din aktuelle adgang, det gemte repository og dets forbindelse. Opgaven kan forblive lukket, mens disse forudsætninger mangler. Gå tilbage til den oprindelige opgave, når adgangen er gendannet, og kontrollér den seneste kørsel, før du prøver igen.

Hvis den gemte kilde eller historik ikke kan gendannes, skal du kontakte [menneskelig support](/da/help/index) med opgave-id’et og beskeden på skærmen.

Hvis oprydningen af arbejdsområdet melder, at filer er bevaret, skal du bede projektejeren gennemgå dem, før du fjerner arbejdsområdet.

## Mens et stop afventer

Lad opgaven stå åben, mens stophandlingen afventer. Vent, indtil kørsels- og opgavestatus opdateres. Hvis siden melder om et ukendt resultat, skal du genindlæse den oprindelige opgave og gennemgå den seneste kørsel, før du sender en ny instruktion eller starter erstatningsarbejde.

Ved en uløst fejl kan du kontakte [menneskelig support](/da/help/index) med opgave-id'et og den ikke-hemmelige besked på skærmen. Medtag ikke adgangsoplysninger eller private opgaveoplysninger, som modtageren ikke har adgang til.
