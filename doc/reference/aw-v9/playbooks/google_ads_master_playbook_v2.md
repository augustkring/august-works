# Google Ads Master Playbook — V2.0 Revalidated Golden Standard
## Evidensbaserede standarder for høj performance på Google Search, Shopping, Performance Max, Demand Gen, YouTube og relevante Google-flader

**Version:** 2.0 — Revalidated Golden Standard  
**Research cutoff:** 21. september 2026  
**V2 method:** Falsifikations-review af V1 mod aktuelle Google-kilder, uafhængig/kausal forskning, større practitioner-datasæt, measurement-metodik og EU/DK-regulering.  
**Scope:** Betalt annoncering i Google Ads med primært fokus på Search, Shopping/Merchant Center, Performance Max og Demand Gen, herunder relevante YouTube-, Discover-, Gmail-, Maps- og Google Display Network-flader.  
**Dokumenttype:** Evergreen best-practice playbook. Ikke en klik-for-klik Google Ads-manual, ikke et feature-katalog og ikke en SEO-playbook.  
**Operator-neutral:** Standarderne gælder uanset om arbejdet udføres af mennesker, software eller en kombination.  

> **Terminologi:** Google Ads er platformen til at købe annoncering. Google AdSense er et publisher-produkt, hvor websiteejere tjener penge på at vise annoncer. AdSense er derfor uden for denne playbooks scope.

---

# Executive validation verdict

V2 er et nyt sanity check af hele V1. Målet har ikke været at gøre dokumentet længere for længdens skyld, men at **forsøge at falsificere hver regel, der kunne være for kategorisk, forældelig eller platform-drevet**.

Researchen er udvidet på fem akser:

1. Googles aktuelle Ads/Analytics/Merchant Center/Developer-dokumentation pr. 21. september 2026.
2. Nye 2026-mekanikker omkring AI Overviews, AI Max, Performance Max transparency, Demand Gen, Smart Bidding og first-party data.
3. Randomiserede og kvasi-eksperimentelle studier af paid search, brand search og incrementality.
4. Moderne measurement: Conversion Lift, geo experiments, Meridian GeoX og experiment-calibrated MMM.
5. Store practitioner-datasæt som modvægt til vendor-anbefalinger, men kun som `PRACTITIONER_EVIDENCE`.

Den vigtigste V2-konklusion er, at **V1's kerne holder**: economics før platform-metrics, korrekt value signal, simple structures, intent/query discipline, landing-page relevance, causal calibration og marginal budgetallokering er fortsat den mest robuste tværgående standard.

Men V2 korrigerer og udbygger en række punkter, som er blevet vigtigere i 2026.

## Hvad blev bekræftet

| Princip | V2-status | Evidens |
|---|---|---|
| Business value før platform metrics | **STÆRKT BEKRÆFTET** | Smart Bidding kan kun optimere mod de goals/values, der sendes ind; causal measurement viser hvorfor attributed ROAS ikke er business truth [G05][G21][A01][A02]. |
| Quality Score er diagnostic, ikke auction-KPI | **DIREKTE BEKRÆFTET** | Google siger eksplicit, at Quality Score ikke er KPI og ikke et auction input [G02]. |
| Ad Rank er mere end bid | **DIREKTE BEKRÆFTET** | Bid, auction-time quality, thresholds, competition, context og expected asset impact indgår [G01]. |
| Ingen universel exact/phrase/broad-vinder | **STYRKET** | Google anbefaler ofte broad + Smart Bidding, men moderne practitioner-data og historisk field evidence viser betydelig heterogenitet [G03][P04][A08]. |
| Search terms er centrale for query learning | **BEKRÆFTET, MEN KORRIGERET** | Rapporten viser faktiske queries med rapporterbar volumen, men privacy thresholds betyder at den ikke er komplet; Search Terms Insights aggregerer også skjulte low-volume queries [G04]. |
| Landing page er media-buying input | **STÆRKT BEKRÆFTET** | Landing quality indgår i auction-time quality/Ad Rank, og UX-friktion påvirker downstream CVR [G01][B01]. |
| Smart Bidding kræver korrekt value/measurement | **STÆRKT BEKRÆFTET** | Auction-time optimization er kun business-aligned, hvis conversion architecture er korrekt [G05][G06][G18]. |
| PMax skal have controls, transparency og experiment plan | **STYRKET** | Channel performance, full search terms og asset reporting gør PMax mindre black-box, men rapportering er stadig attribution, ikke kanal-causality [G37][G12]. |
| Attribution ≠ incrementality | **STÆRKT BEKRÆFTET** | Conversion Lift, geo experiments og paid-search field experiments viser behovet for counterfactual measurement [G21][A01][A03][A04]. |
| Brand Search skal causal-calibreres | **STYRKET OG NUANCERET** | eBay fandt lav/ingen kortsigtet lift i deres setting, mens andre store brand-search experiments viser positiv defense-effekt især under konkurrence [A01][A06][A07]. |
| Scale efter marginal economics | **STÆRKT BEKRÆFTET** | Meridian skelner eksplicit mellem ROI og marginal ROI; mROI er den relevante størrelse for næste budgetenhed [G44]. |

## Hvad V2 korrigerer eller nedgraderer

1. **“Search terms er sandheden.”** For kategorisk. De er den bedste observerbare query-level telemetry, men rapporten skjuler nogle low-volume queries af privacy-grunde. Brug Search Terms Report + Search Terms Insights + backend outcome [G04].
2. **“Broad + Smart Bidding er den moderne standard.”** Google anbefaler dette ofte, og det kan være stærkt, men det er en vendor recommendation, ikke en universel causal law. Exact/phrase kan stadig være efficiency-ledere i mange accounts. Test mod downstream business value [G03][P04][A08].
3. **“Ad Strength bør maksimeres.”** Nedgraderet hårdt. Google siger, at Ad Strength ikke afgør eligibility, Ad Rank, Quality Score eller auction wins. Brug den som creation/coverage feedback, ikke som optimization target [G34][P05].
4. **“PMax er en black box.”** Forældet som absolut beskrivelse. Channel performance, full search terms og richer asset metrics giver mere transparency. Men channel-level attributed reporting er stadig ikke incrementality [G37].
5. **“Brand ads er enten spild eller obligatoriske.”** Begge positioner afvist. Den kausale effekt afhænger bl.a. af brandstyrke, organic substitution og competitor pressure [A01][A06][A07].
6. **“View-through conversions kan læses som almindelige conversions.”** Afvist. Demand Gen kan nu optimere mod VTC, og nye campaigns har aktuelt VTC optimization slået til som default. VTC er attribution via impression exposure, ikke causal proof [G38].
7. **“Tracking outage = vent og se / reset bidding.”** Korrigeret. Google har data exclusions specifikt til conversion-data incidents; de skal bruges disciplineret og ikke som normal performance-control [G40].
8. **“Seasonality adjustments er til almindelig sæson.”** Afvist. Smart Bidding håndterer normal seasonality; adjustments er til forventede markante, kortvarige CVR-shifts som promotions [G41].
9. **“Limited by budget opfører sig som før.”** Volatile layer opdateret. Google ændrede target-based bidding globalt i august 2026 for budget-limited tCPA/tROAS/tCPC campaigns [G42]. Evergreen-reglen er stadig: budget-status er diagnostic, ikke profit-bevis.
10. **“AI Search kræver en helt ny campaign type.”** Afvist. Ads omkring AI Overviews bruger eksisterende Search/Shopping/PMax/App inventory; in-AI-Overview eligibility afhænger aktuelt af marked/sprog og AI-powered matching [G35]. AI Mode-formater er fortsat volatile/tests [G45].
11. **“AI Max er én Search-feature.”** Forældet. AI Max findes nu også som Shopping beta, med text customization, Final URL Expansion og format selection [G36].
12. **“Automation expansion er bare scaling.”** Korrigeret. Smart Bidding Exploration gør exploration eksplicit ved at acceptere lavere effective ROAS for traffic diversity. Det skal behandles som learning investment og testes, ikke skjules i BAU [G39].
13. **“First-party data quality handler primært om tags.”** Udvidet. Data Manager/API, enhanced conversions og offline/CRM feedback er nu en mere central del af Googles measurement stack [G18][G43]. Googles uplift-tal er vendor-reported og må ikke blive benchmarks.
14. **“MMM kan stå alene.”** Afvist som gold standard. Meridian anbefaler selv calibration mod incrementality experiments; GeoX understøtter causal geo-tests og bør bruge raw KPI frem for attributed conversion events [G44].

## V2's tværgående system

> **Business economics → demand/intent map → right Google surface → true value event → trustworthy first-party measurement → simple structure → query/product/creative relevance → landing experience → value-aligned bidding → transparent diagnostics → controlled exploration → causal confirmation → experiment-calibrated allocation → marginal scaling → durable learning.**

Google-platformen er samtidig i en overgang fra klassisk keyword-/placement-styring til mere semantisk og modeldrevet matching. Den korrekte reaktion er **ikke** blind automation og heller ikke nostalgisk micro-control. Den er bedre signaler, stærkere guardrails, bedre transparency og flere veldefinerede experiments.

---

# Hvad “gold standard” betyder

Ingen offentlig playbook kan garantere “laveste CPC”, “højeste rank”, “maksimal ROAS” eller “flest konverteringer for mindst spend” på tværs af virksomheder. Auktionen, søgeefterspørgsel, konkurrencen, keyword economics, produktpris, margin, brandstyrke, creative, landing page, geografi, sæson og conversion lag varierer.

Den forsvarlige standard er derfor:

> **Brug robuste principper som defaults. Gør virksomhedsspecifikke spørgsmål til tests. Optimer mod incremental business value, ikke platformens egne mellem-metrics.**

---

# Sådan bruges playbooken

Playbooken har to lag:

1. **Evergreen core:** economics, demand/intent, conversion architecture, keyword/query reasoning, feed quality, relevance, bidding, landing experience, experimentation, incrementality, scaling og learning.
2. **Volatile implementation layer:** kampagnenavne, AI Max-migrationer, konkrete antal assets/search themes, thresholds, aktuelle kanaler, attribution-indstillinger, API-felter, policy-ordlyd og UI.

Et skiftende Google-parameter må aldrig ophøjes til en permanent marketinglov.

---

# Evidensstandard og kildehierarki

| Tier | Kildetype | Hvordan den bruges |
|---|---|---|
| **A1** | Google Ads / Google Analytics / Merchant Center / Google policy / Google Research for mechanics | Source of truth for platformmekanik, feature-tilgængelighed og policy. Vendor-uplifts behandles ikke som universelle løfter. |
| **A2** | Randomiserede field experiments, peer-reviewed forskning, stærke kausale designs | Højeste vægt ved spørgsmål om incremental effekt og measurement. |
| **B** | Stærk econometric/measurement-forskning, usability/CRO research | Mekanismer, diagnosticering og design. |
| **C** | Erfarne PPC-specialister og større practitioner-datasets | Aktuel taktisk kontekst og hypotheses. Ikke permanent source of truth. |
| **D** | Egen virksomhedsdata | Kan blive vigtigst for den konkrete virksomhed, men skal klassificeres som causal test, association eller heuristic. |

## Evidenslabels

- `PLATFORM_MECHANIC`
- `POLICY_REQUIREMENT`
- `OFFICIAL_RECOMMENDATION`
- `CAUSAL_RANDOMIZED`
- `STRONG_OBSERVATIONAL`
- `VENDOR_REPORTED_TEST`
- `PRACTITIONER_EVIDENCE`
- `INTERNAL_CAUSAL_TEST`
- `INTERNAL_ASSOCIATION`
- `SYNTHESIS`
- `HYPOTHESIS`

## Konfliktregel

Når kilder modsiger hinanden:

1. Tjek om de måler samme objective, population, funnel stage, market og tidsperiode.
2. Platformmekanik/policy: brug aktuel Google-dokumentation.
3. Effekt/ROI: vægt randomiseret/kausal evidens over attributed/observational claims.
4. Bevar heterogenitet; ét account-average er ikke en lov.
5. Vendor-uplifts må aldrig generaliseres uden for deres testpopulation.
6. Hvis svaret stadig er uklart, gør spørgsmålet til et internt eksperiment.

---

# De 42 gyldne standarder

1. **Start med business value, ikke Google Ads.**
2. **Google Ads er ikke én kanal; vælg surface efter kundens state og jobbet.**
3. **Search er primært intent capture; Shopping er commerce matching; PMax er cross-channel optimization; Demand Gen er discovery/demand.**
4. **Optimer mod det dybeste pålidelige value event, der har nok signal.**
5. **Profit, contribution og incremental value er vigtigere end platform-ROAS.**
6. **Conversion tracking, consent og first-party data quality er performance-infrastruktur.**
7. **Primary conversions skal være handlinger, du faktisk ønsker bidding skal skabe mere af.**
8. **Proxy/key events må ikke få samme status som commercial outcomes uden valideret downstream-relation.**
9. **Offline/CRM/customer-quality feedback bør fødes tilbage, hvor det er lovligt og teknisk forsvarligt.**
10. **Data-driven attribution er credit assignment, ikke causal proof.**
11. **Ad Rank er ikke bare bid; auction-time quality, context, competition, thresholds og assets påvirker udfaldet.**
12. **Quality Score er et diagnostic tool, ikke KPI og ikke et direkte auction input.** [G02]
13. **Ad Strength er creation/coverage feedback, ikke Ad Rank, Quality Score eller business KPI.** [G34]
14. **Højeste annonceposition er kun værdifuld, hvis marginaløkonomien forsvarer den.**
15. **Keywords er intent hypotheses, ikke bogstavelige strenge.**
16. **Exact, phrase og broad er forskellige controls; ingen er universelt bedst.**
17. **Search Terms Report er vigtig query telemetry, men ikke komplet; kombiner med Search Terms Insights.** [G04]
18. **Negative keywords skal beskytte relevance/economics uden at kvæle legitim discovery.**
19. **Brand Search skal vurderes på incremental business value og competitor pressure, ikke attributed ROAS alene.**
20. **Konsolider struktur som default; split kun ved reel economics-, geo-, language-, landing-, inventory-, business-goal- eller experiment-forskel.**
21. **Automation kræver bedre signaler og guardrails, ikke mindre ansvar.**
22. **Broad/keywordless expansion er en testbar discovery-strategi, ikke en trosretning.**
23. **AI Overviews/AI Mode ændrer search journeys, men ikke kravet om profitable intent, relevance og measurement.**
24. **Performance Max audience signals er suggestions, ikke hårde targeting boundaries.** [G10]
25. **Search themes er ekstra business context, ikke en kopi af keyword-listen.** [G11]
26. **PMax channel/search-term reporting er diagnostic transparency, ikke channel-level causal attribution.** [G37]
27. **Merchant Center-feedet er targeting-, creative-, eligibility- og AI-search-infrastruktur.**
28. **AI Max for Shopping skal evalueres som expansion treatment, ikke som automatisk upgrade til bedre economics.** [G36]
29. **Responsive Search Ads skal have meningsfuldt forskellige value/proof messages, ikke synonym-spam.**
30. **Assets skal vælges efter customer job; flere relevante assets kan hjælpe, men asset-count er ikke business value.**
31. **Annonce, query og landing page skal føles som samme svar på samme behov.**
32. **Smart Bidding er kun så business-aligned som de goals og values, det får.**
33. **Smart Bidding Exploration er learning spend: accepteret efficiency-tolerance skal være eksplicit, bounded og testet.** [G39]
34. **Tracking incidents skal håndteres som data incidents; brug data exclusions hvor relevant i stedet for at lære bidding på korrupte data.** [G40]
35. **Seasonality adjustments er til store, forventede, kortvarige CVR-skift — ikke normal sæson.** [G41]
36. **“Limited by budget” er en diagnose, ikke en ordre om at bruge mere.**
37. **Recommendations, Optimization Score, Data Strength og platform forecasts er inputs, ikke facit.**
38. **Demand Gen view-through conversions skal adskilles fra click/engaged-view outcomes og fra incrementality.** [G38]
39. **Små budgetter skal koncentreres; fragmentering skaber støj hurtigere end læring.**
40. **Eksperimenter skal besvare beslutninger; attributed differences må ikke kaldes causal uden design.**
41. **Scale efter marginal economics og uncertainty, ikke historical average ROAS eller platformnudges.**
42. **Den langsigtede fordel er hurtigere valid learning: bedre intent-, value-, landing-, automation- og budgetbeslutninger.**

