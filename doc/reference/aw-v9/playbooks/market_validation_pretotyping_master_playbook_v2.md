# Market Validation & Pretotyping Master Playbook
## V2.0 - Validated Golden Standard for evidence-based market validation

**Version:** 2.0 - Validated Golden Standard  
**Research cutoff:** 21. september 2026  
**Scope:** Markedsvalidering af et allerede nogenlunde defineret produkt-, service-, feature- eller markedskoncept. Pretotyping er hovedmotoren, men playbooken dækker hele validation-disciplinen: hypoteser, eksperimentdesign, data, fortolkning og investeringsbeslutninger.  
**Dokumenttype:** Evergreen best-practice playbook. Ikke en fuld Concept & Business Design-playbook, ikke en Go-to-Market-playbook, ikke en klik-for-klik værktøjsmanual og ikke en AI-playbook.  
**Operator-neutral:** Standarderne gælder uanset om arbejdet udføres af mennesker, software, AI-agenter eller en kombination.  

---

# Core doctrine

Market validation har ét job: **at reducere den usikkerhed, der kan ændre den næste investeringsbeslutning, før virksomheden binder flere ressourcer end evidensen kan bære.**

Pretotyping er hovedmotoren, fordi metoden eksplicit er designet til at teste et potentielt produkts **market appeal og actual usage ved at simulere core experience med mindst mulig investering af tid og penge** [S01][S02]. Men golden standard er bredere end én metode: den kombinerer pretotyping med hypothesis-driven entrepreneurship, behavioral market evidence, randomiseret eksperimentdesign, pricing/WTP-metoder, survey science, decision theory og relevante legal/ethical constraints.

Den centrale loop er:

> **Definér beslutningen -> identificér den kritiske market assumption -> gør den målbar -> vælg den billigste troværdige test -> få markedet til at gøre noget meningsfuldt -> mål adfærd med den rigtige denominator -> kvantificér usikkerhed og alternative forklaringer -> investér kun næste tranche, hvis evidensen retfærdiggør det.**

## Det playbooken forsøger at optimere

Ikke flest tests. Ikke flest positive signaler. Ikke et bestemt conversion-tal.

Den optimerer for:

```text
DECISION-RELEVANT LEARNING
--------------------------
TIME + CASH + OPPORTUNITY COST + TRUST/LEGAL RISK
```

Det betyder:

- test det **vigtigste ukendte**, ikke det letteste,
- brug **adfærd tæt på den endelige exchange** når muligt,
- afled success thresholds fra **viability og decision loss**, ikke internetbenchmarks,
- brug den **mindste artifact, der stadig giver troværdig evidence**,
- gør negative data lige så beslutningsdygtige som positive data,
- skeln mellem **discovery**, **behavioral validation** og **causal comparison**,
- stop når ekstra information er mindre værd end execution og time-to-market,
- og behandl hvert positivt resultat som **scoped evidence**, ikke som universel product-market fit.

## Market validation er ikke prediction theater

Nye idéer har høj usikkerhed, men der findes ikke én forsvarlig universel regel om, at “80-90% af alle nye produkter fejler”. Den ofte citerede 80%+-påstand er direkte blevet kritiseret som en vedvarende myte i product-innovation-litteraturen [F01]. Derfor bruger playbooken Savoias “Law of Market Failure” som et **mindset om base-rate uncertainty**, ikke som et præcist forecast.

Det robuste spørgsmål er ikke:

> “Hvor stor er den generelle chance for at nye produkter fejler?”

Det er:

> **“Hvilken markedsevidens skal vi have, før netop denne næste investering er rationel?”**

## Behavior beats enthusiasm, men evidens er gradueret

Stated intent kan være værdifuldt til discovery, men purchase intentions og hypotetisk willingness to pay er ikke identiske med faktisk køb. Forskningen viser både kontekstafhængig sammenhæng mellem intentions og purchases og systematiske hypothetical-bias problemer i WTP-målinger [M01][M03]. Derfor gælder:

```text
opinion < stated intent < low-cost action < high-friction action
< reservation/LOI < deposit < purchase < repeat/retention
```

Det er ikke en absolut rangorden. En underskrevet enterprise-pilot med procurement-arbejde kan være stærkere end et lille consumer-depositum. Evidensstyrken bestemmes af **commitment, realism, representativeness og causal cleanliness**.

## Experimentation er et middel, ikke en religion

Randomiserede studier af en mere scientific approach til entrepreneurship finder mere disciplineret idea termination og selektiv pivoting [A01][A02]. Større organisations- og entrepreneurship-reviews støtter samtidig, at experimentation både har en problem-solving/discovery-funktion og en causal-inference-funktion [A04][A07]. Nyere teori viser desuden, at experimentation ikke altid er optimalt: information kan være værdifuld, men adaptation cost, opportunity cost og appropriability/imitation risk kan gøre mere testing dårligere end handling [A08][A09].

Derfor er playbookens doctrine:

> **Experiment only when the expected value of better information exceeds the full cost of learning.**

## Gold-standard definition

En market validation-proces er “gold standard”, når den:

- starter med en **konkret beslutning og næste irreversible commitment**,
- gør centrale antagelser **falsificerbare før data ses**,
- bruger **real-world evidence** tæt på den adfærd, der skal bære forretningen,
- predefinerer **metric, denominator, decision band og stopping logic**,
- matcher metode og sample til den **mindste business-relevante effekt**,
- kontrollerer **data quality, bias, multiplicity og alternative forklaringer**,
- skelner mellem **intern validitet og transportability**,
- vælger bevidst mellem **public og quiet/private validation**,
- beskytter kunder, trust, privacy og lovlighed som design constraints,
- og omsætter resultatet til **KILL / ITERATE / NEXT TEST / ESCALATE** samt en eksplicit næste investment tranche.

---

# Sådan bruges playbooken

Playbooken beskriver **hvordan man designer, kører, måler og beslutter markedsvalidering**. Den beskriver ikke, hvordan man fuldt konceptudvikler en virksomhed, og den beskriver heller ikke den efterfølgende Go-to-Market-maskine.

## Scope boundary

### Input
Et koncept, produkt eller tilbud der kan beskrives kort nok til at testes:

- hvad der tilbydes,
- hvem det omtrent er til,
- hvilken situation/problem/outcome det adresserer,
- hvilken markedskontekst der ønskes valideret.

Hvis teamet ikke kan beskrive dette uden en workshop om selve forretningskonceptet, hører opgaven hjemme i **Concept & Business Design** før denne playbook.

### Output
Et evidensbaseret svar på:

> **Hvad ved vi nu om markedets faktiske adfærd, hvad ved vi stadig ikke, og hvad er den rationelle næste investering?**

Typiske output-beslutninger:

- `KILL`
- `ITERATE`
- `RUN_NEXT_TEST`
- `ESCALATE_TO_PROTOTYPE_OR_MVP`
- `PROVINCIAL_LAUNCH`
- `VALIDATED_ENOUGH_FOR_GTM_DISCOVERY`

### Ikke scope

- fuld Business Model Canvas / Value Proposition-design,
- brand strategy,
- komplet pricing strategy,
- komplet sales playbook,
- marketing channel operations,
- launch plan,
- scaling,
- organisatorisk operating model,
- teknisk product validation i dybden.

Disse kan berøre validation, men bliver separate playbooks.

## Tre lag

1. **Evergreen core:** hypoteser, evidens, experiment design, adfærd, data quality, decision rules, ethics og learning.
2. **Context modules:** B2B, SaaS, service, physical product, marketplace, new-market entry osv.
3. **Volatile implementation layer:** konkrete ad-platforme, AI-værktøjer, analytics-features, cookie-regler, platformpolicies, no-code produkter og kanalpriser. Live-checkes før execution.

---

# Evidensstandard og kildehierarki

Denne playbook skelner mellem **metodeautoritet** og **effektevidens**. Alberto Savoia er den centrale ophavs- og praksiskilde til pretotyping. Det betyder ikke, at alle illustrative tal eller formuleringer i hans bøger automatisk bliver universelle empiriske love.

| Tier | Kildetype | Brug |
|---|---|---|
| **A1** | Randomiserede feltforsøg, peer-reviewed meta-analyser, stærk causal research | Højeste vægt ved “hvad virker?”, bias, effekt og måling. |
| **A2** | Officiel lovgivning/regulatorisk vejledning | Source of truth for legal/compliance baseline. |
| **B1** | Alberto Savoia / Pretotyping.org / Stanford-materiale | Source of truth for pretotyping-terminologi, metode og original framing. |
| **B2** | Steve Blank / Lean Startup / Wharton / institutional practitioner-research | Triangulering af hypothesis-driven entrepreneurship og customer validation. |
| **B3** | Peer-reviewed observational, reviews og method papers | Mekanismer, external validity, pricing, demand measurement og experimentation practice. |
| **C** | Tim Vang / preeto, erfarne practitioners, corporate cases | Praktisk implementation og organisationskontekst. Ikke universel causal truth. |
| **D** | Intern markedsdata | Kan være vigtigst for den konkrete beslutning, men klassificeres efter designkvalitet. |

## Evidenslabels

- `METHOD_ORIGIN`
- `OFFICIAL_REGULATION`
- `CAUSAL_RANDOMIZED`
- `META_ANALYSIS`
- `STRONG_OBSERVATIONAL`
- `REVIEW_SYNTHESIS`
- `PRACTITIONER_METHOD`
- `INTERNAL_CAUSAL_TEST`
- `INTERNAL_BEHAVIORAL_EVIDENCE`
- `INTERNAL_STATED_EVIDENCE`
- `SYNTHESIS`
- `HYPOTHESIS`

## Konfliktregel

Når kilder eller tests modsiger hinanden:

1. Kontroller først om de måler samme population, proposition, pris, channel, outcome og tidshorisont.
2. Ved kausal effekt vægtes randomized/controlled design over simple before-after-sammenligninger.
3. Ved reel demand vægtes actual behavior over hypothetical intent.
4. Ved legal/policy bruges aktuel officiel vejledning.
5. Bevar heterogenitet. Et gennemsnit er ikke automatisk en lov for et nyt segment.
6. Hvis spørgsmålet fortsat er åbent, design næste test specifikt til at skelne mellem forklaringerne.

---

# De 30 gyldne standarder

1. **Start med beslutningen, ikke med testmetoden.**
2. **Skriv hvad der skal være sandt, før du bygger mere.**
3. **Test den assumption, der kan dræbe casen, før du tester kosmetik.**
4. **Gør uklare ord til målbare XYZ-hypoteser.**
5. **Sæt pass/fail/inconclusive-regler før du ser resultatet.**
6. **Få markedet ud af Thoughtland og ind i en realistisk beslutningssituation.**
7. **Adfærd med reel konsekvens vejer mere end venlige ord.**
8. **Et klik er data, men det er svagere end et depositum, køb eller repeat usage.**
9. **Test så tæt på den endelige transaction som forsvarligt muligt.**
10. **Brug den billigste artifact, der kan give troværdig evidens.**
11. **Fake Door er et værktøj, ikke en religion.**
12. **Hvis en working slice er næsten lige så billig som en simulering, test working slice.**
13. **Pretotype for market risk; prototype for product/technical risk.**
14. **ILI måler initial respons; OLI måler om adfærden lever videre. Bland dem ikke sammen.**
15. **Der findes ingen universel “god conversion rate”. X kommer fra economics og required market size.**
16. **Den rigtige denominator er en del af resultatet.**
17. **Sammenlign rates på sammenlignelige opportunities, ikke rå counts fra forskellige kanaler.**
18. **Randomisér når du vil påstå, at A forårsagede mere end B.**
19. **Power, variance og sample size bestemmer hvor meget et “ingen forskel”-resultat betyder.**
20. **Statistical significance uden practical significance er ikke en business win.**
21. **Thresholds skal afspejle false-positive og false-negative costs, ikke kun statistik.**
22. **Positive resultater kræver mindst lige så hård kritik som negative resultater.**
23. **Replikér de vigtigste fund før store irreversible commitments, ikke alt af ritual.**
24. **Et land, segment, channel eller tidspunkt er ikke automatisk et andet; transportability er en hypothesis.**
25. **Pricing skal så vidt muligt valideres med reelle valg, ikke kun “hvad ville du betale?”.**
26. **Qualitative research forklarer hvorfor; behavioral tests viser om.**
27. **AI må accelerere testproduktion og analyse, men må ikke blive “kunden”.**
28. **Vælg public vs quiet/private validation bevidst; market learning kan også skabe competitive exposure.**
29. **Ethics, legality og trust er design constraints; en “god failure” køber mere læring end den koster.**
30. **Stop med at teste, når næste information er mindre værd end handlingen, og gem beslutningen med scope og evidence strength.**

---

# The Market Validation Operating System

Den praktiske end-to-end loop er:

```text
DEFINE THE DECISION
-> DEFINE THE MARKET BET
-> MAP CRITICAL ASSUMPTIONS
-> SELECT THE KILL ASSUMPTION
-> WRITE XYZ / PASS-FAIL HYPOTHESIS
-> HYPOZOOM TO A TESTABLE CONTEXT
-> CHOOSE EVIDENCE STRENGTH
-> CHOOSE PRETOTYPE / EXPERIMENT
-> PRE-REGISTER METRIC + THRESHOLD + STOPPING RULE
-> RUN IN THE REAL WORLD
-> VERIFY DATA QUALITY
-> INTERPRET EFFECT + UNCERTAINTY + ALTERNATIVE EXPLANATIONS
-> DECIDE: KILL / ITERATE / TEST / ESCALATE
-> STORE LEARNING WITH SCOPE
-> REPEAT UNTIL FURTHER INFORMATION IS NOT WORTH ITS COST
```

Det er ikke en lineær waterfall. Men teamet må ikke hoppe direkte fra “idé” til “lav en landing page” uden at vide, hvad testen skal afgøre.

---
# 1. Validation Brief: minimum input, maximum clarity

Market Validation starter med et **kort validation brief**, ikke med en ny innovationsworkshop.

```yaml
validation_id:
concept_name:
what_it_is: "én konkret sætning"
customer_or_user: "hvem skal faktisk gøre noget?"
market_context: "land / segment / use case"
core_outcome: "hvilket problem/outcome køber de?"
intended_transaction: "buy | subscribe | book | use | renew | sign | other"
indicative_price_or_economic_exchange:
decision_at_stake: "hvad beslutter vi efter testen?"
investment_at_risk_if_wrong:
known_evidence:
known_unknowns:
```

**Gate:** Kan teamet ikke udfylde dette på én side, er opgaven sandsynligvis stadig Concept & Business Design.

## Beslutningen før eksperimentet

Validering er kun værdifuld, hvis den kan ændre en beslutning. Start derfor med:

```text
Decision now:
What would we do if evidence is strongly positive?
What would we do if evidence is strongly negative?
What would we do if evidence is inconclusive?
What is the next irreversible investment we are trying to de-risk?
```

Et eksperiment uden en beslutning er research theatre.

Det passer også med bredere entrepreneurship research: Bennett & Chatterjis nationalt repræsentative studie beskriver pre-entry som en **sekvens af lærings- og stop/fortsæt-beslutninger**, ikke som ét binært spring fra idé til virksomhed [A06]. Market validation bør derfor styre næste commitment trin for trin i stedet for at forsøge at afsige én endelig dom tidligt.

---

# 2. Assumption architecture: hvad kan dræbe casen?

Et koncept består af antagelser. Playbooken validerer ikke “idéen” som én klump. Den validerer de antagelser, som den næste investeringsbeslutning hviler på.

## Market-critical assumption families

### Demand
Vil en tilstrækkelig del af den relevante målgruppe overhovedet engagere sig med tilbuddet?

### Segment
Er det faktisk denne type kunde, der reagerer stærkest, eller findes et bedre beachhead-segment?

### Transaction / willingness to pay
Vil målgruppen betale den pris eller yde den form for commitment, som casen kræver?

### Usage
Vil de reelt bruge løsningen, når den eksisterer i en troværdig form?

### Ongoing behavior
Vil de komme igen, forny, genkøbe eller fortsat bruge den med den frekvens, som modellen kræver?

### Channel access
Kan den relevante målgruppe nås i en virkelig kanal på en måde, der gør selve demand-testen repræsentativ? Dette er validation af reachability, ikke en fuld GTM-strategi.

### Market scale
Er den relevante population, engagement rate og transaction frequency samlet stor nok til det ambitionsniveau, casen kræver?

### Local market transport
Hvis et eksisterende produkt flyttes til et nyt segment eller land: holder problem, value, price acceptance, trust og adfærd stadig?

### Commercial constraint
Er der en markedsspecifik constraint som procurement, reimbursement, regulation, trust requirement eller minimum contract size, der gør interessen kommercielt irrelevant?

## Assumption register

```yaml
assumption_id: A-01
statement: "..."
family: demand|segment|price|usage|ongoing|channel|scale|transport|constraint
why_it_matters: "..."
if_false: "hvad bryder?"
current_evidence: "none|stated|behavioral|causal"
uncertainty: low|medium|high
impact_if_wrong: low|medium|high
cost_to_test: low|medium|high
reversibility: high|medium|low
next_investment_depends_on_it: true|false
```

## Prioriteringsregel

Test først antagelser med kombinationen:

```text
high impact if wrong
x high uncertainty
x high irreversibility of next investment
x low/moderate cost to learn
```

Dette er en praktisk Expected Value of Information-logik. Information har kun værdi, hvis den forventes at forbedre en reel beslutning, og den værdi skal holdes op mod testens cash cost, time cost og opportunity cost [D01][D02].

## Kill Assumption

Pretotyping.org formulerer det direkte som at isolere den ene assumption, der - hvis den er falsk - betyder, at idéen ikke er “The Right It” [S02]. Det er en stærk default. Stanford Lean LaunchPad arbejder parallelt med business-model hypotheses, customer evidence og explicit pass/fail learning frem for ren intern overbevisning [L02].

Men virkelige cases kan have flere uafhængige kill assumptions. Brug derfor:

1. `KILL-1`: den assumption der kan gøre næste investering meningsløs.
2. `KILL-2`: den næste mest kritiske, hvis KILL-1 består.
3. Resten parkeres i backloggen.

