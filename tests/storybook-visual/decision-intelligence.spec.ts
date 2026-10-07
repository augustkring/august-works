import {expect,test,type Page} from "@playwright/test";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),axePath=require.resolve("axe-core/axe.min.js");
async function accessibility(page:Page) {
  await page.addScriptTag({path:axePath});const deadline=performance.now()+10000;
  const violations=await page.evaluate(async budget=>{
    const w=window as unknown as {axe:{run:(context:string,options:unknown)=>Promise<{violations:unknown[]}>}};
    while(true) {try{return (await w.axe.run("#storybook-root",{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations;}catch(error){if(!(error instanceof Error)||!error.message.includes("Axe is already running")||performance.now()>=budget) throw error;await new Promise(resolve=>setTimeout(resolve,25));}}
  },deadline);expect(violations).toEqual([]);
}
for(const theme of ["light","dark"]) for(const width of [390,1200]) for(const state of ["empty","proposal","prepared","frozen","expired"]) {
  test(`decision context ${state} ${theme} ${width}px preserves prospective human review`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1000});
    await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--${state}&viewMode=story&globals=theme:${theme}`);
    const panel=page.getByLabel("Decision context",{exact:true});await expect(panel).toBeVisible();
    if(state==="empty"||state==="expired") {
      await expect(panel).toContainText("No retained context is available");await expect(panel).not.toContainText("0.5");
      await expect(panel.getByRole("button",{name:"Propose decision context",exact:true})).toBeEnabled();
    } else {
      await expect(panel).toContainText("Should we extend the delivery review pilot?");
      await expect(panel.getByRole("region",{name:"Captured decision evidence"})).toContainText("0.5");
      await expect(panel.getByRole("region",{name:"Recorded decision assumptions"})).toContainText("Human confidence medium");
      await expect(panel.getByRole("region",{name:"Recorded expected outcomes"})).toContainText("no calibrated forecast interval");
      const provenance=panel.getByText("Inspect context provenance",{exact:true});await provenance.focus();await page.keyboard.press("Space");await expect(panel).toContainText("Native decision specification");
      if(state==="frozen") {
        await expect(panel).toContainText("Frozen at the native decision");await expect(panel).toContainText("Later observations belong in a separate outcome review");
        await expect(panel.getByRole("button",{name:"Prepare this context"})).toHaveCount(0);await expect(panel.getByRole("button",{name:"Propose a context revision"})).toHaveCount(0);
      } else {
        const action=state==="prepared"?"Withdraw prepared context":"Prepare this context";
        await expect(panel.getByRole("button",{name:action,exact:true})).toBeDisabled();
        await panel.getByLabel("Review rationale",{exact:true}).fill("Explicit human review of the exact native context and evidence");await expect(panel.getByRole("button",{name:action,exact:true})).toBeEnabled();
      }
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);
    await page.screenshot({path:info.outputPath(`decision-context-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
}
for(const theme of ["light","dark"]) for(const width of [390,1200]) {
  test(`decision proposal ${theme} ${width}px declares human judgment without copied facts`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});
    await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--empty&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("button",{name:"Propose decision context",exact:true}).click();const form=page.getByRole("form",{name:"Decision context proposal"});
    await expect(form.getByRole("button",{name:"Save context proposal"})).toBeDisabled();
    await form.getByLabel("Question",{exact:true}).fill("Should we extend the delivery evidence pilot?");await form.getByLabel("Objective",{exact:true}).fill("Improve useful delivery through human evidence review");
    await form.getByLabel("Uncertainty",{exact:true}).fill("Delivery conditions remain uncertain and require human review");await form.getByLabel("Approved decision purpose",{exact:true}).selectOption({label:"Approved advisory decision purpose"});
    await form.getByLabel("Criterion description",{exact:true}).fill("Capacity to deliver useful business outcomes within the horizon");await form.getByLabel("Expected outcome statement",{exact:true}).fill("Observe useful delivery outcomes within the declared pilot horizon");
    await form.getByLabel("Outcome uncertainty",{exact:true}).fill("A human judgment without a calibrated prediction interval");await expect(form.getByRole("button",{name:"Save context proposal"})).toBeEnabled();
    await form.getByRole("button",{name:"Add assumption",exact:true}).click();await expect(form.getByRole("button",{name:"Save context proposal"})).toBeDisabled();
    await form.getByLabel("Assumption statement",{exact:true}).fill("Delivery capacity remains available throughout this observed pilot");await form.getByLabel("Human confidence",{exact:true}).selectOption("medium");
    await expect(form.getByRole("button",{name:"Save context proposal"})).toBeEnabled();
    await form.getByRole("button",{name:"Add native evidence",exact:true}).click();await expect(form.getByRole("button",{name:"Save context proposal"})).toBeDisabled();
    await form.getByLabel("Published metric",{exact:true}).selectOption("00000000-0000-4000-8000-000000000006");await form.getByLabel("Pinned evidence",{exact:true}).selectOption({label:"2026-09-01 to 2026-10-01 · observed"});
    await form.getByLabel("Evidence rationale",{exact:true}).fill("The pinned native measurement supports a human evidence review");await expect(form.getByRole("button",{name:"Save context proposal"})).toBeEnabled();
    await form.getByLabel("Expectation kind",{exact:true}).selectOption("metric");await expect(form.getByRole("button",{name:"Save context proposal"})).toBeDisabled();await form.getByLabel("Baseline evidence",{exact:true}).selectOption("evidence_1");
    await form.getByLabel("Expected lower bound",{exact:true}).fill("0.6");await form.getByLabel("Expected upper bound",{exact:true}).fill("0.8");await expect(form.getByRole("button",{name:"Save context proposal"})).toBeEnabled();
    await form.getByLabel("Expected upper bound",{exact:true}).fill("0.5");await expect(form.getByRole("button",{name:"Save context proposal"})).toBeDisabled();await form.getByLabel("Expected upper bound",{exact:true}).fill("0.8");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);await page.screenshot({path:info.outputPath(`decision-proposal-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
}
test("a human's unsaved proposal survives the normal background refresh interval",async({page})=>{
  await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width:1200,height:1100});
  await page.goto("/iframe.html?id=business-intelligence-decision-intelligence--empty&viewMode=story");
  await page.getByRole("button",{name:"Propose decision context",exact:true}).click();
  const form=page.getByRole("form",{name:"Decision context proposal"});await form.getByRole("textbox",{name:"Question",exact:true}).fill("A human is still drafting this prospective context");
  // Cross the production 30-second query interval: this is an elapsed-time
  // regression, not a readiness wait that should be replaced by a locator.
  await page.waitForTimeout(31000);
  await expect(form).toBeVisible();await expect(form.getByRole("textbox",{name:"Question",exact:true})).toHaveValue("A human is still drafting this prospective context");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
