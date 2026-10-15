# Meta Ads Master Playbook — V2.0 Validated Golden Standard
## Evidensbaserede standarder for høj performance på Facebook, Instagram og relevante Meta-flader

**Version:** 2.0 — Validated Golden Standard  
**Research cutoff:** 21. september 2026  
**Scope:** Betalt Meta-annoncering med primært fokus på Facebook og Instagram samt relevante placements og Meta-flader, når de understøtter det konkrete forretningsmål.  
**Dokumenttype:** Evergreen best-practice playbook. Ikke en klik-for-klik Ads Manager-manual, ikke en AI-playbook og ikke et feature-katalog.  
**Operator-neutral:** Standarderne gælder uanset om arbejdet udføres af mennesker, software eller en kombination.  

---

# Executive validation verdict

Denne V2 er resultatet af et nyt sanity check af V1 mod Metas aktuelle officielle træning og dokumentation, uafhængig akademisk forskning, større field experiments, marketing measurement-litteratur, usability/CRO-forskning, EU/dansk regulering samt erfarne Meta-specialisters aktuelle observationer.

Målet har ikke været at bevare V1. Målet har været at **forsøge at falsificere den**: Hvilke regler er faktisk robuste? Hvilke er blot practitioner folklore? Hvilke gælder kun i en bestemt kampagnetype? Hvilke Meta-tal er vendor-reported og må derfor ikke behandles som universelle forventninger? Hvilke regler bliver hurtigt forældede?

## Overordnet konklusion

V1 havde den rigtige kerneretning, men var for tæt koblet til et fremtidigt AI-operativsystem. V2 skiller de to ting fuldstændigt ad. Denne playbook definerer alene **hvad god Meta-annoncering er**.

Den stærkeste tværgående evidens peger på følgende system:

> **Forretningsmål og økonomi → korrekt optimeringssignal → enkel kampagnestruktur → stærkt offer → meningsfuldt forskellige creative-hypoteser → passende audience/placements → friktionsfri post-click experience → disciplineret måling og eksperimentering → læring → næste bedre beslutning.**

Det matcher i høj grad Metas aktuelle Performance 5-retning: account simplification, automation, creative diversification, data quality og results validation [M01]. Det stemmer også med Metas nuværende professionelle curriculum, som organiserer kompetencen omkring objectives/signals, audience, buying/bidding, delivery, placements/budget, creative og measurement [M05][M06][M13][M20][M21].

## Hvad der blev bekræftet

| Princip | V2-status | Hvorfor |
|---|---|---|
| Business outcome før platform-metrics | **BEKRÆFTET** | CTR/CPC/CPM er diagnostik; mål og optimeringssignal bør ligge tæt på reel forretningsværdi [M05]. |
| Account simplification / mindre unødig fragmentering | **BEKRÆFTET** | Direkte del af Performance 5 og Metas aktuelle uddannelse [M01][M21]. |
| Høj datakvalitet og robuste conversion-signaler | **BEKRÆFTET** | Meta fremhæver event matching, coverage, quality, deduplication og freshness [M02]; stor Meta-field research viser værdi af offsite conversion-signaler [A03]. |
| Creative diversification | **BEKRÆFTET, præciseret** | Meta anbefaler variation i concepts/motivators, messages, visuals og formats [M07]; “flere filer” er ikke det samme som flere idéer [P02]. |
| Mobile-/placement-appropriate creative | **BEKRÆFTET** | Meta lærer eksplicit mobile-first og placement-/format-fit [M10][M13]. |
| Broad/automated audience som stærk baseline i mange performance-setups | **BEKRÆFTET MED FORBEHOLD** | Meta anbefaler Advantage+ og reach-optimization, men understøtter fortsat custom/lookalike/detailed audiences [M06][M21]. Ikke en universel broad-regel. |
| Retargeting kan skabe værdi | **BEKRÆFTET MED FORBEHOLD** | Randomiseret forskning viser kausal retargeting-effekt i en konkret kontekst, men timing og intent betyder noget [A04][A08]. Høj attributed ROAS er ikke i sig selv incremental value. |
| A/B-/lift-tests til validering | **STÆRKT BEKRÆFTET** | Meta skelner eksplicit mellem A/B tests og RCT/lift [M04]; uafhængig/akademisk forskning viser, at observational attribution ofte ikke genskaber RCT-effekter [A09]. |
| Incrementality frem for blind attribution | **STÆRKT BEKRÆFTET** | Meta bruger Conversion Lift til calibration; PIE-forskning på 2.226 Meta-eksperimenter viser stor forskel i prædiktiv kvalitet vs. 7-day last-click i den undersøgte setting [M03][A01]. |
| Marginal economics ved scaling | **BEKRÆFTET SOM ØKONOMISK STANDARD** | Gennemsnitlig ROAS kan skjule diminishing returns. Budget skal vurderes på næste krones forventede effekt, ikke kun historisk average. |
| Landing/checkout/form experience er en del af ad performance | **STÆRKT BEKRÆFTET** | Post-click friktion kan ødelægge medieeffektivitet; Baymards omfattende checkout-research dokumenterer betydelige usability-problemer og abandonment [UX01][UX02]. |
| Kontinuerlig læring forbedrer performance capability | **BEKRÆFTET** | Stor Facebook/Instagram field research finder stor heterogenitet og mønstre konsistente med learning-by-doing og advertiser sophistication [A02]. |

## Hvad der blev korrigeret eller nedgraderet

1. **“Broad er altid bedst.”** Afvist som universel regel. Broad/Advantage+ er ofte en stærk baseline, men hard constraints, niche-TAM, eligibility, economics, compliance og intern evidens kan kræve andet [M06][M21][P01].
2. **“Start narrow og udvid gradvist”** er heller ikke en universel regel. Start med den enkleste audience-struktur, der respekterer reelle constraints, og test kun ekstra segmentering når den kan ændre beslutninger.
3. **“Video slår static.”** Afvist som generel lov. Metas Reels-tests støtter native vertical video i netop Reels-konteksten; det beviser ikke universel video-overlegenhed [M08].
4. **“Retargeting er bedst, fordi ROAS er højest.”** Afvist. Høj-intent audiences har høj base conversion probability; vurder incremental lift og saturation [A04][A08].
5. **“Frequency over X = fatigue.”** Afvist. Fatigue diagnosticeres gennem et bundle af performance-, reach-, frequency-, creative-age- og audience-signaler. Timing/spacing betyder noget [A04][A07].
6. **“Learning phase kræver altid præcis X conversions per uge.”** Ikke en evergreen standard. Live Meta-mekanik kan have aktuelle thresholds/statusser, men den robuste regel er at give delivery tilstrækkeligt signal og undgå unødig fragmentation/churn.
7. **“Budget må aldrig ændres mere end 20%.”** Afvist som folklore. Der kan være aktuelle produktkonsekvenser af større edits, men scaling skal styres af marginaløkonomi, uncertainty og risiko, ikke et magisk procenttal.
8. **“CTR viser hvilken annonce der er bedst.”** Afvist. CTR kan være nyttigt diagnostisk, men kan belønne clickbait og dårlig qualification.
9. **“Platform ROAS = sand ROI.”** Afvist. Attribution er operational credit assignment, ikke kausal proof [M03][M04][A01][A09].
10. **“Flere creatives er altid bedre.”** Korrigeret til: flere **meningsfuldt forskellige** hypotheses kan være værdifulde; near-duplicates skaber volumen uden nødvendigvis at skabe ny læring [M07][P02].
11. **Eksakte vendor-uplifts** er fjernet som generelle standarder. De må kun bruges som kontekst for den specifikke testpopulation og design, fx Metas Reels split tests [M08].
12. **Runtime-, automation- og governance-design** er holdt ude af playbooken. Det hører til i et separat implementation-projekt.

## Hvad “gold standard” betyder

Ingen offentlig playbook kan love “maksimal ROAS” eller “lavest mulige spend” i alle virksomheder. Auktion, konkurrence, pris, produkt, margin, creative, brand, landing page, seasonality og kundeadfærd varierer. Den eneste forsvarlige gold-standard-definition er derfor:

> **Brug de mest robuste tværgående principper som default, og gør virksomhedsspecifikke spørgsmål til kontrollerede tests frem for dogmer.**

V2 er skrevet efter den standard. Hvor evidensen er stærk, står reglen hårdt. Hvor evidensen er kontekstafhængig, står den som testbar default. Hvor Meta-produktet er volatilt, står kun den evergreen beslutningslogik i core-playbooken.

---

# Sådan bruges playbooken

Denne playbook beskriver **hvordan man tænker, designer, måler og beslutter**. Den beskriver ikke, hvor en bestemt knap befinder sig i Ads Manager.

Meta ændrer løbende produktnavne, standardindstillinger, placements, attribution-windows, learning labels, audience controls og automatiseringsfeatures. Derfor gælder to lag:

1. **Evergreen core:** economics, objectives, signals, audience reasoning, creative, offer, post-click experience, experimentation, incrementality, scaling og learning.
2. **Volatile implementation layer:** aktuelle feature-navne, UI, API-felter, thresholds, placement inventory og policy-ordlyd. Disse live-checkes før execution.

Et skiftende Meta-parameter må aldrig ophøjes til en permanent marketinglov.

---

# Evidensstandard og kildehierarki

| Tier | Kildetype | Hvordan den bruges |
|---|---|---|
| **A1** | Meta official / Blueprint / legal / engineering | Source of truth for aktuelle platformmekanikker, policies og Metas egne anbefalinger. Vendor-uplifts behandles som kontekst, ikke universelle løfter. |
| **A2** | Randomiserede eksperimenter, peer-reviewed forskning, stærke akademiske working papers | Højeste vægt ved spørgsmål om kausal effekt og measurement. Generaliserbarhed vurderes altid. |
| **B** | Stærk observational/econometric forskning, measurement frameworks, usability-research | Triangulering, mekanismer, diagnosticering og designprincipper. |
| **C** | Erfarne Meta-specialister / agencies med stor praktisk eksponering | Aktuel taktisk kontekst og testbare hypotheses. Ikke permanent source of truth. |
| **D** | Egen virksomhedsdata og interne heuristics | Kan blive vigtigst for den konkrete virksomhed, men skal klassificeres korrekt som causal test, association eller heuristic. |

## Evidenslabels

- `PLATFORM_MECHANIC`
- `POLICY_REQUIREMENT`
- `CAUSAL_RANDOMIZED`
- `STRONG_OBSERVATIONAL`
- `USABILITY_RESEARCH`
- `VENDOR_REPORTED_TEST`
- `PRACTITIONER_EVIDENCE`
- `INTERNAL_CAUSAL_TEST`
- `INTERNAL_ASSOCIATION`
- `SYNTHESIS`
- `HYPOTHESIS`

## Konfliktregel

Når kilder modsiger hinanden:

1. Tjek om de faktisk måler samme objective, population, funnel stage, format og tidsperiode.
2. Platformmekanik/policy: brug aktuel Meta-dokumentation.
3. Effekt/ROI: vægt randomiseret/kausal evidens over attributed/observational claims.
4. Bevar heterogenitet; et gennemsnit er ikke en lov for alle annoncører.
5. Hvis svaret stadig er uklart, gør spørgsmålet til et internt eksperiment.

---

# De 30 gyldne standarder

1. **Start med business value, ikke med Ads Manager.**
2. **Optimer mod det dybeste pålidelige event, der repræsenterer reel værdi og har nok signal.**
3. **Profit, contribution og incremental value er vigtigere end platform ROAS alene.**
4. **Et objective er kun godt, hvis det matcher det outcome virksomheden faktisk vil skabe.**
5. **Tracking- og signal-kvalitet er performance-infrastruktur.**
6. **Konsolider som default; fragmentér kun af en reel business-, legal-, message-, economics- eller experiment-grund.**
7. **Audience-inputs er hypotheses og constraints, ikke en perfekt beskrivelse af hvem delivery faktisk rammer.**
8. **Broad er en baseline, ikke en religion. Narrow er en test/constraint, ikke en religion.**
9. **Creative diversity betyder forskellige idéer, motivatorer, proof-strategier, visuals og formats — ikke bare flere filer.**
10. **Creative er en af de centrale controllable performance-levers, men kan ikke isoleres fra offer, audience, economics, signaler og landing experience.**
11. **Design mobile-first og placement-aware.**
12. **Vælg format efter communication job; der findes ingen universel static-vs-video-vinder.**
13. **Reels/Stories bør behandles som vertikale, immersive environments — ikke bare som steder at croppe et Feed-asset.**
14. **Hook skaber opmærksomhed; relevans, proof og offer skaber kvalificeret progression.**
15. **Copy skal gøre værdi, målgruppe, mekanisme, proof og næste skridt let at forstå.**
16. **Claims skal kunne dokumenteres. Scarcity, testimonials og performance-tal må ikke opfindes.**
17. **Annonce og landing page skal føles som samme løfte.**
18. **Post-click friction er mediefriktion: hastighed, mobile UX, formular/checkout, trust og message match påvirker acquisition economics.**
19. **CTR, CPC og CPM er diagnostiske metrics; de er ikke virksomhedens endelige scorecard.**
20. **Diagnosticér det rigtige lag før du ændrer noget: auction cost, audience, creative, offer, destination, tracking eller sales/operations.**
21. **Undgå reaktive ændringer på støj. No-op er en gyldig beslutning.**
22. **Eksperimenter skal besvare beslutninger, ikke bare producere dashboards.**
23. **Ændr så få forklarende variable som testens spørgsmål kræver.**
24. **Brug practical significance og økonomisk materiality sammen med statistisk evidens.**
25. **Attribution er kreditfordeling; incrementality er kausal effekt. Bland dem ikke sammen.**
26. **Retargeting skal vurderes mod dens høje baseline-intent, ikke kun sin attributed ROAS.**
27. **Creative fatigue er en diagnose, ikke et universelt frequency-tal.**
28. **Scale efter marginal economics og uncertainty, ikke efter magiske procentregler.**
29. **Gem læring med kontekst: offer, market, customer state, concept, format, audience, placement, period og measurement quality.**
30. **Den langsigtede fordel er hurtigere valid learning: færre antagelser, bedre tests, stærkere næste creative/offer/audience/budget-beslutning.**

---

# Økonomien før Ads Manager

## Definér et business objective, ikke kun et campaign objective

Før en kampagne oprettes skal følgende være kendt:

- Hvad er den faktiske værdi af en konvertering?
- Er målet nye kunder, alle kunder, omsætning, profit, lead quality, pipeline eller retention?
- Hvad er den accepterede CAC/CPA?
- Hvad er bruttomargin/dækningsbidrag?
- Hvad er refund/cancellation rate?
- Er LTV robust nok til at bruge, eller er det blot et optimistisk estimat?
- Hvilken payback-periode er acceptabel?
- Hvilken kapacitet kan virksomheden faktisk levere på?

## Primære formler

### ROAS

```text
ROAS = attributed_revenue / ad_spend
```

Bruges som platform-/kanaleffektivitet, men er **ikke automatisk kausal**.

### Incremental ROAS

```text
iROAS = incremental_revenue / ad_spend
```