---

# Google Search i AI-æraen: hvad ændrer sig, og hvad ændrer sig ikke?

Google Search i 2026 er ikke kun en klassisk liste af blå links og text ads. AI Overviews og AI Mode gør flere journeys længere, mere kontekstuelle og mere conversational. Det skaber nye commercial moments, men ændrer ikke den grundlæggende økonomiske standard.

## Ads omkring AI Overviews

Google dokumenterer aktuelt tre vigtige facts [G35]:

1. Eksisterende Search-, Shopping-, Performance Max- og App-kampagner kan være eligible **over eller under** AI Overviews på markeder, hvor AI Overviews er tilgængelige.
2. Ads **inde i** selve AI Overview er mere begrænset efter sprog/marked og er pr. research cutoff ikke en universel global placement.
3. For in-AI-Overview ads bruges både query og AI Overview-content til relevans; Google kræver aktuelt AI-powered matching som broad/keywordless technology for denne inventory.

### Evergreen doctrine

- Byg ikke en særskilt “AI Overview hack”-strategi.
- Sørg for stærk query/intent coverage, high-quality landing content, gode product/feed data og korrekt value signal.
- Brug AI-powered expansion, når economics og measurement kan bære den.
- Behandl AI Overview inventory som en **surface/matching change**, ikke som et nyt business objective.
- Evaluer på qualified outcomes, ikke på om ad'en “kom ind i AI”.

## AI Mode og nye generative ad formats

Google tester i 2026 nye AI Mode-formater som conversational discovery og generative product/helpful-answer experiences [G45]. De er derfor `VOLATILE_IMPLEMENTATION`.

Playbook-regel:

```text
new AI surface
→ verify availability + policy
→ understand matching/format mechanics
→ define incremental hypothesis
→ constrain with business guardrails
→ test against current baseline
→ judge on downstream value
```

Ikke:

```text
Google calls it AI
→ enable everywhere
```

## Hvad AI Search gør vigtigere

- semantisk klar website-information,
- stærke Merchant Center-attributter,
- tydelig relation mellem problem → løsning → produkt,
- korrekt landing-page scope,
- conversion/value feedback,
- query/theme transparency,
- experiment design ved expansion.

AI Search reducerer ikke behovet for search strategy. Det flytter mere af kontrollen fra manuel query enumeration til **input quality + business constraints + measurement quality**.

---

# Google-flader: hvad bruges til hvad?

## Search

**Primært job:** capture af eksisterende intent.

Stærkt når:

- kunden aktivt søger efter løsningen, produktet eller problemet,
- søgeintentionen kan kobles til en konkret landing page,
- unit economics tåler den forventede CPC,
- lokal/B2B/service-intent er præcis,
- der findes et afgrænset high-intent keyword-set,
- virksomheden vil lære hvilke konkrete behov og formuleringer markedet bruger.

Svagere når:

- ingen kender kategorien endnu,
- search volume er meget lav,
- produktet er impuls-/visual discovery-drevet,
- CPC er høj i forhold til margin og CVR,
- søgningerne er ekstremt informationsprægede uden downstream monetization.

## Standard Shopping / Shopping inventory

**Primært job:** capture af produkt-intent med billede, titel, pris og merchant-identitet.

Stærkt når:

- ecommerce,
- produkt, pris og visuel sammenligning er central,
- Merchant Center-data er høj kvalitet,
- produktniveau-margin og lager kan fødes ind i beslutninger.

Shopping/PMax med feed bruger produktattributter, ikke klassiske Search-keywords, som centralt matching-input [G26].

## Performance Max

**Primært job:** cross-channel optimization mod et conversion/value goal på tværs af Googles inventory.

Stærkt når:

- conversion/value tracking er robust,
- der er tilstrækkelig business signal quality,
- ecommerce-feed eller stærke assets/landing pages findes,
- virksomheden vil lade systemet allokere på tværs af flere Google-flader,
- incremental reach ud over eksisterende Search/Shopping er værdifuld.

Risici:

- brand/retargeting harvest kan få attributed ROAS til at se stærkere ud end incremental effekt,
- uklare conversion goals kan sende automation i den forkerte retning,
- URL expansion kan sende trafik til uønskede sider, hvis controls mangler,
- audience signals kan misforstås som targeting,
- cross-network reporting kan skjule channel mix, hvis den ikke aktivt nedbrydes.

Google tilbyder i 2026 PMax uplift/upgrade/optimization experiments netop fordi “PMax vs. andet” bør testes, ikke antages [G12].

## Demand Gen

**Primært job:** demand creation/discovery og performance på visuelle surfaces.

I september 2026 kan Demand Gen køre på YouTube, Discover, Gmail, Maps og Google Display Network med channel controls [G14]. Display-kampagner er samtidig i migration mod GDN inde i Demand Gen [G15].

Stærkt når:

- creative kan skabe efterspørgsel før aktiv søgning,
- produkt/service kræver demonstration, story eller visual proof,
- paid-social-lignende acquisition ønskes i Google-økosystemet,
- remarketing/customer state giver mening,
- audience/creative learning er en central del af job-to-be-done.

Svagere som første test ved ekstremt lille budget, hvis conversion-eventet er dyrt og creative inventory er svagt.

## YouTube

YouTube er både en surface i Demand Gen og har andre video/brand use cases. Evergreen-jobbet er:

- demo,
- education,
- creator/expert proof,
- awareness/consideration,
- retargeting,
- performance creative når downstream conversion signal findes.

View-through/engaged-view attribution gør causal calibration særlig vigtig ved video.

## Google Display Network

I 2026 er GDN på vej ind i Demand Gen som inventory [G15]. Behandl derfor “Display” som en inventory-type og media grammar mere end som et evigt selvstændigt campaign-brand.

Brug:

- contextual/reach use cases,
- remarketing hvor incrementality kan forsvares,
- visual demand generation,
- placements hvor brand safety og quality er acceptable.

Billige clicks er ikke i sig selv et argument for GDN.

## Maps / lokale surfaces

Relevant når:

- fysisk location,
- directions/calls/store visits,
- lokal service radius,
- lokal availability.

Lokation er en reel hard constraint. Over-segmentér ikke små områder uden beslutningsværdi.

---

# Google vs. Meta: hvilken kanal får den næste krone?

Dette er en **beslutningsramme**, ikke en universel rangering.

| Situation | Google har typisk strukturel fordel | Meta har typisk strukturel fordel | Hvad der afgør det |
|---|---|---|---|
| Akut/high-intent behov | Search | — | Search volume, CPC, CVR, margin |
| Lokal service “nu” | Search/Maps | Kan skabe awareness | Query intent + geo |
| Produkt med stærk aktiv søgning | Shopping/Search/PMax | Retargeting/discovery | Feed, pris, category demand |
| Nyt produkt/kategori uden søgning | Demand Gen kan hjælpe | Feed/social discovery er ofte naturligt | Creative + demand creation |
| Impuls/visuelt consumer product | Demand Gen/YouTube | Meta feed/Reels | Creative economics |
| B2B niche | Search kan capture meget værdifulde få queries | Meta kan skabe reach, men qualification varierer | TAM, CPC, pipeline value |
| Brand defense/capture | Search | — | Incrementality/competitor presence |
| Remarketing | PMax/Demand Gen/Search RLSA-lignende signals | Meta retargeting | Incrementality, recency, overlap |

## Den korrekte regel

> **Hvis der allerede findes kvalificeret efterspørgsel, er Search ofte den mest direkte måde at købe adgang til den på. Hvis efterspørgslen først skal skabes, konkurrerer Demand Gen og Meta mere direkte om jobbet.**

Men “intent” kan være dyrt. En søgning er ikke automatisk profitable bare fordi den er bottom-funnel.

---

# Økonomien før Google Ads

## Business objective

Før launch skal teamet kende:

- værdi pr. conversion,
- gross/contribution margin,
- target CAC/CPA,
- refund/cancel rate,
- new vs existing customer economics,
- LTV og hvor robust estimatet er,
- payback-periode,
- lead-to-qualified / close rate,
- capacity/inventory,
- geografi,
- conversion lag.

## Primære formler

### ROAS

```text
ROAS = attributed_revenue / ad_spend
```

Operationel attribution metric. Ikke automatisk kausal.

### Incremental ROAS

```text
iROAS = incremental_revenue / ad_spend
```

Kræver kausalt design eller kalibreret causal model.

### Profit on ad spend

```text
POAS = contribution_profit_generated / ad_spend
```

### CAC

```text
CAC = acquisition_spend / new_customers
```

Bedre ved causal måling:

```text
incremental_CAC = spend / incremental_new_customers
```

### Break-even ROAS

Hvis contribution margin før ads er `CM` som andel af omsætning:

```text
break_even_ROAS = 1 / CM
```

40% contribution margin → ca. 2,5 revenue ROAS før andre acquisition-omkostninger.

### Break-even CPC

For en enkel single-conversion funnel:

```text
break_even_CPC = contribution_value_per_conversion × click_to_conversion_rate
```

Eksempel:

```text
contribution pr. salg = 800 DKK
click→sale CVR = 4%
break_even_CPC = 800 × 0.04 = 32 DKK
```

Hvis auktionen kræver 50 DKK CPC, kan top-position stadig være dårlig economics, selv med flot CTR.

### Lead economics

```text
expected_value_per_lead
= close_rate × contribution_profit_per_closed_customer
```

Hvis kvalificering varierer:

```text
EV(raw lead)
= valid_rate
× qualified_rate
× close_rate
× contribution_profit_per_customer
```

### Marginal ROAS

```text
mROAS = change_in_incremental_revenue / change_in_spend
```

Det er marginal performance, der bør styre næste budget-enhed.

---

# KPI hierarchy

## Tier 1: Business truth

- Incremental contribution profit
- Incremental revenue
- New-customer CAC
- Pipeline/closed-won contribution
- Payback
- Qualified opportunity value

## Tier 2: Conversion economics

- Conversion value
- CPA/CAC
- Purchase/lead CVR
- AOV
- Lead quality / close rate
- Margin
- Retention/LTV cohort

## Tier 3: Auction/delivery diagnostics

- CPC
- Impressions
- Search impression share
- Search lost IS (rank)
- Search lost IS (budget)
- Top/absolute-top metrics
- Spend/pacing

## Tier 4: Query/ad diagnostics

- Search terms
- Match type/source
- CTR
- RSA asset/message patterns
- Quality Score components
- Landing page experience
- Channel/format breakdown

**Regel:** Tier 4 må aldrig overvinde Tier 1 uden en forklaring på kausaliteten.

---

# Measurement architecture: sandhed før bidding

Google automation ændrer bids auction-by-auction ud fra conversion-/value-goals [G05][G06]. Derfor er målesystemet ikke kun reporting. Det er **input til selve mediekøbet**.

## Fire lag

### Lag A: Google Ads telemetry

- spend,
- impressions,
- clicks/interactions,
- search terms,
- Google-attributed conversions,
- conversion value,
- channel/asset reporting.

### Lag B: Behavioral truth

- GA4 sessions,
- landing behavior,
- key events,
- onsite funnel,
- ecommerce events,
- engagement.

### Lag C: Commercial truth

- CRM,
- qualified leads,
- opportunities,
- closed-won,
- orders,
- refunds,
- net revenue,
- contribution margin,
- new/existing status,
- retention.

### Lag D: Causal truth

- Google Ads experiments,
- Conversion Lift,
- geo experiments,
- holdouts,
- calibrated MMM.

Google selv skelner i Conversion Lift mellem **standard attributed conversions** og **incremental conversions**, hvor sidstnævnte estimeres som forskellen mellem treatment og control [G21].

---

# Measurement maturity ladder

V2 bruger fem niveauer, fordi en “conversion” kan være alt fra platform credit til causal business impact.

```text
Level 0 — Platform telemetry
Google Ads conversions, conversion value, clicks, VTC, engaged views

Level 1 — Backend reconciliation
Orders, leads, CRM stages, revenue, refunds, new/existing customer

Level 2 — Business-value adjustment
Margin, qualified lead value, retained value, LTV/payback

Level 3 — Causal validation
A/B, Conversion Lift, geo holdout / Meridian GeoX

Level 4 — Calibrated strategic allocation
Experiment-calibrated MMM + response curves + marginal ROI with uncertainty
```

Jo længere op i ladderen en budgetbeslutning skal række, desto stærkere bør measurement være.

- Daily bid diagnostics kan leve på Level 0–2.
- Kanal-/brand-/PMax-incrementality kræver Level 3.
- Stor cross-channel budgetallocation bør, når data tillader det, bruge Level 3–4.

**V2-regel:** Mere avanceret modellering må ikke kompensere for dårlig raw data. Ground truth forbedres nedefra.

---

# Conversion architecture

## Conversion ladder

```text
ad exposure/search
→ click/engaged view
→ landing session
→ meaningful product/service interest
→ high-intent action
→ qualified conversion
→ commercial conversion
→ retained value
```

## Primary vs secondary

En conversion skal være **Primary**, når bidding med rimelighed bør jagte den. Secondary actions er observation/diagnostik.

Dårlige primary goals:

- page view,
- scroll,
- 10 sekunders engagement,
- alle formularstarts,
- “kontakt” uden lead-quality feedback,
- add-to-cart hvis køb har tilstrækkeligt signal.

Gode primary goals afhænger af business:

- purchase med korrekt value,
- qualified lead,
- booked appointment der faktisk er værdifuld,
- opportunity,
- closed-won når data lag og volumen tillader det,
- subscription med passende value.

## Deepest reliable event

Regel:

> **Optimer så dybt som muligt, men ikke dybere end signalet kan måles stabilt nok til at træffe beslutninger.**

Et shallow proxy-event kan anvendes midlertidigt, hvis downstream volume er for lav, men marker `proxy_risk` og test korrelation/kausal sammenhæng til reel værdi.

---

# Enhanced conversions, CRM og first-party signal

Google Enhanced Conversions kan supplere conversion measurement med hashed first-party data. I 2026 er web/leads samlet i én setting; offline lead uploads er flyttet mod Data Manager API fra 15. juni 2026 [G18].

Evergreen-reglen er ikke “implementér feature X”. Den er:

- mål revenue/lead quality så tæt på backend truth som muligt,
- returnér downstream outcome til bidding, hvis lovligt,
- deduplikér events,
- send korrekte values,
- undgå at optimere på raw leads når quality varierer voldsomt.

## Lead feedback loop

```text
Google click
→ raw lead
→ valid lead
→ qualified
→ opportunity
→ won
→ revenue/margin
→ value feedback to Ads
```

Hvis Google kun ser første trin, optimerer det rationelt mod **billigste raw leads**, ikke nødvendigvis bedste kunder.

---

# GA4 vs Google Ads: sådan fortolkes dataen

## Key events vs conversions

I GA4 er en **key event** en vigtig onsite/app handling. En **conversion** er en handling, der kan bruges til ad measurement/optimization i Google Ads [G23].

Brug ikke “markér alt som key event” som strategi. Betydningen kommer af business relevance.

## Klik er ikke sessions

Google Ads clicks og GA4 sessions kan afvige. Google Ads kan kreditere en conversion til datoen for ad-click, mens Analytics/backend kan rapportere conversion på selve conversion-datoen. Google anbefaler bl.a. conversion-time views ved reconciliation [G25].

