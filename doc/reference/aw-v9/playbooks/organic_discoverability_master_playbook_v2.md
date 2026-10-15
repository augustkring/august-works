# Organic Discoverability Master Playbook — V2.0
## SEO, AEO, GEO, AI Search, Content Authority og distribueret organisk synlighed

**Version:** 2.0 — Double-Validated Golden Standard  
**Research cutoff:** 21. september 2026  
**Scope:** Google Search, Bing Search, Google AI Overviews/AI Mode, ChatGPT Search, Claude, Perplexity, Microsoft Copilot/Bing AI experiences, Google Discover/News, YouTube, commerce/agentic discovery hvor relevant og distribuerede web-/community-surfaces.  
**Dokumenttype:** Evergreen, operator-neutral best-practice playbook. Ikke en klik-for-klik toolguide og ikke en AI-agent-playbook.  
**Formål:** At definere den stærkest forsvarlige standard for, hvordan en virksomhed, et produkt, et koncept eller et brand gør sig teknisk tilgængeligt, forståeligt, troværdigt, citerbart og synligt på tværs af klassisk søgning og generative answer engines.

---

# Executive thesis

SEO, AEO og GEO bør ikke behandles som tre isolerede discipliner.

Den mest robuste model i 2026 er:

> **Organic discoverability = eligibility + relevance + quality + authority + extractability + distribution + freshness + measurement.**

Google siger eksplicit, at AI Overviews og AI Mode bygger på de samme centrale Search ranking- og quality-systemer som klassisk Search, og at der ikke kræves særligt AI-markup eller særlige “GEO hacks” for eligibility [G-AI01][G-AI02]. Bing beskriver samtidig GEO som et ekstra lag omkring grounding, citation og answer participation oven på den eksisterende search index [B-AI01][B-AI02]. OpenAI siger, at offentlige websites kan vises i ChatGPT Search, hvis de er tilgængelige for OAI-SearchBot, men at placering ikke er garanteret og afhænger af flere faktorer designet til at finde relevant og pålidelig information [OAI01][OAI02].

Derfor er den korrekte strategi ikke:

```text
SEO → GEO → AEO → ChatGPT hacks
```

men:

```text
TECHNICAL ELIGIBILITY
→ INFORMATION ARCHITECTURE
→ SEARCH/USER INTENT
→ USEFUL ORIGINAL CONTENT
→ ENTITY CLARITY + TRUST
→ INTERNAL LINKING + STRUCTURED DATA
→ DISTRIBUTED AUTHORITY + MENTIONS
→ AI/ANSWER EXTRACTABILITY + GROUNDABILITY
→ SURFACE-SPECIFIC ELIGIBILITY / ACTIONABILITY WHERE RELEVANT
→ FRESHNESS + CRAWL SIGNALS
→ MEASUREMENT + LEARNING
```

# V2 sanity-check verdict

V2 er lavet som et **falsifikations-pass** over V1: hver større regel er genkontrolleret mod aktuelle primærkilder, nye 2026-platformsændringer og uafhængige datasets. Formålet var ikke at gøre dokumentet længere, men at finde de steder, hvor V1 enten var for kategorisk, manglede en surface eller forvekslede “ikke en ranking factor” med “ingen mulig værdi”.

## Hvad anden researchrunde bekræftede

- Google fastholder, at klassisk SEO er fundamentet for AI Overviews og AI Mode; der kræves ikke et separat “GEO-tag-stack” [G-AI01][G-AI02].
- Google har nu dedikerede Generative AI-rapporter i Search Console globalt, så AI visibility kan måles som en særskilt surface frem for kun via prompt-screenshots [G-GENREPORT01].
- Bing gør GEO mere konkret gennem grounding/citation-data og har i 2026 udvidet AI Performance med bl.a. intent-, topic-, citation-share- og comparison-insights [B-AI01][B-AI03].
- OpenAI, Anthropic og Perplexity dokumenterer forskellige crawlere/fetchers til search, user-directed retrieval og model development. “Block AI bots” er derfor en fagligt utilstrækkelig regel [OAI01][ANT01][PERP01].
- Google har lanceret Preferred Sources og Search Profiles, som gør **publisher/creator followership** til en reel, men eligibility- og user-choice-afhængig discoverability-flade [G-PREF01][G-PROFILE01].
- For ecommerce er discovery i 2026 udvidet fra klassisk product SEO til **agentic commerce**: Merchant Center, conversational product attributes og Universal Commerce Protocol kan gøre produkter ikke kun findable, men actionable i AI Mode/Gemini [G-UCP01][G-MERCHAI01].
- Industry research fra både Ahrefs og Semrush understøtter, at brand mentions, citations og classic rankings er forskellige outcomes. Det er korrelation/descriptive evidence, ikke en skjult ranking-formel [IND01][IND02][IND04][IND05].

## Hvad V2 korrigerer

1. **“Unsupported” er ikke automatisk “do not do”.** En tactic kan være low-cost optional, hvis en konkret platform eller downstream system faktisk bruger den.
2. **“Harmless” er heller ikke automatisk “do it”.** Alt har implementation-, maintenance- og complexity-cost. Optional tactics skal have en identificerbar beneficiary.
3. **Keyword density:** exact procentmål er stadig unsupported; men relevant customer/query language i title, heading, anchor, alt text og body er officiel Google best practice [G-ESSENTIALS01][G-TITLE01].
4. **Sitemaps:** ingen ranking boost, men stærk low-cost discovery/coverage-infrastruktur, især på nye, store, rich-media og frequently changing sites [G-SITEMAP01][B-SITEMAP01].
5. **Structured data:** ikke en generel ranking-knap, men ofte høj værdi for machine understanding og eligibility til understøttede features [G-SD01][G-SD02].
6. **Fresh content:** “fresh always wins” er forkert, men Google har freshness systems for queries hvor recency er relevant. Reelle opdateringer kan derfor være værdifulde; fake date refresh er ikke [G-RANK01][G-DATE01].
7. **`llms.txt`:** ingen Google Search-effekt. Det er dog legitimt som low-cost optional integration, hvis et konkret system dokumenterer at det konsumerer filen [G-UPDATE01].
8. **DA/DR:** ikke Google metrics, men kan bruges som grove research/outreach proxies sammen med topical fit, real audience og editorial quality [G-THIRDPARTY01].
9. **Paid PR:** kan være stærkt for distribution, brand recall, referral, corroboration og mentions. Det bliver problematisk, når betalingen er for ranking credit/followed links [G-LINK02][G-SPAM01].
10. **AI content:** creation method er ikke problemet. Low-value scaled production er. Automation kan være legitim, når output har original værdi og quality control [G-GENAI01][G-SPAM01].

## Definitionen på “gold standard” i V2

En tactic er kun en core standard, hvis den har en stærk mekanisk, policy- eller evidensmæssig begrundelse. Resten klassificeres eksplicit som context-dependent, optional, unsupported eller risky.

Det betyder, at V2 ikke lover en “hack stack”. Den optimerer expected value:

```text
expected discoverability value
= probability of benefit
× business value if successful
− implementation cost
− maintenance cost
− policy/reputation risk
```

---

## Hvad playbooken optimerer for

Ikke kun rankings.

Den optimerer for:

1. **Index eligibility** — kan søgemaskinen overhovedet finde, hente, rendere og indeksere informationen?
2. **Classic search visibility** — kan siden rangere relevant i Google/Bing?
3. **Rich-result eligibility** — kan indholdet kvalificere sig til relevante search features?
4. **AI retrieval eligibility** — kan Google/Bing/OpenAI hente og bruge informationen?
5. **Citation probability** — er indholdet klart, specifikt, dokumenteret og egnet til at blive brugt som supporting source?
6. **Brand/entity visibility** — bliver virksomheden eller produktet nævnt korrekt, også når den ikke selv er citationen?
7. **Distributed discoverability** — findes brandets ekspertise på de steder, hvor mennesker og retrieval systems faktisk leder efter den?
8. **Qualified organic outcomes** — leads, purchases, signups, pipeline, revenue, adoption eller anden reel forretningsværdi.

---

# 1. Evidence standard

Denne playbook skelner hårdt mellem officielle platformmekanikker, kausal forskning, observationsdata og practitioner hypotheses.

| Tier | Kildetype | Hvordan den bruges |
|---|---|---|
| **A1** | Google Search Central, Bing Webmaster, OpenAI, Anthropic, Perplexity, Schema.org, IndexNow, platform policies | Source of truth for nuværende mechanics, eligibility og controls. |
| **A2** | Peer-reviewed / conference research, randomiserede tests, stærk IR/NLP-forskning | Evidens om kausalitet, retrieval, citations og informationsadfærd. |
| **B** | Store industry datasets fra fx Ahrefs/Semrush | Mønstre og correlations; aldrig behandlet som ranking-factor proof. |
| **C** | Erfarne specialister / agencies / tool vendors | Hypotheses, workflows og current implementation context. |
| **D** | Egne data | Kan være vigtigst for den konkrete virksomhed, men skal mærkes som causal, observational eller heuristic. |

## 1.1 Evidenslabels

- `OFFICIAL_MECHANIC`
- `OFFICIAL_GUIDANCE`
- `POLICY_REQUIREMENT`
- `ACADEMIC_EXPERIMENT`
- `PEER_REVIEWED_OBSERVATIONAL`
- `LARGE_INDUSTRY_CORRELATION`
- `PRACTITIONER_EVIDENCE`
- `INTERNAL_CAUSAL_TEST`
- `INTERNAL_ASSOCIATION`
- `SYNTHESIS`
- `HYPOTHESIS`

## 1.2 Konfliktregel

Når to råd modsiger hinanden:

1. Tjek om de faktisk handler om samme surface, query-type og periode.
2. Ved mechanics/policy: aktuel officiel dokumentation vinder.
3. Ved effekt: kausal forskning vægter højere end correlation.
4. Et vendor-studie kan være nyttigt, men markeres som vendor evidence.
5. Hvis evidensen stadig er uklar, bliver spørgsmålet et internt testspørgsmål — ikke en “best practice”.

---

## 1.3 Tactic triage — core, context, optional, unsupported eller risky

V2 bruger fem operational classes. Det er især vigtigt for taktikker, der “måske hjælper lidt og næppe skader”, fordi **low downside ikke i sig selv er et argument for at vedligeholde noget for evigt**.

| Klasse | Betydning | Default beslutning | Eksempler |
|---|---|---|---|
| **A — Core** | Stærk official/mechanical/evidence support; bred relevans | Implementér som standard hvor applicable | crawlability, indexability, internal links, people-first value, title clarity, measurement |
| **B — Context-dependent high value** | Reelt potentiale, men kun for bestemte sites/surfaces/intents | Implementér når use case findes | Product schema, IndexNow, local SEO, News, Preferred Sources, UCP, video SEO |
| **C — Low-cost optional** | Ingen dokumenteret generel ranking-effekt, men konkret system/use case kan bruge det | Gør kun hvis beneficiary + maintenance owner er kendt | `llms.txt` til dokumenteret consumer, DR som outreach proxy, extra crawler-specific allow rules |
| **D — Unsupported / no-priority** | Ingen troværdig mekanisme eller evidens nok til at prioritere | Skip indtil ny evidens/use case | exact keyword-density target, magic word counts, “ChatGPT schema” |
| **E — Risky / avoid** | Policy-, spam-, reputation- eller security-risk | Undgå | bought ranking links, fake Reddit seeding, cloaking, doorway/mass low-value pages |

## Triage test før en “hack” implementeres

Spørg:

1. **Hvilket konkret system forventes at læse eller reagere på ændringen?**
2. **Er effekten ranking, eligibility, discovery, presentation, citation, conversion eller bare intern convenience?**
3. **Findes en primær kilde, et reproducerbart studie eller kun anecdotes?**
4. **Kan tactic'en skabe maintenance debt, conflicting signals eller spam/policy risk?**
5. **Hvad er opportunity cost kontra en stærkere core intervention?**

Hvis svar 1 er “ingen kendt consumer”, er “det skader jo ikke” ikke nok til at gøre tactic'en til standard.

---

# 2. De 45 gyldne standarder

1. **Crawlability og indexability kommer før content optimization.**
2. **Robots.txt styrer crawling; `noindex` styrer indexing. Bland dem ikke sammen.**
3. **En XML sitemap er et discovery-/coverage-signal, ikke en ranking-garanti.**
4. **Kun index-worthy canonical URLs bør normalt være i sitemap.**
5. **`lastmod` skal afspejle reel indholdsændring, ikke sitemap-generationstid.**
6. **Canonical er et signal/hint; redirects er stærkere ved permanente URL-skift.**
7. **Hver vigtig side skal være discoverable gennem crawlable interne links.**
8. **Site architecture skal afspejle brugeropgaver og emnesammenhæng, ikke et kunstigt keyword-hierarki.**
9. **Brug søgeord som mennesker faktisk bruger, men skriv naturligt. Der findes ingen optimal keyword density.**
10. **Search intent er et content-designproblem, ikke blot et keywordproblem.**
11. **Indhold skal tilføre original information, erfaring, analyse, data, perspektiv eller utility.**
12. **“Topical authority” er ikke én kendt Google-score; byg i stedet sammenhængende, nyttig ekspertise omkring reelle brugerbehov.**
13. **E-E-A-T er ikke én ranking factor. Brug det som quality/trust-framework, især ved YMYL.**
14. **Gør det tydeligt hvem der står bag indholdet, hvordan det blev til, og hvorfor det findes, når det er relevant.**
15. **Mass AI-/programmatic content uden reel additional value er ikke en skalérbar SEO-strategi.**
16. **Structured data hjælper maskiner med at forstå entities og kan åbne rich-result eligibility; det er ikke en ranking-knap.**
17. **Markup skal matche synligt indhold og faktisk virkelighed.**
18. **Page experience og Core Web Vitals betyder noget, men perfekte scores kan ikke redde irrelevant indhold.**
19. **Mobile experience er default.**
20. **AI Search i Google kræver ikke et separat teknisk AEO/GEO-lag.**
21. **`llms.txt` er ikke et Google Search ranking-/visibility-signal.**
22. **AI citation optimization bør fokusere på clarity, evidence, provenance, specificity og freshness — ikke nye pseudo-tags.**
23. **Google AI og Bing AI bygger på retrieval/grounding; klassisk index eligibility er derfor fundamentet.**
24. **ChatGPT Search kræver adgang for OAI-SearchBot for fuld search eligibility.**
25. **Training controls og search controls er ikke det samme.**
26. **Brand mentions på andre websites kan være strategisk værdifulde, men correlation med AI visibility er ikke bevis for en ranking factor.**
27. **Backlinks skal fortjenes eller være redaktionelt begrundede; køb ikke links for ranking credit.**
28. **Betalt PR kan give reach, credibility og brand mentions, men betalte links skal kvalificeres og må ikke købes som PageRank-hack.**
29. **DA/DR er tredjepartsmetrics, ikke Google-ranking metrics.**
30. **Reddit kan være en stærk genuine community/source surface; fake seeding, masse-self-promotion og vote manipulation er anti-strategi.**
31. **YouTube, Instagram, TikTok og X kan selv blive fundet i Google; distributed content er en reel search surface.**
32. **For local SEO: relevance, distance og prominence er centrale; komplet og korrekt Business Profile er fundamentet.**
33. **For ecommerce: Product structured data + Merchant Center feed er komplementære, ikke konkurrerende.**
34. **For fresh content: opdater kun `dateModified`/lastmod når indholdet reelt ændres.**
35. **Ret eller merge duplicate/thin pages efter bruger- og indexværdi; “content pruning” er ikke automatisk positivt.**
36. **Migrations skal planlægges som signal-migrationer, ikke bare designprojekter.**
37. **Rankings alene er ikke målet; mål qualified organic outcomes, citations, impressions, brand demand og downstream conversions.**
38. **AI citations er ustabile og platformafhængige; mål trends, ikke én prompt screenshot.**
39. **Ingen tredjepart har adgang til Googles interne ranking- eller AI-systemer. Vær skeptisk over for “secret scores”.**
40. **Den stærkeste langsigtede moat er at blive en genuint nyttig, tydelig, dokumenteret og bredt anerkendt kilde inden for et afgrænset område.**
41. **Claude og Perplexity har separate search/user/training fetchers; crawler controls skal vælges efter desired visibility, ikke efter etiketten “AI bot”.**
42. **Preferred Sources og Search Profiles er context-dependent distribution surfaces for eligible publishers/creators, ikke generelle ranking hacks.**
43. **For ecommerce er accurate product feeds, conversational attributes og agentic-commerce protocols et nyt actionability-lag oven på SEO — ikke en erstatning for product SEO.**
44. **Mål brand mentions og source citations separat i AI answers; en citation kan være “ghosted”, og en mention kan forekomme uden citation [IND04].**
45. **Optional tactics skal bestå expected-value-testen: low cost er kun et plus, hvis der findes en konkret beneficiary og tactic'en ikke skaber signal-, maintenance- eller policy-gæld.**

---

# 3. Organic discoverability stack

## 3.1 Layer 1 — Eligibility

Kan systemet:

- opdage URL'en?
- hente den?
- rendere den?
- forstå statuskoden?
- se det primære indhold?
- indeksere den?
- bruge snippets/citations fra den?

Hvis svaret er nej, er alt andet sekundært.

## 3.2 Layer 2 — Relevance

Matcher siden:

- queryens ord?
- queryens intention?
- user task?
- entity/topic?
- geografi/sprog?
- formatet brugeren forventer?

## 3.3 Layer 3 — Quality / usefulness

Tilfører siden noget bedre end en generisk syntese af eksisterende sider?

- førstehåndserfaring
- original data
- specifikke examples
- demonstration
- ekspertforklaring
- method
- comparison
- utility/tool
- opdateret information

## 3.4 Layer 4 — Trust / authority

Kan claims efterprøves?

- tydelig virksomhed/person
- forfatter
- sources
- evidence
- policies/contact
- konsistens på tværs af nettet
- relevante redaktionelle mentions/links
- reviews/reputation

## 3.5 Layer 5 — Extractability / groundability

Er fakta lette at lokalisere og gengive korrekt?

- klare headings
- direkte svar
- definitions
- tables
- data med units/dates
- sourced claims
- explicit entity names
- konsistent terminology
- procedure steps

## 3.6 Layer 6 — Distribution

Eksisterer ekspertisen kun på eget website, eller også hvor målgruppen søger?

- YouTube
- Reddit/community
- relevante medier
- industry publications
- social posts
- partner sites
- podcasts/transcripts
- directories/listings hvor relevante

## 3.7 Layer 7 — Freshness / lifecycle

- opdateres facts når de ændrer sig?
- signaleres updates ærligt?
- sendes ændringer til Bing/IndexNow?
- er sitemap lastmod korrekt?
- bliver stale content refreshed, merged eller retired?

## 3.8 Layer 8 — Measurement

- impressions
- rankings
- clicks
- citations
- brand mentions
- search demand
- assisted conversions
- qualified outcomes
- crawl/index health

---

# 4. Business objective før keyword-listen

Organisk synlighed er kun værdifuld, hvis den skaber ønsket efterspørgsel, tillid eller conversion.

## 4.1 Definér business outcomes

Eksempler:

- ecommerce revenue / contribution profit
- qualified leads
- sales pipeline
- product adoption
- bookings
- store visits
- newsletter subscribers
- product discovery
- brand/category awareness
- earned media
- recruitment

## 4.2 Query-value model

Ikke alle keywords er lige værdifulde.

```text
Expected organic value
= eligible demand
× probability of visibility
× probability of click/mention
× conversion probability
× customer value
```

For AI surfaces kan “click” erstattes eller suppleres af:

```text
mention / citation / assisted consideration / brand demand
```

## 4.3 Prioritér efter customer journey

| Intent | Typiske spørgsmål | Content job |
|---|---|---|
| Problem discovery | “why…”, “how do I…” | Uddan og definér problemet |
| Solution discovery | “how to solve…”, “software for…” | Vis solution category og mekanisme |
| Comparison | “X vs Y”, “best…” | Transparent comparison + criteria |
| Validation | reviews, cases, proof | Reducér risiko |
| Transactional | buy, pricing, demo, book | Konverter |
| Support/use | how to use, integration | Adoption + retention + citations |

---

# 5. Technical SEO foundation

## 5.1 Crawlability vs indexability