**Anti-pattern:** 14 parallelle tests af copy, logo, pricing, målgruppe og features før teamet ved, om nogen overhovedet vil købe kerneproduktet.

---

# 3. Fra fuzzy belief til XYZ-hypotese

Savoias XYZ-format er en af metodens stærkeste komponenter:

> `At least X% of Y will do Z.`

Hvor:

- `X` = minimumsandelen, der skal engagere sig,
- `Y` = en præcist defineret population,
- `Z` = en observerbar handling [S01][S03].

Eksempel:

```text
At least 8% of Danish accounting firms with 10-50 employees
who see the offer during the test window
will book a 30-minute implementation call
at a stated starting price of DKK 4,000/month.
```

## X må ikke være pynt

X skal så vidt muligt komme fra minimum viability, ikke fra “det lyder flot”.

Simplificeret:

```text
required_customers = required_contribution / contribution_per_customer
required_response_rate = required_customers / realistically_reachable_population
```

Hvis testen ligger tidligere i funnel:

```text
required_top_funnel_rate
= required_paid_customers
  / (reachable_population
     x downstream_conversion_1
     x downstream_conversion_2 ...)
```

Alle downstream rates med høj usikkerhed skal markeres som assumptions. Man kan ikke validere et stort marked ved at gange fem optimistiske gæt sammen.

## Z skal være adfærd

Svagt Z:

- “synes idéen er interessant”
- “siger de ville bruge den”
- “giver 8/10 i survey”

Stærkere Z:

- klikker for at se pris,
- efterlader verificerbar kontaktinfo,
- booker en tid,
- uploader eget materiale for at få output,
- accepterer tilbud,
- betaler depositum,
- pre-orderer,
- underskriver en konkret LOI med specificeret scope,
- starter en paid pilot,
- bruger produktet igen efter 7/30/90 dage.

## MEH og XYZ

Savoias Market Engagement Hypothesis (MEH) er den menneskelige forklaring på markedstesen. XYZ er dens talmæssige testversion [S03].

Brug begge:

```yaml
meh: "Små ejendomsadministratorer bruger uforholdsmæssigt meget tid på gentagne lejerhenvendelser og vil betale for at automatisere første svar med egen ejendomsviden."
xyz: "At least 15% of property managers with 100-1000 units contacted in the test will book a demo after seeing a concrete DKK 3,500/month offer."
```

## Hypozooming

XYZ er ofte for stort til første test. Hypozoom derfor i:

- `space`: ét sted/segment/channel,
- `time`: én konkret periode,
- `scope`: én smal use case,
- `population`: én repræsentativ undergruppe.

Det centrale er at gøre testen billig uden at ændre den kausale mening. Savoias Provincial-metode og planning canvas følger samme logik [S01][S03].

**God hypozoom:** “tyske Shopify-butikker med 5-20 ansatte rekrutteret via samme type channel, som senere skal bære salget.”

**Dårlig hypozoom:** “mine 12 venner på LinkedIn”, hvis produktet skal sælges til procurement-led teams i tyske industrivirksomheder.

---

# 4. Evidence hierarchy: ikke al data er lige stærk

Pretotyping har ret i, at “data beats opinions”. Tim Vang/preeto-materialet lægger tilsvarende vægt på **actual usage/revealed behavior** og markedsvalidering som forbindelsen mellem idé og større udviklingscommitments [T01]. Golden standard er mere præcis:

> **Decision-relevant behavioral evidence beats low-consequence stated evidence, alt andet lige.**

Forskning i willingness-to-pay finder en systematisk hypothetical bias. En meta-analyse af 77 studier fandt, at hypotetisk WTP i gennemsnit overvurderede reel WTP med omkring 21%, men størrelsen varierede efter metode og produkt [M01]. Tallet må ikke bruges som en universel “minus 21%”-korrektion. Pointen er, at hypothetical answers ikke er det samme som real exchange.

## Evidence ladder

| Level | Evidens | Eksempel | Typisk brug |
|---|---|---|---|
| **E0** | Intern mening | “Vi tror markedet vil elske det” | Hypothesis generation |
| **E1** | Ekstern mening | ekspert/fokusgruppe | Discovery, risici |
| **E2** | Stated intent | survey: “vil du købe?” | Directional only |
| **E3** | Low-cost behavior | ad click, feature click | Initial Level of Interest |
| **E4** | Identity/time commitment | email, booking, application, upload | Stronger interest/qualification |
| **E5** | Economic commitment | refundable deposit, preorder, paid pilot | WTP/demand |
| **E6** | Actual usage | opgave gennemført med Concierge/MTurk/working slice | Usage fit |
| **E7** | Ongoing usage/economics | repeat purchase, retention, renewal, recurring paid use | OLI/viability |
| **E8** | Replicated representative evidence | flere cohorts/geos/channels eller randomized comparison | Scale confidence |

Ladderen er **ikke** en mekanisk pointscore. En booking med falsk urgency kan være dårligere evidens end en ærlig survey; 100 paid pilots fra eksisterende superfans kan være mindre generaliserbare end 30 fra en repræsentativ cold-market sample.

## Fire dimensioner for evidensstyrke

Vurder hvert datapunkt på:

1. **Behavioral commitment:** Hvad kostede handlingen personen i penge, tid, effort, reputation eller opportunity cost?
2. **Context realism:** Hvor tæt var situationen på den reelle købs-/brugssituation?
3. **Population representativeness:** Ligner testpersonerne den population, beslutningen handler om?
4. **Causal cleanliness:** Kan resultatet skyldes andre ændringer end den treatment, vi tror vi tester?

## Skin in the game

Savoias planning canvas beskriver “skin in the game” som noget af værdi, markedet giver som evidens - penge, tid, email, telefonnummer mv. - og peger på, at cash normalt er stærkere end email [S03].

Golden standard:

```text
Skin-in-the-game strength
= consequence of action
x realism of decision
x authenticity of participant
x relevance to final business model
```

En $1 refundable deposit kan være mere informativ end 10,000 likes. Men en symbolsk depositum kan stadig overvurdere demand til et produkt, der senere koster 50,000 DKK.

## Qualitative evidence

Interviews, support conversations og open text bruges til:

- at forstå hvorfor folk reagerede,
- opdage objections,
- forbedre testens fidelity,
- opdage ukendte segmenter,
- forklare drop-off,
- generere næste hypothesis.

De må **ikke** stå alene som bevis for “folk vil betale”. Purchase intentions er mest predictive under bestemte forhold og er generelt mere reliable for eksisterende produkter, konkrete brands og korte tidshorisonter end for helt nye produkter [M03].

## Interview- og survey-standard: discovery er ikke det samme som validation

Interviews og surveys er en vigtig del af market validation, men deres job skal være tydeligt. De er typisk bedst til **problem discovery, sprog, segmentforståelse, friktion, alternativer og forklaringer**. De er svagere til at bevise fremtidig køb/adoption, fordi svaret ikke nødvendigvis har nogen konsekvens for respondenten.

### Interview-standard

Spørg primært om:

- konkret tidligere adfærd: “Hvornår skete det sidst?”
- faktisk workflow og current alternative,
- hvad problemet kostede i tid/penge/risiko,
- hvad personen allerede har forsøgt,
- hvad der faktisk udløste en beslutning,
- hvor en konkret test/oplevelse brød sammen.

Undgå at behandle følgende som demand proof:

- “Synes du idéen er god?”
- “Ville du bruge den?”
- “Hvor meget ville du betale?” uden realistisk choice/commitment,
- feedback fra venner, kolleger eller andre, der ikke er en del af den population, beslutningen handler om.

### Survey-standard

Når survey-data faktisk skal sammenlignes eller kvantificeres:

- definér population og sampling frame før spørgsmålene,
- spørg kun om én ting ad gangen,
- brug kort, konkret og neutral wording,
- undgå ledende, emotionelle og double-barrelled spørgsmål,
- sørg for gensidigt udelukkende og dækkende svarmuligheder,
- randomisér rækkefølge/wording når order effects er en reel risiko,
- pretest med personer, der ligner målpopulationen,
- hold metode og wording stabilt, hvis ændringer over tid skal sammenlignes.

AAPOR anbefaler netop at starte med et specifikt research objective, vurdere om survey overhovedet er den rigtige metode, preteste instrumentet og kontrollere wording-, order-, mode- og response-bias [Q01]. Pew Research fremhæver tilsvarende, at wording, response options, question order og mode kan ændre svarene, og at pretesting er en essentiel del af questionnaire design [Q02]. U.S. Census behandler pretesting som en egentlig quality gate og fremhæver bl.a. cognitive interviews, respondent debriefing, usability tests og split-panel tests som metoder til at finde comprehension- og measurement-problemer [Q03].

### Questionnaire pretest gate

Før et survey-tal bruges til at ændre en investeringsbeslutning:

```text
1. Kan målpopulationen forstå spørgsmålet som tiltænkt?
2. Er response options dækkende og ikke-overlappende?
3. Er order/mode effects acceptable eller testet?
4. Er instrumentet pretestet på in-scope respondents?
5. Er wording og mode stabile nok til den sammenligning, vi vil lave?
```

Ved new-market entry skal **translation ikke antages at være measurement equivalence**. European Social Survey arbejder eksplicit med oversættelse, review, pretesting og dokumentation for at sikre, at data er sammenlignelige på tværs af lande og sprog [Q04]. Derfor skal lokaliseret copy/survey wording pretestes før forskelle mellem lande fortolkes som forskelle i demand.

**Golden rule:** Brug interviews/surveys til at gøre den næste behavioral test bedre. Opgrader dem kun til stærk validation-evidence, hvis designet faktisk måler den beslutning, du vil generalisere til.

---
# 5. Pretotyping toolbox: vælg efter spørgsmålet, ikke efter mode

Stanford/Savoias quick reference og *Pretotype It* beskriver en familie af teknikker, der alle forsøger at simulere en central del af den fremtidige kundeoplevelse med lav investering [S01][S04]. De skal behandles som et **værktøjskatalog**, ikke som en fast sekvens.

## 5.1 Fake Door

**Definition:** Skab et entry point til noget, der endnu ikke findes, og mål om målgruppen forsøger at gå ind ad døren.

Typiske moderne former:

- en “see plans” eller “start” CTA til en endnu ikke lanceret feature,
- landing page med konkret offer og pris,
- annonce til venteliste eller reservationsflow,
- et menupunkt i et eksisterende produkt,
- et sales outreach-offer med tydelig next step.

**Bedst til:** Initial Level of Interest, proposition, segment, price-framing, feature demand.

**Svaghed:** Måler ikke nødvendigvis usage, delivery quality, retention eller willingness to pay. En høj click rate kan være ren curiosity.

### To forskellige Fake Door-designs

**Transparent smoke test:** Personen ved, at produktet fx er “coming soon”, i beta eller åbent for waitlist/preorder. Det reducerer realism lidt, men har markant lavere deception- og trust-risk.

**Availability-simulating Fake Door:** Testen får produktet til at fremstå tilgængeligt nu og afslører først senere, at det ikke er det. Den kan være mere realistisk, men har højere legal, ethical og brand risk og bør ikke være default.

**2026 EU/DK-regel:** I EU-B2C kan falske oplysninger om et produkts eksistens, natur eller availability være en vildledende handelspraksis [L10]. Kommissionens UCPD-guidance siger desuden, at en “transactional decision” kan være så tidlig som at klikke på et link eller en annonce [L13]. Derfor er det ikke nok at antage, at en disclosure efter klikket automatisk reparerer en misvisende annonce.

Savoia anbefaler i sin opdaterede framing etiske, win-win Fake Doors og hurtig information til personer, der møder den falske dør [S01]. Golden standard i denne playbook er derfor:

1. foretræk en **transparent smoke test**, hvis den kan besvare spørgsmålet,
2. brug aldrig falsk scarcity, fake reviews eller skjult betaling,
3. hvis realism kræver at availability simuleres, få konkret legal/policy review før en B2C-test,
4. log complaint/trust cost som guardrail,
5. vælg Facade, preorder eller working slice, hvis samme learning kan opnås med mindre deception.

## 5.2 Facade

**Definition:** Præsenter en ikke-skaleret eller manuelt drevet løsning som om den havde den tilgængelighed eller backend, som den senere forventes at få.

CarsDirect-eksemplet i Stanford quick reference viser logikken: efterspørgslen testes med en front, mens leverancen skaffes manuelt bagved [S04].

**Bedst til:** Efterspørgsel + fulfillment proof uden fuld infrastruktur.

**Styrke:** Kan føre til faktiske transaktioner og derfor stærkere evidence end click-only tests.

**Risiko:** Hvis kunden får et andet produkt/serviceniveau end lovet, er testen ikke længere loyal mod value propositionen.

## 5.3 Mechanical Turk / Wizard of Oz

**Definition:** Erstat dyr eller endnu ikke udviklet teknologi med menneskelig udførelse, mens kunden oplever det ønskede outcome.

IBM speech-to-text-historien er det klassiske eksempel [S01][S04].

**Bedst til:** AI, automation, matching, recommendation, complex backends, operational software.

**2026 nuance:** Savoia bemærkede allerede i 2022, at moderne AI-værktøjer har reduceret build cost, men at en menneskelig simulation stadig ofte kan give de første markedsdata hurtigere [S01]. Golden standard er derfor ikke “always Mechanical Turk”, men at sammenligne faktisk cost/time til evidence.

**Risici:** hidden manual work kan skabe urealistisk latency, quality eller unit economics. Log derfor også:

- human minutes per transaction,
- quality variance,
- failure cases,
- what would need automation later.

## 5.4 Pinocchio

**Definition:** En fysisk eller digital ikke-fungerende representation, hvor brugeren forestiller sig manglende funktionalitet.

Palm Pilot-træblokken er det klassiske eksempel [S01][S04].

**Bedst til:** form factor, portability, habit trigger, placement, workflow, tactile behavior.

**Svaghed:** Kan teste self-use og context, men ikke nødvendigvis market demand fra andre.

## 5.5 Stripped Tease / functional slice

**Definition:** Byg en fungerende version med den absolut mindste funktionalitet, der er nødvendig for at teste den kritiske markedshypotese [S01].

**Bedst til:** Når faktisk usage er vigtig, eller når fake setup vil skabe for meget confounding.

**2026 relevance:** AI coding, no-code, APIs og commodity infrastructure kan gøre Stripped Tease til den hurtigste test. Men målet er stadig læring, ikke “nu har vi bygget MVP, så vi må hellere fortsætte”.

## 5.6 Provincial

**Definition:** Lever den reelle eller semi-reelle kerneoplevelse til et lille, repræsentativt område, segment eller online “neighborhood” [S01].

**Bedst til:** service, marketplace, lokal operations, country entry, constrained supply, repeat behavior.

**Styrke:** høj context realism.

**Svaghed:** external validity. Et lille marked kan være særligt nemt eller svært. Resultater skal ikke skaleres lineært uden replikation.

## 5.7 One-night Stand

**Definition:** Gør produktet eller servicen tilgængelig i et meget begrænset tidsvindue for at måle reel demand uden long-term commitment [S04].

**Bedst til:** events, hospitality, pop-ups, services, local offers, scheduled B2B workshops.

## 5.8 Pretend-to-Own

**Definition:** Lej, lån eller sublease de dyre aktiver, som senere ville blive ejet permanent [S01].

**Bedst til:** physical retail, fleet, equipment, property, production capacity.

**Regel:** Test demand under realistisk service, men gør capex reversibelt.

## 5.9 Impostor / Re-label

**Definition:** Brug et eksisterende produkt eller service, som er tæt nok på den tiltænkte experience til at simulere den nye idé [S04][S01].

**Bedst til:** form, bundle, positioning, packaging, service configuration.

**Risiko:** Hvis forskellen mellem stand-in og final product er central for value, tester man det forkerte.

## 5.10 Demo / “YouTube” pretotype

**Definition:** Vis den fremtidige experience gennem video, animation eller interaktiv demo, og kombiner den med en konkret commitment action [S04].

**Bedst til:** produkter der er dyre at bygge, men lette at demonstrere.

**Regel:** Video views er ikke validation. Testen starter først, når modtageren skal gøre noget, der repræsenterer interesse eller køb.

## 5.11 Infiltrator - legacy, high-risk

Savoias Stanford quick reference nævner en “Infiltrator”-teknik, hvor et artifact placeres i et eksisterende retailmiljø [S04].

**Golden-standard status:** `LEGACY / DO NOT USE WITHOUT AUTHORIZATION`.

Uautoriseret adgang, varemærke-/brandforvirring, sikkerhed, platform terms eller property rights kan gøre denne form uacceptabel. Brug i stedet et aftalt shelf test, consignment, pop-up eller retailer partnership.

## 5.12 Concierge

**Definition:** Lever slutresultatet manuelt og transparent som en premium human service.

**Bedst til:** B2B, service, AI-agent concepts, advisory, operations software.

**Forskel fra Mechanical Turk:** Concierge behøver ikke skjule, at et menneske leverer. Det kan derfor være mere etisk og samtidig give stærk evidence på outcome og WTP.

## 5.13 Paid pilot

**Definition:** En tidsbegrænset, konkret, betalt version af løsningen med klart scope.

**Bedst til:** B2B, enterprise, high-ticket service/software.

**Styrke:** kombinerer willingness-to-pay, procurement friction, usage og relationel commitment.

**Caveat:** Ét founder-led pilot sale beviser ikke repeatable sales. Det beviser, at mindst én kunde i den kontekst var villig til at betale.

## 5.14 Preorder / deposit

**Definition:** Kunden reserverer med reel økonomisk commitment før fuld levering.

**Bedst til:** physical products, events, consumer launches, limited capacity.

Reward-based crowdfunding fungerer ofte netop som pre-selling og kan generere information om demand, men succes på platformen påvirkes også af platform dynamics, signaling og campaign execution [M04][M05].

## 5.15 Waitlist / application

**Definition:** Kunden afgiver kontakt eller ansøgning om adgang.

**Bedst til:** tidlig ILI og audience building.

**Styrke:** billig og hurtig.

**Svaghed:** lav skin in the game. En venteliste kan være stor og stadig konvertere svagt til betaling.

## 5.16 LOI / memorandum / internal approval

B2B teams bruger ofte Letter of Intent.

