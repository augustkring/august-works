---
help_article_id: workflows-preview-da
title: Brug Workflows
summary: Gennemgå et workflowudkast, test det, og publicér først, når trinnene er klar
audience: company-administrators
product_capability_refs: [V10-152, V10-027]
screen_contract_refs: [WORKFLOW, WORKFLOW-DESCRIBE, WORKFLOW-REVIEW, WORKFLOW-TEST, WORKFLOW-PUBLISH, WORKFLOW-RECOVER]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-29
review_trigger: Ændringer i workflowredigering, understøttede trin, test, publicering, kørsel eller genopretning
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Workflows.tsx, ui/src/pages/WorkflowRun.tsx, ui/src/pages/WorkflowDescribe.tsx, ui/src/pages/WorkflowBuilder.tsx, ui/src/pages/WorkflowReview.tsx, server/src/routes/workflows.ts, server/src/services/workflows/workflow-node-registry.ts, server/src/services/workflows/workflow-service.ts, ui/src/pages/CompanyAccess.tsx, ui/src/pages/IssueDetail.tsx, server/src/routes/access.ts, server/src/services/access.ts, server/src/services/workflows/workflow-executor.ts, packages/shared/src/validators/access.ts, packages/db/src/schema/workflows.ts]
---

Workflows er kun tilgængelige, når de er slået til for virksomheden og instansen. Hvis du ikke kan se **Workflows**, skal du spørge instansadministratoren, om funktionen er tilgængelig.

## Kladde, test og publicering

Åbn **Workflows** for at se de workflows, du har adgang til. Opret eller åbn en kladde, og gennemgå trinnene samt de oplysninger, hvert trin bruger. Redigeringen kan tillade, at du gemmer en kladde, selv om et trin endnu ikke kan køres.

Brug de tilgængelige test- og gennemgangshandlinger før publicering. Læs resultatet og eventuelle blokeringer. Et trin, der kun er til kladdebrug eller ikke er tilgængeligt, bliver ikke automatisk kørselsklart, fordi det vises i redigeringen. Ret eller fjern trin, der ikke understøttes, før du publicerer.

Publicering gør en bestemt gennemgået revision klar til kørsel. Kontrollér udløseren, input, handlinger og godkendelser, som vises i publiceringsforløbet. Ændringer i kladden efter publicering ændrer ikke den allerede publicerede revision. Publicér den opdaterede kladde, når den er klar.

## Gennemgå kørsler

Åbn et workflows kørselsoversigt for at se den aktuelle status og trindetaljer. En kørsel kan vente på en opgave, godkendelse, forsinkelse eller anden understøttet betingelse. Brug kun kørsels egen genoprettelses- eller stophandling, når den vises. Opret ikke en dubletkørsel, blot fordi et svar blev afbrudt. Kontrollér først, om den oprindelige kørsel blev accepteret.

Hvis kørslen venter på et underordnet workflow, kan den person, der startede den, få vist **Fortsæt eksisterende kørsel**. Handlingen kontrollerer den oprindelige gemte anmodning og den aktuelle adgang og fortsætter derefter den samme kørsel, når det underordnede resultat er tilgængeligt. Den opretter ikke en ny underordnet kørsel. Hvis fortsættelsen afvises, skal du opdatere kørslen og kontrollere adgang, dækning og publiceret version, før du prøver igen.

Funktionen er i forhåndsvisning, og de tilgængelige trin afhænger af det aktuelle register og din installation. Tekniske detaljer findes i den engelske [Workflow API-reference](https://docs.blentera.com/api/workflows).

## Midlertidig workflow-dækning

Vælg **Midlertidig workflow-dækning** i virksomhedens adgangsindstillinger. Vælg en anden aktiv Human, en publiceret workflow-version samt start- og udløbstidspunkt. Vælg manuelle starter eller én synlig Task, og angiv en begrundelse. Dækningen kan vare op til 30 dage. Begge personer skal allerede have de nødvendige aktuelle rettigheder og adgang til opgaven.

Den anden person kan vælge din dækning, når workflowet startes fra redigeringen eller den valgte Task. Kørslen registrerer den person, som faktisk starter den. Adgangen og tidsvinduet kontrolleres igen, når en kørsel i kø skal startes, og før et vellykket underordnet resultat genoptager en ventende kørsel. Udløbet eller tilbagekaldt dækning kan ikke give adgang til fortsættelsen.

Dækningen gælder den valgte publicerede version. Gennemgå og opret ny dækning, hvis en anden version publiceres. Tilbagekald dækningen i adgangsindstillingerne for at afslutte den før tid. Fjernelse af en nødvendig rettighed, lukning af kontoen eller gendannelse af databasen gør tidligere dækning ugyldig. Opret en ny aftale, når den aktuelle adgang og version er gennemgået.