Hvor incremental revenue er estimeret via et kausalt design eller en kalibreret model.

### Profit on Ad Spend / contribution ROAS

```text
POAS = contribution_profit_generated / ad_spend
```

Den er normalt mere forretningsnær end revenue ROAS.

### CAC

```text
CAC = acquisition_spend / number_of_new_customers
```

Bedre version:

```text
incremental_CAC = spend / incremental_new_customers
```

### CPA

```text
CPA = spend / qualifying_actions
```

“Qualifying” er vigtigt. Et lead uden salgsintention bør ikke have samme værdi som et SQL eller et køb.

### Break-even ROAS

Hvis contribution margin før annoncer er `CM` som andel af revenue:

```text
break_even_ROAS = 1 / CM
```

Eksempel: 40% contribution margin → break-even revenue ROAS ca. 2,5. Det gælder kun under den valgte margin-definition og uden andre variable anskaffelsesomkostninger.

### Marginal ROAS

```text
mROAS = change_in_incremental_revenue / change_in_spend
```

Det er denne størrelse, der i sidste ende bør styre skalering, ikke historisk gennemsnits-ROAS.

## KPI hierarchy

### Tier 1: Business truth
- Inkrementel contribution profit
- Inkrementel revenue
- New-customer contribution profit
- CAC/payback
- Pipeline revenue eller closed-won revenue for B2B
- Qualified lead rate

### Tier 2: Conversion economics
- CPA
- Purchase CVR
- Lead-to-qualified rate
- AOV
- Refund/cancel rate
- Repeat purchase/LTV cohort

### Tier 3: Delivery diagnostics
- CPM
- Reach
- Impressions
- Frequency
- Spend/pacing

### Tier 4: Creative diagnostics
- Link CTR
- CPC
- Landing page view rate
- Video hold/continuation rates
- Engagement quality
- Saves/shares/comments, hvis de har forklaringsværdi

**Playbookregel:** Tier 4 må aldrig overvinde Tier 1 uden en kausal forklaring.

---

# Measurement architecture: Sandhed før optimering

Meta anbefaler selv høj datakvalitet som en Performance 5-søjle [M01], og Blueprint beskriver event coverage, event quality, event matching, deduplication og freshness som centrale elementer i Conversions API-drift [M02]. Et randomiseret Meta-studie med over 70.000 annoncører fandt også, at tab af offsite-signaler kunne forringe annoncørernes effektivitet, men studiet er lavet med Meta-involvering og skal derfor læses med disclosure in mente [A03].

## Fire lag af measurement

### Lag A: Platform telemetry
Meta-delivery, spend, impressions, clicks, platform-attributed conversions.

### Lag B: First-party behavioral truth
Website/app analytics, server events, CRM, checkout, orders, qualified leads, subscriptions, cancellations.

### Lag C: Finance/commercial truth
Net revenue, margin, refunds, COGS, sales outcome, customer status, LTV.

### Lag D: Causal truth
A/B tests, Conversion Lift, geo experiments, randomized holdouts, calibrated MMM.

Teamet skal kende forskellen. Lag A kan være hurtigt og nyttigt. Lag D er mere troværdigt for “hvad skabte faktisk værdi?”, men dyrere og langsommere.

## Event design

Events skal repræsentere en meningsfuld progression:

```text
ad exposure
→ click / engaged visit
→ landing page
→ product/service interest
→ high-intent action
→ qualified conversion
→ commercial conversion
→ retained value
```

Undgå at optimere efter lette events, hvis de kan manipuleres eller ikke korrelerer med værdi. Hvis purchase/qualified-lead volume er for lavt til stabil læring, kan et tidligere event anvendes midlertidigt, men teamet skal markere `proxy_risk` og teste sammenhængen med downstream-value.

## Signal quality checklist

Før performance vurderes:

- Events modtages?
- Browser/server overlap deduplikeres korrekt?
- Timestamps og freshness er sunde?
- Event IDs er stabile?
- Currency/value korrekt?
- Customer status korrekt (new/existing)?
- CRM-resultater sendes tilbage, hvor lovligt og relevant?
- Lead quality kan kobles tilbage til acquisition source?
- Tracking coverage ændret siden gårsdag?
- Consent/lawful basis intakt?

Hvis measurement er brudt, er optimering på performance-data suspenderet. **Tracking incident beats media optimization.**

## Attribution er ikke incrementality

Meta Blueprint fremhæver A/B Testing og Conversion Lift til at måle “true performance” [M04], og et aktuelt Conversion Lift-kursus beskriver lift som grundlag for at kalibrere attribution og budgetbeslutninger [M03].

Derfor:

- Platform attribution = nyttig operationel telemetry.
- Backend attribution = nødvendig reconciliation.
- Incrementality = kausal validering.
- MMM = langsigtet kanal-/budgetmodel, der helst kalibreres mod eksperimenter.

Meta Robyn anbefaler selv eksperimentelle/kausale resultater som ground truth til MMM-kalibrering og løbende incrementality-studier [B01].

## Measurement cadence

**Kontinuerligt:** tracking health og spend.  
**Dagligt:** pacing, anomalies, operational diagnostics.  
**Ugentligt:** performance cohorts, creative/audience patterns, lead/customer quality.  
**Månedligt/kvartalsvist afhængigt af spend:** lift/holdout/geo eller anden kausal kalibrering.  
**Strategisk:** MMM eller samlet budgetrespons, når datamængden tillader det.

---

# Campaign architecture: simplificér før du fragmenterer

Meta inkluderer account simplification og automation i Performance 5 [M01]. Den vigtigste evergreen-fortolkning er ikke “brug feature X”, men:

> **Fragmentér kun, når separationen skaber en reel beslutningsfordel.**

## Gode grunde til separation

- Forskellig geografi med forskellig økonomi/availability
- Forskellige sprog, der kræver separat creative
- Forskellig eligibility/legal constraint
- Markant forskellig LTV/margin
- Forskellige business goals
- Eksperimenter der kræver isolering
- Forskellige offers/landing experiences
- Kapacitets-/lagerstyring

## Dårlige grunde til separation

- “Sådan har vi altid gjort”
- En ad set per interesse uden valideret læringsbehov
- En ad set per lille demografisk variation
- Én kampagne per creative bare for rapportering
- Overlap mellem ad sets, som alligevel kan udvides algoritmisk
- Segmentering for at få en følelse af kontrol

Praktikerdata fra Jon Loomer peger på, at mange targeting inputs i 2026 fungerer mere som suggestions end hårde constraints, og at flere ad sets bygget omkring sådanne inputs kan skabe unødigt overlap [P01]. Dette er praktiker-evidens, ikke en universel platformlov, men passer med retningen i Metas egen automatisering.

## Objective alignment

Vælg optimeringsmål efter den forretningshandling, der faktisk skaber værdi. Blueprint understreger at campaign objective og conversion/performance goal bør afspejle business goal [M05].

**Princip:** Jo længere væk optimeringseventet er fra pengene, jo større proxy-risk.

## Placements

Default: lad systemet have adgang til brede relevante placements, medmindre:

- creative er åbenlyst inkompatibelt,
- brand safety/compliance kræver andet,
- en kausal eller solid intern test viser vedvarende dårlig marginaløkonomi,
- message/experience bryder på placementet.

På Reels anbefaler Meta Advantage+ placements og ved manuel selection mindst seks placements i den aktuelle guidance [M08]. Det præcise antal er volatile implementation detail; evergreen-princippet er at undgå unødvendig inventory-restriction og bygge creative, der faktisk passer til placementets sprog.

---

# ICP og audience intelligence

## ICP er ikke bare Meta-targeting fields

Et godt ICP-dokument beskriver:

- Job-to-be-done
- Trigger
- Problem/ønske
- Hvor dyrt problemet er
- Hvad personen allerede prøver
- Objections
- Buying criteria
- Evidence/proof de tror på
- Situation/context
- Customer value/LTV
- Conversion friction
- Exclusion/eligibility

Demografi kan være relevant, men bør ikke erstatte motivation og use case.

## Audience hypothesis hierarchy

1. **Hard constraints:** lov, geography, eligibility, age restriction, service area.
2. **First-party high-signal groups:** kunder, high-LTV cohorts, qualified leads, product users, engaged site/app behavior.
3. **Modeled audiences:** lookalikes eller Meta automation baseret på kvalitetsdata.
4. **Contextual/detailed targeting hypotheses:** interesser/adfærd hvor det er meningsfuldt.
5. **Broad/automated discovery:** systemet bruger conversion-, engagement- og ad-signaler til discovery.

Meta Blueprint lærer stadig new/custom/lookalike audiences og Advantage+ audience [M06]. Den rigtige konklusion er derfor ikke “targeting er dødt”, men “targeting inputs er én del af et større modeldrevet matching-system”.

## Broad vs narrow: den korrekte beslutningsregel

Der findes ingen universel vinder.

### Start med broad/automated som stærk baseline når:

- TAM er stor nok
- conversion signal er pålideligt
- event volume er rimeligt
- produktet kan købes bredt
- hard constraints er få
- creative tydeligt kvalificerer modtageren

### Brug mere struktureret audience input når:

- TAM er meget lille
- B2B-niche kræver særlig qualification
- serviceområde er snævert
- produktet har eligibility constraints
- konverteringssignal er nyt/svagt
- der er stærke first-party seeds
- læringsformålet er at forstå en specifik segmenthypotese

### Ikke tilladt som default:

- At splitte 10 næsten ens ad sets efter interesser, når leveringssystemet kan nå samme personer på tværs.
- At antage at broad altid vinder.
- At antage at narrow altid er mere effektivt.

## Seed quality > seed volume alene

Hvis lookalikes/custom audiences anvendes, prioriter seeds efter business quality:

```text
high-LTV retained customers
> profitable new customers
> all customers
> qualified leads
> all leads
> shallow engagement
```

Det er en synthesis, ikke en Meta-garanti. Pointen er at sende et signal, der ligner den forretningsværdi, man faktisk ønsker.

## Retargeting

Retargeting er et **behavioral state**, ikke nødvendigvis en permanent campaign silo.

Stanford-forskning i et stort randomiseret retargeting-forsøg fandt, at retargeting øgede sandsynligheden for at vende tilbage til websitet, men at effekten faldt med tiden siden første besøg; en stor del af tidlig effekt lå den første dag [A04]. Det understøtter recency som en vigtig variabel.

Men høj reported retargeting ROAS kan skyldes selection: de personer var allerede tættere på køb. Derfor:

- vurder incremental lift, ikke kun attributed ROAS,
- segmentér efter recency og intent, hvis volumen tillader det,
- suppress nylige converters når det giver mening,
- undgå at betale aggressivt for conversions, der sandsynligvis var sket organisk,
- test om broad/automated campaign allerede absorberer warm demand effektivt.

## Audience research loop

Kilder til nye audience hypotheses:

- CRM win/loss
- customer interviews
- sales call transcripts
- support tickets
- search/site behavior
- reviews
- comments/DMs
- creative comments
- Meta Ad Library
- competitor positioning
- high-LTV cohort characteristics

Meta Ad Library viser aktuelle ads på tværs af Meta og i EU også data fra ads leveret i det seneste år; API'et kan give creative, delivery dates, platforms og visse EU targeting/reach-demografier [M09]. **Biblioteket viser ikke profit.** Brug derfor lang levetid/prevalence som en hypothesis, aldrig som proof of performance.

---

# Offer architecture: annoncen kan ikke redde dårlig economics

En annonce skal ikke blot “se godt ud”. Den skal gøre den næste handling rationel og attraktiv.

## Offer stack

Et stærkt offer besvarer:

1. Hvilket outcome får kunden?
2. Hvilket problem fjernes?
3. Hvilken mekanisme gør løsningen troværdig?
4. Hvor hurtigt/let kan værdien opstå, uden urealistiske claims?
5. Hvilket proof findes?
6. Hvad koster det økonomisk og mentalt?
7. Hvilken risiko oplever kunden?
8. Hvad reducerer risikoen?
9. Hvorfor handle nu, hvis urgency faktisk er sand?
10. Hvad er næste lille handling?

## Offer-message matrix

Test forskellige **reasons to buy**, ikke kun wording:

- Outcome/gain
- Pain avoidance
- Time saved
- Money saved / economic gain
- Simplicity
- Certainty/control
- Status/identity
- Social proof
- Technical superiority
- Convenience
- Risk reduction
- Transformation
- New way / mechanism

Hver reason-to-buy er en **creative concept hypothesis**.

## Proof hierarchy

Typisk fra stærk til svag, kontekstafhængigt:

- Demonstration af faktisk outcome
- Verificerbart customer proof/case
- Kvantificeret evidence med korrekt scope
- Product/service mechanism
- Expert/creator endorsement med disclosure
- Reviews
- Logos/authority signals
- Brand assertion uden dokumentation

**Playbookregel:** claims skal kunne spores til en approved evidence source. Testimonials, performance-tal og scarcity må aldrig opfindes eller fremstilles uden dokumentation.


---

# Creative strategy system

Creative er en af de vigtigste controllable performanceflader i et moderne Meta-setup. Meta Blueprint beskriver creative diversification som variation i **concept/motivator og format**, og nyere 2026-training fremhæver variation i formats, visuals og messages [M07]. Metas Andromeda-arkitektur er samtidig bygget til at håndtere langt større og mere varierede creative candidate pools [M11].

Den rigtige konklusion er ikke “lav så mange ads som muligt”. Den er:

> **Giv leveringssystemet flere meningsfuldt forskellige, stærke grunde til at vælge og matche dit brand — og lær systematisk af, hvilke idéer der skaber business value.**

## Creative taxonomy

Teamet skal repræsentere creative på flere niveauer:

```text
CONCEPT
  └─ ANGLE / MOTIVATOR
      └─ FORMAT
          └─ EXECUTION
              └─ VARIANT
```

### Concept
Den centrale idé eller reason-to-care. Eksempel: “Få 5 timer tilbage hver uge”.

### Angle/motivator
Den psykologiske eller praktiske framing. Eksempel: tid, kontrol, økonomi, social proof, identity.

### Format
Static, video, Reels, Stories, carousel, catalog, creator/partnership osv.

### Execution
Den konkrete historie, scene, creator, visual world, demonstration eller layout.

### Variant
Hook, headline, first frame, CTA, crop, længde, caption.

**Vigtig regel:** 20 varianter af samme idé er ikke 20 concepts. New Engen beskriver samme praktiske problem i 2026: høj asset volume kan eksistere samtidig med lav conceptual diversity [P02].

## Creative portfolio balance

Et sundt creative portfolio bør rumme:

- **Proven winners:** fortsat levering så længe marginal economics er sund.
- **Winner iterations:** nye hooks/formater/creators på dokumenterede concepts.
- **New concept bets:** meningsfuldt nye motivations, problems, proof types eller use cases.
- **Placement-native adaptations:** især vertical short-form.
- **Seasonal/contextual:** kun når kontekst faktisk ændrer demand.
- **Exploration assets:** designs der primært skaber læring.

Teamet må ikke slukke en winner alene fordi den er “gammel”. Age er et feature, ikke et stopkriterium.

## Creative hypothesis card

Hvert concept får:

```yaml
concept_id: C-001
customer_state: "..."
job_to_be_done: "..."
core_problem: "..."
core_motivator: "..."
central_promise: "..."
mechanism: "..."
proof_type: "..."
primary_objection: "..."
format_hypothesis: "..."
placement_fit: ["..."]
expected_behavior: "..."
primary_business_metric: "..."
secondary_diagnostics: ["..."]
policy_risk: "low|medium|high"
evidence_status: "hypothesis"
```

## De syv creative jobs

Et creative bør have et tydeligt job. Typiske jobs:

1. **Pattern interrupt / attention** – få relevant opmærksomhed, ikke bare chok.
2. **Qualification** – få de rigtige mennesker til at genkende relevans.
3. **Problem articulation** – formulér problemet bedre end kunden selv gør.
4. **Mechanism/demo** – vis hvorfor løsningen virker.
5. **Proof** – reducer skepsis.
6. **Objection handling** – fjern en bestemt barriere.
7. **Action** – gør næste skridt klart og friktionslet.

Ikke alle ads skal gøre alt. Et 12-sekunders Reel kan fx være hook + demonstration + CTA; en carousel kan bære et sekventielt argument.

## Attention uden clickbait

Attention skal kvalificere, ikke bare forstyrre.

Gode hooks:

- konkret problem i en genkendelig situation
- visuelt outcome
- demonstration
- relevant kontrast før/efter
- overraskende men sand observation
- klart business/customer outcome
- objection som seeren faktisk har
- “how it works”
- proof/result med korrekt scope
- creator opening, der lyder som platformindhold

Svage hooks:

- generisk “Stop scrolling”
- sensation uden sammenhæng med offer
- falsk urgency
- exaggerated outcome
- engagement bait
- lange brand-intros før relevans

## Copywriting: information density før litterær elegance

Copy skal gøre fem ting hurtigt:

```text
RELEVANCE → VALUE → BELIEVABILITY → FRICTION REDUCTION → ACTION
```

### Primary text template

- Første linje: konkret relevans eller outcome.
- Næste: mekanisme eller forklaring.
- Proof: hvorfor man kan tro på det.
- Objection/risk: svar på væsentlig barriere.
- CTA: klart næste step.

Ikke alle fem skal stå eksplicit i kort copy; creative kan bære dele af informationen.

### Headlines

Headline skal helst kommunikere én af:

- outcome
- offer
- proof
- mechanism
- concrete CTA

Undgå headline og visual, der begge bruger plads på præcis samme information, hvis de kan komplementere hinanden.

## Emotional vs informational

Forskning fra Journal of Marketing Research fandt, at emotional appeals oftere blev delt, mens informative appeals kunne styrke brand evaluation/purchase, fordi brandet var mere integreret; kombinationen emotional + brand-integral kunne give begge typer effekt [A06]. Stanford/Management Science fandt i stor Facebook-content-analyse, at brand-personality content som humor/emotion hang sammen med engagement, mens informative elementer kunne have stærkere effekt i kombination og deals/promotions kunne drive click-through; studiet er observational, ikke et randomiseret kausalt Meta-ad-forsøg [A05].

**Synthesis:**

- Emotional creative er ikke automatisk conversion creative.
- Informational creative er ikke automatisk kedeligt.
- Det stærkeste direct-response creative kombinerer ofte **motivation + konkret information + brand/product integration**.

## Static image ads

### Brug static når

- værdipropositionen kan forstås på et øjeblik
- offer/pris/proof er centralt
- produktet er visuelt selvforklarende
- comparison kan komprimeres
- social proof kan stå rent
- ny concept-test skal produceres hurtigt/billigt

### Designprincipper

- én dominant idé
- stærk visuel hierarki
- let læselig på mobil
- produkt/service/outcome tydeligt
- undgå miniaturetekst
- brug tekst på billedet kun når den øger comprehension
- brand cues tydelige nok til memory, uden at logoet bliver hele annoncen
- crop til placement, ikke blind desktop-to-mobile adaptation

### Static hypothesis patterns

- Product + single benefit
- Outcome statement + proof
- Before/after, kun hvor sandt og policy-safe
- Quote/testimonial + context
- Comparison
- Simple diagram/mechanism
- Offer card
- Founder/customer portrait + strong claim/proof

## Video og Reels

Meta anbefaler mobile-first creative [M10]. For Reels viser Metas egen meta-analyse af 15 split tests, at native 9:16 video med lyd og key messages i safe zone havde 34,5% lavere cost per result end image ads i de testede Reels-only setups; Meta angiver 99,9% confidence. En anden Meta-serie af 15 A/B-tests med partner-enabled native Reels creative viste gennemsnitligt 5% lavere cost per result og 11% højere conversion rate. Begge er vendor-reported, bestemte populationer og ikke universelle garantier [M08].

### Evergreen Reels/video-principper

- design vertical-first når placementet er vertical
- vis relevans tidligt
- sørg for comprehension både med og uden perfekt lydopmærksomhed
- brug lyd bevidst, når formatet forventer det
- hold critical text/visuals i safe areas
- cuts skal understøtte comprehension, ikke bare tempo
- demonstration > abstrakt claim når produktet kan demonstreres
- creator speech skal føles naturlig, ikke oplæst corporate script
- produkt/brand bør integreres i historien tidligt nok til at skabe brand attribution
- CTA skal følge efter værdi/proof, ikke afbryde før pointen er etableret

### Video structure patterns

**Demo:**
```text
problem scene → product/action → visible result → proof → CTA
```

**Customer story:**
```text
who I am → what was hard → what I tried → why this → result → caveat/context → CTA
```

**Objection:**
```text
objection → acknowledge → evidence/mechanism → demonstration → CTA
```

**Founder/expert:**
```text
strong observation → why old approach fails → mechanism → proof → invitation
```

## Stories

Stories deler vertical/mobile grammar med Reels, men er ofte endnu mere sequential og tap-orienteret.

Brug:

- edge-to-edge vertical
- meget klar first frame
- få tekstlag
- visual cue mod CTA uden manipulerende tricks
- sequential cards, hvis argumentet kræver progression

Blueprint har særskilte creative considerations for Stories og Reels [M13].

## Carousel

Carousel er bedst, når flere frames har en **funktionel grund** til at eksistere.

Gode jobs:

- step-by-step
- problem → mechanism → outcome
- flere use cases
- produktlinje
- features der hver kræver eksempel
- comparison
- case story
- objection sequence

Dårligt job:

- fem næsten identiske billeder, fordi “carousel er et format”.

### Carousel rule

Hvert card skal enten:

1. flytte argumentet frem, eller
2. tilbyde et meningsfuldt alternativ/produkt.

## Catalog / dynamic product ads

Catalog-formater er stærke, når produktmatch og inventory er centralt. Meta Blueprint beskriver Advantage+ catalog ads som en måde at levere personaliserede produktanbefalinger til broad audiences, retargeting, cross-sell og up-sell [M14].

Evergreen best practice:

- feed quality er creative quality
- titles/images/prices/availability skal være korrekte
- event-product IDs skal matche
- product sets skal bygge på economics/use case, ikke kun taxonomy
- suppress unavailable/low-margin products hvor relevant
- measure new-customer economics separat fra remarketing harvest

## Creator / partnership ads

Meta Blueprint har i 2026 fortsat separate træningsforløb om partnership ads, creator discovery og scaling creator content [M12].

Creator-content er ikke magisk “UGC”. Vurder:

- credibility fit
- audience/context fit
- ability to explain mechanism
- believable lived experience
- visual/native fit
- right to use content
- disclosure compliance [L06]
- concept diversity

Follower count alene er en dårlig proxy for paid-ad performance.

## Creative scoring før launch

Pre-launch score er **quality control, ikke prediction of performance**.

Score 0–2 på:

- ICP relevance
- concept distinctness
- clarity
- value communication
- proof
- mechanism
- placement-native execution
- mobile readability
- brand integration
- CTA clarity
- claim evidence
- policy safety

En høj score tillader test. Den garanterer ikke win.

---

# Creative research og competitor intelligence

## Ad Library workflow

For hver relevant competitor/category:

1. Saml active creatives.
2. Tag concept, motivator, offer, proof, format, hook, CTA og visual style.
3. Gruppér efter konceptfamilie.
4. Marker launch/delivery dates hvor tilgængeligt.
5. Identificér whitespace: hvilke motivations/use cases adresseres ikke?
6. Brug ikke longevity som proof of profitability.
7. Kopiér aldrig creative assets eller distinctive expressions; lær på mønsterniveau.

## Research sources uden for Ad Library

- reviews på eget og konkurrerende produkt
- Reddit/community discussion, hvis relevant og policy-safe
- sales calls
- customer support
- search queries
- organic social comments
- creator content
- industry reports
- product usage

## Voice-of-customer extraction

Teamet udleder:

```yaml
phrase: "..."
source_type: "sales_call|review|support|comment|survey"
problem: "..."
motivation: "..."
objection: "..."
proof_needed: "..."
customer_stage: "..."
frequency: 0
sentiment: "..."
allowed_for_copy: true
```

Direkte customer language er råmateriale, ikke nødvendigvis færdig copy. Fjern private/sensitive data.

---

# Landing experience: performance stopper ikke ved klikket

**Validated principle:** Medieeffektivitet og post-click experience kan ikke vurderes separat. Baymards 2025 checkout benchmark omfatter 41.000+ manuelt vurderede checkout performance-scores og viser fortsat omfattende friktion på både desktop og mobile; deres survey/research identificerer bl.a. kompleks checkout og tvungen account creation som konkrete abandonment-drivere [UX01][UX02]. Brug denne evidens som UX-princip, ikke som løfte om et bestemt conversion uplift i alle virksomheder.

Et click er kun værdifuldt, hvis post-click experience kan konvertere relevant intent.

## Message match

Landing page skal fortsætte samme:

- problem
- promise
- offer
- proof
- vocabulary
- product/service

Hvis annoncen lover A og siden åbner med B, stiger cognitive friction.

## Mobile-first landing page

- hurtigt meaningful content
- central value proposition above early scroll
- klart CTA
- læselig typography
- ingen intrusive overlays før comprehension
- forms med kun nødvendige felter
- payment/checkout trust
- korrekt deep link
- ingen layout shift der skjuler CTA

Web performance er en conversion input. Case studies på web.dev viser i flere virksomheder sammenhæng mellem store Core Web Vitals-forbedringer og conversion gains; de konkrete procenttal er cases, ikke Meta-specifikke garantier [B03].

## Friction budget

Hvert ekstra step skal retfærdiggøre sig via:

- højere lead quality
- nødvendig qualification
- compliance
- større trust
- lavere downstream cost

Hvis ikke: fjern det.

## Lead forms vs website

### Native/instant form kan være stærkt når

- intent kan kvalificeres i formet
- speed betyder meget
- landing page er svag
- CRM follow-up er stærk

### Website kan være stærkere når

- produktet kræver education
- lead quality er vigtigere end raw lead count
- onsite behavior giver værdifulde signaler
- checkout/purchase sker på site

**Playbookregel:** sammenlign på **cost per qualified outcome**, ikke cost per raw lead.

---

# Experimentation science

## To modes: exploration og confirmation

### Exploration
Mål: lær hurtigt hvad der ser lovende ud.

Kan bruge:
- mange creative concepts
- platform delivery
- Bayesian ranking
- adaptive allocation
- proxy metrics med tydelig risk label

### Confirmation
Mål: afgør om interventionen skabte mere business value.

Brug:
- randomized A/B
- Conversion Lift
- geo/holdout
- kontrolleret eksperiment
- power/sample consideration

## Hypothesis standard

Ingen test uden:

```text
If we change X for population Y,
we expect metric Z to change by mechanism M,
because evidence E suggests ...
Decision if positive: ...
Decision if negative: ...
```

## Test én beslutning, ikke nødvendigvis én pixel

Klassisk “ændr kun én variabel” er nyttigt for mekanistisk diagnose, men business-tests kan også sammenligne hele coherent treatments, fx:

- old landing experience vs new landing experience
- broad automation vs constrained niche strategy
- concept A vs concept B

Det vigtige er, at interventionen og beslutningen er tydelig.

## Test hierarchy

Som default synthesis:

1. Offer / proposition
2. Concept / motivator
3. Proof / mechanism
4. Audience strategy, når reelt forskellig
5. Format/placement-native execution
6. Hook/first frame
7. Headline/CTA
8. Micro design

Jo længere ned, jo mindre forventet strategisk læring.

## Sample size og stopping

Teamet må ikke:

- kalde vinder efter få events fordi CPA ser godt ud
- peek-and-stop uden korrektion
- ignorere variance
- sammenligne perioder med store seasonality-forskelle uden model

Teamet bør bruge:

- pre-defined minimum observation window
- minimum event information
- confidence/credible interval
- practical effect threshold
- posterior probability eller frequentist threshold afhængigt af framework
- guard mod multiple comparisons

## Practical significance > statistical significance alene

En ændring kan være statistisk sikker og økonomisk irrelevant.

Testen skal besvare:

```text
P(effect is economically material | data)
```

ikke kun “p < 0.05?”.

## Meta A/B og Conversion Lift

Meta Blueprint beskriver A/B Testing og Conversion Lift som centrale metoder til at vurdere true performance [M04]. Conversion Lift bruges desuden til kanal-lift og kalibrering af attribution [M03].

Brug:

- A/B til relativ treatment-effekt
- Conversion Lift til incremental Meta-effect
- geo når person-level randomization ikke er mulig
- MMM til større budget/allocation-spørgsmål over tid

## Adaptive experimentation

Adaptive bandits kan være nyttige til exploration, fordi de flytter mere traffic mod lovende treatments. Men:

- de kan komplicere unbiased effect estimation
- de erstatter ikke random holdouts til causal confirmation
- reward metric skal være business-relevant

**Eksperimentdesign:** brug adaptive allocation til **creative exploration** og behold kontrollerede experiments til **causal validation**.

---

# Launch protocol

## Preflight: business

- [ ] Business goal defineret
- [ ] Target CAC/CPA/ROAS/POAS defineret
- [ ] Margin/LTV assumptions dokumenteret
- [ ] New vs existing customer treatment defineret
- [ ] Capacity/inventory OK

## Preflight: measurement

- [ ] Events modtages
- [ ] Values/currency korrekte
- [ ] Pixel/server events deduplikeret
- [ ] CRM downstream status koblet hvor relevant
- [ ] Consent/legal basis valideret
- [ ] UTM/internal campaign IDs stabile
- [ ] Backend source of truth klar

## Preflight: audience

- [ ] Hard constraints justified
- [ ] Audience strategy har hypothesis
- [ ] Exclusions er nødvendige
- [ ] Customer seeds har lawful basis
- [ ] Sensitive targeting/inference forbudt

## Preflight: creative

- [ ] Concept er tydeligt
- [ ] Creative er placement-native
- [ ] Claims har evidence
- [ ] Text readable mobile
- [ ] Brand/product kan identificeres
- [ ] CTA matcher landing
- [ ] Rights/licenses OK
- [ ] Policy check bestået

## Preflight: experiment integrity