Det er afgørende at skelne:

```text
CRAWLING = crawleren må hente URL'en
INDEXING = søgemaskinen må gemme/serve URL'en som resultat
SERVING/PREVIEW = hvor meget indhold må vises
```

Google dokumenterer eksplicit, at blokering via robots.txt ikke nødvendigvis holder en URL ude af Search. Hvis URL'en findes via links, kan den stadig optræde uden indhold. Brug `noindex` eller adgangskontrol, hvis siden reelt ikke skal indekseres [G-TECH01][G-TECH02].

## Regel

- **robots.txt:** crawl management
- **noindex:** index exclusion
- **password/auth:** private content
- **nosnippet / data-nosnippet / max-snippet:** preview/citation-content controls

## Anti-pattern

```text
Disallow: /private-page/
```

og samtidig forvente at URL'en aldrig kan ses i Google.

---

## 5.2 robots.txt

Brug robots.txt til:

- duplicate/faceted crawl spaces
- internal search-result URLs
- low-value generated parameter spaces
- specifikke crawler policies
- crawl-resource management

Brug ikke robots.txt til:

- sikkerhed
- private data
- permanent deindexing
- at skjule noget, som stadig er offentligt tilgængeligt

### Minimum eksempel

```txt
User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
```

Kun tilføj `Disallow` med et klart formål.

---

## 5.3 XML sitemaps

Sitemaps er et discovery/coverage-system, ikke en ranking-knap.

Google beskriver sitemap submission som et signal/hint og har grænser på 50.000 URLs / 50 MB pr. sitemap [G-SITEMAP01]. Bing kalder sitemaps fundamentale for coverage og anbefaler at kombinere dem med IndexNow for freshness [B-SITEMAP01].

## Golden standard

Sitemap bør normalt indeholde:

- canonical 200 URLs
- index-worthy pages
- korrekte absolute URLs
- reel `lastmod`

Sitemap bør normalt ikke indeholde:

- redirects
- 404/410
- `noindex`
- duplicate non-canonical URLs
- search result URLs
- staging/dev
- parameter junk

### lastmod

`lastmod` skal afspejle **reel ændring af page content**, ikke tidspunktet hvor sitemap blev bygget. Bing siger eksplicit, at falske “always now” timestamps kan blive ignoreret [B-SITEMAP01].

### changefreq / priority

Bing siger eksplicit, at `changefreq` og `priority` i praksis ignoreres [B-SITEMAP01]. Brug ikke tid på at “SEO-optimere” dem.

---

## 5.4 IndexNow

IndexNow supplerer — ikke erstatter — sitemap.

Brug det til at notificere deltagende engines, når URLs:

- publiceres
- ændres væsentligt
- slettes
- flyttes

IndexNow's egen dokumentation siger, at protocollet er beregnet til nye/opdaterede/slettede URLs og bør kombineres med sitemap for fuld coverage [IDX01].

### Default

```text
Sitemap = inventory / coverage
IndexNow = change notification / freshness
```

IndexNow er især relevant for Bing/Copilot-økosystemet. Antag ikke, at det er en Google indexing API.

---

## 5.5 Canonicalization

Google grupperer duplicate eller meget ens URLs og vælger en canonical. `rel=canonical` er et stærkt signal, men ikke en absolut ordre [G-CAN01].

Google beskriver signalstyrken således [G-CAN02]:

1. permanent redirect — stærkt
2. `rel="canonical"` — stærkt
3. sitemap inclusion — svagt

## Standard

- self-canonical på index-worthy pages er ofte en god implementation default
- canonical skal pege på reelt tilsvarende indhold
- brug ikke canonical som plaster på vilkårlig duplicate architecture
- hold interne links, sitemap og canonical konsistente
- undgå chains/cycles

---

## 5.6 Redirects og status codes

### 301 / 308
Permanent move eller consolidation.

### 302 / 307
Midlertidig move.

### 404
Ressourcen findes ikke.

### 410
Bevidst permanently gone; kan bruges hvor passende.

### 200
Kun når der faktisk leveres en fungerende side.

Undgå soft 404s: en “not found” side der svarer `200`.

Ved permanente migrations anbefaler Google server-side permanent redirects [G-MIG01][G-REDIR01].

---

## 5.7 URL architecture

URL'er skal primært være:

- stabile
- crawlable
- konsistente
- forståelige nok til mennesker
- fri for unødvendig parameter-/session-spredning

Keyword i URL kan være nyttigt for readability/context, men er ikke et magisk ranking-hack.

### Undgå

- fragmenter (`#`) som primary URL for indexable SPA-content
- session IDs
- infinite sort/filter combinations
- flere URL-strukturer til samme content uden canonical control
- redesign-drevne URL changes uden business reason

---

## 5.8 Site architecture

Arkitekturen skal gøre tre ting:

1. hjælpe brugeren finde næste relevante information
2. hjælpe crawlers discovere vigtige pages
3. gøre relationen mellem entities/topics tydelig

## Recommended conceptual structure

```text
Homepage
├── Core solution/category pages
│   ├── Use cases
│   ├── Industry/segment pages (kun hvis reelt forskellige)
│   ├── Product/service pages
│   └── Comparison / proof pages
├── Knowledge / resources
│   ├── Topic hub A
│   │   ├── Guide
│   │   ├── Definition
│   │   ├── Research/data
│   │   └── Tool/template
│   └── Topic hub B
├── Cases / proof
├── About / authors / company
└── Contact / commercial conversion pages
```

Det er ikke nødvendigt at have præcis denne struktur. Pointen er, at sidefamilier skal have et klart purpose og internal-link logic.

---

## 5.9 Internal linking

Google siger, at links bruges både til discovery og som relevanssignal, og at hver vigtig side bør have mindst ét internt crawlable link [G-LINK01].

## Standard

- brug `<a href>` links
- descriptive, concise anchor text
- link når relationen giver mening for læseren
- brug hubs/navigation/contextual links
- undgå orphan pages
- link fra stærke relevante sider til nye vigtige sider
- undgå sitewide keyword-stuffed anchors

### Internal link audit

For hver vigtig page:

- antal interne inlinks
- kvalitet/relevans af kilder
- anchor variation/natural language
- click depth
- orphan status
- canonical consistency

---

## 5.10 JavaScript og rendering

Google kan rendere JavaScript, men en robust site architecture bør ikke gøre essential discovery afhængig af fragile client behavior.

Standard:

- important content skal eksistere i rendered HTML
- crawlable links skal være `<a href>`
- critical metadata/structured data skal kunne ses efter rendering
- test med URL Inspection/rendered HTML
- undgå content der kun vises efter user interaction hvis det skal indekseres
- stable server responses og fast rendering er stadig desirable

Google har i 2026 fjernet outdated language om at JavaScript generelt “gør det sværere for Google”; pointen er ikke SSR som dogme, men korrekt crawl/render implementation [G-UPDATE01].

---

## 5.11 Faceted navigation og URL explosions

Facets kan skabe millioner af combinations.

Google anbefaler at kontrollere uendelige URL-spaces, især sortering, filtre, calendars og internal search [G-FACET01].

## Beslutning

### Index facet hvis

- den repræsenterer reel søgeefterspørgsel
- den har unik/nyttig inventory
- den kan have stabil canonical URL
- den giver en selvstændig user journey

### Ikke index/crawl eksplosivt hvis

- det kun er sorting
- kombinationen har ingen søgeværdi
- inventory er tom/tynd
- antallet af combinations vokser uhæmmet

---

## 5.12 Pagination og infinite scroll

Infinite scroll må ikke gøre content utilgængeligt uden user interaction.

Hvis content skal kunne findes, bør chunks have persistente crawlable URLs eller en anden robust pagination model.

---

## 5.13 Mobile, UX og Core Web Vitals

Google bruger mobile-first indexing, og Core Web Vitals indgår som ranking signals, men Google understreger, at der ikke findes ét samlet “page experience score”, og at relevance fortsat kan dominere [G-PX01].

## Standard

- responsive/mobile-first
- fast LCP
- stabil layout / CLS
- responsiv interaktion / INP
- ingen intrusive interstitials der ødelægger task completion
- readable typography
- accessible navigation
- forms der fungerer på mobil

**Ingen** bør jagte en Lighthouse 100-score på bekostning af business/content work.

---

## 5.14 Accessibility

Accessibility er først og fremmest en bruger- og compliance-kvalitet, ikke et hemmeligt SEO-score-system.

Brug:

- semantic HTML
- descriptive labels
- alt text hvor billedet bærer information
- keyboard navigation
- korrekt heading hierarchy
- ARIA når native semantics ikke er nok

OpenAI beskriver desuden ARIA labels/roles som nyttige for ChatGPT browser/agent-interaktion, men det bør ses som kompatibilitet/accessibility — ikke som ChatGPT Search ranking factor [OAI01].

---

## 5.15 International / multilingual SEO

For separate language/region pages:

- unikke URLs
- oversæt primary content, ikke kun navigation
- brug `hreflang` korrekt
- hver version refererer til sig selv og relevante alternates
- brug `x-default` hvor det giver mening
- behold canonical normalt inden for samme language/region set, medmindre pages reelt er duplicates
- undgå auto-redirect på IP uden mulighed for navigation

Søgemaskiner skal kunne crawl'e hver version.

---

## 5.16 Crawl budget

Crawl budget er normalt **ikke** et hovedproblem for små/mellemstore websites.

Prioritér crawl-budget engineering når:

- site har meget stor URL inventory
- parameter/facet explosion
- høj publishing/change rate
- store mængder “discovered, not indexed”
- crawler load påvirker infra

Ellers er clean architecture + sitemap + internal links normalt vigtigere.

---

## 5.17 Migration standard

En migration er en signal-migration.

## Før launch

- crawl old site
- export indexed URLs / GSC landingspages
- map old → new URL 1:1 hvor muligt
- identificér top linked/ranked/converting URLs
- test new site uden accidental indexation
- verify canonical/meta/robots
- prepare XML sitemap
- test internal links
- benchmark rankings, clicks, conversions, indexed counts

## Launch

- 301/308 old → closest equivalent new URL
- undgå mass redirect til homepage
- update canonicals
- update internal links
- publish new sitemap
- update hreflang
- Search Console/Bing properties
- Change of Address ved relevante domain moves
- submit IndexNow to Bing ecosystem

## Efter launch

- monitor 404s
- redirect chains
- canonical mismatch
- robots/noindex leakage
- sitemap/index coverage
- traffic transfer
- server capacity

Google anbefaler direkte mapping, server-side permanent redirects og at undgå chains [G-MIG01].

---

# 6. Crawler and AI access matrix

| Bot/control | Primært formål | Hvad betyder allow/block? | Vigtig nuance |
|---|---|---|---|
| **Googlebot** | Google Search crawling | Kontrollerer Google Search crawl | Direkte Search/AI Search eligibility impact |
| **Google-Extended** | Google product token til Gemini-relaterede model/grounding uses | Kan tillades/blokeres separat | Google siger eksplicit: ingen Google Search inclusion/ranking impact [G-CRAWL01] |
| **OAI-SearchBot** | ChatGPT Search discovery/citation | Allow for full inclusion in search summaries/snippets | Search control, ikke training control [OAI01] |
| **GPTBot** | Potentiel model-training collection | Kan blokeres separat | Blocking GPTBot er ikke det samme som blocking ChatGPT Search [OAI01] |
| **Claude-SearchBot** | Claude search-result quality/indexing | Blocking kan reducere visibility/accuracy i Claude search | Anthropic dokumenterer separat search bot [ANT01] |
| **Claude-User** | User-directed Claude web retrieval | Blocking forhindrer Claude i at hente site ved user request | Anthropic siger botten respekterer robots.txt [ANT01] |
| **ClaudeBot** | Potentiel model-development/training collection | Kan blokeres separat fra search/user retrieval | Training control [ANT01] |
| **PerplexityBot** | Perplexity search discovery/indexing | Allow hvis sitet ønskes surfaced/linket i Perplexity | Perplexity siger den ikke bruges til foundation-model training [PERP01] |
| **Perplexity-User** | User-triggered page fetch | Kan hente sider ved direkte user request | Perplexity siger den **generelt ignorerer robots.txt**; private content skal beskyttes med auth/access control [PERP01] |
| **Bingbot** | Bing index/search | Crawling/indexing | Foundation for Bing/Copilot/Web IQ retrieval [B-AI02][B-WEBIQ01] |
| **IndexNow** | Push-notification til deltagende engines | Notificerer changed/new/deleted URLs | Ikke ranking guarantee [IDX01] |

## Central regel

**Training opt-out ≠ Search opt-out ≠ user-directed retrieval opt-out.**

Det er en fejl at have en generisk “block all AI bots”-policy uden først at beslutte, om virksomheden ønsker visibility i ChatGPT, Claude, Perplexity, Gemini/Copilot og andre retrieval surfaces.

**Security rule:** robots.txt er en crawler preference, ikke adgangskontrol. Alt privat, licensed eller følsomt content skal beskyttes med authentication/authorization/network controls. Perplexity dokumenterer fx, at `Perplexity-User` generelt ignorerer robots.txt ved user-triggered fetches [PERP01].

---

# 7. Structured data and machine-readable meaning

Structured data is not “SEO code that makes you rank”. Google says it helps the system understand page meaning and can make pages eligible for richer search appearances, but does not guarantee rich results [G-SD01][G-SD02].

## 7.1 Golden rule

Markup only what:

- actually exists
- is visible/true for the user
- matches Google's supported type where rich-result eligibility matters
- can be maintained accurately over time

## 7.2 JSON-LD default

JSON-LD is often operationally easiest because it separates markup from visible HTML, but correctness matters more than syntax format.

## 7.3 Organization / entity markup

On homepage/About or another authoritative company page, consider:

- `Organization` or relevant subtype
- official `name`
- `alternateName` where genuine
- `url`
- `logo`
- contact details where applicable
- legal/location properties where relevant
- `sameAs` to authoritative profiles that unambiguously identify the same entity

Schema.org defines `sameAs` as a reference URL that unambiguously identifies the same thing [SCHEMA01].

### Don't

- invent Wikidata/Wikipedia entries
- use unrelated high-authority profiles as `sameAs`
- mark up fake reviews
- mark up hidden claims

## 7.4 Article / BlogPosting / NewsArticle

Useful fields where relevant:

- `headline`
- `author`
- `datePublished`
- `dateModified`
- `image`
- `publisher`

Dates must match visible reality. Do not update timestamps only to simulate freshness [G-DATE01].

## 7.5 Product / Offer

For ecommerce, Product/Offer structured data can provide:

- name
- image
- price
- currency
- availability
- shipping/returns where supported
- aggregate rating where legitimately collected and policy-compliant

Google says on-page structured data and Merchant Center feeds are complementary; using both maximizes eligibility and helps verification [G-ECOM01].

## 7.6 LocalBusiness

Use appropriate subtype and keep data consistent with:

- official website
- Google Business Profile
- Bing Places
- directories/citations
- contact pages

## 7.7 VideoObject

For owned video pages:

- `name`
- `description`
- `thumbnailUrl`
- `uploadDate`
- `contentUrl` or `embedUrl`
- duration/key moments where relevant

Google supports VideoObject to improve discovery and video features [G-VIDEO01].

## 7.8 FAQ markup

Do not build strategy around outdated rich-result features. Google removed the FAQ rich result from Search in May/June 2026 [G-UPDATE01].

FAQ **content** can still be useful to humans and retrieval systems. The markup is not a universal search enhancement.

---

# 8. Entity clarity and knowledge consistency

Search and generative systems need to answer:

> “What is this company/person/product, and is this the same entity mentioned elsewhere?”

## 8.1 Entity home

Maintain one clear canonical “entity home”:

- company homepage/about page
- product page
- author page
- location page

It should state facts unambiguously.

Example:

```text
Acme is a Danish B2B software company that provides X for Y.
Founded in 2026 in Copenhagen, Acme serves Z.
```

Not vague:

```text
We reimagine tomorrow through intelligent possibility.
```

The latter may be brand copy, but machines and humans still need factual identity.

## 8.2 Entity consistency

Keep consistent:

- official name
- spelling
- domain
- product names
- founder/company relationships
- location
- category
- logo
- descriptions of what the business actually does

Across:

- website
- Google Business Profile
- Bing Places
- YouTube
- LinkedIn
- social profiles
- app stores
- industry directories
- press mentions

Consistency is not about forcing identical copy everywhere; it is about avoiding contradictory facts.

## 8.3 Knowledge panels / Wikidata / Wikipedia

Do not create or manipulate independent knowledge sources purely for SEO.

If the entity legitimately meets platform criteria:

- ensure facts are sourced
- respect editorial independence
- disclose conflicts where required
- don't treat Wikipedia as a marketing channel

---

# 9. Keyword, topic and entity research

Keyword research remains important, but the unit of strategy is broader than an exact phrase.

## 9.1 Research hierarchy

### 1. Customer language

Gather from:

- sales calls
- customer interviews
- support tickets
- reviews
- community posts
- on-site search
- product usage

### 2. First-party search data

- Google Search Console
- Bing Webmaster Tools
- site search
- YouTube Analytics/Search Console platform properties

### 3. Search-demand tools

- Google Trends
- Keyword Planner where useful
- Bing keyword research
- Ahrefs/Semrush/etc. as estimates

### 4. SERP / answer-engine observation

Observe:

- result types
- query refinements
- AI Overviews
- People Also Ask
- videos
- forums
- shopping/local packs
- comparison/list content

### 5. Entity / problem mapping

Map:

```text
Customer
→ problem
→ trigger
→ job-to-be-done
→ solution category
→ product
→ alternatives
→ objections
→ evidence needed
```

## 9.2 Search intent

Classify the **task**, not just “informational/commercial”.

Useful dimensions:

- learn
- understand
- compare
- choose
- validate
- buy
- navigate
- troubleshoot
- calculate
- locate
- get recommendation
- get current status

## 9.3 Query fan-out

Google says AI Mode/AI Overviews may use query fan-out to search multiple related subtopics and data sources [G-AI01][G-AI02]. ChatGPT Search likewise may rewrite one user prompt into multiple targeted queries [OAI02].

### Correct response

Build content that genuinely covers the related information need and relevant subquestions.

### Wrong response

Create 40 near-duplicate pages for imagined fan-out phrases.

Google explicitly warns against making separate pages for many possible fan-out queries solely to manipulate visibility; this can enter scaled-content-abuse territory [G-AI02][G-SPAM01].

## 9.4 No keyword density target

There is no scientifically valid universal “2% keyword density”.

Use terminology naturally enough that:

- user understands topic
- page title/headings are explicit
- entities are named
- variants appear where genuinely useful

Do not force exact-match repetition.

---

# 10. Information architecture and taxonomy

A strong taxonomy converts scattered content into a coherent knowledge system.

## 10.1 Taxonomy design

Classify content by dimensions that matter to users:

- topic
- product
- use case
- audience
- industry
- geography
- stage
- content type

Avoid creating an indexable URL for every tag/filter just because the CMS can.

## 10.2 Hub-and-spoke as a tool, not dogma

A hub is valuable if it:

- helps users understand a subject
- links to distinct useful subresources
- gives context
- prevents orphan content

A “topic cluster” built only to manufacture internal links is not enough.

## 10.3 Knowledge base architecture

For a specialist company, a strong resource layer can include:

```text
/learn/
  /topic-a/
    /guide/
    /definition/
    /comparison/
    /research/
    /tool/
    /template/
```

But only build page types that have independent utility.

## 10.4 Glossary / definitions

Definitions can be valuable when the company has genuine expertise.

Each definition should ideally include:

- concise direct definition
- context
- example
- boundary / what it is not
- related concepts
- source or method where needed

Do not generate hundreds of 150-word glossary pages solely for long-tail traffic.

---

# 11. People-first content quality standard

Google's people-first guidance asks whether content provides original information, reporting, research or analysis; is comprehensive enough; demonstrates first-hand expertise; has a clear audience; and leaves the reader satisfied [G-CONTENT01].

## 11.1 A page should earn its existence

Every indexable page should have a clear reason to exist.

Acceptable reasons include:

- answer a distinct user need
- provide unique evidence
- serve a commercial decision
- document a product/entity
- provide a tool/template
- explain a process
- compare meaningful alternatives
- provide current/reference data

Not enough:

> “There is keyword volume.”

