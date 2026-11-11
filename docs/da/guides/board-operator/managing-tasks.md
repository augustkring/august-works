---
help_article_id: create-and-track-work-da
title: Opret og følg arbejde
summary: Opret en opgave, vælg en ejer, og kontrollér dens aktuelle status
audience: company-members
product_capability_refs: [V10-032]
screen_contract_refs: [WORK]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-11-11
review_trigger: Ændringer i oprettelse af opgaver, fordeling, chatplan-overdragelse, afgrænsede Orchestration-planer, status, kommentarer eller kørselsdetaljer
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/ExperienceWork.tsx, ui/src/pages/IssueDetail.tsx, server/src/services/agent-conversations.ts, server/src/services/heartbeat.ts, ui/src/pages/Orchestration.tsx, ui/src/i18n/experience/da.json]
---

Opgaver er virksomhedens arbejdsemner. Åbn **Work** for at finde de opgaver, du har adgang til, eller åbn en opgave for at se beskrivelse, ejer, status, kommentarer og aktivitet.

Vælg **Spørg Blentera** for at åbne chatten med din foretrukne Co-worker, hvis du har valgt en, eller vælg en Co-worker.

Du kan vedhæfte en fil i din egen chat, før du sender den første besked, og tilføje flere filer senere. Du skal stadig have adgang til samtalen og dens filer.

Hvis en Co-worker stiller et spørgsmål eller viser et bekræftelseskort, kan du svare eller acceptere/afvise i chatten. En plan, der er ændret, kræver sin aktuelle bekræftelse. Dit svar eller din godkendelse betyder ikke i sig selv, at arbejdet er færdigt.

## Opret en tydelig opgave

Skriv det ønskede resultat i titlen, og tilføj derefter den sammenhæng og de acceptkriterier, som den ansvarlige skal bruge. Vælg et projekt eller en overordnet opgave, hvis arbejdet hører til en eksisterende indsats. Vælg først en ejer, når du har kontrolleret, at personen eller Co-worker er passende til opgaven.

En opgave, du opretter under en eksisterende overordnet opgave eller et projekt, beholder arbejdets adgangsbegrænsninger. Skriv de instruktioner, den nye opgave har brug for. En opgave fra chatten kan bruge et eksisterende projekt uden at oprette et nyt.

## Gennemgå overdragelsen fra en godkendt chatplan

Når du godkender en plan i en Co-worker-chat, godkender du kun overdragelsen. Co-worker opretter almindelige tildelte opgaver i **Backlog** med den relevante del af den godkendte plan i hver opgaves plandokument. Opgaverne startes ikke, og godkendelsen godkender eller starter ikke den separate udførelsesplan for hver opgave. Den oprindelige chat forbliver tilgængelig til dialog.

Før arbejdet sættes i kø, skal du åbne hver opgave og gennemgå omfang, krævet resultat, tilsigtet handling og risiko samt grænser for model, værktøjer og tid. I **Orchestration** skal du angive den maksimale modelpris i mindste valutaenheder (0–1.000.000) og derefter gemme og starte den afgrænsede plan. En opgave i **Backlog** forbliver inaktiv. Flyt den til **Klar til start** (**To do**) først, når planen er klar til at sætte den tildelte Co-worker i kø.

Når en kørsel lykkes, skal du kontrollere det faktiske resultat mod den ønskede leverance og gennemføre eventuel påkrævet godkendelse. En vellykket kørsel beviser ikke i sig selv, at resultatet er fuldført. Lad en opgave blive i **Til gennemgang** (**In review**), mens din gennemgang afventer. Hvis det godkendte omfang ændres, skal du indhente en aktuel godkendelse, før det ændrede arbejde overdrages.

Opgavesiden viser den aktuelle status. En tildeling eller statusændring beviser ikke i sig selv, at en Co-worker er begyndt, eller at resultatet er færdigt. Læs opgavens aktivitet og output, før du lukker den.

## Følg fremskridtet

Brug opgavens kommentarer og aktivitet til at følge opdateringer. Hvis arbejdet er blokeret, skal du læse årsagen og løse afhængigheden, hvis du kan. Åbn de kørsels- eller genoprettelsesdetaljer, der vises på opgaven, for at se, om arbejdet stadig kører, venter, er stoppet eller fejlede.

Hvis resultatet af en start, et nyt forsøg eller et stop er uklart, skal du kontrollere den oprindelige opgave, før du gentager handlingen. Se [Genoptag afbrudt arbejde](/da/help/recovering-work) og [Gennemgå godkendelser og stop arbejde](/da/guides/board-operator/approvals).

Hvis **Workflows** er slået til for virksomheden, kan du se [Brug Workflows](/da/help/workflows-preview) for den separate proces til kladde, test og publicering.
