# Marketing Measurement & Attribution Master Playbook — V2.0 Revalidated Golden Standard
## Evidensbaserede standarder for at måle marketing på tværs af paid, organic, lifecycle, earned, referral, offline og AI-discovery kanaler

**Version:** 2.0 — Revalidated Golden Standard  
**Research cutoff:** 21. september 2026  
**Scope:** Marketing measurement, attribution, incrementality, cross-channel/cross-media measurement, experimentation, marketing mix modeling og budgetbeslutninger på tværs af permanente kanal-kategorier — ikke bundet til én udbyder.  
**Dokumenttype:** Evergreen best-practice playbook. Ikke en klik-for-klik GA4-manual, ikke et dashboard-katalog og ikke en playbook for generel website-behavior analytics/heatmaps.  
**Operator-neutral:** Standarderne gælder uanset om arbejdet udføres af mennesker, software, agents eller en kombination.  
**Primary principle:** Marketing måles for at reducere beslutningsusikkerhed og forbedre business outcomes — ikke for at producere flere tal.

---

# Executive V2 validation verdict

V2 er resultatet af et nyt falsifikations- og sanity-check af V1 mod aktuelle platformkilder fra Google, Meta, Microsoft og OpenAI; internationale measurement-standarder fra MRC, IAB/IAB Europe, WFA og AMEC; samt randomiseret og peer-reviewed marketing-science forskning.

Målet har ikke været at bevare V1. Målet har været at stille fire hårdere spørgsmål til hver regel:

1. **Hvilket beslutningsspørgsmål besvarer reglen faktisk?**
2. **Hvilket estimand måles — credit, average lift, marginal lift, brand response eller business outcome?**
3. **Hvilken evidensklasse understøtter reglen — vendor telemetry, observational model, quasi-experiment eller randomisering?**
4. **Er reglen evergreen, eller er den blot et produktfeature pr. september 2026?**

## Overordnet konklusion

V1's kerne holdt. Den stærkeste tværgående evidens peger fortsat på følgende system:

> **Business decision → præcist outcome/estimand → commercial source of truth → robust instrumentation → transparent channel telemetry → attribution som credit layer → causal experiments hvor beslutningen kræver det → experiment-calibrated aggregate modeling → marginal economics → beslutning med uncertainty → ny læring.**

V2 gør systemet strammere på især fem områder:

- **Estimand-first:** før en metric vælges, defineres hvilken effekt der ønskes målt.
- **Assignment ≠ exposure:** randomisering bevares ved at analysere efter assignment; “faktisk eksponerede” er ikke automatisk en valid control comparison.
- **Average ≠ marginal:** et standard holdout kan måle gennemsnitlig incremental effekt, men svarer ikke nødvendigvis på hvor meget ekstra budget der bør investeres.
- **Identity ≠ causality:** clean rooms, match rates og cross-device identity kan forbedre observation og deduplication, men skaber ikke et counterfactual.
- **Model ≠ observation:** attribution models, MMM response curves og budget optimizers er modeloutput med assumptions og uncertainty, ikke registrerede naturlove.

## Hvad V2 bekræfter

| Princip | V2-status | Hvorfor |
|---|---|---|
| Business outcome før platform metrics | **STÆRKT BEKRÆFTET** | Channel telemetry og attribution er input til beslutninger; finance/CRM/order truth ligger tættere på den økonomiske realitet. |
| Attribution ≠ incrementality | **STÆRKT BEKRÆFTET** | Google/IAB og akademisk forskning skelner mellem credit assignment og credible counterfactual measurement [G01][G06][IAB01][A01]. |
| Randomisering som stærkeste default for causal lift | **STÆRKT BEKRÆFTET** | User-/geo-holdouts identificerer et counterfactual, når design, power og contamination er sunde [G06][MM03][IAB01]. |
| Cross-channel platformtal må ikke summeres blindt | **STÆRKT BEKRÆFTET** | Overlappende windows, view/click rules og identity skaber duplicate credit; MRC kræver disclosure af coverage/matching limitations [MRC01]. |
| MMM skal kalibreres mod experiments hvor muligt | **STÆRKT BEKRÆFTET** | Både Meridian og Robyn fremhæver experimental calibration [MM02][MM04][MR01]. |
| Marginal return er centralt for næste-budget beslutningen | **STÆRKT BEKRÆFTET, PRÆCISERET** | Average ROI beskriver historisk efficiency; marginal treatment effects/mROI adresserer intensive-margin beslutningen [MM01][A09]. |
| Direct er ikke synonym med brand | **BEKRÆFTET** | Direct er en residual source med flere tekniske og adfærdsmæssige årsager [G07]. |
| Email opens er svage engagementssignaler | **BEKRÆFTET OG SKÆRPET** | MPP og security bots kan inflate både opens og clicks; downstream conversion/holdouts er stærkere [E01][E02]. |
| AI discovery/AI advertising er reelle measurement-kategorier | **BEKRÆFTET, IMPLEMENTATION VOLATIL** | GA4 har AI Assistant, Search Console har generative-AI reporting, og ChatGPT Ads har current paid telemetry/conversion measurement [G03][G12][O01][O03]. |
| PR/earned måles fra output til outcome/impact | **BEKRÆFTET** | AMEC/Barcelona Principles afviser AVE-lignende værdisurrogater [PR01][PR03]. |

## Hvad V2 korrigerer eller nedgraderer

1. **“GA4 Data-driven Attribution er bare observational path-credit.”** For groft. Googles aktuelle DDA bruger counterfactual modeling og oplyser, at Google-ad exposures kan trænes mod randomized holdbacks. Men outputtet er fortsat fractional attribution credit, ikke et samtidigt kampagnespecifikt lift-estimat for alle touchpoints [G01].
2. **`iROAS = incremental_revenue / total_spend` som universel formel.** Korrigeret. Ved go-dark/zero-spend control kan total treatment spend være den rigtige denominator; ved heavy-up/BAU eller marginal tests skal denominator være **incremental spend (`Δ spend`)** [MM05][A09].
3. **“Et lift-test giver svaret på hvor meget vi bør spend.”** Nedgraderet. Standard treatment-vs-control måler typisk en average effect ved den testede treatment. Intensive-margin beslutninger kræver response information, multi-cell/dose tests eller model + calibration [A09].
4. **“MMM modellerer incremental sales.”** For stærkt uden kvalifikation. MMM er et observational/econometric identification system. Causal interpretation afhænger af specification, controls, priors, variation og calibration [MM02][MR01].
5. **“Cross-device person-level dedup = sand customer journey.”** Afvist. Identity matching har coverage/error og kræver empirisk validering; MRC fremhæver disclosure af match rates og datagaps [MRC01].
6. **“Viewability/attention = effectiveness.”** Afvist. Viewability er opportunity-to-see; attention er et mellem-lag/diagnostic. Business impact kræver downstream outcome eller causal validation [MRC02].
7. **“Mere user-level data giver automatisk mere præcision/sandhed.”** Afvist. Randomized field research viser, at bedre control design i nogle settings gav større precision gain end enorme covariate-datasæt [A05].
8. **“Ét godt experiment kan kalibrere modellen permanent.”** Afvist. Effects ændres med spend, creative, competition, product og tid; calibration skal have scope, recency og revalidation [MM04][MM05][A08].
9. **“Reach kan summeres på tværs af platforms.”** Afvist. Deduplicated cross-media reach/frequency er et selvstændigt measurement problem [WFA01].
10. **“Platform lift er automatisk generaliserbart til næste periode.”** Afvist. Parallel experimentation og konkurrencemiljø kan ændre measured lift markant [A08].

## Den centrale measurement-stack

```text
BUSINESS TRUTH
finance / orders / net revenue / contribution / pipeline / retained value
        ↓
CUSTOMER TRUTH
CRM / customer status / qualification / cohorts / retention
        ↓
BEHAVIORAL TRUTH
website / app / product / commerce events
        ↓
MEDIA + CHANNEL TELEMETRY
valid impressions / reach / clicks / visits / views / opens / search visibility
        ↓
ATTRIBUTION
who receives credit under a documented model?
        ↓
CAUSAL MEASUREMENT
what changed because the intervention existed?
        ↓
CALIBRATED PLANNING
what is expected to happen at alternative spend/treatment levels?
        ↓
DECISION
where should the next unit of money/time go, given uncertainty and constraints?
```

Ingen af lagene er “sandhed” i isolation. Business/finance-data kan være korrekt om udfaldet uden at vide årsagen. Platformtelemetry kan være korrekt om delivery uden at vide incrementality. Et experiment kan være kausalt stærkt men lokalt i tid, treatment og population. Et MMM kan generalisere bredere, men kun gennem assumptions.

## Seks spørgsmål, seks measurement-jobs

| Spørgsmål | Primært measurement-lag |
|---|---|
| Hvad skete i virksomheden? | Finance / CRM / commerce / product |
| Blev media/content faktisk leveret og observerbart? | Channel/media telemetry + quality standards |
| Hvor kom observeret traffic/conversions fra? | Source tagging + analytics + platform telemetry |
| Hvem får credit for observerede conversions? | Attribution |
| Hvad skabte ekstra outcome? | RCT/lift/geo eller stærkt causal design |
| Hvad bør vi ændre næste gang? | Marginal experiments + calibrated MMM/response models + economics |

---

# Hvad “gold standard” betyder

Ingen measurement-stack kan levere perfekt omniscience på tværs af enheder, offline touchpoints, walled gardens, consent states, private sharing, AI-assistenter og tidsperioder.

Gold standard betyder derfor:

> **Definér beslutningen og estimandet først; brug det stærkeste forsvarlige design til netop dét spørgsmål; rapportér data coverage, assumptions og uncertainty; og triangulér på tværs af uafhængige evidenslag før store beslutninger.**

Det betyder også:

- stærkere causal claims kræver stærkere identification,
- mere granularitet er ikke automatisk mere causalitet,
- observed, attributed, modeled og incremental må aldrig blandes uden label,
- missing data skal synliggøres frem for at maskeres,
- model output skal have uncertainty og sensitivity checks,
- platformdata må aldrig være eneste source of truth for virksomhedens økonomi,
- et measurement-system er kun godt, hvis det faktisk forbedrer beslutninger.

---

# Sådan bruges playbooken

Playbooken har fire lag:

1. **Evergreen measurement core:** economics, estimands, instrumentation, data quality, attribution, causality, experiments, MMM og marginal decision-making.
2. **Permanent channel categories:** paid search, paid social, paid video/display, paid AI, organic search, AI discovery, organic social, lifecycle, affiliates, creators, PR og offline.
3. **Cross-media/cross-channel standards:** identity, deduplication, reach/frequency, reconciliation og coverage metadata.
4. **Volatile implementation registry:** aktuelle products, APIs, modelnavne, report fields, attribution windows, channel definitions, privacy features og availability.

Et Google-, Meta-, Microsoft-, OpenAI-, LinkedIn- eller TikTok-feature må aldrig ophøjes til en permanent measurement-lov.

---

# Evidensstandard og kildehierarki

| Tier | Kildetype | Brug |
|---|---|---|
| **A1** | Randomiserede field experiments / stærk peer-reviewed causal research | Højeste vægt ved causal effect og incrementality. |
| **A2** | Stærk causal/econometric/method research | Identification, power, interference, geo-tests, marginal effects, MMM assumptions. |
| **B1** | Officielle platform-/produktdocs | Source of truth for mechanics, metric definitions, current models og data availability. Vendor efficacy claims er ikke universal truth. |
| **B2** | Professionelle measurement standards (MRC, IAB, WFA, AMEC) | Taxonomy, data quality, cross-media, disclosure, media-quality og governance. |
| **C** | Practitioner/industry datasets | Implementation context, hypothesis generation og sanity checks. |
| **D** | Egen virksomhedsdata | Kan være vigtigst for konkrete beslutninger, men skal klassificeres som causal, observational eller heuristic. |

## Evidenslabels

- `PLATFORM_MECHANIC`
- `METRIC_DEFINITION`
- `POLICY_REQUIREMENT`
- `CAUSAL_RANDOMIZED`
- `CAUSAL_QUASI_EXPERIMENTAL`
- `EXPERIMENTAL_METHOD_RESEARCH`
- `STRONG_OBSERVATIONAL`
- `MODELING_METHOD`
- `INDUSTRY_STANDARD`
- `VENDOR_REPORTED`
- `PRACTITIONER_EVIDENCE`
- `INTERNAL_CAUSAL_TEST`
- `INTERNAL_ASSOCIATION`
- `SYNTHESIS`
- `HYPOTHESIS`

## Konfliktregel

Når kilder tilsyneladende modsiger hinanden:

1. Definér **estimand** og beslutningsspørgsmål først.
2. Tjek population, treatment, control/counterfactual, metric, tidsperiode og spend level.
3. Platformmekanik → aktuel officiel dokumentation.
4. Causal effect → randomiseret/kausal evidens over attributed/observational claims.
5. Cross-media/data-quality → dokumenterede standards + empirisk validation.
6. Business truth → virksomhedens finance/CRM/order-systemer over vendor dashboard.
7. Bevar heterogenitet: ét experiment er ikke en universel lov.
8. Hvis usikkerheden stadig kan ændre beslutningen → gør den til et experiment, sensitivity analysis eller eksplicit uncertainty range.

---

# De 50 gyldne standarder