## 11.2 Value-add test

Ask:

1. What is on this page that a generic language model could not create from public summaries?
2. What evidence do we possess?
3. What first-hand experience do we possess?
4. What decision becomes easier after reading it?
5. What would be lost if this page disappeared?

## 11.3 Strong value sources

- proprietary data
- original research
- experiments
- benchmark datasets
- expert interviews
- customer observations
- screenshots / demonstrations
- real implementation details
- transparent methodology
- templates/tools/calculators
- updated reference tables
- nuanced comparisons
- failures/limitations

## 11.4 Who / How / Why

Google recommends self-evaluating content via “Who, How, Why” [G-CONTENT01].

### Who

- named author where expected
- bio/profile
- relevant credentials/experience
- editorial reviewer where important

### How

- methodology
- test conditions
- data period
- sample
- sources
- disclosure of material automation if useful to trust

### Why

The primary reason should be helping an audience achieve a task — not merely attracting search traffic.

---

# 12. E-E-A-T correctly understood

E-E-A-T = Experience, Expertise, Authoritativeness, Trustworthiness.

Google explicitly says E-E-A-T itself is **not a single specific ranking factor** [G-CONTENT01].

## Correct use

Use it as a quality audit:

### Experience

- actual product use
- first-hand testing
- real visit
- implementation screenshots
- firsthand case details

### Expertise

- qualified author
- methodology
- technical depth
- correct nuance

### Authoritativeness

- industry recognition
- editorial mentions
- citations
- relevant links
- expert participation

### Trust

- accurate claims
- sources
- transparent company
- contact info
- policies
- corrections
- data handling
- reviews/reputation

Trust matters especially for YMYL topics.

---

# 13. Content design for search and answers

## 13.1 Answer-first without becoming robotic

For a factual question, give the answer near the point where the question is introduced.

Pattern:

```text
Clear answer
→ nuance / conditions
→ evidence
→ examples
→ implementation
```

Do not hide a 2-sentence answer under 900 words of generic intro.

## 13.2 Page anatomy

A robust educational page often benefits from:

- descriptive title
- concise opening
- clear H1
- logical H2/H3 sections
- direct definitions
- tables where comparison is genuinely tabular
- step lists where process is sequential
- examples
- sources
- related internal links
- author/date where relevant

This is primarily good information design. It also makes retrieval and citation easier.

## 13.3 Titles

Google recommends descriptive, concise, distinct titles and warns against keyword stuffing [G-TITLE01].

Good:

```text
Meta Conversions API: Implementation Guide for Shopify
```

Weak:

```text
Conversions API | CAPI | Meta API | Facebook API Best Guide 2026
```

## 13.4 Meta descriptions

Meta descriptions influence snippets but are not a magic ranking factor.

Write them to:

- accurately describe value
- differentiate page
- encourage qualified clicks

Google may generate a different snippet from page content.

## 13.5 Headings

Use hierarchy for comprehension, not keyword density.

- one clear main topic
- subheadings correspond to meaningful sections
- don't create headings only because a tool says a keyword is missing

## 13.6 Definitions

When a concept matters, define it in one self-contained sentence before expanding.

Good citation candidate:

> “Customer acquisition cost (CAC) is the total acquisition spend divided by the number of new customers acquired in the same defined scope.”

Then explain caveats.

## 13.7 Claims

Every important factual claim should have one of:

- first-party evidence
- transparent method
- authoritative external citation
- explicit label as estimate/opinion

## 13.8 Numbers

A citable statistic should include enough context to survive extraction:

```text
metric + value + population + date/period + method/source + limitation
```

Bad:

> “Conversion increased 42%.”

Better:

> “In our 1,842-session A/B test conducted 1–14 August 2026, checkout completion increased from 8.1% to 10.7% (+32% relative; +2.6 percentage points).”

---

# 14. Original research and first-party data

Original evidence is one of the most defensible ways to create content that deserves citation.

## 14.1 Sources of original data

- anonymized product telemetry
- audit data
- pricing datasets
- benchmarking
- customer surveys
- transaction aggregates
- implementation logs
- test results
- public dataset analysis
- manually collected market data

## 14.2 Research page standard

Every study should state:

- research question
- sample
- source
- date range
- inclusion/exclusion criteria
- methodology
- result
- uncertainty/limitations
- downloadable or inspectable data where feasible
- date last updated

## 14.3 Why it matters for AI answers

The Princeton GEO paper found that citation, quotation and statistics-oriented interventions could improve measured visibility in its benchmark, with effects varying by domain [A-GEO01]. This is an important directional result, but not a guarantee for modern production engines.

The durable principle is not “add three statistics”. It is:

> **Make important claims evidence-rich, attributable and extractable.**

---

# 15. Content types and their jobs

## 15.1 Core commercial pages

Purpose:

- explain product/service
- match high-intent queries
- convert

Must include:

- concrete value proposition
- use cases
- mechanism/features where relevant
- proof
- objections
- CTA
- real entity/product details

## 15.2 Use-case pages

Only create separate pages where:

- problem differs materially
- language differs
- proof differs
- workflows differ
- SERP/user intent differs

Do not create city/industry/persona permutations with near-identical body copy.

## 15.3 Comparison pages

High trust requirement.

Include:

- criteria before verdict
- transparent methodology
- genuine strengths/weaknesses
- current pricing/features where possible
- last checked date
- disclosure of own commercial interest

Self-serving “best tools” lists can rank/circulate, but should never become deceptive editorial mimicry.

## 15.4 Case studies

Strong because they combine:

- real entity
- initial state
- intervention
- evidence
- outcome
- context
- quote

Avoid fabricated or unverifiable testimonials.

## 15.5 Templates and tools

High-value utility pages can attract:

- direct users
- links
- mentions
- citations
- repeat visits

Examples:

- calculator
- checklist
- audit tool
- template
- generator with real function
- benchmark explorer

Google's spam policies call deceptive “tools” that do not actually perform the promised function misleading functionality [G-SPAM01].

## 15.6 Glossary / encyclopedia

Useful when it reinforces a genuine domain of expertise and each entry adds meaningful explanation.

## 15.7 Research / data hub

One of the strongest long-term authority assets if maintained well.

---

# 16. Programmatic SEO

Programmatic SEO is not inherently bad.

The decisive question is:

> Does each generated page provide independent user value?

## Good programmatic patterns

- marketplace inventory pages with genuine unique data
- location pages with distinct inventory/hours/services
- integration pages with actual implementation details
- data pages with real measurements
- comparison pages generated from reliable live data

## Bad patterns

- city-swapped doorway pages
- AI-summarized definitions at industrial scale
- copied product descriptions without additional value
- thousands of “X for Y” pages with same body
- stitching search results into thin pages

Google defines scaled content abuse as large amounts of low-value/unoriginal content created primarily to manipulate rankings, regardless of whether generated by humans, AI or other automation [G-SPAM01].

## Programmatic quality gate

Before indexation, each page should pass:

- unique purpose
- unique data/content
- sufficient inventory
- correct canonical
- no empty state
- useful internal links
- conversion/user action
- no near-duplicate template-only body

---

# 17. Content freshness and decay

Freshness is query-dependent.

Some queries require current data:

- prices
- software features
- laws
- events
- market data
- current executives
- product availability

Others remain evergreen.

## 17.1 Update policy

For each page define:

```yaml
freshness_class: static | annual | quarterly | monthly | event-driven
owner: ...
last_reviewed: ...
next_review: ...
volatile_facts:
  - ...
```

## 17.2 Honest dates

Google recommends visible dates and matching `datePublished` / `dateModified`, but warns dates should reflect real publication/update events [G-DATE01].

Do not “freshness bump” by changing date without meaningful revision.

## 17.3 Refresh actions

- update changed facts
- add new evidence
- remove obsolete sections
- improve examples
- fix broken sources
- update screenshots
- reconcile search intent
- refresh title/snippet if needed
- update internal links

---

# 18. Content pruning, merging and consolidation

“Delete old pages to boost quality” is too simplistic.

For every weak page choose among:

## Keep
If useful, indexed, linked, referenced or converting.

## Improve
If intent is valuable but page is weak/outdated.

## Merge
If multiple pages compete for the same intent and none needs independence.

## Redirect
If a successor exists.

## Noindex
If useful to users but not appropriate for search.

## 404/410
If intentionally gone and no replacement exists.

## Decision inputs

- clicks/impressions
- links/mentions
- conversions
- crawl/index status
- content uniqueness
- user utility
- freshness
- cannibalization

Do not delete purely because traffic is low; niche reference pages may still have strategic value.

---

# 19. AEO / GEO / AI Search — the validated model

## 19.1 Terminology

### SEO — Search Engine Optimization
Optimizing eligibility, relevance, quality and presentation in traditional and AI-enhanced search systems.

### AEO — Answer Engine Optimization
Industry term for making information easy to answer from directly.

### GEO — Generative Engine Optimization
Term introduced academically for optimizing visibility in generative-engine responses [A-GEO01]. Microsoft/Bing now uses GEO language for publisher visibility in AI answers [B-AI01].

### LLMO
Industry term for large-language-model optimization. No universal technical standard.

## Playbook position

Treat AEO/GEO/LLMO as **specialized outcome lenses** inside one organic discoverability system.

```text
SEO foundation
+ source quality
+ answer structure
+ evidence/provenance
+ entity clarity
+ distributed authority
= stronger generative-search eligibility and citation potential
```

---

# 20. How generative search changes the retrieval problem

Traditional search often returns a ranked list of pages.

Generative search may instead:

1. interpret the request
2. rewrite/decompose it
3. run one or many searches
4. retrieve candidate passages/pages
5. select evidence
6. synthesize an answer
7. cite some subset of sources

Google explicitly describes RAG/grounding and query fan-out [G-AI01][G-AI02]. ChatGPT Search says a user prompt may be rewritten into one or more targeted search queries sent to providers [OAI02]. Microsoft describes the shift from an index optimized to help humans decide what to read toward grounding systems that help AI decide what evidence supports an answer [B-AI02].

## Consequence

The unit of competition is no longer only:

> “Can this page rank #1 for keyword X?”

It can also be:

> “Does this source contain a clear, trustworthy passage that directly supports one part of a broader answer?”

---

# 21. Google AI Overviews / AI Mode

Google is unusually explicit in 2026:

- classic SEO best practices remain relevant
- AI features are rooted in core Search ranking/quality systems
- supporting pages must be indexed and snippet-eligible
- no special AI markup is required
- no special AI file is required
- `llms.txt` has no positive or negative Google Search ranking/visibility impact [G-AI01][G-AI02][G-UPDATE01]

## 21.1 Google AI standard

Prioritise:

- crawlability
- indexability
- text-accessible important content
- unique value
- strong page experience
- internal links
- valid structured data matching visible content
- good images/video where relevant
- current Merchant Center / Business Profile data

## 21.2 Query fan-out implication

A broad, well-structured guide can be a source for a subquestion even if its title does not exactly match the user prompt.

This increases the value of:

- concept clarity
- comprehensive coverage where useful
- distinct sections
- precise terminology
- internal supporting pages

But does **not** justify manufacturing micro-pages for every phrase.

## 21.3 Preferred Sources — audience opt-in as discoverability

Google's Preferred Sources er i 2026 rullet globalt ud i understøttede sprog. Når en bruger selv vælger en publication/site som preferred source, kan dens relevante content blive vist oftere i Top Stories og fremhæves som preferred i AI Overviews/AI Mode [G-PREF01].

**Det er ikke en klassisk ranking factor**, fordi preference er user-specific. Men for publishers, niche-media, expert brands og virksomheder med et reelt returning audience er det en legitim distribution tactic:

- educate eksisterende readers om feature'en
- brug Google's official “preferred source” assets/badge hvor relevant
- integrér CTA i newsletter/footer/content for high-affinity audience
- mål returning audience, Discover/Search exposure og downstream clicks

Google har rapporteret, at users i feature-data var omtrent dobbelt så tilbøjelige til at klikke på et site efter at have markeret det som Preferred Source; behandl det som vendor-reported product data, ikke et universelt uplift [G-PREF01].

## 21.4 Search Profiles — entity/distribution surface for eligible publishers/creators

Search Profiles samler website, articles og social/video content i en Google-hosted profile. Followers kan gøre linked content mere likely til at appear for dem i Discover [G-PROFILE01].

**V2 classification: B — context-dependent high value.**

Brug når accounten er eligible:

- claim og verificér profile
- forbind canonical website og reelle social accounts
- hold entity facts/branding konsistent
- add official Search Profile badge, hvis det giver mening
- brug profile som distribution/entity consistency surface, ikke som backlink/ranking hack

Eligibility er fortsat begrænset og volatile; pr. 16. september 2026 beskriver Google udvidet U.S. eligibility og en follower-threshold for publishers/creators [G-PROFILE01]. Live-check før implementation.

## 21.5 Google controls

For Google Search AI features, normal Search controls apply:

- `noindex`
- `nosnippet`
- `data-nosnippet`
- `max-snippet`
- Googlebot robots rules

Google-Extended is separate and does not control Search ranking/inclusion [G-CRAWL01].

---

# 22. ChatGPT Search discoverability

OpenAI's current publisher guidance says any public website can appear in ChatGPT Search [OAI01].

## 22.1 Minimum eligibility

- do not block `OAI-SearchBot`
- ensure CDN/WAF/firewall permits OpenAI's published searchbot IP ranges
- keep important pages publicly accessible
- use normal index controls where needed

OpenAI says placement is not guaranteed and results are ranked using multiple factors intended to surface relevant, reliable information [OAI02].

## 22.2 Separate training from search

If a publisher wants:

```text
YES ChatGPT Search
NO potential training crawl
```

then conceptually:

```text
Allow OAI-SearchBot
Disallow GPTBot
```

subject to current OpenAI documentation [OAI01].

## 22.3 Referral measurement

OpenAI says ChatGPT adds:

```text
utm_source=chatgpt.com
```

to referral URLs from search results, enabling analytics tracking [OAI01].

## 22.4 Query rewriting

ChatGPT Search may transform one user prompt into multiple more targeted searches [OAI02].

Therefore content should cover the decision context, not obsess over reproducing literal chatbot prompts.

## 22.5 What we do NOT know publicly

OpenAI does not publish a deterministic list of ranking weights for ChatGPT Search.

Do not claim:

- “ChatGPT prefers X-word articles”
- “ChatGPT needs FAQ schema”
- “ChatGPT ranks sites by DR”
- “Use phrase X three times to get cited”

unless future official documentation changes.

---

# 23. Bing / Copilot GEO

Microsoft has gone further than most engines in exposing AI citation telemetry.

Bing Webmaster Tools' AI Performance report can show [B-AI01]:

- total citations
- average cited pages
- grounding query samples
- URL-level citation activity
- trend over time

Microsoft explicitly warns that citation count does not indicate ranking, authority or answer placement.

## 23.1 Bing's recommended content properties

Bing's official 2026 guidance suggests:

- deepen subject expertise
- use clear headings
- use useful tables/FAQ structures
- support claims with evidence
- keep information fresh
- reduce ambiguity across text/images/video [B-AI01]

Treat this as official Bing guidance, not a universal guaranteed formula for all LLMs.

## 23.2 Freshness

For Bing/Copilot:

- accurate sitemap `lastmod`
- IndexNow
- current local/business/product information

are especially operationally important [B-SITEMAP01][B-AI01].

## 23.3 Claude Search discoverability

Anthropic dokumenterer tre separate bots [ANT01]:

- `Claude-SearchBot` til search-result quality/indexing
- `Claude-User` til user-directed web retrieval
- `ClaudeBot` til public-web collection, som potentielt kan indgå i model-development/training

Hvis målet er discoverability i Claude men ikke model-training collection, er den konceptuelle policy derfor:

```text
Allow Claude-SearchBot
Allow Claude-User
Disallow ClaudeBot
```

subject to current Anthropic documentation and internal policy.

Anthropic siger, at deres bots respekterer robots.txt og understøtter `Crawl-delay`. Der er ingen public deterministic “Claude ranking formula”, så content optimization bør følge samme source principles som resten af playbooken: crawlable public source, factual clarity, evidence, relevance og freshness.

## 23.4 Perplexity discoverability

Perplexity dokumenterer [PERP01]:

- `PerplexityBot` til at surface/link websites i Perplexity Search
- `Perplexity-User` til user-triggered page fetches

`PerplexityBot` bør være allowed, hvis public pages ønskes discoverable/citable i Perplexity. Perplexity anbefaler også WAF allowlisting via official published IP ranges, hvis security infrastructure ellers blokerer crawleren.

**Vigtig privacy/security nuance:** `Perplexity-User` generally ignores robots.txt, fordi fetch er user-requested [PERP01]. Beskyt derfor ikke private information med robots.txt; brug reel adgangskontrol.

Som med ChatGPT/Claude findes ingen offentligt dokumenteret universal citation formula. Mål engine-specific citations/mentions/referrals i stedet for at overføre Google ranking heuristics direkte.

---

# 24. Groundability: making content easy to use as evidence

“AI-friendly” should not mean robotic prose.

It should mean information is **unambiguous and supportable**.

## 24.1 Groundable passage properties

A strong passage often has:

- explicit subject/entity
- direct claim
- scope
- date
- unit
- evidence/source
- caveat if needed

Example:

> “In our September 2026 benchmark of 3,420 Danish ecommerce sessions, mobile checkout completion was 8.4%. Sessions with a payment error had a 1.7% completion rate. The sample covers only customers who reached checkout.”

A retrieval system can understand:

- what
- who
- when
- population
- caveat

## 24.2 Extraction patterns

Use naturally where helpful:

### Definition
```text
X is ...
```

### Comparison
```text
A differs from B primarily in ...
```

### Procedure
```text
1. ...
2. ...
3. ...
```

### Evidence table
```text
Metric | Value | Period | Source
```

### Claim + citation
```text
Claim ... [source]
```

## 24.3 Do not “chunk for AI” blindly

There is no official Google requirement to write 200-word chunks, add artificial FAQ sections or break prose into tiny passages solely for AI.

Structure for humans first; retrieval benefits are a byproduct of clarity.

---

# 25. Academic evidence on GEO — what it does and does not prove

## 25.1 Princeton/KDD GEO study

Aggarwal et al. introduced the GEO framework and GEO-bench, reporting visibility improvements up to 40% in its experimental generative-engine setup, with substantial domain variation [A-GEO01].

High-performing interventions in the paper included strategies involving:

- citations
- quotations
- statistics
- authoritative/clear presentation

Keyword stuffing did not perform as a useful strategy in the study.

### Correct interpretation

The paper supports the hypothesis that **evidence-rich, attributable content can improve generative-engine visibility**.

### Incorrect interpretation

> “Add statistics and your ChatGPT citations increase 40%.”

The research was a specific benchmark/system configuration. Production engines in 2026 differ materially. Treat the direction as academically supported; validate the exact effect locally.

## 25.2 Stanford citation-verifiability research

Liu, Zhang & Liang audited four generative search engines and found that, in their 2023 study, only 51.5% of generated sentences were fully citation-supported and 74.5% of citations actually supported the associated claim [A-GEO02].

### Strategic implication

- AI citations are not infallible
- being cited is not proof that the system represented your page correctly
- monitor how the brand/facts are summarized
- make claims unambiguous
- maintain canonical source pages

## 25.3 ACL 2026 cross-engine research

Kirsten et al. compared Google organic search with generative search systems from Google, OpenAI and Perplexity and found meaningful differences in source diversity, retrieval footprint and stability across systems [A-GEO03].

### Implication

There is no single deterministic “AI ranking”.

Measure:

- multiple engines
- repeated observations
- citation/mention trends
- query families

not one screenshot.

## 25.4 Emerging 2026 research

A 2026 preprint on “citation selection vs citation absorption” found that high-influence pages in its dataset tended to be longer, more structured, semantically aligned and rich in extractable evidence such as definitions, numerical facts, comparisons and procedures [A-GEO04].

Useful as **emerging descriptive evidence**, not a settled ranking law.

---

# 26. llms.txt — correct 2026 policy

`llms.txt` is a community proposal, not an open-web search standard comparable to robots.txt or sitemap.

**V2 classification:** `C — Low-cost optional`, but only when a concrete downstream service/tool documents that it consumes the file. Google Search explicitly says the file has neither positive nor negative Search visibility/ranking impact [G-UPDATE01].