**Evidence strength afhænger af detaljen:**

```text
"Looks interesting" < informal email intent < signed LOI with price/scope/date
< approved budget < purchase order / paid pilot
```

En ikke-bindende LOI er ikke revenue. Men den kan være stærk evidence for procurement intent, hvis den kræver intern stakeholder effort og specificerer kommercielle vilkår.

---

# 6. Pretotype vs prototype vs MVP: den rigtige boundary i 2026

Savoia skelner mellem:

- **Pretotype:** “Should we build it? Will enough people want/use it?”
- **Prototype:** “Can we build it? Will it work?” [S01]

Lean Startup bruger MVP bredere som et learning vehicle. Savoia anerkender overlap og beskriver pretotyping og Lean Startup som allierede [S01]. Steve Blank understreger tilsvarende, at MVP'et skal matche den hypothesis, man faktisk tester [L01].

## Golden-standard beslutningsregel

Vælg ikke artifact ud fra navnet. Vælg den, der maksimerer:

```text
Decision Value
= Relevant Information Gain
  x Experience Fidelity
  x Population Fidelity
  x Speed
  ------------------------------------------------
  Cash Cost
  x Irreversible Commitment
  x Ethical/Legal Risk
  x Confounding Risk
```

Det er en beslutningsheuristik, ikke en matematisk estimation.

## Brug pretotype når

- core uncertainty er demand eller usage, ikke technical feasibility,
- rigtig backend er dyrere eller langsommere end simulation,
- testen kan give realistisk behavior uden at bygge,
- næste investering er stor/irreversibel.

## Brug functioning MVP / Stripped Tease når

- en realistisk working slice kan bygges på timer/dage,
- den egentlige experience er nødvendig for at måle behavior,
- en Fake Door kun vil måle curiosity,
- AI/APIs/no-code gør simulationen næsten lige så dyr som det rigtige,
- transparency/consumer law gør fake setup unødigt risikabelt.

## Brug prototype når

- engineering feasibility er selve kill assumption,
- safety/reliability/performance er afgørende,
- user behavior kan ændres markant af teknisk performance,
- regulatoriske krav kræver faktisk funktion før test.

## Brug ikke “MVP” som undskyldning for overbygning

Et MVP bliver et productype, når teamet investerer i:

- skalerbar architecture,
- brede permissions,
- admin systemer,
- edge cases,
- multi-language,
- polished design,
- automation,
- features,

før disse elementer er nødvendige for næste market decision.

## AI ændrer threshold, men ikke logikken

Nyere feltstudier af generativ AI viser heterogene productivity-effekter: tre store workplace coding experiments fandt i gennemsnit flere completed tasks med AI, mens et 2025 RCT blandt meget erfarne open-source udviklere på egne mature repositories fandt en slowdown. METR måtte i 2026 ændre opfølgningsdesignet pga. adoption/selection effects [AI01][AI02].

**Playbook-regel:** Hardcode ikke “AI gør build 10x hurtigere”. Estimér faktisk time-to-evidence for den konkrete test.

---

# 7. Method selection matrix

| Validation question | Stærk default | Alternativer | Undgå som eneste evidence |
|---|---|---|---|
| Er der initial demand? | Fake Door + konkret CTA | ad/landing, demo + booking | survey likes |
| Hvem responderer? | Provincial tests på definerede segments | channel split, outreach cohorts | brede demographics uden behavior |
| Vil de betale? | preorder/deposit/paid pilot | randomized price test | “hvad ville du betale?” alene |
| Vil de bruge det? | Concierge / Mechanical Turk / working slice | Pinocchio ved physical behavior | concept interview alene |
| Vil de bruge det igen? | OLI cohort / repeat transactions | recurring Concierge | one-off signup |
| Hvilken proposition virker? | randomized A/B treatment | sequential test med stærke controls | raw before-after |
| Hvilken pris fungerer? | real price choice / transaction | incentive-aligned choice | hypothetical WTP alene |
| Nyt land/segment? | local Provincial + paid behavior | localized Fake Door + paid pilot | oversættelse af gammel survey |
| B2B procurement? | paid pilot / PO / specific LOI | booked meeting + budget confirmation | positive demo feedback |
| Marketplace liquidity? | small geography/category with manual matching | waitlist + manual supply | total signups uden match rate |
| Physical retail? | authorized shelf/pop-up test | Pretend-to-Own | unauthorized “infiltrator” |
| AI/automation backend? | Concierge/Mechanical Turk | small real agent if cheaper | synthetic users |

---

# 8. Experimental design standard

Et pretotype er først et eksperiment, når designet gør resultatet fortolkeligt.

## Experiment card

```yaml
experiment_id:
decision_question:
assumption_id:
meh:
xyz_hypothesis:
population:
inclusion_criteria:
exclusion_criteria:
recruitment_channel:
treatment:
control_or_comparison:
randomization_unit:
primary_metric:
secondary_metrics:
guardrails:
minimum_material_effect:
pass_threshold:
fail_threshold:
inconclusive_zone:
planned_sample_or_information_target:
planned_duration:
stopping_rule:
expected_confounders:
data_quality_checks:
ethics_legal_review:
max_budget:
max_time_to_data:
decision_if_pass:
decision_if_fail:
decision_if_inconclusive:
```

## Test én beslutning

“Only change one variable” er for simpelt.

### Mechanism test
Hvis spørgsmålet er “ændrer pris alene conversion?”, hold resten så stabilt som muligt.

### Treatment test
Hvis spørgsmålet er “er proposition B bedre end A?”, må hele coherent propositionen ændres, hvis det er det, virksomheden faktisk vil shippe.

### Market test
Hvis spørgsmålet er “vil tyskerne købe vores danske produkt?”, må oversættelse, local proof og currency ændres, fordi de er nødvendige dele af treatmenten. Men teamet skal ikke bagefter konkludere, at én enkelt tekstlinje var årsagen.

## Control groups

Brug control når:

- du vil estimere causal difference,
- traffic/sample er stort nok,
- behandlingerne kan køre parallelt,
- spillover mellem grupper er lav.

Control er mindre vigtigt, når testen er en absolut threshold-test:

```text
"Vil mindst 20% af 30 target accounts acceptere paid pilot offer?"
```

Her kan det primære spørgsmål være, om rate sandsynligvis ligger over viability threshold, ikke om Variant A slår B.

## Randomization

Randomisering reducerer selection bias og gør treatment-grupper sammenlignelige i expectation [E01].

Randomiser på den enhed, hvor treatment gives:

- user,
- company/account,
- store,
- geography,
- session.

Hvis users inden for samme company påvirker hinanden, kan user-randomization være forkert. Cluster randomization reducerer ofte power, fordi den effektive sample size bliver antallet af clusters, ikke antallet af individuelle users [E06].

## Interference, spillovers og shared constraints

Standard A/B-logik antager ofte, at treatment af én enhed ikke ændrer control-enheders outcome. Den antagelse kan bryde i:

- marketplaces med fælles supply/inventory,
- booking- og capacity-constrained services,
- teams/netværk hvor users påvirker hinanden,
- referral/social products,
- pris- eller rankingtests hvor én gruppes adfærd ændrer mulighederne for den anden.

I two-sided marketplaces kan denne **interference** skabe biased treatment effects ved simpel buyer- eller supplier-randomization. Stanford/Airbnb-forskning viser, at hvilket randomization design der er mindst biased afhænger af market balance og den side, hvor constrainten ligger [E15]. Ved stærke temporal/shared-capacity spillovers kan cluster-, geo-, two-sided- eller switchback-design være mere passende; switchback-design kræver samtidig håndtering af carryover mellem perioder [E16].

**Golden rule:** Før en kausal market test, spørg ikke kun “kan vi randomisere?” men også:

```text
Can treated units change the opportunities or outcomes of control units?
```

Hvis ja, skal interference være en eksplicit del af designet. En pæn p-value fra forkert randomization unit reparerer ikke spillover bias.

## A/A test

Ved større online validation setups kan A/A tests afsløre:

- tracking bugs,
- sample ratio mismatch,
- assignment leakage,
- baseline metric instability.

Det er overkill for en 20-kunde Concierge test, men stærkt ved automatiserede funnels med høj traffic.

---
# 9. Data architecture: collect only data that can change a decision

Brugerens vigtigste udvidelse til klassisk pretotyping er helt central: **det er ikke nok at få data; man skal kunne læse dem rigtigt og træffe den rigtige beslutning på dem.**

Pretotyping uden data discipline bliver bare hurtig aktivitet.

## 9.1 Metric tree

Start med decision outcome og arbejd baglæns.

### Consumer purchase

```text
Eligible exposure
-> noticed / clicked
-> viewed offer
-> expressed commitment
-> paid / deposited
-> fulfilled
-> repeated / retained
-> contribution
```

### B2B

```text
Target account
-> relevant contact reached
-> meaningful response
-> discovery/demo
-> commercial proposal
-> accepted pilot / LOI
-> paid pilot
-> expanded / renewed
```

### SaaS

```text
Qualified visitor
-> signup
-> activation
-> repeated core action
-> paid
-> retained
-> expansion
```

### Marketplace

```text
Demand-side qualified user
-> request
-> match available
-> match accepted
-> transaction
-> repeat

Supply-side qualified provider
-> onboarded
-> available
-> matched
-> fulfilled
-> returns
```

## 9.2 Denominator discipline

En ratio er kun så god som sin denominator.

Savoias ILI er:

```text
ILI = actions_taken / opportunities_for_action
```

[S01].

Men “opportunities” skal defineres korrekt.

### Dårlig denominator

```text
bookings / total ad impressions
```

hvis halvdelen af impressions aldrig blev viewable og målgruppen ikke er verificeret.

### Bedre layered metrics

```text
Ad CTR = clicks / measurable impressions
Landing conversion = qualified actions / landing sessions
Booking conversion = completed bookings / eligible offer viewers
Paid conversion = payments / users shown real payment decision
```

Når et funnel lag er uklart, behold flere ratios i stedet for at presse alt ind i ét tal.

## 9.3 Raw counts + rates

Rapportér begge:

```text
n = 7 paid pilots out of 24 qualified offers = 29.2%
```

Ikke kun “29.2%”. En rate uden sample size skaber falsk præcision.

## 9.4 Confidence intervals

Hvis resultatet er en binær rate, rapportér interval - især ved små samples.

Eksempel:

```text
Observed conversion: 7/24 = 29.2%
95% Wilson interval: ca. 14.9%-49.2%
Business viability threshold: 20%
```

Pointen er ikke at ritualisere 95%. Pointen er at vise, hvor upræcis estimatet er. Ved små binære samples bør teamet ikke automatisk bruge det naive symmetriske Wald-interval. NIST fremhæver Wilson/Jeffreys-lignende metoder som bedre defaults ved små `n`; Wilson er bl.a. anbefalet ved `n <= 40` i deres binomial guidance [E09].

**Decision implication:** 29.2% ser umiddelbart højere ud end en 20% viability threshold, men intervallet omfatter også værdier under threshold. Resultatet kan derfor være lovende uden endnu at være stærkt nok til en stor irreversibel investering.

## 9.5 Sample size: ingen magisk N

Der findes ikke en universel “100 responses er nok”. Required sample afhænger af:

- effect size eller viability threshold,
- variance/base rate,
- acceptable false positive risk,
- acceptable false negative risk,
- randomization unit,
- beslutningens konsekvens.

NIST beskriver samme princip: sample size kan ikke bestemmes uden antagelser om bl.a. alpha, beta/power og variation [E08].

### Golden standard

Før større A/B tests:

```text
Define Minimum Material Effect (MME)
-> estimate baseline
-> choose error tolerance / power
-> compute required sample
-> check if sample is realistically attainable
```

Hvis testen ikke kan detecte en effekt, der er stor nok til at ændre beslutningen, er designet uegnet.

## 9.6 Minimum Detectable Effect vs Minimum Material Effect

- **MDE/DTE:** Hvad kan testen statistisk opdage?
- **MME:** Hvad er stort nok til, at virksomheden faktisk vil handle?

Et godt design kræver:

```text
MDE <= MME
```

Microsofts experimentation-forskning fremhæver metric sensitivity og minimum detectable treatment effect som centrale pre-test spørgsmål [E05].

## 9.7 Power og “no result”

Hvis en underpowered test giver `p > 0.05`, kan konklusionen være:

```text
"Vi har ikke nok information til at skelne en business-relevant effekt fra nul"
```

ikke:

```text
"Variant B virker ikke"
```

## 9.8 Practical significance

Spørg altid:

```text
Hvis den sande effekt ligger ved den bedste realistiske estimate,
ændrer det så vores investeringsbeslutning?
```

Hvis nej, er statistical significance sekundær.

## 9.9 No universal 5% rule

Et klassisk `p < 0.05`-threshold er en convention, ikke en validation-lov. American Statistical Association understreger, at p-values ikke angiver sandsynligheden for at hypotesen er sand, at beslutninger ikke bør baseres alene på om en bestemt grænse passeres, og at statistical significance ikke måler effect size eller praktisk vigtighed [E13].

Risk tolerance bør i stedet afspejle beslutningen:

- en 500 DKK reversible smoke test,
- et 50 mio. DKK factory commitment,
- en healthcare intervention,
- et reversible software experiment.

Rapportér derfor mindst:

```text
point estimate
+ uncertainty interval
+ minimum material effect
+ false-positive consequence
+ false-negative consequence
+ decision if wrong
```

P-values kan fortsat være nyttige som ét uncertainty-signal, når de bruges korrekt [E13]. De er bare ikke en selvstændig market-validation score.

---

# 10. A/B og split testing: når du faktisk vil sammenligne A mod B

A/B tests er en del af market validation, men kun når spørgsmålet er komparativt og en randomiseret treatment er muligt.

## 10.1 Hvornår A/B er den rigtige metode

Brug A/B til:

- proposition A vs B,
- price A vs B,
- landing treatment A vs B,
- CTA/wording når microcopy faktisk er beslutningen,
- current product vs new feature,
- onboarding flow,
- proof type,
- offer structure.

Online controlled experiments kan etablere causal effect gennem randomisering og er en central standard i moderne digital product development [E01].

**Scope rule:** Et A/B-resultat besvarer en **comparative causal question i den testede population og periode**. Det beviser ikke i sig selv, at markedet er stort nok, at economics virker ved scale, eller at samme treatment vinder i et andet land/channel.

## 10.2 Hvornår A/B er den forkerte første metode

Undgå at starte med A/B hvis:

- du har 20 relevante prospects per quarter,
- begge variants er dårligt definerede,
- den reelle uncertainty er “vil nogen overhovedet betale?”,
- traffic er så lav, at meaningful effects ikke kan detekteres,
- spillover mellem treatments er høj,
- sales rep'en ændrer pitch forskelligt i hver celle uden tracking.

## 10.3 Wording: test mening før ord

Validation teams kan bruge uger på:

```text
"Start now" vs "Get started"
```

mens de ikke ved, om nogen vil have produktet.

Test hierarchy som default:

1. Core offer / transaction
2. Segment / use case
3. Price / economic exchange
4. Promise / value mechanism
5. Proof / risk reversal
6. Major message framing
7. Funnel friction
8. Microcopy

Microcopy er relevant, når decision value faktisk ligger der. Men den bør normalt ikke komme før proposition-level uncertainty.

## 10.4 Message fidelity

Den bedst konverterende wording er værdiløs som validation, hvis den lover noget det planlagte produkt ikke leverer.

Hver treatment skal være:

- truthful,
- materially representative,
- understandable,
- similar nok til den faktiske future experience.

**Anti-pattern:** “AI does all your accounting automatically” konverterer højt, mens det planlagte produkt kun kategoriserer receipts. Det er validation af en anden idé.

## 10.5 Guardrail metrics

En test kan vinde på primary metric og skade resten.

Eksempel:

```yaml
primary: paid_conversion
secondary:
  - qualified_lead_rate
  - refund_rate
guardrails:
  - complaint_rate
  - support_burden
  - opt_out_rate
  - fulfillment_failure
```

## 10.6 Sample Ratio Mismatch

Hvis A/B-testen skulle fordele 50/50, men reelt har en uforklarlig skævhed, skal resultatet mistænkes. Microsoft beskriver Sample Ratio Mismatch som et centralt symptom på data quality/assignment-problemer, der kan vende konklusioner [E03].

## 10.7 Peeking og early stopping

Ved klassisk fixed-horizon inference gør “check hver time og stop når `p < .05`” den oprindelige inferens upålidelig, fordi sample size i praksis bliver valgt ud fra data. Johari et al. viser netop, hvorfor continuous monitoring kræver sequential/always-valid inference eller en anden korrekt kalibreret stopping procedure [E14].

Brug én af:

- pre-defined sample/duration og fixed-horizon analyse,
- et pre-specified sequential design / always-valid inference,
- en på forhånd defineret Bayesian decision rule, **som er kalibreret til den konkrete beslutning og loss function**.

“Bayesian” er ikke i sig selv en tilladelse til at stoppe vilkårligt. Stopping rule, prior sensitivity og decision threshold skal være dokumenteret, hvis de bærer beslutningen.

Stop altid tidligere for:

- safety,
- legal/compliance,
- severe customer harm,
- spend runaway,
- broken tracking,

men ikke blot fordi dashboardet kortvarigt ser godt ud.

## 10.8 Multiple testing

Hvis du tester 20 varianter og kun rapporterer den bedste, stiger sandsynligheden for et tilfældigt “win”. Stanford Statistics fremhæver multiple testing som en direkte kilde til false positives og p-hacking [E10].

Mitigation:

- prioriter få high-value hypotheses,
- preregistrér primary comparison,
- korrigér family-wise/FDR når relevant,
- repliker “winners” på fresh sample.

## 10.9 Variance reduction

Ved store digitale experiments kan pre-period covariates og CUPED-lignende metoder øge power uden at øge sample, når de bruges korrekt [E11].

Det er **advanced implementation**, ikke core pretotyping. Brug det kun, når teamet har en moden experimentation stack.

---

# 11. Data quality: før analyse, bevis at data kan stole på

Et experiment bliver ikke stærkt af designetiketten alene. Telemetry, assignment, denominator og event-definitioner skal være valide, før resultater fortolkes [E02][E03].

## Pre-analysis checklist