1. **Start med beslutningen, ikke dashboardet.**
2. **Definér estimand før metric: hvad præcis vil vi vide effekten af?**
3. **Definér business outcome før marketing telemetry.**
4. **Revenue er ikke profit, og conversions er ikke nødvendigvis kunder.**
5. **Brug finance/CRM/commerce som commercial source of truth.**
6. **Tracking quality er measurement infrastructure.**
7. **Et event skal have semantik, owner, unique key, source og freshness-SLA.**
8. **Deduplicér orders, leads og browser/server events.**
9. **Gem stable IDs, timestamps, currency og customer status hvor lovligt.**
10. **Standardisér source/medium/campaign taxonomy på tværs af channels.**
11. **UTM governance er attribution infrastructure, ikke kosmetik.**
12. **Direct er en mixed residual category, ikke automatisk brand.**
13. **First-user, session, event/conversion credit og customer-level source er forskellige scopes.**
14. **Observed, modeled, attributed og incremental skal labels adskilt.**
15. **Platform attribution er operational credit assignment, ikke automatisk causal proof.**
16. **Data-driven attribution kan være counterfactual/model-based og stadig være et attribution layer.**
17. **View-through, engaged-view og click-through credit skal adskilles hvor muligt.**
18. **Assisted paths er descriptive journey evidence, ikke incremental value.**
19. **Cross-channel totals må ikke summeres blindt på tværs af vendor dashboards.**
20. **Reconcile mod backend totals før kanalfortolkning.**
21. **Identity resolution forbedrer observation; den skaber ikke et counterfactual.**
22. **Rapportér match rate, observable coverage og deduplication uncertainty.**
23. **Reach/frequency på tværs af platforms kræver deduplication; summer ikke reach.**
24. **Viewability er opportunity-to-see, ikke attention eller effectiveness.**
25. **Attention er diagnostic/intermediate medmindre downstream value er valideret.**
26. **Brug randomized holdout/lift når spørgsmålet er causal effect.**
27. **Analysér randomiserede tests efter assignment som default; exposure-conditioned effects kræver særskilt design/assumptions.**
28. **Brug geo-experiments når person-level randomization ikke er praktisk.**
29. **Definér én primary outcome og MDE før testen.**
30. **Et underpowered null-resultat er ikke bevis for nul effekt.**
31. **Et statistisk signifikant resultat kan være økonomisk irrelevant.**
32. **Rapportér effect size + interval + spend/treatment context.**
33. **Standard holdout måler ikke automatisk marginal response ved andre spend levels.**
34. **Brug multi-cell/heavy-up/dose designs eller calibrated response curves til intensive-margin spørgsmål.**
35. **MMM er et modelbaseret planning-system, ikke et kausalt orakel.**
36. **Kalibrér MMM mod causal experiments når muligt og estimands matcher.**
37. **Response curves og budget allocators er predictions med uncertainty, ikke observerede love.**
38. **Budgetallokering styres af forventet marginal contribution efter uncertainty og constraints.**
39. **Organic kan skabe værdi uden media spend; mål contribution og opportunity cost, ikke ROAS alene.**
40. **Paid og organic i samme distribution surface skal kunne separeres analytisk.**
41. **Engagement er diagnostic medmindre valideret som business-leading indicator.**
42. **Email opens og clicks kan være bot/privacy-forurenede; downstream outcomes vejer tungere.**
43. **SEO rank/position er diagnostic; business value kræver demand + traffic + downstream outcome.**
44. **AI visibility er ikke kun referrals; provider-specific exposure måles separat og med coverage caveats.**
45. **PR/earned måles output → out-take → outcome → impact; AVE/EMV er ikke business ROI.**
46. **Consent/privacy reducerer observability; workaround uden lawful basis er ikke measurement.**
47. **Ingen KPI uden definition, owner, source, scope, uncertainty og beslutningsbrug.**
48. **Measurement incidents suspenderer performance-fortolkning for berørte metrics.**
49. **Gem learnings med population, treatment, period, spend level, method og external environment.**
50. **Den langsigtede fordel er bedre calibrated decisions under uncertainty, ikke flere datapunkter.**

---

# Measurement starter med business economics

Marketing measurement starter ikke med sessions, clicks eller impressions.

Før målesystemet bygges, definér:

- Revenue source of truth
- Net revenue
- Gross margin / contribution margin
- Refunds / cancellations
- New vs existing customer
- Customer acquisition cost
- Payback period
- Qualified pipeline
- Closed-won revenue
- Retention/churn
- LTV definition og maturity
- Capacity/inventory constraints

## Primære økonomiske metrics

### CAC

Observed/operational:

```text
CAC = acquisition_spend / new_customers
```

Causal, når control/counterfactual er defineret:

```text
incremental_CAC = incremental_marketing_cost / incremental_new_customers
```

`incremental_marketing_cost` skal matche experimentets counterfactual. Hvis control er zero spend, er det treatment-spend. Hvis treatment er en heavy-up over BAU, er det `spend_treatment - spend_control`.

### ROAS

```text
ROAS = attributed_revenue / media_spend
```

ROAS kan være operationelt nyttig, men siger ikke automatisk hvad der ville være sket uden kampagnen.

### Incremental ROAS — to forskellige cases

**Go-dark / zero-spend control:**

```text
iROAS = incremental_revenue / treatment_spend
```

**Heavy-up / BAU / marginal experiment:**

```text
marginal_iROAS = incremental_revenue / (spend_treatment - spend_control)
```

Det er en kritisk V2-præcisering. En marginal test med ikke-nul control-spend må ikke dividere incremental revenue med hele treatment-budgettet, hvis beslutningen handler om værdien af den ekstra spend [MM05][A09].

### Incremental CPA

Tilsvarende:

```text
iCPA = incremental_spend / incremental_conversions
```

hvor `incremental_spend` er treatment minus counterfactual spend.

### POAS / contribution return

```text
POAS = contribution_profit / media_spend
```

Label altid numerator:

- `attributed_contribution`
- `incremental_contribution`
- `modeled_incremental_contribution`

De er ikke interchangeable.

### MER

```text
MER = total_revenue / total_marketing_spend
```

MER er et blended health metric. Det kan ikke alene identificere hvilken kanal der forårsagede ændringen.

### Marginal ROI / marginal contribution

Den relevante næste-budget størrelse er typisk:

```text
mROI = change_in_incremental_profit_or_revenue / change_in_spend
```

For beslutninger bør revenue-based mROI helst oversættes til contribution economics:

```text
mContributionROI = Δ incremental_contribution / Δ spend
```

Rapportér den som en distribution/interval, når den er model-estimeret.

---

# Measurement question map

## Spørgsmål A — Hvad skete der?

Brug:
- ERP/finance
- commerce/order database
- CRM
- subscription/product database

Svar:
- revenue
- margin
- customers
- pipeline
- retention

## Spørgsmål B — Hvordan bevægede kunden sig?

Brug:
- first-party web/app analytics
- CRM stage history
- source tagging
- event streams

Svar:
- sessions
- pages/actions
- funnel progress
- cohorts
- touchpoint sequences

## Spørgsmål C — Hvem får kredit?

Brug:
- attribution models
- channel/path reporting

Svar:
- allocated credit under model rules

Ikke svar:
- true causal contribution

## Spørgsmål D — Hvad skabte ekstra værdi?

Brug:
- RCT
- conversion lift
- brand/search lift
- geo holdout
- switchback/market experiments
- stærkt causal quasi-experimental design

Svar:
- counterfactual effect med uncertainty

## Spørgsmål E — Hvor bør vi investere mere?

Brug kombinationen:
- current unit economics
- response curves
- causal calibrations
- saturation
- capacity constraints
- uncertainty
- mROI

---

# Data architecture: én virksomhed, flere sandhedslag

## Lag 1 — Commercial truth

Typiske systems of record:

- payment processor
- webshop/order system
- ERP
- billing
- finance
- CRM closed-won

Dette lag afgør hvad der faktisk blev købt, betalt, refunderet og tjent.

## Lag 2 — Customer truth

- customer ID
- new/existing
- lead quality
- opportunity stage
- cohort
- retention
- product usage
- LTV state

## Lag 3 — Behavioral truth

- web events
- app events
- product events
- checkout steps
- lead form events
- subscription lifecycle

## Lag 4 — Channel telemetry

- impressions
- reach
- views
- clicks
- CPC/CPM
- email delivery
- search visibility
- referral traffic
- social interactions

## Lag 5 — Attribution

- first/session/event scoped acquisition
- last click
- data-driven attribution
- channel-specific attribution
- view-through credit

## Lag 6 — Causal truth

- randomized holdout
- lift study
- geo test
- switchback
- calibrated causal model

## Lag 7 — Planning model

- MMM
- response curves
- saturation
- scenario planning
- marginal allocation

**Regel:** Et lag må aldrig overskrive et højere-reliability commercial fact uden dokumenteret reconciliation.

---

# Event design og measurement contract

Hvert vigtigt event skal have et measurement contract.

```yaml
event_name: purchase
business_definition: "A completed paid order"
source_of_truth: orders_database
owner: commerce
trigger: "payment captured"
unique_key: order_id
value_field: net_revenue
currency_field: currency
customer_status: new|existing
refund_policy: "net out refunds in finance layer"
platform_exports:
  - google_ads
  - meta
  - microsoft_ads
consent_requirement: documented
freshness_sla: 15m
known_limits: []
```

## Event quality checklist

- Er definitionen entydig?
- Kan samme event opstå to gange?
- Findes unique key?
- Er timestamp korrekt?
- Er timezone dokumenteret?
- Er currency dokumenteret?
- Er value gross eller net?
- Kan refunds/cancellations reconciles?
- Er test/internal traffic filtreret?
- Kan customer status bestemmes?
- Kan lead quality sendes tilbage downstream?
- Er source platformens counting rule kendt?
- Er consent/lawful basis dokumenteret?

---

# Source taxonomy og campaign governance

Den robuste abstraktion er:

```text
CHANNEL CATEGORY
  → PLATFORM / PUBLISHER
      → CAMPAIGN / INITIATIVE
          → TACTIC / AUDIENCE / CREATIVE / CONTENT
              → TOUCHPOINT
```

Eksempel:

```text
Paid Social
  → Meta
      → DK_SMB_Acquisition_Q4
          → FounderVideo_ProblemAware
              → ad_4831
```

## Permanente channel categories

Som evergreen taxonomy bør organisationen mindst kunne skelne:

- Paid Search
- Paid Social
- Paid Video
- Paid Display/Programmatic
- Paid AI/Conversational Ads
- Organic Search / SEO
- Organic Social
- Organic Video
- AI Assistant / Generative Discovery
- Email / CRM
- SMS / Push
- Affiliate
- Referral / Partnerships
- Creator / Influencer
- PR / Earned Media
- Organic Shopping / Marketplace discovery
- Offline / Events / Sponsorship
- Direct / Unknown

GA4's aktuelle default channel grouping understøtter mange af disse kategorier og har i 2026 også `AI Assistant` som selvstændig channel class [G03]. Platformklassifikation bruges som reference — virksomheden bør eje sin egen canonical taxonomy.

---

# UTM golden standard

For ikke-auto-tagged links skal marketing links have konsekvent tagging.

Minimum:

```text
utm_source
utm_medium
utm_campaign
utm_id
```

Ved behov:

```text
utm_content
utm_term
```

Google Analytics anbefaler `utm_id`, `utm_source`, `utm_medium` og `utm_campaign` til manual campaign data [G05].

## Canonical naming

Eksempel:

```text
utm_source=linkedin
utm_medium=paid_social
utm_campaign=dk_smb_ai_foundation_q4_2026
utm_id=cmp_2026_041
utm_content=founder_video_problem_v3
```

## Regler

- lowercase som default
- ingen spaces
- ingen platformnavn i `medium`, hvis medium beskriver category
- stable campaign ID adskilt fra human-readable name
- aldrig ændre taxonomy mid-campaign uden migration plan
- documentér aliases
- automated QA på links før launch

## Anti-patterns

```text
facebook / social / meta_paid / paid-social / cpc-social
```

som fem forskellige mediums for samme kategori.

---

# Direct traffic er ikke en kanalstrategi

Google beskriver `(direct)/(none)` som traffic uden en klar referral source; det kan komme fra typed URLs/bookmarks, offline documents, manglende UTM'er, redirects eller blockers [G07].

Derfor:

- direct er **ikke** automatisk brand demand,
- stigende direct kan være brand effect,
- men kan også være tagging degradation,
- eller dark social/private sharing,
- eller privacy/ad-blocking.

**Regel:** Behandl direct som en mixed residual category, ikke som et rent marketing-origin signal.

---

# Attribution: kreditfordeling, ikke automatisk causal truth

Google definerer attribution som processen med at tildele credit til touchpoints på vejen til en key event [G01]. Den afgrænsning er stadig den rigtige, men V2 nuancerer moderne data-driven attribution.

## Attribution-modeller svarer på

> “Hvordan skal observerede/eligible conversions fordeles mellem touchpoints under denne models data og assumptions?”

De svarer ikke nødvendigvis på:

> “Hvad ville virksomhedens total outcome have været, hvis kanalen/treatmentet ikke eksisterede?”

## Last-click

Styrke:
- simpelt
- transparent
- operationally stable

Svaghed:
- favoriserer closers/high-intent touchpoints
- kan undervurdere earlier discovery
- er særligt sårbar i branded/high-intent contexts

Last click er ikke “forkert” per definition; det er en credit rule med kendte biases.

## First-touch

Styrke:
- acquisition-origin lens

Svaghed:
- ignorerer nurture/closing
- afhænger stærkt af observable history

## Data-driven attribution — V2-korrektion

Googles aktuelle GA4 DDA bruger både converting/non-converting paths, counterfactual modeling og oplyser, at modeller for Google-ad exposure kan trænes mod randomized controlled holdbacks [G01]. Det er metodisk stærkere end en simpel regelbaseret path model.

Men outputtet er fortsat **fractional attribution credit**. Det er ikke det samme som at have kørt et samtidigt randomized lift study for hver kanal, hvert touchpoint og hvert spend level.

Derfor skal DDA klassificeres som:

```text
MODEL-BASED ATTRIBUTION WITH CAUSAL/COUTERFACTUAL COMPONENTS
≠
CAMPAIGN-SPECIFIC INCREMENTALITY GROUND TRUTH
```

Brug DDA til:
- operational cross-channel credit
- path-informed optimization
- reporting under én dokumenteret model

Kalibrér store spend-/allocation-beslutninger mod direct causal evidence, når muligt.

## View-through og engaged-view attribution

Eksempel:

```text
user sees ad
→ no click
→ later converts
→ platform credits impression
```

Exposure kan have reel effekt, men selection og overlap gør naive exposed-vs-unexposed comparisons svage. Rapportér som minimum separat:

- click-through
- engaged-view, hvis formatet har det
- view-through
- modeled conversions

Hvis view-through credit er material for budgetbeslutningen, prioriter lift/holdout/geo calibration.

## Conversion path reporting

GA4 path reports kan vise touchpoints, days-to-conversion og path structures [G02]. Brug dem til:

- journey understanding
- channel sequencing hypotheses
- latency analysis
- scope/coverage diagnostics

Ikke som proof of incremental effect.

## Attribution coverage disclosure

Et attribution-output bør ledsages af:

```yaml
attribution_model:
lookback_window:
eligible_channels:
observable_share:
matched_identity_share:
modeled_share:
view_credit_included:
cross_device_method:
known_missing_media:
last_method_review:
```