## Kanalgrupper

GA4 klassificerer bl.a.:

- Search → Paid Search,
- Standard Shopping → Paid Shopping,
- Performance Max og Demand Gen → Cross-network,
- YouTube campaign traffic → Paid Video,
- GDN/Display → Display,

afhængigt af network/campaign metadata [G24].

**Konsekvens:** Et GA4-dashboard med “Cross-network” er ikke nok til at diagnosticere PMax/Demand Gen. Brug Google Ads channel-level reporting og campaign-/network-dimensioner.

## Attribution

Data-driven attribution fordeler credit på interaktioner på baggrund af advertiser-data [G22]. Det kan være bedre end simpel last-click til operationel credit assignment, men:

> **DDA fortæller ikke counterfactualen: hvad var sket uden annonceringen?**

Det kræver lift/holdout/geo eller anden kausal metode.

## Analytics-lag der ikke må blandes

```text
Session acquisition   = hvor denne session kom fra
User acquisition      = hvor brugeren oprindeligt kom fra
Attribution            = hvem får credit for conversionen
Incrementality         = hvad blev faktisk skabt af ads
```

---

# Signal quality checklist

Før performance vurderes:

- [ ] Conversion tag/event fires korrekt
- [ ] Primary/secondary status korrekt
- [ ] Values/currency korrekt
- [ ] Deduplication korrekt
- [ ] New/existing status korrekt hvor relevant
- [ ] Lead IDs / order IDs stabile
- [ ] Offline/CRM imports friske
- [ ] Consent-state korrekt
- [ ] Enhanced conversions/data uploads sunde hvor anvendt
- [ ] Auto-tagging/linking korrekt
- [ ] Landing page oppe
- [ ] Conversion lag kendt
- [ ] Tracking change log kontrolleret

Hvis measurement er brudt, suspenderes performance-optimering.

> **Tracking incident beats media optimization.**

---

# Campaign architecture: simplificér før du fragmenterer

## Gode grunde til separate campaigns

- forskellig budget ownership,
- markant forskellig margin/LTV,
- forskellige lande/sprog,
- forskellig geo availability,
- forskellige business goals,
- brand vs non-brand når dette er nødvendigt for control/measurement,
- eksperimentisolering,
- forskellige landing experiences,
- lager-/capacity constraints,
- regulated eligibility.

## Dårlige grunde

- én campaign per keyword uden økonomisk grund,
- én ad group per mikrovariant bare for “kontrol”,
- campaign-sprawl for at “fodre algoritmen”,
- duplikering for rapportering, som kunne løses med labels/dimensions,
- ad groups der reelt svarer på samme intent med samme landing page.

## Intent cluster > SKAG-ritual

Historiske “single keyword ad groups” var et produkt af ældre match-type- og ad-systemer. I moderne Search matcher exact/phrase/broad semantisk bredere, og Google prioriterer relevance/ad groups algoritmisk [G03].

Evergreen-strukturen er derfor:

> **Gruppér queries, der kan besvares troværdigt af samme offer, landing page og ad-message. Split, når svaret skal være anderledes.**

---

# Search Master Playbook

# 1. Demand map før keyword list

Byg et map over kundens faktiske intent-states:

### Brand

- [brand]
- [brand + product]
- [brand + review/pricing/login]

### High-intent non-brand

- køb [produkt]
- [service] pris
- [service] tilbud
- [service] nær mig
- bedste [produkt] til [specific need]

### Category / solution

- [product category]
- [solution category]
- [software type]

### Problem-led

- hvordan løser jeg [problem]
- [problem] løsning

### Comparison

- [category] vs [alternative]
- bedste [category]

### Competitor

- [competitor]
- [competitor alternative]

### Informational

- guide,
- definition,
- research,
- educational question.

Ikke alle skal have paid coverage. Vurder **commercial intent × CPC × conversion probability × value**.

---

# 2. Keywords: intent-hypotheses, ikke strenge

Google beskriver exact, phrase og broad som matchning på mening/intention, ikke kun tegnsekvenser [G03].

## Exact match

Brug når:

- query family er værdifuld og velkendt,
- tight budget kræver mere styring,
- brand/competitor eller specific high-intent ønskes isoleret,
- eksperimentet kræver en relativt ren population.

Men exact er ikke “kun præcis stavemåde”.

## Phrase match

Brug som mellemled når:

- du vil tillade semantisk variation,
- intent stadig skal være relativt tæt på den definerede phrase family.

## Broad match

Brug når:

- conversion/value tracking er stærk,
- Smart Bidding har et meningsfuldt mål,
- TAM/query space er større,
- du accepterer discovery,
- negatives/landing/message kan absorbere variation,
- du kan måle downstream quality.

Google anbefaler conversion/value-based Smart Bidding sammen med broad, fordi systemet bruger auction-time context [G05].

**Men:** “Google anbefaler broad” er ikke bevis for, at broad giver højere incremental profit i din virksomhed. Test det.

---

# 3. Low-data keyword strategy

Ved lille budget/sparsom conversion volume er målet ikke at “give AI frihed”. Målet er at købe **nok relevant information** til at lære.

En forsvarlig default-syntese:

1. Start med de mest kommercielle query families.
2. Brug exact/phrase eller anden kontrolleret setup, hvis broad forventeligt vil sprede spend over for mange intents.
3. Sørg for korrekt conversion value/quality feedback.
4. Udvid til broad/AI Max gennem et kontrolleret test-design.
5. Sammenlign på business outcome, ikke traffic volume.

Dette er `SYNTHESIS`, ikke en officiel Google-regel.

---

# 4. Search terms: det vigtigste research-feed

Search Terms Report viser faktiske forespørgsler, der udløste ads, men kun når query activity opfylder Googles privacy-/reporting thresholds [G04]. **Den er derfor den bedste observerbare query-level telemetry — ikke et komplet facit over alle queries.** Search Terms Insights grupperer themes/subthemes og inkluderer også low-volume queries i aggregeret form, fx under subthemes eller `other queries` [G04].

## Query truth hierarchy

Brug tre lag sammen:

```text
1. Search Terms Report = observerbare konkrete queries
2. Search Terms Insights = intent themes inkl. privacy-hidden low-volume demand i aggregeret form
3. CRM/backend = om query traffic faktisk skabte qualified commercial value
```

**Playbookregel:** Fravær i Search Terms Report er ikke bevis for, at query'en ikke eksisterede. Og tilstedeværelse er ikke bevis for, at query'en var incremental eller profitabel.

## Ugentlig query review

Klassificér search terms som:

```text
A = high-value exact intent
B = relevant adjacent intent
C = research / uncertain
D = irrelevant
E = harmful / impossible customer
```

For hver category:

- A: beskyt coverage, relevant landing/message.
- B: test som ny hypothesis.
- C: mål downstream value før konklusion.
- D/E: negative eller anden control, hvis mønsteret er reelt.

## Negative keywords

Brug negatives for:

- irrelevante produkter/services,
- jobs/careers hvis ikke ønsket,
- gratis/download/template når virksomheden sælger premium,
- geografier virksomheden ikke betjener,
- research-intent der beviseligt ikke skaber værdi,
- support/login/customer-service queries hvis acquisition-budget ikke skal betale for dem.

Undgå negative-list inflation, der blokerer profitable adjacent intent.

Google understreger, at negative match fungerer anderledes end positive match og ikke bare bør kopiere keyword-tænkning [G04].

---

# 5. “Hvordan rangerer vi højest?” — den korrekte model

Google Ad Rank afgør eligibility og position i den konkrete auction. På højt niveau indgår [G01]:

- bid,
- annonce- og landing page-kvalitet ved auktionstidspunktet,
- Ad Rank thresholds,
- auction competitiveness,
- brugerens/search context,
- forventet impact af assets/formats.

## Det betyder

Du kan ikke reducere rank til “betal højere CPC”.

For at forbedre sandsynligheden for top placement:

1. svar bedre på query intent,
2. gør ad message mere relevant og nyttig,
3. sørg for stærk landing page experience,
4. brug relevante assets,
5. byd aggressivt nok **hvis economics tillader det**.

## Men top position er ikke målet

Hvis position #1 koster 45 DKK/click og positionerne under giver 28 DKK/click med samme downstream value, kan det være rationelt **ikke** at maksimere top impression share.

Brug top/absolute-top og lost impression share som **diagnostic dimensions**, ikke som slut-KPI [G30].

---

# Quality Score: diagnostik, ikke religion

Google siger eksplicit, at Quality Score:

- er et diagnostic tool,
- ikke er et KPI,
- ikke er et input i ad auction [G02].

Det opsummerer historisk:

- expected CTR,
- ad relevance,
- landing page experience.

## Korrekt brug

Hvis keyword family har dårlig economics og Quality Score 4:

- undersøg om ad/landing er irrelevant,
- men optimer ikke score for scoreens skyld.

Hvis keyword family er profitabel og Quality Score 6:

- forbedr user experience hvor relevant,
- men ødelæg ikke offer/message for at jagte 10/10.

---

# Responsive Search Ads

RSA-systemet kombinerer headlines/descriptions dynamisk. Evergreen creative-princip:

> **Dæk forskellige reasons-to-click og reasons-to-believe — ikke 15 versioner af samme sætning.**

## Message portfolio

Hver ad group bør efter behov kunne kommunikere:

- exact relevance,
- customer outcome,
- differentiator,
- mechanism,
- proof,
- price/offer,
- risk reduction,
- local availability,
- CTA.

## Dårlig diversification

- “Få bedre X”
- “Få den bedste X”
- “Bedre X til dig”
- “Din bedste X”

## God diversification

- Outcome: “Reducer behandlingstiden med …”
- Mechanism: “Automatisér X via …”
- Proof: “Brugt af …” hvis dokumenteret
- Offer: “Book demo / få pris”
- Objection: “Implementeres uden …” hvis sandt

## Ad Strength

Google siger nu eksplicit, at Ad Strength er feedback til creation/editing og **ikke** bruges til at beregne Ad Rank, Quality Score eller auction wins [G34].

Brug den til:

- asset coverage,
- relevans/diversity feedback,
- at opdage åbenlyse mangler før launch.

Brug den **ikke** som:

- target KPI,
- argument for at omskrive en profitabel ad alene for at gå fra `Good` til `Excellent`,
- bevis for bedre CPA/ROAS.

Store practitioner-datasæt på ca. 20.000–22.000 accounts / 1M+ ads finder heller ikke en stabil simpel relation mellem høj Ad Strength og bedre business economics [P05]. Det er observational/practitioner evidence, men retningen passer med Googles egen forklaring af, hvad scoren **ikke** bruges til.

**V2-regel:** Creative completeness er nyttig. Score-maximering er ikke en marketing objective.

---

# Assets

Google Ads assets kan inkludere bl.a.:

- sitelinks,
- callouts,
- structured snippets,
- images,
- calls,
- locations,
- prices,
- promotions,
- lead forms,
- app assets [G16].

Google bruger også forventet asset-impact i Ad Rank [G01].

## Evergreen asset-rule

Brug alle **relevante** asset-types, som øger user utility eller qualification.

Ikke:

> “Tilføj fire assets fordi checklisten siger det.”

Men:

> “Giv brugeren flere relevante veje til den information/handling, de faktisk efterspørger.”

## Examples

### Service business

- Sitelinks: services, cases, pricing, contact
- Callout: response time, warranty, geographic coverage
- Call: hvis telefonisk conversion er værdifuld og bemandet
- Location: fysisk/lokal intent
- Lead form: hvis lead quality kan måles

### Ecommerce

- Promotion
- Price
- Sitelinks til categories
- Images
- Location ved omnichannel retail

---

# AI Max for Search

I september 2026 er AI Max for Search ude af beta og bliver mere central. Google beskriver to hovedområder: **search term matching** og **asset optimization** [G07]. Search term matching kan udvide via broad og keywordless matching baseret på keywords, creatives og URLs. Google tilbyder særskilte AI Max experiments [G08], og nye multi-campaign budget/ROI-testmuligheder rulles ud i september 2026 [G45].

Aktuel migration:

- campaign-level broad match setting og text customization/ACA bliver auto-opgraderet mod AI Max fra september 2026,
- DSA auto-upgrade er udsat til februar 2027 [G32].

Dette er `VOLATILE_IMPLEMENTATION`.

## Evergreen AI Max doctrine

Aktivér ikke AI Max fordi “AI er bedre”. Aktivér når:

- conversion/value signal er trustworthy,
- URL scope er ryddeligt,
- landing pages er egnede,
- negatives/brand controls er sat efter business need,
- reporting kan skelne expansion fra base traffic,
- test-design er defineret.

## AI Max experiment

Test:

```text
Control: existing Search
Treatment: same campaign traffic/budget share with AI Max
Primary metric: qualified CAC / contribution value
Secondary: query expansion, CVR, CPC, search-term quality
```

Google tilbyder single-campaign AI Max experiments, netop så funktionen kan prøves før fuld rollout [G08].

---

# AI Max for Shopping

AI Max er i 2026 også udvidet til Standard Shopping som beta [G36]. Den nuværende suite kan bl.a. bruge:

- text customization,
- Final URL Expansion,
- automatic format selection mellem Shopping/text experiences,
- Merchant Center-feedet som central semantic/product source.

Google positionerer funktionen mod mere conversational og mid-funnel Search samt AI-driven surfaces. Google rapporterer vendor-uplifts, men disse må **ikke** bruges som forventet performance for en konkret annoncør [G36].

## V2 doctrine

AI Max for Shopping er relevant at teste når:

- feedet er stærkt og korrekt,
- website/landing scope er kontrolleret,
- product margin/value kan måles,
- traditional Shopping miss'er relevant research-/conversational demand,
- text customization er brand/policy-safe,
- Final URL Expansion kan holdes væk fra irrelevante pages.

Test som treatment:

```text
baseline Shopping economics
vs
AI Max Shopping expansion
```

Primary truth:

```text
incremental / marginal contribution value
```

Secondary diagnostics:

- new search categories,
- product/query fit,
- text vs Shopping mix,
- landing page changes,
- new-customer share,
- attributed ROAS.

**Anti-rule:** “AI Max fandt mere volume” er ikke nok. Expansion er kun en gevinst, hvis den ekstra demand har acceptabel marginal economics.

---

# Brand Search

Brand Search er et af de mest misforståede områder i PPC, fordi **høj conversion rate og høj attributed ROAS er præcis, hvad man forventer i en population med allerede eksisterende brand-intent**.

## Evidensen er heterogen

Et stort eBay-field experiment fandt ingen målbar kortsigtet incremental effekt af brand-keyword ads i netop deres setting [A01]. Det viser stærkt, at observational brand ROAS kan være massiv selection/attribution bias.

Men andre store sponsored-search experiments viser, at det modsatte også kan være sandt i andre markeder:

- I et stort multi-brand experiment på Bing fandt Simonov, Nosko & Rao en lille positiv brand-ad effekt, når der ikke var konkurrenter, og langt større traffic stealing når brandet ikke annoncerede under konkurrencetryk [A06].
- Et senere quasiexperiment fandt også, at competitors kunne stjæle væsentligt mere branded traffic, når focal brand ikke sad i top paid position [A07].

**Konklusion:** “brand ads er spild” er lige så forkert som “brand ads er altid nødvendige”.

## Brand Search er mere sandsynligt incremental når

- competitors aktivt byder på brand,
- SERP er crowded eller organic substitution er svag,
- brand queries har high-value commercial modifiers,
- paid ad giver anden landing/offer/availability end organic,
- promotion/launch ændrer next-best action,
- experiment viser total business lift.

## Brand Search er mere sandsynligt harvest-heavy når

- brandet dominerer organic SERP,
- der er lav/ingen paid competition,
- query er ren navigation,
- paid og organic sender til samme destination med samme message,
- kampagnen får meget credit fra returning/high-intent customers.

