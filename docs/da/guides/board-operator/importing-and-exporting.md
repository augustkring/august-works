---
title: Importér og eksportér virksomheder
summary: Forhåndsvis, importér, og genopret en virksomhedspakke på en sikker måde
help_article_id: company-import-export-da
audience: company-administrators
product_capability_refs: [V10-021, V10-022, V10-023]
screen_contract_refs: [CompanyImport]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: da
last_verified_at: 2026-10-25
review_trigger: Ændringer i importkilde, kvittering, genopretning, autorisation eller opbevaring
security_or_privacy_sensitive: true
linked_source_files: [ui/src/App.tsx, ui/src/pages/CompanyImport.tsx, ui/src/pages/CompanyImportHistory.tsx, server/src/routes/companies.ts, server/src/services/company-import-jobs.ts, server/src/services/company-import-transfers.ts, server/src/services/company-portability.ts, server/src/services/company-export-readme.ts, packages/shared/src/customer-operations.ts, packages/shared/src/company-import-transfer.ts, cli/src/commands/client/company.ts, server/src/errors.ts, packages/shared/src/types/company-portability.ts, server/src/services/github-fetch.ts]
---

Blentera-virksomheder kan eksporteres som flytbare Markdown-pakker og importeres fra lokale mapper eller GitHub-arkiver. Det gør det muligt at dele virksomhedsopsætninger, kopiere opsætninger og versionsstyre agentteams.

## Pakkeformat