MRC's Outcomes/Data Quality standard understreger, at coverage, matching, data availability og attribution methodology skal disclosed og reviewes periodisk; RCTs kan bruges som validation truth standard [MRC01].

---

# Cross-channel reconciliation

Det mest almindelige problem:

```text
Meta reports 700 conversions
Google reports 600 conversions
Email reports 300 conversions
Backend has 900 orders
```

Der er ikke nødvendigvis 1.600 ordrer.

Flere platforme kan claim samme order under forskellige attribution rules/windows.

## Reconciliation protocol

### Step 1 — Backend total

```text
actual_orders = deduplicated backend orders
```

### Step 2 — Platform claims

Gem for hver platform:

- attributed conversions
- attributed value
- attribution window
- click/view inclusion
- conversion definition

### Step 3 — Analytics allocation

Se cross-channel attribution under samme analytics-model.

### Step 4 — Causal calibration

Hvor spend/materiality retfærdiggør det:

- lift studies
- geo tests
- holdouts

### Step 5 — Decision layer

Budgetbeslutninger må ikke baseres på summering af vendor-attributed revenue.

---

# Attribution discrepancy ledger

Når systemer er uenige, opret en discrepancy ledger:

```yaml
period: 2026-W38
backend_orders: 912
ga4_key_events: 851
meta_attributed: 683
google_attributed: 621
email_attributed: 291
known_causes:
  - attribution_window_overlap
  - consent_loss
  - cross_device_gap
  - view_through_credit
  - payment_redirect_issue_fixed_sep18
confidence: medium
```

Målet er ikke at tvinge tallene til at blive ens. Målet er at forstå hvorfor de er forskellige.

---

# Identity resolution, deduplication og cross-media reach

Identity er et separat measurement-problem fra attribution og causality.

## Identity-resolution standard

Et identity system kan hjælpe med:

- deduplicated users/customers
- cross-device paths
- frequency management
- CRM match
- audience overlap

Men:

> **Et bedre identity graph gør observation bedre; det gør ikke en observational comparison kausal.**

Rapportér:

- deterministic vs probabilistic matching
- match/coverage rate
- unmatched share
- cross-device method
- truth-set/validation method
- recency of identity model
- consent/legal scope

MRC fremhæver empirisk support for cross-device deduplication og disclosure af match coverage; simple identifiers som IP bør ikke behandles som perfekt personidentitet [MRC01].

## Clean rooms

Data clean rooms kan forbedre privacy-safe matching, overlap analysis og aggregate measurement. De kan ikke i sig selv:

- skabe randomization
- eliminere selection bias
- bevise incrementality

Et clean room er infrastructure, ikke et causal design.

## Cross-media reach/frequency

Do not:

```text
Meta reach + YouTube reach + TV reach = total reach
```

Den samme person kan optræde flere steder. Deduplicated reach/frequency er sit eget estimationsproblem. WFA Halo er et eksempel på et privacy-preserving framework for netop cross-media deduplication [WFA01].

Rapportér separate views:

```text
platform reach
cross-media deduplicated reach (if validated)
frequency distribution
business outcome
```

Reach/frequency beskriver distribution. De beviser ikke effect.

---

# Media quality: valid impression → viewability → attention → outcome

Paid video/display/programmatic kræver et ekstra quality lag.

```text
SERVED IMPRESSION
→ VALID / IVT-FILTERED IMPRESSION
→ VIEWABLE / AUDIBLE OPPORTUNITY
→ ATTENTION SIGNAL
→ BEHAVIOR / BRAND RESPONSE
→ BUSINESS OUTCOME
```

## Regler

- Invalid traffic filtration er en data-quality prerequisite, ikke en performance metric [MRC01].
- Viewability er mulighed for eksponering, ikke dokumenteret menneskelig attention.
- Attention metrics kan være værdifulde diagnostic features, men MRC's aktuelle attention guidance behandler methodology, viewability/audibility og labeling som særskilte krav [MRC02].
- En høj attention score er ikke i sig selv incremental sales.

**Playbookregel:** Hvis en metric ligger tidligere i kæden, må den kun overrule downstream business evidence, hvis dens predictive/causal relation er internt valideret.

---
# Incrementality: det kausale spørgsmål

Incrementality spørger:

> **Hvad ændrede sig på grund af en klart defineret marketing-intervention, relativt til et troværdigt counterfactual?**

IAB/IAB Europe sammenfatter causal incrementality omkring tre discipliner: credible counterfactual, control of bias og separation of signal from noise [IAB01]. Google beskriver Conversion Lift som controlled treatment/control measurement af conversions direkte drevet af ads [G06].

## Estimand-first

Før design vælges, skriv præcis hvad effekten skal være:

```yaml
intervention: "Add channel X at budget B"
population: "Eligible DK prospects"
unit: "user|household|geo"
outcome: "net new customer contribution within 30d"
contrast: "treatment vs no channel X"
quantity: "ITT average lift"
period: "2026-10-01..2026-10-28"
```

Andre estimands kan være:

- average treatment effect ved et konkret spend level
- effect on treated/eligible population
- marginal treatment effect ved ekstra spend
- brand-lift effect
- retention effect

De må ikke blandes.

## Assignment vs actual exposure

Ved et randomiseret experiment er default estimand:

```text
ITT = E[Y | assigned treatment] - E[Y | assigned control]
```

Hvis du bagefter sammenligner “mennesker der faktisk så annoncen” med “mennesker der ikke så den”, kan randomiseringen brydes, fordi exposure afhænger af auction/delivery/behavior.

**Regel:** Bevar assignment-baseret analysis som causal baseline. Hvis effect among actually exposed ønskes, kræver det et design/estimator der håndterer noncompliance — ikke bare filtering.

## Core incremental metrics

### Incremental outcome

```text
incremental_outcome = observed_treatment_outcome - estimated_counterfactual_outcome
```

### Incremental conversion rate

```text
ICR = incremental_conversions / randomized_or_eligible_population
```

### Incremental CPA

```text
iCPA = Δ spend / incremental_conversions
```

### Incremental ROAS

Zero-spend control:

```text
iROAS = incremental_revenue / treatment_spend
```

Non-zero control/heavy-up:

```text
marginal_iROAS = incremental_revenue / Δ spend
```

## Hvorfor observational attribution kan fejle

Store advertising experiments viser, at observational methods ofte ikke reproducerer RCT effects [A01][A02]. Paid-search research viser tilsvarende self-selection risk [A06].

**Princip:** Exposure, click og conversion kan være stærkt correlated med pre-existing intent. Correlation identificerer ikke treatment effect.

## Interference og contamination

Classic experiment assumptions kan brydes når:

- control stadig eksponeres via andre channels
- household members krydser cells
- geos påvirker hinanden
- concurrent campaigns overlapper
- competitors ændrer spend/auction environment

Marketing Science-forskning viser, at parallel competitive experimentation i den undersøgte setting kunne ændre measured advertising lift med en faktor på to eller mere [A08].

Derfor skal experimentet gemme:

- concurrent campaign state
- competitor/market regime where observable
- contamination checks
- spillover risk
- external shocks

---

# Experiment design families — vælg efter beslutningen

Der findes ikke én lineær “Level 1–5” rangliste, fordi designs besvarer forskellige questions. Brug følgende families.

## 1. Randomized treatment comparison

Brug til:
- creative
- offer
- landing page
- audience/bidding strategy
- product/message treatment

Randomization gør sammenligningen causal for den konkrete treatment contrast, hvis execution integrity holder.

## 2. User-/household-level incrementality holdout

Brug når spørgsmålet er:

> “Hvad skaber ads/channel overhovedet relativt til holdout?”

Typisk stærkt til average incremental effect ved den testede policy/spend.

## 3. Geo randomized experiment

Brug når:
- user-level randomization ikke er mulig
- offline outcomes er vigtige
- channel-level spend ændres geografisk
- privacy/identity gør aggregate design mere robust

GeoX understøtter bl.a. holdback, go-dark, heavy-up og multi-cell designs [MM03][MM06].

## 4. Multi-cell / dose-response / marginal experiment

Brug når beslutningen er **hvor meget** der skal spendes, ikke kun om channel virker.

Marketing Science viser, at klassiske treatment/control designs ikke altid identificerer den intensive-margin quantity en budgetbeslutning kræver; multi-cell designs kan estimere marginal treatment effects [A09].

## 5. Switchback / time-randomized design

Brug når geography/person randomization er operationally umulig, men treatment kan roteres over tid.

Risici:
- carryover
- day-of-week/seasonality
- anticipatory behavior
- platform learning

## 6. Quasi-experimental design

Eksempler:
- difference-in-differences
- synthetic control
- regression discontinuity
- instrumental variables

Brug kun med eksplicit identification assumption og falsification/placebo checks. DID kræver særlig disciplin omkring control selection og parallel-trend logic [A10].

## Experiment validity checklist

Før resultater bruges til spend:

```text
1. Randomization/assignment integrity?
2. Sample-ratio mismatch?
3. Stable outcome definition?
4. Primary metric pre-defined?
5. Sufficient power/MDE?
6. Attrition/missing data balanced?
7. Contamination/spillover bounded?
8. Concurrent campaigns/promos documented?
9. Delivery noncompliance understood?
10. Analysis follows design?
11. Multiple comparisons controlled?
12. Economic materiality assessed?
13. External validity/scope documented?
```

---

# Power, noise og false certainty

Lewis & Rao viser, at advertising ROI kan være statistisk vanskeligt at måle præcist, fordi treatment effects ofte er små relativt til outcome variance [A03]. Johnson, Lewis & Reiley viser samtidig, at bedre experimental design i deres setting forbedrede precision langt mere end store mængder ekstra covariate data [A05].

Derfor:

- pre-calculate feasibility
- definér MDE før launch
- vælg én primary outcome per powered design som default
- rapportér confidence/credible intervals
- undgå optional stopping/peeking uden sequential method
- brug covariate adjustment når pre-specified og valid, men forvent ikke at “mere data” løser dårligt design
- pool repeated studies kun når estimands/context er kompatible

Google GeoX anbefaler én primary KPI pr. design og gør eksplicit opmærksom på, at secondary metrics ikke nødvendigvis er powered [MM06].

## Minimum experiment brief

```yaml
experiment_id:
decision_question:
estimand:
population:
treatment:
control_or_counterfactual:
randomization_unit:
primary_outcome:
secondary_guardrails:
minimum_material_effect:
power_target:
planned_duration:
spend_treatment:
spend_control:
contamination_risk:
spillover_risk:
concurrent_campaigns:
stopping_rule:
analysis_plan:
external_validity_notes:
```

## Repeated calibration

Én test er et datapunkt. Advertising effects kan drifte. Repeated/continuous geo experiments kan i egnede settings give løbende calibration og bedre precision end uafhængige one-offs [A11].

---

# Practical significance

Et result kan være statistisk klart og økonomisk dårligt — eller økonomisk interessant men stadig for usikkert.

Rapportér derfor tre dimensioner:

```text
1. effect estimate
2. uncertainty interval / probability
3. economic hurdle
```

Eksempel:

```text
incremental revenue = +120,000
incremental contribution = +52,000
incremental spend = 70,000
95% CI on contribution = [-8,000; +112,000]
```

Det er ikke nok at kalde testen “positive”. Decision maker skal se downside, expected value og om ny information er værd at købe.

---

# MMM — Marketing Mix Modeling

MMM modellerer aggregate relationer mellem outcomes, media/marketing inputs og non-media factors over tid og/eller geography.

Typiske inputs:

- spend / impressions / reach where available
- price / promotions / distribution
- seasonality / holidays
- macro factors
- competitor/category demand where defensible
- organic demand/search variables
- product/availability constraints

Typiske transforms:

- adstock/carryover
- saturation
- diminishing returns

## V2 doctrine: MMM er model-based identification

MMM kan være stærkt til:

- cross-channel aggregate contribution
- offline + online mix
- scenario planning
- saturation/response hypotheses
- channels uden deterministic click paths
- budget planning under signal loss

MMM er svagere til:

- user journeys
- creative/keyword-level truth
- sudden regimes uden historical support
- causal certainty uden assumptions/calibration

**Kritisk regel:** En MMM-koefficient eller response curve er ikke direkte observeret incremental sales. Den er et estimate under model specification, data variation, priors, controls og functional form.

## Model-design standard

Dokumentér mindst:

```yaml
business_outcome:
model_window:
time_granularity:
media_inputs:
non_media_controls:
organic_demand_controls:
priors:
adstock_family:
saturation_family:
collinearity_risk:
experiment_calibration:
holdout_validation:
sensitivity_runs:
uncertainty_outputs:
```

## Calibration

Meridian anbefaler incrementality experiments som stærke causal anchors for ROI priors [MM02][MM04]. Robyn anbefaler ligeledes experimental/causal calibration [MR01].

Men calibration er ikke mekanisk truth transfer:

- experiment og MMM skal måle kompatible outcomes
- spend/treatment level skal være relevant
- period/market skal være relevant
- experiment uncertainty skal bevares
- marginal-lift experiment kan have estimand mismatch mod MMM's zero-spend counterfactual [MM05]

Gold standard:

```text
experiments → local causal anchors
MMM → aggregate generalization + response hypotheses
attribution → operational credit
backend → realized business outcomes
```

## Saturation og response curves

Response curves er useful, men skal behandles som uncertain model objects.

Sanity checks:

- har channel nok spend variation?
- er curve identifiable vs correlated channels?
- ændrer functional form beslutningen?
- er curve consistent med experiments?
- er extrapolation langt uden for observed range?
- er uncertainty med i allocator output?

Robyn fremhæver, at saturation/adstock også er uncertain quantities der bør kalibreres mod ground truth hvor muligt [MR02].

## Budget allocators

En allocator er en scenario engine, ikke en garanti.

Meta Robyn siger eksplicit, at predicted response accuracy ikke garanteres og bør valideres før implementation [MR01].

Derfor:

```text
allocator recommendation
→ uncertainty/sensitivity
→ operational constraints
→ bounded implementation
→ measure actual response
→ recalibrate
```

---

# Marginal allocation

Historisk average efficiency besvarer ikke automatisk næste-budget spørgsmålet.

Eksempel:

```text
Channel A average ROI = 4.0
Channel B average ROI = 2.8
```

men:

```text
A estimated mContributionROI = 0.9
B estimated mContributionROI = 1.8
```

Den næste krone kan derfor være mere værdifuld i B.

## Marginal decision stack

Brug i prioriteret rækkefølge:

1. **Direct marginal experiment**, hvis feasibility er god.
2. **Calibrated response curve**, hvis experiment + aggregate data understøtter den.
3. **Bounded exploration**, hvis uncertainty er høj men expected value of information er stor.

## Allocation objective

Undgå kun at maksimere revenue ROAS. Et mere business-relevant objective er:

```text
maximize expected incremental contribution
subject to:
  budget
  cash/payback
  inventory/capacity
  brand/safety constraints
  channel minimums
  learning requirements
  uncertainty/risk tolerance
```

## Uncertainty-aware allocation

Rapportér ikke kun:

```text
mROI = 1.7
```

Rapportér fx:

```text
expected mContributionROI = 1.4
80% interval = 0.7–2.2
probability above hurdle 1.0 = 69%
```

Falsk præcision skaber aggressiv over-allocation.

---

# Measurement for Paid Search

## Channel job

Primært:
- capture existing intent
- competitor interception
- problem/solution discovery

## Native telemetry

- impressions
- clicks
- CPC
- query/keyword data
- impression share
- attributed conversions

## Business layer

- new customer CAC
- contribution
- qualified lead rate
- pipeline/won revenue

## Største measurement risk

**Selection / intent bias.**

En person der søger efter brandet kan allerede have besluttet sig.

## Gold-standard measurement

```text
Search platform telemetry
+ analytics source/path
+ backend customer outcome
+ brand/non-brand segmentation
+ incrementality test on material spend
```

## Brand search

Mål separat:

- branded paid clicks
- organic substitution
- competitor pressure
- incremental lift

Undgå at antage at høj ROAS = høj incrementality [A06].

---

# Measurement for Paid Social

## Channel job

- discovery
- demand creation
- retargeting
- direct response

## Native telemetry

- reach
- impressions
- frequency
- video/engagement
- clicks
- platform-attributed conversions

## Business layer

- incremental new customers
- qualified leads
- contribution
- downstream retention

## Risks

- view-through over-credit
- retargeting selection
- cross-device attribution
- platform self-reporting overlap

## Gold standard

- separate click vs view credit
- backend reconciliation
- lift/holdout for material spend
- calibration multiplier only with documented test scope

Meta's current training explicitly separates observational measurement, A/B testing and randomized lift [M01][M02].

---

# Measurement for Paid Video / Display / Programmatic

## Native metrics

- served impressions
- valid/IVT-filtered impressions where available
- reach/frequency
- viewability/audibility where relevant
- views/completed views
- watch time/attention signals
- clicks
- view-/engaged-view conversions

## Primary mistake

At sammenblande **delivery quality**, **attention** og **effectiveness**.

Det korrekte hierarchy er:

```text
valid delivery
→ opportunity to see/hear
→ attention/engagement
→ brand/behavior response
→ incremental business outcome
```

MRC's standards gør data quality/invalid traffic og attention til eksplicitte measurement-problemer [MRC01][MRC02].

## Better framework

Brug depending on objective:

- valid reach/frequency
- brand lift
- search lift
- conversion lift
- geo tests
- calibrated MMM

**Regel:** Viewability/attention må ikke relabeles som sales impact. De kan være useful leading indicators, når relationen til downstream outcomes er valideret.

---

# Measurement for Paid AI / Conversational Ads

Paid conversational AI er en ny surface, ikke en ny measurement-fysik.

ChatGPT Ads' aktuelle reporting omfatter impressions, clicks, spend, CTR, CPC, CPM og conversions. Conversion measurement kan modtage events via Pixel, Conversions API eller begge og matcher eligible ad clicks inden for platformens attribution logic [O01][O03].

## Measurement model

```text
conversation-context exposure
→ sponsored impression
→ click / sponsored interaction
→ destination / product interaction
→ conversion
→ qualified customer value
→ causal calibration
```

## Golden standard

- brug static UTMs/source IDs til independent analytics hvor muligt
- reconcile platform-attributed conversions mod backend
- klassificér vendor attribution window/matching som implementation layer
- mål new-customer quality og contribution
- test incrementality når channel bliver material
- mål overlap med paid/organic search, direct og other discovery channels

**Regel:** Paid AI bliver en permanent media-category. Den konkrete provider, auction, attribution window og report fields er volatile.

---

# Measurement for Organic Search / SEO

## Native source

Search Console viser bl.a.:

- impressions
- clicks
- CTR
- average position
- query/page/device/country dimensions [G10]

## Limitation

Search Console data har privacy/truncation/aggregation limits; anonymized rare queries kan mangle i tables [G11].

## Measurement ladder

### Visibility
- impressions
- query/category coverage
- AI/search feature exposure

### Response
- clicks
- CTR
- landing sessions

### Quality
- engaged visits
- qualified actions

### Business
- leads
- customers
- revenue
- contribution

### Strategic
- branded vs non-branded growth
- topic/category penetration
- assisted demand

## Position

Average position er diagnostic, ikke business outcome. Google anbefaler selv at fokusere på impressions/click trends frem for position alene i mange analyses [G10].

## SEO causality

SEO er svært at randomisere direkte.

Brug:
- page/template experiments
- phased rollouts
- matched controls
- interrupted time series med forsigtighed
- branded/non-branded decomposition

Undgå at kalde al organic revenue “SEO-created revenue”.

---

# Measurement for AI Discovery / Answer Engines

AI discovery omfatter organiske exposures/referrals fra generative answer systems og AI-assisted search/discovery.

GA4 klassificerer nu traffic fra kilder som ChatGPT, Gemini, Deepseek, Copilot og Grok som `AI Assistant`; Google AI Overviews/AI Mode er eksplicit ikke i den channel, men hører under Google's search surfaces [G03]. Search Console har pr. 31. august 2026 særskilt generative-AI performance reporting for Search [G12].

## Metrics

### Provider-observed exposure
- impressions/citations where legitimately provided
- page/brand inclusion
- country/device where supported

### Referral
- AI Assistant sessions
- landing pages
- source/provider
- UTM-tagged paid vs organic separation

### Engagement/business
- qualified actions
- leads/customers
- revenue/contribution
- retention/LTV

### Assisted demand
- branded search movement
- direct movement with caution
- self-reported discovery
- CRM source notes

## Critical V2 caveat: AI visibility panels are samples, not censuses

Third-party “AI share of voice” tools kan være nyttige, men resultater afhænger af:

- prompt set
- locale
- model/version
- personalization/context
- sampling time
- query repetition
- citation extraction method

IAB bemærker i 2026, at AI visibility vendors bruger forskellige methodologies og kan returnere forskellige answers for samme brand [IAB03].

Derfor skal et AI visibility program logge:

```yaml
provider/model:
prompt_universe_definition:
sampled_prompts:
locale:
run_count:
date/time:
personalization_state:
metric_definition:
coverage_limitations:
```

## Golden rule

```text
provider exposure telemetry
+ independent referral analytics
+ demand proxies
+ customer self-report
+ business outcomes
+ causal testing where feasible
```

Ingen enkelt source repræsenterer hele AI-discovery effect.

---

# Measurement for Organic Social

## Native telemetry

Platforme rapporterer typisk:

- impressions/reach
- followers
- profile visits
- reactions/comments/shares/saves
- clicks
- video views/watch time

LinkedIn beskriver fx impressions og members reached som estimates og giver engagement/click metrics [S01]. YouTube skelner mellem impressions, CTR, views, unique viewers og watch time [S02].

## Measurement ladder

```text
OUTPUT
posts/videos published
        ↓
DISTRIBUTION
impressions / reach
        ↓
ATTENTION
watch time / dwell / stayed-to-watch
        ↓
ENGAGEMENT
saves / shares / comments / follows
        ↓
ACTION
site visit / signup / inquiry
        ↓
BUSINESS
qualified lead / customer / retained value
```

## Golden rule

Engagement er ikke outcome medmindre engagement i sig selv er objective eller valideret leading indicator.

## Organic social attribution

Mange social interactions giver ikke et clean referral click.

Suppler derfor med:

- UTMs på outbound links
- profile/link analytics
- branded search/direct movement
- CRM/self-reported source
- campaign-specific landing pages

---

# Measurement for Email / CRM / Lifecycle

## Measurement stack

### Delivery health
- sent
- accepted/delivered where provider can observe it
- bounce
- spam complaints
- domain/IP reputation
- authentication
- unsubscribe

Gmail Postmaster Tools rapporterer bl.a. spam rate, reputation, authentication og delivery errors [E03]. “Delivered” er ikke nødvendigvis det samme som seen/read/inboxed placement.

### Human engagement — noisy
- human-filtered clicks where available
- replies
- site sessions

### Business
- conversion
- revenue/contribution
- repeat purchase
- activation
- retention/churn

### Causal lifecycle value
- incremental conversion
- incremental revenue/contribution
- incremental retention

## Open rate og click rate

Apple Mail Privacy Protection kan hente remote content i baggrunden [E01]. Security systems/link scanners kan desuden auto-open og auto-click; Mailchimp dokumenterer eksplicit bot inflation af både opens og clicks og tilbyder bot filtering [E02].

**V2-regel:**

```text
open = weak diagnostic
click = stronger, but still potentially bot-contaminated
qualified onsite action = stronger business evidence
randomized lifecycle holdout = causal evidence
```

## Lifecycle incrementality

Owned audiences er ofte high-intent/existing customers. Attributed revenue kan derfor være stærkt inflated af baseline purchase probability.

Ved material flows:

- hold out a persistent control where commercially acceptable
- measure downstream contribution/retention
- segment new vs existing/reactivated
- account for unsubscribe/complaint harms
- test cadence/frequency, not just message creative

---

# Measurement for SMS / Push

## Metrics

- delivered
- click/open where technically reliable
- opt-out
- conversion
- incremental revenue
- retention

## Risk

High-intent owned audiences kan skabe inflated attributed performance, fordi modtagerne allerede er kunder/subscribers.

Gold standard:

- holdout en andel af audience ved material campaigns
- measure incremental purchase/retention
- segment new vs existing

---

# Measurement for Affiliate / Referral / Partnerships

## Native tracking

- referral ID
- affiliate link
- coupon code
- partner ID
- commission

## Primary risks

- coupon hijacking
- last-click capture af demand skabt elsewhere
- self-referrals/fraud
- partner claiming existing demand

## Metrics

- approved conversions
- net revenue
- new-customer share
- contribution after commission
- refund/cancel
- incremental lift

## Gold standard

```text
tracked sales
− invalid/fraud/refunds
− existing-demand substitution estimate
= economically meaningful partner value
```

Test med:
- holdout geos/audiences
- exclusive partner windows
- incrementality experiments hvor volumen tillader det

---

# Measurement for Creators / Influencers

Creators kan være både:

- paid media
- partnership
- organic distribution
- affiliate channel
- brand/demand creator

Derfor skal measurement skelne:

```text
CONTENT EFFECT
MEDIA DISTRIBUTION EFFECT
CREATOR AUDIENCE EFFECT
DIRECT RESPONSE EFFECT
```

## Data

- creator content reach
- watch time/engagement
- unique link/code
- paid amplification metrics
- downstream customer quality
- brand/search lift

## Anti-pattern

At kalde `earned media value` eller estimeret impression-value for ROI.

---

# Measurement for PR / Earned Media

AMEC's current Barcelona Principles kræver outcome/impact-orienteret, holistic online/offline measurement og afviser AVE som værdi [PR01].

## Measurement chain

### Outputs
- coverage
- placements
- distribution

### Out-takes
- attention
- awareness
- understanding
- engagement

### Outcomes
- trust
- preference
- intent
- advocacy

### Impact
- demand
- sales
- reputation
- organizational outcome

## Forbidden shortcut

```text
coverage × advertising rate = PR value
```

AMEC afviser AVE og varianter som EMV/PR value som valid value metric [PR03].

## Better measurement

- media quality/relevance
- message pull-through
- share of relevant coverage
- branded search
- direct/AI/referral demand
- survey-based awareness/trust
- geo/time experiments hvor muligt

---

# Measurement for Offline / Events / Sponsorship

## Trackable artifacts

- QR/URLs
- unique codes
- registration IDs
- CRM source
- point-of-sale geography/time

## Stronger designs

- geo holdouts
- staggered rollout
- matched markets
- before/after with controls

## Avoid

- “footfall rose after event, therefore event caused it” uden control.

---

# Channel comparison framework

| Channel | Native telemetry | Main attribution risk | Stronger validation |
|---|---|---|---|
| Paid Search | query/click/conversion | intent selection | brand/nonbrand holdout, geo, lift |
| Paid Social | reach/click/view/conversion | view-through + retargeting selection | conversion lift / holdout |
| Paid Video/Display | reach/views/VTC | low click observability + VTC bias | brand/search/conversion lift |
| Paid AI | impressions/clicks/conversions | emerging attribution + overlap | holdout/geo as scale grows |
| Organic Search | impressions/clicks/position | self-selection + brand demand | controlled SEO rollout / matched pages |
| AI Discovery | AI impressions/referrals | incomplete referrals | first-party + survey + branded demand |
| Organic Social | reach/engagement/clicks | dark social + vanity metrics | link tracking + demand/outcome triangulation |
| Email/CRM | delivery/click/revenue | existing-customer selection | audience holdout |
| Affiliate | tracked sale | last-click capture | new-customer + holdout |
| PR/Earned | coverage/reach | outputs ≠ outcomes | surveys, search lift, geo/time designs |

---

# Brand measurement inside a performance system

Denne playbook erstatter ikke den kommende Brand & Positioning playbook. Den definerer kun measurement-laget.

## Brand metrics

- awareness
- recall
- consideration
- preference
- intent
- trust
- branded search
- direct demand
- share of search where valid

## Stronger measurement

- pre/post survey with control
- Brand Lift
- Search Lift
- geo-experiment
- longitudinal tracking

Google's lift framework understøtter Brand Lift og Search Lift ved siden af Conversion Lift [G06].

## Golden rule

Brand outcomes kan være reelle outcomes, selv når purchase ikke sker i samme session.

Men:

- awareness ≠ sales
- search lift ≠ profit
- brand metrics skal knyttes til strategic objective

---

# Customer journey measurement

En kunderejse kan se sådan ud:

```text
Organic Social
→ AI Assistant
→ Paid Search
→ Email
→ Direct
→ Purchase
```

Der findes ikke én “objektiv” korrekt kreditfordeling i pathen uden counterfactual information.

Brug path data til at forstå:

- sequence
- delays
- common assists
- handoffs

Brug experiments til causal effect.

---

# User, session og event scope