## Brand holdout-test

Hvor muligt:

- geo holdout,
- randomized/structured market split,
- controlled pause i repræsentative markets,
- measure total site conversions/revenue/profit og competitor traffic,
- inkluder organic substitution,
- vurder confidence/uncertainty.

**V2-regel:** Brand Search-budget styres efter **incremental protection/value**, ikke efter at brand CPA ser billig ud.

---

# Competitor Search

Competitor keywords kan være lovlige/teknisk mulige i mange cases, men trademark/ad-copy/policy/jurisdiction skal live-checkes.

Strategisk:

- CPC kan være høj,
- relevance/landing quality kan være lavere,
- conversion probability kan være lavere,
- men customer value kan være høj.

Test som separat intent hypothesis når volumen forsvarer det. Mål **qualified CAC**, ikke CTR.

---

# Shopping og Merchant Center: feedet er kampagnen

Google bruger product data til både ad creation og matching mod relevante searches. I Shopping/PMax er product attributes centrale frem for klassiske keywords [G26].

## Feed quality dimensions

- title,
- description,
- GTIN/MPN/brand hvor relevant,
- product type/category,
- image,
- price,
- sale price,
- availability,
- variant attributes,
- shipping/returns,
- custom labels til economics/merchandising.

Google understreger, at unøjagtige/manglende data kan give disapprovals, limited eligibility eller forkert serving [G27].

## Title doctrine

- identificér produktet præcist,
- vigtigste customer-recognizable details først,
- brug faktiske produktattributter, ikke keyword stuffing,
- match landing page.

Merchant Center guidance anbefaler vigtige details tidligt og relevante product keywords, men product highlights-guidance siger samtidig, at man ikke skal indsætte SEO-keyword-lister [G27].

Den korrekte synthesis:

> **Feed copy skal beskrive produktet så præcist, at både system og kunde kan forstå, hvad det er — ikke manipuleres som gammel SEO.**

## Feed × economics

Tilføj interne dimensions/custom labels for fx:

- high margin,
- low margin,
- bestseller,
- clearance,
- seasonal,
- high LTV,
- inventory risk.

Men segmentér campaigns kun hvis forskellen skal ændre budget/bidding/offer/decision.

## Price + availability

Feed, landing page og checkout skal være konsistente. Forkerte priser/lager er både policy-, UX- og economics-problem [G27].

---

# Promotions

Der er to forskellige “promotion”-områder:

## Search promotion assets

Kan fremhæve ægte limited-time offers [G16].

## Merchant Center promotions

Kan vise special-offer annotations på eligible products på bl.a. Search/Shopping surfaces [G28].

## Promotion doctrine

En promotion er ikke gratis performance.

Mål:

```text
incremental volume
× contribution after discount
− cannibalization
− pull-forward
− acquisition cost
```

Undgå:

- perpetual sale,
- fake scarcity,
- discount der øger ROAS men sænker contribution profit,
- promo uden cohort/LTV review.

---

# Performance Max Master Playbook

## PMax preconditions

Før launch:

- primary conversion goals korrekte,
- conversion values repræsenterer business value,
- tracking healthy,
- brand/new customer logic defineret,
- Merchant feed healthy hvis ecommerce,
- asset coverage passende,
- landing/URL scope ryddeligt,
- audience signals kun hvis de tilfører valid information,
- search themes kun hvis de tilfører information, systemet ikke allerede kan udlede,
- negatives/brand exclusions efter reel business need.

## Transparency i 2026

PMax har nu væsentligt bedre diagnostic visibility end tidlige versioner:

- channel performance reporting,
- full search terms reporting,
- richer asset-level metrics [G37].

Det ændrer to ting:

1. Teamet kan bedre diagnosticere **hvor** delivery og query demand opstår.
2. Teamet må ikke forveksle attributed channel reports med causal channel contribution.

Hvis PMax viser høj Search-attributed performance, ved vi ikke automatisk, hvor meget Search-demand der ville være konverteret via Standard Shopping/Search/organic uden PMax. Brug experiments/holdouts til det spørgsmål.

## Audience signals

Google siger eksplicit, at PMax kan vise ads uden for audience signals, hvis systemet forventer conversion [G10].

Derfor:

> **Audience signal = suggestion/seed, ikke targeting wall.**

Gode signals:

- high-value customers,
- qualified leads,
- site visitors med meaningful behavior,
- custom segments der repræsenterer reel intent.

Dårlige signals:

- tilfældige demographics,
- enorme blandede remarketing-lister,
- proxy segments uden business rationale.

## Search themes

Search themes er ekstra kontekst til keywordless targeting og kan give systemet viden, der ikke fremgår af site/feed [G11].

Brug themes til:

- niche terminology,
- new offers,
- seasonal demand,
- customer wording,
- business context, der ikke er tydeligt online.

Undgå:

- 50 near-duplicates,
- copy/paste af alle Search keywords,
- themes der bare gentager landingssiden.

## Search overlap

Aktuel prioritetslogik giver identiske eligible exact-match Search keywords prioritet over PMax; phrase/broad/search themes har mere delt/kompleks prioritering [G09]. Budget-limited eller ineligible Search kan ændre udfaldet.

Dette er implementation-layer, ikke en garanti om kanalinkrementalitet.

## Brand controls

Brug brand exclusions når:

- PMax skal måles mere rent på non-brand acquisition,
- brand harvest forvrænger KPI,
- separate brand economics skal styres.

Men ekskludér ikke brand ritualistisk, hvis total business outcome bliver dårligere. Test.

## Final URL Expansion

Google kan vælge en mere relevant page og generere/tilpasse ad content ud fra search intent; URL inclusions/exclusions kan begrænse scope [G13].

Audit:

- careers,
- support,
- login,
- investor pages,
- old offers,
- low-value content,
- regulatory pages,
- pages med dårlig conversion readiness.

## PMax experiment hierarchy

1. PMax uplift vs existing mix.
2. Standard Shopping vs PMax ved ecommerce.
3. Final URL expansion on/off.
4. Asset/creative changes; use native PMax asset A/B experiments where eligible [G46].
5. Brand exclusion/new-customer strategy.
6. Search themes/audience signals, hvis beslutningen reelt betyder noget.

Google tilbyder flere af disse direkte som PMax experiments [G12].

---

# Demand Gen Master Playbook

Demand Gen er den Google-flade, der mest ligner paid social i customer state og creative dependency, men dens attribution og inventory skal forstås på Googles egne præmisser.

## Current inventory 2026

- YouTube in-stream,
- YouTube in-feed,
- YouTube Shorts,
- Discover,
- Gmail,
- Maps,
- GDN [G14].

Channel controls og channel-level reporting findes, men præcis availability kan ændres. Video Action Campaigns er samtidig flyttet ind i Demand Gen i 2026, og Display inventory er under migration [G15].

## Creative jobs

- introduce problem,
- show mechanism,
- demonstrate product,
- social/customer proof,
- comparison,
- objection handling,
- creator/expert story,
- offer,
- reminder/remarketing.

## Demand Gen vs Search

Search:

```text
user expresses demand → ad responds
```

Demand Gen:

```text
user consumes content/browses → creative creates, shapes or captures adjacent demand
```

Derfor kan samme CPA ikke nødvendigvis fortolkes ens. Demand Gen kan påvirke senere branded/non-brand Search og direct traffic. Brug lift/holdouts ved større spend.

## V2: View-through optimization ændrer measurement

Google har i 2026 open-beta VTC optimization for Demand Gen, og nye Demand Gen campaigns har aktuelt VTC optimization slået til som default. VTC kan indgå i bidding for video på bl.a. YouTube, Display og Discover [G38].

Det gør det obligatorisk at skelne mellem:

```text
click-through conversion
engaged-view conversion
view-through conversion
platform-comparable conversion
incremental conversion
```

De fem størrelser svarer ikke på samme spørgsmål.

**V2-regel:** En view-through conversion er en platform-attributed conversion efter impression exposure. Den er ikke i sig selv bevis for, at annoncen skabte outcome.

Google tilbyder en `Conversions (Platform Comparable)`-view, der isolerer Demand Gen og justerer attribution for bedre cross-platform sammenlignelighed. Den ændrer ikke bidding [G38]. Brug den som et **comparability lens**, ikke som causal truth.

## Channel controls

Default bør ikke være “manual always” eller “all channels always”.

Brug broad channel access når:

- creative kan fungere på inventory,
- objective er cross-surface performance,
- measurement er robust,
- VTC/attribution interpretation er aftalt på forhånd.

Brug manual channel isolation når:

- testen spørger “YouTube Shorts vs andet”,
- creative er surface-specific,
- brand safety/quality kræver det,
- unit economics viser vedvarende forskel,
- budgettet ellers bliver ufortolkeligt.

## Demand Gen scorecard

Primary, efter business model:

- incremental conversions/revenue/profit,
- qualified CAC,
- new-customer contribution,
- pipeline/won revenue.

Secondary diagnostics:

- click-through conversions,
- engaged-view conversions,
- view-through conversions,
- Platform Comparable conversions,
- channel mix,
- audience/creative performance.

**Anti-rule:** Optimér ikke en discovery-channel alene efter den attribution-model, der giver det højeste rapporterede resultat.

---

# Audience og demografi

## ICP ≠ Google audience segment

ICP skal beskrive:

- job-to-be-done,
- trigger,
- problem,
- alternatives,
- objections,
- buying criteria,
- proof needed,
- value/LTV,
- eligibility,
- search behavior,
- content/context.

Demografi er kun nyttigt, når det ændrer economics, eligibility eller budskab.

## Search

Query/intent er ofte vigtigere end en statisk demographic profile. Smart Bidding bruger samtidig auction-time context [G05].

## PMax

Audience signals er optional suggestions og kan overskrides [G10].

## Demand Gen

Audience-strategi er mere central, men optimized reach/AI kan udvide afhængigt af setup. Mål downstream value, ikke bare audience CTR.

## Value rules

Hvis visse segments/geos/devices faktisk har forskellig **værdi**, kan conversion value rules udtrykke dette til reporting/bidding [G29].

Vigtigt: Google siger selv, at Smart Bidding allerede bruger geo/device/audience som probability signals. Value rules bør derfor beskrive **value difference**, ikke blot at en gruppe konverterer oftere.

---

# Landing page: Paid Search stopper ikke ved klikket

Ad Rank vurderer også landing page usefulness/relevance og navigation [G01]. Men vigtigere: landingen afgør downstream economics.

## Message match

Query → ad → landing skal fortsætte samme:

- problem,
- category,
- product/service,
- offer,
- location,
- proof,
- vocabulary.

## Search-specific landing principle

Jo mere konkret query, desto mindre bør brugeren skulle oversætte siden selv.

Eksempel:

```text
Query: “AI rådgivning til produktionsvirksomheder”
Weak landing: generic “We transform businesses” homepage
Strong landing: service/use-case page that directly answers AI + manufacturing + outcome
```

## Friction budget

Hvert ekstra form-/checkout-step skal retfærdiggøre:

- quality,
- compliance,
- trust,
- needed information,
- lower downstream cost.

Ellers fjern det.

---

# Bidding Master Playbook

Google Smart Bidding bruger auction-time AI til conversion/value goals [G05].

## Vælg efter business objective

### Maximize conversions

Når:

- conversions har omtrent samme værdi,
- volumen er vigtigst,
- budget er hard constraint.

### Target CPA

Når:

- business har en meningsfuld gennemsnitlig CPA constraint,
- conversion quality er relativt ens eller korrigeret gennem goal/value systemet.

### Maximize conversion value

Når:

- conversions har forskellig værdi,
- total value inden for budget er vigtigere end antal.

### Target ROAS

Når:

- conversion values er trustworthy,
- virksomheden vil beskytte revenue/value efficiency.

## Value-based bidding > fake value

Hvis alle leads får “500 DKK” uden forbindelse til close rate eller revenue, er value-based bidding bare en mere sofistikeret måde at optimere på forkert data.

## Cost controls

For stramme targets kan begrænse volume. For løse targets kan købe for dyr marginal demand.

Vurder altid:

```text
resultat
+ spend utilization
+ downstream quality
+ marginal value
+ uncertainty
```

## Smart Bidding Exploration

Smart Bidding Exploration er i 2026 en Search-funktion for etablerede Target ROAS setups, hvor annoncøren eksplicit accepterer en lavere effective ROAS target/tolerance for at udforske nye traffic pockets [G39]. Den præcise eligibility og tolerance er volatile implementation detail.

Det centrale princip er vigtigere:

> **Exploration har en pris. Gør den pris eksplicit, bounded og målbar.**

Brug Exploration når:

- core economics er dokumenteret,
- campaign ikke er budget-constrained,
- value signal er stærkt,
- der er realistisk adjacent demand,
- teamet ønsker discovery frem for blot at presse mere spend gennem eksisterende demand,
- experiment kan isolere treatment.

Undgå når:

- budget allerede er for lille til core demand,
- ROAS target er en hård liquidity/margin constraint,
- tracking/value er ustabil,
- campaign er ny og baseline uklar,
- “traffic diversity” ikke har nogen business værdi.

Google anbefaler selv campaign experiments til at teste funktionen og længere observation windows [G39]. Det er vendor-guidance; designet skal stadig følge virksomhedens conversion cycle og minimum material effect.

## Smart Bidding incident protocol

### A. Conversion-data outage / corruption

Eksempler:

- tag brudt,
- dobbelt firing,
- forkert value/currency,
- offline upload stoppet,
- website outage der skaber falsk CVR-signal.

Google har **data exclusions** til at reducere impact af sådanne incidents på conversion/value-based Smart Bidding [G40].

Protocol:

```text
DETECT
→ quantify affected click/conversion window including conversion lag
→ apply data exclusion where eligible
→ stabilize targets/budget within approved risk
→ repair source data
→ backfill only according to current platform guidance
→ document incident
```

Data exclusions er ikke et generelt “fjern dårlige dage”-værktøj.

### B. Kendt, kortvarigt CVR-shift

Hvis en planlagt sale/event forventes at ændre conversion rate markant i en kort periode, kan seasonality adjustment være relevant [G41]. Google understreger, at Smart Bidding allerede håndterer normal seasonality; adjustments er til ekstraordinære, forventede changes.

**Anti-rule:** Brug ikke seasonality adjustment fordi “Black Friday kommer hvert år” uden at kunne estimere et reelt CVR-shift og scope.

---

# Budget: hvor lidt kan man bruge?

Der findes ikke et universelt “minimumsbudget”, der gør Google Ads godt eller dårligt.

Det relevante spørgsmål er:

> **Hvor meget information og hvor mange værdifulde opportunities kan budgettet realistisk købe?**

## Expected information math

```text
expected_clicks = budget / expected_CPC
expected_conversions = expected_clicks × expected_CVR
```

### Eksempel A: 500 DKK

```text
CPC = 20 DKK
500 / 20 = 25 clicks
CVR = 5%
expected conversions = 1.25
```

Det kan være nok til at få signaler om query quality, men er svagt grundlag for at konkludere på CPA eller lade automation lære et dyrt conversion goal.

### Eksempel B: 500 DKK

```text
CPC = 5 DKK
500 / 5 = 100 clicks
CVR = 10%
expected conversions = 10
```

Her kan samme budget være væsentligt mere informativt.

## 500 DKK: Google eller Meta?

**Synthesis:**

- Hvis der findes få, meget high-intent Search queries og deres expected CPC/CVR kan give nok relevant traffic → koncentrér budgettet på Search.
- Hvis produktet kræver discovery og Search volume er næsten nul → Search kan ikke skabe en efterspørgsel, der ikke findes; Meta eller Demand Gen kan være mere logisk.
- Hvis CPC er så høj, at 500 DKK kun køber 5–10 clicks → budgettet er primært et query/landing smoke test, ikke en performance-konklusion.
- Hvis ecommerce med stærkt feed og produkt-intent → Shopping/PMax kan være relevant, men undgå at sprede 500 DKK over mange produkter/campaigns.
- Split ikke 500 DKK på Search + PMax + Demand Gen + Meta “for at teste alt”. Det tester næsten ingenting.