- [ ] Er dette BAU eller test?
- [ ] Hypothesis registreret
- [ ] Primary metric registreret
- [ ] Stopping/decision rule registreret
- [ ] Confounders kendt
- [ ] Ingen planlagte mid-test edits, medmindre emergency

---

# In-flight monitoring: observe før intervene

## De fire monitoring-states

```text
HEALTHY → OBSERVE
UNCERTAIN → GATHER_MORE_DATA
DEGRADED → DIAGNOSE
CRITICAL → INTERVENE / PAUSE / ESCALATE
```

## Daily health check

Teamet skal mindst kontrollere:

- spend vs plan
- tracking health
- delivery anomalies
- rejected ads/policy issues
- landing availability
- conversion event freshness
- CPA/CAC/ROAS/POAS trend
- new customer mix
- creative-level trend
- audience saturation indicators
- inventory/capacity signals

## Diagnostic decomposition

En forenklet funnel identity:

```text
CPA ≈ CPM / (1000 × link_CTR × post_click_CVR)
```

hvor CTR og CVR er decimaler. Den er ikke perfekt, men hjælper diagnose.

### Hvis CPA stiger

**CPM op, CTR/CVR stabile:**
- auction/seasonality/competition/inventory
- audience restriction
- placement mix

**CTR ned, CVR stabil:**
- creative/message fatigue
- weaker delivery mix
- concept mismatch

**CTR stabil, CVR ned:**
- landing/offer
- traffic quality shift
- site bug
- price/inventory
- checkout/form issue

**Alt ser fint ud, reported ROAS ned:**
- AOV/mix
- attribution lag
- tracking/value issue
- new/existing mix

Teamet skal lokalisere problemet før den ændrer creative eller audience.

## Rolling windows

Brug flere vinduer parallelt:

- 1 dag: incident detection
- 3 dage: early trajectory
- 7 dage: operational trend
- 14/28 dage: baseline/seasonality

Men anvend volume-adaptive windows. Et high-spend account kan lære hurtigere end et low-spend account.

## Intervention gate

Før ændring skal teamet kontrollere:

```text
1. Is tracking healthy?
2. Is there enough information?
3. Is deterioration economically meaningful?
4. Is it likely signal rather than random variance?
5. Is an active controlled test being protected?
6. Do we understand the probable failure mode?
7. Is the proposed action reversible?
8. Is it within approved risk and budget limits?
```

Hvis nej til centrale spørgsmål → no-op eller escalate.


---


# Bidding og delivery: styr efter objective og constraints, ikke ritualer

Metas aktuelle curriculum behandler buying type og bid strategy som et separat beslutningsområde [M20]. Den evergreen regel er ikke at vælge den “mest avancerede” bid strategy, men den mindst restriktive strategi der stadig beskytter den forretningsmæssige constraint.

## Default-logik

- Hvis målet er at maksimere volume/value inden for et budget, start med en volume/value-orienteret strategi og lad delivery finde de billigste relevante opportunities.
- Brug cost-control når virksomheden faktisk har en hård economics-grænse, ikke fordi en lav target CPA “ser bedre ud”. For stramme controls kan reducere delivery og total profitable volume.
- Brug bid caps/reservation eller andre mere kontrollerede mekanikker kun når der er et konkret planning-, reach-, auction- eller unit-economics-behov, og live-check den aktuelle Meta-funktionalitet.
- Evaluér altid **resultat + spend utilization + quality + marginal value** sammen. En kampagne der “holder CPA” ved næsten ikke at levere, er ikke nødvendigvis bedre.

## Delivery-princippet

Meta-auktionen forsøger at balancere advertiser value og user experience. Det betyder, at en annonce ikke kun konkurrerer på budget/bid; estimated action rate og quality/relevance påvirker leveringen [M19]. Derfor er creative, conversion signal og offer en del af media buying — ikke eftertanker.

---

# Budget scaling: marginal economics, ikke folklore

En af de mest skadelige kategorier af “best practice” er universelle regler som:

- “skalér 20% om dagen”
- “dobbelt budgettet når ROAS er X”
- “pause efter præcis Y spend”

Der findes ikke robust evidens for, at ét sådant tal er universelt optimalt på tværs af accounts, spend levels, objectives og markets.

## Average vs marginal performance

Antag:

- de første 10.000 kr. giver ROAS 5
- de næste 10.000 kr. giver ROAS 2,5

Average ROAS på 20.000 kr. kan stadig se acceptabel ud, men den **marginale** investering kan være for dårlig.

Teamet skal derfor estimere response curve:

```text
spend → incremental outcome
```

og dens hældning:

```text
Δ outcome / Δ spend
```

Meta Robyn modellerer netop saturation/response curves og har budget allocator til at simulere spend-allocation [B01][B02]. Meta understreger selv, at output skal valideres før implementation.

## Scale decision

Skalering er tilladt når:

- tracking er sund
- capacity/inventory kan absorbere demand
- marginal CAC/ROAS forventes inden for target
- uncertainty er acceptabel
- performance ikke kun skyldes et midlertidigt retargeting pocket
- experiment integrity ikke brydes

## Scale modes

### Conservative scale
Små, bounded budget steps, bruges ved høj uncertainty eller lav volume.

### Evidence-backed scale
Større ændringer når response curve, experiments og current performance alle understøtter det.

### Exploration scale
Midlertidigt ekstra budget for at lære hurtigere, selv hvis kortsigtet efficiency kan falde. Skal være eksplicit mærket som learning spend.

## Saturation

Tegn på mulig saturation:

- incremental reach falder pr. spend
- frequency stiger uden proportional conversion lift
- marginal CPA/CAC forværres
- nye creatives finder ikke nye pockets of demand
- response curve flader

Men samme mønster kan komme af sæson, konkurrencetryk eller landing issues. Diagnose først.

---

# Creative fatigue: en inference, ikke et frequency-tal

“Fatigue” bør defineres som:

> **En vedvarende deterioration i creative response, som bedst forklares af gentagen eksponering/novelty loss frem for auction, tracking, offer eller site changes.**

## Evidence bundle for fatigue

Teamet bør se efter kombinationen:

- creative age ↑
- exposure/frequency ↑
- unique reach growth ↓
- CTR eller qualified engagement ↓
- downstream CVR stabil eller ↓
- CPA/CAC ↑
- andre creatives i samme campaign ikke falder tilsvarende
- auction CPM forklarer ikke hele ændringen

Ingen enkelt metric beviser fatigue.

## Creative refresh rules

### Refresh execution når

- concept stadig performer på andre executions
- hook/visual ser ud til at være problemet
- placement mismatch er tydeligt

### Diversify concept når

- flere executions af samme concept falder sammen
- portfolio er konceptuelt smalt
- audience research viser nye unaddressed motivations

### Fix non-creative cause når

- alle unrelated creatives falder samtidigt
- landing CVR kollapser
- tracking ændres
- auction shock dominerer

Dette svarer til practitioner-observationer fra New Engen om forskellen mellem iteration og conceptual diversification [P02].

---

# Attribution, incrementality og den reelle effekt

## Tre forskellige spørgsmål

### Attribution
“Hvilken kanal/annonce får kredit?”

### Incrementality
“Hvor mange outcomes skete **fordi** annonceringen fandt sted?”

### Optimization
“Hvad skal vi gøre med den næste krone?”

De tre spørgsmål må ikke blandes.

## Hvorfor last-click/platform attribution kan fejle

En person kan:

1. kende brandet i forvejen,
2. se Meta ad,
3. søge på Google,
4. købe direkte,
5. blive attribueret forskelligt afhængigt af system.

Ingen attribution-model kan alene vide counterfactual: “ville personen have købt uden ads?”.

## PIE-evidensen

Et NBER-working paper fra april 2026 analyserer 2.226 Meta-advertising experiments og foreslår “Predicted Incrementality by Experimentation”. RCT-effekter bruges til at lære sammenhængen mellem campaign features og causal outcomes. I paperet havde modellen væsentligt højere out-of-sample forklaringskraft for incrementality end en industry-standard 7-day last-click metric; forfatterne rapporterer R² 0,88 vs 0,19 i deres setup [A01]. Paperet har Meta-relaterede disclosures og bør derfor ikke behandles som helt uafhængigt, men metoden er vigtig.

**Konsekvens for teamet:**

- saml eksperimentelle ground-truth datapunkter,
- træn/kalibrér en intern predictor af incrementality,
- brug den til kampagner uden samtidig RCT,
- behold uncertainty og periodisk causal recalibration.

## Learning and sophistication evidence

Et stort Facebook/Instagram field experiment publiceret via NBER fandt gennemsnitlige stigninger i bl.a. revenue og purchases fra ads, men stor heterogenitet; annoncører med mere læringsaktivitet og mere sofistikeret datacollection havde højere returns [A02]. Flere forfattere var Meta-ansatte eller involveret via Meta, hvilket skal noteres.

Det støtter playbookens hoveddesign: **learning systemet er en performance capability i sig selv.**

## Measurement ladder

```text
Level 0: platform-attributed metrics
Level 1: backend reconciliation
Level 2: customer-quality / margin adjustment
Level 3: randomized A/B / Conversion Lift / geo lift
Level 4: calibrated MMM / causal predictive layer
Level 5: marginal budget optimizer with uncertainty
```

Teamets confidence i budgetændringer bør stige med measurement maturity.

## Calibration workflow

1. Kør lift/holdout på repræsentative kampagner.
2. Gem treatment, spend, exposure, outcome, segment og confidence interval.
3. Sammenlign platform-attributed conversions/revenue med incremental outcome.
4. Estimér calibration factor med uncertainty.
5. Brug factor/model til operational reporting.
6. Re-test regelmæssigt; calibration er ikke evig.

Meta Blueprint beskriver direkte brug af Conversion Lift til at beregne calibration multiplier og informere attribution/budget decisions [M03].

---

# Post-campaign analysis: kampagnen er først færdig, når læringen er gemt

## Postmortem skal besvare

### Business
- Hvad brugte vi?
- Hvad fik vi af incremental/attributed revenue/profit?
- Hvad blev CAC/payback?
- Hvad var new-customer share?

### Audience
- Hvilke audience hypotheses holdt?
- Var hard constraints nødvendige?
- Fandt automation værdifulde pockets uden for suggestions?
- Hvilke cohorts havde høj downstream quality?

### Creative
- Hvilke concepts virkede?
- Hvilke motivators?
- Hvilke proof types?
- Hvilke hooks/formats var execution-winners?
- Var performance concept-level eller asset-level?

### Offer
- Hvilken value proposition bar conversion?
- Hvilke objections var væsentlige?
- Var price/promo nødvendig?

### Post-click
- Hvor opstod drop-off?
- Hvilken page/version konverterede?
- Var speed/form friction en faktor?

### Measurement
- Tracking incidents?
- Attribution vs backend discrepancy?
- Incrementality evidence?

### Decision quality
- Hvilke interventions hjalp?
- Hvilke gjorde ikke?
- Hvilke burde vi ikke have foretaget?

## Learnings skal være atomiske

Dårlig learning:

> “Video performer bedst.”

God learning:

> “For cold prospecting af produkt X i DK i uge 33–36 slog concept ‘time saved’ med native 9:16 demo-video static proof-versionen på qualified CAC med 18% i vores randomized split. 90% CI [x,y]. Offer, landing page og audience strategy var konstante. Generaliser ikke uden ny test til produkt Y.”

## Learning object

```yaml
learning_id: L-2026-0042
status: validated
scope:
  market: DK
  product: X
  audience_state: cold
  objective: new_customer_purchase
hypothesis: "..."
intervention: "..."
control: "..."
result:
  primary_metric: incremental_cac
  effect: -0.18
  interval: "..."
evidence_type: INTERNAL_CAUSAL_TEST
confidence: high
validity_notes:
  - "..."
expiry_review: 2027-03-01
next_test: "..."
```

## Knowledge decay

Marketing learnings kan blive forældede når:

- product ændres
- price/offer ændres
- competitor landscape ændres
- Meta delivery ændres
- creative style mættes
- seasonality skifter

Derfor får hver learning:

- scope
- evidence strength
- created_at
- last_validated_at
- expiry/review date

---

# Forecasting: i går → i dag → i morgen

Forecasting bør ikke forsøge at forudsige ét “korrekt” tal. Brug en **fordeling eller et interval** og knyt beslutninger til usikkerheden.

## Three-step forecast

### 1. Nowcast
Hvad er den bedste vurdering af performance lige nu, korrigeret for attribution delay og data lag?

### 2. Forecast
Hvis vi **ikke ændrer noget**, hvad forventer vi i morgen / næste 3 / 7 dage?

### 3. Counterfactual forecast
Hvis vi ændrer budget, creative, audience eller landing page, hvad forventer vi så — med hvilken uncertainty?

## Features

### Media
- spend
- impressions
- reach
- CPM
- frequency
- placements
- audience strategy

### Creative
- concept
- motivator
- format
- creator
- age
- exposure
- semantic embedding
- visual similarity

### Funnel
- CTR
- LPV rate
- CVR
- AOV
- lead quality

### Business
- price
- promo
- stock/capacity
- margin
- new/existing mix

### Context
- weekday
- seasonality
- holidays
- competitor/promo event hvor kendt
- weather kun hvis faktisk relevant for business

### Measurement
- attribution lag
- tracking coverage
- event freshness

## Model architecture

Et robust system kan kombinere:

- hierarchical Bayesian model til pooling på tværs af ads/concepts/markets
- time-series baseline til trend/seasonality
- causal experiment priors
- nonlinear spend-response/saturation
- change-point detection
- predictive model for incremental outcome

Det behøver ikke være én gigantisk model.

## Prediction intervals

Rapportér:

```text
Expected CPA tomorrow: 410 DKK
80% interval: 350–490
Probability CPA <= target 450: 68%
```

ikke:

```text
Tomorrow CPA = 407.33
```

Falsk præcision giver dårlig automation.

## Forecast error learning

Efter outcome:

```text
forecast_error = observed - predicted
```

Gem error pr. regime. Hvis modellen konsekvent underestimerer fatigue, promotion effects eller scaling saturation, skal modellen rekalibreres.

## Causal forecast vs correlation

En predictive model kan sige “CPA stiger sandsynligvis”, men ikke automatisk “pause creative A”. For intervention kræves en causal hypothesis eller en sikker operational rule.

---

# Meta Ads learning flywheel

## Core loop

```text
OBSERVE
  ↓
DIAGNOSE
  ↓
EXPLAIN
  ↓
PREDICT
  ↓
DECIDE
  ↓
ACT / NO-OP
  ↓
MEASURE
  ↓
LEARN
  ↓
UPDATE LEARNING BASE
  ↓
GENERATE NEXT HYPOTHESIS
```

## Daily loop

**Inputs:** sidste 24h + rolling baselines.  
**Outputs:** health state, forecast, anomalies, no-op/intervention suggestions.

Teamet skal spørge:

- Hvad ændrede sig?
- Hvor sandsynligt er det, at ændringen er reel?
- Hvilket layer ændrede sig?
- Hvad forventer vi uden intervention?
- Er handlingens upside større end risikoen ved at forstyrre læringen?

## Weekly loop

