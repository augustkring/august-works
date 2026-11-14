---
help_article_id: approvals-and-stop-da
title: Gennemgå godkendelser og stop arbejde
summary: Undersøg en anmodning, registrér en beslutning, eller stop en aktiv opgavekørsel
audience: company-administrators
product_capability_refs: [V10-032]
screen_contract_refs: [APPROVAL-CARD, WORK]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i godkendelsesbeslutninger, stopkontroller for aktive opgaver eller kørselsresultater
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/Approvals.tsx, ui/src/pages/ApprovalDetail.tsx, ui/src/pages/IssueDetail.tsx]
---

En godkendelse er en anmodning om en beslutning. Åbn **Approvals** for at gennemgå de ventende anmodninger, du har adgang til. Åbn derefter en anmodning for at læse dens detaljer og tilknyttede arbejde, før du beslutter dig.

## Registrér en godkendelsesbeslutning

Anmodningssiden kan vise **Approve**, **Reject** eller **Request revision**. Vælg ud fra den anmodning, der vises. En anmodning om ændringer sender elementet tilbage til rettelse; den godkender ikke handlingen. Kontrollér status på godkendelsessiden efter indsendelse.

Nogle apphandlinger har deres egen adgangsgennemgang under **Apps**. Kontrollér udbyder, konto, tilladelser og handlingens omfang dér. En appforbindelse eller godkendelse af én handling godkender ikke automatisk en anden handling.

## Sæt opgavearbejde på pause, eller stop det

Åbn opgaven for at finde kontrollerne til dens aktive kørsel. Afhængigt af den aktuelle status kan du se **Pause work**, **Stop and done** eller **Stop and cancel**. Pause styrer den aktive kørsel; at markere opgaven som færdig eller annulleret er en særskilt opgavestatus. Læs hver handlings betegnelse og opgavens aktuelle status, før du bruger den.

Vent, indtil opgavesiden viser den nye kørsels- og opgavestatus. Hvis resultatet af et stop eller en beslutning er ukendt, skal du genindlæse den oprindelige opgave eller godkendelse og kontrollere dens status, før du gentager handlingen. Se [Genoptag afbrudt arbejde](/da/help/recovering-work) for de næste sikre trin.