GA4 skelner mellem first-user, session og event-level traffic-source scopes [G04]. Dette illustrerer en generel measurement-regel:

- **Acquisition source:** hvor kom kunden oprindeligt fra?
- **Session source:** hvad startede dette besøg?
- **Conversion attribution:** hvilke touchpoints får conversion credit?

De er tre forskellige spørgsmål.

Dashboardet skal mærke scope eksplicit.

---

# New vs existing customers

Alle acquisition kanaler bør, hvor muligt, kunne rapportere:

- new customers
- existing customers
- reactivated customers

Hvorfor:

```text
ROAS 8.0
```

kan være mindre attraktivt, hvis næsten al revenue kommer fra kunder, der ville have købt alligevel.

## Customer-state hierarchy

```text
new
reactivated
retained
repeat
cross-sell
upsell
```

Mål separat, fordi causal baselines er forskellige.

---

# Lead generation measurement

Raw CPL er utilstrækkelig.

```text
Lead
→ Valid
→ Contacted
→ Qualified
→ Meeting
→ Show
→ Opportunity
→ Won
→ Collected Revenue
→ Contribution
```

## Golden KPI hierarchy

- cost per qualified lead
- cost per opportunity
- pipeline per spend
- CAC
- contribution

Platforme som Microsoft understøtter offline conversion import og server-side conversion APIs, hvilket illustrerer den generelle best practice om at sende downstream commercial signals tilbage til media systems [MS01][MS02].

---

# E-commerce measurement

## Required business dimensions

- order ID
- gross revenue
- discounts
- tax/shipping treatment
- net revenue
- COGS/margin
- refunds
- new/existing

## KPI hierarchy

```text
incremental contribution profit
→ new customer CAC
→ net revenue
→ purchase CVR
→ traffic diagnostics
```

## Common failure

ROAS beregnet på gross revenue uden refunds/margin.

---

# Subscription / SaaS measurement

## Funnel

```text
visit
→ signup
→ activation
→ trial
→ paid
→ retained
→ expansion
```

## Primary economics

- activation rate
- trial-to-paid
- CAC
- payback
- gross retention
- net revenue retention
- churn
- cohort LTV

Mål acquisition sources på retained value, ikke kun signup CPA.

---

# App / Product-led measurement

Install er sjældent endemålet.

```text
install
→ activation
→ core action
→ retained active user
→ payer
→ retained payer
```

Vurdér marketing på downstream product value.

---

# Local business measurement

## Outcomes

- qualified calls
- bookings
- show rate
- in-store transaction
- gross margin

## Sources

- call tracking hvor lovligt
- booking IDs
- POS integration
- geo experiments

Undgå at bruge direction clicks/calls som business outcome uden quality layer.

---

# Data quality framework

MRC's outcome standards understreger, at data coverage, integration, matching og validation skal disclosed; data availability kan i sig selv bias attribution mod de channels man kan se bedst [MRC01].

## Completeness

Får vi events fra alle relevante surfaces/populations?

Rapportér:
- observable traffic share
- consented share where meaningful
- channel coverage
- offline coverage
- match rate

## Accuracy

Matcher events real-world outcomes?

- order/value reconciliation
- CRM state validation
- currency/tax/refund rules
- timestamp/timezone

## Uniqueness

Er duplicates kontrolleret?

- order ID
- lead ID
- event ID
- browser/server deduplication

## Timeliness

Er data frisk nok til decision cadence?

- ingestion delay
- attribution delay
- offline import delay
- model refresh lag

## Consistency

Er definitions ens på tværs af systems?

- conversion definition
- customer definition
- revenue basis
- attribution window
- timezone

## Lineage

Ved vi hvor metric kommer fra og hvilke transformations den har været igennem?

## Validity / media quality

For paid media hvor relevant:
- invalid traffic filtration
- viewability/audibility definition
- bot/non-human activity
- duplicate impressions/clicks

## Identity quality

- deterministic/probabilistic
- match rate
- false match risk
- cross-device validation
- model recency

## Privacy status

- lawful basis/consent state
- minimization
- retention
- processing purpose

## Provenance metadata

Hver executive metric bør, direkte eller indirekte, kunne spores til:

```yaml
source_system:
source_metric:
extraction_time:
transformation_version:
identity_method:
observed_or_modeled:
coverage:
known_incident:
owner:
```

---

# Measurement incident protocol

Measurement incidents skal prioriteres over marketing optimization.

## Severity

### P0 — Commercial corruption

- duplicate orders
- wrong revenue values
- mass missing conversions

### P1 — Attribution/tracking outage

- campaign IDs stripped
- pixel/server failure
- consent integration broken

### P2 — Partial degradation

- one channel missing
- delayed import

## Response

```text
DETECT
→ FREEZE interpretation
→ IDENTIFY affected window
→ FIX collection
→ BACKFILL if valid
→ LABEL affected reports
→ RECONCILE
→ resume optimization
```

Never optimize a campaign based on known-corrupt measurement.

---

# Modeled data

Privacy og technical gaps betyder, at platforms kan modelere missing outcomes.

GA4 dokumenterer både modeled key events og behavioral modeling ved consent gaps [G08][G09].

## Rules

- modeled ≠ observed
- report data quality/modeling state
- do not mix modeled and observed without disclosure
- validate directionally against backend totals
- do not assume model can recover every missing segment

---

# Privacy-by-design measurement

Privacy er en design constraint, ikke en bug der skal omgås.

I DK/EU beskriver Datatilsynet cookies/pixel-lignende technologies til bl.a. statistik/marketing som omfattet af cookie-/databeskyttelsesregler, hvor ikke-nødvendig terminal tracking som udgangspunkt kræver gyldigt samtykke. EDPB's final Guidelines 2/2023 præciserer det tekniske scope af ePrivacy art. 5(3) og omfatter bredere access/storage mechanisms end klassiske cookies [L01][L02][L04].

Dette er operational design guidance, ikke juridisk rådgivning; konkrete implementations skal live-checkes.

## Operational principles

- data minimization
- purpose limitation
- consent state capture
- retention limits
- least-privilege access
- no unnecessary PII in marketing marts
- hashing ≠ automatic lawful basis
- server-side ≠ automatic consent exemption
- clean room ≠ automatic legal permission
- vendor/controller/processor roles documented

## Consent-aware reporting

Rapportér hvor relevant:

- consent/observable share
- modeled share
- unmatched share
- regional/platform differences

Et fald i observable conversions efter privacy change er ikke automatisk et fald i business outcomes.

---

# Measurement under signal loss

Når user-level identity bliver svagere:

Prioritér:

1. clean first-party commercial data
2. stable campaign/source taxonomy
3. server/CRM feedback where lawful
4. aggregate experiments
5. MMM
6. surveys/self-report som triangulation

Ikke:

- fingerprinting workaround
- fake precision
- aggressive identity stitching uden lawful basis

---

# Self-reported attribution

Spørgsmålet:

> “Hvordan hørte du om os?”

kan være værdifuldt som et ekstra lag.

Styrker:
- dark social
- podcast/PR/AI discovery
- offline word-of-mouth

Svagheder:
- recall bias
- salience bias
- multiple-touch simplification

Brug som triangulation, ikke sole truth.

---

# Surveys og brand/demand measurement

Brug surveys når desired outcome er mental/attitudinal:

- unaided/aided awareness
- consideration
- preference
- trust
- message association
- intent, med caution som behavioral proxy

## Survey gold standard

- define population before sample
- representative/probability sampling where feasible
- consistent neutral wording
- randomize treatment/control for brand lift where platform/design allows
- report response rate and weighting
- balance sample composition
- confidence intervals / design effects
- pre-register primary brand metric where feasible
- distinguish measured attitude from actual purchase behavior

En pre/post survey uden credible control kan være confounded af seasonality, PR, competitor activity og composition changes.

Branded search, direct traffic og social mentions kan triangulere demand, men er ikke alene brand lift.

---

# Reporting architecture

Et executive measurement-system skal adskille **observed**, **attributed**, **modeled** og **causal** evidence visuelt og semantisk.

Executive view:

```text
1. BUSINESS OUTCOME — what happened?
2. MARKETING INPUT — what changed?
3. OBSERVED DELIVERY — what was delivered/seen/clicked?
4. ATTRIBUTED VIEW — who gets credit under one model?
5. CAUSAL VIEW — what has experimental support?
6. MARGINAL VIEW — what does next-budget evidence suggest?
7. DATA QUALITY — coverage, identity, modelled share, incidents?
8. DECISION — scale / reduce / test / no-op?
```

## Decision packet metadata

Hver central recommendation bør vise:

- primary business metric
- data window
- source of truth
- attributed model/window
- latest causal calibration date
- coverage/match/modeling state
- confidence/uncertainty
- material assumptions
- decision owner

## Do not build the executive layer by platform tabs

Dårlig struktur:

```text
Meta dashboard
Google dashboard
LinkedIn dashboard
Email dashboard
```

Bedre struktur:

```text
Business outcomes
Demand / acquisition / lifecycle
Media delivery quality
Cross-channel attributed view
Causal evidence
Marginal allocation
Data quality / uncertainty
Decisions
```

Platform drill-down kommer bagefter.

---

# KPI hierarchy

## Tier 1 — Business outcome

- incremental contribution where measured
- realized net revenue
- new customers
- retained customer value
- qualified/won pipeline

## Tier 2 — Unit economics

- CAC / incremental CAC
- payback
- contribution ROAS/POAS
- mContributionROI

## Tier 3 — Conversion/funnel

- CVR
- activation
- qualification
- close rate
- retention/churn

## Tier 4 — Distribution / media quality

- valid impressions
- reach/frequency
- viewability/audibility
- clicks/sessions
- organic/search visibility

## Tier 5 — Attention / engagement diagnostics

- attention signal
- watch time
- CTR
- saves/shares/comments
- open/click rate

**Regel:** Et lavere tier må ikke overrule højere-tier evidence uden en dokumenteret predictive/causal chain.

---

# Metric dictionary

Hver metric skal have:

```yaml
metric_id:
name:
question_answered:
definition:
formula:
source_system:
scope: user|session|event|customer|geo|period
population:
attribution_model:
lookback_window:
observed_attributed_modeled_or_incremental:
identity_method:
coverage:
uncertainty:
owner:
freshness:
known_limits:
decision_use:
```

Hvis to teams bruger “CAC” med forskellig numerator/denominator, har organisationen ikke én CAC.

---

# Measurement maturity ladder

## Level 0 — Dashboard chaos

- platform metrics
- inconsistent UTMs
- no reconciliation

## Level 1 — Clean telemetry

- event QA
- canonical channel taxonomy
- backend reconciliation

## Level 2 — Customer-quality measurement

- new/existing
- CRM stages
- margin
- retention

## Level 3 — Causal experiments

- holdouts
- lift
- geo

## Level 4 — Calibrated modeling

- MMM calibrated to experiments
- response curves

## Level 5 — Marginal decision system

- mROI
- uncertainty-aware allocation
- systematic test backlog

---

# Measurement cadence

## Near-real-time

Kun:
- tracking outage
- spend anomaly
- commercial system failure

## Daily

- data freshness
- spend vs plan
- backend conversions
- material anomalies

## Weekly

- channel economics
- new/existing mix
- lead/customer quality
- attribution discrepancies
- experiment status

## Monthly

- cohort performance
- business economics
- source taxonomy QA
- budget response

## Quarterly

- causal calibration
- MMM refresh where applicable
- stale assumptions
- measurement architecture audit
- privacy/policy audit

---

# Experiment backlog

Prioritér efter Expected Value of Information:

```text
EVI ≈ decision_size × uncertainty × plausible_performance_spread / experiment_cost
```

Eksempler på høj EVI:

- Er brand search incremental?
- Hvor meget retargeting ville ske alligevel?
- Skaber paid social new customers eller existing-customer harvest?
- Hvilken kanal bør næste 500k flyttes til?

Lav EVI:

- micro attribution model debate på 2% af budgettet uden decision consequence.

---

# Attribution model comparison protocol

Når modeller sammenlignes:

1. Hold conversion definition konstant.
2. Hold lookback window konstant hvis muligt.
3. Dokumentér direct treatment.
4. Sammenlign credit distribution.
5. Sammenlign mod causal experiments hvor de findes.
6. Vælg model for operational usefulness, ikke fordi den “ser rigtig ud”.

---

# Calibration workflow

```text
1. Define experiment estimand + counterfactual
2. Run experiment and estimate effect + uncertainty
3. Record treatment/control spend and population
4. Verify model/attribution scope uses a compatible estimand
5. Compare attributed/modelled effect for the same scope/window
6. Estimate calibration relationship without discarding experiment uncertainty
7. Apply only to sufficiently similar campaigns/markets/spend regimes
8. Store scope, recency, assumptions and expiry
9. Re-test when market/channel/spend/creative regime changes
```

Meta lærer eksplicit calibration multiplier via channel Conversion Lift [M02]. Meridian anbefaler tilsvarende experiment-calibrated priors, men gør samtidig opmærksom på estimand mismatch mellem fx marginal experiments og zero-spend MMM counterfactuals [MM02][MM05].

---

# Learning object

```yaml
learning_id:
question:
estimand:
channel:
market:
period:
population:
treatment:
counterfactual:
spend_treatment:
spend_control:
observed_metric:
attributed_metric:
causal_estimate:
uncertainty:
method:
concurrent_environment:
valid_for:
invalid_outside:
created_at:
review_at:
```

Eksempel:

> “DK branded paid search havde 14% incremental order lift i geo-holdout under høj competitor pressure; attributed conversions overvurderede incremental orders med 2.1x i testperioden. Generaliser ikke uden ny test til low-competition markets.”

---

# Knowledge decay

Measurement learnings bliver stale når:

- channel algorithm changes
- consent environment changes
- brand strength changes
- competitor intensity changes
- customer mix changes
- attribution model changes
- pricing/offer changes

Alle calibration learnings får review date.

---

# Contradiction ledger

## “GA4 er sandheden”
**Status:** Forkert. GA4 er analytics/attribution med collection, scope, identity og modeling constraints. Commercial truth reconciles mod backend.

## “Platform ROAS viser kanalens reelle effekt”
**Status:** Forkert som causal statement. Platform ROAS er attributed efficiency under platform rules.

## “Data-driven attribution er enten ren correlation eller fuld incrementality”
**Status:** Begge yderpunkter er forkerte. Googles current DDA bruger counterfactual/RCT-trained components for Google ad exposure, men outputtet er stadig fractional attribution credit, ikke et campaign-specific lift study for alle channels [G01].