- Er tracking eventet det, vi tror det er?
- Er denominators komplette?
- Er duplicate events fjernet?
- Er bots/internal traffic fjernet hvor relevant?
- Er participants faktisk i target population?
- Er timestamps/timezones korrekte?
- Er price/offer ens i alle relevante exposures?
- Er randomization intakt?
- Er missing data asymmetrisk mellem treatments?
- Er treatment leakage/spillover sandsynlig?
- Er sample ratio som forventet?
- Er platform attribution/blokerede cookies en faktor?
- Er testperioden ramt af outage, holiday, promotion eller inventory issue?

Hvis measurement er brudt, er “resultatet” ikke market evidence.

## Data integrity states

```text
VALID -> analyze
QUESTIONABLE -> analyze with explicit caveat / rerun if material
BROKEN -> no business conclusion
```

---

# 12. Reading data: fra observation til forklaring

Et datapunkt kan være korrekt og stadig fortolkes forkert. Experimentation-litteraturen dokumenterer en række metric-interpretation pitfalls, hvor et tilsyneladende klart movement kan skyldes denominator shifts, instrumentation eller andre mekanismer end den historie teamet først fortæller [E04].

## 12.1 Fire spørgsmål

For hvert resultat:

1. **What happened?**
2. **How uncertain is the estimate?**
3. **What else could explain it?**
4. **Would the result survive in the real business context?**

## 12.2 Example: Fake Door

```text
10,000 impressions
500 clicks
100 landing CTA clicks
20 deposits
```

Mulige rates:

```text
Ad CTR = 5%
Landing-to-CTA = 20%
CTA-to-deposit = 20%
Impression-to-deposit = 0.2%
```

Den stærkeste evidence er deposit events, men hver transition fortæller noget andet.

Mulige fortolkninger:

- lav CTR + høj deposit conversion: product may be strong for a niche, creative/targeting weak.
- høj CTR + lav deposit: curiosity or mismatch.
- høj CTA + payment failure: technical issue, not market failure.
- stærk deposit rate fra warm audience: demand exists in that cohort, but cold-market transport unknown.

## 12.3 Do not average unlike data

Sammenlæg ikke:

```text
Facebook click rate + sales meeting close rate + survey intent
```

til ét “validation score”. De måler forskellige events.

Bevar evidence streams separat.

## 12.4 Hvornår pooling giver mening

Pool kun når tests er tilstrækkeligt ens på:

- population,
- treatment,
- outcome definition,
- price,
- observation window.

Ved flere comparable randomized tests kan en meta-analytic eller hierarchical model være relevant. Ellers er narrative triangulation mere ærlig end falsk matematisk præcision.

## 12.5 Sammenligning på tværs af kanaler og tests

Når data kommer fra forskellige kanaler eller testdesigns, skal teamet først afgøre, **hvad der faktisk kan sammenlignes**.

Eksempel:

```text
Google Search: 300 clicks -> 30 paid deposits
Paid Social: 1,000 clicks -> 40 paid deposits
Outbound: 50 conversations -> 12 paid pilots
```

Det er meningsløst at vælge “vinderen” ud fra click rate eller rå counts alene. Search, social og outbound starter med forskellig intent og forskellige denominators.

Brug denne reconciliation-proces:

1. **Define common outcome:** fx qualified deposit, paid pilot eller retained customer.
2. **Preserve native denominator:** impression, eligible account, conversation, visit osv. må ikke skjules.
3. **Build the funnel:** rapportér transition rates hele vejen til det fælles outcome.
4. **Separate channel effect from proposition effect:** hvis både audience, message og channel ændres, er channel en del af treatmentet.
5. **Compare economics where possible:** cost per qualified outcome, gross contribution og required volume kan være mere sammenligneligt end top-funnel rates.
6. **Keep heterogeneous evidence separate when needed:** B2B-paid pilots og consumer clicks skal ikke reduceres til ét “validation score”.

Hvis to tests har forskellig population, price, channel eller friction, er forskellen et nyt spørgsmål, ikke støj der bare skal gennemsnittes væk.

## 12.6 Segment cuts

Segmentanalyse er nyttig, men skaber multiple-testing risk.

Pre-specify de segmenter, der kan ændre beslutningen:

- geography,
- customer size,
- use case,
- new vs existing customer,
- industry,
- role.

Post-hoc segment wins er **hypothesis generation**, indtil de replikeres.

## 12.7 Survivorship bias

OLI kan se stærkt ud, hvis du kun følger de mennesker, der fortsætter og ignorerer dem, der droppede ud.

Kohort retention skal have original cohort som denominator:

```text
Week 4 retention = active in week 4 / activated in week 0
```

Microsofts forskning på long-term experiments fremhæver bl.a. survivorship og selection bias som centrale faldgruber [E12].

## 12.8 Novelty effect

Et nyt produkt kan have kunstigt høj initial engagement pga. nysgerrighed. OLI/retention er netop modgiften.

Det modsatte kan også ske: et nyt workflow kan kræve learning, så initial usage undervurderer mature value. Derfor skal den relevante adoption curve matches til den faktiske use case.

---

# 13. ILI moderniseret

Savoias Initial Level of Interest er et enkelt og stærkt instrument:

```text
ILI = actions / opportunities
```

[S01].

I moderne practice bør ILI gemmes som et **funnel vector**, ikke bare ét tal.

Eksempel:

```yaml
ili:
  eligible_exposures: 1200
  offer_views: 410
  clicks: 137
  qualified_actions: 44
  bookings: 18
  deposits: 6
```

## ILI strength

Vurdér både:

- `rate`
- `absolute count`
- `commitment level`
- `population quality`
- `cost of acquisition/reach`

## ILI does not prove OLI

Savoia understreger selv, at stærk initial interesse ikke er nok for produkter, der kræver repeat behavior [S01].

---

# 14. OLI moderniseret: retention, repeat behavior og cohort economics

Ongoing Level of Interest bør operationaliseres efter business model.

## Subscription

```text
activation
-> week 1 retention
-> month 1 paid retention
-> month 3 retention
-> renewal
```

## Marketplace

```text
first transaction
-> second transaction
-> transactions per active user
-> supply repeat rate
```

## Service

```text
first booking
-> show rate
-> repeat booking
-> referral
```

## B2B

```text
pilot usage
-> stakeholder adoption
-> pilot completion
-> paid expansion / renewal
```

## Physical consumable

```text
trial purchase
-> second purchase within natural replenishment window
-> third purchase
```

## One-time durable purchase

OLI may be less relevant. Use instead:

- actual purchase,
- cancellation/return,
- referral,
- observed use,
- willingness to recommend only as secondary.

## Do not import a universal retention benchmark

A meditation app, annual insurance product og industrial machine har helt forskellige natural frequencies.

OLI threshold skal komme fra:

```text
required lifetime economics
+ natural usage cadence
+ substitute behavior
+ category norms (diagnostic only)
```

---

# 15. Pricing og willingness to pay: valider exchange, ikke bare interesse

Et marked kan være interesseret i et produkt uden at være villigt til at betale nok til, at produktet er en forretning. Derfor er pricing ikke kun et senere GTM-spørgsmål. **Den økonomiske exchange er en del af market validation**, når prisen er central for viability.

## 15.1 Evidence ladder for price

Som default er evidensen stærkere jo tættere testen kommer på en reel, bindende beslutning:

```text
"Hvad synes du den bør koste?"
< "Ville du købe til 500 kr.?"
< forced choice mellem realistiske alternativer
< incentive-aligned choice
< book/pilot request ved konkret pris
< depositum / preorder
< faktisk køb
< faktisk køb + lav cancellation/refund + repeat/renewal
```

En meta-analyse af willingness-to-pay-studier finder systematisk forskel mellem hypotetisk og reel WTP, men størrelsen varierer med metode og produkt [M01]. Derfor må et gennemsnitligt bias-tal aldrig bruges som en universel “korrektionsfaktor”.

## 15.2 Fire price-validation modes

### A. Direct stated WTP

Bruges til:

- range discovery,
- vocabulary,
- objection discovery,
- at opdage åbenlyse reference points.

Må **ikke** stå alene som proof af betalingsvillighed.

### B. Gabor-Granger / stated price acceptance

Vis forskellige realistiske priser og spørg purchase likelihood eller ja/nej.

Godt til:

- tidlig prisfølsomhed,
- relative price bands,
- hypothesis generation.

Svaghed: stadig hypotetisk.

### C. Conjoint / discrete choice

Bruges når trade-offs mellem features, brand, service level og pris er centrale. Det er stærkere end et enkelt “hvad vil du betale?”-spørgsmål, fordi respondenten tvinges til at vælge mellem bundles. Men det er stadig stated preference, medmindre valgene har reel konsekvens.

Marketing Science-forskning viser, at incentive alignment og en reel sandsynlighed for faktisk køb kan forbedre demand forecasting fra choice data [M02].

### D. Behavioral price test

Vis et konkret offer til en realistisk population og mål faktisk commitment.

Eksempel:

```yaml
price_test:
  population: "new eligible visitors"
  variants:
    - 299_DKK
    - 399_DKK
    - 499_DKK
  primary_metric: contribution_per_eligible_visitor
  secondary:
    - purchase_rate
    - refund_rate
    - qualified_lead_rate
  guardrails:
    - complaints
    - support_load
    - fairness_risk
```

**Vigtig pointe:** Den bedste pris er ikke nødvendigvis den med højeste conversion rate.

```text
expected contribution per opportunity
= conversion_probability(price)
  x contribution_per_conversion(price)
```

## 15.3 Randomiser pris når kausal priselasticitet betyder noget

Hvis forskellige priser tilbydes i forskellige perioder, channels eller segmenter, kan forskellen skyldes populationen - ikke prisen.

Randomisering kan isolere price effect, hvis:

- det er lovligt og fair i konteksten,
- brugere ikke udsættes for vilkårlig skadelig forskelsbehandling,
- der ikke er høj risiko for screenshots/reputation,
- sample tillader inference.

Ved high-ticket B2B kan randomiseret website-pricing være meningsløst. Brug i stedet konkrete paid-pilot offers eller strukturerede sales experiments med dokumenteret segment og context.

## 15.4 Deposits og preorders

Et depositum er stærkt, fordi kunden giver afkald på noget af værdi. Men styrken afhænger af:

- om pengene faktisk trækkes,
- refundability,
- leveringshorisont,
- trust i brandet,
- hvor tydelig leveringsusikkerheden er,
- om kunden forventer scarcity.

Et 100% refundable deposit er stadig stærkere end et like, men normalt svagere end et endeligt køb med normal cancellation risk.

## 15.5 B2B willingness to pay

I enterprise/B2B er “ja, det er interessant” ekstremt billigt. Eskalér commitment:

```text
positive interview
-> intro til buying stakeholder
-> workshop med deres egne data
-> security/procurement time
-> pilot med named owner
-> paid pilot
-> signed order / contract
-> renewal / expansion
```

Et LOI kan være nyttigt, men klassificér det efter hvad det faktisk binder kunden til. Et uforpligtende dokument er ikke betaling.

## 15.6 Pricing rule

> **Valider ikke kun om nogen vil have produktet. Valider om tilstrækkeligt mange i den relevante population vil foretage den økonomiske exchange, som casen kræver.**

---

# 16. Decision thresholds: PASS, FAIL, INCONCLUSIVE eller INVALID

Et eksperiment uden en beslutningsregel producerer ofte bare en diskussion.

## 16.1 Fire outcome states

### PASS

Evidensen overstiger den prædefinerede business-relevante threshold med acceptabel uncertainty.

### FAIL

Evidensen ligger tilstrækkeligt under threshold til, at casen i den testede form ikke bør få næste investering.

### INCONCLUSIVE

Data er valide, men kan ikke skelne tilfredsstillende mellem PASS og FAIL.

### INVALID

Testen kan ikke fortolkes på grund af fx:

- forkert population,
- tracking failure,
- SRM,
- material implementation bug,
- offer/message mismatch,
- treatment contamination,
- alvorlig legal/ethical intervention undervejs.

**INVALID er ikke FAIL.**

## 16.2 Derive threshold fra viability - ikke fra internetbenchmarks

Eksempel:

Virksomheden kan maksimalt nå 20.000 relevante virksomheder i den valgte region. Forretningen kræver mindst 500 betalende kunder ved steady state.

En meget forenklet minimum market conversion er da:

```text
500 / 20,000 = 2.5%
```

Men hvis kun 40% realistisk kan nås gennem den testede distribution, bliver den relevante required conversion højere. Det betyder, at XYZ-hypotesens X bør udspringe af casen.

## 16.3 Decision band frem for knivskarp grænse

I stedet for:

```text
5.0% = go
4.9% = kill
```

brug fx:

```yaml
pass: "credible evidence consistent with >= 6%"
review_zone: "roughly 3-6%; depends on economics and uncertainty"
fail: "credible evidence inconsistent with required >= 3% floor"
```

De konkrete tal er business-specific. Pointen er at anerkende measurement uncertainty.

## 16.4 Decision loss: false positive vs false negative

Validation thresholds bør afspejle **hvad det koster at tage fejl i hver retning**.

```text
False positive:
Vi tror demand er tilstrækkelig -> investerer -> markedet er for svagt.

False negative:
Vi afviser/pivoterer -> markedet ville faktisk have været stærkt nok.
```

De to fejl er sjældent lige dyre. Derfor er “samme confidence threshold til alle beslutninger” dårlig praksis.

Eksempel:

- Reversible €2k test: false positive cost er lav -> teamet kan acceptere mere uncertainty og købe læring i næste tranche.
- €20m plant/capacity commitment: false positive cost er høj -> kræv stærkere, replikeret og mere transportabel evidence.
- Kort market window med stærk upside: false negative / delay cost kan være høj -> en alt for konservativ validation gate kan også ødelægge value.

**Golden rule:** Sæt evidence threshold efter **decision loss + reversibility + investment exposed**, ikke efter ritual.

## 16.5 Investment tranches

Validation bør styre **næste irreversible commitment**, ikke give en mytisk endelig dom over produktet.

```text
€500 test
-> €5k working pretotype
-> €25k prototype / pilot
-> €100k provincial launch
-> larger GTM investment
```

Hver tranche kræver stærkere evidens end den forrige.

## 16.6 Kill er ikke det samme som “idéen var dårlig”

Et FAIL kan betyde:

- forkert customer segment,
- forkert use case,
- forkert price,
- forkert offer,
- forkert timing,
- forkert delivery model,
- eller at core concept faktisk ikke har nok demand.

Beslutningen skal derfor være scoped:

> “FAIL for proposition A, price P, population Y, channel C, period T.”

ikke:

> “Markedet vil ikke have produktet.”

## 16.7 Pivot taxonomy

Hvis en test fejler, må teamet kun pivotere en dimension, hvis der er en **konkret alternativ hypotese**.

Mulige pivots:

- `CUSTOMER`
- `JOB / USE_CASE`
- `VALUE_PROPOSITION`
- `PRICE / COMMERCIAL_MODEL`
- `DELIVERY_MODEL`
- `CHANNEL_AS_TEST_CONTEXT`
- `GEOGRAPHY`
- `FEATURE_SET`
- `TIMING`

Undgå “random walk pivots”, hvor enhver negativ observation udløser en ny idé uden forklaring.

---

# 17. Market size og scaling inference: fra testpopulation til marked

Pretotyping måler respons i en konkret population. Forretningsbeslutningen handler ofte om en større population. Det hul skal håndteres eksplicit.

## 17.1 Bottom-up before top-down

En top-down TAM kan være nyttig kontekst, men validation bør starte med den markedskæde, der faktisk kan nås:

```text
eligible population
x realistically reachable share
x observed qualified response
x purchase / conversion rate
x retention / repeat rate
x contribution per customer
```

Hvert led har uncertainty.

## 17.2 Do not multiply point estimates blindly

Dårlig praksis:

```text
1,000,000 people x 5% conversion x 500 DKK = 25m DKK
```

Bedre:

- brug intervals/scenarios,
- gør selection bias synlig,
- korrigér ikke bare testens conversion med en mavefornemmelse,
- test den mest usikre multiplier næste gang.

## 17.3 Hypozooming

Savoias metode bruger “hypozooming”: gør en bred markedshypotese smallere og testbar, og zoom derefter gradvist ud [S02].

Praktisk:

```text
Broad hypothesis:
"SMV'er vil betale for dette."

Hypozoom 1:
"Danske bogholderibureauer med 5-25 ansatte..."

Hypozoom 2:
"...som håndterer >500 bilag/måned..."

Hypozoom 3:
"...vil starte en 30-dages paid pilot til 4,995 DKK."
```

Når det virker, zoom ud til en ny population og test transportability.

## 17.4 External validity

Et resultat kan være internt validt men eksternt dårligt generaliserbart.

Spørg:

- Er testpopulationen typisk eller extreme early adopters?
- Var channel unaturligt gunstig?
- Var price subsidized?
- Var founder selv sales-personen?
- Var delivery manuelt bedre end den skalerede version kan blive?
- Var testperioden sæsonmæssigt atypisk?
- Er nyt market kulturelt/regulatorisk anderledes?

Microsoft experimentation-research understreger, at eksperimentresultater ikke automatisk transporterer mellem populationer og kontekster [E07].

## 17.5 Replication ladder

Før stor skalering kan et kritisk fund styrkes gennem:

```text
same population, new cohort
-> same market, different channel
-> same channel, different period
-> adjacent segment
-> new geography
-> larger provincial launch
```

Det betyder ikke, at alt skal replikeres. Replikér især claims, som store irreversible investeringer afhænger af.

---

# 18. New-market entry validation: eksisterende produkt -> nyt land eller segment

At et produkt virker i Danmark validerer ikke Tyskland. Men det betyder heller ikke, at man skal starte helt forfra.

## 18.1 Treat transfer as a hypothesis

Eksempel:

```text
At least X% of German Y
will buy/use product Z at price P
under a locally credible proposition and purchase flow.
```

Det eksisterende hjemmemarked giver priors. Det nye marked skal give evidence.

## 18.2 Transfer assumption map

Test som minimum de antagelser, der kan bryde ved markedsskift:

| Dimension | Spørgsmål |
|---|---|
| Problem | Er problemet lige vigtigt i det nye marked? |
| Customer | Er samme buyer/user den rigtige? |
| Language | Kan propositionen forstås naturligt og troværdigt? |
| Trust | Kræves andre proof-signaler, brand eller lokale referencer? |
| Price | Er willingness to pay og reference price anderledes? |
| Alternatives | Hvilke lokale substitutes konkurrerer reelt? |
| Distribution context | Kan den samme type demand nås? |
| Regulation | Ændrer lovgivning, claims, contracts eller dataflows testen? |
| Operations | Kan service/delivery realistisk leveres? |

## 18.3 Semantic + measurement equivalence før conversion comparison

Ved new-market entry kan en dårlig oversættelse eller kulturelt forkert framing ligne “lav demand”. Før du sammenligner tyske og danske conversion rates, skal du sikre, at treatment faktisk betyder det samme i de to contexts.

Minimum gate:

- local-language review af en person med category/context forståelse,
- pretest af centrale ord, price framing, CTA og trust cues på in-scope target users,
- dokumentér væsentlige lokale adaptations,
- behold de **samme constructs**, men ikke nødvendigvis ord-for-ord copy,
- brug samme measurement definitions, hvis rates skal sammenlignes.

European Social Survey bygger cross-national comparability omkring netop translation, review, pretesting og documentation frem for simpel ordret oversættelse [Q04]. For market validation er princippet det samme: **en cross-country performance difference er først et demand-signal, når measurement og treatment er semantisk troværdige i begge markeder.**

## 18.4 Progressive market-entry validation

### Stage 1: local comprehension + problem evidence

- interviews/observation med target users,
- review/search/competitor evidence,
- copy comprehension.

Dette er discovery, ikke demand proof.

### Stage 2: demand signal

- lokaliseret Fake Door,
- lead/pilot request,
- partner/referral test,
- marketplace listing,
- preorder/deposit hvor relevant.

### Stage 3: transaction proof

- real purchase,
- paid pilot,
- Provincial launch i ét område/segment.

### Stage 4: repeat and economics

- retention/renewal,
- support/fulfillment cost,
- local CAC proxy,
- refund/cancellation,
- margins.

## 18.5 DK -> DE example

Antag et dansk B2B-produkt med dokumenteret dansk efterspørgsel.

Dårlig test:

> Oversæt website til tysk og sammenlign tysk CTR med dansk CTR.

Bedre test:

```yaml
market: Germany
segment: "independent accounting firms, 5-30 employees"
proposition: "localized concrete outcome"
price: "€X/month"
commitment: "book a 30-min qualification + accept paid pilot terms"
primary_metric: "qualified paid-pilot acceptance per eligible firm reached"
secondary:
  - meeting_show_rate
  - objection_distribution
  - sales_cycle_days
  - support/localization friction
replication:
  - city/region A
  - new cohort in region B
```

## 18.6 Keep validation separate from GTM

Market-entry validation skal bevise, at det nye marked er værd at investere i. Den skal ikke allerede løse hele:

- channel mix,
- sales organization,
- brand launch,
- media plan,
- partner strategy,
- scaling.

Når market assumptions er valideret nok, overtager GTM-playbooken.

---

# 19. Business-model validation modules

Den samme metode gælder på tværs. Men det stærkeste evidence er forskelligt.

## 19.1 B2B / enterprise

### Core risks

- buyer ≠ user,
- flere stakeholders,
- lange cycles,
- procurement/security kan blokere,
- verbal enthusiasm er billig.

### Strong evidence ladder

```text
interview
< stakeholder intro
< access to real workflow/data
< named internal owner
< signed pilot plan
< paid pilot
< procurement/security completion
< contract
< renewal/expansion
```

### Key metrics

- qualified acceptance rate,
- time-to-pilot,
- paid pilot conversion,
- active seats/workflows,
- stakeholder retention,
- pilot-to-contract,
- expansion/renewal.

### Common trap

Ti varme founder-intros er ikke samme population som scalable demand. Gem acquisition context.

## 19.2 SaaS / software

### Core risks

- signup curiosity,
- activation failure,
- shallow recurring use,
- free-user bias,
- cheap build causing premature feature expansion.

### Validation sequence

```text
Fake Door / demo interest
-> functioning slice or Mechanical Turk
-> activation
-> repeated core action
-> payment
-> retention
```

### Core metric

Definér én **core value event** før test. “Logged in” er sjældent nok.

## 19.3 AI product / agent

AI kan gøre demoer imponerende, men validation skal skelne mellem:

- fascination med AI,
- faktisk job completion,
- reliability,
- willingness to delegate,
- willingness to pay,
- ongoing trust.

Mål fx:

```text
task accepted by user
-> task completed to acceptable quality
-> user does not redo it manually
-> repeated delegation
-> paid continuation
```

## 19.4 Consumer / e-commerce

### Strong evidence

- actual purchase,
- margin-adjusted conversion,
- low refund/cancel,
- repeat for repeat categories.

### Common trap

Ad CTR validerer creative demand, ikke nødvendigvis product demand.

## 19.5 Physical product

### Core risks

- form factor,
- manufacturing cost,
- lead time,
- inventory,
- returns,
- tactile/fit issues.

### Useful methods

- Pinocchio,
- 3D print,
- Impostor/Re-label where honest and lawful,
- Pretend-to-Own production/equipment,
- preorder/deposit,
- tiny production run,
- pop-up / Provincial.

Hvis production setup er den dyre del, test demand før tooling. Hvis tactile experience er afgørende, en landing page alene er for svag.

## 19.6 Service / consultancy

Et servicekoncept kan ofte testes næsten direkte.

Brug:

- Concierge,
- One-night Stand,
- paid pilot,
- limited-capacity offer.

Mål:

- booking,
- show,
- paid completion,
- delivery hours,
- gross contribution,
- repeat/referral.

**Rule:** Når den faktiske service kan leveres manuelt på én dag, er det ofte bedre at levere den end at bygge en falsk servicefront.

## 19.7 Marketplace / two-sided platform

Den klassiske fejl er at teste begge sider som én samlet conversion.

Separate hypotheses:

```text
Supply: will enough suppliers list/accept?
Demand: will enough buyers transact?
Liquidity: can they match at acceptable speed/quality?
Repeat: will both sides return?
```

Test ofte én side manuelt først. Et Mechanical Turk/Concierge setup kan skabe “liquidity” før matching-engine bygges.

Når begge sider allerede er live, må demand- og supply-tests ikke automatisk behandles som almindelige uafhængige A/B-tests. Treatment på buyer-siden kan ændre availability for control-buyers; treatment af suppliers kan tilsvarende ændre matchmuligheder for control-suppliers. Det er klassisk marketplace interference [E15]. Ved shared capacity eller hurtige markeder kan switchback/tidsbaserede designs være relevante, men carryover skal modelleres og washout/treatment-perioder vælges bevidst [E16].

**Marketplace validation output bør derfor altid vise separat:**

```text
demand response
supply response
match / fill rate
time-to-match
transaction / fulfillment
repeat on both sides
interference / capacity note
```

## 19.8 Subscription / membership

Initial signup er svagt. Test:

- paid start,
- first value,
- renewal,
- cancellation,
- cohort retention,
- usage vs natural cadence.

## 19.9 Regulated / high-stakes products

Health, finance, safety, children, aviation og lignende kræver en højere barriere.

- Ingen deceptive pretotype, der kan påvirke sikkerhed eller behandling.
- Technical/product validation kan være nødvendig **før** realistic market exposure.
- Claims og consent skal vurderes særskilt.
- Ethical cost kan dominere speed.

Savoia understreger selv, at nogle pretotyping-teknikker ikke er passende i regulerede industrier [S01].

---

# 20. Channels som test environments - ikke som GTM-plan

En validation-test foregår altid et sted. Det sted påvirker data.

## 20.1 Search intent

Styrke:

- mennesker udtrykker eksisterende intent.

Godt til:

- problem/solution demand,
- high-intent Fake Door,
- price/offer tests.

Risk:

- overser latent demand,
- keyword population er selekteret,
- auction cost kan forvrænge economics.

## 20.2 Paid social

Styrke:

- hurtig access til broad/defined populations,
- god til message/offer exploration.

Risk:

- creative quality kan dominere product signal,
- platform targeting/delivery gør cells mindre transparente,
- clicks er ofte shallow.

## 20.3 Outbound / direct sales

Styrke:

- stærk til niche B2B,
- kan få konkrete objections og commitments.

Risk:

- founder selling skill,
- list quality,
- personalization,
- small samples.

Track hele denominator:

```text
eligible accounts
-> contacted
-> reached
-> replied
-> qualified
-> meeting
-> paid commitment
```

## 20.4 Communities

Styrke:

- dense target populations,
- rich qualitative feedback.

Risk:

- atypiske enthusiasts,
- group norms,
- moderator rules,
- reputational damage ved spam.

## 20.5 Marketplaces

Styrke:

- transacting users,
- natural competitive context.

Risk:

- marketplace ranking/fees,
- platform-specific trust,
- not portable to owned channel.

## 20.6 Physical retail / pop-up

Styrke:

- high-fidelity behavior for tangible goods/services.

Risk:

- footfall quality,
- location effects,
- weather/season,
- staff behavior.

Unauthorized “Infiltrator”-testing er ikke en 2026 default. Få permission.

## 20.7 Crowdfunding

Crowdfunding kan kombinere:

- proposition,
- price,
- social proof,
- preorder-like commitment.

Research viser, at market-validation information fra crowdfunding også kan være informativ selv ved kampagner, der ikke rammer funding-målet [M04]. Men campaign success er ikke automatisk proof af innovation eller langsigtet product-market fit [M05].

## 20.8 Channel interaction rule

> **Et validation-resultat validerer altid product × proposition × price × population × test environment.**

Channel må derfor gemmes som en del af learning scope.

---

# 21. AI i market validation 2026: accelerator, ikke sandhedsdommer

AI ændrer især **cost of experiment**, ikke evidensens grundlæggende logik.

## 21.1 Hvor AI kan skabe reel leverage

AI kan reducere Hours to Data ved at hjælpe med:

- landing pages og working slices,
- prototype code,
- mockups/video/demo,
- localization,
- ad/copy variants,
- survey/interview synthesis,
- transcript coding,
- data cleaning,
- exploratory analysis,
- experiment documentation,
- anomaly detection,
- simulation til planlægning.

Det kan gøre en tidligere dyr MVP billigere end en kompleks Fake Door.

## 21.2 Build-vs-fake threshold er dynamisk

Den praktiske regel:

```text
if working_version_cost <= credible_simulation_cost + small_delta
and working_version adds materially stronger evidence
and risk is acceptable:
    build working slice
else:
    simulate the minimum needed
```

Savoia bemærkede allerede i 2022, at billigere AI-værktøjer kan flytte denne grænse, selv om en Mechanical Turk ofte stadig kan give første markedssignal hurtigere [S01].

## 21.3 AI productivity er heterogen - mål jeres egen build cost

Der findes ikke én korrekt “AI gør software X% hurtigere”-antagelse.

- Tre randomiserede field experiments med 4.867 softwareudviklere fandt samlet højere task completion ved adgang til en coding assistant [AI01].
- Et mindre RCT med erfarne open-source udviklere på egne modne repositories fandt derimod langsommere completion med early-2025 AI tools [AI02].
- METR ændrede i 2026 designet til et opfølgende productivity-studie pga. selection effects, fordi flere udviklere ikke ville deltage uden AI [AI02].

**Konsekvens:** Brug jeres faktiske `hours_to_working_slice`, ikke et generelt AI-benchmark.

## 21.4 Synthetic users er ikke customers

LLM-personas kan være nyttige til:

- brainstorm af objections,
- copy stress-test,
- pilot af interviewguide,
- edge-case generation,
- prioritering af hvilke treatments der er værd at teste.

Men de kan ikke stå som markedsbevis.

Marketing Science-forskning fra 2026 finder, at LLM-data kan være værdifuld som **data augmentation**, når den kalibreres med menneskedata, mens naive substitutioner kan skabe bias [AI04]. Et Nature-studie fra 2026 finder, at LLM-baserede forecasts kan korrelere med social-science treatment effects, men systematisk overvurdere effect sizes i den undersøgte setting [AI03].

Derfor:

```text
AI prediction = prior / hypothesis aid
real target-market behavior = validation evidence
```

## 21.5 Cheap variants create a multiple-testing problem

Hvis AI kan generere 500 headlines på fem minutter, er 500 simultaneous tests ikke automatisk klogt.

Risici:

- multiple comparisons,
- winner's curse,
- shallow conceptual variation,
- tiny sample pr. treatment,
- post-hoc storytelling.

Brug AI til **hypothesis breadth**, men filtrér før live testing med:

- conceptual distinctness,
- business relevance,
- evidence need,
- expected value of information.

## 21.6 AI analysis rules

AI må gerne:

- skrive kode til analyse,
- foreslå alternative forklaringer,
- gruppere qualitative themes,
- generere charts,
- kontrollere consistency.

Men final decision skal kunne spores til:

- source data,
- transformation steps,
- metric definition,
- statistical assumptions,
- human-reviewable rationale.

Ingen “agent says PASS” uden evidence trail.

---

# 22. Ethics, consumer law, privacy og trust

Validation må ikke købe læring ved at påføre kunder urimelig skade eller deception.

## 22.1 Savoias own correction

Savoias 10th Anniversary Edition er vigtig her: han beskriver Fake Door som overused/misused og anbefaler, at personer der møder en fake door hurtigt informeres og behandles fair; han ændrede også sin gamle “fake it” framing til “test before you invest” [S01].

Det skal være playbookens baseline.

## 22.2 EU consumer-law constraint

EU's Unfair Commercial Practices Directive behandler en commercial practice som misleading, hvis den giver falsk eller vildledende information om bl.a. produktets **existence, nature eller availability** og påvirker en transactional decision [L10]. Kommissionens fortolkningsguidance gør samtidig klart, at en transactional decision ikke kun er et køb; det kan fx være at gå ind i en butik, bruge mere tid i et bookingflow eller klikke på et link eller en annonce [L13]. EU consumer guidance advarer desuden mod deceptive dark patterns som falsk urgency [L11].

Det betyder ikke, at enhver form for smoke test er forbudt. Det betyder, at en B2C-test, der får et ikke-eksisterende produkt til at fremstå aktuelt tilgængeligt, har en reel legal risk **allerede før checkout**. Transparent “coming soon”/waitlist, reel preorder eller en Facade er derfor ofte bedre defaults i EU. UCPD er en B2C-ramme; B2B-tests kan være reguleret af andre nationale marketing-, competition- og contract rules og skal vurderes separat.

Aktuel håndhævelseskontekst peger samme vej: en EU/CPC-sweep offentliggjort i marts 2026 identificerede bl.a. misleading scarcity/pressure selling og skjulte eller sene prisoplysninger som konkrete online consumer-law problemer [L14]. Det er ikke en ny pretotyping-regel, men en påmindelse om at “test copy” stadig er commercial practice, når den møder rigtige forbrugere.

## 22.3 Ethical Fake Door standard

Som default:

- gør testen transparent (“coming soon”, waitlist, beta, preorder), hvis læringsmålet tillader det,
- ingen falsk claim om lager/levering, som kunden med rimelighed stoler på,
- ingen skjult betaling for noget der ikke kan leveres,
- ingen fake reviews,
- ingen fake scarcity,
- ingen falsk “kun 2 tilbage”,
- ingen fake endorsements,
- ingen antagelse om, at “vi afslører det bare efter klikket” automatisk gør testen lovlig,
- let refund/undo, hvor penge eller reservation er involveret,
- tilbud gerne en reel kompensation/alternative value,
- log complaints og trust cost som guardrail.

Hvis samme læring kan opnås med en **Facade**, transparent preorder, waitlist eller working slice, foretrækkes den mindre vildledende løsning. Availability-simulerende B2C-tests bør have konkret legal/policy review.

## 22.4 Money handling

Hvis et pretotype accepterer betaling:

1. oplys tydeligt leveringsstatus og relevante vilkår,
2. tag kun betaling hvis virksomheden lovligt kan gøre det,
3. gør refund/cancellation enkel,
4. track finance reconciliation,
5. vær særligt forsigtig med preorders og lange leveringstider.

## 22.5 Privacy og tracking

I Danmark kræver brug af cookies og lignende teknologier som udgangspunkt samtykke; teknisk nødvendige teknologier behandles særskilt. Når teknologierne samtidig behandler personoplysninger, skal GDPR-kravene også opfyldes [L12].

Validation-teamet skal derfor ikke tænke:

> “Det er bare en test, så privacy gælder ikke.”

Data minimization:

- saml kun data der er nødvendig for beslutningen,
- undgå sensitive attributes uden klar legal basis og nødvendighed,
- pseudonymisér testdata hvor muligt,
- sæt retention,
- fjern PII fra learning logs,
- dokumentér consent/lawful basis.

## 22.6 Vulnerable users og high-stakes domains

Højere ethics gate ved:

- health,
- finance/credit,
- employment,
- housing,
- children/minors,
- safety-critical products,
- emergency services,
- sensitive personal situations.

I sådanne cases kan en mere transparent, lavere-fidelity test være bedre end en realistisk deceptive simulation.

## 22.7 Stanford-style ethics gate

Savoia beskriver et Stanford-princip om at stoppe, hvis testen ikke er lovlig, ikke er i tråd med policies/values, eller ikke tåler offentlighed [S01]. Operationalisér det:

```text
1. Is it legal?
2. Is meaningful harm plausible?
3. Is deception necessary for the learning?
4. Can the same learning be obtained more transparently?
5. Can participants easily undo/exit?
6. Would we defend the setup publicly?
7. Are vulnerable groups involved?
8. Is approval/legal review required?
```

Et “nej” til legalitet eller et uacceptabelt harm-signal = stop.

## 22.8 Public vs quiet/private validation

“Real-world” betyder ikke nødvendigvis “public to the whole internet”. Public tests kan skabe stærkere traction-signaler og reelle inbound responses, men de kan også afsløre progress, positioning eller mechanism til competitors. Nyere entrepreneurship research behandler netop **appropriability og competitive exposure** som en reel cost ved experimentation [A08][A09].

Vælg derfor visibility som en del af experiment design:

| Mode | Styrke | Risiko | Typisk brug |
|---|---|---|---|
| Public | Natural demand, acquisition/traction | imitation, signalling, reputation | low-secrecy consumer concepts, public waitlists |
| Bounded / invite-only | Real target behavior med kontrol | mere selection | B2B, beta cohorts, partner tests |
| Private paid pilot | Stærk commitment + høj confidentiality | lille sample | enterprise, easy-to-copy solutions |
| Quiet problem test | Lærer need/WTP uden at vise mechanism | indirect product evidence | high-appropriability-risk concepts |

**Rule:** Brug den laveste visibility, der stadig kan besvare den kritiske market question troværdigt.

---

# 23. Experiment portfolio og Value of Information

Den vigtigste validation-test er sjældent den mest interessante. Den er den, der bedst kan ændre den næste store beslutning.

## 23.1 Expected Value of Information

Decision theory beskriver værdien af information som forbedringen i forventet beslutningsværdi, informationen kan skabe. Expected Value of Perfect Information fungerer som en øvre grænse for, hvad det kan være rationelt at betale for mere viden [D01]. NIST fremhæver samtidig, at information både har benefit og cost [D02].

I praksis behøver et team ikke løse en fuld Bayesian decision model for hvert experiment. Brug en prioriteringsheuristik:

```text
EVI score ~
decision_importance
x current_uncertainty
x plausible_outcome_spread
x probability_test_changes_decision
/ (cash_cost + time_cost + opportunity_cost + trust_risk)
```

Det er en ranking aid, ikke en økonomisk sandhed.

## 23.2 High-EVI questions first

Eksempel:

- “Vil nogen betale?” = høj EVI før build.
- “Foretrækker de blå eller grøn CTA?” = lav EVI før demand er bevist.
- “Kan enterprise security overhovedet godkende dataflowet?” = høj EVI i enterprise SaaS.
- “Virker animationen bedre?” = lav EVI, hvis retention er kollapset.

## 23.3 Experiment backlog

```yaml
- assumption: "..."
  decision_if_false: "kill|pivot|redesign"
  uncertainty: high
  investment_exposed: 500000
  candidate_test: "paid pilot"
  estimated_hours_to_data: 72
  estimated_cash_cost: 10000
  evidence_strength: high
  legal_trust_risk: low
  evi_rank: 1
```

## 23.4 When to stop testing

Stop eller skift til execution når:

- central uncertainty er under business tolerance,
- næste test sandsynligvis ikke ændrer beslutningen,
- testens opportunity cost overstiger læringsværdien,
- market window er vigtigere end ekstra precision,
- same result er replikeret nok for den relevante investment tranche.

Nyere entrepreneurship research understreger boundary conditions og risikoen ved overprescription af “scientific approach” [A05]. En 2026-model af early-stage experimentation gør tradeoffet eksplicit: experimentation kan skabe information og adaptation, men kan også have appropriability- og execution costs [A08]. Competitive-exposure research viser tilsvarende, at public validation kan skabe traction samtidig med, at den afslører venture progress til potentielle rivals [A09].

## 23.5 Confidentiality / appropriability as a validation variable

Hvis idéen er let at kopiere, lead-time er central eller IP protection er svag:

- test med small/private cohorts,
- brug closed paid pilots,
- fragmentér information,
- test need/problem før revealing mechanism,
- adskil “market signal we need” fra “details competitor would need”,
- vurder om faster controlled launch er bedre end public Fake Door,
- sæt et **competitive exposure budget** for hvor meget favorable evidence/progress der må blive public før launch.

“Get out of the building” betyder ikke “publicér alt”.

---

# 24. Validation confidence model - uden falsk score

En samlet “82/100 validated” score er fristende, men kan skjule, at ét kritisk hul stadig er åbent.

Brug derfor en **confidence profile**, ikke et vægtet vanity score.

| Dimension | Low | Medium | High |
|---|---|---|---|
| Population fit | convenience sample | partly representative | target population / documented sampling |
| Behavioral proximity | opinion | concrete action | transaction / repeated behavior |
| Treatment fidelity | vague concept | realistic offer | core experience + realistic exchange |
| Causal clarity | observational | controlled-ish | randomized/strong causal design |
| Data quality | uncertain | mostly verified | instrumentation + integrity passed |
| Sample information | sparse | decision-useful | precise enough for material threshold |
| Replication | one-off | second cohort | multiple relevant contexts |
| Economics | unknown | modeled | observed transaction/contribution |
| Ongoing behavior | unknown | short follow-up | natural repeat/retention observed |
| External validity | narrow | adjacent evidence | validated in decision-relevant market |

## Critical-hole rule

Hvis en investment decision afhænger af en dimension, der stadig er `LOW`, må et højt resultat på andre dimensioner ikke “average it away”.

Eksempel:

- 10.000 clicks,
- stærk CTR,
- smuk A/B significance,
- **0 betalingsdata**,

kan stadig betyde lav confidence i WTP.

## Evidence statement template

```text
We have HIGH confidence that [population Y]
will [behavior Z] under [offer/price/context],
because [evidence].

We have LOW/MEDIUM confidence in [remaining assumption],
because [gap].

The next investment depends / does not depend on closing that gap.
```

---

# 25. Failure diagnosis: hvad fejlede egentlig?

Et negativt outcome er kun værdifuldt, hvis teamet kan lokalisere, hvad testen faktisk falsificerede.

## 25.1 Demand decomposition

For en simpel online test:

```text
eligible exposure
-> noticed / reached
-> understood
-> believed
-> wanted
-> accepted price
-> completed action
```

Low conversion kan skyldes et problem i hvert led.

## 25.2 Diagnostic signals

### Low exposure/reach

Mulig forklaring:

- channel/delivery problem.

Ikke nok data til at dømme concept.

### Exposure high, click/action low

Mulig forklaring:

- weak relevance,
- wrong population,
- poor proposition,
- weak creative/message,
- unattractive offer.

### Click high, commitment low

Mulig forklaring:

- curiosity,
- clickbait/mismatch,
- price,
- trust,
- friction,
- product details.

### Commitment high, usage low

Mulig forklaring:

- novelty,
- poor core experience,
- workflow friction,
- problem not recurring.

### Usage high, payment low

Mulig forklaring:

- weak monetizable value,
- wrong payer,
- free substitute,
- price/business model.

### Payment high, retention low

Mulig forklaring:

- overpromising,
- low realized value,
- one-time need,
- support/reliability problem.

## 25.3 Falsification hierarchy

Før teamet siger “market failure”, spørg:

1. Var target population korrekt?
2. Forstod de offeret?
3. Var artifact tro mod den forventede core experience?
4. Var price realistisk?
5. Var test channel en relevant context?
6. Var tracking/data valid?
7. Var sample informativt nok?
8. Er negative data konsistente på tværs af replications?

Hvis 1-7 er sunde og resultater gentages, stiger evidence for at core market hypothesis er forkert.

## 25.4 Do not rescue every failing idea

Diagnosis må ikke blive en mekanisme for evig rationalisering.

Anti-pattern:

```text
no clicks -> wrong headline
no signup -> wrong landing page
no purchase -> wrong price
no retention -> wrong onboarding
```

...gentaget uden pre-registered alternative hypotheses.

**Rule:** Hver “rescue iteration” skal forklare, hvorfor den nye treatment realistisk kan flytte resultater nok til at nå viability threshold.

---

# 26. Contradiction ledger: hvor market-validation-råd typisk går galt

## “80-90% af alle nye produkter fejler”

**Ikke en universel empirisk law.**

Savoias “Law of Market Failure” er nyttig som cautionary mindset, men product-innovation-litteraturen har specifikt kritiseret 80%+-failure-rate som en vedvarende myte [F01]. Failure rate afhænger af definitionen af “new product”, population, horizon og success criterion.

**Playbook:** brug ikke et generisk failure-tal til at beslutte et konkret venture. Brug base-rate humility + egen market evidence.

## “Surveys er ubrugelige” vs “spørg bare kunderne”

**Begge er for kategoriske.**

- Surveys/interviews er stærke til discovery, language, segmentation og explanations.
- De er svagere end revealed behavior til proving demand/WTP.

**Playbook:** brug stated data til at forstå og behavioral data til at validere.

## “Fake Door først” vs “byg MVP først”

**Ingen universel vinder.**

- Fake Door hvis core question er initial demand og real build er materially dyrere.
- Working slice hvis den er næsten lige så billig eller usage/retention er central.

## “Et klik er ikke data”

Forkert. Et klik er data.

Men det er **svag commitment data** og kan ikke stå alene for purchase demand.

## “Kun betaling tæller”

For kategorisk.

I nogle B2B- eller high-regulation situations kan procurement work, data access eller signed pilot commitment være meget stærkt, selv før penge kan skifte hænder.

## “Test én variabel ad gangen”

Kun når du vil isolere en mekanisme.

Et coherent treatment kan ændre flere ting, hvis business-spørgsmålet er hele proposition A vs B.

## “p < 0.05 = validated”

Forkert.

P-value siger ikke:

- at effect er business-material,
- at data er korrekt,
- at result transporterer,
- at mechanism er den antagede,
- at product economics virker.

## “Ingen signifikans = ingen effekt”

Forkert ved underpowered test [E05][E08].

## “Jo større sample desto bedre”

Kun hvis den ekstra information er værd at vente/betale for.

En stor, biased sample kan være værre end en lille, relevant sample.

## “10 interviews er validation”

Nej. Det kan være stærk discovery. Validation afhænger af adfærd, spørgsmål og beslutning.

## “Preorders beviser PMF”

Nej. De beviser en form for initial transactional demand i en specific context. Fulfillment, usage, repeat og scaling kan stadig fejle.

## “Fail fast” = lav mange fejl

Nej.

Savoias stærkeste formulering er økonomisk: god failure køber mere læring end den koster [S01].

## “More experimentation is always better”

Nej.

Experimentation har cash-, time-, adaptation-, imitation-, reputation- og opportunity cost. Peer-reviewed 2026-forskning formaliserer direkte, at experimental entry ikke er universelt optimal [A08], og public tests kan skabe competitive exposure [A09].

## “Public testing er altid bedre, fordi data er mere ægte”

Nej.

Public testing kan give natural traffic, traction og stærke behavioral signals, men kan også afsløre progress og mechanism til competitors [A09]. Quiet/private tests kan være rationelle, når de stadig giver tilstrækkelig evidence.

## “A/B test alle beslutninger”

Nej.

A/B er stærkt til comparative causal questions, men er ineffektivt ved sparse B2B traffic, helt ny category demand, store spillovers eller når den centrale uncertainty er purchase/usage overhovedet. Vælg method efter decision question, ikke efter prestige.

## “Bayesian/sequential betyder, at vi kan stoppe når vi vil”

Nej.

Continuous monitoring kræver en korrekt sequential/always-valid procedure eller en kalibreret decision rule [E14]. Et nyt statistisk label gør ikke post-hoc stopping valid.

## “AI kan validere idéen med synthetic personas”

Nej.

AI kan hjælpe med priors og testdesign. Actual market evidence kræver faktiske mennesker/organisationer fra den relevante population [AI03][AI04].

---

# 27. Anti-playbook: practices der aktivt skal undgås

1. At starte med “vi laver en landing page” før decision question er klar.
2. At validere en idé ved at spørge venner om de kan lide den.
3. At bruge “interested” som Z i en XYZ-hypotese uden defineret handling.
4. At vælge X efter testen er kørt.
5. At kalde enhver click-through “demand”.
6. At gemme rates uden rå numerator/denominator.
7. At sammenligne rå counts fra forskellige exposure-volumener.
8. At sammenligne to channels og kalde forskellen en product effect.
9. At sammenligne to priser i to forskellige perioder uden at nævne confounding.
10. At køre et underpowered A/B test og konkludere “ingen effekt”.
11. At p-hacke gennem mange metrics/segments.
12. At stoppe testen ved første positive spike uden valid sequential rule.
13. At ignorere Sample Ratio Mismatch.
14. At analysere data før instrumentation og assignment er verificeret.
15. At bruge statistical significance som eneste beslutningskriterium.
16. At importere en “god conversion rate” fra en anden branche.
17. At bruge 80-90% failure som præcist forecast.
18. At antage at hjemmemarket proof automatisk gælder nyt land.
19. At poole forskellige markets, priser og treatments uden grund.
20. At gemme qualitative quotes som om de var repræsentative prevalence-estimates.
21. At bruge synthetic AI respondents som replacement for customer data.
22. At generere hundredvis af AI-varianter og vælge den tilfældige winner.
23. At bygge en Fake Door når den fungerende service kan leveres manuelt i morgen.
24. At bygge seks ugers MVP, når en deposit-test kan besvare kill assumption på én dag.
25. At bruge deceptive scarcity, fake reviews eller falsk availability.
26. At tage betaling uden klare leverings-/refund-vilkår.
27. At samle PII “fordi det måske bliver nyttigt”.
28. At fortsætte tests fordi “mere data altid er bedre”.
29. At redde enhver negativ test med en post-hoc forklaring.
30. At kalde et concept “validated” uden at specificere population, offer, price, context og evidence strength.
31. At blande technical feasibility og market desirability sammen.
32. At lade sunk cost gøre PASS-threshold lavere.
33. At lade founder excitement gøre FAIL-threshold højere.
34. At fejre learning uden at ændre næste beslutning.
35. At gå til GTM-scale før den kritiske market assumption har tilstrækkelig evidence.

---

# 28. Operating cadence

Market validation følger ikke en fast “hver tirsdag”-rytme. Cadence skal følge **Hours to Data**.

## Before each experiment

- decision question,
- assumption,
- hypothesis,
- population,
- treatment,
- metric,
- threshold,
- sample logic,
- duration/stopping,
- ethics/legal,
- owner,
- next decision.

## During test

Monitor kun det, der kan kræve intervention:

- data integrity,
- spend runaway,
- harm/complaints,
- broken experience,
- payment/refund issue,
- capacity overflow.

Undgå at “optimere” treatment mid-test, hvis målet er clean inference.

## Decision review

Efter minimum observation:

```text
1. Was the test valid?
2. What happened?
3. How uncertain is the estimate?
4. Is it economically material?
5. What else could explain it?
6. What assumption changed?
7. What decision changes now?
8. What is the next highest-EVI unknown?
```

## Portfolio review

På tværs af validation-programmet:

- cash burned per learning,
- hours to data,
- invalid test rate,
- proportion of tests that changed a decision,
- kill rate before large investment,
- evidence strength of active concepts,
- unresolved critical assumptions,
- repeated/expired learnings.

## Do not optimize for number of experiments

Digital experimentation kan understøtte organizational learning og hurtigere selection af lovende idéer, men capability-målet er bedre beslutninger - ikke et højt test-count [A03].

Målet er ikke “50 tests per month”.

Målet er:

> **hurtigere reduction af decision-relevant uncertainty pr. krone og dag.**

---

# 29. Operating templates

## 29.1 Assumption register

```yaml
assumption_id:
statement:
category: demand|customer|price|usage|retention|channel|market|economics|feasibility|legal
if_false:
  decision_impact:
  investment_at_risk:
current_evidence:
  type:
  strength:
uncertainty: low|medium|high
priority:
next_test:
owner:
status: open|testing|supported|rejected|expired
```

## 29.2 XYZ / Market Engagement Hypothesis card

```yaml
hypothesis_id:
X: "minimum required proportion/count"
Y:
  population:
  inclusion:
  exclusion:
Z:
  action:
  price_or_exchange:
  time_window:
context:
  market:
  channel:
pass_rule:
fail_rule:
inconclusive_rule:
rationale_for_X:
```

## 29.3 Experiment card

```yaml
experiment_id:
decision_question:
assumption_tested:
hypothesis_id:
method: fake_door|facade|mechanical_turk|concierge|paid_pilot|working_slice|ab_test|other
control:
treatment:
randomization_unit:
population:
primary_metric:
minimum_material_effect:
secondary_metrics:
guardrails:
denominators:
sample_logic:
planned_duration:
stopping_rule:
data_quality_checks:
known_confounders:
false_positive_cost:
false_negative_cost:
reversibility:
visibility: public|bounded|private|quiet_problem_test
competitive_exposure_risk: low|medium|high
ethics_review:
legal_review:
cash_budget:
hours_to_data:
owner:
```

## 29.4 Data dictionary

```yaml
metric_name:
definition:
numerator:
denominator:
unit_of_analysis:
source:
inclusion_rules:
exclusion_rules:
time_window:
known_lag:
quality_checks:
```

## 29.5 Analysis card

```yaml
experiment_id:
validity: valid|invalid|limited
sample:
raw_counts:
primary_estimate:
interval:
practical_threshold:
secondary_findings:
data_quality_findings:
segment_findings:
alternative_explanations:
causal_status: randomized|quasi|observational|behavioral_noncausal|stated
external_validity:
transportability_limits:
decision_loss_considered:
result: pass|fail|inconclusive|invalid
```

## 29.6 Decision memo

```markdown
# Validation Decision

## Decision at stake
## What we tested
## What happened
## What the data can support
## What the data cannot support
## Economics / materiality
## False-positive vs false-negative cost
## Transportability / scope limits
## Remaining critical uncertainty
## Decision: KILL / ITERATE / NEXT TEST / ESCALATE
## Next investment tranche
## Next highest-EVI test
```

## 29.7 Learning atom

```yaml
learning_id:
statement:
scope:
  customer:
  market:
  proposition:
  price:
  channel:
  period:
evidence_type:
evidence_strength:
causal: true|false
supporting_experiments:
contradicting_evidence:
uncertainty:
created_at:
last_validated_at:
review_or_expiry:
decision_changed:
```

## 29.8 Ethics gate

```yaml
legal: pass|review|fail
potential_harm: low|medium|high
deception_used: true|false
why_deception_is_needed:
transparent_alternative_considered:
payment_handling:
refund_path:
vulnerable_population: true|false
privacy_basis:
visibility: public|bounded|private|quiet_problem_test
competitive_exposure_review:
public_scrutiny_test: pass|fail
approver:
```

---

# 30. Worked validation journeys

Disse er eksempler på beslutningslogik, ikke benchmarks.

## 30.1 B2B AI workflow product