- creative portfolio review
- concept performance
- audience quality
- downstream customer quality
- budget response
- experiment backlog
- learning consolidation
- production brief for næste sprint

## Monthly/quarterly loop

- causal calibration
- unit economics refresh
- MMM/response curves ved nok data
- ICP update
- policy/governance review
- model forecast accuracy
- intervention audit

## Learning velocity metrics

Mål ikke kun ads. Mål systemet:

- days from hypothesis → live test
- cost per valid learning
- % tests med pre-registered decision rule
- % spend dækket af valid measurement
- creative concept diversity
- time from market signal → next creative
- forecast calibration error
- % ændringer rolled back
- value generated per intervention
- false positive intervention rate

## Research backlog

Teamet holder en ranked backlog:

```text
Expected value of information (EVI)
= decision importance
× uncertainty
× potential performance spread
÷ cost/time of test
```

Høj EVI testes først.


---

# Privacy, legal og policy standards

**EU/DK baseline:** Pixel/cookie-lignende tracking til personaliseret annoncering kræver normalt samtykke i Danmark, bortset fra rent teknisk nødvendige teknologier [L04]. Datatilsynets vejledning om direkte markedsføring bruger eksplicit et social-media-pixel/retargeting-eksempel og peger på samtykke som det mest passende behandlingsgrundlag i den beskrevne situation [L05]. Live juridisk vurdering kan stadig være nødvendig for det konkrete setup.

Dette er ikke juridisk rådgivning. Det er operational risk design.

## First-party customer data

Metas Customer List Custom Audiences Terms kræver, at advertiser har de nødvendige rights/permissions og lawful basis til at bruge/disclose data; advertiser er data controller i GDPR-kontekst for den beskrevne behandling, og Meta beskrives som processor i den specifikke custom-audience proces [L01].

Teamet må derfor aldrig antage:

> “Vi har emailadressen, så vi må bruge den til ads.”

Der skal eksistere en registreret legal basis/purpose-status.

## Sensitive data

EU Digital Services Act forbyder onlineplatforme at vise ads baseret på profiling med special categories of personal data efter GDPR art. 9(1) [L03]. EDPB's final Guidelines 8/2020 behandler targeting af social-media users, legal basis, profiling og online tracking [L02].

Konservativ playbookregel:

- ingen creation/inference af audiences baseret på sensitive attributes,
- ingen attempt to reconstruct sensitive categories fra proxies,
- ingen copy der unødvendigt afslører/antager en persons sensitive status,
- regulated categories kræver separat policy module.

## Data minimization

Teamet skal kun hente data nødvendigt for opgaven.

- PII må ikke kopieres ind i creative repositories eller arbejdsdokumenter.
- Customer-level data skal pseudonymiseres/aggregere hvor muligt.
- Rå kundedata og fritekstinput bør have passende retention controls.
- Learning log/repository bør gemme patterns, ikke unødvendige personoplysninger.

## Ad policies

Meta Advertising Standards ændres. Derfor skal teamet lave **live policy verification før publish**, især ved:

- health
- finance
- employment
- housing
- alcohol/gambling/regulated products
- political/social issue ads
- personal attributes
- before/after or outcome claims

Playbooken fastholder evergreen-principper; aktuelle policykrav skal live-checkes før publicering.

## Brand safety

Kontrollér:

- placement suitability
- creator history/fit
- user-generated comments
- misinformation adjacency
- rights/licensing
- crisis mode


# Business-model modules

De generelle principper er ens. Success metric og funnel er ikke.

## E-commerce

### Primary truth
- incremental contribution profit
- new customer CAC
- POAS/iROAS

### Creative priorities
- product demonstration
- use cases
- proof/reviews
- offer
- comparison
- creator
- catalog feed

### Risks
- retargeting inflation
- existing-customer ROAS masquerading as acquisition
- discount dependency
- refund margin erosion

### Supplerende standarder
- inventory aware bidding/spend
- product-level margin
- cohort repeat purchase
- new/existing segmentation

## Lead generation / service business

### Primary truth
```text
cost per qualified lead
→ cost per sales opportunity
→ CAC / contribution profit
```

### Never optimize only
- raw CPL

### Need feedback
- lead validity
- contact rate
- qualification
- appointment
- show rate
- close rate
- revenue

A 50 kr. lead med 1% close rate er dårligere end 300 kr. lead med 30% close rate.

### Creative priorities
- problem clarity
- credibility
- case proof
- process simplicity
- risk reduction

## B2B / SaaS

### Challenges
- small TAM
- long sales cycle
- sparse purchase events
- multiple stakeholders

### Measurement
- qualified pipeline
- opportunity value
- pipeline velocity
- closed-won, når lag tillader

### Audience
Broad automation kan stadig være værdifuld, men niche/eligibility og sparse signals gør first-party quality, content qualification og CRM feedback særligt vigtige.

### Creative
- role-specific pains
- use case
- proof
- economic case
- demo
- objection handling

## Local business

### Hard constraint
Service geography er reel.

### Metrics
- qualified inquiries
- bookings
- show rate
- customer value

### Creative
- locality
- availability
- real people/place
- trust
- specific service outcome

Undgå at fragmentere små geografier yderligere uden stærk grund.

## Subscription

Primary economics:

- trial CAC
- trial→paid
- churn
- payback
- retained LTV

Teamet må ikke belønne campaign, der køber billige trials med dårlig retention.

## App

- install er sjældent slutmålet
- activation
- retained active user
- purchase/subscription
- cohort retention

Send downstream events, hvor lovligt og teknisk muligt.

---

# Audience × funnel × creative matrix

| Customer state | Hovedjob | Creative | Proof | CTA |
|---|---|---|---|---|
| Unaware/low awareness | Skab problem/value recognition | pattern + use case + outcome | light proof | learn/see/how |
| Problem aware | Artikulér problem og alternativ | pain + mechanism | demo/case | explore |
| Solution aware | Differentier | comparison/mechanism | evidence/reviews | see solution |
| Product aware | Reducér risk | proof/objections/offer | case/guarantee where valid | buy/book/start |
| High intent | Fjern sidste friction | offer, availability, FAQ | trust | convert |
| Existing customer | Cross/up-sell/retention | next use case | personalized proof | add/upgrade |

Dette er et planning framework, ikke et krav om separate campaigns for hvert state. Meta kan selv matche creative på tværs; matrixen bruges primært til **creative coverage**.

---

# Creative testing matrix

For hvert kvartal/learning cycle skal portfolioen have hypotheses på mindst disse akser, hvor relevant:

## Customer motivation
- speed
- cost
- control
- convenience
- confidence
- status/identity
- relief
- growth

## Problem frame
- acute pain
- hidden cost
- opportunity cost
- complexity
- risk

## Proof
- demo
- customer story
- quantitative evidence
- expert/creator
- reviews
- product detail

## Story structure
- problem/solution
- before/after
- objection
- comparison
- tutorial
- founder story
- customer story

## Format
- static
- carousel
- short vertical video
- longer explanation
- creator native
- catalog

Teamet må ikke kræve alle kombinationer. Den bruger expected value of information til at vælge de mest informative.


---

# Contradiction ledger: hvor “best practices” typisk går galt

Denne sektion er bevidst central. En stærk Meta Ads-praksis skal kunne håndtere modstridende råd uden automatisk at vælge den mest selvsikre stemme.

## “Broad targeting er altid bedst” vs “narrow targeting er altid bedst”

**Status:** Begge er for kategoriske.

### Evidens
Meta tilbyder både custom/lookalike/detailed inputs og Advantage+ audience [M06]. Praktikere observerer samtidig, at mange inputs i moderne performance setups er suggestions eller kan udvides [P01]. Metas egne recommender systems bruger stadig mere behavioral sequence- og conversion-data [M15].

### Playbook-konklusion
- Hard constraints efter business/legal reality.
- Broad/automated er stærk baseline ved god signal quality og stor nok TAM.
- Structured audience input er testbart ved niche/small TAM/low signal/eligibility.
- Sammenlign på business outcome, ikke impressions eller CTR.

**Evidence label:** SYNTHESIS.

## “Retargeting har højeste ROAS, så giv det mere budget”

**Status:** Misvisende uden incrementality.

### Evidens
Randomiseret retargeting research viser, at retargeting kan skabe ekstra return visits, og at timing/recency betyder noget [A04]. Men attributed retargeting ROAS kan være høj, fordi populationen allerede har høj intent.

### Konklusion
- Retargeting kan være værdifuldt.
- Incrementality/holdout afgør, hvor meget der reelt er skabt.
- Brug recency/intention.

## “Video slår static” vs “static slår video”

**Status:** Forkert universalisering.

### Evidens
Meta har Reels-specifikke split tests, hvor native 9:16 video med audio/safe zone slog image ads i den testkontekst [M08]. Det betyder ikke, at video generelt slår static på alle placements/offers.

### Konklusion
- Match format til job og placement.
- Static er stærkt til compressed proof/offer/single idea.
- Video er stærkt til demo/story/mechanism.
- Carousel er stærkt til sequence/range/comparison.
- Test koncept før du konkluderer format.

## “Mere creative er altid bedre”

**Status:** Kun hvis “mere” betyder mere nyttig diversity.

Meta anbefaler creative diversification [M07]. New Engen skelner praktisk mellem executional variants og genuinely different concepts [P02].

### Konklusion
- mere concept coverage: ofte værdifuldt
- near-duplicate spam: ikke en strategi
- volume uden taxonomy reducerer læringskvalitet

## “Learning phase kræver præcis X conversions”

**Status:** Produktmekanik kan have aktuelle thresholds, men de er volatile.

### Evergreen-konklusion
- få nok signal til stabil optimization
- undgå unødvendig fragmentation
- undgå konstant churn
- learning-label er ikke success KPI
- live documentation check før execution

## “Budget må kun ændres 20%”

**Status:** Practitioner folklore, ikke robust evergreen lov.

### Konklusion
Sæt business-specific bounds. Brug marginal response, uncertainty og risk.

## “CTR viser om creative er godt”

**Status:** CTR viser evnen til at skabe klik, ikke profit.

### Cases
- høj CTR + lav CVR = click attraction / mismatch
- lavere CTR + høj CVR = strong qualification

### Konklusion
CTR er et diagnostic feature.

## “Platform ROAS er true ROAS”

**Status:** Nej.

Meta selv tilbyder Conversion Lift og anbefaler causal calibration [M03][M04]. Robyn anbefaler experiment calibration [B01].

### Konklusion
Platform ROAS = operational attributed metric. True causal value kræver incrementality-estimat.

## “Engagement = business value”

**Status:** Ikke nødvendigvis.

Emotional content kan være mere shareable, mens informative content kan drive brand/purchase outcomes anderledes [A06].

### Konklusion
Optimize engagement kun når engagement er målet eller valideret leading indicator.

---

# Anti-playbook: practices der aktivt skal undgås

1. At jagte hacks frem for economics.
2. At optimere til billigste top-funnel event, når downstream quality kollapser.
3. At ændre fem ting samtidig og kalde resultatet learning.
4. At pause på én dårlig dag uden variance-model.
5. At skalere på average ROAS uden marginal view.
6. At kalde overlap fra attribution for incremental revenue.
7. At forveksle retargeting harvest med growth.
8. At bruge CTR som winner criterion for sales.
9. At lave 50 near-identical creative-varianter.
10. At fragmentere account efter interesser uden learning purpose.
11. At bruge demographics som erstatning for customer motivation.
12. At kopiere competitor creative fra Ad Library.
13. At antage at en længe kørende competitor ad er profitable.
14. At generere claims uden evidence registry.
15. At opfinde urgency/scarcity.
16. At bruge synthetic testimonials.
17. At sende users til en landing page, der ikke matcher ad promise.
18. At ignorere mobile loading/UX.
19. At køre experiment og optimere cellerne manuelt undervejs.
20. At gemme correlation som causal learning.
21. At gemme learning uden context/scope.
22. At aldrig expire gamle learnings.
23. At ændre budget for at “gøre noget”.
25. At bruge private/sensitive customer data uden lawful basis.
26. At targete/inferere sensitive attributes via proxies.
27. At bruge en Meta-reported uplift som universelt benchmark.
28. At “optimere” en campaign når measurement er brudt.
29. At fortsætte spend når destination/checkout er down.

---

# Performance cadences

## Hver time / near-real-time, kun ved større spend

- tracking outage
- spend runaway
- site outage
- disapprovals
- payment/account issue
- inventory emergency

Ingen kreative micro-optimizations hvert kvarter.

## Dagligt

### Dagligt output: max én decision brief

```text
1. Health: GREEN / YELLOW / RED
2. Business KPI vs expected
3. Largest explained movement
4. Forecast next 1–3 days
5. Actions taken
6. Actions recommended/escalated
7. Explicit no-ops
```

## Ugentligt

- profit/CAC by campaign family
- creative concept leaderboard med uncertainty
- creative coverage gaps
- downstream lead/customer quality
- audience strategy review
- test results
- experiment backlog
- production plan

## Månedligt

- causal calibration
- business economics update
- offer/ICP insights
- response curve
- model forecast score
- intervention score

## Kvartalsvist

- reset assumptions
- review “best practices” learned internally
- invalidate stale learnings
- audit privacy/policy
- compare against Meta official updates
- strategic budget allocation

---

# Operating templates

## ICP card

```yaml
icp_id:
market:
customer_type:
job_to_be_done:
trigger:
core_problem:
current_alternative:
core_motivations:
  -
objections:
  -
buying_criteria:
  -
proof_needed:
  -
value_if_solved:
expected_ltv:
margin_profile:
eligibility_constraints:
meta_audience_hypotheses:
  -
evidence_sources:
  -
```

## Campaign brief

```yaml
campaign_id:
business_goal:
primary_outcome:
primary_metric:
target_economics:
  target_cac:
  break_even_roas:
  payback:
market:
offer:
audience_strategy:
creative_concepts:
landing_experience:
budget:
start:
expected_end:
measurement_plan:
experiment_plan:
approval_required:
```

## Creative brief

```yaml
creative_id:
concept:
customer_state:
job:
hook:
problem:
promise:
mechanism:
proof:
objection:
format:
placement:
visual_direction:
script_or_copy:
cta:
landing_page:
approved_claim_ids:
rights_status:
policy_risk:
learning_goal:
```

## Experiment card

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
planned_duration:
sample_logic:
stopping_rule:
confounders:
emergency_override:
result:
decision:
learning_id:
```

## Daily monitor record

```yaml
date:
tracking_health:
spend_vs_plan:
primary_kpi:
expected_range:
actual:
anomalies:
likely_causes:
forecast_1d:
forecast_3d:
actions:
no_ops:
escalations:
```

## Intervention record

```yaml
decision_id:
trigger:
evidence:
uncertainty:
alternatives_considered:
action:
expected_effect:
max_downside:
rollback:
decision_owner:
executed_at:
post_result:
decision_quality:
```

## Postmortem

```markdown
# Campaign postmortem