Eksporterede pakker følger den engelske [Agent Companies-specifikation](https://docs.blentera.com/companies/companies-spec) og bruger en struktur baseret på Markdown:

~~~text
my-company/
├── COMPANY.md          # Virksomhedsmetadata
├── agents/
│   ├── ceo/AGENT.md    # Agentinstruktioner og frontmatter
│   └── cto/AGENT.md
├── projects/
│   └── main/PROJECT.md
├── skills/
│   └── review/SKILL.md
├── tasks/
│   └── onboarding/TASK.md
└── .paperclip.yaml     # Adapteropsætning, miljøinput og rutiner
~~~

- **COMPANY.md** indeholder virksomhedens navn, beskrivelse og metadata.
- **AGENT.md**-filer indeholder agentidentitet, rolle og instruktioner.
- **SKILL.md**-filer er kompatible med Agent Skills-økosystemet.
- **.paperclip.yaml** indeholder valgfri Paperclip-specifik opsætning såsom adaptertyper, miljøinput og budgetter.

## Eksport og import i appen

Begge forløb findes også som sider under virksomhedens indstillinger: **Export** og **Import** vises i navigationen for virksomhedsindstillinger.

> **Instanser administreret af en cloudplatform:** Platformen opretter virksomheden, og import er slået fra. Importsiden og dens knapper skjules, og alle import-API-ruter svarer med 403 og code: cloud_managed. Eksport er fortsat tilgængelig afhængigt af din aktuelle adgang og eksportens detaljerapport. Selvhostede instanser beholder importmuligheden.

På siden **Export** kan du vælge præcis, hvilke filer der skal med i pakken. Over filtræet vises panelet **Not included in this export** — eksportens detaljerapport — med data, som pakken ikke medtager, for eksempel vedhæftninger, godkendelser, omkostningshistorik eller aktivitetslog. Blokerende problemer fremhæves.

På siden **Import** kan du forhåndsvise pakken, løse navnekollisioner og tildele adaptere, før du gennemfører importen. Afkrydsningsfeltet **Start imported agents and routines paused** er som standard valgt. Det gør, at importerede agenter og rutiner starter på pause. Når importen er færdig, viser panelet **Activate imported agents and routines** de importerede elementer, der er sat på pause, så du selv kan genoptage agenter og aktivere de rutiner, du vælger. Når du beholder afkrydsningen, forbliver de importerede agenter og rutiner på pause, indtil du aktiverer dem.

## Bekræft den gennemgåede pakke

Forhåndsvis pakken, før du importerer. Appen kontrollerer de løste filer igen, før importen gennemføres. Hvis filerne er ændret, skal du åbne en ny forhåndsvisning, gennemgå ændringerne og bekræfte igen.

For GitHub-pakker viser forhåndsvisningen den præcise kildecommit. Alle pakkefiler kommer fra den revision. Hvis grenen flyttes til en anden commit, skal du gennemgå en ny forhåndsvisning, også selv om filerne ser uændrede ud. En ufuldstændig filliste eller en utilgængelig revision stopper forhåndsvisningen. Pakker med uløste undermoduler inde i den valgte mappe understøttes ikke. Brug en pakke, hvor filerne er inkluderet direkte.

Lad **Start imported agents and routines paused** være valgt, mens du gennemgår pakken. En import godkender ikke importerede adgangsoplysninger eller scripts. Gennemgå hver valgt Co-worker og rutine før aktivering.

Opgave- og projektindhold kræver i øjeblikket fortsat adgang til de oprindelige kilder i den virksomhed, indholdet kommer fra. Flytning af sådant indhold til en anden virksomhed kræver et godkendt publiceringsforløb, som importsiden ikke tilbyder. En pakke til en ny virksomhed kan indeholde virksomheds- og Co-worker-opsætning uden disse arbejdsemner. Hvis adgangen til kilden afvises, før importen begynder, er anmodningen afvist; det betyder ikke, at arbejdsemnerne blev kopieret.

## Genopret en afbrudt import

En accepteret import har et gemt operations-id. Når siden genindlæses, kontrollerer den den operation i stedet for at indsende pakken igen. Login som en anden bruger giver ikke adgang til den oprindelige brugers importkvittering.

Hvis en import til en ny virksomhed stadig kører, eller resultatet er ukendt, før målvirksomheden er bekræftet, kan den oprindelige anmoder finde operationen i Import history for en virksomhed, vedkommende aktuelt har adgang til. Indgangen viser **New company, result not yet confirmed**. Den identificerer eller beviser ikke, at en virksomhed er oprettet. Når målet er bekræftet, vises operationen i den pågældende virksomheds historik, hvis du har aktuel adgang.

- **Running:** Vent på den gemte operation. Brug **Annuller import** for at anmode om et sikkert stop. Hvis du forlader siden, fortsætter importen.
- **Annullering anmodet:** Importen stopper ved et kontrolpunkt i den oprindelige importproces. Allerede gennemførte ændringer rulles ikke tilbage. Hvis processen ikke kan bekræfte en fuldstændig annulleringskvittering, forbliver resultatet ukendt og skal afklares.
- **Annulleret:** Annulleringen blev bekræftet, før importændringerne begyndte. Ingen importeffekter blev udført.
- **Complete:** Åbn den importerede virksomhed. Detaljerede navne vises måske ikke længere, men den gemte oversigt identificerer stadig den gennemførte operation, hvis du fortsat har adgang.
- **Rejected before import:** Følg den viste årsag. Hvis pakken er ændret, skal du forhåndsvise de aktuelle filer, før du bekræfter igen.
- **Outcome unknown:** Nogle ændringer kan allerede være gemt. Behold operations-id'et, og kontakt administratoren eller [support](/da/help/index). Upload ikke pakken igen for at undersøge, om den første import lykkedes.

En genstart af serveren bevarer den accepterede operation. Automatisk genafspilning og selvbetjent afklaring af et ukendt resultat er ikke tilgængelige i denne forhåndsvisning. Cachen med fulde detaljer er midlertidig. At den forsvinder, giver ikke tilladelse til at starte importen igen.

## Eksportér en virksomhed med CLI

Eksportér en virksomhed til en flytbar mappe:

~~~sh
paperclipai company export <company-id> --out ./my-export
~~~

### Indstillinger

| Indstilling | Beskrivelse | Standard |
|---|---|---|
| --out <path> | Outputmappe (påkrævet) | — |
| --include <values> | Kommasepareret udvalg: company, agents, projects, issues, tasks, skills | company,agents |
| --skills <values> | Eksportér kun bestemte skill-slugs | alle |
| --projects <values> | Eksportér kun bestemte projektnavne eller id'er | alle |
| --issues <values> | Eksportér bestemte opgave-id'er eller identifikatorer | ingen |
| --project-issues <values> | Eksportér opgaver, der tilhører bestemte projekter | ingen |
| --expand-referenced-skills | Medtag skill-filernes indhold i stedet for kun at beholde henvisninger | false |

### Eksempler

~~~sh
# Eksportér virksomhed med agenter og projekter
paperclipai company export abc123 --out ./backup --include company,agents,projects

# Eksportér alt, inklusive opgaver og skills
paperclipai company export abc123 --out ./full-export --include company,agents,projects,tasks,skills

# Eksportér kun bestemte skills
paperclipai company export abc123 --out ./skills-only --include skills --skills review,deploy
~~~

### Hvad eksporten indeholder

- Virksomhedens navn, beskrivelse og metadata
- Agentnavne, roller, rapporteringsstruktur og instruktioner
- Projektdefinitioner og arbejdsområdets opsætning
- Opgavebeskrivelser, hvis de er valgt
- Skill-pakker som henvisninger eller inkluderede filer
- Adaptertype og miljøinputdeklarationer i .paperclip.yaml

Gemte hemmelighedsværdier og lokale maskinstier udelades. Eksport af opgaver og projekter indeholder kildeidentiteter, som bruges til at kontrollere en gendannelse. De giver ingen adgang. Gennemgå det valgte indhold for følsomme oplysninger, før du deler en pakke.

## Importér en virksomhed med CLI

Du kan importere fra en lokal mappe, GitHub-URL eller GitHub-genvej:

~~~sh
# Fra en lokal mappe
paperclipai company import ./my-export

# Fra en GitHub-URL
paperclipai company import https://github.com/org/repo

# Fra en undermappe på GitHub
paperclipai company import https://github.com/org/repo/tree/main/companies/acme

# Fra GitHub-genvej
paperclipai company import org/repo
paperclipai company import org/repo/companies/acme
~~~

### Indstillinger

| Indstilling | Beskrivelse | Standard |
|---|---|---|
| --target <mode> | new (opret en ny virksomhed) eller existing (flet ind i en eksisterende) | udledes af konteksten |
| --company-id <id> | Målvirksomhedens id ved --target existing | aktuel kontekst |
| --new-company-name <name> | Erstat navnet ved --target new | fra pakken |
| --include <values> | Kommasepareret udvalg: company, agents, projects, issues, tasks, skills | automatisk registreret |
| --agents <list> | Kommaseparerede agent-slugs, der skal importeres, eller all | alle |
| --collision <mode> | Håndtering af navnekonflikter: rename, skip eller replace | rename |
| --ref <value> | Git-reference til GitHub-import | standardgrenen |
| --dry-run | Forhåndsvis importen uden at gennemføre den | false |
| --yes | Spring interaktiv bekræftelse over | false |
| --json | Vis resultatet som JSON | false |

### Måltilstande

- **new** opretter en ny virksomhed ud fra virksomheds- og Co-worker-opsætning. Opgave- og projektindhold kræver publiceringsforløbet beskrevet ovenfor.
- **existing** fletter pakken ind i en eksisterende virksomhed. Brug --company-id til at vælge målet.

Hvis --target ikke angives, udleder Paperclip værdien. Hvis --company-id er angivet eller findes i konteksten, bliver standarden existing; ellers new.

### Strategier ved navnekonflikt

Ved import til en eksisterende virksomhed kan agent- eller projektnavne være i konflikt med eksisterende navne:

- **rename** (standard) tilføjer et suffiks for at undgå konflikter, for eksempel bliver ceo til ceo-2.
- **skip** springer allerede eksisterende elementer over.
- **replace** overskriver elementer. Det er kun tilgængeligt ved import, der ikke er sikker. Det tilbydes ikke gennem CEO-API'et.

### Interaktivt valg

Når kommandoen køres interaktivt uden --yes eller --json, viser importkommandoen en vælger, før den anvender ændringer. Du kan vælge præcis hvilke agenter, projekter, skills og opgaver der skal importeres.

### Forhåndsvis før anvendelse

Forhåndsvis altid først med --dry-run:

~~~sh
paperclipai company import org/repo --target existing --company-id abc123 --dry-run
~~~

Forhåndsvisningen viser:
- **Pakkeindhold** — antal agenter, projekter, opgaver og skills i kilden
- **Importplan** — hvad der oprettes, omdøbes, springes over eller erstattes
- **Miljøinput** — miljøvariabler, der kan være nødvendige efter import
- **Advarsler** — mulige problemer, som manglende skills eller uløste referencer

Importerede agenter starter altid med timerbaserede heartbeats slået fra. Tildelt arbejde og opvågning efter behov fra pakken bevares, men planlagte kørsler forbliver slået fra, indtil en bestyrelsesoperatør aktiverer dem igen.

Importen kan også angive pauseAutomations (standard i appens Import-side), så importerede agenter og rutiner forbliver på pause. Brug aktiveringspanelet efter importen — eller genoptag agenterne og aktivér rutinerne enkeltvis — når du er klar.

### Almindelige arbejdsgange

**Kopiér en virksomhedsskabelon fra GitHub:**

~~~sh
paperclipai company import org/company-templates/engineering-team \
  --target new \
  --new-company-name "My Engineering Team"
~~~

**Tilføj agenter fra en pakke til en eksisterende virksomhed:**

~~~sh
paperclipai company import ./shared-agents \
  --target existing \
  --company-id abc123 \
  --include agents \
  --collision rename
~~~

**Importér en bestemt gren eller et bestemt tag:**

~~~sh
paperclipai company import org/repo --ref v2.0.0 --dry-run
~~~

**Kør uden interaktiv dialog, f.eks. i CI eller scripts:**

~~~sh
paperclipai company import ./package \
  --target new \
  --yes \
  --json
~~~

## API-endpoints

CLI-kommandoerne bruger følgende API-endpoints:

| Handling | Endpoint |
|---|---|
| Eksportér virksomhed | POST /api/companies/{companyId}/export |
| Eksportér rapport om pakkens indhold | GET /api/companies/{companyId}/export/fidelity |
| Forhåndsvis import til eksisterende virksomhed | POST /api/companies/{companyId}/imports/preview |
| Anvend import til eksisterende virksomhed | POST /api/companies/{companyId}/imports/apply |
| Forhåndsvis import til ny virksomhed | POST /api/companies/import/preview |
| Anvend import til ny virksomhed | POST /api/companies/import |

Importens apply-anmodning accepterer pauseAutomations: true for at oprette importerede agenter og rutiner på pause.

CEO-agenter kan også bruge de sikre importruter (/imports/preview og /imports/apply). De afviser replace, håndterer navnekonflikter med rename eller skip, og opretter altid opgaver som nye.

## GitHub-kilder

Paperclip understøtter flere GitHub-URL-formater:

- Fuld URL: https://github.com/org/repo
- URL til undermappe: https://github.com/org/repo/tree/main/path/to/company
- Genvej: org/repo
- Genvej med sti: org/repo/path/to/company

Brug --ref til at fastlåse en gren, et tag eller et commit-id ved GitHub-import.
