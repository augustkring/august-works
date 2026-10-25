---
help_article_id: people-and-company-access-da
title: Personer og virksomhedsadgang
summary: Invitér medlemmer, gennemgå anmodninger om adgang, og ændr eller fjern adgang
audience: company-administrators
product_capability_refs: [V10-159]
screen_contract_refs: [SETTINGS-PEOPLE-ACCESS]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i virksomhedsmedlemmer, invitationer, adgangsanmodninger, rolle, status eller omfordeling
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/CompanyAccess.tsx, ui/src/components/access/InvitesSection.tsx, ui/src/components/access/CompanySettingsNav.tsx]
---

Åbn **Company settings → Members** for at se, hvem der har adgang til den valgte virksomhed. De kontroller, du kan bruge, afhænger af din virksomhedsrolle og af, hvilke indstillinger instansadministratoren har gjort tilgængelige.

## Invitér, eller gennemgå en anmodning om adgang

Åbn fanen **Invites** for at oprette eller administrere en invitation, hvis den er tilgængelig for dig. Inviterede personer bruger invitationslinket til at blive medlem. De tilladte tilmeldingstyper og standardrollen vises i invitationens indstillinger. Nogle instanser har også et særskilt invitationslink fra hostingplatformen.

Hvis en anmodning om adgang kræver godkendelse, skal du gennemgå den under Members, før du godkender eller afviser den. En invitation eller anmodning om adgang er ikke det samme som aktiv virksomhedsadgang.

## Ændr et medlems adgang

Brug medlemmets redigeringshandling til at ændre den rolle eller status, siden tilbyder. Kontrollér den viste rolle og status, før du gemmer. Et suspenderet eller fjernet medlem kan miste adgangen til virksomhedens indhold og handlinger.

Før du fjerner et medlem, skal du gennemgå valgene for omfordeling. Siden kan vise opgaver, der er tildelt personen, og rutiner, som vedkommende ejer. Vælg, hvad der skal ske med dem, før du bekræfter fjernelsen. Kontrollér de nye ejere og statusser bagefter.

Virksomhedsmedlemskab er adskilt fra en Co-workers plads i teamet. Se [Arbejd med Co-workers](/da/guides/board-operator/managing-agents) for arbejderstatus og [Eksport og sletning](/da/help/export-and-delete) for sletning af konto eller virksomhed.
