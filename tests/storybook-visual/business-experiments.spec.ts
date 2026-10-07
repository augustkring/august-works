import {expect,test,type Page} from "@playwright/test";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),axePath=require.resolve("axe-core/axe.min.js"),experimentId="00000000-0000-4000-8000-000000000701";
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
async function story(page:Page,state:string,theme:string,width:number){await page.route("**/api/**",r=>r.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-business-experiments--${state}&viewMode=story&globals=theme:${theme}`);}
for(const theme of ["light","dark"])for(const width of [390,1200]){
 for(const state of ["passed","failed","inconclusive","invalid","stale","safety-stop"])test(`experiment result ${state} ${theme} ${width}px preserves conditional authority and quality`,async({page},info)=>{
  await story(page,state,theme,width);const panel=page.getByRole("region",{name:"Experiment result"});await expect(panel).toContainText("human attestations");await expect(panel).toContainText("intention-to-treat");await expect(panel).toContainText("registered period");const quality=panel.getByText("Inspect evidence quality and balance",{exact:true});await quality.focus();await page.keyboard.press("Space");await expect(panel.getByRole("region",{name:"Registered evidence quality gates"})).toBeVisible();
  if(state==="passed")await expect(panel).toContainText("Registered benefit and safety bounds met");if(state==="failed")await expect(panel).toContainText("Registered benefit or safety bounds not met");
  if(["invalid","safety-stop"].includes(state)){await expect(panel.getByRole("region",{name:"Primary, guardrail and exploratory results"})).toHaveCount(0);await expect(panel).toContainText("Causal reliance is withheld");}
  else await expect(panel).toContainText("percentage points");
  if(state==="stale")await expect(panel.getByRole("status")).toContainText("retained original result");
  const details=page.getByText("Inspect limitations and traceability",{exact:true});await details.focus();await page.keyboard.press("Space");await expect(panel).toContainText("analysis receipt");await expect(panel).toContainText("operational proxy");await accessibility(page);await page.screenshot({path:info.outputPath(`experiment-result-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 for(const state of ["draft","ready","running","completed","analyzing"])test(`experiment workspace ${state} ${theme} ${width}px keeps human lifecycle explicit`,async({page},info)=>{
  await story(page,state,theme,width);await page.getByRole("combobox",{name:"Experiment",exact:true}).selectOption(experimentId);await expect(page.getByRole("heading",{name:"Earlier process review",exact:true})).toBeVisible();await expect(page).toHaveURL(/business-experiments/);
  await expect(page.getByRole("region",{name:"Registered hypothesis and primary safety policy"})).toContainText("Hypothesis");
  if(state==="ready"){const start=page.getByRole("button",{name:"Start recording this protocol"});await expect(start).toBeDisabled();await page.getByRole("textbox",{name:"Human action rationale",exact:true}).fill("Human reviews this exact protocol before starting non-personal recording");await expect(start).toBeEnabled();}
  if(state==="running"){await expect(page.getByRole("button",{name:"Complete under registered stopping policy"})).toBeDisabled();await expect(page.getByRole("combobox",{name:"Completion reason"})).toHaveValue("fixed_horizon");await expect(page.getByRole("combobox",{name:"Human concurrent-change assessment"})).toHaveValue("");}
  if(state==="completed")await expect(page.getByRole("button",{name:"Capture and analyze once"})).toBeEnabled();
  if(state==="analyzing"){const interpret=page.getByRole("button",{name:"Save human interpretation"});await expect(interpret).toBeDisabled();await expect(page.getByRole("combobox",{name:"Human conclusion"})).toHaveValue("abstain");await expect(page.getByRole("combobox",{name:"Human conclusion"})).not.toContainText("Ship candidate");}
  await accessibility(page);await page.screenshot({path:info.outputPath(`experiment-workspace-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 test(`experiment typed preregistration ${theme} ${width}px requires exact native pins and human rationale`,async({page},info)=>{
  await story(page,"draft",theme,width);await page.getByRole("combobox",{name:"Experiment",exact:true}).selectOption(experimentId);await page.getByRole("button",{name:"Amend unstarted protocol"}).click();const form=page.getByRole("form",{name:"Experiment preregistration proposal"}),save=form.getByRole("button",{name:"Save experiment proposal"});await expect(save).toBeDisabled();await form.getByRole("textbox",{name:"Amendment rationale",exact:true}).fill("Human explicitly reviews this unstarted protocol amendment before new approval");await expect(save).toBeEnabled();
  await expect(form.getByRole("combobox",{name:"Primary metric measure",exact:true})).toHaveValue("00000000-0000-4000-8000-000000000710");await expect(form.getByRole("combobox",{name:"Guardrail 1 measure",exact:true})).toHaveValue("00000000-0000-4000-8000-000000000711");await expect(form.getByRole("combobox",{name:"Pretreatment invariant 1",exact:true})).toHaveValue("00000000-0000-4000-8000-000000000712");
  await form.getByRole("spinbutton",{name:"Final capture deadline after horizon (seconds)",exact:true}).fill("86401");await expect(save).toBeDisabled();await form.getByRole("spinbutton",{name:"Final capture deadline after horizon (seconds)",exact:true}).fill("3600");await expect(save).toBeEnabled();
  await form.getByRole("button",{name:"Add guardrail",exact:true}).click();await expect(save).toBeDisabled();await expect(form.getByRole("combobox",{name:"Guardrail 2 measure",exact:true})).toBeVisible();await form.getByRole("button",{name:"Remove last guardrail",exact:true}).click();await expect(save).toBeEnabled();
  await accessibility(page);await page.screenshot({path:info.outputPath(`experiment-preregistration-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 test(`experiment independent stopping ${theme} ${width}px discloses only control metadata`,async({page},info)=>{
  await story(page,"stopping-controls",theme,width);await page.getByRole("combobox",{name:"Active recording",exact:true}).selectOption(experimentId);const stop=page.getByRole("button",{name:"Cancel this active recording"});await expect(stop).toBeDisabled();await page.getByRole("textbox",{name:"Stopping rationale",exact:true}).fill("Human stops this recording while the experimental rollout is disabled");await expect(stop).toBeEnabled();await expect(page.getByRole("region",{name:"Active experiment stopping controls"})).not.toContainText("Earlier human process review");await accessibility(page);await page.screenshot({path:info.outputPath(`experiment-stopping-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
}
