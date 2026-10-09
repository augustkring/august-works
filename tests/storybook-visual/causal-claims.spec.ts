import {expect,test,type Page} from "@playwright/test";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),axePath=require.resolve("axe-core/axe.min.js"),claimId="00000000-0000-4000-8000-000000001101";
async function accessibility(page: Page) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (context: string, options: unknown) => Promise<{ violations: unknown[] }> } };
    // Storybook's native accessibility addon may already own an axe scan.
    // Wait only for that explicit concurrency condition; real violations and
    // other scanner errors still fail this check immediately.
    const deadline = performance.now() + 5000;
    while (true) {
      try { return (await w.axe.run("#storybook-root", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations; }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes("Axe is already running") || performance.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function story(page:Page,state:string,theme:string,width:number){await page.route("**/api/**",r=>r.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-causal-claims--${state}&viewMode=story&globals=theme:${theme}`);}
async function settled(page:Page,theme:string){await page.emulateMedia({colorScheme:theme as "light"|"dark"});await expect.poll(()=>page.evaluate(()=>document.documentElement.style.colorScheme)).toBe(theme);await page.evaluate(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));for(const animation of document.getAnimations()){if(animation.playState==="running"&&animation.playbackRate!==0&&Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))animation.finish();}});}
for(const theme of ["light","dark"])for(const width of [390,1200]){
 for(const state of ["supported","refuted","inconclusive","stale"])test(`causal result ${state} ${theme} ${width}px preserves evidence design and conditional authority`,async({page},info)=>{
  await story(page,state,theme,width);const panel=page.getByRole("region",{name:"Conditional causal result"});await expect(panel).toContainText("Evidence design: randomized experiment");await expect(panel).toContainText("Execution requires separate native human authority");await expect(panel).toContainText("Sensitivity");await expect(panel).toContainText("unknown");await expect(panel).toContainText("Independent provider refutations");await expect(panel).toContainText("not run");await expect(panel).toContainText("No verified business impact");
  await settled(page,theme);
  if(state==="inconclusive"){await expect(panel).toContainText("No causal estimate is admitted");await expect(panel).not.toContainText("Registered treatment minus control:");}else await expect(panel).toContainText("percentage points");
  if(state==="refuted")await expect(panel).toContainText("does not prove zero effect");if(state==="stale")await expect(panel.getByRole("status")).toContainText("requires explicit source revalidation");
  const trace=panel.getByText("Inspect analysis traceability",{exact:true});await trace.focus();await page.keyboard.press("Space");await expect(panel).toContainText("Receipt");await accessibility(page);await page.screenshot({path:info.outputPath(`causal-result-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 for(const state of ["draft","reviewed","retained","revoked"])test(`causal model ${state} ${theme} ${width}px keeps review and source reliance distinct`,async({page},info)=>{
  await story(page,state,theme,width);await page.getByRole("combobox",{name:"Causal claim",exact:true}).selectOption(claimId);await expect(page.getByRole("region",{name:"Declared human graph and assumptions"})).toContainText("human assumption");await expect(page.getByRole("region",{name:"Causal question and registered estimand"})).toContainText("Assignment intention-to-treat");
  if(state==="draft"){const review=page.getByRole("button",{name:"Record human model review",exact:true});await expect(review).toBeDisabled();await page.getByRole("textbox",{name:"Human review rationale",exact:true}).fill("Human independently reviews this exact graph, source and conditional boundary");await expect(review).toBeDisabled();await page.getByRole("checkbox").focus();await page.keyboard.press("Space");await expect(review).toBeEnabled();await expect(page.getByRole("button",{name:"Interpret registered evidence once"})).toHaveCount(0);}
  if(state==="reviewed")await expect(page.getByRole("button",{name:"Interpret registered evidence once"})).toBeEnabled();
  if(state==="retained"){await expect(page.getByRole("button",{name:"Interpret registered evidence once"})).toHaveCount(0);await expect(page.getByRole("region",{name:"Conditional causal result"})).toContainText("retained result");}
  if(state==="revoked"){await expect(page.getByRole("region",{name:"Conditional causal result"})).toHaveCount(0);await expect(page.getByRole("status")).toContainText("claim is revoked");}
  await settled(page,theme);await accessibility(page);await page.screenshot({path:info.outputPath(`causal-model-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 test(`causal typed graph proposal ${theme} ${width}px requires exact pins and refuses cycles`,async({page},info)=>{
  await story(page,"draft",theme,width);await page.getByRole("combobox",{name:"Causal claim",exact:true}).selectOption(claimId);await page.getByRole("button",{name:"Revise human model and reset review"}).click();const form=page.getByRole("form",{name:"Human causal model proposal"}),save=form.getByRole("button",{name:"Save human causal model"});await expect(save).toBeDisabled();await form.getByRole("textbox",{name:"Model revision rationale",exact:true}).fill("Human explicitly reviews this model amendment before independent causal review");await expect(save).toBeEnabled();
  await expect(form.getByRole("combobox",{name:"Causal outcome measure",exact:true})).toBeDisabled();await expect(form.getByRole("textbox",{name:"Horizon start (UTC)",exact:true})).toBeDisabled();await expect(form.getByRole("spinbutton",{name:"Meaningful primary difference (fraction, 0–1)",exact:true})).toBeDisabled();
  await form.getByRole("button",{name:"Add assumed arrow"}).click();await form.getByRole("textbox",{name:"Arrow 2 human rationale",exact:true}).fill("Explicit synthetic rationale for this additional human causal assumption");await expect(save).toBeDisabled();await form.getByRole("combobox",{name:"Arrow 2 from",exact:true}).selectOption("outcome");await form.getByRole("combobox",{name:"Arrow 2 to",exact:true}).selectOption("assignment");await expect(save).toBeDisabled();await form.getByRole("button",{name:"Remove arrow 2",exact:true}).click();await expect(save).toBeEnabled();
  await form.getByRole("button",{name:"Add context or unobserved node"}).click();await form.getByRole("combobox",{name:"Node 3 role",exact:true}).selectOption("unobserved");await form.getByRole("textbox",{name:"Node 3 label",exact:true}).fill("Unobserved concurrent context");await expect(form.getByRole("region",{name:"Human causal graph"})).toContainText("unobserved");await accessibility(page);await page.screenshot({path:info.outputPath(`causal-proposal-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 for(const status of ["passed","failed","unknown"])test(`DoWhy ${status} ${theme} ${width}px preserves diagnostics and native uncertainty`,async({page},info)=>{
  await story(page,`do-why-${status}`,theme,width);const panel=page.getByRole("region",{name:"DoWhy diagnostic results"});await expect(panel).toContainText("16 simulations");await expect(panel).toContainText(`placebo treatment refuter · ${status}`);await expect(page.getByRole("region",{name:"Conditional causal result"})).toContainText("Conservative registered interval");if(status!=="passed"){await expect(page.getByRole("region",{name:"Conditional causal result"})).toContainText("Causal evidence remains inconclusive");await expect(page.getByRole("region",{name:"Conditional causal result"})).toContainText("Causal reliance is withheld");}if(status==="unknown")await expect(panel).toContainText("p-value: unknown");await settled(page,theme);await accessibility(page);await page.screenshot({path:info.outputPath(`dowhy-${status}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 test(`DoWhy proposal ${theme} ${width}px binds method separately from human review`,async({page},info)=>{
  await story(page,"do-why-proposal",theme,width);await page.getByRole("combobox",{name:"Causal claim",exact:true}).selectOption(claimId);await page.getByRole("button",{name:"Revise human model and reset review"}).click();await page.getByRole("textbox",{name:"Model revision rationale",exact:true}).fill("Human independently selects this fixed numerical diagnostic method for review");await page.getByRole("combobox",{name:"Analysis provider",exact:true}).selectOption("dowhy");await expect(page.getByRole("button",{name:"Save human causal model"})).toBeEnabled();const cancel=await page.getByRole("button",{name:"Cancel model proposal",exact:true}).boundingBox(),save=await page.getByRole("button",{name:"Save human causal model",exact:true}).boundingBox();expect(cancel).not.toBeNull();expect(save).not.toBeNull();expect(Math.abs(cancel!.y-save!.y)).toBeLessThanOrEqual(1);expect(cancel!.x).toBeLessThan(save!.x);await expect(page.getByRole("region",{name:"Causal analysis method"})).toContainText("Unknown or failed diagnostics withhold causal reliance");await expect(page.getByRole("button",{name:"Interpret registered evidence once"})).toHaveCount(0);await settled(page,theme);await accessibility(page);await page.screenshot({path:info.outputPath(`dowhy-proposal-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 test(`causal independent revocation ${theme} ${width}px discloses only control metadata`,async({page},info)=>{
  await story(page,"revocation-controls",theme,width);await page.getByRole("combobox",{name:"Claim control reference",exact:true}).selectOption(claimId);const revoke=page.getByRole("button",{name:"Revoke this causal claim"});await expect(revoke).toBeDisabled();await page.getByRole("textbox",{name:"Revocation rationale",exact:true}).fill("Human withdraws this claim while the full analysis feature is disabled");await expect(revoke).toBeEnabled();await expect(page.getByRole("region",{name:"Independent causal revocation controls"})).not.toContainText("Earlier review and native completion");await accessibility(page);await page.screenshot({path:info.outputPath(`causal-revocation-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
}