## Minimum viable budget rule

Budgettet skal mindst kunne købe en meningsfuld observation af den beslutning, testen skal træffe.

```text
budget viability
= expected opportunity volume
× information per opportunity
× economic relevance
```

---

# “Limited by budget” — den korrekte fortolkning

Google ændrede i august 2026 bidding-adfærden for budget-limited campaigns med target-based strategies, så systemet i højere grad leverer mod det target, annoncøren faktisk har sat; rollout blev globalt færdig 27. august 2026 [G42]. Google justerer ikke automatisk budget eller target.

Det gør én governance-regel endnu vigtigere: **et target er en økonomisk instruktion, ikke bare et UI-felt.** Hvis et budget-limited campaign historisk overperformede et løst target, kan den nye mekanik bruge mere af den tolerance, targetet implicit tillader.

Evergreen: “Limited by budget” betyder, at budgettet begrænser potentiel delivery. Det betyder **ikke**, at ekstra spend automatisk er profitabelt.

Før budget increase:

1. Er tracking sund?
2. Er marginal CPA/ROAS sandsynligvis inden for target?
3. Er current result inflated af brand/remarketing?
4. Er search demand faktisk incremental?
5. Kan capacity/lager absorbere mere?
6. Er spend-limited eller target/bid-limited den reelle årsag?
7. Hvad siger response curve/Performance Planner?

Google Performance Planner simulerer bid/budget scenarios for flere campaign types og opdateres løbende; brug det som forecast input, ikke facit [G17].

---

# Recommendations og Optimization Score

Google beskriver Optimization Score som et **estimat** af setup/performance potentiale og Recommendations som suggestions baseret på history, settings og trends [G31]. Google skriver også, at Recommendations-siden ikke forudsiger, om ads faktisk vil klare sig godt [G31].

## Playbook-regel

Hver recommendation klassificeres:

```text
A. Repair / measurement / policy hygiene
B. Low-risk improvement
C. Strategic hypothesis
D. Spend-expanding recommendation
E. Control-reducing recommendation
```

A kan ofte implementeres hurtigt efter verification.

C–E kræver business case eller test.

## Auto-apply

Default governance:

- auto-apply kun for klart definerede low-risk maintenance actions,
- aldrig blind auto-apply af budget-, target-, keyword- eller automation-expansion uden approved rule,
- change history auditeres.

---

# Experimentation science

## Exploration vs confirmation

### Exploration

Mål: find lovende query, message, feed, landing eller audience hypotheses.

Kan bruge:

- platform delivery,
- search term analysis,
- creative/asset patterns,
- adaptive allocation,
- proxy metrics med risk label.

### Confirmation

Mål: afgør om ændringen skabte mere business value.

Brug:

- Google Ads experiments,
- AI Max experiments,
- PMax experiments,
- Conversion Lift,
- geo experiments,
- controlled holdout.

## Hypothesis standard

Ingen test uden:

```text
If we change X for population Y,
we expect business metric Z to change by mechanism M,
because evidence E suggests ...
Decision if positive: ...
Decision if negative: ...
```

## Test hierarchy

Som default:

1. Offer/economics
2. Conversion/value signal
3. Query/intent coverage
4. Landing page
5. Bidding/value strategy
6. Campaign/surface choice
7. Message/proof
8. Match/automation expansion
9. Assets/layout micro changes

Jo længere ned, jo mindre strategisk learning typisk.

---

# Attribution vs incrementality

## Tre spørgsmål

### Attribution
“Hvilken campaign/ad/query får credit?”

### Incrementality
“Hvor mange outcomes skete fordi ads fandt sted?”

### Optimization
“Hvad skal næste krone gøre?”

De er ikke det samme.

## Hvorfor paid search er særligt udsat

Søgning er self-selection: personer der er tæt på køb, søger mere og klikker mere. Derfor kan observational paid-search ROAS overvurdere causal effect.

Det store eBay-experiment er et klassisk eksempel: conventional non-experimental estimates overvurderede returns kraftigt i den setting [A01]. Men brand-search forskning på andre brands/auctions viser samtidig, at defense kan have positiv causal value under competition [A06][A07]. **Det er netop pointen: attribution kan ikke afgøre det universelt.**

Lewis & Rao viste på tværs af store field experiments, at advertising ROI kan være statistisk svært at måle præcist, selv ved store samples, og at selection/variance er et alvorligt problem [A02].

## Google Conversion Lift

Google Conversion Lift bruger treatment/control til at estimere causal incremental conversions/value [G21]. Availability er ikke universel. For Demand Gen kan current reporting også indeholde modeled delayed incremental conversions i studies, hvilket skal fortolkes inden for testdesignet [G21].

## Geo experiments og Meridian GeoX

Geo experiments er særligt relevante når user-level randomization ikke er tilgængelig eller når spørgsmålet er kanal-/budgeteffekt.

Meridian GeoX er Googles open-source framework til design og analyse af geo experiments [A04][G44]. To V2-regler er centrale:

1. **Experiment KPI bør være raw business outcome** som conversions/revenue fra CRM/backend, ikke attributed conversion events, fordi attribution-modellen kan bias det kausale estimat [G44].
2. **MMM bør kalibreres mod incrementality evidence**, ikke bruges som selvvaliderende sandhed [G44].

## Experiment-calibrated MMM

Meridian skelner mellem:

```text
ROI = incremental outcome / spend
mROI = return on the next additional unit of spend
```

mROI er den mere relevante størrelse for budget-allocation ved marginen [G44].

Cross-platform measurement research also supports the broader logic of using randomized experiments as ground truth to calibrate scalable models rather than treating last-click/observational metrics as causal [A09].

Gold-standard ladder:

```text
platform attribution
→ backend reconciliation
→ randomized/geo incrementality
→ calibrated MMM / response curve
→ marginal allocation with uncertainty
```

**Anti-rule:** Et flot MMM-output uden eksperimentel calibration er ikke automatisk mere “sand” end platform reporting.

---

# Search economics decomposition

For en enkel click-based funnel:

```text
CPA = CPC / CVR
```

```text
ROAS = (CVR × value_per_conversion) / CPC
```

Hvis CPA bliver dårligere, findes årsagen typisk i én eller flere af:

- CPC ↑,
- CVR ↓,
- value per conversion ↓,
- mix flytter mod dårligere customer types,
- attribution/tracking ændres.

Dette gør Search lettere at diagnosticere end et dashboard med 40 metrics.

---

# Diagnostic decision tree

## “CPA er steget 30%”

### Trin 1: Measurement

- conversion events plausible?
- primary goal ændret?
- import delay?
- consent/tracking change?
- backend matcher retning?

Hvis nej → tracking incident.

### Trin 2: CPC/auction

- CPC ændret?
- lost IS rank?
- lost IS budget?
- competitor/seasonality?
- geo/device/time mix?

### Trin 3: Query mix

- nye broad/AI Max queries?
- PMax/Search overlap?
- brand share ændret?
- irrelevant terms?

### Trin 4: Ad response

- CTR trend?
- RSA/message mix?
- asset eligibility?

### Trin 5: Landing/funnel

- session/click gap?
- CVR?
- speed/bugs?
- form/checkout?
- price/offer?

### Trin 6: Commercial quality

- new vs existing?
- lead quality?
- AOV?
- margin?
- refunds?

### Trin 7: Intervention

Vælg action mod det layer, der sandsynligvis skaber problemet.

---

# Impression share diagnostics

Google har metrics for top/absolute-top impression share samt lost share pga. budget eller rank [G30].

## Hvis Search lost IS (rank) er høj

Mulige årsager:

- bid/target restriktivt,
- ad relevance/quality,
- landing page,
- assets,
- competitive auction.

Action vælges efter economics.

## Hvis Search lost IS (budget) er høj

Mulige actions:

- mere budget **hvis marginal value er god**,
- stram query scope,
- flyt budget fra dårligere campaigns,
- forbedr CVR/value,
- justér targets.

Ikke automatisk “raise budget”.

---

# Rolling windows og conversion lag

Brug flere observationsvinduer:

- 1 dag: incident detection,
- 3 dage: early trajectory,
- 7 dage: operational trend,
- 14/28 dage: baseline/seasonality,
- længere: B2B/LTV/slow conversion.

Men vinduer skal være **volume-adaptive**.

## Conversion lag

Døm ikke kl. 14 en campaign på dagens “Conversions”, hvis business har 3–10 dages lag.

Reconcile:

- click-date view,
- conversion-time view,
- backend cohort maturity.

---

# B2B lead generation

## Primary truth

```text
spend
→ valid leads
→ qualified leads
→ opportunities
→ pipeline value
→ won
→ contribution
```

Raw CPL må ikke stå alene.

## Search

Stærkt ved:

- category/problem intent,
- small TAM men høj ACV,
- concrete solution queries.

Risici:

- low search volume,
- competitor/research traffic,
- forms fyldt af low-quality leads,
- optimizing to “submit form” i stedet for pipeline.

## PMax

Brug først når:

- CRM feedback er moden,
- primary conversion ikke er junk-lead-prone,
- URL/brand/search controls er sat,
- incrementality mod Search kan testes.

---

# Ecommerce

## Primary truth

- incremental contribution profit,
- new customer CAC,
- product-level margin,
- iROAS/POAS,
- repeat/LTV cohort.

## Core system

```text
Merchant feed
→ Shopping/PMax eligibility + matching
→ ad/product experience
→ PDP
→ cart/checkout
→ purchase
→ margin
→ repeat
```

## Risks

- high ROAS fra existing customers,
- high-margin/low-margin products blandes uden value correction,
- discounts skjuler dårlig acquisition,
- inventory mismatch,
- feed errors,
- PMax brand harvest.

---

# Local business

## Hard constraints

- service area,
- opening hours,
- actual travel distance,
- capacity.

## Primary metrics

- calls med kvalitet,
- bookings,
- directions/store visits hvor relevant,
- show rate,
- customer value.

## Search setup

Fokusér på:

- service + location intent,
- “near me”-type demand,
- emergency/high-intent modifiers,
- call/location assets hvor operationally ready.

Undgå at betale for geos, der ikke realistisk kan betjenes.

---

# SaaS / subscription

## Primary economics

- signup/trial CAC,
- activation,
- paid conversion,
- retention,
- payback,
- retained LTV.

Cheap trials med dårlig retention er ikke performance.

Search kan capture category intent; Demand Gen/YouTube kan educate; PMax bør have downstream value signal hvis det skal bruges aggressivt.

---

# Post-campaign analysis

En campaign er ikke færdig, når budgettet stopper. Den er færdig, når læringen er dokumenteret.

## Postmortem

### Business

- spend,
- attributed revenue/value,
- backend revenue/profit,
- incremental evidence,
- CAC/payback.

### Search

- profitable query themes,
- wasted query themes,
- brand/non-brand mix,
- match/AI expansion behavior,
- impression share constraints.

### PMax/Demand Gen

- channel mix,
- search terms/themes,
- audience signal findings,
- asset/creative patterns,
- brand/retargeting exposure,
- URL behavior.

### Shopping

- product groups,
- margin,
- feed quality,
- price/availability issues,
- promotion effect.

### Landing

- CVR,
- device gaps,
- funnel drop-off,
- message match.

### Measurement

- attribution vs backend,
- conversion lag,
- modeled/observed mix,
- causal evidence.

---

# Learning object

```yaml
learning_id: GADS-2026-0042
status: validated
scope:
  market: DK
  business_type: B2B
  campaign_type: Search
  customer_state: high_intent_nonbrand
hypothesis: "..."
intervention: "..."
control: "..."
result:
  primary_metric: qualified_cac
  effect: "..."
  interval: "..."
evidence_type: INTERNAL_CAUSAL_TEST
confidence: high
validity_notes:
  - "..."
review_at: 2027-03-01
next_test: "..."
```

Dårlig learning:

> “Broad match er bedst.”

God learning:

> “For DK non-brand Search på service X reducerede broad + tCPA qualified CAC med 14% mod exact/phrase-control i 6-ugers experiment. Landing/offer og primary conversion var konstante. Resultatet generaliseres ikke til brand eller service Y uden ny test.”

---

# Privacy, consent og policy

## Danmark/EU baseline

Datatilsynet beskriver, at cookies/pixels og lignende typisk behandler personoplysninger, og at der før ikke-nødvendige cookies normalt skal indhentes samtykke; teknisk nødvendige cookies er undtaget fra cookiebekendtgørelsens samtykkekrav [L01].

Google kræver samtidig for EEA-trafik relevante consent-signals for measurement/personalization use cases. Consent Mode opererer bl.a. med `ad_storage`, `ad_user_data`, `ad_personalization` og `analytics_storage` [G19][G20].

Dette er operational risk design, ikke juridisk rådgivning.

## Customer Match / first-party data

I EEA kræver Google consent-signals til Customer Match/personalization use cases [L03].

Playbookregel:

> **“Vi har emailadressen” er ikke det samme som “vi må bruge den til advertising”.**

## Sensitive categories

Google begrænser advertiser-curated audiences i sensitive interest categories og har særskilte policy-regler for bl.a. health, political affiliation/content, race/ethnicity, religion, sexual orientation, trade union membership og negative financial status [L04].

Live-check policy før execution.

---

# Contradiction ledger

## “Højeste position giver mest salg”

**Status:** Ufuldstændigt.

Højere position kan give mere visibility/click volume, men hvis CPC stiger hurtigere end conversion value, falder profit.

**Rule:** Optimer business outcome; brug position som diagnostic/constraint.

## “Quality Score 10/10 = best account”

**Status:** Forkert.

Google siger eksplicit, at Quality Score ikke er KPI og ikke er auction input [G02].

## “Broad match er Googles anbefaling, så det er altid bedst”

**Status:** Forkert universalisering.

Broad kan udnytte Smart Bidding/context stærkt, men economics, signal quality, TAM og budget varierer.

**Rule:** broad er en testbar expansion strategy.

## “Exact match giver fuld kontrol”

**Status:** Forældet forståelse.

Exact matcher semantisk intent/close meanings og er ikke bogstavelig string-only [G03].

## “PMax er bedre end Search fordi den bruger mere AI”

**Status:** Ingen universel evidens.

Google tilbyder selv PMax uplift/upgrade experiments [G12].

## “Search er altid bedre end Meta fordi intent er højere”

**Status:** For kategorisk.

Search kan kun købe demand, der eksisterer. Meta/Demand Gen kan skabe demand. CPC og margin kan gøre high-intent traffic uprofitabel.

## “Brand ROAS er høj, så brand ads er vores bedste acquisition”

**Status:** Potentielt stærkt biased.

High base intent betyder stor selection. eBay-field experiment viser, at brand paid search kan have meget lav incrementality i visse settings [A01].

## “Data-driven attribution viser hvad der skabte salget”

**Status:** Forkert kausal fortolkning.

DDA fordeler credit; Conversion Lift/holdout estimerer causal lift [G21][G22].

## “Limited by budget betyder vi bør øge budget”

**Status:** Forkert.

Det betyder kun, at delivery er budgetbegrænset. Raise kun hvis marginal economics forsvarer det.

## “Optimization Score 100% betyder optimal profit”

**Status:** Forkert.

Score er platformens estimate af setup-performance potentiale, ikke et business-profit scorecard [G31].

## “Flere campaigns = mere control”

**Status:** Kun hvis split ændrer en beslutning.

Ellers fragmenterer du data og budget.

## “Shopping er SEO for product titles”

**Status:** Misvisende.

Product titles/attributes skal være relevante og præcise, men Merchant Center fraråder keyword-lister/SEO stuffing i product highlights [G27].

---

## “Search Terms Report viser alle queries”

