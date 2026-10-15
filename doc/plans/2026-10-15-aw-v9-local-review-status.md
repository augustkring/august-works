# August Works V9 — lokal reviewstatus 15. oktober 2026

> Historisk status ved checkpoint88, før publicering. PR #38 er siden opdateret
> og åbnet for review. Checkpoint89–92 i hovedledgeret beskriver recoveryrettelser,
> fuld lokal type/build-verifikation og aktuel CI-triage. Produktionskoden er
> publiceret; ingen samlet ny CI- eller V9-releaseaccept udledes af denne ældre
> status. Den aktuelle backlog er 96 in_progress / 24 not_started.

De samlede lokale ændringer er klar til gennemgang i den eksisterende draft-PR
#38. Hele V9 er **ikke færdig eller releasegodkendt**. Readiness er fortsat
`R0_SPECIFIED`, `sourceComplete=false`, uden accepterende person/releaseidentitet.
Ingen push, PR-oprettelse/-opdatering, merge, deployment eller reel providerafsendelse
er udført i denne arbejdsgang.

Produktionskoden er checkpoint86 `1fa1957a60a9bb9347f0faa8c6fed8d2fdbf1b4f`.
Checkpoint87 `b1a7cc9cd61e737b7bdb492f80f8d3b1396f8f4a` ændrer kun en CLI-testfixture
og dokumentation. Denne statusopfølgning ændrer kun dokumentation. De tidligere
checkpoints og oprindelige fejl er bevaret; testtal nedenfor må ikke lægges sammen
ukritisk, fordi målrettede kørsler overlapper de brede.

## Den seneste implementering

- Personlige, virksomhedsafgrænsede Slack-/Teams-notifikationer går gennem den
  eksisterende Native provider-effect-kø. Aktuel bruger, verificeret privat
  identitet, modtageradgang, credential/runtime-generation og tidsplan kontrolleres
  før afsendelse. Der oprettes ingen Task eller erstatnings-outbox.
- Valget kræver et aktuelt, eksplicit review og har versioneret, idempotent
  Original-kvittering. En gemt præference beviser ikke levering eller ny adgang.
  Usikker accept genafsendes ikke automatisk; digest/tidsudsættelse blokerer ikke
  allerede klar køarbejde.
- Utilgængelige destinationer giver ingen stiltiende email-fallback. Obligatorisk
  sikkerhedsmail beholder sin oprindelige ejer. Midlertidige kommandometadata
  udløber uafhængigt af rollout-flaget. Flaget er fortsat slået fra som standard.
- Et eksisterende valg kan nulstilles efter rollback og genindlæsning. Et
  ubekræftet reset bevarer sin præcise anmodning gennem genvalidering. Nye mål og
  levering forbliver under det oprindelige flag og Native adgangskontrol.
- De tidligere rettelser omfatter bl.a. samme-person draft-kontinuitet,
  target-bundet retry, publikationskvitteringer, tilgængelige datatabeller og
  håndtering af afviste asynkrone runtime-diagnostikker. Det daterede hovedledger
  beskriver hele den øvrige V9-implementering; dette er en opfølgning på den.

## Verificeret software

| Kontrol | Resultat og præcis afgrænsning |
|---|---|
| Hele workspace-typecheck og produktionsbuild | Begge exit 0 på checkpoint86 |
| Aktuel V9-browserkørsel | 91/91, exit 0 på checkpoint86; tidligere 87/4-crash-kørsel bevaret som fejlet |
| Serverede produktionsaktiver | 514 filer byte-identiske med de 514 filer fra den beståede build |
| Bred UI | 806 suiter / 7.951 cases på checkpoint85 |
| Berørt UI/API efter rollback-fix | 31 cases på checkpoint86; overlapper den brede UI-kørsel |
| Hele CLI og opfølgende CLI-typecheck | 63 suiter / 502 cases og typecheck exit 0 på checkpoint87 |
| Øvrige 12 workspace-pakker | 4.007 cases bestået / 12 eksplicitte skips på checkpoint83 |
| Isolerede rute-/authz-suiter | Alle 160 dækket: 81 i én kørsel; 79 via 41 byte-identiske tidligere passes og 38 registrerede fortsættelser |
| Generel servergruppe 0 | 455 suiter bestået / 5 skipped; 6.435 cases bestået / 42 skipped på checkpoint83 |
| Generel servergruppe 1 | 460 suiter og 9.757 cases bestod på checkpoint84. Én setup-suite fejlede; dens uændrede tre cases bestod separat på checkpoint87 med samme 20s setup-grænse. Dens tre oprindelige setup-skips er ikke reelle platform-skips. |
| General1-kildekompatibilitet | 462/463 testfiler byte-identiske; den ændrede notification-fil er særskilt verificeret med alle 11 cases |
| Native chat-integration | Alle 1.048 cases: fire kontrollerede partitioner à 262. De 786 øvrige cases pr. delkørsel er filterudelukkelser, ikke passes eller platform-skips. |
| Notification-kontrakt/API/UI/log | 61 målrettede cases på checkpoint83; senere berørte cases verificeret særskilt |
| Native notification-ejer | 11 faktiske PostgreSQL-cases på checkpoint86; providertransport i øvrige køtests er simuleret |
| Database | 499 SQL-migrationer til og med 0500 anvendt i disponible PostgreSQL-fixtures; ingen produktionsdatabase ændret; ingen skemadrift efter den nye migration |
| Tokens/kildekontrakter | Bestået. Release-gaten fejler fortsat som forventet. |