## “Last click er altid forkert”
**Status:** For kategorisk. Det er transparent operational credit, men har predictable bias mod closers/high intent.

## “Et exposed-vs-unexposed split er et experiment”
**Status:** Forkert. Actual exposure er ofte endogenous. Random assignment/credible counterfactual er det centrale.

## “Et lift test fortæller automatisk hvor meget vi skal spend”
**Status:** Forkert. Et single-cell experiment måler effect ved det testede treatment. Marginal spend kræver intensive-margin evidence [A09].

## “iROAS divideres altid med total spend”
**Status:** Forkert. Ved non-zero control skal denominator matche incremental spend (`Δ spend`) for en marginal contrast [MM05].

## “MMM er sandheden fordi det bruger hele business data”
**Status:** Forkert. MMM er model-based identification med specification, collinearity og extrapolation risk.

## “En MMM response curve er observeret virkelighed”
**Status:** Forkert. Curven er en model under chosen adstock/saturation assumptions og bør kalibreres/sensitivity-testes [MR02].

## “RCT er altid muligt og altid præcist”
**Status:** Forkert. Experiments kan være underpowered, contaminated, have noncompliance eller være expensive [A03].

## “Mere user-level data løser measurement”
**Status:** Forkert. Design kan være vigtigere end mere covariate data; large field research har demonstreret dette [A05].

## “Clean room = source of truth”
**Status:** Forkert. Clean rooms forbedrer privacy-safe matching/analysis; de identificerer ikke automatisk causality.

## “Reach kan summeres på tværs af platforms”
**Status:** Forkert. Cross-media reach kræver deduplication/identity methodology [WFA01].

## “Viewability = attention”
**Status:** Forkert. Viewability er opportunity-to-see; attention kræver særskilt measure/model.

## “Attention = sales”
**Status:** Forkert uden valideret relation til downstream outcome.

## “Non-significant = no effect”
**Status:** Forkert. Det kan være low power/high variance.

## “Significant = profitable”
**Status:** Forkert. Statistical og economic materiality er forskellige tests.

## “Ét lift-resultat kalibrerer alle fremtidige perioder”
**Status:** Forkert. Effects kan drifte med spend, competition, creative og market regime [A08].

## “Organic traffic er gratis”
**Status:** Forkert økonomisk. Organic har people/content/tooling/opportunity cost.

## “Engagement rate viser content value”
**Status:** Kun hvis engagement er objective eller valideret leading indicator.

## “Email opens/clicks er rent menneskelig adfærd”
**Status:** Forkert. Privacy prefetching og security bots kan inflate begge [E01][E02].

## “Direct traffic er brand”
**Status:** Forkert. Direct er mixed residual [G07].

## “PR value = advertising equivalent”
**Status:** Afvist af AMEC/Barcelona standards [PR01][PR03].

## “AI referral traffic viser hele AI-discovery impact”
**Status:** Forkert. Exposure uden click, later search/direct og provider reporting gaps betyder, at referrals kun er ét lag.

---

# Anti-playbook: practices der aktivt skal undgås

1. Summe platform-attributed conversions/revenue som unikke outcomes.
2. Kalde platform ROAS incremental ROI.
3. Starte measurement med dashboard fields før business question/estimand.
4. Sammenligne actual exposed vs non-exposed og kalde det randomized lift.
5. Bruge total spend som denominator i et marginal experiment med non-zero control.
6. Optimere raw leads uden qualification/downstream value.
7. Blande new/existing/reactivated customers i acquisition economics.
8. Kalde engagement business value uden validation.
9. Bruge email opens som primary lifecycle KPI.
10. Ignorere bot clicks i email/security-scanned environments.
11. Behandle direct som rent brand.
12. Skifte UTM/channel taxonomy uden versioning.
13. Bruge mutable campaign names som eneste key.
14. Ignorere refunds/cancellations/margin.
15. Lade modeled data fremstå som observed.
16. Lade attributed data fremstå som causal.
17. Skjule missing coverage med interpolation uden label.
18. Sammenligne attribution models med forskellige windows/populations som om de er samme metric.
19. Kalde correlation causal learning.
20. Stoppe experiments tidligt fordi result ser ønsket ud.
21. Tolke non-significant som zero effect.
22. Ignorere sample-ratio mismatch/attrition.
23. Ignorere spillover/contamination/interference.
24. Køre mange primary outcomes uden multiple-testing discipline.
25. Kalibrere MMM med experiment der måler et andet estimand uden adjustment/disclosure.
26. Bruge MMM uden model diagnostics/sensitivity/calibration.
27. Tage response curves langt uden for observed spend range uden uncertainty.
28. Implementere allocator output som facit uden bounded test.
29. Allokere budget efter average ROAS alene.
30. Summe platform reach for at få “total reach”.
31. Behandle viewability som attention.
32. Behandle attention som profit.
33. Bruge weak identity matching som perfekt cross-device truth.
34. Antage clean room output er causal.
35. Bruge AVE/EMV som PR ROI.
36. Rapportere SEO rank uden demand/business context.
37. Sammenligne platform reach/view definitions uden normalization/disclosure.
38. Overcollecte PII “for measurement”.
39. Omgå consent gennem fingerprinting eller anden hidden identity reconstruction.
40. Antage server-side collection automatisk løser lawful basis.
41. Optimere under material tracking/data incident.
42. Have metrics uden owner/definition/source/scope.
43. Have dashboard uden decision owner.
44. Rapportere point estimates uden uncertainty når uncertainty er material.
45. Tro at “mere data” automatisk reducerer bias.
46. Generalisere ét lift study til andre markets/spend levels uden scope note.
47. Bruge third-party AI visibility score uden prompt/model/sampling methodology.
48. Glemme invalid traffic/media-quality layer i programmatic/video.
49. Køre measurement-calibration én gang og aldrig revalidate.
50. Måle alt, fordi det kan måles, frem for fordi det kan ændre en beslutning.

---

# Operating templates

## Measurement plan

```yaml
business_objective:
decision_question:
estimand:
primary_business_outcome:
commercial_source_of_truth:
customer_definition:
channel_categories:
tracking_plan:
identity_and_coverage_plan:
source_taxonomy:
attribution_reporting:
causal_measurement_plan:
mmm_plan:
privacy_basis:
reporting_cadence:
open_uncertainties:
```

## Channel scorecard

```yaml
channel:
period:
spend:
owned_cost:
native_telemetry:
analytics_sessions:
attributed_conversions:
backend_conversions:
new_customers:
contribution:
causal_calibration:
calibration_date:
observable_coverage:
modeled_share:
marginal_estimate:
uncertainty:
confidence:
decision:
```

## Experiment card

```yaml
experiment_id:
decision_question:
estimand:
population:
treatment:
control_or_counterfactual:
randomization_unit:
primary_outcome:
secondary_guardrails:
MDE:
power:
window:
spend_treatment:
spend_control:
assignment_integrity:
contamination_risk:
spillover_risk:
concurrent_campaigns:
result:
interval:
economic_value:
external_validity_notes:
decision:
```

## Measurement incident

```yaml
incident_id:
started_at:
detected_at:
affected_sources:
affected_metrics:
root_cause:
orders_impacted:
backfill_possible:
reporting_label:
resolved_at:
prevention:
```

## Attribution discrepancy record

```yaml
period:
backend_total:
analytics_total:
platform_claims:
  google:
  meta:
  microsoft:
  openai:
  affiliate:
known_differences:
unexplained_gap:
confidence:
```

---

# Diagnostic decision tree

## “Revenue faldt 20%”

### 1. Commercial truth
- er finance/order data komplet?
- refunds/cancellations?

### 2. Demand
- traffic/reach/search visibility?

### 3. Conversion
- site/product CVR?

### 4. Mix
- new/existing?
- channel mix?

### 5. Measurement
- tracking gap?
- consent change?
- attribution lag?

### 6. Causal confidence
- er observed change faktisk marketing-caused?

---

# Executive reporting one-page

```text
BUSINESS
Net Revenue / Contribution / New customers / Retention / Pipeline

MARKETING INPUTS
Spend / content / lifecycle sends / major launches / pricing-promos

DELIVERY + QUALITY
Valid reach / clicks / traffic / visibility / media-quality incidents

ATTRIBUTED VIEW
Cross-channel credit under one documented model + window

CAUSAL VIEW
Latest validated lift / geo / experiment effects + intervals

MARGINAL VIEW
Expected next-budget contribution + uncertainty

DATA QUALITY
Tracking health / observable share / identity match / modeled share / incidents

DECISIONS
Scale / reduce / test / no-op + owner
```

---

# Volatile implementation registry

Følgende skal live-checkes før implementation og må ikke hardcodes som evergreen rules:

- GA4 default/custom channel definitions, inkl. AI Assistant
- GA4 attribution-model availability/method details
- GA4 cross-channel budgeting / modeled incremental features
- GA4 modeling eligibility and thresholds
- Search Console generative-AI reporting fields/availability
- Google/Meta/Microsoft/OpenAI attribution windows
- Google/Meta lift-study eligibility and implementation
- platform conversion definitions
- view-through / engaged-view rules
- ChatGPT Ads markets, auction, Pixel/CAPI fields and reporting
- platform API schemas
- reach/viewability/attention definitions
- MRC/IAB/WFA current standard versions
- cross-media identity framework implementations
- email client privacy/security behaviors
- browser tracking restrictions
- consent-mode/vendor modeling details
- legal/regulatory guidance and consent requirements

**Rule:** hver volatile fact får `checked_at`, `source`, `valid_for` og `recheck_trigger` i implementation documentation.

---

# Research backlog: spørgsmål ingen offentlig playbook kan løse universelt

1. Hvad er vores true incremental CAC pr. channel?
2. Hvor meget af brand search ville ske organisk?
3. Hvor meget retargeting er substitution vs lift?
4. Hvor meget direct er genuine direct vs lost attribution?
5. Hvor stor del af AI discovery ender i later branded search/direct?
6. Hvad er vores email incremental revenue vs purchases that would happen anyway?
7. Hvilke organic content metrics predicter downstream demand hos os?
8. Hvor hurtigt saturerer hver channel?
9. Hvad er vores mROI ved nuværende spend?
10. Hvor ofte skal calibration re-runs?
11. Hvilke customer cohorts har størst incremental LTV?
12. Hvilke platform models over/under-credit vores outcomes?

---

# Research evidence map

## Google / Analytics / Search / Ads

### G01 — GA4 Attribution
**Source:** Google Analytics Help, “Get started with attribution.”  
**URL:** https://support.google.com/analytics/answer/10596866  
**Evidence:** `PLATFORM_MECHANIC / METHOD_DESCRIPTION`  
**Finding:** Attribution assigns credit to touchpoints; current GA4 supports data-driven and last-click variants. DDA uses converting/non-converting path data, counterfactual probability models and, for Google ad exposures, Google states it can train on randomized holdback evidence.  
**Limitation:** The output remains attribution credit and is not equivalent to a contemporaneous randomized incrementality estimate for every channel/touchpoint.

### G02 — Attribution paths
**Source:** Google Analytics Help, “Key events attribution paths report.”  
**URL:** https://support.google.com/analytics/answer/10595568  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Paths can include multiple channel touchpoints and report days/touchpoints to conversion.  
**Use:** Journey diagnostics, not causal proof.

### G03 — Default channel group
**Source:** Google Analytics Help, “Default channel group.”  
**URL:** https://support.google.com/analytics/answer/9756891  
**Evidence:** `PLATFORM_MECHANIC / TAXONOMY`  
**Finding:** GA4 classifies Paid/Organic Search, Paid/Organic Social, Email, Affiliates, Referral, Audio, SMS, Push and AI Assistant among channels.  
**Limitation:** Definitions are vendor-maintained and can evolve.

### G04 — Traffic-source dimensions and scopes
**Sources:** Google Analytics Help, Traffic-source dimensions; Scopes of traffic-source dimensions.  
**URLs:**  
https://support.google.com/analytics/answer/15567068  
https://support.google.com/analytics/answer/11080067  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Source/medium/campaign are core acquisition dimensions; first-user, session and event scopes represent different questions.

### G05 — Campaign data / UTMs
**Source:** Google Analytics Help, “Import campaign data.”  
**URL:** https://support.google.com/analytics/answer/10071305  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Google recommends `utm_id`, `utm_source`, `utm_medium`, `utm_campaign` for manual campaign data alignment.

### G06 — Lift studies / Conversion Lift
**Sources:** Google Ads Help, About Conversion Lift; About lift studies.  
**URLs:**  
https://support.google.com/google-ads/answer/12003020  
https://support.google.com/google-ads/answer/16104408  
**Evidence:** `OFFICIAL_CAUSAL_MEASUREMENT_GUIDANCE`  
**Finding:** Treatment/control lift measures incremental conversions; Google also supports Brand Lift and Search Lift.

### G07 — Direct traffic
**Source:** Google Analytics Help, “Understand (direct)/(none) traffic.”  
**URL:** https://support.google.com/analytics/answer/15258820  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Direct can arise from typed URLs/bookmarks but also missing UTMs, redirects and blockers.  
**Use:** Supports treating direct as mixed residual, not pure brand.

### G08 — Modeled key events
**Source:** Google Analytics Help, “About modeled key events.”  
**URL:** https://support.google.com/analytics/answer/10710245  
**Evidence:** `PLATFORM_MODELING_GUIDANCE`  
**Finding:** Google models unobservable conversions in privacy/technical gaps; attributed data can update after conversion.

### G09 — Behavioral modeling / consent mode
**Source:** Google Analytics Help, “Behavioral modeling for consent mode.”  
**URL:** https://support.google.com/analytics/answer/11161109  
**Evidence:** `PLATFORM_MODELING_GUIDANCE`  
**Finding:** Modeled and observed data can differ; modeling has eligibility thresholds and unsupported analyses.

### G10 — Search Console performance
**Sources:** Search Console Help, Performance report overview; impressions/position/clicks.  
**URLs:**  
https://support.google.com/webmasters/answer/7576553  
https://support.google.com/webmasters/answer/7042828  
**Evidence:** `PLATFORM_METRIC_DEFINITION`  
**Finding:** Search Console measures impressions, clicks, CTR, average position and query/page dimensions.

### G11 — Search Console data limitations
**Source:** Search Console Help, “Troubleshooting data discrepancies.”  
**URL:** https://support.google.com/webmasters/answer/17010575  
**Evidence:** `PLATFORM_LIMITATION`  
**Finding:** Rare/anonymized queries, table limits, privacy, lag and aggregation cause discrepancies.