**Status:** Forkert.

Google skjuler nogle low-volume search terms af privacy-grunde. Search Terms Insights kan stadig aggregere dem i categories/subthemes [G04].

### Konklusion

Search Terms Report er konkret query telemetry; Search Terms Insights er coverage/context. Brug begge.

## “Excellent Ad Strength betyder bedre performance”

**Status:** Ikke dokumenteret som universal regel.

Google siger eksplicit, at Ad Strength ikke bruges i Ad Rank, Quality Score eller auction wins [G34]. Store practitioner-datasæt finder heller ikke en stabil business-outcome relation [P05].

### Konklusion

Brug Ad Strength til creation feedback, ikke score-chasing.

## “Broad match + Smart Bidding er altid den moderne vinder”

**Status:** Vendor recommendation, ikke universel law.

Google anbefaler kombinationen i mange setups [G03], mens practitioner- og historisk field data viser, at exact/phrase ofte kan være mere effektive i konkrete cohorts [P04][A08].

### Konklusion

Test expansion mod downstream value. Heterogenitet er den korrekte default-antagelse.

## “PMax channel report fortæller hvilke kanaler der skabte salget”

**Status:** Attribution/diagnostic, ikke causal decomposition.

Channel performance reporting viser delivery og attributed results [G37]. Det observerer ikke counterfactualen uden PMax/channel exposure.

### Konklusion

Brug report til diagnose; brug experiments/geo/lift til incrementality.

## “Demand Gen VTC = samme slags conversion som et click conversion”

**Status:** Forkert.

VTC er knyttet til impression exposure og kan nu bruges i Demand Gen bidding [G38].

### Konklusion

Segmentér click/engaged-view/view-through. Brug Platform Comparable til cross-platform lens og lift/holdout til causal value.

## “Data Strength Uplift = incremental business lift”

**Status:** Ikke som evergreen antagelse.

Google introducerer Data Strength/Uplift diagnostics og rapporterer vendor uplifts [G43]. Det er nyttigt measurement feedback, men ikke automatisk et randomized business-effect estimate.

### Konklusion

Brug som implementation diagnostic, ikke som erstatning for causal measurement.

---

# Anti-playbook: practices der aktivt skal undgås

1. Jagte #1 position uden unit economics.
2. Optimere Quality Score som slutmål.
3. Gøre CTR til winner metric for sales.
4. Lade page views/scrolls være primary conversions uden business rationale.
5. Importere alle GA4 key events som bidding goals.
6. Optimere lead gen på raw CPL uden CRM quality.
7. Køre broad/AI Max før measurement er troværdig og derefter skyde skylden på “algoritmen”.
8. Køre exact/phrase for evigt uden at teste missed opportunity.
9. Tilføje negatives reaktivt til hvert eneste mærkelige query uden pattern reasoning.
10. Fragmentere små budgetter over mange campaigns/ad groups.
11. Antage at brand conversions er incremental.
12. Antage at PMax er incremental fordi total Google Ads conversions stiger.
13. Lade PMax sende traffic til support/career/irrelevante URLs.
14. Behandle PMax audience signals som hård targeting.
15. Fylde search themes med near-duplicate keywords.
16. Optimere Merchant feed med keyword stuffing.
17. Ignorere price/availability mismatch.
18. Bruge promotions uden margin-/incrementality-view.
19. Hæve budget alene fordi UI siger “limited by budget”.
20. Auto-applye strategic recommendations uden governance.
21. Bruge Performance Planner forecast som garanti.
22. Sammenligne Google Ads og GA4 uden at forstå click-date/session/conversion-time forskelle.
23. Kalde DDA for incrementality.
24. Dømme today-data før conversion lag er modnet.
25. Ændre bids, budget, landing og keywords samtidig og kalde det learning.
26. Pause en campaign efter én dårlig dag uden variance/context.
27. Behandle cheap Display/Demand Gen clicks som billig acquisition uden downstream quality.
28. Bruge sensitive/customer data uden lawful basis/consent.
29. Glemme change history og experiment integrity.
30. Skalere average ROAS uden marginal view.

---

30. At antage at Search Terms Report viser 100% af query universe.
31. At omskrive profitable RSAs alene for at jagte `Excellent` Ad Strength.
32. At kalde PMax channel reporting for causal channel contribution.
33. At blande Demand Gen view-through conversions med click conversions uden separat reporting.
34. At bruge VTC-optimization uden på forhånd at definere attribution/reporting lens.
35. At bruge Smart Bidding Exploration i budget-constrained campaigns og kalde lavere ROAS “scaling”.
36. At bruge data exclusions til almindelige dårlige performanceperioder.
37. At bruge seasonality adjustments til normal seasonality, som Smart Bidding allerede forventes at håndtere.
38. At ændre targets/budget under tracking incidents uden at dokumentere corrupted-data window.
39. At behandle Google-reported AI/first-party-data uplift som forventet uplift i egen virksomhed.
40. At bruge attributed conversions som primary KPI i et geo incrementality experiment.

# Performance cadence

## Near-real-time, kun incidents

- tracking outage,
- spend runaway,
- site/checkout down,
- Merchant disapprovals,
- payment/account issues,
- feed price/availability catastrophe.

Ingen keyword-micromanagement hvert kvarter.

## Dagligt

- spend/pacing,
- primary conversion health,
- CPC/CPA/value trend,
- policy/disapprovals,
- site/feed health,
- major query anomalies,
- lag-aware performance.

## Ugentligt

- query theme review,
- negatives,
- Search/PMax overlap,
- lead/customer quality,
- product/feed economics,
- campaign budget allocation,
- creative/asset coverage,
- experiment results/backlog.

## Månedligt

- business economics refresh,
- brand incrementality evidence,
- budget response,
- PMax/Demand Gen channel mix,
- customer cohort quality,
- landing tests,
- value model.

## Kvartalsvist

- causal calibration,
- policy/privacy audit,
- stale learning review,
- strategic Google vs Meta/channel allocation,
- feature/migration live-check.

---

# Daily decision brief

```text
1. Health: GREEN / YELLOW / RED
2. Primary business KPI vs expected
3. Tracking/feed status
4. Largest explained movement
5. Query/channel mix change
6. Conversion-lag adjusted forecast
7. Actions taken
8. Explicit no-ops
9. Escalations
```

---

# Search campaign brief

```yaml
campaign_id:
business_goal:
primary_conversion:
conversion_value_logic:
target_economics:
  target_cac:
  break_even_cpc:
  break_even_roas:
market:
intent_clusters:
  -
brand_strategy:
match_strategy:
negative_strategy:
landing_map:
asset_plan:
bidding:
budget:
measurement_plan:
experiment_plan:
```

---

# PMax brief

```yaml
campaign_id:
business_goal:
primary_goals:
value_model:
merchant_feed: true|false
product_scope:
asset_groups:
audience_signals:
search_themes:
brand_exclusions:
negative_keywords:
url_expansion:
url_exclusions:
new_customer_goal:
budget:
bidding:
channel_reporting_plan:
incrementality_plan:
```

---

# Experiment card

```yaml
experiment_id:
decision_question:
hypothesis:
control:
treatment:
population:
randomization_unit:
primary_metric:
minimum_material_effect:
secondary_metrics:
conversion_lag:
planned_duration:
sample_logic:
stopping_rule:
confounders:
emergency_override:
result:
decision:
learning_id:
```

---

# Volatile implementation registry — live-check før execution

Følgende må **ikke** hardcodes som evig best practice:

- AI Max migration dates/settings,
- AI Max for Shopping beta scope/language support,
- Dynamic Search Ads availability,
- AI Overview / AI Mode ad inventory,
- exact/phrase/broad prioritization details,
- number of PMax search themes,
- PMax channel/search-term/asset reporting fields,
- Demand Gen channel inventory,
- Demand Gen VTC optimization defaults/eligibility,
- Platform Comparable methodology,
- Display migration status,
- Smart Bidding Exploration eligibility/tolerance ranges,
- target-based bidding implementation,
- Smart Bidding labels,
- attribution model availability,
- Conversion Lift eligibility,
- conversion-volume recommendations,
- audience segment availability,
- asset-count recommendations,
- RSA limits,
- Merchant promotion country eligibility,
- Performance Planner eligibility,
- API/Data Manager upload paths,
- Data Strength metric definitions,
- policy wording,
- consent requirements/platform enforcement details,
- agentic/Advisor features.

## Aktuel 21. september 2026 snapshot

- AI Max for Search er ude af beta; campaign-level broad match/text customization migration starter september 2026, mens DSA auto-upgrade er flyttet til februar 2027 [G32].
- AI Max for Shopping er beta og inkluderer bl.a. text customization, Final URL Expansion og format selection; current language/feature support skal live-checkes [G36].
- Ads kan vise over/under AI Overviews på markeder hvor AI Overviews findes; in-AI-Overview ads har mere begrænset current market/language scope [G35].
- Google tester nye AI Mode ad formats; de må behandles som current experiment inventory, ikke evergreen surfaces [G45].
- PMax har channel performance reporting, full search terms reporting og richer asset metrics [G37].
- Demand Gen inkluderer YouTube, Discover, Gmail, Maps og GDN med channel controls; Display migration er stadig phased [G14][G15].
- Demand Gen VTC optimization er open beta og er aktuelt default ON for newly created Demand Gen campaigns; applies to video on supported surfaces [G38].
- `Conversions (Platform Comparable)` er en alternate Demand Gen reporting view og ændrer ikke bidding [G38].
- Smart Bidding Exploration er aktuelt knyttet til Search Target ROAS og har specific tolerance/eligibility mechanics, som skal live-checkes [G39].
- Target-based bidding for `Limited by budget` campaigns blev globalt ændret 17.–27. august 2026 for tCPA/tROAS/tCPC contexts [G42].
- Enhanced conversions/offline conversion uploads er flyttet mod Data Manager API; Data Manager API er den centrale unified ingestion path [G18][G43].
- Google har lanceret/udvidet Data Strength diagnostics og Meridian/GeoX measurement tooling; vendor uplift-tal skal fortsat behandles som vendor evidence [G43][G44].

---

# Research backlog: det public evidence ikke kan svare universelt på

1. Hvad er vores reelle incremental ROAS på brand Search under vores faktiske competitor pressure?
2. Hvilke non-brand intent clusters har højest contribution profit?
3. Hvornår slår broad/AI Max exact/phrase på **qualified** economics i vores account?
4. Hvilken del af broad/AI Max expansion er genuinely incremental demand vs substitution?
5. Hvor meget PMax er incremental til eksisterende Search/Shopping/organic?
6. Hvilke PMax channels skaber vores reelle value, og hvilke høster demand?
7. Hvilke audience signals tilfører noget ud over systemets baseline?
8. Hvilke search themes tilfører discovery uden quality loss?
9. Hvornår giver Smart Bidding Exploration positiv expected value of information?
10. Hvad er vores marginal spend-response curve pr. channel/intent family?
11. Hvilke products bør have højere/lavere bidding value pga. margin/LTV/stock?
12. Hvor meget Demand Gen skaber senere branded Search/direct conversions?
13. Hvor stor del af Demand Gen VTC er incremental i vores population?
14. Hvilken Platform Comparable vs standard attribution view er mest nyttig til vores cross-platform reporting?
15. Hvilke landing pages skaber mest qualified value pr. click/search category?
16. Hvor meget conversion lag skal reporting nowcastes for?
17. Hvilken Google vs Meta allocation giver højest incremental contribution ved næste krone?
18. Hvornår er promotions incremental frem for discounting af eksisterende demand?
19. Hvor godt er vores MMM kalibreret mod lift/geo evidence?
20. Hvor ofte skal causal calibration gentages, før market/platform drift gør gamle estimates stale?

---

# Research evidence map

## Google official / platform source of truth

### G01 — Ad Rank
**Source:** Google Ads Help, “About Ad Rank”  
**URL:** https://support.google.com/google-ads/answer/1722122  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Ad Rank depends at high level on bid, ad/landing quality, thresholds, competition, search context and expected asset/format impact. Auction-time quality affects eligibility, position and CPC.  
**Use:** Rank/auction doctrine.  

### G02 — Quality Score
**Source:** Google Ads Help, “About Quality Score for Search campaigns”  
**URL:** https://support.google.com/google-ads/answer/6167118  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Quality Score is diagnostic, not KPI, and not an auction input. Components: expected CTR, ad relevance, landing page experience.  

### G03 — Keyword matching options
**Source:** Google Ads Help, “About keyword matching options”  
**URL:** https://support.google.com/google-ads/answer/7478529  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Modern exact/phrase/broad use semantic intent; account prioritization includes exact identical queries, phrase/broad/search themes, relevance and Ad Rank.  
**Limitation:** Prioritization mechanics are volatile.

### G04 — Search terms and negative keywords
**Sources:** Google Ads Help, search terms report + negative keyword ideas  
**URLs:**  
https://support.google.com/google-ads/answer/2472708  
https://support.google.com/google-ads/answer/7102466  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Search Terms Report shows actual queries with sufficient reportable activity, but low-volume queries may be omitted for privacy. Search Terms Insights groups all terms into intent categories/subthemes and can include privacy-hidden low-volume demand in aggregate. **Use:** Combine report + insights; never assume report = 100% query universe.

### G05 — Smart Bidding
**Source:** Google Ads Help, “About Smart Bidding”  
**URL:** https://support.google.com/google-ads/answer/7065882  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** tCPA, tROAS, Maximize Conversions and Maximize Conversion Value use auction-time optimization. June 2026 naming changes do not change underlying behavior.

### G06 — Value-based bidding
**Source:** Google Ads Help, “About Smart Bidding using value-based bidding for Search and Shopping”  
**URL:** https://support.google.com/google-ads/answer/15099424  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`

### G07 — AI Max for Search
**Source:** Google Ads Help, “How AI Max for Search campaigns works”  
**URL:** https://support.google.com/google-ads/answer/15910187  
**Evidence:** `CURRENT_PLATFORM_MECHANIC`  
**Finding:** AI Max search term matching can expand using broad/keywordless technology informed by keywords, creatives and URLs; asset optimization adds automation.

### G08 — AI Max experiments
**Source:** Google Ads Help, “About AI Max experiments”  
**URL:** https://support.google.com/google-ads/answer/16450159  
**Evidence:** `PLATFORM_EXPERIMENT_TOOL`  
**Finding:** Allows controlled within-campaign traffic/budget split to test AI Max before full application.

### G09 — Performance Max campaign integration
**Source:** Google Ads Help, “About Performance Max campaigns”  
**URL:** https://support.google.com/google-ads/answer/10724817  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Search exact-match priority, brand exclusions/negatives and search controls interact with PMax.  
**Limitation:** Mechanics can change.

### G10 — PMax audience signals
**Source:** Google Ads Help, “About audience signals for Performance Max campaigns”  
**URL:** https://support.google.com/google-ads/answer/14530785  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Signals are optional suggestions; PMax can serve beyond them when likely to convert.

### G11 — PMax search themes
**Source:** Google Ads Help, “About search themes”  
**URL:** https://support.google.com/google-ads/answer/16669486  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Search themes provide incremental business context to keywordless targeting; Google recommends distinct/non-duplicate themes. Exact limits are volatile.

### G12 — PMax experiments
**Source:** Google Ads Help, “About Performance Max experiments”  
**URL:** https://support.google.com/google-ads/answer/12997711  
**Evidence:** `PLATFORM_EXPERIMENT_TOOL`  
**Finding:** Uplift, upgrade and optimization experiments can test incremental value or campaign alternatives.

### G13 — Final URL Expansion
**Source:** Google Ads Help, “About Final URL expansion in Performance Max”  
**URL:** https://support.google.com/google-ads/answer/14337539  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Google can choose more relevant URLs based on intent; exclusions/controls matter.