## 1. Goal and economics
## 2. What actually happened
## 3. Attribution vs backend vs causal evidence
## 4. Audience learnings
## 5. Creative concept learnings
## 6. Offer learnings
## 7. Landing/funnel learnings
## 8. Interventions and their value
## 9. What we got wrong
## 10. Validated learnings
## 11. Hypotheses for next cycle
```

## Learning atom

```yaml
learning_id:
statement:
evidence_type:
evidence_strength:
context:
valid_for:
invalid_outside:
causal: true|false
estimated_effect:
uncertainty:
supporting_tests:
contradicting_tests:
created_at:
last_validated:
review_at:
```

---

# Diagnostic decision tree

## “CPA er steget 30%”

### Trin 1: measurement
- event count plausible?
- backend matches?
- attribution lag?
- value field issue?

Hvis nej → tracking incident.

### Trin 2: auction
- CPM ændret?
- placement mix?
- competition/seasonality?

### Trin 3: click response
- link CTR?
- CPC?
- creative-level split?

### Trin 4: site/funnel
- LPV/click gap?
- page speed?
- CVR?
- checkout/form?

### Trin 5: commercial mix
- AOV?
- margin?
- new/existing?
- lead quality?

### Trin 6: intervention
Vælg action mod det layer, der sandsynligvis skaber problemet.

---

# Reporting: hvad beslutningstagere skal kunne se

God reporting bør reducere dashboards, ikke skabe flere.

## Executive view

```text
Business result
→ Why it changed
→ What happens if we do nothing
→ What was changed
→ What needs a decision
→ What we learned
```

## Weekly one-page

### 1. Outcome
- spend
- incremental/attributed revenue
- profit/CAC

### 2. Movement
Top positive/negative drivers.

### 3. Creative
Concept winners, declining concepts, gaps.

### 4. Audience
Broad/segment findings og quality.

### 5. Experiments
Completed / running / next.

### 6. Decisions
Actions + estimated impact + confidence.

### 7. Next week
Max 3 high-value learning priorities.

## Explainability standard

Reporting må ikke nøjes med at sige:

> “Ad 123 should be paused.”

Den skal sige:

> “Ad 123’s qualified CAC has deteriorated for six days. CPM and landing-page CVR are stable, while CTR has fallen relative to both its own baseline and sibling executions. Creative fatigue is therefore the leading hypothesis. Replace the execution while retaining the concept, and validate the result against the next observation window.”

---

# Sanity checks før en “learning” får lov at styre spend

Spørg altid:

1. Er effekten causal eller observational?
2. Er measurement healthy?
3. Er sample stort nok til beslutningen?
4. Er effect economically material?
5. Er perioden repræsentativ?
6. Er der seasonality/promo?
7. Er offer/landing konstant?
8. Er audience population sammenlignelig?
9. Er det new vs existing customer mix?
10. Kan resultaterne skyldes attribution?
11. Er den generaliserbar til næste campaign?
12. Hvad er den bedste alternative forklaring?

Hvis teamet ikke kan svare, sænkes confidence.


---

# Visual design playbook i dybden

Der findes ikke ét visuelt look, der vinder i alle kategorier. Det rigtige design skal maksimere **relevant comprehension og persuasion** under ekstremt kort opmærksomhedstid.

## Visual priority order

Som default:

```text
1. Relevant subject/outcome
2. Core message
3. Proof/mechanism
4. Brand cue
5. CTA/supporting detail
```

Ikke alle skal være tekst. Et produktfoto kan bære subject, en demonstration kan bære mechanism, og copy kan bære qualification.

## Image selection

Vælg billeder efter deres **kommunikative job**.

### Product-forward
Bedst når:
- produktet er visuelt attraktivt
- product recognition betyder noget
- benefit kan infereres/vises

### Human-in-context
Bedst når:
- use case er vigtig
- empathy/identity skaber relevance
- service ellers er abstrakt

### Demonstration/result
Bedst når:
- mekanismen kan vises
- skepticism er høj
- “show, don't tell” reducerer copy-behov

### Proof visual
- review
- data point
- recognizable result
- case artifact

### Diagram/explainer
Bedst til komplekse B2B/service/value mechanisms, hvis layout kan forstås på mobil.

## Faces

Brug menneskeansigter når de hjælper fortællingen eller skaber relevant social information. Brug dem ikke som en mekanisk “faces convert”-regel.

Vurder:
- gaze direction
- expression fit
- authenticity
- role credibility
- demographic representation relevant to actual market uden discriminatory targeting
- whether person competes with product/message for attention

## Authentic vs polished

“UGC-looking” er ikke automatisk bedre end premium production.

### Authentic/native er stærkt når
- trust kommer fra lived experience
- creator fit betyder mere end cinematography
- Reels/Stories-sprog kræver platform-nativity

### Polished er stærkt når
- premium signal er en del af value
- product detail kræver høj visual quality
- brand trust er central
- category expectations er høje

Portfolien kan have begge. Test **concept × execution**, ikke æstetik som ideologi.

## Text overlays

Brug overlay hvis det øger speed-to-understanding.

Best practice:
- én primær message
- høj contrast/readability
- kort nok til mobile glance
- vigtig text ikke i UI-covered zones
- undgå paragraphs i creative

## Contrast og salience

Målet er at gøre den relevante information let at parse. Brug:

- foreground/background separation
- size hierarchy
- whitespace
- directional composition
- limited competing focal points

Ikke “mere saturation = højere CTR” som generel regel.

## Before/after

Kan være ekstremt forklarende, men kræver:

- truthful comparable conditions
- relevant policy check
- ingen deceptive transformation
- ingen implied guaranteed outcome
- context hvis resultater varierer

## Social proof design

Proof skal kunne verificeres og forstås.

Godt:
- konkret result + hvem + context
- review med source/status hvor tilladt
- case med mechanism

Dårligt:
- fem stjerner uden kilde
- “10,000+ love us” uden source
- fabricated quote

## Brand salience vs direct response

Brandet bør være integreret nok til at memory/value ikke tilfalder “en anonym annonce”. Akpinar/Berger viser netop, at brand-integral emotional advertising kan kombinere sharing og brand outcomes [A06].

Brand integration kan være:
- product shape
- color/system
- founder/creator association
- logo
- verbal mnemonic
- distinctive visual pattern

Logoet behøver ikke dominere.

---

# Copywriting playbook i dybden

## Copy skal reducere fem usikkerheder

Kunden spørger implicit:

1. Er det relevant for mig?
2. Hvad får jeg?
3. Hvorfor skulle jeg tro på det?
4. Hvor besværligt/risikabelt er det?
5. Hvad gør jeg nu?

Copy behøver ikke være lang. Men den samlede ad experience bør svare på de vigtigste spørgsmål for kundens stage.

## Hook library

### Problem recognition
> Når [situation] sker, koster det ofte [consequence].

### Outcome
> [Concrete outcome] uden [major friction], via [mechanism].

### Demonstration
> Se hvad der sker, når vi [action].

### Contrarian insight
> [Common belief] er ikke altid problemet. [Alternative mechanism] er.

### Objection
> “Men virker det hvis …?” Her er [evidence/demo].

### Proof-led
> [Specific verified result] i [context].

### Comparison
> [Old way] vs [new way], forskellen er [mechanism].

Templates er starting structures; teamet må ikke masseproducere cliché-copy.

## Benefit specificity

Svagt:
> “Work smarter.”

Stærkere:
> “Få fakturaer matchet og klargjort til godkendelse uden manuel copy/paste.”

Specificity kvalificerer samtidig audience.

## Feature → mechanism → outcome

```text
Feature: Incoming requests are categorized consistently
Mechanism: uses company knowledge + defined workflows
Outcome: fewer manual handoffs and faster response
```

Copy bør normalt slutte ved outcome, men mechanism gør promise troværdig.

## Objection mapping

For hvert ICP:

```yaml
objection: "Det tager for lang tid at implementere"
underlying_risk: "time + disruption"
evidence: "documented implementation process"
creative_response: "3-step timeline + customer case"
```

## Price/promo copy

Vis promotion når den er reel og central. Undgå at træne account/market til konstant discount uden at måle:

- margin
- new customer quality
- repeat rate
- post-promo demand

## Urgency

Tilladt strategisk kun når sand:

- deadline
- capacity
- inventory
- event date
- price change

Falsk countdown er både trust- og compliance-risk.

## Tone

Performance copy skal stadig være brand copy. Teamet vedligeholder:

- preferred vocabulary
- forbidden clichés
- sentence length
- humour boundaries
- formality
- claim style

## Copy length

Ingen universel vinder.

- simple/low-risk purchase → kort kan være nok
- complex/high-ticket → mere education kan kræves
- video kan bære forklaringen, så caption kan være kort
- retargeting kan adressere én konkret objection

Test information need, ikke “long copy vs short copy” som isoleret religion.

---

# Audience discovery som eksperimentprogram

## Stage 0: Business eligibility

Definér:
- where can we sell?
- who can legally buy?
- who has economic value?

Dette er hard constraints.

## Stage 1: Signal baseline

Kør en konsolideret, bred/automated baseline når forholdene tillader det. Formålet er at observere systemets natural matching med godt conversion signal.

## Stage 2: High-signal hypothesis tests

Test kun meaningful alternatives:

- high-LTV customer seed
- qualified lead seed
- specific niche context
- genuinely different geo/market

## Stage 3: Downstream validation

Se ikke kun Meta CPA:

- new customer share
- lead qualification
- order margin
- retention
- LTV

## Stage 4: Creative-audience interaction

Nogle “audience wins” skyldes faktisk creative relevans. Test derfor om et concept:

- virker bredt
- kun virker i en defined niche
- finder sin egen pocket under automation

## Stage 5: Codify

Kun robuste findings bliver audience rule. Resten er hints.

---

# Objective-specific metric trees

## Sales/e-commerce

```text
Spend
→ Reach/Impressions
→ Qualified Traffic
→ Checkout/Purchase
→ New Customer
→ Net Revenue
→ Contribution Profit
→ Repeat/LTV
```

## Lead generation

```text
Spend
→ Lead
→ Valid Lead
→ Contacted
→ Qualified
→ Meeting
→ Show
→ Opportunity
→ Won
→ Contribution Profit
```

## B2B pipeline

```text
Spend
→ engaged account/person
→ lead/contact
→ ICP qualified
→ opportunity
→ pipeline value
→ won revenue
→ gross margin
```

## Awareness/brand

Hvis direkte conversion ikke er målet:

- incremental reach
- ad recall/brand lift når målbart
- search/direct traffic changes med forsigtighed
- later conversion cohort

CTR er ikke automatisk awareness quality.

---

# Metrics glossary og fortolkning

| Metric | Formel/definition | Hvad den kan sige | Hvad den ikke kan bevise |
|---|---|---|---|
| Spend | annonceringsomkostning | investering | effekt |
| CPM | spend / impressions × 1000 | auction/delivery cost | creative quality alene |
| Reach | unikke personer | breadth | attention/value |
| Frequency | impressions/reach | exposure intensity | fatigue alene |
| Link CTR | link clicks/impressions | click response | conversion quality |
| CPC | spend/link clicks | click cost | customer value |
| LPV rate | landing views/link clicks | destination/load quality | purchase intent alene |
| CVR | conversions/visits eller clicks | funnel efficiency | incrementality |
| CPA | spend/conversions | conversion cost | conversion quality |
| CAC | acquisition spend/new customers | acquisition economics | incrementality uden design |
| ROAS | attributed revenue/spend | attributed revenue efficiency | causal return |
| iROAS | incremental revenue/spend | causal revenue return | profit uden margin |
| POAS | profit/spend | profit efficiency | future LTV uden model |
| AOV | revenue/orders | order mix | margin |
| MER | total revenue/marketing spend | blended efficiency | channel causality |
| LTV | expected customer value | long-term economics | certainty hvis cohort immature |

## CTR

God til:
- creative diagnosis
- hook/message response

Ikke god alene til:
- sales winner
- customer quality

## CPM

CPM påvirkes af:
- auction competition
- audience constraints
- placement
- seasonality
- expected value/quality dynamics

Et højere CPM kan være acceptabelt, hvis CVR/customer value er meget højere.

## Frequency

Brug som contextual feature. Ikke “frequency > 3 = pause”. Temporal-spacing research fra Stanford viser desuden, at samme exposure quantity kan have forskellig effekt afhængigt af timing [A07].

## MER/blended metrics

Gode til sanity check på hele business. Dårlige til isoleret kanal-causality.

---

# Forecasting- og anomaly-specifikation

## Baseline

For hvert metric:

- day-of-week effect
- trend
- seasonality
- spend level
- promotion state
- creative portfolio state

## Anomaly types

### Point anomaly
En enkelt ekstrem observation.

### Level shift
Permanent/semipermanent ændring.

### Trend change
Gradient ændrer sig.

### Cross-metric inconsistency
Meta conversions op, backend orders flade.

Cross-metric anomalies er ofte mere værdifulde end raw threshold alerts.

## Alert severity

### INFO
Interessant men ingen action.

### WATCH
Observe næste datapunkt.

### ACTIONABLE
Enough evidence + economic materiality.

### CRITICAL
Immediate business/compliance/spend risk.

## Attribution lag model

Conversions kan komme efter spend. Incomplete days bør nowcastes ud fra den observerede rapporterings-lag distribution:

```text
P(conversion reported by t | eventual conversion)
```

Undgå at dømme dagens campaign kl. 14 ud fra ikke-modne conversions.

---

# Creative taxonomy og semantic analytics

Creative bør tagges systematisk, så performance kan analyseres på tværs af koncept, budskab, format og visuelle karakteristika.

## Semantic dimensions

- primary value proposition
- emotional tone
- functional benefit
- customer problem
- proof type
- objection
- product visibility
- brand visibility
- creator archetype
- setting
- visual density
- pace
- length
- CTA

## Cluster analysis

Find:
- hidden concept duplication
- high-performing creative families
- underexplored whitespace
- fatigue at cluster level

## Causal caveat

Hvis cluster “blue background” performer bedre, er det ikke bevis for blå farve. Det kan være confounded med concept, offer eller production batch.

Semantic analytics bruges til **hypothesis generation**, ikke som kausalt bevis; hypoteser valideres derefter gennem test.

---

# Volatile implementation registry

Følgende må **ikke hardcodes** i playbookens evergreen core uden `valid_until`/live check:

- campaign/objective names
- current Advantage+ labels
- exact audience-control behavior
- current learning thresholds/labels
- attribution windows
- placement inventory
- optimization event availability
- bid strategy names
- campaign budget feature names
- API field names/versions
- ad dimensions/safe-zone templates
- policy wording
- special category restrictions
- automated creative toggles

Teamet bør ved execution hente Metas aktuelle docs, men anvende denne playbooks evergreen decision logic.

---

# Research backlog: spørgsmål der skal løses med egne data

Selv en meget dyb public research kan ikke svare på disse universelt:

1. Hvilke concepts performer bedst for **vores** offer?
2. Hvad er vores reelle incremental CAC?
3. Hvor hurtigt fatiguer forskellige concept-families hos os?
4. Hvornår saturerer spend i vores market?
5. Hvor meget retargeting er incremental for os?
6. Hvilken customer seed giver bedst downstream LTV?
7. Hvor meget hjælper targeting suggestions i vores account?
8. Hvilke Reels executions slår static for vores product?
9. Hvordan ændrer discount LTV/margin?
10. Hvilke lead signals predicter close rate?
12. Hvor ofte skal causal calibration gentages?

Det er ikke mangler ved playbooken. Det er **den interne research backlog**, som hver annoncør må løse med egne data.

---

# Meta surfaces: hvad bruges til hvad?

Playbookens core er Facebook + Instagram, men Meta's buying/delivery ecosystem er bredere. Den evergreen tilgang er **ikke** at tvinge budget til hver overflade, men at give delivery adgang til relevante surfaces og sørge for, at creative/experience passer.

## Facebook Feed / Instagram Feed

Stærke til:
- static
- video
- carousel
- product/offer
- creator/partnership
- direct response + consideration

Design for scroll context, mobile readability og hurtig relevance.

## Facebook + Instagram Reels

Stærke til:
- vertical native video
- demonstration
- creator
- problem/solution
- story

Meta's current Reels guidance fremhæver 9:16, audio og safe-zone key messages og anbefaler bred placement-adgang [M08].

## Stories

Stærke til:
- immersive vertical creative
- sequential storytelling
- simple offers
- retargeting/objection creative

Hold first-frame clarity ekstremt høj.

## Messenger

Messenger kan være både placement og del af messaging journey. Brug det især når conversation er en naturlig conversion path, ikke fordi det “er en ekstra kanal”.

## WhatsApp som messaging destination

Meta Blueprint har i 2026 training for ads that click to message med purchase optimization på tværs af Messenger, Instagram og WhatsApp [M16].

Brug messaging destination når:
- customer ønsker dialog før køb
- sales/support kan svare hurtigt
- qualification kan ske i samtalen
- transaction/purchase events kan fødes tilbage til measurement

Mål:

```text
cost per conversation
→ qualified conversation
→ purchase/booking
→ contribution profit
```

Ikke raw conversations alene.

## Audience Network

Meta Advantage+ placements kan inkludere Audience Network sammen med Facebook, Messenger og Instagram [M08]. Audience Network leverer ads i third-party apps og har bl.a. native, banner, interstitial og rewarded-video inventory på publisher-siden [M17].

Evergreen advertiser rule:

- lad placement konkurrere, hvis objective/creative er kompatibelt,
- analyser downstream quality, ikke kun cheap clicks,
- ekskludér kun på dokumenteret quality/brand-safety/economics,
- test frem for stereotype antagelser om inventory.

## Threads og nye Meta surfaces

Threads er pr. januar 2026 udvidet mod global brugerlevering, og Meta beskriver image, video, carousel samt senere catalog/app support [M18]. Selve tilgængeligheden er dog stadig et **implementation-layer**-spørgsmål. Nye surfaces og formater kan ændres hurtigt.

Playbookregel:

```text
if Meta launches/adds/changes a surface:
    verify official availability + objective/placement support
    classify media grammar
    adapt creative if needed
    allow controlled exploration
    judge on downstream business value