### G12 — Generative AI performance report
**Source:** Search Console Help, “Generative AI performance report (Search).”  
**URL:** https://support.google.com/webmasters/answer/16984139  
**Evidence:** `CURRENT_PLATFORM_MECHANIC`  
**Finding:** As of Aug 31 2026, Search Console provides generative-AI impression reporting for AI Overviews and AI Mode.  
**Limitation:** Current implementation is volatile.

### G13 — Enhanced conversions / first-party matching
**Source:** Google Ads Help, “About enhanced conversions for web.”  
**URL:** https://support.google.com/google-ads/answer/15712870  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Hashed first-party conversion data can supplement matching.  
**Limitation:** Hashing does not by itself establish lawful basis.

### G14 — Consent mode
**Source:** Google Analytics Help, “About consent mode.”  
**URL:** https://support.google.com/analytics/answer/10000067  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Tags adjust behavior based on consent state; basic/advanced implementations provide different modeling inputs.

## Meta

### M01 — Measurement methodologies
**Source:** Meta Blueprint, “Introduction to measurement methodologies.”  
**URL:** https://www.facebookblueprint.com/student/collection/248403/path/251315  
**Evidence:** `OFFICIAL_MEASUREMENT_GUIDANCE`  
**Finding:** Meta explicitly distinguishes experimental and observational methods, A/B tests, RCTs, Brand Lift and Conversion Lift.

### M02 — Channel impact / Conversion Lift calibration
**Source:** Meta Blueprint, “Measure channel impact with Meta Conversion Lift.”  
**URL:** https://www.facebookblueprint.com/student/activity/674272  
**Evidence:** `OFFICIAL_MEASUREMENT_GUIDANCE`  
**Finding:** Meta teaches channel-lift studies and calibration multipliers for attribution/budget decisions.

## Microsoft

### MS01 — Microsoft Advertising Conversions API
**Source:** Microsoft Learn, “Conversions API (CAPI).”  
**URL:** https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Server-side API supports website, CRM, offline sales and mobile events.

### MS02 — Offline conversions
**Source:** Microsoft Learn, OfflineConversion / ApplyOfflineConversions.  
**URLs:**  
https://learn.microsoft.com/en-us/advertising/campaign-management-service/offlineconversion  
https://learn.microsoft.com/en-us/advertising/campaign-management-service/applyofflineconversions  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Offline conversion import connects ad clicks to downstream offline outcomes.

### MS03 — Attribution model types
**Source:** Microsoft Learn, AttributionModelType.  
**URL:** https://learn.microsoft.com/en-us/advertising/campaign-management-service/attributionmodeltype  
**Evidence:** `PLATFORM_MECHANIC`  
**Finding:** Microsoft supports LastClick/DataDriven and specific LastTouch behavior; illustrates platform-specific attribution semantics.

## OpenAI / AI advertising

### O01 — ChatGPT Ads measurement
**Source:** OpenAI Help Center, “Ads in ChatGPT: The Basics.”  
**URL:** https://help.openai.com/en/articles/20001207  
**Evidence:** `CURRENT_PLATFORM_MECHANIC`  
**Finding:** Current reporting includes impressions, clicks, spend, CTR, CPC, CPM and conversions; UTM parameters can persist on ad clicks.  
**Limitation:** Ads product is fast-moving; live-check before execution.

### O02 — ChatGPT Ads Europe availability
**Source:** OpenAI, “ChatGPT Ads expands across Europe.”  
**URL:** https://openai.com/index/chatgpt-ads-expands-across-europe/  
**Evidence:** `CURRENT_PLATFORM_AVAILABILITY`  
**Finding:** ChatGPT Ads expanded to Denmark and other European markets in Aug 2026; ads are a real paid-AI channel category.  
**Limitation:** Availability/product details are volatile.

## Social / video analytics

### S01 — LinkedIn content analytics
**Source:** LinkedIn Help, “Content analytics for your LinkedIn Page.”  
**URL:** https://www.linkedin.com/help/linkedin/answer/a564051  
**Evidence:** `PLATFORM_METRIC_DEFINITION`  
**Finding:** LinkedIn reports impressions, reach, clicks, interactions and engagement; reach/impressions can be estimated.

### S02 — YouTube Analytics reach/content
**Sources:** YouTube Help, reach and content analytics.  
**URLs:**  
https://support.google.com/youtube/answer/9314355  
https://support.google.com/youtube/answer/12220281  
**Evidence:** `PLATFORM_METRIC_DEFINITION`  
**Finding:** YouTube separates impressions, CTR, views, unique viewers, watch time and traffic sources; definitions can change.

## Email

### E01 — Apple Mail Privacy Protection
**Source:** Apple Legal, “Mail Privacy Protection & Privacy.”  
**URL:** https://www.apple.com/legal/privacy/data/en/mail-privacy-protection/  
**Evidence:** `PLATFORM_PRIVACY_MECHANIC`  
**Finding:** Remote content may be fetched in background independent of actual engagement, weakening open tracking.

### E02 — Mailchimp MPP / bot activity
**Sources:** Mailchimp, MPP FAQs; About Bot Activity.  
**URLs:**  
https://mailchimp.com/help/apple-privacy-faq/  
https://mailchimp.com/help/about-bot-activity/  
**Evidence:** `PRACTITIONER_PLATFORM_GUIDANCE`  
**Finding:** MPP and security bots can inflate opens/clicks; clicks/purchases are stronger engagement/value signals than opens.

### E03 — Gmail Postmaster Tools
**Source:** Gmail Help, “Postmaster Tools dashboards.”  
**URL:** https://support.google.com/mail/answer/14668346  
**Evidence:** `PLATFORM_METRIC_DEFINITION`  
**Finding:** Sender measurement includes spam rate, IP/domain reputation, authentication and delivery errors.

## Academic / causal research

### A01 — Observational measurement vs randomized experiments
**Source:** Gordon, Zettelmeyer, Bhargava & Chapsky, Marketing Science 2019.  
**URL:** https://pubsonline.informs.org/doi/10.1287/mksc.2018.1135  
**Evidence:** `LARGE_RANDOMIZED_EXPERIMENT_COMPARISON`  
**Finding:** Common observational methods often failed to reproduce RCT effects across 15 Facebook experiments / 500M user-experiment observations.

### A02 — Close Enough?
**Source:** Gordon, Moakler & Zettelmeyer, Marketing Science 2023.  
**URL:** https://pubsonline.informs.org/doi/10.1287/mksc.2022.1413  
**Evidence:** `LARGE_SCALE_CAUSAL_MEASUREMENT_RESEARCH`  
**Use:** Modern evidence on non-experimental advertising measurement and its limitations.

### A03 — Unfavorable economics of measuring advertising returns
**Source:** Lewis & Rao, Quarterly Journal of Economics 2015.  
**URL:** https://www.jstor.org/stable/26372642  
**Evidence:** `LARGE_FIELD_EXPERIMENT_SYNTHESIS`  
**Finding:** ROI estimates can have very wide uncertainty; advertising effects are difficult to estimate precisely due to noisy individual outcomes.

### A04 — Ghost Ads
**Source:** Johnson, Lewis & Nubbemeyer, Journal of Marketing Research 2017.  
**URL:** https://journals.sagepub.com/doi/10.1509/jmr.15.0297  
**Evidence:** `RANDOMIZED_MEASUREMENT_METHOD`  
**Finding:** Counterfactual ad opportunity designs can improve economics/precision of digital ad experiments.

### A05 — When Less Is More
**Source:** Johnson, Lewis & Reiley, Marketing Science 2017.  
**URL:** https://pubsonline.informs.org/doi/10.1287/mksc.2016.0998  
**Evidence:** `RANDOMIZED_FIELD_EXPERIMENT`  
**Finding:** Careful control design can improve experimental precision more than adding large amounts of covariate data.

### A06 — Paid search effectiveness / eBay
**Source:** Blake, Nosko & Tadelis, Econometrica 2015 / NBER.  
**URL:** https://www.nber.org/papers/w20171  
**Evidence:** `LARGE_RANDOMIZED_FIELD_EXPERIMENT`  
**Finding:** In the eBay setting, observational paid-search returns materially overstated causal effect; especially important as evidence for self-selection risk.  
**Limitation:** Not a universal claim about all paid search.

### A07 — Predicted Incrementality by Experimentation (PIE)
**Source:** Gordon, Moakler & Zettelmeyer, NBER 2026.  
**URL:** https://www.nber.org/papers/w35044  
**Evidence:** `RCT_DERIVED_PREDICTIVE_METHOD`  
**Finding:** Uses RCT outcomes to predict incrementality for campaigns without simultaneous experiments; supports experiment-calibrated operational measurement.

### A08 — Parallel experimentation and competitive interference
**Source:** Waisman, Sahni, Nair & Lin, Marketing Science 2024.  
**URL:** https://www.gsb.stanford.edu/faculty-research/publications/parallel-experimentation-competitive-interference-online-advertising  
**Evidence:** `EXPERIMENTAL_METHOD_RESEARCH`  
**Finding:** Competitive/parallel experiments can materially affect measured lift; experiment environment matters.

## MMM / planning

### MM01 — Meridian ROI/mROI priors
**Source:** Google Meridian documentation.  
**URL:** https://developers.google.com/meridian/docs/advanced-modeling/how-to-choose-treatment-prior-types  
**Evidence:** `MODELING_METHOD_GUIDANCE`  
**Finding:** Defines ROI vs marginal ROI; mROI is useful for budget optimization.

### MM02 — Meridian calibration recommendation
**Source:** Google Meridian, “Channel calibration recommendation and score.”  
**URL:** https://developers.google.com/meridian/docs/post-modeling/channel-recommendation  
**Evidence:** `MODELING_METHOD_GUIDANCE`  
**Finding:** Recommends calibrating ROI priors with incrementality experiments as experimental ground truth.

### MM03 — Meridian GeoX
**Source:** Google Meridian GeoX docs.  
**URL:** https://developers.google.com/meridian/geox/notebook  
**Evidence:** `EXPERIMENTATION / MODEL_CALIBRATION_TOOL`  
**Finding:** Geo experiments can be used to calibrate MMM priors.

## PR / communications standards

### PR01 — Barcelona Principles 4.0
**Source:** AMEC, Barcelona Principles V4.0, 2025.  
**URL:** https://amecorg.com/wp-content/uploads/2025/06/Barcelona-Principles-V4.0-Ebook-FINAL-Compressed.pdf  
**Evidence:** `INDUSTRY_STANDARD`  
**Finding:** Communication measurement should focus on outputs/outcomes/impact, cover relevant channels and reject AVE-style valuation.

### PR02 — AMEC Integrated Evaluation Framework
**Source:** AMEC IEF.  
**URL:** https://amecorg.com/amecframework/home/supporting-material/taxonomy/  
**Evidence:** `INDUSTRY_STANDARD + RESEARCH_SYNTHESIS`  
**Finding:** Distinguishes inputs, activities, outputs, out-takes, outcomes and impacts; warns against substituting lower-level counts for higher-level outcomes.

### PR03 — AMEC policy on AVEs
**Source:** AMEC.  
**URL:** https://www.amecorg.com/wp-content/uploads/2019/11/AMEC-Policy-on-Advertising-Value-Equivalent-AVEs-12-September.pdf  
**Evidence:** `INDUSTRY_STANDARD`  
**Finding:** Advertising Value Equivalents are not recognized as valid measurement of PR value.

## Legal / privacy — EU/DK baseline

### L01 — Datatilsynet: cookies og lignende teknologier
**URL:** https://www.datatilsynet.dk/regler-og-vejledning/cookies-og-lignende-teknologier/gode-raad-ved-brug-af-cookies-og-lignende-teknologier  
**Evidence:** `DANISH_REGULATORY_GUIDANCE`  
**Finding:** Cookie-/pixel-like tracking for e.g. statistics or personalized ads generally requires consent unless technically necessary; data minimization applies.

### L02 — Datatilsynet: Cookies og GDPR
**URL:** https://www.datatilsynet.dk/regler-og-vejledning/gdpr-univers-for-smaa-virksomheder/cookies-og-gdpr  
**Evidence:** `DANISH_REGULATORY_GUIDANCE`  
**Finding:** Pixels/cookies/statistics/marketing involve data-protection obligations and consent considerations.

### L03 — EDPB consent/targeting guidance
**URL:** https://www.edpb.europa.eu/documents_en  
**Evidence:** `EU_REGULATORY_GUIDANCE`  
**Finding:** Consent, profiling and social targeting are governed by GDPR/ePrivacy principles; current legal text should be live-checked for concrete implementations.

---


## V2 additions — cross-media, data quality, experiments og current 2026 surfaces

### G15 — Current GA4 DDA methodology
**Source:** Google Analytics Help, “Get started with attribution.”  
**URL:** https://support.google.com/analytics/answer/10596866  
**Evidence:** `PLATFORM_METHOD_DESCRIPTION`  
**Finding:** DDA uses converting/non-converting path data, counterfactual modeling and states that counterfactual gains of Google ad exposures can be trained on randomized controlled trials.  
**Limitation:** Fractional attribution output is not the same estimand as a contemporaneous campaign-specific lift experiment for every channel.

### G16 — GA4 AI Assistant channel
**Source:** Google Analytics Help, “Default channel group” + Analytics 2026 release notes.  
**URLs:**  
https://support.google.com/analytics/answer/9756891  
https://support.google.com/analytics/answer/9164320  
**Evidence:** `CURRENT_PLATFORM_TAXONOMY`  
**Finding:** GA4 classifies traffic from recognized AI assistants such as ChatGPT/Gemini/Copilot/Grok as AI Assistant; Google AI Overviews/AI Mode are excluded from that channel.  
**Limitation:** Vendor-maintained taxonomy; current implementation detail.

### O03 — ChatGPT Ads Conversion Measurement
**Source:** OpenAI Help Center, “Conversion Measurement” + “Measure Results.”  
**URLs:**  
https://help.openai.com/en/articles/20001409-conversion-measurement  
https://help.openai.com/en/articles/20001214-measure-results  
**Evidence:** `CURRENT_PLATFORM_MECHANIC`  
**Finding:** Conversion events can be sent via OpenAI Pixel, Conversions API or both and matched to eligible ad clicks; Ads Manager reports impressions/clicks/spend/CTR/CPC/CPM/conversions.  
**Limitation:** Current beta/product mechanics are volatile.