The correct decision is therefore not “always add it” or “never add it”, but:

```text
Does a system we care about consume it?
  YES → maintain a small, accurate file if the cost is negligible.
  NO  → skip it; do not create maintenance debt for a hypothetical crawler.
```

Google clarified on June 15, 2026:

- Google Search does not need it
- Google Search does not use it for positive or negative visibility/ranking impact
- maintaining it is fine for other services that choose to use it [G-UPDATE01]

## Playbook rule

### May use when

- a specific downstream system explicitly documents support
- it provides documentation convenience
- maintenance cost is negligible

### Never use as substitute for

- crawlable HTML
- robots.txt
- sitemap
- canonical
- structured data
- actual content
- OAI-SearchBot access

### Classification

`OPTIONAL / SERVICE-SPECIFIC`, not “SEO requirement”.

---

# 27. Brand mentions and distributed authority in AI search

Large industry datasets increasingly show that AI visibility correlates with broad brand presence across the web.

Ahrefs' 2025 study of 75,000 brands found branded web mentions correlated more strongly with AI Overview brand visibility than raw backlink counts in its dataset [IND01]. A broader 2025 analysis across ChatGPT, AI Mode and AI Overviews again found strong correlations with branded web mentions and especially YouTube mentions [IND02].

## Important caveat

These are correlations.

They do **not** prove:

```text
mention → ranking boost
```

Large, trusted brands naturally have:

- more mentions
- more search demand
- more links
- more content
- more customers
- more press

All can confound the relationship.

## Robust strategic conclusion

Build a brand that is genuinely discussed and referenced in relevant contexts across the web.

Not because “mentions are the new backlinks”, but because distributed reputation:

- creates discovery
- creates corroborating sources
- creates brand demand
- creates editorial links
- creates user trust
- increases the probability that retrieval systems encounter the entity in meaningful contexts

---

# 28. AI citation strategy

## 28.1 Three goals

### Citation
Your page is linked as a source.

### Mention
Brand/entity appears in answer, linked or not.

### Absorption
Information from your content materially shapes the answer.

These are different outcomes.

Ahrefs' own brand study found that AI systems can mention a brand without linking it, illustrating why citation counts alone understate or misrepresent visibility [IND03].

## 28.2 Content likely to deserve citation

Prioritise assets that contain:

- original data
- primary documentation
- definitive definitions
- current specifications
- transparent comparisons
- first-hand tests
- reference tables
- methodologies
- unique expert analysis
- real case studies

## 28.3 Citation hygiene

When citing external claims:

- use primary source when available
- link directly to supporting source
- do not cite irrelevant “authority” sites
- use exact dates
- quote sparingly and accurately
- separate evidence from opinion

Google explicitly says external links can help establish trustworthiness when used to cite sources [G-LINK01].

---

# 29. AI search myth ledger

| Claim | Verdict | Reason |
|---|---|---|
| “GEO replaces SEO” | **False** | Google says AI features are rooted in Search systems; Bing grounding builds on index/search. |
| “Need llms.txt for Google AI” | **False** | Google explicitly says no impact [G-UPDATE01]. |
| “Need special AI schema” | **False for Google Search** | Google says no special markup required [G-AI01]. |
| “FAQ schema gets you AI citations” | **Unsupported** | FAQ rich result removed; no official AI-citation mechanism. |
| “Write in 200-word chunks for LLMs” | **Unsupported universal rule** | Clarity helps; fixed chunk size not documented. |
| “AI search only cites top-10 Google results” | **False/overstated** | Engines use different retrieval/selection layers; studies show source footprints differ [A-GEO03]. |
| “Backlinks no longer matter” | **False** | Links still matter for discovery/relevance and classic Search; AI visibility adds other source/brand dimensions. |
| “Unlinked mentions are a confirmed ranking factor” | **Unproven** | Industry correlation ≠ causation [IND01][IND02]. |
| “Just publish more pages” | **False** | Low-value scaled content can violate spam policies. |
| “AI-written content is automatically penalized” | **False** | Google focuses on value/purpose, not creation method; scaled low-value abuse is the issue [G-CONTENT01][G-SPAM01]. |
| “Training crawler block removes you from AI Search” | **False as a universal rule** | Search and training controls are separate for Google/OpenAI [G-CRAWL01][OAI01]. |

---


# 30. Link earning: byg fortjente forbindelser, ikke et linkskema

Links er stadig en central del af web discovery og relevance. Google siger direkte, at links bruges til både at opdage sider og som et signal til at forstå relevans [G-LINK01]. Det betyder ikke, at “flest backlinks” er målet.

Den robuste standard er:

> **Skab assets, relationer og historier, som relevante tredjeparter har en reel grund til at referere til.**

## 30.1 Hvad et godt link faktisk gør

Et stærkt eksternt link kan samtidig skabe:

- referral traffic
- discovery/crawling
- topical context
- editorial validation
- brand awareness
- future mentions
- customer trust
- source eligibility for classic og generative search

Det er bedre at tænke i **editorial usefulness** end i “link juice”.

## 30.2 Link quality framework

Vurder en potentiel omtale/link på:

1. **Topical relevance** – er kilden faktisk relevant for emnet?
2. **Editorial independence** – valgte redaktionen/kilden selv at referere?
3. **Real audience** – har siden faktiske læsere/brugere?
4. **Context** – er linket en naturlig del af argumentet?
5. **Destination quality** – peger det til det bedste primære asset?
6. **Traffic/reputation value** – ville omtalen stadig være værdifuld uden SEO-effekt?
7. **Spam risk** – er mønstret skaleret, købt eller manipulerende?

Hvis værdien kun eksisterer, fordi man håber at påvirke ranking, er strategien sandsynligvis for tæt på et linkskema.

## 30.3 Assets der naturligt kan fortjene links

Prioritér:

- originale datasæt
- årlige benchmarks
- calculators/tools
- åbne templates
- definitive reference guides
- visualiseringer og kort
- originale frameworks
- undersøgelser/surveys med metode
- research reports
- ekspertdrevne glossaries/taxonomier
- offentligt dokumenterede case studies
- nye tekniske findings
- brancheoversigter med primærdata

“Vi skrev endnu et generisk blogindlæg” er sjældent en link earning-strategi.

## 30.4 Outreach

God outreach er:

- selektiv
- relevant
- kort
- transparent
- værdibaseret
- sendt til en person, der faktisk arbejder med emnet

Den bedste pitch besvarer:

```text
Why this source?
Why this journalist/editor/creator?
Why now?
What is genuinely new/useful?
Where is the underlying evidence?
```

Undgå massedistribution af identiske pitches.

## 30.5 Broken links, resource pages og unlinked mentions

Disse er acceptable som **discovery tactics**, hvis de bruges naturligt:

- find en relevant ressource, der er forsvundet
- tilbyd en reelt tilsvarende eller bedre kilde
- find eksisterende brand mentions uden link
- gør redaktøren opmærksom på den korrekte canonical source

De er ikke i sig selv “ranking hacks”. Kvaliteten af den konkrete relation og destination afgør værdien.

---

# 31. Digital PR og earned media

Digital PR bør behandles som **reputation + distribution + citation earning**, ikke som en måde at købe PageRank.

## 31.1 Earned > paid for authority claims

En uafhængig journalistisk omtale er fundamentalt anderledes end et betalt advertorial.

### Earned editorial

- redaktionen vælger historien
- kan skabe genuine links/mentions
- bygger tredjepartsvalidering
- kan blive citeret af andre medier
- kan blive retrieved af søge-/AI-systemer som corroborating source

### Paid/sponsored media

Kan stadig have værdi for:

- distribution
- awareness
- branded search demand
- referral traffic
- audience trust
- market education

Men Google klassificerer købte links eller advertorial-links, der sender ranking credit, som link spam [G-SPAM01]. Betalte links bør derfor håndteres med passende `rel="sponsored"` eller `nofollow` efter Googles guidance [G-LINK02].

**Rule:** køb aldrig en artikel primært for at få et followed SEO-link.

## 31.2 Newsworthiness framework

En historie har større chance for earned coverage, hvis den indeholder mindst én stærk news value:

- nyt data point
- ny undersøgelse
- markant trend
- first-to-market observation
- local relevance
- konflikt/ændring med reel samfunds- eller branchebetydning
- ekspertanalyse på en aktuel begivenhed
- unik access
- transparent benchmark

Virksomhedens eksistens er ikke i sig selv en nyhed.

## 31.3 Source package til journalister

Forbered en public source page med:

- 3–5 hovedfindings
- metode
- sample size
- definitions
- tidsperiode
- rå tabeller eller downloadable data, hvor muligt
- kontaktperson med reel ekspertise
- billeder/charts med rettigheder
- publication/update date
- disclosure af interessekonflikter

Det gør både journalistisk arbejde og senere machine retrieval nemmere.

## 31.4 “Billig high-authority PR” — korrekt model

Der findes ikke en legitim, permanent liste over billige mediesider, hvor man kan købe sig til “authority”. Hvis en placement kan købes systematisk alene for SEO-værdi, er det netop et signal om risiko.

Den robuste lavomkostningsmodel er i stedet:

1. Producer original evidence.
2. Byg en journalist-/creator-liste per beat.
3. Reagér hurtigt på aktuelle stories.
4. Tilbyd usable expert commentary.
5. Publicér underlying source på eget domæne.
6. Gør charts/data genbrugelige med attribution.
7. Følg op én gang, ikke spam.
8. Dokumentér earned mentions og referral outcome.

## 31.5 Expert commentary

En virksomhed kan bygge authority ved konsekvent at være en stærk kilde i sin kategori.

Krav:

- named expert
- præcis credential/context
- konkret, ikke generisk quote
- evidence eller clearly labeled opinion
- hurtig response time
- ingen fake “experts”

Dette kan bygge både entity clarity og source portfolio over tid.

---

# 32. Reddit, fora og communities

Reddit og nichefora kan være meget værdifulde, fordi de indeholder first-hand erfaringer, problemløsning og sprog fra rigtige brugere. Google har en officiel Data API-partnership med Reddit, der giver mere struktureret adgang til public posts/comments [RED01]. Det betyder **ikke**, at man bør masseposte SEO-indhold.

Reddit opdaterede i 2026 sin spam-policy med tydelige forbud mod repetitive, unsolicited og masseskalerede engagement patterns [RED02].

## 32.1 Den eneste holdbare community-strategi

> **Deltag som et ægte medlem af communities, hvor virksomheden faktisk har noget nyttigt at bidrage med.**

Gode contribution-types:

- detaljerede svar
- førstehåndserfaring
- troubleshooting
- originale data
- transparent comparison
- “how we solved X”
- public tool/resource når direkte relevant
- founder/expert AMA når community tillader det

## 32.2 Commercial disclosure

Hvis du repræsenterer virksomheden:

- sig det
- følg subreddit/forum-regler
- link kun når resource er direkte relevant
- skriv svaret selvstændigt nyttigt uden link
- undgå astroturfing/falske kunder

## 32.3 Hvad der ikke må gøres

- fake Reddit accounts, der “anbefaler” eget brand
- købte upvotes
- vote manipulation
- mass-posting af samme link
- automatiserede kommentarer for exposure
- opdigtede testimonials
- copy/paste svar på tværs af communities
- skjult employee advocacy

Det er både platform-risk og reputation-risk.

## 32.4 Community listening som research

Community-data er særligt stærkt til:

- vocabulary
- objections
- alternatives
- comparison criteria
- pain points
- questions
- emerging category language

Process:

```text
collect recurring questions
→ cluster by intent/problem
→ identify unanswered/high-friction topics
→ answer inside community where appropriate
→ build a stronger canonical resource on owned site
→ update resource from real user language
```

## 32.5 Community page ≠ doorway page

Lav ikke en website-side for hver Reddit-tråd eller hver mikrofrase. Community insight skal konsolideres til faktisk nyttige assets.

---

# 33. Distributed content: YouTube, social og platform properties

Organic discoverability stopper ikke ved eget domæne.

Google gjorde i juli 2026 Search Console Platform Properties globalt tilgængeligt for Instagram, TikTok, X og YouTube, så creators/sites kan måle, hvordan social- og videoposts bliver fundet i Google Search og Discover [G-SOCIAL01]. Det gør distributed content til en eksplicit målbar search surface.

## 33.1 Hub-and-spoke modellen

```text
OWNED SOURCE ASSET
    ↓
YouTube / social / community / newsletter / press
    ↓
brand discovery + mentions + links + queries
    ↓
owned source remains canonical evidence
```

Ikke alt skal republiseres identisk. Tilpas format til platformen.

## 33.2 YouTube som search surface

YouTube er både search engine, recommendation platform og Google-indexed content surface.

Prioritér:

- query/problem-aligned topic
- præcis title
- compelling men korrekt thumbnail
- description der forklarer videoens værdi
- chapters/timestamps hvor nyttigt
- transcript/captions
- genuine watch value
- tydelig first-hand demonstration
- relevant link til canonical source/resource

YouTube siger selv, at Search vurderer relevance, engagement og quality, og at title, tags, description og selve videoens content kan bruges til query matching [YT01]. Tags har begrænset rolle ud over fx almindelige stavefejl [YT02].

## 33.3 Social posts som searchable assets

En social post kan være nyttig hvis den:

- besvarer et konkret spørgsmål
- indeholder first-hand demonstration
- opsummerer original research
- viser et framework
- skaber branded demand
- bliver diskuteret/citeret af andre

Optimer ikke posts som keyword-stuffed mini-webpages. Skriv naturligt, konkret og platform-native.

## 33.4 Cross-platform consistency

Hold centrale entity facts konsistente:

- brandnavn
- description/category
- website URL
- founders/experts
- location hvor relevant
- product naming
- visual identity

Det reducerer entity ambiguity.

## 33.5 Search Profiles as cross-platform aggregation

For eligible publishers/creators, Google Search Profiles can connect website + social/video accounts into a Google-hosted source profile [G-PROFILE01]. This makes cross-platform consistency operationally useful rather than merely cosmetic.

Treat the profile as:

- entity consolidation
- follower/distribution surface
- source discovery

not as a PageRank/link scheme.

## 33.6 Social proof vs search proof

En stor follower count er ikke en dokumenteret Google-ranking factor.

Men distribution kan indirekte skabe:

- links
- mentions
- branded searches
- press
- direct traffic
- user familiarity
- fresh discovery

Mål de faktiske pathways; antag ikke en direkte social-signal ranking-effekt.

---

# 34. Local SEO

For lokale virksomheder er Google Business Profile og on-site/local corroboration en særskilt discovery-stack.

Google beskriver de tre primære lokale rankingfaktorer som **relevance, distance og prominence** [G-LOCAL01]. Distance kan ikke “optimeres” væk; fokusér på relevance og prominence uden manipulation.

## 34.1 Google Business Profile baseline

- claim og verify profile
- korrekt business name
- korrekt primary/secondary category
- adresse/service area korrekt
- opening hours inkl. special hours
- phone + website
- services/products hvor relevante
- high-quality photos/video
- løbende updates hvor de giver bruger-værdi

Keyword-stuff ikke business name.

## 34.2 Local landing pages

Lav en location/service page når der findes en **reel lokal forskel eller service presence**.

En god lokal side indeholder fx:

- service + location
- hvem siden er til
- lokal availability
- team/place information
- konkrete lokale cases
- address/service area
- opening/contact
- unique FAQ baseret på lokale forhold
- LocalBusiness/Organization structured data hvor validt

Undgå hundrede city doorway pages med næsten identisk tekst.

## 34.3 NAP/entity consistency

Name, Address, Phone og website bør være konsistente på:

- website
- Google Business Profile
- Bing Places
- relevante branchekataloger
- social profiles
- lokale brancheforeninger

Ikke fordi hvert katalog-link er værdifuldt, men fordi konsistent factual corroboration reducerer ambiguity.

## 34.4 Reviews

Google siger, at flere reviews og positive ratings kan bidrage til local prominence [G-LOCAL01].

Golden standard:

- bed rigtige kunder om ærlig feedback
- gør request-processen let
- svar professionelt på reviews
- brug feedback operationelt
- aldrig køb/fabrikér reviews
- incentiviser ikke uden at overholde platform/policy og disclosure

## 34.5 Local authority

Stærke lokale sources kan være:

- kommune/organisationer
- handelsstandsforening
- lokale events
- lokale medier
- branchepartnerskaber
- sponsorater med reel aktivitet
- universiteter/uddannelsesinstitutioner

Målet er reel community presence, ikke directory-volume.

---

# 35. Ecommerce SEO

Ecommerce kræver sammenhæng mellem crawlable site structure, produktdata, structured data, feed quality og commercial UX.

Google anbefaler både product structured data på sitet og Merchant Center-feed for bredere/rigere commerce eligibility [G-ECOM01][G-ECOM02].

## 35.1 Product page standard

Hver vigtig produktside bør have:

- unik product title/H1
- stabil canonical URL
- original description
- specifications
- pris
- availability
- shipping/returns information hvor relevant
- high-quality images
- video/demo hvis værdifuldt
- reviews hvor genuine
- Product/Offer structured data
- internal links til category/related resources

Manufacturer copy alene skaber sjældent differentiering.

## 35.2 Category pages

Category pages kan være stærke search landing pages når de tilbyder mere end et grid.

Tilføj hvor nyttigt:

- klar category definition
- relevant filters
- buying guidance
- comparison factors
- FAQ hvis det faktisk hjælper
- crawlable pagination/navigation

Undgå massiv boilerplate under produktlisten kun for keywords.

## 35.3 Faceted navigation

Facets kan eksplodere URL-rummet.

For hver filterkombination spørg:

```text
Har denne kombination reel selvstændig search/user value?
```

Hvis nej:

- undgå crawl traps
- kontrollér URL-generation
- canonicaliser hvor relevant
- brug noindex med omtanke
- link ikke unødigt til værdiløse combinations

Hvis ja, kan en curated landing page være bedre end en rå parameter-URL.

## 35.4 Product variants

Definér en stabil variant-model:

- separate URLs kun hvis variant har selvstændig user/search value
- korrekt canonical relation
- consistent product IDs
- structured data matcher synlig side
- out-of-stock håndteres efter varighed/intention

## 35.5 Product feeds

Feed og website skal være konsistente i:

- title
- identifiers
- price
- availability
- shipping
- images
- URL

Feed-fejl er ikke kun “shopping”-problemer; de skaber factual inconsistency omkring entity/product.

## 35.6 Agentic commerce / UCP — discovery becomes actionability

For ecommerce er 2026-stack'en ikke længere kun:

```text
product page → Search result → click → checkout
```

Google's Universal Commerce Protocol (UCP) enables approved merchants to expose capabilities for agentic shopping/checkout on surfaces such as AI Mode in Search and Gemini [G-UCP01]. Merchant Center remains the underlying discovery/data foundation, while UCP adds transaction/action capability.

Google has also introduced conversational product attributes and explicitly says strong product descriptions are important for discovery in AI-era shopping [G-MERCHAI01].

**V2 classification: B — context-dependent high value for eligible commerce sites.**

Prioritise in this order:

1. accurate crawlable product pages
2. canonical product identity + identifiers
3. high-quality Merchant Center feed
4. Product/Offer structured data
5. accurate price/inventory/shipping/returns
6. rich, factual, conversational product attributes where supported
7. UCP integration when eligibility, market and economics justify it

Do **not** call UCP an SEO ranking factor. It is an **agentic actionability layer** that can turn AI discovery into direct commerce.

### UCP technical note

Google's current guide uses a public `/.well-known/ucp` profile to advertise supported services/capabilities [G-UCP01]. The protocol and Google support are evolving; live-check spec version, country availability, approval requirements and Merchant Center status before implementation.

## 35.7 Reviews og comparisons

Hvis virksomheden publicerer egne editorial reviews/comparisons, anbefaler Google first-hand evidence, measurements, pros/cons, competitive differentiation og decision factors [G-REVIEWS01].

Affiliate/comparison content uden reel testing er ikke gold standard.

---

# 36. Image SEO

Google Images, Lens, Discover og text-result thumbnails kan være betydelige discovery surfaces.

Google anbefaler standard HTML image elements, relevant page context, descriptive alt text og high-quality men performance-efficient images [G-IMAGE01].

## 36.1 Image checklist