Den samlede testkatalogdækning er en dokumenteret sammensætning af checkpoints og
fortsættelser, **ikke** én fejlfri aktuel `pnpm test:run`-kommando. Manifestkontrol
viser 160 isolerede suiter og 923 øvrige serversuiter uden overlap/huller;
chatfilen dækkes særskilt. Native Runner-koden er uændret siden dens tidligere
138-case diagnostik-regression; det er historisk evidens, ikke en ny måling.

De oprindelige worker-, setup-, Corepack-, fixture- og browserfejl er bevaret.
En hierarkisk OOM-tæller identificerer ikke i sig selv årsagen til en worker- eller
browserafbrydelse. Den ekstra eksplicit afbrudte typekontrol tæller ikke som pass,
selv om dens wrapper gav 0. Den senere komplette type/build-kørsel afsluttede normalt
med 0. Ingen adfærdsdeadlines eller produktions-rate-limit-regler blev lempet.

## Hvad mangler i hele V9

Alle 70 launch-evidensrækker er fortsat åbne. Den brede backlog er 95 `in_progress`
og 25 `not_started`; det er arbejdsstatus, ikke en færdiggørelsesprocent eller
bevis for 25 helt fraværende funktioner.

- Resterende komplet kanal-/kortparitet, recovery-/attention-dækning og
  konvergens af de kanoniske kundesurfaces skal gennemgås mod briefet. Eksisterende
  Native funktioner må ikke erklæres fraværende alene ud fra backlogetiketter.
- Legacy-/`.production`-varianter og gamle onboarding-/shell-flags skal beholdes,
  indtil faktisk brug, semantisk/tilgængelighedsmæssig paritet, migration og
  deep-link/regressionsaccept er bevist. 23 produktions-/legacy-par har faktiske
  callers; navne/visuel lighed er ikke et slettekriterium.
- Reelle Free Core/model-/host-/managed-agent- og Slack/Teams/email-forløb,
  migration/rollback/restore samt hele performance-/fault-budgettet mangler
  kvalificeret ekstern evidens. Lokale fake-provider- og browserfixtures tæller
  ikke som dette.
- Manuel WCAG/assistive-technology-kontrol og repræsentative exploratory/
  confirmatory brugerstudier for de kritiske journeys mangler. Fjorten journeys
  betyder ikke fjorten gennemførte Human-deltagere.
- En kvalificeret usable-account-baseline og de resterende opmærksomheds-/effort-
  målinger mangler; virksomhedens oprettelse eller første sidevisning må ikke
  bruges som opdigtet TTFO-baseline. Ukendte målinger skal forblive ukendte.
- MCP Apps produktionshost/Tool Gateway-integration og optional PostHog-adapter
  er separate, gated arbejdsområder. Prototype eller default refusal beviser
  ikke en aktiveret produktionsintegration.
- Aktuel GitHub-CI og uafhængig review mangler for den lokale opfølgning. Draft-PR
  #38 peger fortsat på en ældre publiceret kilde, indtil en eksplicit PR/push-
  handling udføres.

## Playbooks og videre arbejde

Build brief og alle 39 playbooks ligger i reference-registeret; alle 40 filers
byteantal/SHA-256 matcher de vedhæftede kilder. `AGENTS.md` kræver fortsat relevante
playbooks ved senere ændringer. Briefet er læst direkte i sin helhed; playbooks er
strukturelt gennemgået, kerneprincipper og relevante specialistafsnit læst direkte.
Det er ikke en påstand om linje-for-linje-læsning af alle 39 playbooks. Indlejrede
instruktioner er referencekrav, ikke selvstændig autorisation til at publicere,
kontakte andre, bruge penge eller give adgang.

Den samlede maskinlæsbare lokale verifikation ligger i arbejdsgangen som
`/workspace/aw-v9-local-review-verification-20261015.json`. Reviewkladden følger
repoets PR-template. Ingen ny releaseaccept eller samtykke udledes af denne status.