### Starting concept

En AI-løsning automatiserer en bestemt finance workflow for mellemstore virksomheder.

### Wrong first move

Byg fuld multi-tenant SaaS, integrationsplatform, role permissions og polished dashboard.

### Better sequence

**Kill assumption:** Finance teams vil betale for outcomeet og delegere workflowet.

**XYZ:**

```text
At least X% of finance teams matching Y
will commit to a paid 30-day pilot at price P
for outcome Z.
```

**Test 1:** founder-led outreach + realistic demo + paid pilot offer.

**If PASS:** Mechanical Turk/Concierge delivery med AI + human review.

Mål:

- pilot acceptance,
- successful workflow completion,
- manual rework,
- hours saved verified by customer,
- continued use,
- willingness to renew.

**Escalation:** først derefter build integration/product layer, hvis automation cost < human-delivery cost eller scale kræver det.

### Learning

Den manual/AI-hybrid kan være en bedre market test end en fake dashboard, fordi kunden oplever den faktiske outcome.

## 30.2 Physical consumer product

### Starting concept

Nyt køkkenredskab med ny form factor.

### Kill assumptions

1. Folk forstår use case.
2. Form factor er praktisk.
3. De vil betale 499 DKK.

### Tests

1. Pinocchio / 3D print til observed handling.
2. Landing/fake-door eller transparent preorder til demand.
3. 20-50 unit tiny run hvis tooling tillader det.
4. Provincial retail/pop-up test med permission.

### Decision

High click + low preorder = ikke nok. Diagnose price/trust/product understanding før tooling.

## 30.3 Existing Danish product -> Germany

### Existing evidence

Produktet har danske paying users og retention.

### New critical assumptions

- samme job/problem,
- German trust requirements,
- price acceptance,
- local sales motion,
- regulation/localization.

### Sequence

1. 10-20 discovery conversations til localization hypotheses.
2. Lokaliseret offer til narrow German segment.
3. Concrete paid pilot/deposit.
4. Provincial rollout i én region/vertical.
5. Replikér i ny cohort.

### What not to do

Sammenlign dansk og tysk landing-page conversion som om populationer og acquisition source er identiske.

## 30.4 New recurring service

### Concept

En månedlig specialistservice leveret online.

### Fastest credible test

Ingen platform.

```text
real offer
-> booking
-> payment
-> manually deliver service
-> month-2 renewal
```

Hvis den kan leveres manuelt med 5 timers opsætning, er en Mechanical Turk/Concierge ofte stærkere end en Fake Door, fordi OLI og economics kan observeres direkte.

---

# 31. Volatile implementation registry

Følgende må ikke hardcodes som evige market-validation-regler:

- specifikke ad-platform CPM/CPC benchmarks,
- current ad targeting controls,
- cookie banner implementation,
- AI model/tool names,
- AI productivity uplifts,
- no-code platform capabilities,
- crowdfunding platform fees/rules,
- marketplace listing rules,
- payment-provider rules,
- exact consent UI requirements,
- current consumer-law wording,
- analytics product interfaces,
- sample-size calculators/tool defaults,
- “best” landing-page builders,
- current email deliverability mechanics.

Evergreen core:

```text
question
-> hypothesis
-> realistic behavior
-> credible comparison
-> trustworthy data
-> uncertainty
-> decision
```

Live-check implementation-layer facts before execution.

---

# 32. Research evidence map

Kilderne er organiseret efter det spørgsmål, de kan bære. Metodeoprindelse, empirical evidence, regulation og practitioner evidence holdes adskilt.

## Pretotyping - primærkilder

### S01 - Alberto Savoia, *Pretotype It*, 10th Anniversary Edition, v1.1 (2022)

**Type:** `METHOD_ORIGIN / PRACTITIONER_METHOD`  
**Source:** Alberto Savoia, *Pretotype It*, 10th Anniversary Edition, v1.1 (2022).  
**Key use:** Right It/Wrong It, pretotyping definition, Thoughtland, Good Failure, ILI/OLI, Mechanical Turk, Pinocchio, Stripped Tease, Provincial, Fake Door, Pretend-to-Own, ethics update, XYZ excerpt.  
**Important limitation:** examples and illustrative percentages are not universal causal estimates.

### S02 - Pretotyping.org methodology

**URL:** https://www.pretotyping.org/methodology.html  
**Type:** `METHOD_ORIGIN`  
**Finding:** isolate key assumption -> choose pretotype -> market engagement/XYZ hypothesis -> test -> learn/refine/hypozoom.  
**Use:** current method sequence.

### S03 - Pretotyping planning resources / Market Engagement & skin-in-the-game materials

**URL:** https://www.pretotyping.org/  
**Type:** `METHOD_ORIGIN / PRACTITIONER_METHOD`  
**Finding:** formalizes Market Engagement Hypothesis, hypozooming and commitment/skin-in-the-game logic.  
**Use:** evidence ladder and experiment planning.

### S04 - Stanford MS&E 277 Pretotyping Quick Reference, Tina Seelig / Alberto Savoia (2016)

**Type:** `METHOD_ORIGIN / TEACHING_MATERIAL`  
**Source:** Stanford MS&E 277 / Tina Seelig & Alberto Savoia, Quick Reference: Basic Pretotyping Techniques (2016).  
**Finding:** Fake Door, Facade, Pinocchio, Mechanical Turk, YouTube, Provincial, One-night Stand, Infiltrator, Impostor.  
**Limitation:** legacy examples are not automatically ethical/legal standards for 2026.

### T01 - Tim Vang / preeto book draft

**Type:** `PRACTITIONER_METHOD / CORPORATE_CASES`  
**Source:** Tim Vang / preeto, unpublished book draft (2016-era material).  
**Finding:** Danish market-validation framing, actual usage/revealed behavior, validation as missing link, corporate adoption cases.  
**Limitation:** 2016-era practitioner draft; categorical claims and digital implementation details are treated as historical/practice context, not current empirical laws.

## Lean Startup / Customer Development

### L01 - Steve Blank, “Why the Lean Start-Up Changes Everything”, Harvard Business Review (2013)

**URL:** https://hbr.org/2013/05/why-the-lean-start-up-changes-everything  
**Type:** `INSTITUTIONAL_PRACTITIONER_METHOD`  
**Finding:** startups search for a business model by testing, revising and discarding hypotheses while gathering customer evidence.  
**Use:** triangulation with pretotyping.

### L02 - Stanford Lean LaunchPad

**URL:** https://leanlaunchpad.stanford.edu/  
**Type:** `INSTITUTIONAL_TEACHING_METHOD`  
**Finding:** evidence-based entrepreneurship, real customer interaction, stress-testing assumptions and iterative building.  
**Use:** hypothesis/customer-development discipline.

## Entrepreneurship science

### A01 - Camuffo, Cordova, Gambardella & Spina, Management Science

**Title:** “A Scientific Approach to Entrepreneurial Decision Making: Evidence from a Randomized Control Trial.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/mnsc.2018.3249  
**Type:** `CAUSAL_RANDOMIZED`  
**Finding:** scientific framing improved decision precision and was associated with more appropriate pivoting rather than intuition-only assessment in the studied startup sample.  
**Use:** preregistered hypotheses/falsification.

### A02 - Camuffo et al., large-scale replication and extension (2024)

**URL:** https://sms.onlinelibrary.wiley.com/doi/10.1002/smj.3580  
**Type:** `MULTI_RCT_REPLICATION`  
**Finding:** four RCTs / 759 firms; evidence of more idea termination and nuanced pivot effects, consistent with more efficient search and methodic doubt.  
**Use:** large-scale replication and extension of A01.

### A03 - Koning, Hasan & Chatterji, Management Science (2022)

**Title:** “Experimentation and Start-up Performance: Evidence from A/B Testing.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/mnsc.2021.4209  
**Type:** `STRONG_OBSERVATIONAL / ADOPTION_DESIGN`  
**Finding:** A/B adoption in high-tech startups was associated with substantial later performance improvements; qualitative/quantitative analyses link experimentation with organizational learning and faster failure.  
**Limitation:** do not treat the reported 30-100% range as a universal causal uplift for any company adopting A/B testing.

### A04 - Werle & Giones, International Journal of Entrepreneurial Behavior & Research (2026)

**Title:** “Action and reflection: rewiring the concept of entrepreneurial experimentation in the entrepreneurship process.”  
**DOI:** https://doi.org/10.1108/IJEBR-02-2024-0158  
**Type:** `INTEGRATIVE_REVIEW`  
**Finding:** integrative review of 78 publications across three decades reconciles experimentation as discovery/rapid action with experimentation as making/reflection.  
**Use:** experimentation should combine acting and learning rather than fetishize speed.

### A05 - Camuffo, Gambardella & Teodorovicz, Strategic Entrepreneurship Journal (2026)

**Title:** “Unleashing the Value of a Scientific Approach to Entrepreneurship: Building an Empirical Research Agenda.”  
**URL:** https://sms.onlinelibrary.wiley.com/doi/full/10.1002/sej.70038  
**CBS record:** https://research.cbs.dk/en/publications/unleashing-the-value-of-a-scientific-approach-to-entrepreneurship/  
**Type:** `PEER_REVIEWED_RESEARCH_AGENDA`  
**Finding:** calls for stronger empirical grounding, attention to complementarities, boundary conditions and risk of overprescription.  
**Use:** reason not to turn experimentation into dogma.

### A06 - Bennett & Chatterji, Strategic Management Journal (2023)

**Title:** “The entrepreneurial process: Evidence from a nationally representative survey.”  
**URL:** https://doi.org/10.1002/smj.3077  
**Type:** `NATIONALLY_REPRESENTATIVE_OBSERVATIONAL / PROCESS_RESEARCH`  
**Finding:** pre-entry entrepreneurship is empirically observed as a sequence of exploration, administrative action, continuation and exit choices rather than a single binary entry decision; fewer than half of people in the studied US population who considered starting a business took even very low-cost exploration steps.  
**Use:** supports treating market validation as staged pre-entry learning and next-commitment decisions.  
**Limitation:** descriptive/observational US survey evidence; it does not estimate a causal performance uplift from pretotyping.

### A07 - Corbo, Katila & Vlačić, Academy of Management Annals (2026)

**Title:** “Experimentation in Organizations: An Integrative Review.”  
**URL:** https://journals.aom.org/doi/full/10.5465/annals.2024.0287  
**Type:** `INTEGRATIVE_REVIEW`  
**Finding:** review of 177 empirical studies separates problem-solving experimentation from causal-inference experimentation and synthesizes the broader organizational literature.  
**Use:** reinforces that not every experiment has the same epistemic purpose.

### A08 - Contigiani, Denoo & Hablicsek, Strategic Entrepreneurship Journal (2026)

**Title:** “Toward a theory of Bayesian experimentation in early-stage ventures.”  
**URL:** https://sms.onlinelibrary.wiley.com/doi/full/10.1002/sej.70031  
**Type:** `PEER_REVIEWED_THEORY / DECISION_MODEL`  
**Finding:** experimental entry is not universally optimal; value depends on information, adaptation and appropriability, while biased priors can increase the value of experimentation.  
**Use:** boundary condition for “more testing is always better” and for public/private experiment design.

### A09 - Gans, NBER Working Paper 35172 (2026)

**Title:** “Competitive Exposure and Entrepreneurial Experimentation.”  
**URL:** https://www.nber.org/papers/w35172  
**Type:** `THEORETICAL_WORKING_PAPER`  
**Finding:** visible tests can generate traction but reveal progress to rivals; entrepreneurs may rationally sequence public and quiet validation.  
**Use:** public-vs-private validation and competitive exposure.  
**Limitation:** working paper/theoretical model, not a randomized field estimate.

## Online controlled experimentation / statistics

### E01 - Kohavi et al., Microsoft experimentation program

**Source family:** Microsoft Research, controlled online experiments.  
**URL:** https://www.microsoft.com/en-us/research/group/experimentation-platform-exp/  
**Type:** `EXPERIMENTATION_METHOD`  
**Finding:** randomized online experiments support causal decisions at scale.

### E02 - Microsoft Research, trustworthy experimentation patterns

**URL:** https://www.microsoft.com/en-us/research/articles/patterns-of-trustworthy-experimentation-post-experiment-stage  
**Type:** `METHOD_GUIDANCE`  
**Finding:** telemetry integrity, denominator movement and quality checks matter before interpreting effects.

### E03 - Fabijan et al., Sample Ratio Mismatch

**URL:** https://www.microsoft.com/en-us/research/publication/diagnosing-sample-ratio-mismatch-in-online-controlled-experiments-a-taxonomy-and-rules-of-thumb-for-practitioners/  
**Type:** `EXPERIMENTATION_METHOD`  
**Finding:** SRM can signal selection/data quality problems that invalidate experiment conclusions.

### E04 - Dmitriev et al., “A Dirty Dozen: Twelve Common Metric Interpretation Pitfalls”

**URL:** https://www.microsoft.com/en-us/research/publication/a-dirty-dozen-twelve-common-metric-interpretation-pitfalls-in-online-controlled-experiments/  
**Type:** `EXPERIMENTATION_METHOD`  
**Finding:** metric movements can be misread even in controlled experiments; interpretation needs structured safeguards.

### E05 - Statistical power / metric sensitivity

**URL:** https://www.microsoft.com/en-us/research/articles/beyond-power-analysis-metric-sensitivity-in-a-b-tests/  
**Type:** `STATISTICAL_METHOD`  
**Finding:** metric sensitivity depends on statistical power, variance, sample and effect size; a null result is informative only when the design could have detected a decision-relevant effect.

### E06 - Cluster/randomization-unit design

**URL:** https://www.microsoft.com/en-us/research/articles/why-tenant-randomized-a-b-test-is-challenging-and-tenant-pairing-may-not-work/  
**Type:** `STATISTICAL_METHOD`  
**Finding:** randomization at account/team/store/tenant level changes variance, balance and effective information; analysis must respect the actual randomization unit.

### E07 - External validity / transportability

**URL:** https://www.microsoft.com/en-us/research/articles/external-validity-of-online-experiments-can-we-predict-the-future/  
**Type:** `EXPERIMENTATION_METHOD`  
**Finding:** an internally valid treatment effect need not transport to a different population, geography, period or context.  
**Use:** Provincial/hypozoom replication.

### E08 - NIST sample size / design resources

**URL:** https://www.itl.nist.gov/div898/handbook/  
**Type:** `STATISTICAL_REFERENCE`  
**Use:** sample size, confidence intervals and experimental design basics.

### E09 - NIST binomial proportion confidence intervals

**URLs:**  
https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm  
https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/propconf.htm  
**Type:** `STATISTICAL_REFERENCE`  
**Finding:** interval choice matters for binomial proportions; the simple normal/Wald approximation has poor coverage in small/extreme samples, while Wilson/Jeffreys-type approaches are recommended defaults, including Wilson/Jeffreys for `n <= 40` in NIST's referenced guidance.  
**Use:** uncertainty around small-sample conversion/ILI rates.

### E10 - Stanford Statistics, multiple testing / p-hacking

**URL:** https://web.stanford.edu/class/stats60/lectures/18-lecture-multiple-hypotheses.html  
**Type:** `STATISTICAL_METHOD / TEACHING_REFERENCE`  
**Finding:** repeated hypothesis tests raise the chance of false positives; family-wise error control or other multiplicity handling may be needed.

### E11 - CUPED / variance reduction

**URL:** https://www.microsoft.com/en-us/research/articles/deep-dive-into-variance-reduction/  
**Type:** `EXPERIMENTATION_METHOD`  
**Finding:** valid pre-experiment covariates can reduce variance and increase sensitivity; variance reduction does not rescue biased assignment or bad telemetry.

### E12 - Pitfalls of long-term online controlled experiments

**URL:** https://www.microsoft.com/en-us/research/?p=683337  
**Type:** `EXPERIMENTATION_METHOD`  
**Finding:** long-running experiments can suffer from survivorship bias, selection bias, identity/cookie instability and misleading apparent trends.  
**Use:** retention/OLI analysis and long-horizon interpretation.

### E13 - American Statistical Association, p-value statement

**URL:** https://www.amstat.org/asa/files/pdfs/p-valuestatement.pdf  
**Type:** `STATISTICAL_STANDARD`  
**Finding:** p-values do not measure the probability that a hypothesis is true; decisions should not be based only on a threshold; statistical significance does not measure effect size or importance.  
**Use:** p-values are one uncertainty tool, not a validation verdict.

### E14 - Johari, Koomen, Pekelis & Walsh, Operations Research

**Title:** “Always Valid Inference: Continuous Monitoring of A/B Tests.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/opre.2021.2135  
**Type:** `STATISTICAL_METHOD / SEQUENTIAL_INFERENCE`  
**Finding:** ordinary fixed-horizon inference becomes unreliable when sample size is selected by continuous monitoring; always-valid/sequential inference can support valid monitored stopping.  
**Use:** peeking, early stopping and always-valid experiment design.

### E15 - Johari, Li, Liskovich & Weintraub, Management Science (2022)

**Title:** “Experimental Design in Two-Sided Platforms: An Analysis of Bias.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/mnsc.2021.4247  
**Type:** `EXPERIMENTAL_DESIGN / MARKETPLACE_INTERFERENCE`  
**Finding:** in two-sided marketplaces, treatment can alter other participants' opportunities, so standard customer- or listing-randomized estimates can be biased; design quality depends on market balance, and two-sided randomization can reduce bias in relevant regimes.  
**Use:** marketplace validation, interference checks and randomization-unit selection.

### E16 - Bojinov, Simchi-Levi & Zhao, Management Science (2023)

**Title:** “Design and Analysis of Switchback Experiments.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/mnsc.2022.4583  
**Type:** `EXPERIMENTAL_DESIGN / SWITCHBACK`  
**Finding:** switchback experiments randomize treatments over time and can be useful in ride-hailing/marketplace settings with shared constraints; valid design and inference depend on carryover assumptions and treatment-period structure.  
**Use:** capacity-constrained, marketplace and temporal-spillover validation where independent user-level randomization is invalid.

## Market research / demand / pricing

### M01 - Schmidt & Bijmolt, hypothetical WTP meta-analysis