```

Ikke hardcode “brug/brug ikke Threads”.

---

---


# Research evidence map — V2 validated sources

## Meta official / source of truth

### M01 — Performance 5
**Source:** Meta Blueprint, “Maximize campaign results with Performance 5.”  
**URL:** https://www.facebookblueprint.com/student/path/253157-performance-5  
**Evidence:** `OFFICIAL_RECOMMENDATION`  
**Finding:** Direct-response best practices organiseres omkring account simplification, automation, creative diversification, data quality og results validation.  
**Limitation:** Meta er vendor; frameworks og uplift-claims er ikke universelle causal estimates.

### M02 — Conversions API quality
**Source:** Meta Blueprint, “Optimize Meta Conversions API.”  
**URL:** https://www.facebookblueprint.com/student/path/590115/activity/581278  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Event matching, event coverage, event quality, deduplication og data freshness er centrale kvalitetsdimensioner; Pixel + CAPI bruges til at tracke kunderejsen.  
**Limitation:** Implementeringsdetaljer kan ændres.

### M03 — Conversion Lift og calibration
**Source:** Meta Blueprint, “Measure channel impact with Meta Conversion Lift.”  
**URL:** https://www.facebookblueprint.com/student/activity/674272  
**Evidence:** `OFFICIAL_MEASUREMENT_GUIDANCE`  
**Finding:** Lift kan bruges til at vurdere Meta-influence, kalibrere attribution og informere spend; Meta beskriver calibration multiplier og test-design.  

### M04 — Measurement methodologies
**Source:** Meta Blueprint, “Introduction to measurement methodologies.”  
**URL:** https://www.facebookblueprint.com/student/collection/248403/path/251315  
**Evidence:** `OFFICIAL_MEASUREMENT_GUIDANCE`  
**Finding:** Meta skelner mellem observational og experimental measurement og mellem A/B tests og randomized controlled trials; Conversion Lift og Brand Lift indgår i curriculum.

### M05 — Objectives og conversion settings
**Sources:** Meta Blueprint, “Selecting campaign objectives” + “Selecting campaign objectives and conversion settings.”  
**URLs:**  
https://www.facebookblueprint.com/student/path/219699-selecting-objectives-course  
https://www.facebookblueprint.com/student/path/253165-objectives-data-signals-course  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Objective, conversion location, conversion event og performance goal skal afspejle business goal.

### M06 — Audience architecture
**Sources:** Meta Blueprint, “Defining your ad audience” + “Managing audiences and optimizing reach.”  
**URLs:**  
https://certifications.facebookblueprint.com/student/path/219694-create-custom-lookalike-audiences-ads-manager  
https://www.facebookblueprint.com/student/path/253136-ads-targeting-course  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** New/custom/lookalike/detailed audiences eksisterer sammen med Advantage+; Meta lærer også reach optimization og overlap management.  
**Limitation:** Det konkrete niveau af expansion/control er volatilt.

### M07 — Creative diversification
**Sources:** Meta Blueprint, “Increase campaign performance with diversified creative” + 2026 creative training.  
**URLs:**  
https://www.facebookblueprint.com/student/path/253130-increase-campaign-performance-with-diversified-creative  
https://www.facebookblueprint.com/student/activity/707402  
**Evidence:** `OFFICIAL_RECOMMENDATION`  
**Finding:** Diversificér concepts/motivators, formats, visuals og messages, så delivery har meningsfuldt forskellige inputs.

### M08 — Reels creative
**Source:** Meta for Business, “Instagram & Facebook Reels: Create Short Video Ads.”  
**URL:** https://www.facebook.com/business/ads/facebook-instagram-reels-ads  
**Evidence:** `OFFICIAL_GUIDANCE + VENDOR_REPORTED_TEST`  
**Finding:** Meta anbefaler 9:16, audio og safe-zone composition til native Reels. Meta rapporterer stærke split-test-resultater i bestemte testpopulationer.  
**Limitation:** Ikke bevis for at video generelt slår static.

### M09 — Meta Ad Library
**URLs:**  
https://www.facebook.com/ads/library/  
https://www.facebook.com/ads/library/api/  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Running ads kan bruges til competitor/creative research; library viser ikke profit eller kausal effekt.

### M10 — Mobile-first
**Source:** Meta Blueprint, “Create for a mobile world.”  
**URL:** https://www.facebookblueprint.com/student/path/253047-create-mobile-world  
**Evidence:** `OFFICIAL_RECOMMENDATION`

### M11 — Andromeda ads retrieval
**Source:** Engineering at Meta, “Meta Andromeda: Supercharging Advantage+ automation with the next-gen personalized ads retrieval engine,” December 2024.  
**URL:** https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/  
**Evidence:** `PLATFORM_ENGINEERING + VENDOR_REPORTED_PERFORMANCE`  
**Finding:** Meta's ad system uses a multi-stage recommendation architecture; Andromeda expands retrieval capacity for very large candidate pools and richer creative diversity.  
**Use:** Forstå hvorfor input quality, creative diversity og signal quality kan være vigtigere end micro-management af delivery.  
**Limitation:** Engineering uplift-tal er Meta-reported og må ikke bruges som universelle advertiser expectations.

### M12 — Partnership ads
**Source:** Meta Blueprint partnership ads training.  
**URL:** https://messaging.facebookblueprint.com/student/path/211551-partnership-ads  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`

### M13 — Placements og creative
**Source:** Meta Blueprint, “Applying best practices for placements and ad creative.”  
**URL:** https://www.facebookblueprint.com/student/path/253184-meta-advantage-course-placements-creative  
**Evidence:** `OFFICIAL_GUIDANCE`  
**Finding:** Placement selection, formats, creative strategy og Advantage+ placements behandles samlet.

### M14 — Advantage+ catalog ads
**Source:** Meta Blueprint catalog training.  
**URL:** https://www.facebookblueprint.com/student/collection/606095/path/607451  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Catalog ads kan dynamisk matche produkter/budskaber til mennesker ud fra intent/actions og bruges bl.a. til broad, retargeting, cross-sell og upsell.

### M15 — Meta sequence learning / GEM direction
**Sources:** Engineering at Meta: sequence learning (2024), GEM (2025), multi-stage sequence architecture (August 2026).  
**URLs:**  
https://engineering.fb.com/2024/11/19/data-infrastructure/sequence-learning-personalized-ads-recommendations/  
https://engineering.fb.com/2025/11/10/ml-applications/metas-generative-ads-model-gem-the-central-brain-accelerating-ads-recommendation-ai-innovation/  
https://engineering.fb.com/2026/08/05/ml-applications/from-user-sequences-to-scaling-laws-a-multi-stage-architecture-for-metas-ads-ranking/  
**Evidence:** `PLATFORM_ENGINEERING + VENDOR_REPORTED_PERFORMANCE`  
**Finding:** Meta's ranking systems increasingly use sequence-aware behavioral representations and large-scale models rather than only static manually engineered features.  
**Use:** Strategic context for why accurate conversion signals and strong creative inputs matter.  
**Limitation:** Platform engineering results are vendor-reported and do not create a universal advertiser-level uplift guarantee.

### M16 — Ads that click to message
**Source:** Meta Blueprint, “Optimize for purchases with ads that click to message.”  
**URL:** https://www.facebookblueprint.com/student/activity/652744  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Messenger, Instagram and WhatsApp can serve as messaging destinations in relevant campaign setups; downstream purchase/conversion signals should be measured where available.  
**Limitation:** Exact destinations and optimization options are volatile implementation details.

### M17 — Meta Audience Network
**Sources:** Meta Audience Network and Meta placement guidance.  
**URL:** https://www.facebook.com/audiencenetwork/resources/blog/meta-audience-network-ad-format-updates-2026  
**Evidence:** `PLATFORM_MECHANIC / CURRENT_PLATFORM_AVAILABILITY`  
**Finding:** Audience Network extends Meta ad delivery into third-party apps and supports formats including full-screen/interstitial and rewarded video; available inventory can change.  
**Limitation:** Placement inventory and format availability are implementation-layer facts and must be live-checked.

### M18 — Threads ads 2026
**Source:** Meta Newsroom, January 2026.  
**URL:** https://about.fb.com/br/news/2026/01/anuncios-no-threads-um-ano-depois-agora-alcancando-todos-os-usuarios-e-mercados-globalmente/  
**Evidence:** `CURRENT_PLATFORM_AVAILABILITY`  
**Finding:** Threads ad delivery udvides globalt til users; familiar image/video/carousel formats samt catalog/app support beskrives.  
**Limitation:** Surface inventory/features er volatile.

### M19 — Meta ad auction and total value
**Source:** Meta Blueprint, “Create ads that align to your business goals,” plus Meta auction guidance.  
**URL:** https://www.facebookblueprint.com/student/path/253111-marketing-funnel-ads  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Delivery is not determined by bid alone; predicted action/value and ad quality/relevance contribute to auction outcomes.  
**Use:** Understøtter at creative, offer og signal quality er media-buying inputs, ikke separate eftertanker.

### M20 — Buying types and bid strategy
**Source:** Meta Blueprint, “Determining the best buying type and bid strategy.”  
**URL:** https://www.facebookblueprint.com/student/path/211562-ad-types-course  
**Evidence:** `PLATFORM_MECHANIC / OFFICIAL_GUIDANCE`  
**Finding:** Buying type and bid strategy are explicit decision areas; the correct strategy depends on objective and business constraint rather than “advanced = better.”

### M21 — Account simplification and current professional curriculum
**Sources:** Meta Performance 5 and Meta Blueprint agency/professional curriculum.  
**URL:** https://agencies.facebookblueprint.com/  
**Evidence:** `OFFICIAL_RECOMMENDATION / CURRICULUM`  
**Finding:** Meta currently emphasizes simplified account structures and organizes professional competence around objectives/signals, audiences, buying/bidding, budget/delivery, creative, data quality and measurement.  
**Limitation:** Curriculum/product labels can change; the decision principles are the evergreen part.

## Academic / experimental evidence

### A01 — Predicted Incrementality by Experimentation (PIE)
**Source:** Gordon, Moakler & Zettelmeyer, NBER Working Paper 35044, April 2026.  
**URL:** https://www.nber.org/papers/w35044  
**Evidence:** `RCT_DERIVED_MODEL / ACADEMIC_WORKING_PAPER`  
**Finding:** 2.226 Meta experiments; out-of-sample R² 0,88 for incremental conversions/$ vs 0,19 for 7-day last-click i deres setup; decision disagreement mod RCT 8–12% vs 12–20% for last-click.  
**Disclosure:** Meta employment/historical Facebook affiliations oplyses i paper.

### A02 — Learning, Sophistication, and Returns to Advertising
**Source:** Tadelis et al., NBER Working Paper 31201.  
**URL:** https://www.nber.org/papers/w31201  
**Evidence:** `LARGE_FIELD_EXPERIMENT`  
**Finding:** Facebook/Instagram-spend skabte gennemsnitligt ekstra revenue/purchases i eksperimentet; stor heterogenitet; patterns konsistente med learning-by-doing og advertiser sophistication.  
**Disclosure:** Meta-relaterede forfattere/data.

### A03 — Value of offsite tracking data
**Source:** Wernerfelt, Tuchman, Shapiro & Moakler; NBER 32765 / Marketing Science 2025.  
**URL:** https://www.nber.org/papers/w32765  
**Evidence:** `LARGE_RANDOMIZED_EXPERIMENT`  
**Finding:** >70.000 Facebook/Instagram advertisers; removal af offsite optimization data reducerede effectiveness i eksperimentet, med heterogenitet.  
**Limitation:** Privacy/legal tradeoffs vurderes separat; Meta-related authors/data.

### A04 — Retargeting frequency/timing
**Source:** Sahni, Narayanan & Kalyanam, Journal of Marketing Research, 2019.  
**URL:** https://www.gsb.stanford.edu/faculty-research/publications/experimental-investigation-effects-retargeted-advertising-role  
**Evidence:** `RANDOMIZED_FIELD_EXPERIMENT`  
**Finding:** Retargeting øgede return visits 14,6% over fire uger i den konkrete retailer-setting; effect decayed med tid siden visit; timing matters.  
**Limitation:** Ikke Meta-specific og ikke universel ROI.