- brug `<img>` / `<picture>` korrekt
- relevant image tæt på relevant tekst
- descriptive filename når praktisk
- meningsfuld alt text
- responsive `srcset`
- moderne compressed format hvor passende
- stable accessible URL
- width/height for layout stability
- high-resolution originals for visual surfaces
- `og:image` / structured image property hvor relevant
- image sitemap når discovery ellers er vanskelig

## 36.2 Alt text

Alt text har primært accessibility- og comprehension-værdi.

Skriv hvad billedet betyder i konteksten.

Ikke:

```text
seo agency seo company best seo services denmark
```

Men fx:

```text
Diagram der viser crawl → index → ranking-processen i Google Search
```

## 36.3 Original visuals

Originale:

- charts
- product photos
- diagrams
- screenshots
- before/after documentation
- process illustrations

kan samtidig gøre content mere nyttigt, mere linkable og lettere at citere.

---

# 37. Video SEO

Google kræver, at video og watch page kan opdages/indexeres; dedikerede watch pages er nødvendige for visse video features, og stable thumbnail/video URLs er vigtige [G-VIDEO01].

## 37.1 On-site video standard

Når video er en central asset:

- dedicated watch page hvor video er primary content
- unique title + description
- transcript/summary
- stable thumbnail
- stable video URL hvor muligt
- VideoObject structured data
- video sitemap hvis relevant
- crawlable embed
- no click-to-load dependency for discovery
- chapter/key moment data hvor værdifuldt

## 37.2 Embedded YouTube

En YouTube-video kan ranke på YouTube-siden og på din egen watch page. Det er ikke nødvendigvis et problem.

Owned page bør tilføre:

- transcript
- data
- references
- related assets
- conversion path
- unique surrounding value

## 37.3 Video strategy

Video er særligt stærkt til:

- demonstrations
- tutorials
- comparisons
- expert commentary
- product walkthroughs
- first-hand reviews
- visual processes

Lav ikke video bare for at “have video SEO”.

---

# 38. Google Discover

Discover er recommendation/discovery, ikke klassisk query ranking.

Google siger, at enhver indekseret side, som overholder Discover policies, automatisk kan være eligible; der kræves ikke speciel markup [G-DISCOVER01]. Eligibility garanterer ikke traffic.

## 38.1 Content patterns der passer Discover

- timely topic insight
- original reporting
- first-hand perspective
- strong visuals
- clear non-clickbait headline
- topical expertise
- useful evergreen content, når det matcher brugerinteresse

## 38.2 Visual standard

Brug store, relevante, high-quality billeder. Google anbefaler bl.a. store billeder og `max-image-preview:large` for at være eligible til større previews i Discover [G-DISCOVER01].

## 38.3 Discover som bonus, ikke forecast

Discover traffic kan være volatil.

Brug den til:

- incremental reach
- audience discovery
- brand building

Men byg ikke en business case, der kræver et bestemt Discover-volume hver måned.

## 38.4 Search Profiles / follows

For eligible publishers/creators can Search Profile followers make linked content more likely to appear for that follower in Discover [G-PROFILE01]. Treat this as audience-retention/distribution, not as a universal Discover ranking shortcut.

---

# 39. Google News og journalistisk content

Google News kræver ikke længere manuel Publisher Center-opsætning for consideration; eligible publishers identificeres automatisk [G-NEWS01]. Google beskriver rankingfaktorer som relevance, prominence, authoritativeness, freshness, usability, location og language [G-NEWS02].

## 39.1 Hvornår News er relevant

Kun hvis virksomheden faktisk producerer journalistisk eller newsworthy indhold.

Det er ikke en kanal til:

- fake press releases
- evergreen service pages forklædt som news
- sponsored content forklædt som editorial

## 39.2 News page standard

- clear headline
- byline
- publish date/time
- update date/time ved reel update
- original reporting
- source attribution
- author/contact transparency
- stable URL
- relevant image
- no deceptive date refreshing

## 39.3 Originality

For news og AI retrieval er den stærkeste position ofte at være **primær kilde**, ikke den 40. artikel der omskriver den første.

## 39.4 Preferred Sources

For genuine publications/news-producing brands, Google's Preferred Sources can turn existing reader loyalty into additional user-specific visibility in Top Stories and, where available, AI Overviews/AI Mode [G-PREF01].

This is best treated as **owned-audience activation**, not a ranking hack: encourage existing loyal readers to opt in; do not fabricate selections or confuse the feature with general authority.

---

# 40. Reviews, reputation og trust surfaces

Reviews påvirker både menneskelig conversion og local/entity perception. Google har et særskilt reviews system, der søger at belønne in-depth, expert/enthusiast content med original research [G-REVIEWS01].

## 40.1 Customer reviews

Opsaml:

- verified/genuine experience
- product/service context
- date
- reviewer identity inden for privacy/policy

Brug ikke fake eller undisclosed incentivized reviews. Google structured data guidelines afviser netop fake/undisclosed incentivized reviews [G-REVIEWSD01].

## 40.2 Self-serving review markup

For LocalBusiness/Organization er self-serving reviews på eget site ikke eligible for Googles star review feature, selv når reviewet kommer fra en third-party widget [G-REVIEWSD01].

Structured data skal afspejle synligt content; schema er ikke en måde at opfinde reputation-signaler på.

## 40.3 Reputation monitoring

Monitorér:

- Google reviews
- industry review platforms
- Reddit/forum mentions
- social comments
- media coverage
- branded search suggestions/queries

Brug mønstre som produkt- og content research, ikke kun som PR problem.

---

# 41. Tools, calculators og interactive utilities

Et godt tool kan være et af de stærkeste organic assets, fordi det løser en opgave i stedet for blot at beskrive den.

Eksempler:

- calculator
- assessment
- estimator
- template generator
- checklist builder
- benchmark lookup
- public database
- converter
- interactive comparison

## 41.1 Tool SEO standard

Selve tool-interface skal have crawlable forklaring omkring sig:

- hvad tool gør
- inputs
- methodology
- assumptions
- worked examples
- limitations
- output interpretation
- author/owner
- related reference content

Undgå at skjule al værdi bag client-side JS, som crawleren ikke kan forstå i rendered DOM.

## 41.2 Tool as source asset

Hvis tool producerer unik data, kan anonymiserede aggregate insights skabe:

- reports
- benchmarks
- PR stories
- citations
- category authority

Sørg for privacy og metodisk transparens.

---

# 42. Third-party publishing: hvornår og hvordan

At publicere på andre domæner kan være legitim distribution. Men Google har specifikt en **site reputation abuse** policy mod third-party content, der publiceres primært for at udnytte værtsdomænets etablerede ranking signals [G-SRA01]. I august 2026 justerede Google enforcement i EEA men fastholdt policy-intentionen [G-SRA02].

## 42.1 Legit third-party publishing

Godt:

- genuine guest expert article til relevant audience
- contributed research
- interview
- op-ed med reel ekspertise
- conference/association publication
- product documentation/integration partner page
- co-authored research

## 42.2 Risky model

Dårligt:

```text
high-authority newspaper domain
+ irrelevant subfolder
+ paid article
+ exact-match keyword content
+ followed commercial links
+ no editorial value
```

Det er netop den type authority-renting, man ikke skal bygge en durable strategi på.

## 42.3 Canonical vs unique contribution

Hvis samme content syndikeres:

- vær klar over hvilken version der er canonical/source
- undgå at skabe dozens af identiske copies uden formål
- unikt tilpasset contribution er normalt bedre for reader value

## 42.4 Source portfolio

Målet er ikke “100 websites med brandet”.

Målet er en troværdig portfolio:

```text
owned site
+ official profiles
+ real customer reviews
+ communities
+ expert contributions
+ media/editorial
+ YouTube/social
+ partners/associations
+ primary databases/directories where relevant
```

En sådan portfolio skaber corroboration uden at ligne et manipuleret citation network.

---

# 43. Measurement architecture

Organic discoverability kan ikke styres med én metric.

Brug fire lag:

```text
1. ELIGIBILITY / TECHNICAL HEALTH
2. VISIBILITY
3. ENGAGEMENT / QUALIFIED VISITS
4. BUSINESS VALUE
```

## 43.1 Technical health

Monitorér:

- indexable URL count
- indexed canonical pages
- crawl errors
- robots/noindex mistakes
- canonical conflicts
- redirect errors/chains
- XML sitemap health
- structured data validity
- Core Web Vitals
- rendering failures
- hreflang issues
- security/manual actions

Search Console skal bruges til indexing, URL inspection, security og field CWV-data [G-SC01].

## 43.2 Classic search visibility

Google Search Console:

- impressions
- clicks
- CTR
- average position
- query groups
- landing pages
- country
- device
- search appearance

Vigtigt: “average position” er en aggregeret metric med mange caveats. Den skal bruges som trend-/diagnostic signal, ikke som absolut rank truth [G-SC02].

### Segmentér mindst

- branded vs non-branded
- topic cluster
- page type
- intent
- market/language
- new vs existing content
- classic web vs image/video/news/discover hvor data er tilgængelig

## 43.3 Google generative search

Pr. august 31 2026 har Google rullet dedikerede Generative AI-performance views i Search Console globalt ud, herunder visibility i AI Overviews, AI Mode og generative features i Discover [G-GENREPORT01].

Monitorér:

- generative impressions
- generative clicks
- page/topic coverage
- trend over tid
- classic vs generative mix
- conversion quality fra generative clicks

Google siger samtidig, at AI-feature traffic fortsat indgår i overall Search performance [G-AI01].

**Vigtigt:** en impression er ikke det samme som at være den centrale kilde i et AI-svar. Brug data til trend, ikke til at inferere mere end rapporten faktisk viser.

## 43.4 Bing AI / Copilot

Bing Webmaster Tools' AI Performance viser i 2026 bl.a. [B-AI01]:

- total citations
- average cited pages
- grounding queries
- URL-level citation activity
- visibility trends

Microsoft siger eksplicit, at citation count **ikke** er det samme som authority/ranking/placement.

Bing expanded the preview in June 2026 with **Intents, Topics, Citation Share and Compare**, which makes topic-level GEO measurement more practical [B-AI03]. These are still visibility/diagnostic metrics, not public ranking weights.

Brug data til:

```text
Which pages are cited?
For which grounding-query families?
Which source types get reused?
What content gaps exist?
What changes after refreshes?
```

## 43.5 ChatGPT Search

OpenAI oplyser, at referrals fra ChatGPT Search kan indeholde `utm_source=chatgpt.com`, hvilket gør referral measurement mulig [OAI01].

Monitorér i analytics:

- source/referral
- landing page
- engaged sessions
- conversion rate
- assisted conversions
- new-user share
- downstream revenue/lead quality

Men ChatGPT Search visibility i sig selv har ikke et Search Console-lignende publisher dashboard med fuld query/citation coverage i den aktuelle dokumentation. Brug derfor en kombination af referrals, representative prompt panels og source audits.

## 43.6 Claude and Perplexity

Neither Anthropic nor Perplexity currently exposes a Search Console-equivalent publisher dashboard in the official sources used here.

Measure through:

- server logs / verified crawler access
- referral traffic where present
- repeated representative prompt panels
- citations vs brand mentions
- landing-page/business outcomes
- factual representation audits

Keep Claude and Perplexity as separate panels; do not infer performance in one from the other.

## 43.7 Citation vs mention — measure separately

Industry studies increasingly show that **being cited** and **being named** are different visibility outcomes. A Semrush/Kevin Indig dataset found many “ghost citations”, where the source was cited but the brand was not named in the answer; patterns also varied materially by engine [IND04]. Another large 2026 Semrush analysis argues for measuring topic-level visibility across prompt families rather than one prompt at a time [IND05].

Treat these as industry observations, not ranking-factor proof.

Recommended dimensions:

```text
SOURCE CITATION RATE
BRAND MENTION RATE
CITED + MENTIONED RATE
TOPIC SHARE OF VOICE
FACTUAL ACCURACY
SENTIMENT / RECOMMENDATION CONTEXT
REFERRAL / CONVERSION VALUE
```

## 43.8 Social/video search visibility

Google Platform Properties kan måle Search/Discover performance for Instagram, TikTok, X og YouTube [G-SOCIAL01].

Det bør indgå i samme organic scorecard, men hold platform content separat fra website performance.

## 43.9 Business outcome

Mål til sidst:

- qualified organic leads
- pipeline
- ecommerce revenue
- contribution profit
- organic-assisted conversions
- signup/product activation
- branded demand
- customer acquisition cost for content/SEO program

Organic er ikke “gratis”. Medregn:

- people
- tools
- content production
- engineering
- PR
- design/video
- external research

---

# 44. Organic KPI tree

## 44.1 Input metrics

- pages published/refreshed
- experiments completed
- technical issues resolved
- original studies shipped
- outreach/source relationships
- expert contributions

Input metrics må aldrig blive success metrics alene.

## 44.2 Coverage metrics

- indexable pages
- indexed pages
- topics/entities covered
- audience questions answered
- content types represented
- languages/markets covered

## 44.3 Visibility metrics

- classic impressions
- top-query coverage
- image/video visibility
- Discover/News reach
- AI generative impressions
- Bing AI citations
- brand mentions
- source citations
- cited + mentioned overlap
- topic-level AI share of voice
- earned editorial references

## 44.4 Engagement metrics

- organic clicks
- engaged sessions
- task completion
- tool usage
- scroll/content interaction hvor meningsfuldt
- video watch quality

## 44.5 Business metrics

- organic qualified conversion
- organic conversion value
- new customer revenue
- pipeline influenced
- contribution profit
- retention/LTV by acquisition source

## 44.6 Quality metrics

- conversion per organic visit
- citation per eligible source asset
- links/mentions per research asset
- refresh recovery rate
- % content with primary evidence
- % important URLs technically healthy

---

# 45. Rank tracking og prompt tracking

## 45.1 Classic rank tracking

Third-party rank trackers er nyttige til:

- fixed keyword panels
- competitor comparison
- SERP feature monitoring
- local/geographic checks

Men Search Console er bedre til faktisk Google impression/click data for eget site.

## 45.2 AI prompt tracking

AI answers er ikke deterministiske SERPs.

Academic research i 2026 finder variation mellem generative engines, over tid og mellem runs i source selection og retrieval footprint [A-GEO03].

Derfor skal prompt tracking bruge:

- representative prompt set
- repeated runs
- fixed market/language/device context hvor muligt
- multiple engines
- citation + mention + sentiment/accuracy separat
- date/time
- source URLs

## 45.3 Prompt panel design

Dæk hele journey:

```text
Category discovery
Problem research
Comparison
Best-for use case
How-to
Alternative to X
Vendor/product facts
Local
Trust / reviews
Implementation questions
```

Undgå kun at tracke brand-prompts. Det måler recognition, ikke category discoverability.

## 45.4 Metrics

Per engine/prompt family:

- brand mentioned? yes/no
- brand cited? yes/no
- owned source cited? yes/no
- source rank/order if interface exposes it
- factual accuracy
- competitor set
- response volatility

Beregn over mange runs, ikke én screenshot.

---

# 46. Organic experimentation

SEO har længere feedback loops end paid media, og der er ingen perfekt randomization i mange setups. Men testing er stadig mulig.

## 46.1 Test hierarchy

### Level 1 — Technical verification

Binært:

- can crawler fetch?
- rendered content present?
- canonical selected?
- schema valid?
- sitemap accepted?

### Level 2 — Before/after with controls

- matched page groups
- holdout categories
- time-series controls
- difference-in-differences hvor muligt

### Level 3 — True split testing

På store templated sites kan SEO split tests randomisere page groups til treatment/control templates.

Test fx:

- title format
- category copy
- internal linking modules
- schema addition
- template information density

Undgå client-side user A/B setups, hvor search crawlers ser inkonsistente versions, medmindre implementation er SEO-safe.

## 46.2 Hypothesis standard

```text
If we change X on page group Y,
we expect visibility/click/conversion metric Z to change,
because mechanism M,
while control group C remains unchanged.
```

## 46.3 Observation window

Afhænger af:

- crawl frequency
- traffic volume
- seasonality
- query volatility
- rollout speed

Stop ikke efter “tre dage, position +2”.

## 46.4 SEO tests vs content judgments

Ikke alt skal testes kvantitativt.

Det er unødvendigt at teste om:

- broken links skal repareres
- fake schema skal fjernes
- duplicate title bug skal fixes
- wrong canonical skal rettes

Brug experiments, hvor outcome er usikkert og beslutningen er material.

---

# 47. New company / new website launch standard

Dette er baseline hver gang et nyt koncept eller en ny virksomhed lanceres.

## Phase 0 — Strategic source of truth

Definér før website-build:

- entity/name
- category
- products/services
- ICP/use cases
- geographies/languages
- proof/evidence
- founders/experts
- core terminology
- branded naming conventions

## Phase 1 — Demand and entity research

- category queries
- problem queries
- comparison queries
- transaction queries
- jobs-to-be-done
- entities/competitors
- real customer language
- SERP/source landscape
- AI prompt landscape
- community questions

Output = topic/entity map, ikke bare keyword spreadsheet.

## Phase 2 — Architecture

Minimum:

```text
/
/about
/product-or-service
/use-cases
/resources
/resources/topic-clusters
/cases or /customers
/contact
/legal
```

Kun sider med reel funktion/value.

## Phase 3 — Technical foundation

- HTTPS
- crawlable navigation
- clean status codes
- robots.txt
- XML sitemap
- canonical
- correct noindex use
- mobile/rendering
- Core Web Vitals baseline
- structured data
- Organization/WebSite/entity markup
- Search Console
- Bing Webmaster Tools
- IndexNow if supported/useful
- analytics/conversion tracking
- OAI-SearchBot decision
- Google-Extended decision

## Phase 4 — Core source assets

Launch ikke kun med marketing copy.

Skab:

- definitive product/service pages
- use cases
- documentation/how it works
- comparison/alternatives where useful and fair
- FAQs as visible content, not schema gimmick
- founder/expert pages
- 3–10 genuinely strong resource assets around the first demand clusters

## Phase 5 — Trust layer

- company identity/contact
- clear authorship
- citations
- policies
- testimonials/cases if real
- social profiles
- Business Profile if local
- external listings only where legitimate

## Phase 6 — Distribution

- customer/community launch
- founder/expert social content
- YouTube/demo if useful
- targeted PR
- associations/partners
- relevant directories/databases
- Reddit/community contributions only where genuine

## Phase 7 — Discovery submission

Google recommends Search Console verification, URL Inspection for a few URLs or sitemap for many; requesting crawl/indexing does not guarantee inclusion [G-INDEX01].

For Bing/ecosystem:

- submit sitemap
- enable IndexNow where supported

Do **not** use Google's Indexing API for normal web pages; official documentation limits it to JobPosting and livestream BroadcastEvent/VideoObject pages [G-INDEXAPI01].

## Phase 8 — 30/60/90-day learning

### Days 0–30

- crawl/index health
- query discovery
- brand/entity consistency
- missing intents
- first links/mentions

### Days 31–60

- improve pages receiving impressions
- build missing support content
- launch first original data/tool asset
- begin targeted earned media

### Days 61–90

- content cluster performance
- AI citation baseline
- conversion quality
- refresh poor-fit pages
- expand only proven topic areas

---

# 48. New product/concept launch standard

For en ny feature, product line eller concept på et eksisterende domain:

## Before announcement

- define canonical product name
- define category and entities
- map existing site overlap
- prepare canonical source page
- product/service structured data where relevant
- documentation/FAQ
- visual/video assets
- measurement tags

## Announcement day

- source page live and crawlable
- internal links from relevant high-value pages
- sitemap lastmod correct
- IndexNow notification where supported
- press/social/community distribution
- Search Console check

## Following weeks

- collect real questions
- expand documentation
- consolidate duplicate announcement posts
- create comparison/use-case resources from demand
- earn third-party validation
- monitor factual AI answers

The canonical owned page should remain the **best source of factual truth**, even while external distribution expands.

---

# 49. Migration / redesign launch standard

Organic visibility can be destroyed by a visually successful redesign.

## 49.1 Pre-migration inventory

Export:

- all indexable URLs
- organic clicks/impressions
- backlinks/referring pages where available
- canonical tags
- titles/H1s
- structured data
- index status
- top conversion landing pages

## 49.2 URL mapping

For every valuable old URL:

```text
old URL → closest equivalent new URL
```