### G14 — Demand Gen channel controls
**Source:** Google Ads Help, “Channel controls in Demand Gen campaigns”  
**URL:** https://support.google.com/google-ads/answer/15973205  
**Evidence:** `CURRENT_PLATFORM_MECHANIC`  
**Finding:** YouTube, Discover, Gmail, Maps and GDN available as current visual-first surfaces with channel controls/reporting.

### G15 — Display → Demand Gen migration
**Source:** Google Ads Help, “Google Display Ads campaigns have a new home in Demand Gen”  
**URL:** https://support.google.com/google-ads/answer/17051545  
**Evidence:** `CURRENT_PLATFORM_AVAILABILITY`  
**Finding:** Phased migration began June 2026.  
**Limitation:** Migration status is volatile.

### G16 — Ad assets
**Source:** Google Ads Help, “About assets”  
**URL:** https://support.google.com/google-ads/answer/7331111  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Assets include links, calls, locations, prices, promotions, images, lead forms, etc.; expected impact is part of Ad Rank.

### G17 — Performance Planner
**Source:** Google Ads Help, “About Performance Planner”  
**URL:** https://support.google.com/google-ads/answer/9230124  
**Evidence:** `VENDOR_FORECAST_TOOL`  
**Finding:** Models bid/budget scenarios with recent auction/seasonality inputs.  
**Limitation:** Forecast, not causal proof or guarantee. Display/Video planning support changed March 2026.

### G18 — Enhanced conversions / leads
**Sources:** Google Ads Help  
**URLs:**  
https://support.google.com/google-ads/answer/15713840  
https://support.google.com/google-ads/answer/16884284  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Web/leads settings unified in 2026; offline lead upload implementation moved to Data Manager API from June 15, 2026.

### G19 — Consent Mode reference
**Source:** Google Ads Help  
**URL:** https://support.google.com/google-ads/answer/13802165  
**Evidence:** `PLATFORM_PRIVACY_MECHANIC`  
**Finding:** Includes ad_storage, ad_user_data, ad_personalization, analytics_storage.

### G20 — EEA consent requirements
**Source:** Google Ads Help, “Updates to consent mode for traffic in EEA”  
**URL:** https://support.google.com/google-ads/answer/13695607  
**Evidence:** `POLICY_REQUIREMENT`  
**Finding:** EEA advertisers using Google tags/SDKs for relevant measurement/personalization must collect consent and share consent signals according to Google EU UCP.

### G21 — Conversion Lift
**Sources:** Google Ads Help  
**URLs:**  
https://support.google.com/google-ads/answer/12003020  
https://support.google.com/google-ads/answer/14102450  
**Evidence:** `CAUSAL_PLATFORM_EXPERIMENT`  
**Finding:** Treatment vs control; reports incremental conversions/value, iCPA/iROAS.  
**Limitation:** Eligibility/access not universal.

### G22 — Data-driven attribution
**Source:** Google Ads Help  
**URL:** https://support.google.com/google-ads/answer/6394265  
**Evidence:** `ATTRIBUTION_MODEL`  
**Finding:** Allocates credit based on advertiser interaction/conversion paths.  
**Limitation:** Attribution, not randomized incrementality.

### G23 — GA4 conversions vs key events
**Source:** Google Analytics Help  
**URL:** https://support.google.com/analytics/answer/13965727  
**Evidence:** `PLATFORM_MECHANIC`

### G24 — GA4 default channel groups
**Source:** Google Analytics Help  
**URL:** https://support.google.com/analytics/answer/9756891  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** PMax/Demand Gen commonly classified as Cross-network; Search/Shopping/Video/Display have distinct definitions.

### G25 — Google Ads clicks vs GA sessions
**Source:** Google Analytics Help  
**URL:** https://support.google.com/analytics/answer/14452452  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Differences can arise from click/session definitions and click-date vs conversion-time reporting.

### G26 — Product data in Ads
**Source:** Google Ads Help, “About Product data”  
**URL:** https://support.google.com/google-ads/answer/2382952  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Shopping/PMax use product attributes to create/match ads; classic Search keywords are not the core product-matching mechanism.

### G27 — Merchant Center product data specification
**Sources:** Google Merchant Center Help  
**URLs:**  
https://support.google.com/merchants/answer/7052112  
https://support.google.com/merchants/answer/6324415  
https://support.google.com/merchants/answer/9216100  
**Evidence:** `PLATFORM_MECHANIC / POLICY`  
**Finding:** Accurate titles, images, price, availability and identifiers drive eligibility/matching; mismatches can reduce eligibility; keyword stuffing is discouraged in product highlight fields.

### G28 — Merchant Center promotions
**Sources:** Google Merchant Center Help  
**URLs:**  
https://support.google.com/merchants/answer/13507894  
https://support.google.com/merchants/answer/2877565  
**Evidence:** `PLATFORM_MECHANIC / POLICY`

### G29 — Conversion value rules
**Source:** Google Ads Help  
**URL:** https://support.google.com/google-ads/answer/10518330  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Can express business-value differences by audience/geo/device and feed value-based Smart Bidding; should not merely duplicate conversion-probability signals already used by bidding.

### G30 — Top / absolute top impression-share metrics
**Source:** Google Ads Help  
**URL:** https://support.google.com/google-ads/answer/7501826  
**Evidence:** `PLATFORM_METRIC`

### G31 — Recommendations / Optimization Score
**Sources:** Google Ads Help  
**URLs:**  
https://support.google.com/google-ads/answer/3448398  
https://support.google.com/google-ads/answer/9061546  
https://support.google.com/google-ads/answer/10276359  
**Evidence:** `VENDOR_RECOMMENDATION_SYSTEM`  
**Finding:** Recommendations are customized suggestions/estimates, not predictions of guaranteed success; auto-apply exists and requires governance.

### G32 — AI Max migration status
**Sources:** Google Ads Help + Google Ads product blog  
**URLs:**  
https://support.google.com/google-ads/answer/13389795  
https://support.google.com/google-ads/answer/2471185  
https://blog.google/products/ads-commerce/dsa-upgrade-to-ai-max-2026/  
**Evidence:** `CURRENT_PLATFORM_AVAILABILITY`  
**Finding:** Broad-match campaign setting/text customization migrations begin September 2026; DSA auto-upgrade moved to February 2027.  
**Limitation:** Volatile.


### G33 — Search terms insights / privacy-complete themes
**Source:** Google Ads Help, “About search terms insights”  
**URL:** https://support.google.com/google-ads/answer/11386930  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Intent categories/subcategories use all search terms, including terms not exposed in Search Terms Report for privacy; low-volume terms may be grouped as “other”.  
**Use:** Complements G04 for query-universe interpretation.

### G34 — Ad Strength
**Source:** Google Ads Help, “About Ad Strength for responsive search ads”  
**URL:** https://support.google.com/google-ads/answer/9921843  
**Evidence:** `PLATFORM_MECHANIC / CREATION_FEEDBACK`  
**Finding:** Ad Strength is a creation/editing feedback tool; it does not determine eligibility and is not used to calculate Ad Rank, Quality Score or auction wins.  
**Use:** Reject score-chasing as performance doctrine.

### G35 — Ads and AI Overviews
**Source:** Google Ads Help, “About ads and AI Overviews”  
**URL:** https://support.google.com/google-ads/answer/16297775  
**Evidence:** `CURRENT_PLATFORM_MECHANIC / OFFICIAL_RECOMMENDATION`  
**Finding:** Existing Search/Shopping/PMax/App ads can be eligible above/below AI Overviews; in-AI-Overview inventory has more limited current market/language availability and considers query + Overview content. Google currently requires AI-powered matching for in-Overview eligibility.  
**Limitation:** Inventory, market list and matching requirements are volatile; broad/AI recommendations are vendor guidance, not universal ROI evidence.

### G36 — AI Max for Shopping
**Sources:** Google Ads Help + Google Ads & Commerce blog  
**URLs:**  
https://support.google.com/google-ads/answer/17091277  
https://blog.google/products/ads-commerce/ai-max-for-shopping/  
**Evidence:** `CURRENT_BETA_MECHANIC / VENDOR_REPORTED_TEST`  
**Finding:** Shopping beta adds text customization, Final URL Expansion and format selection to reach more conversational/search demand while retaining Shopping controls.  
**Limitation:** Google-reported uplift is vendor evidence and beta scope/language support changes.

### G37 — Performance Max transparency
**Sources:** Google Ads Help + Google Ads & Commerce blog  
**URLs:**  
https://support.google.com/google-ads/answer/16260130  
https://blog.google/products/ads-commerce/channel-performance-reporting-coming-to-performance-max/  
**Evidence:** `CURRENT_REPORTING_MECHANIC`  
**Finding:** PMax supports channel performance reporting, full search terms reporting and richer asset metrics.  
**Limitation:** Attributed channel results are diagnostic; they do not identify channel incrementality by themselves.

### G38 — Demand Gen VTC optimization + Platform Comparable
**Sources:** Google Ads Help  
**URLs:**  
https://support.google.com/google-ads/answer/16399666  
https://support.google.com/google-ads/answer/15299024  
**Evidence:** `CURRENT_PLATFORM_MECHANIC / ATTRIBUTION_MECHANIC`  
**Finding:** Demand Gen can optimize using view-through conversions; current open beta is default-on for newly created Demand Gen campaigns. Platform Comparable columns provide an alternate attribution/reporting lens and do not change bidding.  
**Use:** Separate impression-attributed outcomes from click outcomes and causal lift.

### G39 — Smart Bidding Exploration
**Source:** Google Ads Help, “Best practices for Smart Bidding Exploration”  
**URL:** https://support.google.com/google-ads/answer/16294686  
**Evidence:** `CURRENT_PLATFORM_MECHANIC / OFFICIAL_RECOMMENDATION`  
**Finding:** Current Search/tROAS feature trades some effective ROAS tolerance for traffic diversity; Google recommends unconstrained budgets, established campaigns and experiments.  
**Limitation:** Eligibility, tolerance and recommended durations are volatile/vendor guidance.

### G40 — Smart Bidding data exclusions
**Sources:** Google Ads Help  
**URLs:**  
https://support.google.com/google-ads/answer/10276486  
https://support.google.com/google-ads/answer/10370710  
**Evidence:** `PLATFORM_INCIDENT_MECHANIC`  
**Finding:** Data exclusions can reduce impact of corrupted/missing conversion data on conversion/value-based Smart Bidding. They affect bidding data, not reporting, and are not intended for frequent/general performance cleanup.

### G41 — Seasonality adjustments
**Source:** Google Ads Help, “About seasonality adjustments”  
**URL:** https://support.google.com/google-ads/answer/10369906  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Smart Bidding already accounts for ordinary seasonality; adjustments are intended for expected major short-term CVR changes such as promotions.  
**Limitation:** Supported campaign types/time guidance can change.

### G42 — August 2026 target-based bidding changes
**Sources:** Google Ads Help  
**URLs:**  
https://support.google.com/google-ads/answer/17061251  
https://support.google.com/google-ads/answer/17125145  
**Evidence:** `CURRENT_PLATFORM_MECHANIC`  
**Finding:** Global rollout completed 27 August 2026 for target-based strategies in budget-limited campaigns; system now aims for more consistent delivery against stated targets. Google does not automatically change budgets or targets.  
**Use:** Treat target settings as real economic instructions.

### G43 — Data Manager / first-party measurement stack
**Sources:** Google Ads Help, Google for Developers, Google Ads & Commerce blog  
**URLs:**  
https://support.google.com/google-ads/answer/15713840  
https://developers.google.com/data-manager/api/reference/rest  
https://blog.google/products/ads-commerce/data-strength-updates/  
**Evidence:** `CURRENT_MEASUREMENT_MECHANIC + VENDOR_REPORTED_TEST`  
**Finding:** Data Manager API is a unified first-party ingestion path; 2026 migrations moved offline/enhanced-lead uploads toward it. Google introduced additional Data Strength diagnostics and vendor-reported uplift measures.  
**Limitation:** Uplift figures/diagnostics are not universal causal business benchmarks.

### G44 — Meridian / GeoX / experiment calibration
**Sources:** Google for Developers, Meridian  
**URLs:**  
https://developers.google.com/meridian/geox/implementation-of-geo-testing  
https://developers.google.com/meridian/docs/post-modeling/channel-recommendation  
https://developers.google.com/meridian/docs/advanced-modeling/set-custom-priors-past-experiments  
https://developers.google.com/meridian/docs/advanced-modeling/how-to-choose-treatment-prior-types  
**Evidence:** `CAUSAL_METHOD_GUIDANCE / MODELING_GUIDANCE`  
**Finding:** GeoX recommends raw unfiltered business KPI rather than attributed conversions for geo tests. Meridian recommends calibration with incrementality experiments; mROI is defined as return on an additional unit of spend.  
**Use:** Causal calibration + marginal allocation.  
**Disclosure:** Google tooling/methodology; model output still depends on design/data/priors.

### G45 — AI Max / AI Mode 2026 experiment layer
**Sources:** Google Ads & Commerce blog  
**URLs:**  
https://blog.google/products/ads-commerce/ai-max-testing-planning-tools/  
https://blog.google/products/ads-commerce/google-marketing-live-search-ads/  
**Evidence:** `CURRENT_PLATFORM_ROLLOUT / EXPERIMENTAL_FEATURES`  
**Finding:** 2026 rollout includes new AI Max testing/planning capabilities and experimental AI Mode ad formats.  
**Limitation:** Treat availability and format behavior as volatile implementation, not evergreen doctrine.

### G46 — PMax asset A/B experiments
**Source:** Google Ads Help  
**URL:** https://support.google.com/google-ads/answer/16807329  
**Evidence:** `CURRENT_PLATFORM_EXPERIMENT_TOOL`  
**Finding:** PMax supports beta asset-set A/B testing within asset groups for eligible advertisers.  
**Limitation:** Beta availability and exact mechanics are volatile.

## Academic / causal evidence

### A01 — Consumer Heterogeneity and Paid Search Effectiveness
**Source:** Blake, Nosko & Tadelis; NBER w20171 / Econometrica, 2015  
**URL:** https://www.nber.org/papers/w20171  
**Evidence:** `LARGE_RANDOMIZED_FIELD_EXPERIMENT`  
**Finding:** In eBay’s setting, observational paid-search returns materially overstated causal returns; brand ads had no measurable short-term incremental effect; non-brand effects were heterogeneous.  
**Limitation:** One very large advertiser/context; not a universal “turn off brand” rule.

### A02 — The Unfavorable Economics of Measuring the Returns to Advertising
**Source:** Lewis & Rao, Quarterly Journal of Economics, 2015  
**URL:** https://academic.oup.com/qje/article-abstract/130/4/1941/1914592  
**Evidence:** `25_LARGE_FIELD_EXPERIMENTS`  
**Finding:** Advertising ROI is hard to estimate precisely even at large scale; observational selection bias is a serious concern.

### A03 — Measuring Ad Effectiveness Using Geo Experiments
**Source:** Vaver & Koehler, Google Research, 2011  
**URL:** https://research.google/pubs/measuring-ad-effectiveness-using-geo-experiments/  
**Evidence:** `RANDOMIZED_GEO_METHOD`  
**Disclosure:** Google authors.

### A04 — Meridian GeoX
**Source:** Google Research, 2026  
**URL:** https://research.google/pubs/meridian-geox-an-open-source-framework-for-precision-and-efficiency-in-geo-experiments/  
**Evidence:** `CURRENT_CAUSAL_METHOD_RESEARCH`  
**Finding:** Open-source framework for design/analysis of geo experiments using multiple counterfactual methods and placebo inference.  
**Disclosure:** Google authors/vendor benchmarking.

### A05 — Ghost Ads
**Source:** Johnson, Lewis & Nubbemeyer, Journal of Marketing Research, 2017  
**URL:** https://journals.sagepub.com/doi/10.1509/jmr.15.0297  
**Evidence:** `RANDOMIZED_MEASUREMENT_METHOD`  
**Finding:** Counterfactual/ghost-ad experimental design can improve precision/cost of digital ad incrementality measurement.