### A05 — Advertising content and engagement on Facebook
**Source:** Lee, Hosanagar & Nair, Management Science / Stanford working paper.  
**URL:** https://www.gsb.stanford.edu/faculty-research/working-papers/advertising-content-consumer-engagement-social-media-evidence  
**Evidence:** `LARGE_OBSERVATIONAL_WITH_SELECTION_CONTROLS`  
**Finding:** In a large historical Facebook dataset, brand-personality content was associated with engagement; informative elements and promotions showed different patterns for engagement/click-through.  
**Use:** Creative hypothesis generation only.  
**Limitation:** Observational, historical platform environment, and not causal sales proof.

### A06 — Valuable Virality
**Source:** Akpinar & Berger, Journal of Marketing Research, 2017.  
**URL:** https://journals.sagepub.com/doi/10.1509/jmr.13.0350  
**Evidence:** `REAL_AD_DATA + CONTROLLED_EXPERIMENTS`  
**Finding:** Emotional appeals can increase sharing while informative/brand-integral content can support brand evaluation and purchase outcomes; brand integration changes the tradeoff.  
**Use:** Creative/copy hypothesis generation.  
**Limitation:** Not a Meta direct-response benchmark and not a universal format rule.

### A07 — Exposure timing/spacing
**Source:** Sahni research program on temporal spacing of advertising exposures.  
**URL:** https://www.gsb.stanford.edu/faculty-research/faculty/navdeep-s-sahni  
**Evidence:** `FIELD_EXPERIMENT`  
**Finding:** Ad effect afhænger af timing/spacing, hvilket understøtter at frequency ikke bør reduceres til én universel threshold.

### A08 — Retargeting specificity and decision stage
**Source:** Lambrecht & Tucker, Journal of Marketing Research, 2013.  
**URL:** https://journals.sagepub.com/doi/10.1509/jmr.11.0503  
**Evidence:** `FIELD_EXPERIMENT`  
**Finding:** Product-specific/dynamic retargeting did not universally outperform generic retargeting; relative effectiveness depended on evidence that user preferences had narrowed.  
**Use:** Match retargeting specificity to decision stage rather than assuming “more personalized = better.”

### A09 — Observational measurement vs randomized experiments
**Source:** Gordon, Zettelmeyer, Bhargava & Chapsky, Marketing Science, 2019.  
**URL:** https://pubsonline.informs.org/doi/abs/10.1287/mksc.2018.1135  
**Evidence:** `LARGE_RANDOMIZED_EXPERIMENT_COMPARISON`  
**Finding:** In the Facebook experiments studied, common observational approaches often failed to reproduce randomized advertising effects.  
**Use:** Strong evidence for separating attributed conversions from causal incremental effect.  
**Limitation:** Historical study/platform context; principle is measurement-methodological, not a current product mechanic.

## Creative / brand effectiveness research

### C01 — Meta × Kantar × CreativeX, “The New Era of Storytelling”
**Source:** Kantar, 2024.  
**URL:** https://www.kantar.com/north-america/company-news/the-new-era-of-storytelling  
**Evidence:** `LARGE_OBSERVATIONAL_MODELED_STUDY / VENDOR_COMMISSIONED`  
**Finding:** 56.984 Meta assets, 1.295 campaigns, 13,1bn impressions; human presence og brand/product integration var forbundet med højere modeled effectiveness.  
**Limitation:** Commissioned/model-based; associations er ikke universal direct-response causality.

### C02 — Oxford Saïd × Kantar social advertising research
**Source:** Kantar / Oxford Saïd.  
**URL:** https://www.kantar.com/Inspiration/Social-Media/Study-shows-social-advertising-can-lift-brand-awareness  
**Evidence:** `META_ANALYSIS_OF_BRAND_LIFT_DATA`  
**Finding:** 235 campaigns/110 brands; social ads kunne løfte brand metrics; “human” emotional language var associated med bedre brand impact.  
**Limitation:** Brand-lift context, ikke bevis for direct-response copy universalitet.

## CRO / post-click evidence

### UX01 — Baymard Checkout UX 2025
**URL:** https://baymard.com/research-articles/current-state-of-checkout-ux  
**Evidence:** `LARGE_USABILITY_BENCHMARK`  
**Finding:** 41.000+ checkout performance scores / 33.000+ examples; størstedelen af desktop/mobile checkouts vurderes mediocre eller dårligere.  
**Use:** Friction, clarity, guest checkout, forms, shipping/payment UX.

### UX02 — Baymard cart abandonment research
**URL:** https://baymard.com/research-articles/ecommerce-checkout-usability-report-and-benchmark  
**Evidence:** `USABILITY + QUANTITATIVE_SURVEY`  
**Finding:** Cart abandonment er delvist naturligt, men kompleks checkout/account/friction er dokumenterede avoidable causes.  
**Limitation:** Brug ikke Baymards potential-uplift som garanti for en konkret virksomhed.

## Measurement/modeling methodology

### B01 — Meta Robyn Analyst Guide
**Source:** Meta Marketing Science open-source Robyn.  
**URL:** https://facebookexperimental.github.io/Robyn/docs/analysts-guide-to-MMM/  
**Evidence:** `TECHNICAL_METHOD_GUIDANCE`  
**Finding:** MMM models adstock/saturation and channel contribution; Robyn strongly recommends experimental/causal calibration and ongoing incrementality studies as ground truth inputs.  
**Use:** MMM, calibration, saturation and budget planning.  
**Limitation:** Model outputs depend on design/data/business context; Robyn explicitly warns against treating allocator predictions as guaranteed outcomes.

### B02 — Robyn features and budget allocator
**URL:** https://facebookexperimental.github.io/Robyn/docs/features/  
**Evidence:** `TECHNICAL_METHOD_GUIDANCE`  
**Finding:** Response curves encode diminishing returns/saturation and can be used with budget-allocation simulations.  
**Use:** Marginal economics architecture; validate before implementation.

### B03 — Web performance case evidence
**Source:** web.dev, Nuvemshop case study, 2026.  
**URL:** https://web.dev/case-studies/nuvemshop  
**Evidence:** `CASE_STUDY`  
**Finding:** Large Core Web Vitals/LCP improvements were accompanied by conversion-rate improvements in the reported cohort.  
**Use:** Supports site speed as a conversion input.  
**Limitation:** Single-company observational/case evidence, not Meta-specific causal proof.

## Practitioner context — Tier C

### P01 — Jon Loomer, Meta targeting 2026
**URLs:**  
https://www.jonloomer.com/meta-ads-targeting-2026/  
https://www.jonloomer.com/meta-advertising-control/  
**Evidence:** `PRACTITIONER_EVIDENCE`  
**Finding:** Current targeting inputs fungerer ofte som suggestions/expanded inputs; broad er ikke altid bedst, og unnecessary segmentation/overlap kan være et problem.  
**Use:** Aktuel implementation context, ikke universel causal truth.

### P02 — New Engen, creative diversification vs iteration
**URL:** https://newengen.com/insights/meta-creative-diversification/  
**Evidence:** `PRACTITIONER_EVIDENCE`  
**Finding:** Skeln mellem executional iteration og conceptual diversification; asset volume ≠ idea diversity.  
**Use:** Creative taxonomy; trianguleret med Meta [M07].

## Legal / privacy / disclosure

### L01 — Meta Customer List Custom Audiences Terms
**URL:** https://www.facebook.com/legal/terms/customaudience/update  
**Evidence:** `CONTRACT / POLICY`  
**Finding:** Advertiser skal have nødvendige rights/permissions og lawful basis; GDPR controller/processor-forhold beskrives for feature-use.

### L02 — EDPB Guidelines 8/2020
**URL:** https://www.edpb.europa.eu/documents/guideline/guidelines-82020-on-the-targeting-of-social-media-users_en  
**Evidence:** `EU_REGULATORY_GUIDANCE`  
**Finding:** Legal basis, profiling, targeting og online tracking ved social media advertising.

### L03 — EU Digital Services Act
**URL:** https://eur-lex.europa.eu/eli/reg/2022/2065  
**Evidence:** `LAW`  
**Finding:** Ads based on profiling using GDPR special-category data er forbudt på online platforms; minors har særskilt protection; ad-transparency requirements gælder platforms.  
**Caveat:** Platform- og advertiser-forpligtelser er ikke identiske.

### L04 — Datatilsynet: Cookies og GDPR
**URL:** https://www.datatilsynet.dk/regler-og-vejledning/gdpr-univers-for-smaa-virksomheder/cookies-og-gdpr  
**Evidence:** `DANISH_REGULATORY_GUIDANCE`  
**Finding:** Cookies/pixels/lignende tracking bruges bl.a. til markedsføring; samtykke kræves før ikke-nødvendige tracking technologies i de beskrevne cases.

### L05 — Datatilsynet: Vejledning om direkte markedsføring
**URL:** https://www.datatilsynet.dk/Media/638237218449834564/Vejledning%20om%20direkte%20markedsf%C3%B8ring.pdf  
**Evidence:** `DANISH_REGULATORY_GUIDANCE`  
**Finding:** Vejledningen indeholder konkret pixel/retargeting-eksempel og peger på samtykke som det mest passende behandlingsgrundlag i den beskrevne situation.

### L06 — Forbrugerombudsmanden: sociale medier / skjult reklame
**URL:** https://forbrugerombudsmanden.dk/alle-emner/forbud-mod-skjult-reklame/sociale-medier  
**Evidence:** `DANISH_CONSUMER_LAW_GUIDANCE`  
**Finding:** Kommerciel hensigt skal fremgå tydeligt; influencer/partnership content kræver tydelig reklamemarkering efter dansk praksis.

---


# Source-handling rules

1. **Meta official** afgør hvad platformen aktuelt understøtter, tillader og anbefaler.
2. **Meta-reported uplift** behandles som `VENDOR_REPORTED_TEST`, aldrig som forventet uplift for alle annoncører.
3. **Randomiseret/kausal evidens** vægter højest ved spørgsmål om faktisk incremental effect.
4. **Historisk forskning** kan understøtte en mekanisme, men må ikke bruges som bevis for en nuværende Meta-feature.
5. **Practitioner guidance** er testbar kontekst, ikke permanent lov.
6. **Legal/policy** skal live-checkes ved execution, især ved sensitive categories, minors, custom audiences, tracking og creator/partnership ads.
7. **Intern data** skal klassificeres som causal test, association eller heuristic. Et dashboard-mønster bliver ikke kausalt af at være gentaget.

---

# Final doctrine

> **Meta-performance skabes ikke af ét targeting-hack, én annonceform eller én bid-strategy. Den skabes ved at forbinde sund economics, et stærkt offer, pålidelige conversion-signaler, en enkel delivery-struktur, meningsfuldt forskellige creatives, en friktionsfri destination og måling, der kan skelne attributed aktivitet fra incremental business value.**

Den operationelle loop er:

```text
UNDERSTAND BUSINESS ECONOMICS
→ DEFINE THE VALUE EVENT
→ DEFINE ICP / CUSTOMER STATE / OFFER
→ FORM A CLEAR HYPOTHESIS
→ BUILD DISTINCT CREATIVE
→ USE THE SIMPLEST VIABLE AUDIENCE + DELIVERY STRUCTURE
→ LAUNCH WITH RELIABLE SIGNALS
→ OBSERVE WITHOUT OVERREACTING
→ DIAGNOSE THE FUNNEL LAYER
→ TEST MATERIAL UNCERTAINTIES
→ MEASURE BUSINESS OUTCOME
→ CALIBRATE ATTRIBUTION CAUSALLY WHEN POSSIBLE
→ SCALE ONLY WHILE MARGINAL ECONOMICS JUSTIFY IT
→ STORE THE LEARNING WITH CONTEXT
→ BUILD THE NEXT BETTER HYPOTHESIS
```

---

# One-page Golden Standard

1. **Definér business outcome og break-even economics før spend.**
2. **Vælg objective/performance goal/conversion event så tæt på reel værdi som signalmængden forsvarligt tillader.**
3. **Verify tracking og signal quality før performance vurderes.**
4. **Brug Pixel/CAPI/CRM/offline/app events efter relevans og lovligt grundlag; prioriter event quality, deduplication og freshness.**
5. **Konsolider som default; split kun for reelle economics-, eligibility-, message-, geo- eller experiment-forskelle.**
6. **Start audience så enkelt som muligt; brug Advantage+/broad som stærk baseline hvor reelle constraints ikke kræver andet.**
7. **Test targeting-hypotheses mod business outcomes; lad ikke demographics erstatte customer motivation.**
8. **Byg creative portfolios med forskellige concepts, motivators, proof-types, messages og formats.**
9. **Skeln mellem concept-diversification og iteration af en eksisterende idé.**
10. **Match format til job: static for komprimeret proof/offer, video for demo/story/mechanism, carousel for sequence/range/comparison — og test.**
11. **Tilpas vertical environments som Reels/Stories med passende framing, pacing, audio og safe zones.**
12. **Gør brand/product/value let at afkode; attention uden relevans er ikke performance.**
13. **Skriv copy med clarity: hvem, problem, outcome, mechanism, proof, objection, offer, CTA efter behov.**
14. **Dokumentér claims og markér reklame/partnerships korrekt.**
15. **Sørg for message match mellem ad og destination.**
16. **Audit mobile speed, UX, form/checkout friction, trust og availability.**
17. **Evaluer på qualified conversion economics og business value; brug CPM/CTR/CPC/frequency som diagnoser.**
18. **Undgå at ændre mange variable samtidig uden at vide hvilket spørgsmål testen besvarer.**
19. **Brug A/B tests til variant-/strategy-spørgsmål og lift/RCT når spørgsmålet er incremental causality.**
20. **Beskyt eksperimenter mod mid-test manipulation, medmindre safety/business risk kræver stop.**
21. **Brug practical significance: et statistisk “win” uden økonomisk værdi er ikke et win.**
22. **Diagnostiser før intervention: auction cost, audience, creative, offer, landing, tracking eller downstream sales/quality.**
23. **Døm ikke én dårlig dag som trend; brug modne windows og forstå attribution lag.**
24. **Der findes ingen universel frequency fatigue threshold.**
25. **Der findes ingen universel 20%-scalingregel.**
26. **Retargeting skal vurderes for incrementality og recency, ikke kun attributed ROAS.**
27. **Platform ROAS er operational attribution; finance/backend og causal calibration er sandhedslagene over den.**
28. **Scale kun mens næste budget-enhed forventes at skabe acceptabel marginal business value.**
29. **Lav et postmortem efter hver væsentlig kampagne/test og gem læringen med scope + evidence strength.**
30. **Live-check volatile Meta-features/policies; behold evergreen decision logic stabil.**

---

# V2 validation note

Denne playbook er den mest forsvarlige syntese, der kan bygges ud fra den offentligt tilgængelige evidens og de aktuelle Meta-kilder ved research cutoff. Den er bevidst strengere end typiske “best practices”-lister: når et råd ikke kan forsvares som universel regel, er det blevet gjort til en testbar hypothesis eller flyttet til det volatile implementation layer.

Eventuelle senere implementationer, workflows eller automationslag skal bygge oven på denne standard uden at ændre selve fagstandarden i dokumentet.
