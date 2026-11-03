---
title: "Tillid og dokumentation"
description: "Sikkerhed, privatliv, AI, tilgængelighed, servicestatus og aktuel dokumentation."
document_id: "blentera-trust-overview-da"
owner: "Blenteras sikkerheds- og privatlivsansvarlige"
version: "1"
effective_at: "2026-10-27"
customer_visibility: "public"
nda_required: false
last_reviewed_at: "2026-10-27"
next_review_or_trigger: "2027-01-25; tidligere ved væsentlige ændringer i behandling, udbydere, sikkerhed eller produktet"
superseded_by: null
evidence_scope: "Produktdokumentation; konkrete driftsforhold kræver særskilt aktuel dokumentation"
evidence_refs:
  - "SECURITY.md"
  - "packages/shared/src/product-identity.ts"
  - "docs/da/help/export-and-delete.md"
  - "doc/operations/service-health/README.md"
---

Blenteras generelle kontakt er [hello@blentera.com](mailto:hello@blentera.com).
Brug [security@blentera.com](mailto:security@blentera.com) til sikkerhedsspørgsmål
og [privacy@blentera.com](mailto:privacy@blentera.com) til privatlivshenvendelser.

Denne oversigt er gennemgået i forhold til produktdokumentationen den
**27. oktober 2026**. Den er ikke en driftsrevision, en juridisk aftale eller en
certificering. Bed om aktuel dokumentation for den konkrete installation,
udbyder og behandling, før du bruger oplysningerne i en indkøbs- eller
behandlingsbeslutning.

## Sikkerhed og indberetning af sårbarheder

Adgang til en virksomheds arbejde styres af aktuelt medlemskab, rettigheder og
de relevante godkendelsespolitikker. En Co-workers identitet, en
værktøjsbeskrivelse eller navnet på en forbindelse giver ikke i sig selv adgang.
Kvalificeringen af runtime og hosting gælder bestemte anvendelser; de samme
kontroller kan ikke uden videre antages at gælde for alle runtimes.

Følg [politikken for koordineret offentliggørelse](/da/trust/vulnerability-disclosure)
ved en sårbarhed. Appens maskinlæsbare sikkerhedskontakt findes på
[/.well-known/security.txt](https://app.blentera.com/.well-known/security.txt).
Filen har en udløbsdato. Offentliggørelsen beviser ikke i sig selv, at postkassen
eller processen for hændelseshåndtering er afprøvet i drift.

## Privatliv, regioner og underdatabehandlere

Hosting, modelbehandling, tilknyttede Apps, telemetri, Support-adgang og
backupopbevaring er forskellige behandlingsforhold. Hosting i én region
betyder ikke, at alle udbydere behandler alle data i den region.

Denne oversigt offentliggør ikke en godkendt regions- eller
underdatabehandlerliste for en konkret installation. Bed
[privacy@blentera.com](mailto:privacy@blentera.com) om den aktuelle
privatlivsmeddelelse, databehandleraftale, underdatabehandlerliste og beskrivelse
af hosting og backup, før du baserer en beslutning på bestemte forhold. En
privatlivsmeddelelse er ikke samtykke til valgfri deling eller markedsføring.

## Ansvarlig AI

Co-workers arbejder inden for de relevante rammer for menneskeligt ansvar,
rettigheder, budget, godkendelser og kildeadgang. Memory og hentet materiale er
dokumentation, ikke tilladelse til at udvide beføjelser. Kontroller udbyderens,
modellens og runtime-profilens egnethed til det konkrete arbejde. En alternativ
udbyder eller model skal opfylde de samme relevante krav til behandling og adgang.

Bed om installationens aktuelle AI-transparens og governance-dokumentation ved
vurdering af en konkret anvendelse. Henvisninger til AI-forordningen eller en
standard dokumenterer ikke i sig selv overholdelse.

## Tilgængelighed

Blenteras produktarbejde sigter mod tilgængelig brug af tastatur, fokus,
sprogvalg og hjælpeteknologi. Automatiske kontroller dækker et begrænset udvalg
af forløb. Denne side hævder ikke en uafhængig tilgængelighedsrevision eller
universel WCAG-overensstemmelse. Beskriv en barriere til
[support@blentera.com](mailto:support@blentera.com), gerne med den berørte visning,
browser og hjælpeteknologi. Medsend ikke privat arbejde eller adgangsoplysninger.

## Eksport, sletning og kontinuitet

Se [eksport og sletning](/da/help/export-and-delete) for de understøttede konto-
og virksomhedsforløb. Omfang, adgang, bevarede registreringer og eventuelle
ukendte udfald har betydning. En gemt anmodning beviser ikke, at enhver sletning
eller ekstern effekt er gennemført.

Bed om aktuel dokumentation for backup, gendannelse, driftskontinuitet og
beredskab i den installation, du bruger. Denne side lover ikke en universel
gendannelsestid, et bestemt gendannelsespunkt, en backupregion eller en
opbevaringsperiode.

## Servicestatus

Den uafhængige [Blentera-statusside](https://status.blentera.com) viser
publicerede opdateringer om funktioner, driftsforstyrrelser og planlagt
vedligeholdelse. Brug sidens abonnement og historik til udbyderens
notifikationer og tidligere opdateringer. Status i appen er en projektion af
denne kommunikation og ændrer ikke en Tasks eller kørsels faktiske tilstand.
Menneskelig Support er fortsat tilgængelig.

## Dokumentation og certificeringer

Ingen certificering eller revisionsrapport er angivet som aktuel i denne
oversigt. Det betyder ikke, at en bestemt rapport findes, eller at en
certificering er opnået. Bed
[hello@blentera.com](mailto:hello@blentera.com?subject=Dokumentationsanmodning) om
aktuel godkendt dokumentation med omfang, ansvarlig, version, gennemgangsdato
og udløb.

Afhængigt af anmodningen og den tilgængelige dokumentation kan materialet omfatte
en revisionsrapport, et resumé af en penetrationstest, kontinuitets- og
gendannelsesbeviser, et sikkerhedsspørgeskema, en leverandør- og regionsoversigt
eller en arkitekturbeskrivelse. Begrænset materiale kan kræve en
fortrolighedsaftale og en autoriseret gennemgang. En anmodning giver ikke i sig
selv adgang. Udløbet eller erstattet dokumentation må ikke præsenteres som aktuel.
