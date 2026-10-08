import {expect,test,type Page} from "@playwright/test";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),axePath=require.resolve("axe-core/axe.min.js"),proposalId="00000000-0000-4000-8000-000000002202";
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

async function story(page:Page,state:string,theme:string,width:number){await page.route("**/api/**",r=>r.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-project-planning--${state}&viewMode=story&globals=theme:${theme}`);}
for(const theme of ["light","dark"])for(const width of [390,1200]){
 for(const state of ["current","retained","disabled"])test(`planning review ${state} ${theme} ${width}px keeps canonical human authority`,async({page},info)=>{
  await story(page,state,theme,width);await page.getByRole("combobox",{name:"Planning proposal reference",exact:true}).selectOption(proposalId);
  const reject=page.getByRole("button",{name:"Reject this planning proposal",exact:true});await expect(reject).toBeDisabled();await page.getByRole("textbox",{name:"Separate human planning review rationale",exact:true}).fill("Human independently reviews the supplied source and original intervals");await expect(reject).toBeEnabled();
  const approve=page.getByRole("button",{name:"Approve committed planning dates",exact:true});
  if(state==="disabled"){await expect(approve).toHaveCount(0);await expect(page.getByRole("region",{name:"Declared planning constraint result"})).toHaveCount(0);await expect(page.getByRole("region",{name:"Adaptive project planning",exact:true})).not.toContainText("Prepare source evidence");}
  else {await expect(approve).toBeDisabled();const ack=page.getByRole("checkbox");await ack.focus();await page.keyboard.press("Space");if(state==="current")await expect(approve).toBeEnabled();else {await expect(approve).toBeDisabled();await expect(page.getByRole("region",{name:"Declared planning constraint result"})).toContainText("Retained feasible calculation");}await page.getByText("Original human declarations and evidence",{exact:true}).focus();await page.keyboard.press("Space");await expect(page.getByRole("region",{name:"Adaptive project planning",exact:true})).toContainText("Human supplied synthetic assumptions");}
  await accessibility(page);await page.screenshot({path:info.outputPath(`planning-review-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 test(`planning declarations ${theme} ${width}px retain unknowns and explicit no-demand authority`,async({page},info)=>{
  await story(page,"current",theme,width);await page.getByRole("button",{name:"Declare a project planning problem",exact:true}).click();const form=page.getByRole("form",{name:"Declared project planning assumptions"}),inspect=form.getByRole("button",{name:"Inspect constraints and proposed schedule",exact:true});await expect(inspect).toBeDisabled();await form.getByRole("textbox",{name:"Declaration rationale for Prepare source evidence",exact:true}).fill("Human supplies these assumptions with explicit remaining uncertainty");await form.getByRole("combobox",{name:"Approved planning purpose",exact:true}).selectOption({index:1});await expect(inspect).toBeDisabled();const noDemand=form.getByRole("checkbox",{name:"Explicitly declare no demand on the supplied pool",exact:true});await noDemand.focus();await page.keyboard.press("Space");await expect(inspect).toBeEnabled();await expect(form.getByRole("spinbutton",{name:"Duration for Prepare source evidence",exact:true})).toHaveValue("");await expect(form.getByRole("spinbutton",{name:"Available minutes per day (empty = unknown)",exact:true})).toHaveValue("");await form.getByRole("spinbutton",{name:"Earliest start offset for Prepare source evidence",exact:true}).fill("14");await expect(inspect).toBeDisabled();await form.getByRole("spinbutton",{name:"Earliest start offset for Prepare source evidence",exact:true}).fill("0");await expect(inspect).toBeEnabled();await accessibility(page);await page.screenshot({path:info.outputPath(`planning-declarations-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
 });
 for(const state of ["inconclusive","infeasible"])test(`planning ${state} ${theme} ${width}px withholds unestablished dates`,async({page},info)=>{await story(page,state,theme,width);const result=page.getByRole("region",{name:"Declared planning constraint result"});await expect(result).toContainText(state==="inconclusive"?"Inconclusive":"Infeasible constraints");await expect(result.getByRole("table")).toHaveCount(0);await expect(result.getByRole("button")).toHaveCount(0);await accessibility(page);await page.screenshot({path:info.outputPath(`planning-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});});
}

for(const theme of ["light","dark"])for(const width of [390,1200])test(`observed planning outcome ${theme} ${width}px keeps independent review`,async({page},info)=>{
 await story(page,"accepted",theme,width);await page.getByRole("combobox",{name:"Planning proposal reference",exact:true}).selectOption(proposalId);
 const outcome=page.getByRole("region",{name:"Observed planning outcome",exact:true}),record=outcome.getByRole("button",{name:"Record observed planning outcome",exact:true});
 await expect(record).toBeDisabled();await outcome.getByRole("textbox",{name:"Planning outcome review rationale",exact:true}).fill("Human reviews actual completion before testing a separate capability hypothesis");await expect(record).toBeEnabled();
 await expect(page.getByRole("button",{name:"Approve committed planning dates",exact:true})).toHaveCount(0);await expect(outcome).toContainText("business impact and causation remain unestablished");
 await accessibility(page);await page.screenshot({path:info.outputPath(`planning-outcome-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
});

for (const theme of ["light", "dark"]) for (const width of [390, 1200]) {
  for (const state of ["current", "retained", "disabled"]) test(`joint planning ${state} ${theme} ${width}px retains separate Human review`, async ({ page }, info) => {
    await page.route("**/api/**", route => route.abort()); await page.setViewportSize({ width, height: 1100 });
    await page.goto(`/iframe.html?id=business-intelligence-cross-project-planning--${state}&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("combobox", { name: "Joint proposal reference", exact: true }).selectOption("00000000-0000-4000-8000-000000002403");
    await page.getByRole("textbox", { name: "Joint planning review rationale", exact: true }).fill("Human independently reviews complete native populations and shared capacity");
    await expect(page.getByRole("button", { name: "Cancel joint proposal", exact: true })).toBeEnabled();
    const begin = page.getByRole("button", { name: "Begin separate joint review", exact: true });
    if (state === "disabled") { await expect(begin).toHaveCount(0); await expect(page.getByRole("region", { name: "Declared planning constraint result", exact: true })).toHaveCount(0); await expect(page.getByText("First project", { exact: true })).toHaveCount(0); }
    else { await expect(begin).toBeDisabled(); const ack = page.getByRole("region", { name: "Separate Human joint review", exact: true }).getByRole("checkbox"); await ack.focus(); await page.keyboard.press("Space"); if (state === "current") await expect(begin).toBeEnabled(); else { await expect(begin).toBeDisabled(); await expect(page.getByRole("region", { name: "Declared planning constraint result", exact: true })).toContainText("Retained feasible calculation"); } const original = page.getByText("Original human declarations and evidence", { exact: true }); await original.focus(); await page.keyboard.press("Space"); await expect(page.getByRole("region", { name: "Original declared task assumptions", exact: true })).toBeVisible(); }
    await accessibility(page); await page.screenshot({ path: info.outputPath(`joint-planning-${state}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
  test(`joint declarations ${theme} ${width}px reuse explicit native assumptions`, async ({ page }, info) => {
    await page.route("**/api/**", route => route.abort()); await page.setViewportSize({ width, height: 1100 });
    await page.goto(`/iframe.html?id=business-intelligence-cross-project-planning--current&viewMode=story&globals=theme:${theme}`);
    const choices = page.getByRole("region", { name: "Native joint planning project choices", exact: true });
    await choices.getByRole("checkbox", { name: "First project", exact: true }).check(); await choices.getByRole("checkbox", { name: "Second project", exact: true }).check();
    await page.getByRole("button", { name: "Declare shared project constraints", exact: true }).click();
    const form = page.getByRole("form", { name: "Declared project planning assumptions", exact: true });
    await expect(form).toContainText("All current active tasks are required in the selected projects");
    await form.getByRole("textbox", { name: "Declaration rationale for First project · Prepare source evidence", exact: true }).fill("Human explicitly maintains joint duration and capacity assumptions");
    await form.getByRole("textbox", { name: "Declaration rationale for Second project · Resolve native dependency", exact: true }).fill("Human explicitly maintains the dependent native Task assumptions");
    await form.getByRole("combobox", { name: "Approved planning purpose", exact: true }).selectOption({ index: 1 });
    const inspect = form.getByRole("button", { name: "Inspect constraints and proposed schedule", exact: true }); await expect(inspect).toBeDisabled();
    for (const ack of await form.getByRole("checkbox", { name: "Explicitly declare no demand on the supplied pool", exact: true }).all()) { await ack.focus(); await page.keyboard.press("Space"); }
    await expect(inspect).toBeEnabled(); await accessibility(page); await page.screenshot({ path: info.outputPath(`joint-declarations-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
  });
}