Do not redirect everything to homepage.

## 49.3 Preserve

- content purpose
- major internal links
- metadata where still relevant
- structured data
- media assets
- page intent

A redesign is not permission to erase high-performing information architecture accidentally.

## 49.4 Redirects

Use server-side permanent redirects (301/308) for permanent URL changes [G-REDIR01]. Avoid chains.

## 49.5 Sitemaps

Google's site-move guidance recommends monitoring old/new sitemap behavior during migration [G-MIG01].

## 49.6 Post-launch

- crawl new site
- check 4xx/5xx
- check canonicals
- verify robots/noindex
- inspect top URLs
- monitor old→new traffic shift
- compare impressions/clicks
- keep redirects long enough for users/search systems; avoid premature cleanup

---

# 50. Content operating cadence

## Weekly

- indexing/crawl incidents
- high-value page drops
- query opportunities
- brand/community mentions
- AI factual errors on priority prompts
- new customer questions

## Monthly

- cluster performance
- generative AI Search Console data
- Bing AI citations
- high-impression low-CTR opportunities
- pages losing demand/position
- content gaps
- link/mention portfolio
- local reviews/GBP if relevant
- social/video Search performance

## Quarterly

- topic taxonomy
- cannibalization/overlap
- content decay
- technical crawl
- structured data coverage
- Core Web Vitals
- competitor/source landscape
- original research roadmap
- entity facts/profiles
- prompt panel refresh

## Annual / major strategic cycle

- information architecture
- international structure
- major tooling/data assets
- content portfolio pruning
- search demand/category language shifts
- business-model alignment

---

# 51. Refresh, decay and content portfolio management

Content should not be “updated” merely by changing the date.

## 51.1 Refresh triggers

- facts/specs changed
- regulation changed
- search intent changed
- product changed
- ranking/click decline
- new first-party data available
- source links broken
- competitor/source landscape materially improved

## 51.2 Refresh types

### Factual refresh
Update facts and sources.

### Structural refresh
Improve organization, headings, answer clarity and internal links.

### Evidence refresh
Add data, first-hand experience, citations, examples.

### Intent refresh
Page no longer answers what users now mean.

### Consolidation
Merge overlapping pages.

## 51.3 Delete/noindex/redirect decision

```text
Has current user value?
  yes → improve/keep
  no ↓
Has links/history/equivalent destination?
  yes → redirect/merge
  no ↓
Needs to exist for users but not Search?
  yes → noindex
  no → 404/410/remove
```

Google notes duplicate content itself is not a spam violation, but duplicate URL proliferation can make crawling/tracking/canonical choice less efficient [G-CAN01].

---

# 52. Diagnostic decision trees

## 52.1 “Page is not indexed”

1. Is URL publicly reachable with 200?
2. robots allowed?
3. noindex absent?
4. canonical points correctly?
5. internal links exist?
6. in sitemap?
7. rendered content present?
8. duplicate/near duplicate?
9. sufficient standalone value?
10. URL Inspection result?

Remember: sitemap/requesting crawl does not guarantee indexing [G-INDEX01].

## 52.2 “Impressions fell”

Check:

- site-wide vs page-specific
- branded vs non-branded
- market/device
- indexing issue
- migration/technical change
- algorithm/update timing
- seasonality/demand
- competitor/source change
- SERP layout/AI feature change
- content freshness/intent shift

Do not immediately rewrite all copy.

## 52.3 “Impressions high, CTR low”

Investigate:

- intent mismatch
- title clarity
- snippet/meta usefulness
- rich result competitors
- brand recognition
- position distribution
- SERP feature environment

Google may rewrite title/snippet; title/meta are preferences/inputs, not guaranteed display [G-TITLE01][G-SNIPPET01].

## 52.4 “Traffic high, conversions low”

Likely issue may be:

- informational intent not commercial
- wrong audience
- weak offer
- poor CTA
- landing-page friction
- slow page
- irrelevant keyword cluster

SEO is not solved by more traffic if traffic has no business value.

## 52.5 “AI doesn't cite us”

Check:

1. Is page indexable/searchable?
2. OAI-SearchBot/Bing/Google access correct?
3. Is it actually relevant to prompt/query?
4. Does it contain unique source-worthy information?
5. Are key claims explicit and supported?
6. Is entity/author clear?
7. Is content current?
8. Are there stronger primary sources?
9. Does wider web corroborate entity/topic?
10. Is non-citation simply normal engine variance?

Never jump directly to “add llms.txt”.

## 52.6 “Competitor is cited despite ranking below us”

Possible reasons:

- AI retrieval uses query fan-out
- different source-selection layer
- competitor page matches subquestion better
- stronger direct evidence
- clearer structure
- fresher fact
- source diversity preference
- engine variability

Classic rank and generative citation are related systems, not identical outputs [A-GEO03].

---

# 53. Anti-playbook: ting der aktivt skal undgås

## 53.1 Keyword stuffing

Ikke:

```text
SEO bureau Danmark | SEO firma København | bedste SEO bureau | billig SEO ekspert
```

Google klassificerer keyword stuffing som spam, når ord/numre gentages unaturligt for ranking-manipulation [G-SPAM01].

**Standard:** brug det sprog brugeren anvender, men skriv for comprehension og intent.

## 53.2 “Keyword density” som mål

Der findes ingen dokumenteret optimal procent, og forced repetition kan blive keyword stuffing.

**Men keywords er ikke ligegyldige.** Google anbefaler eksplicit at bruge ord, som mennesker bruger til at finde content, i prominente steder som title, main heading, alt text og link text [G-ESSENTIALS01][G-TITLE01].

Så den korrekte regel er:

```text
Relevant terminology: YES.
Exact density target: NO.
```

Brug:

- clear topic coverage
- actual customer/query language
- natural terminology
- synonyms/entities hvor semantisk relevant
- descriptive titles/headings/anchors
- answer completeness

## 53.3 Meta keywords

Google ignorerer `<meta name="keywords">` for indexing/ranking [G-META01].

**V2 classification: D — no-priority for Google SEO.**

Only maintain it if a specific non-Google internal/vendor system explicitly consumes it. Do not add it “just in case”; unused metadata becomes maintenance debt.

## 53.4 Magical word count

Google siger direkte, at content length alene ikke har en magisk minimum/maksimum ranking threshold [G-STARTER01].

Skriv så meget som opgaven kræver og ikke mere.

## 53.5 Sitemap = ranking boost

False as a **ranking** claim.

But a sitemap is still a **core/near-core infrastructure tactic** because it helps discovery/coverage, carries accurate `lastmod`, and is especially valuable for new, large, rich-media or frequently changing sites [G-SITEMAP01][B-SITEMAP01].

Correct mental model:

```text
ranking boost: NO
crawl/discovery/freshness support: YES
```

## 53.6 “Submit URL again until Google indexes it”

False.

Gentagne indexing requests gør ikke nødvendigvis crawl hurtigere [G-INDEX01]. Fix quality/discovery/technical problem.

## 53.7 Abusing Google Indexing API

Google Indexing API er officielt begrænset til JobPosting og livestream/BroadcastEvent content [G-INDEXAPI01].

Brug den ikke som generisk instant-index hack.

## 53.8 Buying backlinks

Google's spam policy forbyder køb/salg af links for ranking credit [G-SPAM01].

**Do not confuse this with paid distribution.** A paid article, sponsorship or advertorial can still create legitimate value through reach, brand awareness, referral traffic, citations/mentions and future branded demand. The link must be appropriately qualified (`sponsored`/`nofollow` as applicable) and the business case must not depend on passing PageRank [G-LINK02].

## 53.9 PBNs og manufactured authority

Undgå:

- private blog networks
- expired-domain networks
- low-quality guest-post farms
- automated directory blasts
- footer/sitewide link schemes
- reciprocal link rings

De skaber et kunstigt footprint og ingen robust customer/source value.

## 53.10 DA/DR som Google score

Domain Authority, Domain Rating og tilsvarende er tredjepartsmålinger, ikke Google metrics; Google warns that third-party tools do not have access to its internal ranking data [G-THIRDPARTY01].

**V2 classification: C — useful proxy, not truth.**

They can help with outreach/research triage when combined with topical relevance, actual traffic/audience, editorial quality and spam checks, but never as:

```text
DR 80 = Google trusts this domain 80/100
```

## 53.11 “Duplicate content penalty” som generel regel

Google siger generelt, at duplicate content ikke i sig selv er en spam violation [G-CAN01].

Problemet er typisk:

- canonical ambiguity
- wasted crawling
- diluted internal signals
- poor UX
- difficult measurement

## 53.12 Core Web Vitals obsession

CWV er relevante page-experience signals, men perfekte scores garanterer ikke top rankings [G-PX01].

Fix reel UX. Stop med marginal engineering for en “100” score, hvis content/intent er svagt.

## 53.13 Fake freshness

Ændr ikke “updated today” uden reel content change. Dates skal repræsentere faktiske publication/update events [G-DATE01].

**Nuance:** Google documents freshness systems for queries where recent information is expected [G-RANK01]. Genuine substantive refreshes can therefore be strategically valuable when facts, products, laws, prices, software, news or user expectations change. The anti-pattern is changing dates without changing value.

## 53.14 Schema spam

Structured data må kun beskrive synligt, faktisk content og giver ikke en general ranking guarantee [G-SD01][G-SD02].

**But supported schema is often worth doing.** It can improve machine-readable clarity and eligibility for relevant rich/search features. The correct rule is “implement accurate supported markup where it unlocks a concrete feature or clarifies important entities”, not “schema doesn't rank, so ignore it”.

## 53.15 FAQ schema cargo cult

Google fjernede FAQ rich result feature i 2026 [G-UPDATE01]. There is no official evidence that FAQ markup earns AI citations.

**FAQ content is different from FAQ schema.** A visible FAQ can still be excellent content when users genuinely have repeated questions, because it gives direct, structured answers. Keep useful FAQ content; do not add obsolete markup solely as a “GEO hack”.

## 53.16 llms.txt as magic GEO file

Google siger direkte, at `llms.txt` hverken positivt eller negativt påvirker Google Search visibility/ranking [G-UPDATE01].

**V2 classification: C — low-cost optional.** Maintain it only if a concrete service/system you care about consumes it, or if it meaningfully improves your own documentation tooling. Keep it small and accurate. Do not infer Google/ChatGPT/Claude/Perplexity ranking benefit without provider evidence.

## 53.17 Mass AI content

Creation method er ikke problemet. Low-value scaled content lavet primært for manipulation er [G-SPAM01].

## 53.18 One page per long-tail variation

```text
best crm for dentists
best crm for dental clinics
crm for dentist office
crm dental practice software
```

Fire sider er kun berettigede hvis user need/content faktisk er forskelligt. Ellers konsolidér.

## 53.19 Parasite/site-reputation SEO

Publicér ikke commercial third-party pages på stærke medier/domæner primært for at leje deres authority [G-SRA01][G-SRA02].

## 53.20 Fake Reddit/forum seeding

Ikke acceptable:

- falske personas
- fake recommendations
- bought upvotes
- spam automation

Reddit forbyder manipulation/massespam, og reputation downside er større end den kortsigtede upside [RED02].

## 53.21 “AI citations = top Google rankings”

Overstated. Generative engines bruger retrieval/source selection, som ikke er identisk med klassiske SERPs [A-GEO03].

## 53.22 Exact prompt optimization

Lav ikke 100 sider efter 100 prompts. Query/prompt rewriting og fan-out gør matching mere semantisk end en exact-string strategi [G-AI01][OAI02].

## 53.23 Purchased reviews

Fake og undisclosed incentivized reviews bryder trust og kan bryde platform guidelines [G-REVIEWSD01].

## 53.24 Search traffic as sole KPI

10.000 irrelevante visits er ikke bedre end 500 høj-intent visits, hvis business outcome er værre.

## 53.25 “It can't hurt, so do it”

This is not a sufficient decision rule.

Every tactic can create:

- implementation time
- maintenance burden
- stale/conflicting metadata
- complexity during migrations
- false confidence
- distraction from higher-value work

A harmless optional tactic is worth doing only when:

```text
known beneficiary
× plausible benefit
> build + maintenance cost
```

Examples:

- XML sitemap: usually YES — known crawlers consume it, tiny cost.
- Supported Product schema: YES for eligible ecommerce — known feature eligibility.
- `llms.txt`: MAYBE — only with a known consumer/use case.
- meta keywords: usually NO for Google — no known Search benefit.
- exact 2% keyword density: NO — no valid mechanism and can degrade copy.

## 53.26 Publishing without distribution

“Publish and pray” er ikke en strategi. Google anbefaler selv at fortælle folk om sitet og være aktiv i relevante communities [G-ESSENTIALS01].

---

# 54. Contradiction ledger

Denne sektion løser de mest almindelige modstridende råd.

| Uenighed | Golden-standard konklusion |
|---|---|
| “Technical SEO vs content” | Begge. Technical skaber eligibility/discovery; content/value afgør om siden fortjener visibility. |
| “SEO vs GEO/AEO” | GEO/AEO er ekstra retrieval/citation outcomes oven på et search/index/source-fundament. Google kræver ikke separat AI SEO-stack [G-AI01][G-AI02]. |
| “Keywords vs entities/topics” | Brug begge. Queries afslører efterspørgsel; entities/topics sikrer dækkende information. Exact-match repetition er unødvendigt. |
| “Short vs long content” | Match task complexity. Ingen magisk word count [G-STARTER01]. |
| “Fresh content always ranks better” | Kun når freshness er relevant eller information faktisk er ændret. Fake date updates er ikke standard. |
| “Backlinks vs mentions” | Links er etableret discovery/relevance signal; brand mentions/corroboration kan skabe wider source visibility. Industry AI studies viser korrelation, ikke bevist ranking factor [IND01][IND02]. |
| “DR/DA vs quality” | DR/DA er third-party proxies. Evaluer topical/editorial/audience value direkte. |
| “More pages vs fewer stronger pages” | Flere kun når de løser forskellige intents/tasks. Ellers consolidation. |
| “SSR required vs JavaScript okay” | Google kan render JS; implementation correctness matters. Ensure crawlable URLs and rendered content. |
| “Sitemap required vs optional” | Små well-linked sites kan blive discovered uden; sitemap er stadig low-cost best practice og vigtigere ved large/new/media sites [G-SITEMAP01]. |
| “Noindex vs robots.txt” | `noindex` controls index eligibility; robots controls crawl. Blocking crawl can prevent crawler seeing noindex [G-TECH01][G-TECH02]. |
| “Canonical is command vs hint” | Hint. Redirect stronger when URL should permanently disappear [G-CAN01][G-CAN02]. |
| “Structured data ranks pages” | Not a general ranking boost. It clarifies meaning/eligibility for rich features [G-SD01][G-SD02]. |
| “Reddit marketing vs Reddit spam” | Genuine relevant participation yes; covert promotion/mass engagement no [RED02]. |
| “Paid PR good vs paid links bad” | Paid distribution can be fine; buying ranking credit is not. Qualify paid links [G-LINK02]. |
| “AI-written content good vs bad” | Method neutral; quality, originality, purpose and scaled-abuse pattern matter [G-CONTENT01][G-SPAM01]. |
| “AI answer visibility stable vs volatile” | Volatile enough that repeated/multi-engine measurement is required [A-GEO03]. |
| “llms.txt required vs irrelevant” | Not required by Google Search; optional only for systems that actually consume it [G-UPDATE01]. |
| “ChatGPT training opt-out vs Search opt-out” | Different controls: GPTBot vs OAI-SearchBot [OAI01]. |
| “Google-Extended blocks Google Search AI” | No. Google says Google-Extended does not affect Search inclusion/ranking [G-CRAWL01]. |
| “No ranking boost = no value” | False. Sitemaps, structured data, metadata, feeds and protocols can create eligibility/discovery/presentation/actionability value without being general ranking factors. |
| “Harmless tactic = always implement” | False. Require a concrete consumer/use case and account for maintenance/opportunity cost. |
| “Freshness doesn't matter vs always matters” | Google has query-dependent freshness systems. Update when recency matters; do not fake dates [G-RANK01][G-DATE01]. |
| “FAQ schema dead = FAQ content useless” | False. The rich-result feature is gone, but genuinely useful Q&A content can still satisfy users and be groundable. |
| “Claude/Perplexity = same bot controls as ChatGPT” | False. Each provider separates crawler/fetcher purposes differently [OAI01][ANT01][PERP01]. |
| “Preferred Sources/Search Profiles are ranking hacks” | No. They are user-follow/distribution surfaces with eligibility limits [G-PREF01][G-PROFILE01]. |
| “UCP boosts organic ranking” | Unsupported. UCP is an agentic commerce/actionability protocol, not a documented Search ranking signal [G-UCP01]. |

---

# 55. Templates

## 55.1 Topic / demand brief

```yaml
topic_id:
business_goal:
audience:
job_to_be_done:
primary_intent:
secondary_intents:
query_families:
entities:
customer_language:
existing_pages:
competitors_sources:
community_questions:
ai_prompt_families:
commercial_value:
evidence_available:
recommended_asset:
```

## 55.2 Page brief

```yaml
url:
page_type:
primary_task:
audience:
search_intent:
primary_topic:
related_entities:
questions_to_answer:
unique_value:
primary_evidence:
author_expert:
required_sections:
visuals:
internal_links_in:
internal_links_out:
structured_data:
conversion_goal:
update_trigger:
```

## 55.3 Source asset brief

```yaml
asset_type: research|benchmark|tool|case|reference
new_information:
why_it_matters:
method:
data_source:
limitations:
expert_owner:
publication_date:
update_cadence:
charts_tables:
downloadable_data:
citation_ready_summary:
press_angles:
communities:
related_owned_pages:
```

## 55.4 Content QA

```text
[ ] Is there a clear intended audience?
[ ] Does page solve a real task?
[ ] Does it contain original value?
[ ] Are factual claims supportable?
[ ] Are primary sources used where possible?
[ ] Is author/source ownership clear?
[ ] Is title descriptive rather than stuffed?
[ ] Is main heading unambiguous?
[ ] Can important answer passages stand alone?
[ ] Are tables/lists used only where they improve comprehension?
[ ] Are internal links useful/descriptive?
[ ] Is the page technically indexable if intended?
[ ] Does schema match visible content?
[ ] Are dates truthful?
[ ] Is there a clear next step for the user?
```

## 55.5 Technical page QA

```text
HTTP 200?
Indexable?
Robots allowed?
Correct canonical?
In sitemap if intended?
At least one crawlable internal link?
Rendered main content visible?
Unique title/H1?
Meta description useful?
Correct hreflang if international?
Structured data valid and truthful?
Images accessible/alt?
Mobile usable?
CWV reasonable?
No broken resources?
```

## 55.6 AI/search citation audit

```yaml
prompt_family:
engine:
market_language:
run_date:
runs:
brand_mentioned:
brand_cited:
owned_pages_cited:
third_party_sources_cited:
competitors:
factual_accuracy:
missing_fact:
source_gap:
recommended_action:
```

## 55.7 Earned media pitch

```text
Subject: [actual finding, not “collaboration opportunity”]

Why now: one sentence.
Finding: one or two concrete numbers/observations.
Why your audience: one sentence.
Source: public methodology/data URL.
Available: expert/comment/chart/raw data.
Disclosure: relevant commercial relationship.
```

## 55.8 Content refresh record

```yaml
url:
trigger:
old_last_modified:
changes:
new_evidence:
intent_change:
internal_links_updated:
canonical_status:
measurement_baseline:
review_date:
```

## 55.9 Organic postmortem

```markdown
## Organic initiative postmortem

## Business objective
## Assets shipped
## Technical/index outcome
## Search visibility
## AI/citation visibility
## Links/mentions/distribution
## Qualified traffic
## Business outcome
## What changed causally vs correlationally
## What we learned
## What to repeat
## What to stop
## Next test
```

---

# 56. One-page golden standard

Hvis kun én side af playbooken må bruges:

1. **Start med business problem og user task, ikke keyword volume.**
2. **Byg én klar entity/source of truth for virksomhed, produkter, eksperter og facts.**
3. **Gør alle ønskede landing pages crawlable, renderable, indexable og internt linkede.**
4. **Brug robots.txt til crawl control, `noindex` til index control og authentication til private content.**
5. **Hold XML sitemap til canonical, index-worthy URLs med sand `lastmod`.**
6. **Brug IndexNow til freshness i understøttede engines, ikke som ranking trick.**
7. **Canonicaliser duplicates; redirect permanent flyttet content.**
8. **Hold URL- og site architecture enkel og forståelig.**
9. **Byg internal links efter user journey og information hierarchy.**
10. **Sørg for at JS-rendered core content faktisk findes i rendered DOM.**
11. **Brug structured data til explicit meaning/eligibility, aldrig til at opfinde facts.**
12. **Skriv for real search intent og customer language, ikke keyword density.**
13. **Prioritér original evidence, first-hand experience, tools, data og demonstrations.**
14. **Vis Who, How og Why når det hjælper brugeren med at vurdere troværdighed.**
15. **Citer primary sources og separér evidence fra opinion.**
16. **Gør answer passages klare og extractable uden at skrive robotisk.**
17. **AI Overviews/AI Mode kræver ikke særlig Google-AI markup eller llms.txt.**
18. **Tillad OAI-SearchBot hvis ChatGPT Search visibility ønskes; GPTBot er separat training control.**
19. **Google-Extended er separat fra Google Search ranking/inclusion.**
20. **Mål Bing citations/grounding queries, ikke bare blue-link ranks.**
21. **Byg distributed authority via reel omtale, YouTube/social, communities, partners og earned media.**
22. **Køb ikke links eller advertorial authority; paid distribution skal være korrekt disclosed/qualified.**
23. **Brug Reddit/forums som communities, ikke som fake recommendation network.**
24. **Skab source assets andre faktisk har grund til at linke til og citere.**
25. **For local: relevance + distance + prominence; hold business facts og reviews legitime.**
26. **For ecommerce: kombiner crawlable product architecture, Product data og Merchant Center.**
27. **Optimér billeder/video som selvstændige discovery surfaces.**
28. **Mål classic Search, generative visibility, citations, platform content og business outcome separat.**
29. **Refresh når facts/intent/value ændrer sig; skift ikke bare datoen.**
30. **Fjern eller konsolidér low-value overlap; mere content er ikke et mål.**
31. **Test usikre, materiale beslutninger; reparér åbenlyse tekniske fejl uden ritualistisk A/B-test.**
32. **Brug repeated prompt panels til AI visibility; én genereret answer er ikke et benchmark.**
33. **Third-party SEO metrics er proxies, ikke Google truth.**
34. **Ingen kan garantere indexing, ranking eller AI citation.**
35. **Det langsigtede mål er at blive den mest nyttige, tydelige, verificerbare og citerbare kilde i kategorien.**

---

# 57. Volatile implementation registry

Følgende skal live-checkes før implementation og må ikke blive permanente “love”:

- Google rich result availability
- Google AI Mode/Overview interface
- Search Console report dimensions
- supported structured data types
- ChatGPT crawler names/IP ranges
- Bing/Copilot AI Performance fields
- Threads/social indexing features
- Google Discover UI
- News surfaces
- IndexNow participants/API limits
- crawler user agents
- robots product tokens
- Core Web Vitals thresholds hvis standarderne ændres
- schema recommended/required properties
- Merchant Center requirements
- Google Business Profile fields
- search engine policies
- Reddit/community rules
- social platform metadata

**Rule:** live implementation facts får dato og source. Evergreen decision principles gør ikke.

---

# 58. Research gaps: det skal afgøres med egne data

Public evidence kan ikke svare universelt på:

1. Hvilke topic clusters skaber højeste qualified business value for vores virksomhed?
2. Hvilke content types vinder i vores category?
3. Hvor meget hjælper original research vs tools vs case studies hos os?
4. Hvilke external source types bliver mest citeret sammen med vores brand?
5. Hvilke prompt families skaber AI discovery?
6. Hvilke pages konverterer generative-AI referrals bedst?
7. Hvor ofte ændrer AI engines deres source set i vores category?
8. Hvilken internal-link architecture forbedrer vores large-site discovery mest?
9. Hvilke programmatic pages har reel incremental value?
10. Hvornår bør outdated pages refreshes vs merged/deleted?
11. Hvilken PR/data format earns relevant editorial references?
12. Hvilke social/video assets skaber Search visibility og branded demand?
13. Hvilke local review patterns påvirker conversion mest?
14. Hvilke pages er AI-cited uden at drive clicks, men skaber branded search senere?
15. Hvilken mix af classic SEO, distributed content og source assets giver bedst return on effort?

Disse spørgsmål bliver den interne learning backlog.

---

- Does Preferred Sources materially change qualified traffic for our audience, or only repeat-reader distribution?
- Do Search Profile followers create measurable Discover lift for our content mix?
- Which AI engines actually send qualified referrals versus mainly influence/mentions?
- Does allowing Claude-SearchBot / PerplexityBot generate measurable citations or referrals in our category?
- For ecommerce, does UCP/agentic checkout improve conversion or merely shift attribution/channel ownership?
- Which optional machine-readable files/protocols have a known consumer in our stack and therefore deserve maintenance?

# 59. Final doctrine

Den samlede playbook kan reduceres til én idé:

> **Organic discoverability er processen med at gøre virksomheden let at opdage, forstå, stole på, hente information fra og vælge — på tværs af klassiske søgemaskiner, generative søgesystemer og de tredjepartskilder, som mennesker og retrieval-systemer bruger til at forstå verden.**

Det betyder, at den moderne standard ikke er:

```text
find keyword
→ write article
→ get backlinks
→ rank
```

Den er:

```text
UNDERSTAND DEMAND + CUSTOMER TASK
→ DEFINE ENTITY + FACTUAL SOURCE OF TRUTH
→ BUILD CRAWLABLE / INDEXABLE INFORMATION ARCHITECTURE
→ CREATE THE BEST SOURCE ASSET FOR THE TASK
→ MAKE CLAIMS EXPLICIT, EVIDENCED AND CURRENT
→ DISTRIBUTE THROUGH REAL COMMUNITIES / MEDIA / VIDEO / PARTNERS
→ EARN LINKS, MENTIONS AND CORROBORATION
→ MEASURE SEARCH + AI + BUSINESS OUTCOMES
→ REFRESH / CONSOLIDATE / EXPAND FROM EVIDENCE
→ REPEAT
```

SEO er stadig fundamentet.

AEO/GEO er ikke en erstatning. Det er udvidelsen fra **ranking** til også at optimere for:

- retrieval
- citation
- synthesis
- entity understanding
- distributed corroboration

Det mest robuste konkurrencemæssige forsvar er derfor ikke at kende den næste “SEO hack”.

Det er at blive den **primære, mest troværdige og mest brugbare kilde** for de problemer og emner, virksomheden faktisk ejer.

---

---

# 60. Research evidence map

Denne sektion gør playbooken auditérbar. Hvert source-ID i dokumentet peger på en konkret kilde, evidenstype, anvendelse og limitation. Officielle platformkilder er source of truth for mekanik/policy; de er ikke automatisk kausalt bevis for performance.

## Google Search / technical / content / AI
### G-ESSENTIALS01 — Google Search Essentials
**URL:** https://developers.google.com/search/docs/essentials  
**Evidence:** `PLATFORM_POLICY / OFFICIAL_GUIDANCE`  
**Finding:** Google samler de tekniske minimumskrav, spam policies og centrale best practices for eligibility og Search visibility.  
**Limitation:** Frameworket er bredt; det fortæller ikke hvilke konkrete ranking-signaler der afgør en bestemt query.  

### G-TECH01 — Google — Introduction to robots.txt
**URL:** https://developers.google.com/search/docs/crawling-indexing/robots/intro  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** robots.txt styrer crawler-adgang og crawl traffic; det er ikke en sikker metode til at holde en webside ude af Search.  
**Limitation:** Robots-adfærd er crawler-specifik; andre bots kan implementere standarden forskelligt.  

### G-TECH02 — Google — Block Search indexing with noindex
**URL:** https://developers.google.com/search/docs/crawling-indexing/block-indexing  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** `noindex` virker kun, når crawleren kan hente siden og se directive. En robots.txt-blokeret URL kan derfor stadig forekomme som URL-only result.  
**Limitation:** Fjerner kun fra søgesystemer, der respekterer directive; private data kræver adgangskontrol.  

### G-SITEMAP01 — Google — Build and submit a sitemap
**URL:** https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** XML sitemaps hjælper discovery af canonical URLs og ændringer; inclusion i sitemap er ikke en indexing- eller ranking-garanti.  
**Limitation:** Sitemap limits og formatdetaljer er implementation-layer og kan ændres.  

### G-CAN01 — Google — Canonicalization overview
**URL:** https://developers.google.com/search/docs/crawling-indexing/canonicalization  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Duplicate content er normalt; Google vælger en canonical blandt lignende URLs.  
**Limitation:** `rel=canonical` er et signal/hint, ikke en absolut kommando.  

### G-CAN02 — Google — Consolidate duplicate URLs
**URL:** https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Redirects og `rel=canonical` er stærke canonical-signaler; sitemap inclusion er svagere. Signals kan stackes.  
**Limitation:** Signal strength er beskrevet kvalitativt, ikke som faste vægte.  

### G-REDIR01 — Google — Redirects and Google Search
**URL:** https://developers.google.com/search/docs/crawling-indexing/301-redirects  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Permanent redirects er standarden til permanente URL-flyt og bidrager til canonicalization/site migrations.  
**Limitation:** Exact recrawl/migration timing kan variere betydeligt.  

### G-MIG01 — Google — Site moves with URL changes
**URL:** https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes  
**Evidence:** `OFFICIAL_MIGRATION_GUIDANCE`  
**Finding:** Migration bør kortlægge gamle til nye URLs, bruge redirects, opdatere canonicals/internal links/sitemaps og monitoreres i Search Console.  
**Limitation:** Migrations kan stadig skabe midlertidig volatilitet selv ved korrekt implementation.  

### G-FACET01 — Google — Managing crawling of faceted navigation URLs
**URL:** https://developers.google.com/crawling/docs/faceted-navigation  
**Evidence:** `OFFICIAL_TECHNICAL_GUIDANCE`  
**Finding:** Facetter kan skabe meget store URL-spaces; sites skal aktivt styre crawl og hvilke kombinationer der bør være indexable.  
**Limitation:** Den optimale løsning afhænger af platform, inventory og hvilke facet-sider der har selvstændig søgeværdi.  

### G-PX01 — Google — Understanding page experience in Search results
**URL:** https://developers.google.com/search/docs/appearance/page-experience  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Core Web Vitals indgår i Googles page-experience signals, men gode scores alene garanterer ikke top-rankings.  
**Limitation:** Page experience er kun en del af ranking-systemerne.  

### G-CRAWL01 — Google — Common crawlers / Google-Extended
**URL:** https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Google-Extended er et robots.txt product token til bl.a. Gemini model training og visse grounding uses; det påvirker ikke Google Search inclusion eller ranking.  
**Limitation:** Google-Extended er ikke en separat HTTP user-agent; crawl sker via eksisterende Google fetchers.  

### G-SD01 — Google — Intro to structured data markup in Search
**URL:** https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Structured data giver eksplicitte clues om page meaning og kan gøre sider eligible til understøttede rich results.  
**Limitation:** Markup er ikke en generel ranking boost og kan ikke erstatte synligt, korrekt indhold.  

### G-SD02 — Google — Structured data general guidelines
**URL:** https://developers.google.com/search/docs/appearance/structured-data/sd-policies  
**Evidence:** `PLATFORM_POLICY`  
**Finding:** Structured data skal matche synligt content, repræsentere siden korrekt og følge feature-specific guidelines.  
**Limitation:** Valid markup garanterer ikke rich result display.  

### G-DATE01 — Google — Publication dates
**URL:** https://developers.google.com/search/docs/appearance/publication-dates  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Google kan bruge flere signals til at forstå publicerings-/opdateringsdato; synlig dato og structured data bør være konsistente.  
**Limitation:** Fake freshness eller kun ændring af dato uden substantiel opdatering er ikke en legitim freshness-strategi.  

### G-LINK01 — Google — Make your links crawlable
**URL:** https://developers.google.com/search/docs/crawling-indexing/links-crawlable  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Standard crawlable `<a href>` links med beskrivende anchor text hjælper discovery og forståelse.  
**Limitation:** JavaScript navigation kan fungere, men implementation skal stadig generere crawlable URLs/links.  

### G-LINK02 — Google — Qualify outbound links
**URL:** https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links  
**Evidence:** `PLATFORM_POLICY`  
**Finding:** `rel=sponsored`, `ugc` og `nofollow` bruges til at kvalificere bestemte links, især betalte og user-generated links.  
**Limitation:** Attributterne er hints til Google og løser ikke dårlig link-praksis i sig selv.  

### G-INDEX01 — Google — Ask Google to recrawl your URLs
**URL:** https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** URL Inspection og sitemaps kan bruges til discovery/recrawl requests; crawling og indexing er ikke garanteret.  
**Limitation:** Requesting recrawl er ikke et indexing hack eller ranking-signal.  

### G-INDEXAPI01 — Google Indexing API quickstart
**URL:** https://developers.google.com/search/apis/indexing-api/v3/quickstart  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Google Indexing API er begrænset til bestemte content types som JobPosting og livestream BroadcastEvent i VideoObject.  
**Limitation:** Den bør ikke bruges som generel URL-indexing API.  

### G-META01 — Google — Special tags Google understands
**URL:** https://developers.google.com/search/docs/crawling-indexing/special-tags  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Google ignorerer `meta keywords`; supported meta/robots tags har dokumenterede funktioner.  
**Limitation:** Historiske SEO-tags uden dokumenteret støtte skal ikke antages at hjælpe.  

### G-STARTER01 — Google SEO Starter Guide
**URL:** https://developers.google.com/search/docs/fundamentals/seo-starter-guide  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Google afviser bl.a. magiske word-count regler og overfokus på keywords i domænenavne; fokus er forståelig struktur og useful content.  
**Limitation:** Starter Guide er bevidst generel og ikke en komplet ranking-formel.  

### G-TITLE01 — Google — Influencing title links
**URL:** https://developers.google.com/search/docs/appearance/title-link  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Deskriptive, concise og page-specific titles hjælper Google og brugere; Google kan generere title links fra flere kilder.  
**Limitation:** Den skrevne `<title>` er ikke garanteret som SERP-title.  

### G-SNIPPET01 — Google — Control your snippets
**URL:** https://developers.google.com/search/docs/appearance/snippet  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Google genererer primært snippets fra page content og kan bruge meta description, hvis den beskriver siden bedre.  
**Limitation:** Meta description er ikke garanteret vist og er ikke dokumenteret som direkte ranking factor.  

### G-SC01 — Google — Get started with Search Console
**URL:** https://developers.google.com/search/docs/monitor-debug/search-console-start  
**Evidence:** `OFFICIAL_MEASUREMENT_GUIDANCE`  
**Finding:** Search Console bruges til indexing, queries, pages, performance, errors og Search visibility.  
**Limitation:** Search Console er et Search-side measurement-system, ikke komplet business attribution.  

### G-SC02 — Google Search Console Performance report documentation
**URL:** https://support.google.com/webmasters/answer/7042828  
**Evidence:** `PLATFORM_MEASUREMENT`  
**Finding:** Definerer impressions, clicks, CTR og position med vigtige caveats om hvordan de tælles.  
**Limitation:** Average position kan være misvisende og må ikke bruges som eneste KPI.  

### G-SPAM01 — Google Search spam policies
**URL:** https://developers.google.com/search/docs/essentials/spam-policies  
**Evidence:** `PLATFORM_POLICY`  
**Finding:** Dækker bl.a. link spam, keyword stuffing, cloaking, doorway abuse, scaled content abuse og site reputation abuse.  
**Limitation:** En praksis kan være manipulerende selv hvis den ikke er navngivet ordret i en enkelt policysektion.  

### G-CONTENT01 — Google — Creating helpful, reliable, people-first content
**URL:** https://developers.google.com/search/docs/fundamentals/creating-helpful-content  
**Evidence:** `OFFICIAL_CONTENT_GUIDANCE`  
**Finding:** Fremhæver original information/research/analysis, first-hand expertise, Who/How/Why og at E-E-A-T ikke er én enkelt ranking factor.  
**Limitation:** Quality Rater Guidelines og E-E-A-T beskriver kvalitetssystemets mål, ikke en simpel checkliste eller direkte score.  

### G-AI01 — Google — AI features and your website
**URL:** https://developers.google.com/search/docs/appearance/ai-features  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** AI Overviews og AI Mode bygger på Search eligibility; pages skal være indexed/snippet-eligible. Query fan-out kan hente flere supporting pages. Ingen særlige AI-files eller schema kræves.  
**Limitation:** Inclusion og citation er ikke garanteret, og AI features kan bruge forskellige models/techniques.  

### G-AI02 — Google — Guide to optimizing for generative AI features
**URL:** https://developers.google.com/search/docs/fundamentals/ai-optimization-guide  
**Evidence:** `OFFICIAL_2026_GUIDANCE`  
**Finding:** Google siger direkte, at SEO fundamentals stadig er fundamentet; anbefaler valuable, unique, non-commodity content og afviser mange AEO/GEO hacks inklusive special AI markup/llms.txt til Google Search.  
**Limitation:** Guiden er Google-specifik; andre AI/search systems kan have egne controls.  

### G-UPDATE01 — Google Search documentation updates
**URL:** https://developers.google.com/search/updates  
**Evidence:** `OFFICIAL_CHANGELOG`  
**Finding:** 15. juni 2026 præciserede Google, at llms.txt hverken er nødvendigt eller påvirker Google Search visibility/ranking positivt eller negativt; FAQ rich result docs blev også fjernet i 2026.  
**Limitation:** Changelog er implementation-layer og bør live-checkes.  

### G-GENREPORT01 — Google — Generative AI Performance reports in Search Console
**URL:** https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports  
**Evidence:** `CURRENT_PLATFORM_MEASUREMENT`  
**Finding:** Fra 31. august 2026 er dedikerede reports for generativ AI visibility rullet ud globalt i Search Console med impressions/pages/countries/devices/dates.  
**Limitation:** Google kan udvide metrics over tid; definitions skal live-checkes.  

### G-SRA01 — Google — Spam policy: site reputation abuse
**URL:** https://developers.google.com/search/docs/essentials/spam-policies#site-reputation-abuse  
**Evidence:** `PLATFORM_POLICY`  
**Finding:** Third-party content kan være site reputation abuse når det publiceres primært for at udnytte host-site ranking signals frem for reelt editorial/user value.  
**Limitation:** Ikke alt third-party content er abuse; vurder purpose, control og editorial value.  

### G-SRA02 — Google — August 2026 site reputation policy update
**URL:** https://developers.google.com/search/blog/2026/08/update-site-reputation-policy  
**Evidence:** `CURRENT_POLICY_UPDATE`  
**Finding:** Google beskrev 2026 enforcement/policy-opdateringer omkring site reputation abuse, relevant især for betalte/outsourced authority placements.  
**Limitation:** Policy enforcement og wording er volatile og bør live-checkes.  

### G-LOCAL01 — Google Business Profile — improve local ranking
**URL:** https://support.google.com/business/answer/7091  
**Evidence:** `OFFICIAL_LOCAL_GUIDANCE`  
**Finding:** Google beskriver local ranking primært gennem relevance, distance og prominence samt komplette/korrekte Business Profile-oplysninger og reviews.  
**Limitation:** Local ranking er query-/location-afhængig; der findes ikke en public exact weighting.  

### G-ECOM01 — Google — Share product data with Google
**URL:** https://developers.google.com/search/docs/specialty/ecommerce/share-your-product-data-with-google  
**Evidence:** `OFFICIAL_ECOMMERCE_GUIDANCE`  
**Finding:** Product structured data og Merchant Center feeds er komplementære ways to provide product data.  
**Limitation:** Shopping eligibility og Merchant Center requirements er implementation-layer.  

### G-ECOM02 — Google — Merchant listing structured data
**URL:** https://developers.google.com/search/docs/appearance/structured-data/merchant-listing  
**Evidence:** `OFFICIAL_ECOMMERCE_GUIDANCE`  
**Finding:** Product/Offer structured data kan gøre merchant pages eligible til richer product experiences og bør matche visible/product data.  
**Limitation:** Eligibility er ikke display-garanti.  

