import {expect,test,type Page} from "@playwright/test";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),axePath=require.resolve("axe-core/axe.min.js");
async function accessibility(page:Page) {
  await page.addScriptTag({path:axePath});const violations=await page.evaluate(async()=>{
    const w=window as unknown as {axe:{run:(context:string,options:unknown)=>Promise<{violations:unknown[]}>}};
    return (await w.axe.run("#storybook-root",{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations;
  });expect(violations).toEqual([]);
}
const states=["scheduled","due","in-progress","completed","inconclusive","cancelled"];
for(const theme of ["light","dark"]) for(const width of [390,1200]) for(const state of states) {
  test(`decision outcome ${state} ${theme} ${width}px preserves separate human assessments`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});
    await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--review-${state}&viewMode=story&globals=theme:${theme}`);
    const panel=page.getByRole("region",{name:"Decision outcome review",exact:true});await expect(panel).toBeVisible();
    if(["completed","inconclusive"].includes(state)) {
      await expect(panel).toContainText("Better observed completion does not prove the decision's causal effect");
      await expect(panel.getByRole("region",{name:"Recorded metric comparisons"})).toContainText("Baseline 0.5 · actual 1 ratio");
      await expect(panel).toContainText("Human expected range 0.6 to 0.8");await expect(panel).toContainText("Before/after association does not identify");
      for(const label of ["Decision process quality","Assumption accuracy","Execution fidelity","External change","Observed outcome","Causal confidence"]) await expect(panel).toContainText(label);
      await expect(panel.getByRole("button",{name:"Assess decision outcomes"})).toHaveCount(0);await expect(panel.getByRole("button",{name:"Begin outcome review"})).toHaveCount(0);
    } else if(state==="cancelled") await expect(panel.getByRole("button",{name:"Begin outcome review"})).toHaveCount(0);
    else if(state==="in-progress") await expect(panel.getByRole("button",{name:"Assess decision outcomes"})).toBeEnabled();
    else {
      const begin=panel.getByRole("button",{name:"Begin outcome review"});await expect(begin).toBeDisabled();
      await panel.getByRole("textbox",{name:"Outcome review rationale",exact:true}).fill("The human begins a separate assessment using the frozen expectations");await expect(begin).toBeEnabled();
    }
    const provenance=panel.getByText("Inspect outcome review provenance",{exact:true});await provenance.focus();await page.keyboard.press("Space");await expect(panel).toContainText("Frozen context hash");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);await page.screenshot({path:info.outputPath(`decision-outcome-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
}
for(const theme of ["light","dark"]) for(const width of [390,1200]) {
  test(`human outcome form ${theme} ${width}px permits abstention without inventing numeric evidence`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--review-in-progress&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("button",{name:"Assess decision outcomes"}).click();const form=page.getByRole("form",{name:"Decision outcome assessment"});
    await expect(form.getByRole("button",{name:"Record outcome review"})).toBeDisabled();
    for(const label of ["Assumption outcome explanation","Decision process quality explanation","Assumption accuracy explanation","Execution fidelity explanation","External change explanation","Observed outcome explanation","Causal confidence explanation","Lesson summary"])
      await form.getByRole("textbox",{name:label,exact:true}).fill("Explicit human assessment: the available evidence is incomplete");
    await expect(form.getByRole("button",{name:"Record outcome review"})).toBeEnabled();
    await form.getByRole("combobox",{name:"Review result",exact:true}).selectOption("completed");await expect(form.getByRole("button",{name:"Record outcome review"})).toBeDisabled();
    await form.getByRole("combobox",{name:"Review result",exact:true}).selectOption("inconclusive");await expect(form.getByRole("button",{name:"Record outcome review"})).toBeEnabled();
    await expect(form.getByRole("combobox",{name:"Causal assessment",exact:true}).locator("option")).toHaveText(["Not assessed","Association only"]);
    await expect(form.getByRole("combobox",{name:"Actual horizon observation",exact:true})).toHaveValue("");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);await page.screenshot({path:info.outputPath(`decision-outcome-form-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
}
test("a human outcome assessment survives both parent and review refresh intervals",async({page})=>{
  await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width:1200,height:1100});await page.goto("/iframe.html?id=business-intelligence-decision-intelligence--review-in-progress&viewMode=story");
  await page.getByRole("button",{name:"Assess decision outcomes"}).click();const form=page.getByRole("form",{name:"Decision outcome assessment"});
  const lesson=form.getByRole("textbox",{name:"Lesson summary",exact:true});await lesson.fill("A human is still evaluating the outcome and its separate assumptions");
  // Exercise the actual 30-second parent/read interval, not a readiness delay.
  await page.waitForTimeout(31000);await expect(form).toBeVisible();await expect(lesson).toHaveValue("A human is still evaluating the outcome and its separate assumptions");
});