### MRC01 — Outcomes and Data Quality Standards
**Source:** Media Rating Council, “Outcomes and Data Quality Standards,” 2022.  
**URL:** https://www.mediaratingcouncil.org/standards-and-guidelines  
**Evidence:** `INDUSTRY_STANDARD`  
**Finding:** Outcome attribution should disclose methodology, data scale/coverage/matching and limitations; missing media/data can bias credit; attribution methods can be validated against randomized experiments; identity/deduplication methods require empirical support.  
**Use:** Data-quality, cross-device, attribution-disclosure and coverage standards.

### MRC02 — Attention Measurement Guidelines
**Source:** Media Rating Council, “Attention Measurement Guidelines,” updated Nov 2025.  
**URL:** https://www.mediaratingcouncil.org/standards-and-guidelines  
**Evidence:** `INDUSTRY_STANDARD`  
**Finding:** Attention measurement requires transparent signal/model definitions and relationship to viewability/audibility; diagnostic attention outputs should not be casually conflated with outcomes.  
**Use:** Separates opportunity-to-see, attention and business effect.

### IAB01 — Guidelines for Incremental Measurement in Commerce Media
**Source:** IAB & IAB Europe, Nov 2025.  
**URL:** https://www.iab.com/guidelines/guidelines-for-incremental-measurement-in-commerce-media/  
**Evidence:** `INDUSTRY_CAUSAL_MEASUREMENT_STANDARD`  
**Finding:** Incrementality requires a credible counterfactual/intervention, bias control and signal/noise discipline; framework covers experiments, model-based counterfactuals, econometric and hybrid approaches.

### IAB02 — Campaign Data Standards 1.0
**Source:** IAB Project Eidos, final Aug 10 2026.  
**URL:** https://www.iab.com/guidelines/campaign-data-standards/  
**Evidence:** `INDUSTRY_TAXONOMY_STANDARD`  
**Finding:** Provides common Ad Type and Ad Inventory taxonomies intended to improve cross-platform consistency/comparability.  
**Use:** Optional alignment layer for enterprise campaign-data schemas; not a replacement for business-specific IDs/taxonomy.

### IAB03 — Measuring Visibility in the AI Era
**Source:** IAB Data & Measurement, Aug 2026.  
**URL:** https://www.iab.com/guidelines/measuring-visibility-in-the-ai-era/  
**Evidence:** `INDUSTRY_CONTEXT`  
**Finding:** AI visibility vendors can use materially different methodologies and return different answers; methodology transparency is essential.  
**Use:** Supports treating third-party AI share-of-voice as sampled/model-dependent telemetry.

### WFA01 — Halo / cross-media measurement
**Source:** World Federation of Advertisers, Halo cross-media measurement framework / 2026 roadmap.  
**URL:** https://wfanet.org/knowledge/item/2025/12/19/next-steps-for-halo-and-cross-media-measurement-in-2026  
**Evidence:** `INDUSTRY_FRAMEWORK`  
**Finding:** Cross-media reach/frequency requires privacy-preserving deduplication across fragmented media owners; platform reach cannot simply be added.

### A09 — Multicell Experiments for Marginal Treatment Effect Estimation of Digital Ads
**Source:** Waisman & Gordon, Management Science 2025.  
**URL:** https://pubsonline.informs.org/doi/10.1287/mnsc.2023.01185  
**Evidence:** `EXPERIMENTAL_METHOD_RESEARCH`  
**Finding:** Standard treatment/control experiments may not identify intensive-margin quantities such as how many consumers to reach or how much to spend; multi-cell designs can estimate marginal treatment effects.

### A10 — Forward Difference-in-Differences
**Source:** Li, Marketing Science 2023/2024.  
**URL:** https://pubsonline.informs.org/doi/10.1287/mksc.2022.0212  
**Evidence:** `QUASI_EXPERIMENTAL_METHOD_RESEARCH`  
**Finding:** In nonrandomized DID settings, selecting proper control units and identification assumptions is critical.  
**Use:** Quasi-experimental checklist, not a blanket endorsement of DID.

### A11 — Continuous Geo Experiments
**Source:** Google Research, Vaver & Van Alstine; continuous geo experimentation program.  
**URL:** https://research.google/blog/running-continuous-geo-experiments-to-assess-ad-effectiveness/  
**Evidence:** `RANDOMIZED_EXPERIMENT_METHOD_RESEARCH`  
**Finding:** Rotating/pooled repeated geo experiments can support periodic measurement and improve precision/reduce measurement cost in appropriate settings.

### MM04 — Meridian experiment calibration
**Source:** Google Meridian, “Calibrate treatment priors” / channel calibration guidance.  
**URLs:**  
https://developers.google.com/meridian/docs/advanced-modeling/roi-priors-and-calibration  
https://developers.google.com/meridian/docs/post-modeling/channel-recommendation  
**Evidence:** `MODELING_METHOD_GUIDANCE`  
**Finding:** Incrementality experiments are a strong basis for priors/calibration, but translating an experiment into a model prior is not a mechanical formula and requires context/judgment.

### MM05 — Meridian CalibrationBuilder / estimand relevance
**Source:** Google Meridian, custom ROI priors from past experiments.  
**URL:** https://developers.google.com/meridian/docs/advanced-modeling/set-custom-priors-past-experiments  
**Evidence:** `MODELING_METHOD_GUIDANCE`  
**Finding:** Meridian explicitly warns that marginal-lift experiments with non-zero counterfactuals can create an estimand mismatch against an MMM zero-spend counterfactual.

### MM06 — Meridian GeoX design and KPI best practices
**Sources:** Google Meridian GeoX, experiment types + pretest data guidance.  
**URLs:**  
https://developers.google.com/meridian/geox/types-of-experiments  
https://developers.google.com/meridian/geox/prepare-your-pretest-data  
**Evidence:** `EXPERIMENT_DESIGN_GUIDANCE`  
**Finding:** Supports holdback/go-dark/heavy-up/multi-cell designs; recommends one powered primary KPI per design and daily pretest/test time series for GeoX workflows.

### MR01 — Meta Robyn Analyst Guide
**Source:** Meta Marketing Science, Robyn Analyst's Guide to MMM.  
**URL:** https://facebookexperimental.github.io/Robyn/docs/analysts-guide-to-MMM/  
**Evidence:** `VENDOR_OPEN_SOURCE_METHOD_GUIDANCE`  
**Finding:** MMM is an aggregate modeling approach; Robyn strongly recommends experimental/causal calibration, ongoing validation and warns that budget allocator predictions are not guaranteed.

### MR02 — Robyn holistic calibration
**Source:** Meta Robyn, Key Features.  
**URL:** https://facebookexperimental.github.io/Robyn/docs/features/  
**Evidence:** `VENDOR_OPEN_SOURCE_METHOD_GUIDANCE`  
**Finding:** Effect size, adstock and saturation are all uncertain model quantities and can/should be calibrated by ground truth where possible.

### E04 — Email bot filtering
**Source:** Mailchimp, “About Bot Activity and Bot Filtering.”  
**URL:** https://mailchimp.com/help/about-bot-activity/  
**Evidence:** `PLATFORM_MECHANIC / DATA_QUALITY`  
**Finding:** Security services, link previews and MPP can generate non-human opens/clicks and inflate engagement metrics; bot filtering is a measurement quality control.

### L04 — EDPB Guidelines 2/2023 on ePrivacy Art. 5(3)
**Source:** European Data Protection Board, final version Oct 16 2024.  
**URL:** https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en  
**Evidence:** `EU_REGULATORY_GUIDANCE`  
**Finding:** Clarifies technical scope of information storage/access on terminal equipment beyond classic cookies.  
**Use:** Supports privacy-by-design and warns against assuming server-side/alternative identifiers escape ePrivacy/GDPR considerations.

---

# Source-handling rules

1. **Randomized/credible causal evidence** governs causal effect claims, within its population/treatment/time scope.
2. **Official vendor documentation** governs what a platform currently means, measures and supports — not universal effectiveness.
3. **Professional standards** govern disclosure, data quality, taxonomy and cross-media methodology where applicable.
4. Vendor-reported uplifts remain context, not default benchmarks.
5. Attribution outputs are never relabeled as incrementality without an explicit causal identification argument.
6. Model outputs are never relabeled as observations.
7. Internal dashboards create hypotheses unless the design supports stronger inference.
8. Experiment learnings store estimand, spend/treatment level, market, period and environment.
9. Calibration preserves experiment uncertainty and checks estimand compatibility.
10. Legal/privacy guidance is live-checked at execution.
11. Metric definitions and volatile vendor mechanics are versioned.
12. Every source is recorded with scope, period, evidence class and limitation.

---

# Final doctrine

> **Marketing measurement is a decision system under uncertainty. The gold standard is not perfect attribution; it is a calibrated evidence architecture that separates realized business outcomes, observed media delivery, attribution credit, modeled inference and causal effect — and uses the strongest feasible method for the decision at hand.**

Den operationelle loop er:

```text
DEFINE THE DECISION
→ DEFINE THE ESTIMAND / COUNTERFACTUAL
→ DEFINE BUSINESS OUTCOME + SOURCE OF TRUTH
→ INSTRUMENT EVENTS + IDs + SOURCE TAXONOMY
→ VALIDATE DATA QUALITY / COVERAGE / IDENTITY
→ OBSERVE CHANNEL + MEDIA DELIVERY
→ RECONCILE ATTRIBUTED RESULTS TO BACKEND
→ IDENTIFY THE MATERIAL CAUSAL UNCERTAINTY
→ RUN THE STRONGEST FEASIBLE EXPERIMENT
→ STORE EFFECT + INTERVAL + SPEND/TREATMENT CONTEXT
→ CALIBRATE ATTRIBUTION / MMM WHERE ESTIMANDS MATCH
→ ESTIMATE MARGINAL CONTRIBUTION WITH UNCERTAINTY
→ MAKE A BOUNDED DECISION
→ MEASURE REALIZED RESPONSE
→ UPDATE THE LEARNING BASE
→ REVALIDATE
```

---

# One-page Golden Standard

1. **Start with the business decision.**
2. **Define the estimand and counterfactual before choosing a metric.**
3. **Define commercial truth before marketing telemetry.**
4. **Use finance/CRM/orders as source of truth for money/customer outcomes.**
5. **Give every event a definition, owner, unique key and quality SLA.**
6. **Standardize channel/source/medium/campaign taxonomy and stable IDs.**
7. **Keep first-user, session, conversion-credit and customer-source scopes separate.**
8. **Label observed, attributed, modeled and incremental data distinctly.**
9. **Treat direct as mixed residual, not pure brand.**
10. **Reconcile platform claims to backend totals before channel conclusions.**
11. **Never sum vendor-attributed conversions/revenue as unique business outcomes.**
12. **Separate click-through, engaged-view and view-through credit.**
13. **Use attribution to allocate credit; do not automatically claim causality.**
14. **Treat modern DDA as model-based attribution, even when it uses causal/counterfactual components.**
15. **Use path reports for journey insight, not as a lift estimate.**
16. **Report observable coverage, identity match rate and modeled share.**
17. **Do not confuse identity resolution with causal identification.**
18. **Do not sum platform reach; use validated cross-media deduplication when needed.**
19. **Filter/label invalid traffic where material.**
20. **Treat viewability as opportunity-to-see, not attention/effectiveness.**
21. **Treat attention as diagnostic unless downstream value is validated.**
22. **Run randomized holdout/lift when the decision requires causal effect.**
23. **Analyze randomized experiments by assignment as the causal baseline.**
24. **Use geo experiments when person-level randomization is impractical.**
25. **Define one powered primary outcome/MDE before launch.**
26. **Report effect size + interval + economic materiality.**
27. **Do not interpret non-significance as proof of no effect.**
28. **Do not interpret significance as proof of profitability.**
29. **Use `Δ spend` as denominator when the experiment's counterfactual has non-zero spend.**
30. **Use multi-cell/dose designs or calibrated response curves for marginal-spend questions.**
31. **Treat interference, contamination and concurrent competition as validity risks.**
32. **Use MMM for aggregate planning, not as a causal oracle.**
33. **Calibrate MMM with causal experiments when estimands and context are compatible.**
34. **Treat response curves and allocators as uncertain predictions.**
35. **Allocate on expected marginal contribution, not historical average ROAS alone.**
36. **Separate new, existing and reactivated customer economics.**
37. **Optimize lead gen to qualified/won outcomes, not raw leads.**
38. **Evaluate subscriptions on retained value, not signup alone.**
39. **Evaluate SEO visibility → qualified traffic → business outcome.**
40. **Measure AI discovery through exposure + referral + demand/customer evidence, with methodology disclosure.**
41. **Treat organic social engagement as diagnostic unless validated.**
42. **Treat email opens and clicks as potentially privacy/bot-contaminated.**
43. **Measure lifecycle with causal holdouts when flows become material.**
44. **Measure affiliate/creator channels for substitution, commissions and new-customer quality.**
45. **Measure PR from outputs to outcomes/impact; reject AVE/EMV as ROI.**
46. **Design privacy into measurement; server-side/clean-room tech does not erase legal obligations.**
47. **Freeze affected performance interpretation during material measurement incidents.**
48. **Store every learning with method, estimand, spend level, scope, uncertainty and review date.**
49. **Use platform docs for mechanics, causal research for effect claims, standards for disclosure/data quality.**
50. **The objective is better decisions under uncertainty — not a dashboard that pretends uncertainty is gone.**

---

# V2 validation note

V2 er et revalidation-dokument, ikke et append-only V1. De vigtigste V1-principper er bevaret, men centrale formuleringer om data-driven attribution, incremental ROAS, experiment design, identity, cross-media reach, media quality og MMM er korrigeret eller gjort mere præcise.

V2's permanente enhed er fortsat **marketing job/category + business outcome + estimand + evidensdesign**. GA4 AI Assistant, Search Console generative-AI reports, ChatGPT Ads, Meridian GeoX, Meta Robyn, IAB Campaign Data Standards og andre 2026-features er konkrete implementations, der understøtter standarden — ikke selve standarden.

Ingen offentlig playbook kan garantere 100% korrekt measurement i alle virksomheder. Den højeste professionelle standard er i stedet at gøre **hvad vi ved, hvordan vi ved det, hvad vi ikke kan observere, hvilket counterfactual der bruges, hvor usikkert estimatet er, og hvilken beslutning evidensen kan bære** eksplicit. Det er V2's gold-standard definition.
