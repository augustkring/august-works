import {expect,test,type Page} from "@playwright/test";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),axePath=require.resolve("axe-core/axe.min.js");
async function accessibility(page:Page) {
  await page.addScriptTag({path:axePath});
  const violations=await page.evaluate(async budget=>{
    const w=window as unknown as {axe:{run:(context:string,options:unknown)=>Promise<{violations:unknown[]}>}};
    const deadline=performance.now()+budget;
    while(true) {try{return (await w.axe.run("#storybook-root",{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}})).violations;}catch(error){if(!(error instanceof Error)||!error.message.includes("Axe is already running")||performance.now()>=deadline) throw error;await new Promise(resolve=>setTimeout(resolve,25));}}
  },5000);expect(violations).toEqual([]);
}
for(const theme of ["light","dark"]) for(const width of [390,1200]) {
  test(`decision templates ${theme} ${width}px preserve human content and keyboard choice`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--proposal&viewMode=story&globals=theme:${theme}`);await page.getByRole("button",{name:"Propose a context revision",exact:true}).click();const form=page.getByRole("form",{name:"Decision context proposal"}),question=form.getByRole("textbox",{name:"Question",exact:true}),original=await question.inputValue(),selector=form.getByRole("combobox",{name:"Optional decision template",exact:true});await expect(selector.locator("option")).toHaveCount(9);
    for(const key of ["strategic_bet","budget_allocation","vendor_selection","product_launch","market_entry","project_replan","policy_change","experiment_decision"]){await selector.selectOption(key);await expect(form.getByRole("region",{name:"Optional decision template guidance"})).toContainText("Use these prompts to write your own context");await expect(question).toHaveValue(original);}await selector.focus();await page.keyboard.press("Tab");await expect(question).toBeFocused();await expect(form.getByRole("button",{name:"Save context proposal"})).toBeEnabled();await accessibility(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`decision-templates-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
  for(const state of ["captured-causal","historical-causal"])test(`decision ${state} ${theme} ${width}px retains exact human model and conditional result`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--${state}&viewMode=story&globals=theme:${theme}`);const model=page.getByRole("region",{name:"Captured human causal model"});await expect(model).toContainText("Does earlier human review");await expect(model).toContainText("Human graph review");await expect(model).toContainText("Conditional support");await expect(model).toContainText("No verified business impact");const graph=model.getByText("Inspect captured human graph and assumptions",{exact:true});await graph.focus();await page.keyboard.press("Space");await expect(model).toContainText("human assumption");await expect(model).toContainText("assumed");if(state==="historical-causal"){await expect(model).toContainText("retained result requires explicit source revalidation");await expect(page.getByRole("status").filter({hasText:"changed or revoked"})).toBeVisible();}await expect(page.getByRole("button",{name:"Prepare this context"})).toHaveCount(0);await accessibility(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`decision-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
  test(`decision causal picker ${theme} ${width}px pins only exact analysis and review identities`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--proposal&viewMode=story&globals=theme:${theme}`);await page.getByRole("button",{name:"Propose a context revision",exact:true}).click();const form=page.getByRole("form",{name:"Decision context proposal"});await form.getByRole("button",{name:"Add native evidence",exact:true}).click();const evidence=form.getByRole("group",{name:"Evidence 2",exact:true});await evidence.getByRole("combobox",{name:"Evidence kind",exact:true}).selectOption("causal_analysis");await evidence.getByRole("combobox",{name:"Reviewed causal claim",exact:true}).selectOption("00000000-0000-4000-8000-000000001101");const pin=evidence.getByRole("combobox",{name:"Pinned evidence",exact:true}),ref={type:"causal_analysis",id:"00000000-0000-4000-8000-000000001103",claimId:"00000000-0000-4000-8000-000000001101",versionId:"00000000-0000-4000-8000-000000001102",reviewId:"00000000-0000-4000-8000-000000001105"};await pin.selectOption(JSON.stringify(ref));await expect(pin).toHaveValue(JSON.stringify(ref));await expect(evidence).toContainText("no measured outcome or execution authority");await accessibility(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`decision-causal-picker-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });

  for(const kind of ["forecast_run","scenario_run"] as const) test(`decision calculation ${kind} ${theme} ${width}px pins exact advisory evidence`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});
    await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--proposal&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("button",{name:"Propose a context revision",exact:true}).click();const form=page.getByRole("form",{name:"Decision context proposal"});
    await form.getByRole("button",{name:"Add native evidence",exact:true}).click();const evidence=form.getByRole("group",{name:"Evidence 2",exact:true});
    await evidence.getByRole("combobox",{name:"Evidence kind",exact:true}).selectOption(kind);
    await evidence.getByRole("combobox",{name:kind==="forecast_run"?"Published forecast":"Published scenario",exact:true}).selectOption(kind==="forecast_run"?"00000000-0000-4000-8000-000000000002":"00000000-0000-4000-8000-000000000501");
    await evidence.getByRole("combobox",{name:"Retained calculation run",exact:true}).selectOption(kind==="forecast_run"?"00000000-0000-4000-8000-000000000008":"00000000-0000-4000-8000-000000000503");
    const pin=evidence.getByRole("combobox",{name:"Pinned evidence",exact:true});
    const value=await pin.locator("option").nth(kind==="forecast_run"?1:2).getAttribute("value");await pin.selectOption(value!);
    await evidence.getByRole("textbox",{name:"Evidence rationale",exact:true}).fill("Human reviews this exact conditional calculation and its evidence limits");
    await expect(form.getByRole("button",{name:"Save context proposal"})).toBeEnabled();
    const source=JSON.parse(await pin.inputValue());expect(source.type).toBe(kind);expect(source).not.toHaveProperty("value");expect(source).not.toHaveProperty("contentHash");
    if(kind==="forecast_run") expect(source.pointIndex).toBe(0);else expect(source).toMatchObject({caseKey:"option",outputKey:"capacity"});
    await expect(evidence).toContainText("do not become measured outcomes or authorize a choice");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);
    await page.screenshot({path:info.outputPath(`decision-calculation-${kind}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
  test(`decision experiment ${theme} ${width}px binds exact human advisory interpretation`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--proposal&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("button",{name:"Propose a context revision",exact:true}).click();const form=page.getByRole("form",{name:"Decision context proposal"});await form.getByRole("button",{name:"Add native evidence",exact:true}).click();const evidence=form.getByRole("group",{name:"Evidence 2",exact:true});
    await evidence.getByRole("combobox",{name:"Evidence kind",exact:true}).selectOption("experiment_analysis");await evidence.getByRole("combobox",{name:"Human-interpreted experiment",exact:true}).selectOption("00000000-0000-4000-8000-000000000701");
    const pin=evidence.getByRole("combobox",{name:"Pinned evidence",exact:true});const value=await pin.locator("option").nth(1).getAttribute("value");await pin.selectOption(value!);const source=JSON.parse(await pin.inputValue());expect(source).toMatchObject({type:"experiment_analysis",id:"00000000-0000-4000-8000-000000000703",interpretationId:"00000000-0000-4000-8000-000000000705"});expect(source).not.toHaveProperty("effect");expect(source).not.toHaveProperty("sourceHash");
    await evidence.getByRole("textbox",{name:"Evidence rationale",exact:true}).fill("Separate human consideration of this exact interpreted proxy experiment");await expect(form.getByRole("button",{name:"Save context proposal"})).toBeEnabled();await expect(evidence).toContainText("conditional proxies");
    await pin.focus();await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);await page.screenshot({path:info.outputPath(`decision-experiment-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
  test(`decision captured experiment ${theme} ${width}px preserves intervals and every safety gate`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--captured-experiment&viewMode=story&globals=theme:${theme}`);const result=page.getByRole("region",{name:"Experiment result",exact:true});await expect(result).toContainText("Evidence remains inconclusive");await expect(result).toContainText("percentage points");await expect(result).toContainText("Registered acceptable harm");await expect(result).toContainText("Human interpretation");await expect(result).toContainText("Advisory only");
    const gates=result.getByText("Inspect evidence quality and balance",{exact:true});await gates.focus();await page.keyboard.press("Space");await expect(result).toContainText("Complete native assignment receipts");await expect(result).toContainText("Admitted human concurrent-change review");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);await page.screenshot({path:info.outputPath(`decision-captured-experiment-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
  test(`decision historical calculation ${theme} ${width}px preserves frozen basis and revalidation`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});
    await page.goto(`/iframe.html?id=business-intelligence-decision-intelligence--historical-calculation&viewMode=story&globals=theme:${theme}`);
    const evidence=page.getByRole("region",{name:"Captured decision evidence"});
    await expect(evidence).toContainText("retained calculation is historical");await expect(evidence).toContainText("captured decision basis remains unchanged");
    await expect(evidence).toContainText("no observed actual, calibration, causal effect or commitment");
    await expect(page.getByRole("button",{name:"Propose a context revision"})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);
    await page.screenshot({path:info.outputPath(`decision-historical-calculation-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
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