### A06 — Competition and Crowd-Out for Brand Keywords in Sponsored Search
**Source:** Simonov, Nosko & Rao, Marketing Science, 2018  
**URL:** https://pubsonline.informs.org/doi/10.1287/mksc.2017.1065  
**Evidence:** `LARGE_SCALE_FIELD_EXPERIMENTS`  
**Finding:** Across thousands of brands on Bing, own-brand ads had modest positive effects without competition; competitor stealing and defensive value could become much larger when competitors were present.  
**Use:** Strong evidence that brand-search incrementality is competition/context-dependent.  
**Limitation:** Bing/historical auction environment; not direct 2026 Google mechanic evidence.

### A07 — Competitive Advertising on Brand Search: Traffic Stealing and Click Quality
**Source:** Simonov & Hill, Marketing Science, 2021  
**URL:** https://pubsonline.informs.org/doi/10.1287/mksc.2021.1289  
**Evidence:** `LARGE_QUASI_EXPERIMENT`  
**Finding:** Competitors stole substantially more focal-brand clicks when the focal brand's top paid link was removed; stolen clicks had different quality.  
**Use:** Supports brand-defense experiments and competitor-pressure diagnosis.  
**Limitation:** Bing/historical context.

### A08 — Broad or exact? Search Ad matching decisions with keyword specificity and position
**Source:** Yang, Pancras & Song, Decision Support Systems, 2021  
**URL:** https://www.sciencedirect.com/science/article/pii/S0167923621000014  
**Evidence:** `FIELD_EXPERIMENT + OBSERVATIONAL`  
**Finding:** In one historical Chinese hotel Google Ads setting, broad underperformed exact on several metrics with heterogeneity by keyword specificity/position.  
**Use:** Evidence against universal “broad always wins” doctrine.  
**Limitation:** Data largely 2011–2012; predates modern Smart Bidding/semantic matching, so it cannot determine current match-type winner.

### A09 — Predicted Incrementality by Experimentation (PIE)
**Source:** Gordon, Moakler & Zettelmeyer, NBER Working Paper 35044, 2026  
**URL:** https://www.nber.org/papers/w35044  
**Evidence:** `RCT_DERIVED_MEASUREMENT_MODEL`  
**Finding:** Uses many randomized ad experiments to predict campaign-level incrementality; illustrates how experimental ground truth can calibrate scalable measurement better than naive last-click proxies in its studied setting.  
**Use:** Supports experiment-calibrated predictive/measurement layers.  
**Disclosure:** Meta-related data/authors; methodological relevance is cross-platform, not a Google mechanic.

## Independent UX / post-click evidence

### B01 — Baymard Checkout UX benchmark
**Sources:** Baymard Institute, Checkout UX 2025 / cart abandonment research  
**URLs:**  
https://baymard.com/research-articles/current-state-of-checkout-ux  
https://baymard.com/research-articles/ecommerce-checkout-usability-report-and-benchmark  
**Evidence:** `LARGE_USABILITY_BENCHMARK + SURVEY`  
**Finding:** Large-scale checkout research documents substantial mobile/desktop friction, including forced account creation, complex flows and form problems as avoidable abandonment drivers.  
**Use:** Supports landing/checkout friction as a paid-media economics input.  
**Limitation:** Do not treat Baymard uplift estimates as guaranteed uplift for a specific advertiser.

## Practitioner context — Tier C

### P01 — Search Engine Land, PPC budgeting in 2026
**URL:** https://searchengineland.com/ppc-budgeting-adjust-scale-optimize-data-452493  
**Evidence:** `PRACTITIONER_EVIDENCE`  
**Use:** Contemporary signal/budget governance context, not source of truth.

### P02 — Search Engine Land, manual vs automated Google Ads, Sep 2026
**URL:** https://searchengineland.com/manual-automated-google-ads-campaigns-allocate-budget-487344  
**Evidence:** `PRACTITIONER_EVIDENCE`

### P03 — Optmyzr large account/PMax studies
**URLs:**  
https://www.optmyzr.com/blog/performance-max-study/  
https://www.optmyzr.com/blog/optmyzr-state-of-ppc-study/  
**Evidence:** `LARGE_OBSERVATIONAL_PRACTITIONER_DATA`  
**Finding:** Observed performance for PMax settings such as signals/themes/asset structures is mixed and sometimes contradictory across cohorts.  
**Use:** Supports testing instead of turning platform/practitioner heuristics into universal laws.  
**Limitation:** Selection/confounding; customers of a PPC tool; not randomized.


### P04 — Optmyzr match-type study, 30,000 accounts (2026)
**Source:** Optmyzr, May 2026  
**URL:** https://www.optmyzr.com/blog/google-ads-match-type-performance/  
**Evidence:** `LARGE_OBSERVATIONAL_PRACTITIONER_DATA`  
**Finding:** Exact frequently led efficiency metrics while broad delivered more volume; patterns varied by ecommerce, lead-gen and brand/non-brand.  
**Use:** Current counterweight to universal broad-match claims.  
**Limitation:** Selection/confounding; Optmyzr customer base; not randomized.

### P05 — Optmyzr RSA / Ad Strength studies
**Sources:** Optmyzr, 2024 and 2026  
**URLs:**  
https://www.optmyzr.com/blog/google-ad-strength-study/  
https://www.optmyzr.com/blog/google-rsa-performance-study/  
**Evidence:** `LARGE_OBSERVATIONAL_PRACTITIONER_DATA`  
**Finding:** Across roughly 20k–22k accounts / 1M+ ads, higher Ad Strength did not map cleanly to better CPA/ROAS.  
**Use:** Triangulates Google's statement that Ad Strength is creation feedback, not auction ranking.  
**Limitation:** Observational, selected advertiser population.

## Legal / privacy / policy

### L01 — Datatilsynet: Cookies og GDPR
**URL:** https://www.datatilsynet.dk/regler-og-vejledning/gdpr-univers-for-smaa-virksomheder/cookies-og-gdpr  
**Evidence:** `DANISH_REGULATORY_GUIDANCE`  
**Finding:** Cookies/pixels normally involve personal data; non-necessary cookies require consent under the described Danish framework, with separate GDPR obligations.

### L02 — Datatilsynet: Vejledning om direkte markedsføring
**URL:** https://www.datatilsynet.dk/Media/638237218449834564/Vejledning%20om%20direkte%20markedsf%C3%B8ring.pdf  
**Evidence:** `DANISH_REGULATORY_GUIDANCE`  
**Finding:** Direct marketing, profiling, tracking and personal-data processing require legal-basis analysis; the guide includes online/social examples.

### L03 — Google Customer Match EEA consent
**URL:** https://support.google.com/google-ads/answer/14546648  
**Evidence:** `PLATFORM_POLICY`

### L04 — Google restricted targeting / sensitive categories
**URL:** https://support.google.com/adspolicy/answer/143465  
**Evidence:** `PLATFORM_POLICY`  
**Finding:** Restrictions apply to advertiser-curated audiences for sensitive categories; live-check before launch.

---

# Source-handling rules

1. Google official determines current mechanics, inventory and policy.
2. Google uplift claims are `VENDOR_REPORTED_TEST`, never universal expected uplift.
3. Randomized/causal evidence has highest weight on actual incremental effect.
4. Historical search research supports measurement principles, not current feature mechanics.
5. Practitioner guidance generates hypotheses; it does not become doctrine by repetition.
6. Internal data must be tagged `causal`, `association` or `heuristic`.
7. If platform advice conflicts with unit economics, unit economics wins unless measurement is broken.
8. Every volatile product detail gets a live-check before execution.
9. Privacy-thresholded or modeled platform reports must be labeled as such; missing query-level detail is not zero activity.
10. AI/automation recommendations are vendor guidance unless backed by independent causal evidence or internal experiments.
11. Channel-level attributed reporting must never be renamed “incremental contribution” without a counterfactual design.

---

# Final doctrine

> **Google Ads-performance skabes ikke af “det rigtige keyword”, højeste position, højeste Ad Strength eller den nyeste AI-feature. Den skabes ved at forbinde reel customer demand med korrekt economics, relevante queries/products/creative, stærke first-party value-signals, passende automation og guardrails, en friktionsfri destination og measurement, der kan skelne platform-credit fra incremental business value.**

Den operationelle loop er:

```text
UNDERSTAND BUSINESS ECONOMICS
→ MAP DEMAND / CUSTOMER INTENT
→ CHOOSE THE RIGHT GOOGLE SURFACE
→ DEFINE THE TRUE VALUE EVENT
→ VERIFY TRACKING + CONSENT + DATA QUALITY
→ BUILD THE SIMPLEST VIABLE STRUCTURE
→ MAP QUERY / PRODUCT / AUDIENCE TO OFFER + LANDING
→ CHOOSE BIDDING THAT MATCHES VALUE
→ LAUNCH WITH GUARDRAILS
→ OBSERVE WITHOUT OVERREACTING
→ DIAGNOSE AUCTION → QUERY → AD → LANDING → COMMERCIAL QUALITY
→ SEPARATE BAU FROM EXPLICIT EXPLORATION SPEND
→ TEST MATERIAL UNCERTAINTIES
→ RECONCILE GOOGLE ADS → GA4 → CRM → FINANCE
→ CALIBRATE ATTRIBUTION WITH LIFT / GEO WHEN POSSIBLE
→ CALIBRATE MMM / RESPONSE CURVES AGAINST EXPERIMENTS WHEN MATERIAL
→ SCALE ONLY WHILE MARGINAL ECONOMICS JUSTIFY IT
→ STORE LEARNING WITH CONTEXT
→ BUILD THE NEXT BETTER HYPOTHESIS
```

---

# One-page Golden Standard

1. Definér contribution, target CAC/CPA og break-even economics før spend.
2. Afklar om jobbet er intent capture, commerce, cross-channel optimization eller demand generation.
3. Vælg Search, Shopping, PMax eller Demand Gen efter jobbet — ikke efter hype.
4. Brug det dybeste reliable conversion/value signal, der har nok volume.
5. Primary conversions styrer bidding; hold proxy-events secondary medmindre downstream-relationen er valideret.
6. Link Ads/GA4/CRM og send downstream value/quality tilbage hvor lovligt.
7. Audit consent, tags, enhanced conversions/Data Manager, currency, deduplication og conversion lag før performance vurderes.
8. Brug measurement ladder: platform → backend → business value → causal lift → calibrated allocation.
9. Byg Search rundt om intent clusters og landing answers, ikke keyword ritualer.
10. Brug exact/phrase/broad som forskellige control/expansion modes og test dem mod business outcome.
11. Search Terms Report er ikke komplet; kombiner det med Search Terms Insights og backend quality.
12. Brug negatives på dokumenterede irrelevante patterns, ikke panik over enkelte queries.
13. Jag ikke #1 position; jag profitabel marginal demand.
14. Brug Quality Score til diagnose, aldrig som KPI.
15. Brug Ad Strength til creation feedback, aldrig som auction/performance KPI.
16. Byg RSA/asset-portfolios med forskellige value/proof messages, ikke synonyms.
17. AI Overviews/AI Mode er surfaces/matching changes; de ophæver ikke economics, relevance og experiment discipline.
18. Merchant feed skal være korrekt, komplet, margin-aware og landing-consistent.
19. AI Max for Shopping skal testes som expansion treatment, ikke accepteres som automatisk upgrade.
20. PMax kræver rene goals, value, feed/assets, URL/brand controls og incrementality-plan.
21. PMax audience signals er suggestions; search themes skal tilføre ny information.
22. Brug PMax channel/search reporting til diagnose, ikke som causal channel decomposition.
23. Demand Gen kræver creative, audience reasoning og channel-level interpretation.
24. Segmentér Demand Gen click-, engaged-view- og view-through conversions; VTC er attribution, ikke causal proof.
25. Brug Platform Comparable som cross-platform lens, ikke som sandhed om incrementality.
26. Smart Bidding må kun optimere på values, virksomheden faktisk ønsker mere af.
27. Smart Bidding Exploration er eksplicit learning spend; tolerance og test skal være pre-defined.
28. Ved tracking outage: behandl det som incident, brug data exclusions hvor relevant, og beskyt bidding mod corrupted data.
29. Brug seasonality adjustments kun ved forventede store, kortvarige CVR-shifts — ikke almindelig seasonality.
30. “Limited by budget” udløser marginal-economics review, ikke automatisk budget raise.
31. Husk august-2026 target-bidding ændringen: dit tCPA/tROAS target er en reel økonomisk instruktion i budget-limited campaigns.
32. Performance Planner, Recommendations, Optimization Score og Data Strength er inputs/diagnostics, ikke orakler.
33. Koncentrér små budgetter; 500 DKK fordelt over fem campaign types er ikke en valid test.
34. Brug Google Ads metrics til delivery, GA4 til onsite/cross-channel behavior og CRM/finance til business truth.
35. DDA er attribution; lift/holdout/geo er incrementality.
36. Brand Search skal causal-calibreres og læses sammen med competitor pressure/organic substitution.
37. Geo experiments bør bruge raw business KPI, ikke attributed conversions.
38. Kalibrér MMM/response curves mod experiments, når beslutningsstørrelsen forsvarer det.
39. Døm ikke umodne conversions; forstå click-date, conversion-time og lag.
40. Diagnosticér CPA via auction cost × query mix × ad response × landing CVR × commercial value før intervention.
41. Test én beslutning tydeligt; beskyt experiment integrity og pre-definér minimum material effect.
42. Scale efter næste krones forventede marginal value med uncertainty, ikke historical average ROAS alene.
43. Gem learnings med market, intent, offer, landing, campaign type, period, measurement quality og evidence strength.
44. Live-check 2026+ platform features/policies; hold evergreen decision logic stabil.

---

# V2 validation note

V2 er resultatet af en ny research- og falsifikationsrunde oven på V1. Den vigtigste forbedring er ikke antallet af features, men **strengere separation mellem fire forskellige typer sandhed**:

```text
1. PLATFORM MECHANIC
Hvad Google faktisk kan/gør lige nu.

2. VENDOR RECOMMENDATION
Hvad Google anbefaler eller rapporterer uplift på.

3. CAUSAL / INDEPENDENT EVIDENCE
Hvad kontrollerede designs viser om faktisk effekt.

4. INTERNAL BUSINESS TRUTH
Hvad der er incremental og profitabelt for netop denne virksomhed.
```

V2's største sanity-check-resultater er:

- V1's economics/measurement core var korrekt.
- Search-term reporting er mere ufuldstændigt end en “query truth”-formulering antyder.
- Ad Strength er endnu tydeligere afgrænset som feedback, ikke auction KPI.
- Broad/AI expansion skal behandles som testbar exploration, ikke modernity-bias.
- Brand Search kræver heterogen causal reasoning, ikke eBay som universelt facit.
- PMax er blevet mere transparent, men transparency er ikke incrementality.
- Demand Gen VTC gør attribution-governance vigtigere.
- Smart Bidding incident controls og seasonality controls fortjener en eksplicit operational standard.
- Data Manager/first-party signals og experiment-calibrated measurement er blevet mere centrale i 2026.
- AI Overviews/AI Mode gør semantic relevance vigtigere, men de ændrer ikke den økonomiske grundlov.

Ingen statisk playbook kan være “100% sand” på alle accounts eller forblive komplet efter næste platform-release. Den højeste forsvarlige standard er derfor:

> **Stå hårdt på evidens, economics og causal reasoning; stå blødt på feature-navne, vendor-uplifts og universelle tactical claims. Live-check mekanikken, og gør resten til kontrollerede tests.**

Denne V2 er den mest forsvarlige syntese ud fra den offentligt tilgængelige evidens og de aktuelle Google-kilder ved research cutoff 21. september 2026.