**Title:** “Accurately measuring willingness to pay for consumer goods: a meta-analysis of the hypothetical bias.”  
**URL:** https://link.springer.com/article/10.1007/s11747-019-00666-6  
**Type:** `META_ANALYSIS`  
**Finding:** across 77 studies, hypothetical WTP differed systematically from real WTP; average overstatement was reported, with substantial method/product heterogeneity.  
**Use:** stated WTP is not behavioral proof.  
**Limitation:** never use the average 21% as a universal correction.

### M02 - Cao & Zhang, Marketing Science

**Title:** “Preference Learning and Demand Forecast.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/mksc.2020.1238  
**Type:** `FIELD_EXPERIMENT / METHOD`  
**Finding:** stated preferences are cheap but less reliable; incentive-aligned purchase probability can improve real-demand prediction.

### M03 - Morwitz et al., purchase intentions and sales

**Title:** “When do purchase intentions predict sales?”  
**URL:** https://www.sciencedirect.com/science/article/pii/S0169207007000799  
**Type:** `META_ANALYSIS / FORECASTING_RESEARCH`  
**Finding:** relationship between purchase intentions and sales is context-dependent; predictive validity differs across product/context conditions.

### M04 - “Failed but validated?” Journal of Business Venturing (2022)

**URL:** https://www.sciencedirect.com/science/article/pii/S0883902621000859  
**Type:** `CONTROLLED_EXPERIMENT + LONGITUDINAL_FIELD_STUDY`  
**Finding:** market-validation information in failed crowdfunding projects predicted persistence/commercialization patterns in the studied samples.  
**Use:** failed funding goal does not imply zero learning.

### M05 - van Teunenbroek, Hasanefendic & Bossink, Journal of Business Venturing Insights (2026)

**Title:** “When the crowd signals quality: A blind test of reward-based crowdfunding's informative value.”  
**URL:** https://doi.org/10.1016/j.jbvi.2026.e00607  
**Type:** `PEER_REVIEWED_EMPIRICAL / BLIND_EXPERT_EVALUATION`  
**Finding:** in the studied high-tech Kickstarter sample, successful campaigns aligned with higher blind expert ratings on credibility, feasibility, reliability and usefulness, but not on novelty or uniqueness.  
**Use:** crowdfunding outcomes can contain market-relevant information, but they encode only part of product quality and remain affected by campaign execution, audience, network and platform context; they are not standalone proof of durable product-market fit.

### F01 - Castellion & Markham, Journal of Product Innovation Management (2013)

**Title:** “New Product Failure Rates: Influence of Argumentum ad Populum and Self-Interest.”  
**URL:** https://onlinelibrary.wiley.com/doi/10.1111/j.1540-5885.2012.01009.x  
**Type:** `PEER_REVIEWED_PERSPECTIVE / FAILURE_RATE_REVIEW`  
**Finding:** explicitly challenges the persistent claim that new-product failure is universally 80% or higher and points to historical empirical studies with materially lower rates.  
**Use:** reject a universal 80-90% failure-rate assumption.  
**Limitation:** do not replace one universal number with another; rates remain definition- and population-dependent.

## AI and synthetic data

### AI01 - Cui et al., Management Science (2026)

**Title:** “The Effects of Generative AI on High-Skilled Work: Evidence from Three Field Experiments with Software Developers.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/mnsc.2025.00535  
**Type:** `CAUSAL_RANDOMIZED`  
**Finding:** pooled analysis of three field experiments / 4,867 developers reported a 26.08% increase in completed tasks with AI assistant access, with substantial noise/heterogeneity across experiments.  
**Use:** evidence that AI can materially lower build cost in some contexts.  
**Limitation:** task/team/tool specific; not a universal productivity multiplier.

### AI02 - METR developer productivity studies (2025-2026)

**URLs:**  
https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/  
https://metr.org/blog/2026-02-24-uplift-update/  
**Type:** `CAUSAL_RANDOMIZED + METHODOLOGY_UPDATE`  
**Finding:** early-2025 RCT found slower task completion for experienced OSS developers in that setting; 2026 follow-up design was changed due selection effects.  
**Use:** build-cost assumptions must be context-specific.

### AI03 - Ashokkumar et al., Nature (2026)

**Title:** “Large language models can predict the results of social science experiments.”  
**URL:** https://www.nature.com/articles/s41586-026-10742-x  
**Type:** `EMPIRICAL_BENCHMARK`  
**Finding:** LLM forecasts correlated with treatment effects in the studied archives but systematically overestimated effect sizes.  
**Use:** AI forecasting can prioritize tests, not replace them.

### AI04 - Wang, Zhang & Zhang, Marketing Science (2026)

**Title:** “Large Language Models for Market Research: A Data-Augmentation Approach.”  
**URL:** https://pubsonline.informs.org/doi/full/10.1287/mksc.2025.0009  
**Type:** `MARKETING_SCIENCE / METHOD`  
**Finding:** LLM-generated conjoint data can complement real data under a debiasing/augmentation framework; naive substitution can worsen bias.  
**Use:** synthetic respondents are augmentation, not source of truth.  
**Disclosure:** the paper reports OpenAI Research funding; interpret vendor-adjacent funding transparently.

## Decision theory / value of information

### D01 - Avriel & Williams, Operations Research (1970)

**Title:** “The Value of Information and Stochastic Programming.”  
**URL:** https://pubsonline.informs.org/doi/10.1287/opre.18.5.947  
**Type:** `DECISION_THEORY`  
**Finding:** expected value of perfect information is an upper bound on rational spend for information acquisition.

### D02 - NIST, Value of Information and decision pathways (2022)

**URL:** https://www.nist.gov/publications/value-information-and-decision-pathways-concepts-and-case-studies  
**Type:** `DECISION_SCIENCE_SYNTHESIS`  
**Finding:** information has both collection/dissemination costs and decision benefits; actionability matters.

## Legal / consumer protection / privacy

### L10 - EU Unfair Commercial Practices Directive

**URL:** https://eur-lex.europa.eu/legal-content/en/ALL/?uri=CELEX:02005L0029-20220528  
**Type:** `LAW`  
**Finding:** misleading actions can include false/deceptive information about product existence, nature, availability and other material characteristics where it changes transactional decisions.  
**Use:** legal design constraint for Fake Door / scarcity / claims.

### L11 - Your Europe, unfair and blacklisted commercial practices

**URL:** https://europa.eu/youreurope/citizens/consumers/unfair-treatment/unfair-commercial-practices/index_en.htm  
**Type:** `OFFICIAL_EU_GUIDANCE`  
**Finding:** consumers are protected against misleading practices and deceptive dark patterns including fake urgency examples.

### L12 - Datatilsynet, cookies og lignende teknologier

**URL:** https://www.datatilsynet.dk/regler-og-vejledning/cookies-og-lignende-teknologier  
**Type:** `DANISH_REGULATORY_GUIDANCE`  
**Finding:** cookies og lignende teknologier til bl.a. statistik og marketing er omfattet af databeskyttelses- og cookieregler; brug af cookies kræver som udgangspunkt samtykke, bortset fra relevante nødvendige teknologier.  
**Use:** validation tracking er ikke fritaget fra privacy-regler.

### L13 - European Commission, UCPD interpretation guidance (2021/C 526/01)

**URL:** https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A52021XC1229%2805%29  
**Type:** `OFFICIAL_EU_GUIDANCE`  
**Finding:** “transactional decision” under UCPD kan bl.a. omfatte at klikke på et link/annonce eller fortsætte i et bookingflow; guidance fremhæver også misleading availability og dark-pattern risks.  
**Use:** Fake Door-design må vurderes før selve checkout/commitment point.

### L14 - European Commission / CPC Network, online pricing sweep (2026)

**URL:** https://commission.europa.eu/news-and-media/news/eu-check-reveals-misleading-sales-practices-online-2026-03-26_en  
**Type:** `CURRENT_ENFORCEMENT_CONTEXT / OFFICIAL_EU`  
**Finding:** a 2025-26 coordinated sweep of 314 online traders identified misleading discounting, pressure-selling/fake scarcity, basket additions without clear consent and drip-pricing issues; the Commission states that several such practices are illegal under EU consumer law.  
**Use:** current 2026 enforcement context for validation offers, pricing and scarcity.  
**Limitation:** sweep prevalence is not a market-validation benchmark and does not by itself determine legality of a specific experiment.

## Survey / questionnaire methodology

### Q01 - AAPOR, Best Practices for Survey Research

**URL:** https://aapor.org/standards-and-ethics/best-practices/  
**Type:** `SURVEY_METHOD_STANDARD`  
**Finding:** surveyen skal matche research question; wording bør være kort, neutral og single-concept; sampling, mode, order effects, response bias og pretesting er centrale designproblemer.  
**Use:** surveys/interviews som disciplined stated-evidence layer, ikke automatisk demand proof.

### Q02 - Pew Research Center, Writing Survey Questions / Methods 101

**URL:** https://www.pewresearch.org/writing-survey-questions/  
**Type:** `SURVEY_METHOD_GUIDANCE`  
**Finding:** wording, answer options, question order og mode kan påvirke svar; pretesting med qualitative/experimental methods bruges til at forbedre nye spørgsmål.  
**Use:** questionnaire quality og wording tests.

### Q03 - U.S. Census Bureau, Questionnaire Testing and Evaluation Methods

**URL:** https://www.census.gov/about/policies/quality/standards/appendixa2.html  
**Type:** `OFFICIAL_SURVEY_QUALITY_STANDARD`  
**Finding:** pretesting er kritisk for at opdage comprehension-, order/context-, skip- og formatting-problemer; cognitive interviews, respondent debriefings, usability og split-panel tests har forskellige roller.  
**Use:** pretest gate før survey-data bruges som beslutningsevidence.

### Q04 - European Social Survey, cross-national survey specification

**URL:** https://www.europeansocialsurvey.org/methodology/methodology/ess-specification  
**Type:** `CROSS_NATIONAL_MEASUREMENT_STANDARD`  
**Finding:** comparable cross-country measurement kræver struktureret questionnaire translation, sampling, pretesting, data collection og documentation; translation alene er ikke nok.  
**Use:** semantic/measurement equivalence ved new-market validation.

---

# 33. Source-handling rules

1. **Pretotyping terminology:** defer to Savoia/current Pretotyping.org where possible.
2. **Causal claims:** prioritize randomized/controlled evidence over practitioner anecdotes.
3. **Market demand:** actual behavior > hypothetical intent, all else equal.
4. **Pricing:** transaction/incentive-aligned evidence > direct WTP questions.
5. **A/B results:** no decision before assignment, telemetry and SRM checks pass.
6. **Statistical claims:** report effect size + uncertainty + practical threshold, not p-value alone.
7. **Legal:** live-check current official law/guidance before execution.
8. **Corporate case stories:** useful for implementation patterns, not universal effect estimates.
9. **Vendor/platform claims:** treat as context unless independently validated.
10. **AI benchmarks:** never transfer a productivity result across teams/tasks without measuring actual local workflow.
11. **Old market-validation techniques:** preserve the principle, not obsolete implementation details.
12. **Sequential tests:** monitoring/stopping logic must be statistically valid; “we watched until it won” is not evidence.
13. **Cross-market comparisons:** pretest semantic/measurement equivalence before attributing country differences to demand.
14. **Visibility:** public exposure is an experiment variable with possible traction and competitive costs.
15. **Internal learnings:** always store population, treatment, price, channel, period and evidence strength.
16. **Marketplaces/shared constraints:** test for interference before trusting user-level A/B estimates; the randomization unit must match the causal system.

---

# 34. Final doctrine

> **Market validation handler ikke om at bevise, at vi har ret. Det handler om at købe den mest beslutningsrelevante sandhed om markedet så hurtigt, billigt og troværdigt som muligt, før vi binder flere ressourcer end evidensen kan bære.**

Den operationelle doctrine er:

```text
START WITH A DEFINED CONCEPT
-> STATE THE DECISION
-> MAP WHAT MUST BE TRUE
-> FIND THE KILL ASSUMPTION
-> SAY IT WITH NUMBERS
-> CHOOSE THE STRONGEST AFFORDABLE BEHAVIORAL SIGNAL
-> BUILD THE SMALLEST CREDIBLE TEST
-> PRE-REGISTER THE DECISION RULE
-> PUT IT IN FRONT OF THE REAL TARGET MARKET
-> VERIFY THE DATA
-> MEASURE BEHAVIOR, NOT ENTHUSIASM
-> QUANTIFY UNCERTAINTY
-> SEARCH FOR ALTERNATIVE EXPLANATIONS
-> WEIGH FALSE-POSITIVE VS FALSE-NEGATIVE COST
-> CHECK TRANSPORTABILITY + COMPETITIVE EXPOSURE
-> DECIDE THE NEXT INVESTMENT TRANCHE
-> KILL, ITERATE OR ESCALATE
-> REPLICATE ONLY WHERE THE NEXT RISK JUSTIFIES IT
-> STOP TESTING WHEN MORE INFORMATION IS WORTH LESS THAN ACTION
-> HAND OFF TO PRODUCT / GTM WHEN MARKET RISK IS LOW ENOUGH
```

Pretotyping er hovedmotoren, fordi den gør det muligt at skabe **real market evidence før full build**. Men golden standard er bredere end pretotyping: den kombinerer Savoias practical market-engagement discipline med moderne experiment design, statistics, behavioral demand evidence, pricing research, decision theory, legal/ethical constraints og AI-era economics.

---

# 35. One-page Golden Standard

1. **Tag et allerede nogenlunde defineret concept som input - ikke en tom innovation canvas.**
2. **Definér den konkrete beslutning og den næste investering, der står på spil.**
3. **Kortlæg de assumptions, der skal være sande for casen.**
4. **Test den assumption, der kan dræbe casen, først.**
5. **Skriv hypotesen som en testbar XYZ/Market Engagement Hypothesis.**
6. **Afled X fra business viability, ikke fra et generisk benchmark.**
7. **Hypozoom til en population og situation, du faktisk kan teste.**
8. **Vælg evidence target før artifact: click, booking, deposit, purchase, repeat osv.**
9. **Prioritér adfærd med reel consequence over stated enthusiasm.**
10. **Vælg den mindste artifact, der kan skabe troværdig evidence.**
11. **Brug Fake Door til initial interest, ikke som default for alt.**
12. **Brug Mechanical Turk/Concierge når dyr automation kan simuleres manuelt.**
13. **Brug functioning slice når den er næsten lige så billig og giver stærkere usage data.**
14. **Brug prototype til technical/product questions; pretotyping til market questions.**
15. **Pre-register primary metric, denominator, threshold og stopping rule.**
16. **Randomisér når du vil hævde, at A forårsagede en forskel mod B - og check interference/spillovers før du vælger randomization unit.**
17. **Kontrollér data quality, assignment, SRM og treatment contamination før resultater fortolkes.**
18. **Rapportér raw counts, rates, effect size og uncertainty.**
19. **Statistical significance er ikke nok; effect skal være business-material og uncertainty skal rapporteres.**
20. **Et null-resultat er ikke proof of zero; check power, sensitivity og stopping design.**
21. **ILI er initial response; OLI er repeat/retention over relevant naturlig cadence.**
22. **Valider pricing med realistiske valg og betaling, når price er en kill assumption.**
23. **Et positivt resultat gælder kun den population, proposition, price, channel og period der blev testet.**
24. **Replikér kritiske resultater før store irreversible commitments, ikke alt af ritual; evidence threshold følger decision loss.**
25. **Ved new-market entry: behandl transferability og semantic/measurement equivalence som nye hypotheses.**
26. **Brug AI til at sænke Hours to Data, ikke som erstatning for kunder.**
27. **Vælg pretotype vs working MVP ud fra learning value, build cost, time, risk og fidelity.**
28. **Design Fake Doors og andre tests til at være lovlige, fair og tillidsbevarende; vælg public vs private visibility bevidst.**
29. **Prioritér næste test efter Expected Value of Information.**
30. **Klassificér resultatet PASS / FAIL / INCONCLUSIVE / INVALID.**
31. **Scope en FAIL-diagnose før du dræber hele missionen.**
32. **Tillad ikke post-hoc rescue loops uden ny falsificerbar hypothesis.**
33. **Gem hvert learning atom med evidence strength og context.**
34. **Stop når næste information er mindre værd end action/opportunity cost.**
35. **Når central market uncertainty er lav nok til næste tranche, hand off til Product/Prototype/GTM - og fortsæt læringen dér.**

---

# V2 validation note

V2 er sanity-checked efter en strengere standard end “samling af best practices”: centrale påstande er holdt op mod metodeoprindelse, peer-reviewed causal/empirical research, moderne experimentation science, survey/pricing research og aktuel EU/DK regulation. Hvor public evidence ikke kan bære en universel regel, står rådet som en context-dependent default, synthesis eller internal hypothesis.

De vigtigste korrektioner i forhold til typisk practitioner-lore er bevidst indbygget i selve playbooken: ingen universel 80-90% failure rate, ingen universel conversion benchmark, ingen automatisk Fake-Door-first regel, ingen antagelse om at stated WTP er real WTP, ingen `p < 0.05 = validated`, ingen ukritisk user-level A/B i marketplaces med interference, og ingen antagelse om at AI altid gør build billigere.

Playbooken kan derfor bruges som en **evergreen decision standard**, mens platformsfunktioner, build economics, channel costs og legal/policy implementation fortsat live-checkes ved execution.

---

# V2 maintenance standard

Denne playbook har to lag, som skal vedligeholdes forskelligt:

### Evergreen core

- decision-first validation,
- falsificerbare hypotheses,
- behavioral evidence,
- denominator discipline,
- uncertainty + materiality,
- causal design når causal claims kræves,
- transportability,
- decision loss,
- Value of Information,
- ethical/legal constraints,
- scoped learning.

### Live-check før execution

- aktuelle ad-platform features og policies,
- AI/no-code build economics,
- tracking/cookie implementation,
- nationale consumer/marketing/privacy-regler,
- platform terms,
- category-specific regulation,
- current channel prices og availability.

En flygtig implementation detail må aldrig ophøjes til permanent market-validation law.

Den endelige source of truth for et konkret produkt er heller ikke denne playbook. Det er **den relevante markedsadfærd, målt gennem et design stærkt nok til den beslutning, der skal tages.**