### G-IMAGE01 — Google Images SEO best practices
**URL:** https://developers.google.com/search/docs/appearance/google-images  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Relevant surrounding text, descriptive alt text, high-quality images og teknisk crawlability hjælper image understanding/discovery.  
**Limitation:** Alt text skal primært understøtte accessibility og accurate description, ikke keyword stuffing.  

### G-VIDEO01 — Google Video SEO best practices
**URL:** https://developers.google.com/search/docs/appearance/video  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Video bør være crawlable/indexable på en watch page med relevante thumbnails/metadata og structured data hvor relevant.  
**Limitation:** Video eligibility og feature-display varierer.  

### G-DISCOVER01 — Google Discover documentation
**URL:** https://developers.google.com/search/docs/appearance/google-discover  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Indexed policy-compliant content er automatisk eligible til Discover; compelling large images og useful content kan hjælpe presentation.  
**Limitation:** Discover traffic er mindre forudsigelig end keyword-led Search og kan svinge kraftigt.  

### G-NEWS01 — Google News — publication pages / Publisher Center
**URL:** https://support.google.com/news/publisher-center/answer/15898024  
**Evidence:** `CURRENT_PLATFORM_GUIDANCE`  
**Finding:** Google News publication pages kan genereres automatisk; publishers behøver ikke manuel inclusion for hver artikel.  
**Limitation:** News eligibility/experience kan ændres og følger særskilte policies.  

### G-NEWS02 — Google News ranking signals
**URL:** https://support.google.com/news/publisher-center/answer/9606702  
**Evidence:** `OFFICIAL_NEWS_GUIDANCE`  
**Finding:** Google News beskriver bl.a. relevance, prominence, authoritativeness, freshness, usability, location og language som faktorer.  
**Limitation:** Ikke en public weighting model.  

### G-REVIEWS01 — Google Reviews System
**URL:** https://developers.google.com/search/docs/appearance/reviews-system  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Google reviews system søger at belønne insightful, original research/analysis og first-hand evidence frem for tynde summaries.  
**Limitation:** Gælder bestemte review-content contexts og er ikke en generel site score.  

### G-REVIEWSD01 — Google review snippet structured data
**URL:** https://developers.google.com/search/docs/appearance/structured-data/review-snippet  
**Evidence:** `PLATFORM_POLICY / STRUCTURED_DATA`  
**Finding:** Review markup har eligibility- og policykrav; self-serving local/business review markup og fake/incentivized implementations har begrænsninger.  
**Limitation:** Structured review stars i Search er ikke samme ting som generel reputation.  

### G-SOCIAL01 — Google Search Console — platform properties for social/video
**URL:** https://developers.google.com/search/blog/2026/07/platform-properties-social-video-guide  
**Evidence:** `CURRENT_PLATFORM_MEASUREMENT`  
**Finding:** Google introducerede 2026 visibility/reporting for understøttede social/video platform properties i Search Console, relevant for distributed discoverability.  
**Limitation:** Coverage og supported properties kan ændres.  


## Bing / Microsoft / protocols
### B-SITEMAP01 — Bing — Keeping Content Discoverable with Sitemaps in AI-Powered Search
**URL:** https://blogs.bing.com/webmaster/July-2025/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search  
**Evidence:** `OFFICIAL_BING_GUIDANCE`  
**Finding:** Bing anbefaler accurate `lastmod`, XML sitemaps for complete inventory og IndexNow til timely changes; `changefreq`/`priority` ignoreres.  
**Limitation:** Bing-specific implementation guidance.  

### IDX01 — IndexNow FAQ
**URL:** https://www.indexnow.org/faq  
**Evidence:** `OPEN_PROTOCOL_GUIDANCE`  
**Finding:** IndexNow sender changed/new/deleted URL signals hurtigt til deltagende engines; sitemap bør stadig repræsentere fuldt inventory.  
**Limitation:** Submission garanterer ikke crawling, indexing eller ranking.  

### B-AI01 — Bing Webmaster Tools — AI Performance public preview
**URL:** https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview  
**Evidence:** `CURRENT_PLATFORM_MEASUREMENT`  
**Finding:** Bing viser citations, cited pages og grounding queries til AI-powered experiences; citation counts er visibility-metrics, ikke authority/ranking scores.  
**Limitation:** Preview/product definitions kan ændres.  

### B-AI02 — Bing — Evolving role of the index: from ranking pages to supporting answers
**URL:** https://blogs.bing.com/search/May-2026/Evolving-role-of-the-index-From-ranking-pages-to-supporting-answers  
**Evidence:** `OFFICIAL_SEARCH_ENGINEERING_GUIDANCE`  
**Finding:** Bing beskriver generative retrieval som grounding: sources skal levere fresh, factual, attributable og query-relevant information der kan supportere answer synthesis.  
**Limitation:** Microsoft/Bing-specific system description; ranking/retrieval weights er ikke offentlige.  


## OpenAI / ChatGPT Search
### OAI01 — OpenAI — Publishers and developers FAQ
**URL:** https://help.openai.com/en/articles/12627856-publishers-and-developers-faq  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_OPENAI_GUIDANCE`  
**Finding:** Public sites kan appear in ChatGPT Search; OAI-SearchBot controls search crawling/summaries while GPTBot can be controlled separately for potential training. `noindex` can block indexing where respected.  
**Limitation:** Search inclusion/ranking/citation er ikke garanteret; product behavior kan ændres.  

### OAI02 — OpenAI — ChatGPT Search
**URL:** https://help.openai.com/en/articles/9237897-chatgpt-search  
**Evidence:** `OFFICIAL_PRODUCT_GUIDANCE`  
**Finding:** ChatGPT Search uses multiple factors to determine relevance/reliability, can rewrite queries and links/cites sources; publishers should allow OAI-SearchBot for discoverability.  
**Limitation:** OpenAI does not publish a complete ranking formula.  


## Web vocabulary / YouTube / Reddit
### SCHEMA01 — Schema.org — sameAs
**URL:** https://schema.org/sameAs  
**Evidence:** `WEB_VOCABULARY_STANDARD`  
**Finding:** `sameAs` points to a URL representing the same entity, useful for machine-readable entity consistency.  
**Limitation:** Schema.org vocabulary support does not itself guarantee Google/Bing feature use.  

### YT01 — YouTube — How Search works
**URL:** https://support.google.com/youtube/answer/16090438  
**Evidence:** `OFFICIAL_YOUTUBE_GUIDANCE`  
**Finding:** YouTube Search considers relevance, engagement and quality; relevance can use title, tags, description and video content.  
**Limitation:** Exact weights vary by query/user and are not public.  

### YT02 — YouTube — Add tags to videos
**URL:** https://support.google.com/youtube/answer/146402  
**Evidence:** `OFFICIAL_YOUTUBE_GUIDANCE`  
**Finding:** Tags play a minimal role except for common misspellings; title, thumbnail and description are more important discovery inputs.  
**Limitation:** YouTube recommendation systems extend beyond Search.  

### RED01 — Reddit and Google expand partnership
**URL:** https://redditinc.com/news/reddit-and-google-expand-partnership  
**Evidence:** `PRIMARY_PARTNERSHIP_SOURCE`  
**Finding:** Reddit describes expanded Google access to structured public Reddit content via Data API and work across Search/AI products.  
**Limitation:** A commercial partnership does not imply that seeding Reddit posts is a ranking strategy.  

### RED02 — Reddit Spam policy
**URL:** https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam  
**Evidence:** `PLATFORM_POLICY`  
**Finding:** Mass, repetitive, unsolicited or manipulative promotional behavior can constitute spam.  
**Limitation:** Community-specific rules can be stricter than global policy.  


## Academic evidence on generative search
### A-GEO01 — Aggarwal et al. — GEO: Generative Engine Optimization, KDD 2024
**URL:** https://collaborate.princeton.edu/en/publications/geo-generative-engine-optimization/  
**Evidence:** `PEER_REVIEWED_ACADEMIC`  
**Finding:** Introduces GEO benchmark/methods; some interventions improved measured visibility in the study, with effects varying by domain. Keyword stuffing performed poorly.  
**Limitation:** Experimental benchmark and historical generative engines are not a universal recipe for current production systems.  

### A-GEO02 — Liu, Zhang & Liang — Evaluating Verifiability in Generative Search Engines, EMNLP 2023
**URL:** https://aclanthology.org/2023.findings-emnlp.467/  
**Evidence:** `PEER_REVIEWED_ACADEMIC`  
**Finding:** Shows citation/support quality in generative search is imperfect; only a subset of generated claims were fully supported and citations varied in correctness/completeness.  
**Limitation:** 2023 systems differ from 2026 production engines; use as grounding-quality evidence, not ranking guidance.  

### A-GEO03 — Kirsten et al. — Generative Search Engine Citation Behavior, ACL Findings 2026
**URL:** https://aclanthology.org/2026.findings-acl.526/  
**Evidence:** `PEER_REVIEWED_ACADEMIC`  
**Finding:** Finds material differences in source diversity, retrieval overlap and stability across Google/OpenAI/Perplexity-style systems.  
**Limitation:** Citation behavior changes over time and across prompts; no universal citation formula follows.  

### A-GEO04 — Zhang, He & Yao — citation selection/absorption study, 2026 preprint
**URL:** https://arxiv.org/abs/2604.25707  
**Evidence:** `ACADEMIC_PREPRINT / DESCRIPTIVE`  
**Finding:** Large prompt/citation dataset separates source selection from information absorption and finds associations with structural/evidence-rich source properties.  
**Limitation:** Preprint and observational; associations are not causal optimization laws.  


## Industry studies — useful but non-causal
### IND01 — Ahrefs — AI Overview brand correlation study
**URL:** https://ahrefs.com/blog/ai-overview-brand-correlation/  
**Evidence:** `INDUSTRY_CORRELATIONAL_STUDY`  
**Finding:** Across a large brand dataset, web mentions showed strong correlation with AI Overview visibility.  
**Limitation:** Correlation ≠ causation; Ahrefs metrics/sample construction and search universe influence results.  

### IND02 — Ahrefs — AI brand visibility correlations
**URL:** https://ahrefs.com/blog/ai-brand-visibility-correlations/  
**Evidence:** `INDUSTRY_CORRELATIONAL_STUDY`  
**Finding:** Across ~75k brands, YouTube/web mentions correlated strongly with AI visibility while classic link/DR variables were weaker in the reported analysis.  
**Limitation:** Does not prove mentions cause citations; brand popularity and latent demand may confound.  

### IND03 — Ahrefs — AI citations vs impressions study
**URL:** https://ahrefs.com/blog/ai-citations-vs-impressions-study/  
**Evidence:** `INDUSTRY_CASE_STUDY`  
**Finding:** Shows that brand mentions/visibility in AI answers can occur without direct link clicks and that citation/impression behavior differs from classic Search.  
**Limitation:** Case/company-specific evidence; weak basis for universal effect sizes.  

---

## Additional V2 sources — second validation pass

### G-PREF01 — Google — Preferred Sources
**URLs:**  
https://blog.google/products-and-platforms/products/search/preferred-sources-language-expansion/  
https://developers.google.com/search/docs/appearance/preferred-sources  
**Evidence:** `CURRENT_PLATFORM_MECHANIC / OFFICIAL_GOOGLE_GUIDANCE`  
**Finding:** Preferred Sources is globally available for Top Stories in supported languages; selected sources can appear more prominently for that user and can be highlighted in AI Mode/AI Overviews where available. Google reported users were about 2× as likely to click after selecting a preferred source.  
**Limitation:** User-specific preference/product data; not a general ranking factor or guaranteed uplift.  

### G-PROFILE01 — Google — Search Profiles
**URLs:**  
https://blog.google/products-and-platforms/products/search/a-new-profile-to-help-publishers-and-creators-highlight-their-work-on-search/  
https://developers.google.com/search/docs/appearance/search-profiles  
https://blog.google/products-and-platforms/products/search/3-new-ways-were-improving-search-profiles-for-publishers/  
**Evidence:** `CURRENT_PLATFORM_MECHANIC / OFFICIAL_GOOGLE_GUIDANCE`  
**Finding:** Search Profiles consolidate publisher/creator website + social content; following a profile can make linked content more likely in that user's Discover. Google documents website badges.  
**Limitation:** Eligibility/geography are evolving; September 2026 update still describes eligibility constraints.  

### G-RANK01 — Google — Ranking systems guide
**URL:** https://developers.google.com/search/docs/appearance/ranking-systems-guide  
**Evidence:** `OFFICIAL_RANKING_SYSTEM_DESCRIPTION`  
**Finding:** Google documents query-dependent freshness systems and link analysis/PageRank among ranking systems.  
**Limitation:** No public weights or deterministic ranking formula.  

### G-THIRDPARTY01 — Google — Guidance on third-party SEO tools and advice
**URL:** https://developers.google.com/search/docs/fundamentals/third-party-seo  
**Evidence:** `OFFICIAL_GOOGLE_GUIDANCE`  
**Finding:** Third-party tools do not have access to Google's internal ranking data and cannot guarantee Search/AEO/GEO performance.  
**Use:** Correct interpretation of DR/DA, AI visibility scores and vendor predictions.  

### G-GENAI01 — Google — Using generative AI content on your website
**URL:** https://developers.google.com/search/docs/fundamentals/using-gen-ai-content  
**Evidence:** `OFFICIAL_GOOGLE_GUIDANCE / SPAM_POLICY_CONTEXT`  
**Finding:** Generative AI can support useful content creation; generating many low-value pages without added user value can violate scaled-content-abuse policy.  
**Limitation:** Creation method alone does not determine quality/ranking.  

### G-UCP01 — Google — Universal Commerce Protocol
**URLs:**  
https://developers.google.com/merchant/ucp  
https://developers.google.com/merchant/ucp/implementation/2026-04-08/publish-profile  
**Evidence:** `CURRENT_COMMERCE_PROTOCOL / OFFICIAL_GOOGLE_DOCUMENTATION`  
**Finding:** Approved merchants can implement UCP for agentic actions/checkout on AI Mode/Gemini; current implementation publishes capabilities via `/.well-known/ucp`.  
**Limitation:** Evolving protocol; availability, version and approval are volatile. It is not documented as a general organic ranking signal.  

### G-MERCHAI01 — Google — AI-era merchant/product discovery updates
**URLs:**  
https://blog.google/products-and-platforms/products/shopping/shopping-updates-google-marketing-live/  
https://developers.google.com/merchant/api/latest-updates  
**Evidence:** `CURRENT_PLATFORM_GUIDANCE / PRODUCT_DATA_MECHANIC`  
**Finding:** Google says strong product descriptions matter for AI-era discovery and introduced conversational product attributes plus Merchant Center AI performance insights/UCP integration capabilities.  
**Limitation:** Commerce-specific and product availability varies by country/account.  

### ANT01 — Anthropic — web crawlers and robots controls
**URL:** https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler  
**Evidence:** `OFFICIAL_PLATFORM_MECHANIC`  
**Finding:** Anthropic documents `ClaudeBot` (model-development collection), `Claude-User` (user-directed retrieval) and `Claude-SearchBot` (search quality/indexing) as separate bots; Anthropic states its bots honor robots.txt and supports Crawl-delay.  
**Limitation:** No public deterministic Claude search ranking weights.  

### PERP01 — Perplexity — crawlers
**URL:** https://docs.perplexity.ai/docs/resources/perplexity-crawlers  
**Evidence:** `OFFICIAL_PLATFORM_MECHANIC`  
**Finding:** `PerplexityBot` surfaces/links websites in Perplexity search and is not used for foundation-model training; `Perplexity-User` is user-triggered and generally ignores robots.txt. Published IP lists support WAF verification.  
**Limitation:** Robots behavior differs by fetcher; protect private content with real access control.  

### B-AI03 — Bing — expanded AI visibility insights
**URL:** https://blogs.bing.com/search/June-2026/New-AI-Visibility-Insights-in-Bing-Webmaster-Tools-Intents-Topics-Citation-Share-Compare  
**Evidence:** `CURRENT_PLATFORM_MEASUREMENT`  
**Finding:** Bing expanded AI Performance with Intents, Topics, Citation Share and Compare to analyze generative visibility by intent/topic and competitive share.  
**Limitation:** Preview metrics are diagnostics, not disclosed ranking factors.  

### B-WEBIQ01 — Microsoft — Web IQ
**URL:** https://blogs.bing.com/search/June-2026/Announcing-Microsoft-Web-IQ  
**Evidence:** `OFFICIAL_SEARCH_ENGINEERING_GUIDANCE`  
**Finding:** Microsoft describes AI grounding as repeated retrieval over fresh, authoritative evidence, with passage/evidence selection optimized for downstream reasoning.  
**Limitation:** Engineering architecture, not a webmaster ranking recipe.  

### IND04 — Semrush / Kevin Indig — Ghost citations study
**URL:** https://www.semrush.com/blog/the-ghost-citations-study/  
**Evidence:** `INDUSTRY_DESCRIPTIVE_STUDY`  
**Finding:** In the reported multi-engine sample, source citation and brand mention were distinct outcomes; many source appearances cited a domain without naming the brand, with material engine differences.  
**Limitation:** Vendor dataset, prompt sample and period; not causal ranking-factor evidence.  

### IND05 — Semrush / Kevin Indig — topic-level ChatGPT visibility study
**URL:** https://www.semrush.com/blog/chatgpt-topic-authority-study/  
**Evidence:** `INDUSTRY_DESCRIPTIVE_STUDY`  
**Finding:** Brand visibility varied across related prompts; study supports topic/prompt-family measurement rather than treating one prompt as a stable rank.  
**Limitation:** Vendor methodology and ChatGPT behavior are time-sensitive.  

# 61. Source-handling and validation rules

1. **Platform mechanics and policies:** use current official Google, Bing, OpenAI, Reddit, YouTube and protocol documentation. Live-check before implementation.
2. **Ranking/performance claims:** never convert a vendor recommendation into a guaranteed ranking uplift.
3. **Academic evidence:** causal/controlled evidence gets more weight than correlations, but external validity must still be assessed.
4. **Industry studies:** use to generate hypotheses and understand large-scale patterns; label correlation explicitly.
5. **Third-party metrics:** DR, DA, visibility scores and prompt-share metrics are vendor metrics, not Google/OpenAI/Bing ranking variables unless a platform explicitly says otherwise.
6. **Generative search:** distinguish *retrieval eligibility*, *source selection*, *citation*, *answer synthesis* and *click-through*. They are different stages.
7. **SEO vs AEO/GEO:** core Search accessibility, quality and entity clarity remain foundation. AEO/GEO extends the optimization target to groundability/citation/synthesis rather than replacing SEO.
8. **Volatile facts:** crawler names, product controls, Search Console reports, supported schemas, rich result types and platform policies require dated verification.
9. **Internal learnings:** classify as causal test, association or heuristic and always store scope/context.
10. **When evidence conflicts:** prefer platform docs for mechanics, stronger causal evidence for effect questions, and run a controlled internal test where the answer remains context-dependent.
11. **Optional tactics:** “harmless” is not enough. Require a known consumer/use case and compare expected benefit with implementation + maintenance cost.
12. **Crawler controls:** distinguish indexing/search crawlers, user-directed fetchers and training/model-development crawlers per provider; never use robots.txt as a security boundary.

---

# 62. V2 validation note — second research pass, cutoff 21 September 2026

This playbook has been sanity-checked against current public primary documentation from Google Search Central and Crawling Infrastructure, Bing/Microsoft, OpenAI, Anthropic, Perplexity, Schema.org, YouTube, Reddit and IndexNow, plus peer-reviewed/academic GEO research and large industry datasets. The final evidence map contains 74 uniquely defined source IDs, and every source ID used in the playbook resolves to exactly one definition.

V2 was subjected to a second falsification pass against current platform documentation, emerging 2026 surfaces and cross-vendor industry datasets. Its core deliberately excludes claims that could not survive that validation. In particular it does **not** treat `llms.txt`, exact keyword density, meta keywords, magic word counts, sitemap submission, DR/DA, bought authority placements, FAQ schema, mass prompt pages or fake community seeding as universal discoverability levers.

The evergreen standard is therefore: **make valuable information technically accessible, structurally understandable, evidentially trustworthy, independently corroborated and easy to retrieve/cite — then measure Search, AI visibility and commercial outcomes separately.**
